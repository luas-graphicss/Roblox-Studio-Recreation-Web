import { Vec3, Quaternion, Mat3, buildTangents } from "./math3d.js";
import { Body } from "./body.js";
import { Material, ContactMaterial, contactMaterialKey } from "./materials.js";
import { SAPBroadphase } from "./broadphase.js";
import { collideShapes } from "./narrowphase.js";

const CONTACT_BETA = 0.2;
const CONTACT_SLOP = 0.01;
const MAX_CORRECTIVE_VELOCITY = 10;
const RESTITUTION_THRESHOLD = 1;
const WARM_START_TOLERANCE_SQ = 0.0025;
const SHAPE_CULL_MARGIN = 0.03;
const ZERO_MAT = new Mat3().setZero();

function bodyPairKey(a, b) {
  return a.id < b.id ? a.id + "|" + b.id : b.id + "|" + a.id;
}

function maybeWake(sleeper, other) {
  if (sleeper.type !== Body.DYNAMIC || !sleeper.isSleeping()) return;
  if (other.type !== Body.DYNAMIC) {
    if (other.poseMoved) sleeper.wakeUp();
    return;
  }
  if (other.isSleeping()) return;
  const speed2 = other.velocity.lengthSquared() + other.angularVelocity.lengthSquared();
  const limit = other.sleepSpeedLimit;
  if (speed2 > 2 * limit * limit) sleeper.wakeUp();
}

function relativeVelocity(row, target) {
  const vi = row.bi.velocity, wi = row.bi.angularVelocity, ri = row.ri;
  const vj = row.bj.velocity, wj = row.bj.angularVelocity, rj = row.rj;
  target.x = vj.x + wj.y * rj.z - wj.z * rj.y - (vi.x + wi.y * ri.z - wi.z * ri.y);
  target.y = vj.y + wj.z * rj.x - wj.x * rj.z - (vi.y + wi.z * ri.x - wi.x * ri.z);
  target.z = vj.z + wj.x * rj.y - wj.y * rj.x - (vi.z + wi.x * ri.y - wi.y * ri.x);
  return target;
}

function relativePseudoVelocity(row, target) {
  const vi = row.bi.pseudoVelocity, wi = row.bi.pseudoAngularVelocity, ri = row.ri;
  const vj = row.bj.pseudoVelocity, wj = row.bj.pseudoAngularVelocity, rj = row.rj;
  target.x = vj.x + wj.y * rj.z - wj.z * rj.y - (vi.x + wi.y * ri.z - wi.z * ri.y);
  target.y = vj.y + wj.z * rj.x - wj.x * rj.z - (vi.y + wi.z * ri.x - wi.x * ri.z);
  target.z = vj.z + wj.x * rj.y - wj.y * rj.x - (vi.z + wi.x * ri.y - wi.y * ri.x);
  return target;
}

function effectiveMass(row, dir) {
  let k = row.imA + row.imB;
  const cA = row.ri.cross(dir, new Vec3());
  const tA = row.IiA.vmult(cA, new Vec3());
  k += tA.cross(row.ri, cA).dot(dir);
  const cB = row.rj.cross(dir, new Vec3());
  const tB = row.IiB.vmult(cB, new Vec3());
  k += tB.cross(row.rj, cB).dot(dir);
  return k > 1e-12 ? 1 / k : 0;
}

function applyRowImpulse(row, P) {
  row.bi.velocity.addScaled(-row.imA, P);
  const LA = row.ri.cross(P, new Vec3());
  row.bi.angularVelocity.addScaled(-1, row.IiA.vmult(LA, LA));
  row.bj.velocity.addScaled(row.imB, P);
  const LB = row.rj.cross(P, new Vec3());
  row.bj.angularVelocity.addScaled(1, row.IiB.vmult(LB, LB));
}

function applyRowPseudoImpulse(row, P) {
  row.bi.pseudoVelocity.addScaled(-row.imA, P);
  const LA = row.ri.cross(P, new Vec3());
  row.bi.pseudoAngularVelocity.addScaled(-1, row.IiA.vmult(LA, LA));
  row.bj.pseudoVelocity.addScaled(row.imB, P);
  const LB = row.rj.cross(P, new Vec3());
  row.bj.pseudoAngularVelocity.addScaled(1, row.IiB.vmult(LB, LB));
}

export class World {
  constructor(options = {}) {
    this.gravity = new Vec3(0, -9.82, 0);
    if (options.gravity) this.gravity.copy(options.gravity);
    this.bodies = [];
    this.constraints = [];
    this.broadphase = new SAPBroadphase(this);
    this.allowSleep = true;
    this.solver = { iterations: 10 };
    this.defaultContactMaterial = new ContactMaterial(
      new Material("default"),
      new Material("default"),
      { friction: 0.3, restitution: 0.3 },
    );
    this.contactMaterialMap = new Map();
    this.contacts = [];
    this.manifoldCache = new Map();
    this.touchingPairs = new Map();
    this.time = 0;
  }

  addBody(body) {
    if (this.bodies.indexOf(body) >= 0) return;
    body.world = this;
    body.aabbNeedsUpdate = true;
    this.bodies.push(body);
  }

  removeBody(body) {
    const idx = this.bodies.indexOf(body);
    if (idx >= 0) this.bodies.splice(idx, 1);
    if (body.world === this) body.world = null;
  }

  addConstraint(constraint) {
    if (this.constraints.indexOf(constraint) < 0) this.constraints.push(constraint);
  }

  removeConstraint(constraint) {
    const idx = this.constraints.indexOf(constraint);
    if (idx >= 0) this.constraints.splice(idx, 1);
  }

  addContactMaterial(cm) {
    this.contactMaterialMap.set(contactMaterialKey(cm.materials[0], cm.materials[1]), cm);
  }

  getContactMaterial(m1, m2) {
    if (!m1 || !m2) return null;
    return this.contactMaterialMap.get(contactMaterialKey(m1, m2)) || null;
  }

  step(dt) {
    const h = Number(dt);
    if (!Number.isFinite(h) || h <= 0) return;

    for (const body of this.bodies) {
      const moved =
        body.position.x !== body.aabbPos.x ||
        body.position.y !== body.aabbPos.y ||
        body.position.z !== body.aabbPos.z ||
        body.quaternion.x !== body.aabbQuat.x ||
        body.quaternion.y !== body.aabbQuat.y ||
        body.quaternion.z !== body.aabbQuat.z ||
        body.quaternion.w !== body.aabbQuat.w;
      body.poseMoved = moved && body.type !== Body.DYNAMIC;


      if (moved && body.type === Body.DYNAMIC && body.isSleeping()) {
        body.wakeUp();
      }
      if (body.type === Body.DYNAMIC && !body.isSleeping()) {
        body.updateInertiaWorld();
        body.computeAABB();
      } else if (body.aabbNeedsUpdate || moved) {
        body.computeAABB();
      }
    }

    const noCollide = new Set();
    for (const c of this.constraints) {
      if (c && c.enabled !== false && c.collideConnected === false && c.bodyA && c.bodyB) {
        noCollide.add(bodyPairKey(c.bodyA, c.bodyB));
      }
    }

    const pairs = this.broadphase.collisionPairs(this);
    const contactPoints = this.buildContacts(pairs, noCollide);

    this.integrateForces(h);

    const rows = this.prepareContactRows(contactPoints, h);

    const joints = [];
    for (const c of this.constraints) {
      if (!c || c.enabled === false || !c.bodyA || !c.bodyB) continue;


      if (typeof c.initSolve !== "function" || typeof c.solveIteration !== "function") continue;
      let awakeA = c.bodyA.type === Body.DYNAMIC && !c.bodyA.isSleeping();
      let awakeB = c.bodyB.type === Body.DYNAMIC && !c.bodyB.isSleeping();
      if (!awakeA && !awakeB) {
        if (typeof c.wantsWake !== "function" || !c.wantsWake()) continue;
        c.bodyA.wakeUp();
        c.bodyB.wakeUp();
        awakeA = c.bodyA.type === Body.DYNAMIC && !c.bodyA.isSleeping();
        awakeB = c.bodyB.type === Body.DYNAMIC && !c.bodyB.isSleeping();
        if (!awakeA && !awakeB) continue;
      }
      c.initSolve(h);
      joints.push(c);
    }

    for (const row of rows) {
      if (row.jn !== 0 || row.jt1 !== 0 || row.jt2 !== 0) {
        const P = new Vec3(
          row.ni.x * row.jn + row.t1.x * row.jt1 + row.t2.x * row.jt2,
          row.ni.y * row.jn + row.t1.y * row.jt1 + row.t2.y * row.jt2,
          row.ni.z * row.jn + row.t1.z * row.jt1 + row.t2.z * row.jt2,
        );
        applyRowImpulse(row, P);
      }
    }


    const baseIterations = Math.max(1, this.solver.iterations | 0);
    const iterations = joints.length === 0
      ? baseIterations
      : Math.max(baseIterations, Math.min(60, baseIterations + joints.length * 6));
    for (let it = 0; it < iterations; it++) {
      for (const joint of joints) joint.solveIteration();
      for (const row of rows) this.solveRow(row);
      for (const row of rows) this.solveRowPosition(row);
    }

    this.storeManifolds(rows);
    this.integratePositions(h);


    let posIterations = this.solver.positionIterations;
    posIterations = Number.isFinite(posIterations)
      ? Math.min(10, Math.max(0, posIterations | 0))
      : 3;


    const maxPosIterations = posIterations === 0 ? 0 : Math.max(posIterations, 10);
    for (let it = 0; it < maxPosIterations; it++) {
      let converged = true;
      for (const joint of joints) {
        if (typeof joint.solvePosition === "function" && joint.solvePosition() === false) {
          converged = false;
        }
      }
      if (converged) break;
    }

    for (const body of this.bodies) {
      body.force.set(0, 0, 0);
      body.torque.set(0, 0, 0);
    }
    this.time += h;
  }

  buildContacts(pairs, noCollide) {
    const contacts = [];
    const touching = new Map();
    const invQuatI = new Quaternion();
    for (const pair of pairs) {
      let bi = pair[0], bj = pair[1];
      if (bi.id > bj.id) {
        bi = pair[1];
        bj = pair[0];
      }
      if (noCollide.has(bodyPairKey(bi, bj))) continue;
      let pairTouched = false;
      for (let a = 0; a < bi.shapes.length; a++) {
        const si = bi.shapes[a];
        const posA = bi.quaternion.vmult(bi.shapeOffsets[a], new Vec3());
        posA.x += bi.position.x;
        posA.y += bi.position.y;
        posA.z += bi.position.z;
        const quatA = bi.quaternion.mult(bi.shapeOrientations[a], new Quaternion());
        for (let b = 0; b < bj.shapes.length; b++) {
          const sj = bj.shapes[b];
          const posB = bj.quaternion.vmult(bj.shapeOffsets[b], new Vec3());
          posB.x += bj.position.x;
          posB.y += bj.position.y;
          posB.z += bj.position.z;
          const rsum = si.boundingRadius + sj.boundingRadius + SHAPE_CULL_MARGIN;
          if (posA.distanceSquared(posB) > rsum * rsum) continue;
          const quatB = bj.quaternion.mult(bj.shapeOrientations[b], new Quaternion());
          let manifold = null;
          try {
            manifold = collideShapes(si, posA, quatA, sj, posB, quatB);
          } catch (_err) {
            manifold = null;
          }
          if (!manifold || manifold.length === 0) continue;
          if (si.collisionResponse && sj.collisionResponse) pairTouched = true;
          const cacheKey = si.id + "|" + sj.id;
          const cached = this.manifoldCache.get(cacheKey) || null;
          bi.quaternion.conjugate(invQuatI);
          for (const m of manifold) {
            const entry = {
              bi,
              bj,
              si,
              sj,
              ni: m.normal,
              point: m.point,
              ri: m.point.vsub(bi.position),
              rj: m.point.vsub(bj.position),
              penetration: m.depth,
              cacheKey,
              localA: invQuatI.vmult(m.point.vsub(bi.position), new Vec3()),
              jn: 0,
              jt1: 0,
              jt2: 0,
              jbn: 0,
            };
            if (cached) {
              for (const c of cached) {
                if (c.used) continue;
                const world = bi.quaternion.vmult(c.localA, new Vec3());
                world.x += bi.position.x;
                world.y += bi.position.y;
                world.z += bi.position.z;
                if (world.distanceSquared(m.point) < WARM_START_TOLERANCE_SQ) {
                  entry.jn = c.jn;
                  entry.jt1 = c.jt1;
                  entry.jt2 = c.jt2;
                  c.used = true;
                  break;
                }
              }
            }
            contacts.push(entry);
          }
        }
      }
      if (pairTouched) {
        maybeWake(bi, bj);
        maybeWake(bj, bi);
        touching.set(bodyPairKey(bi, bj), [bi, bj]);
      }
    }
    for (const [key, pr] of this.touchingPairs) {
      if (touching.has(key)) continue;
      if (pr[0].isSleeping()) pr[0].wakeUp();
      if (pr[1].isSleeping()) pr[1].wakeUp();
    }
    this.touchingPairs = touching;
    this.contacts = contacts;
    return contacts;
  }

  integrateForces(h) {
    const dw = new Vec3();
    for (const body of this.bodies) {
      if (body.type !== Body.DYNAMIC || body.isSleeping()) continue;
      if (body.invMass > 0) {
        body.velocity.x += (this.gravity.x + body.force.x * body.invMass) * h;
        body.velocity.y += (this.gravity.y + body.force.y * body.invMass) * h;
        body.velocity.z += (this.gravity.z + body.force.z * body.invMass) * h;
        body.invInertiaWorld.vmult(body.torque, dw);
        body.angularVelocity.addScaled(h, dw);
      }
      if (body.linearDamping > 0) {
        body.velocity.scale(Math.pow(1 - body.linearDamping, h), body.velocity);
      }
      if (body.angularDamping > 0) {
        body.angularVelocity.scale(Math.pow(1 - body.angularDamping, h), body.angularVelocity);
      }
    }
  }

  prepareContactRows(contactPoints, h) {
    const rows = [];
    const rel = new Vec3();
    const restitutionThreshold = Math.max(RESTITUTION_THRESHOLD, 2 * this.gravity.length() * h);
    for (const p of contactPoints) {
      if (!p.si.collisionResponse || !p.sj.collisionResponse) continue;
      const awakeA = p.bi.type === Body.DYNAMIC && !p.bi.isSleeping();
      const awakeB = p.bj.type === Body.DYNAMIC && !p.bj.isSleeping();
      if (!awakeA && !awakeB) continue;
      p.imA = awakeA ? p.bi.invMass : 0;
      p.imB = awakeB ? p.bj.invMass : 0;
      p.IiA = awakeA ? p.bi.invInertiaWorld : ZERO_MAT;
      p.IiB = awakeB ? p.bj.invInertiaWorld : ZERO_MAT;
      p.t1 = new Vec3();
      p.t2 = new Vec3();
      buildTangents(p.ni, p.t1, p.t2);
      p.massN = effectiveMass(p, p.ni);
      if (p.massN === 0) continue;
      p.massT1 = effectiveMass(p, p.t1);
      p.massT2 = effectiveMass(p, p.t2);
      p.bias = Math.min(
        MAX_CORRECTIVE_VELOCITY,
        (CONTACT_BETA / h) * Math.max(0, p.penetration - CONTACT_SLOP),
      );
      relativeVelocity(p, rel);
      const vn = rel.dot(p.ni);
      const cm = this.getContactMaterial(p.bi.material, p.bj.material) || this.defaultContactMaterial;
      p.friction = Math.max(0, cm.friction);
      p.restitutionBias = vn < -restitutionThreshold ? -cm.restitution * vn : 0;
      rows.push(p);
    }
    return rows;
  }

  solveRow(row) {
    const rel = relativeVelocity(row, new Vec3());
    const vn = rel.dot(row.ni);
    let dn = row.massN * (row.restitutionBias - vn);
    const jnNext = Math.max(0, row.jn + dn);
    dn = jnNext - row.jn;
    row.jn = jnNext;
    if (dn !== 0) {
      applyRowImpulse(row, row.ni.scale(dn, new Vec3()));
    }

    const maxFriction = row.friction * row.jn;
    if (maxFriction <= 0) {
      if (row.jt1 !== 0 || row.jt2 !== 0) {
        applyRowImpulse(row, new Vec3(
          -(row.t1.x * row.jt1 + row.t2.x * row.jt2),
          -(row.t1.y * row.jt1 + row.t2.y * row.jt2),
          -(row.t1.z * row.jt1 + row.t2.z * row.jt2),
        ));
        row.jt1 = 0;
        row.jt2 = 0;
      }
      return;
    }
    if (row.massT1 > 0) {
      relativeVelocity(row, rel);
      let d1 = -row.massT1 * rel.dot(row.t1);
      const j1 = Math.max(-maxFriction, Math.min(maxFriction, row.jt1 + d1));
      d1 = j1 - row.jt1;
      row.jt1 = j1;
      if (d1 !== 0) {
        applyRowImpulse(row, row.t1.scale(d1, new Vec3()));
      }
    }
    if (row.massT2 > 0) {
      relativeVelocity(row, rel);
      let d2 = -row.massT2 * rel.dot(row.t2);
      const j2 = Math.max(-maxFriction, Math.min(maxFriction, row.jt2 + d2));
      d2 = j2 - row.jt2;
      row.jt2 = j2;
      if (d2 !== 0) {
        applyRowImpulse(row, row.t2.scale(d2, new Vec3()));
      }
    }
  }


  solveRowPosition(row) {
    if (row.bias <= 0 && row.jbn === 0) return;
    const rel = relativePseudoVelocity(row, new Vec3());
    const vn = rel.dot(row.ni);
    let db = row.massN * (row.bias - vn);
    const next = Math.max(0, row.jbn + db);
    db = next - row.jbn;
    row.jbn = next;
    if (db !== 0) {
      applyRowPseudoImpulse(row, row.ni.scale(db, new Vec3()));
    }
  }

  storeManifolds(rows) {
    const cache = new Map();
    for (const row of rows) {
      if (row.jn === 0 && row.jt1 === 0 && row.jt2 === 0) continue;
      let list = cache.get(row.cacheKey);
      if (!list) {
        list = [];
        cache.set(row.cacheKey, list);
      }
      list.push({ localA: row.localA, jn: row.jn, jt1: row.jt1, jt2: row.jt2 });
    }
    this.manifoldCache = cache;
  }

  integratePositions(h) {
    const wTotal = new Vec3();
    for (const body of this.bodies) {
      const kinematic = body.type === Body.KINEMATIC;
      if ((body.type !== Body.DYNAMIC && !kinematic) || body.isSleeping()) continue;
      if (!body.velocity.isFiniteVec()) body.velocity.set(0, 0, 0);
      if (!body.angularVelocity.isFiniteVec()) body.angularVelocity.set(0, 0, 0);
      if (!body.position.isFiniteVec()) {
        if (body.aabbPos.isFiniteVec()) body.position.copy(body.aabbPos);
        else body.position.set(0, 0, 0);
        body.velocity.set(0, 0, 0);
      }


      const q = body.quaternion;
      if (!Number.isFinite(q.x + q.y + q.z + q.w)) {
        const aq = body.aabbQuat;
        if (aq && Number.isFinite(aq.x + aq.y + aq.z + aq.w)) q.copy(aq);
        else q.set(0, 0, 0, 1);
        body.angularVelocity.set(0, 0, 0);
      }
      if (!body.pseudoVelocity.isFiniteVec()) body.pseudoVelocity.set(0, 0, 0);
      if (!body.pseudoAngularVelocity.isFiniteVec()) body.pseudoAngularVelocity.set(0, 0, 0);
      body.position.addScaled(h, body.velocity);
      body.position.addScaled(h, body.pseudoVelocity);
      wTotal.set(
        body.angularVelocity.x + body.pseudoAngularVelocity.x,
        body.angularVelocity.y + body.pseudoAngularVelocity.y,
        body.angularVelocity.z + body.pseudoAngularVelocity.z,
      );
      body.quaternion.integrate(wTotal, h);
      body.pseudoVelocity.set(0, 0, 0);
      body.pseudoAngularVelocity.set(0, 0, 0);
      body.updateInertiaWorld();
      body.aabbNeedsUpdate = true;
      body.updateSleep(h);
    }
  }
}
