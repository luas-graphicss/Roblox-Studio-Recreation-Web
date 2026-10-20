import {
  sanitizeVec,
  sanitizeNum,
  clampMagnitude,
  eulerDegToQuat,
  quatMultiply,
  quatConjugate,
  rotateVecByQuat,
  vecLength,
} from "./mathUtils.js";

const MAX_FORCE = 1e9;
const MAX_ERRORS_PER_RECORD = 10;
const DEG = Math.PI / 180;

const CONSTRAINT_CLASSES = new Set([
  "HingeConstraint",
  "RopeConstraint",
  "SpringConstraint",
  "PrismaticConstraint",
  "BallSocketConstraint",
]);

const MOVER_CLASSES = new Set([
  "BodyVelocity",
  "BodyAngularVelocity",
  "BodyForce",
  "BodyThrust",
  "BodyPosition",
  "BodyGyro",
  "LinearVelocity",
  "AngularVelocity",
  "VectorForce",
  "Torque",
  "AlignPosition",
  "AlignOrientation",
]);

function num(inst, prop, fb) {
  if (!inst.hasProperty(prop)) return fb;
  return sanitizeNum(inst.getProperty(prop), fb);
}

function vec(inst, prop) {
  return sanitizeVec(inst.hasProperty(prop) ? inst.getProperty(prop) : null);
}

function boolProp(inst, prop, fb) {
  if (!inst.hasProperty(prop)) return fb;
  const v = inst.getProperty(prop);
  return typeof v === "boolean" ? v : fb;
}

function alive(inst) {
  return inst && inst.__isInstance === true &&
    (typeof inst.isDestroyed !== "function" || !inst.isDestroyed());
}

function isAttachment(inst) {
  return alive(inst) && inst.className === "Attachment";
}


function quatToAxisAngleVec(q) {
  let w = q.w;
  let x = q.x, y = q.y, z = q.z;
  if (w < 0) { w = -w; x = -x; y = -y; z = -z; }
  const s = Math.sqrt(Math.max(0, 1 - w * w));
  if (s < 1e-6) return { x: 0, y: 0, z: 0 };
  const angle = 2 * Math.acos(Math.min(1, w));
  return { x: (x / s) * angle, y: (y / s) * angle, z: (z / s) * angle };
}

export function createConstraintController(opts) {
  const ENGINE = opts.ENGINE;
  const world = opts.world;
  const logger = opts.logger || null;
  const getPartInfo = opts.getPartInfo;                                                         
  const maxConstraints = opts.maxConstraints || 10000;

  let records = [];
  let movers = [];
  let warnedLimit = false;
  let warnedMoverLimit = false;

  function warn(msg) {
    if (logger && logger.warn) logger.warn(`[F\u00edsica] ${msg}`);
  }


  function attachmentPivot(att, info) {
    const local = vec(att, "Position");
    const r = rotateVecByQuat(local, info.localQuat);
    return {
      x: info.localOffset.x + r.x,
      y: info.localOffset.y + r.y,
      z: info.localOffset.z + r.z,
    };
  }


  function attachmentAxis(att, info, base) {
    const o = vec(att, "Orientation");
    const qAtt = eulerDegToQuat(o.x, o.y, o.z);
    const axisPart = rotateVecByQuat(base, qAtt);
    return rotateVecByQuat(axisPart, info.localQuat);
  }


  function moverFrameQuat(inst, body, ownInfo) {
    const rel = inst.hasProperty && inst.hasProperty("RelativeTo") ? String(inst.getProperty("RelativeTo") || "World") : "World";
    if (rel !== "Attachment0" && rel !== "Attachment1") return null;
    const att = inst.getProperty(rel);
    if (isAttachment(att)) {
      const p = att.getParent ? att.getParent() : null;
      const info = alive(p) ? getPartInfo(p) : null;
      if (info) {
        const o = vec(att, "Orientation");
        const qAtt = eulerDegToQuat(o.x, o.y, o.z);
        return quatMultiply(info.body.quaternion, quatMultiply(info.localQuat, qAtt));
      }
    }


    if (rel === "Attachment0") {
      return ownInfo ? quatMultiply(body.quaternion, ownInfo.localQuat) : body.quaternion;
    }
    return null;
  }

  function resolveEnds(inst) {
    const a0 = inst.getProperty("Attachment0");
    const a1 = inst.getProperty("Attachment1");
    if (!isAttachment(a0) || !isAttachment(a1)) return null;
    const p0 = a0.getParent ? a0.getParent() : null;
    const p1 = a1.getParent ? a1.getParent() : null;
    if (!alive(p0) || !alive(p1)) return null;
    const i0 = getPartInfo(p0);
    const i1 = getPartInfo(p1);
    if (!i0 || !i1) return null;
    if (i0.body === i1.body) return null;                                
    return { a0, a1, i0, i1 };
  }

  function clear() {
    for (const rec of records) {
      if (rec.native) {
        try { world.removeConstraint(rec.native); } catch (_e) {                   }
      }
    }
    records = [];
    movers = [];
  }


  function build(descendants) {
    clear();
    for (const inst of descendants) {
      if (!alive(inst)) continue;
      const cls = inst.className;
      if (CONSTRAINT_CLASSES.has(cls)) {
        if (records.length >= maxConstraints) {
          if (!warnedLimit) {
            warnedLimit = true;
            warn(`Limite de ${maxConstraints} constraints ativas atingido; extras ignoradas.`);
          }
          continue;
        }
        if (!boolProp(inst, "Enabled", true)) continue;
        const ends = resolveEnds(inst);
        if (!ends) continue;
        const rec = makeRecord(inst, cls, ends);
        if (rec) records.push(rec);
      } else if (MOVER_CLASSES.has(cls)) {


        if (movers.length >= maxConstraints) {
          if (!warnedMoverLimit) {
            warnedMoverLimit = true;
            warn(`Limite de ${maxConstraints} body movers ativos atingido; extras ignorados.`);
          }
          continue;
        }
        const part = inst.getParent ? inst.getParent() : null;
        if (!alive(part) || !getPartInfo(part)) continue;
        movers.push({ inst, part, errors: 0 });
      }
    }
  }

  function makeRecord(inst, cls, ends) {
    const { a0, a1, i0, i1 } = ends;
    const pivotA = attachmentPivot(a0, i0);
    const pivotB = attachmentPivot(a1, i1);
    const axisA = attachmentAxis(a0, i0, { x: 1, y: 0, z: 0 });
    const axisB = attachmentAxis(a1, i1, { x: 1, y: 0, z: 0 });
    const refA = attachmentAxis(a0, i0, { x: 0, y: 1, z: 0 });
    const refB = attachmentAxis(a1, i1, { x: 0, y: 1, z: 0 });
    const rec = {
      inst, cls, a0, a1,
      bodyA: i0.body, bodyB: i1.body,
      pivotA, pivotB, axisA, axisB, refA, refB,
      native: null, spring: null, errors: 0, state: {},
    };
    try {
      if (cls === "HingeConstraint") {


        rec.native = new ENGINE.HingeConstraint(rec.bodyA, rec.bodyB, {
          pivotA: new ENGINE.Vec3(pivotA.x, pivotA.y, pivotA.z),
          pivotB: new ENGINE.Vec3(pivotB.x, pivotB.y, pivotB.z),
          axisA: new ENGINE.Vec3(axisA.x, axisA.y, axisA.z),
          axisB: new ENGINE.Vec3(axisB.x, axisB.y, axisB.z),
          refA: new ENGINE.Vec3(refA.x, refA.y, refA.z),
          refB: new ENGINE.Vec3(refB.x, refB.y, refB.z),
          collideConnected: false,
          maxForce: 1e7,
        });
        world.addConstraint(rec.native);
      } else if (cls === "BallSocketConstraint") {


        rec.native = new ENGINE.BallSocketConstraint(
          rec.bodyA, new ENGINE.Vec3(pivotA.x, pivotA.y, pivotA.z),
          rec.bodyB, new ENGINE.Vec3(pivotB.x, pivotB.y, pivotB.z),
          {
            axisA: new ENGINE.Vec3(axisA.x, axisA.y, axisA.z),
            axisB: new ENGINE.Vec3(axisB.x, axisB.y, axisB.z),
            refA: new ENGINE.Vec3(refA.x, refA.y, refA.z),
            refB: new ENGINE.Vec3(refB.x, refB.y, refB.z),
            maxForce: 1e7,
            collideConnected: false,
          },
        );
        world.addConstraint(rec.native);
      } else if (cls === "SpringConstraint") {
        rec.spring = new ENGINE.Spring(rec.bodyA, rec.bodyB, {
          localAnchorA: new ENGINE.Vec3(pivotA.x, pivotA.y, pivotA.z),
          localAnchorB: new ENGINE.Vec3(pivotB.x, pivotB.y, pivotB.z),
          restLength: Math.max(0, num(inst, "FreeLength", 4)),
          stiffness: Math.min(1e6, Math.max(0, num(inst, "Stiffness", 100))),
          damping: Math.min(1e5, Math.max(0, num(inst, "Damping", 5))),
        });
      } else if (cls === "RopeConstraint") {


        rec.native = new ENGINE.RopeConstraint(
          rec.bodyA, new ENGINE.Vec3(pivotA.x, pivotA.y, pivotA.z),
          rec.bodyB, new ENGINE.Vec3(pivotB.x, pivotB.y, pivotB.z),
          {
            length: Math.max(0, num(inst, "Length", 4)),
            maxForce: 1e7,
            collideConnected: true,
          },
        );
        world.addConstraint(rec.native);
      } else if (cls === "PrismaticConstraint") {


        rec.native = new ENGINE.PrismaticConstraint(rec.bodyA, rec.bodyB, {
          pivotA: new ENGINE.Vec3(pivotA.x, pivotA.y, pivotA.z),
          pivotB: new ENGINE.Vec3(pivotB.x, pivotB.y, pivotB.z),
          axisA: new ENGINE.Vec3(axisA.x, axisA.y, axisA.z),
          axisB: new ENGINE.Vec3(axisB.x, axisB.y, axisB.z),
          refA: new ENGINE.Vec3(refA.x, refA.y, refA.z),
          refB: new ENGINE.Vec3(refB.x, refB.y, refB.z),
          maxForce: 1e7,
          collideConnected: false,
        });
        world.addConstraint(rec.native);
      }
    } catch (e) {
      warn(`Falha ao criar ${cls} "${inst.name}": ${e && e.message ? e.message : e}`);
      return null;
    }
    return rec;
  }


  function anchorsWorld(rec) {
    const wA = rec.bodyA.position.vadd(
      rotateByQuat(rec.pivotA, rec.bodyA.quaternion),
    );
    const wB = rec.bodyB.position.vadd(
      rotateByQuat(rec.pivotB, rec.bodyB.quaternion),
    );
    return { wA, wB };
  }

  function rotateByQuat(v, q) {
    const r = rotateVecByQuat(v, q);
    return new ENGINE.Vec3(r.x, r.y, r.z);
  }

  function invMass(body) {
    return body.type === ENGINE.Body.DYNAMIC ? body.invMass : 0;
  }


  function distanceCorrect(rec, wA, wB, n, excess) {
    const imA = invMass(rec.bodyA);
    const imB = invMass(rec.bodyB);
    const imSum = imA + imB;
    if (imSum <= 0) return;

    const vA = rec.bodyA.getVelocityAtWorldPoint(wA, new ENGINE.Vec3());
    const vB = rec.bodyB.getVelocityAtWorldPoint(wB, new ENGINE.Vec3());
    const vrel = (vB.x - vA.x) * n.x + (vB.y - vA.y) * n.y + (vB.z - vA.z) * n.z;
    if (vrel > 0) {
      const j = vrel / imSum;
      const imp = new ENGINE.Vec3(n.x * j, n.y * j, n.z * j);
      if (imB > 0) rec.bodyB.applyImpulse(imp.negate(new ENGINE.Vec3()), wB);
      if (imA > 0) rec.bodyA.applyImpulse(imp, wA);
    }

    const corr = Math.min(excess, 2) * 0.4;
    if (imB > 0) {
      const s = corr * (imB / imSum);
      rec.bodyB.position.x -= n.x * s;
      rec.bodyB.position.y -= n.y * s;
      rec.bodyB.position.z -= n.z * s;
    }
    if (imA > 0) {
      const s = corr * (imA / imSum);
      rec.bodyA.position.x += n.x * s;
      rec.bodyA.position.y += n.y * s;
      rec.bodyA.position.z += n.z * s;
    }
    rec.bodyA.wakeUp();
    rec.bodyB.wakeUp();
  }


  function hingeAngle(rec) {
    const axisW = rotateVecByQuat(rec.axisA, rec.bodyA.quaternion);
    const rA = rotateVecByQuat(rec.refA, rec.bodyA.quaternion);
    const rB = rotateVecByQuat(rec.refB, rec.bodyB.quaternion);

    const dA = rA.x * axisW.x + rA.y * axisW.y + rA.z * axisW.z;
    const dB = rB.x * axisW.x + rB.y * axisW.y + rB.z * axisW.z;
    const pA = { x: rA.x - axisW.x * dA, y: rA.y - axisW.y * dA, z: rA.z - axisW.z * dA };
    const pB = { x: rB.x - axisW.x * dB, y: rB.y - axisW.y * dB, z: rB.z - axisW.z * dB };
    const cross = {
      x: pA.y * pB.z - pA.z * pB.y,
      y: pA.z * pB.x - pA.x * pB.z,
      z: pA.x * pB.y - pA.y * pB.x,
    };
    const sin = cross.x * axisW.x + cross.y * axisW.y + cross.z * axisW.z;
    const cos = pA.x * pB.x + pA.y * pB.y + pA.z * pB.z;
    return Math.atan2(sin, cos);
  }

  function stepHinge(rec) {
    const inst = rec.inst;
    const c = rec.native;


    c.setLimits(
      boolProp(inst, "LimitsEnabled", false),
      Math.max(-180, Math.min(180, num(inst, "LowerAngle", -45))) * DEG,
      Math.max(-180, Math.min(180, num(inst, "UpperAngle", 45))) * DEG,
    );
    const actuator = inst.hasProperty("ActuatorType") ? inst.getProperty("ActuatorType") : "None";
    if (actuator === "Motor") {
      c.enableMotor();
      c.setMotorSpeed(Math.max(-100, Math.min(100, num(inst, "AngularVelocity", 0))));
      c.setMotorMaxForce(Math.min(MAX_FORCE, Math.max(0, num(inst, "MotorMaxTorque", 10000))));
      rec.bodyA.wakeUp(); rec.bodyB.wakeUp();
    } else if (actuator === "Servo") {
      const target = num(inst, "TargetAngle", 0) * DEG;
      const err = target - hingeAngle(rec);
      c.enableMotor();
      c.setMotorSpeed(Math.max(-10, Math.min(10, err * 6)));
      c.setMotorMaxForce(Math.min(MAX_FORCE, Math.max(0, num(inst, "ServoMaxTorque", 10000))));
      rec.bodyA.wakeUp(); rec.bodyB.wakeUp();
    } else {
      c.disableMotor();
    }
  }


  function stepRope(rec) {
    rec.native.setLength(Math.max(0, num(rec.inst, "Length", 4)));
    rec.native.setRestitution(Math.max(0, Math.min(1, num(rec.inst, "Restitution", 0))));
  }

  function stepSpring(rec) {


    rec.spring.applyForce();

    const minL = Math.max(0, num(rec.inst, "MinLength", 0));
    const maxL = Math.max(minL, num(rec.inst, "MaxLength", 20));
    const { wA, wB } = anchorsWorld(rec);
    const d = wB.vsub(wA);
    const dist = d.length();
    if (dist < 1e-6) return;
    const n = { x: d.x / dist, y: d.y / dist, z: d.z / dist };
    if (dist > maxL) {
      distanceCorrect(rec, wA, wB, n, dist - maxL);
    } else if (dist < minL) {
      distanceCorrect(rec, wA, wB, { x: -n.x, y: -n.y, z: -n.z }, minL - dist);
    }
  }


  function stepBallSocket(rec) {
    const inst = rec.inst;
    const c = rec.native;
    c.setConeLimit(
      boolProp(inst, "LimitsEnabled", false),
      Math.max(0, Math.min(180, num(inst, "UpperAngle", 45))) * DEG,
    );
    c.setTwistLimit(
      boolProp(inst, "TwistLimitsEnabled", false),
      Math.max(-180, Math.min(180, num(inst, "TwistLowerAngle", -45))) * DEG,
      Math.max(-180, Math.min(180, num(inst, "TwistUpperAngle", 45))) * DEG,
    );
  }


  function stepPrismatic(rec) {
    const inst = rec.inst;
    const c = rec.native;
    c.setLimits(
      boolProp(inst, "LimitsEnabled", false),
      num(inst, "LowerLimit", -5),
      num(inst, "UpperLimit", 5),
    );
    const actuator = inst.hasProperty("ActuatorType") ? inst.getProperty("ActuatorType") : "None";
    if (actuator === "Motor") {
      c.enableMotor();
      c.setMotorSpeed(Math.max(-200, Math.min(200, num(inst, "Velocity", 0))));
      c.setMotorMaxForce(Math.min(MAX_FORCE, Math.max(0, num(inst, "MotorMaxForce", 10000))));
      rec.bodyA.wakeUp(); rec.bodyB.wakeUp();
    } else if (actuator === "Servo") {

      const err = num(inst, "TargetPosition", 0) - c.getTranslation();
      c.enableMotor();
      c.setMotorSpeed(Math.max(-30, Math.min(30, err * 4)));
      c.setMotorMaxForce(Math.min(MAX_FORCE, Math.max(0, num(inst, "ServoMaxForce", 10000))));
      rec.bodyA.wakeUp(); rec.bodyB.wakeUp();
    } else {
      c.disableMotor();
    }
  }


  function clampAxis(v, lim) {
    const l = Math.abs(sanitizeNum(lim, MAX_FORCE));
    return Math.max(-l, Math.min(l, sanitizeNum(v, 0)));
  }

  function applyMover(m, h) {
    const inst = m.inst;
    const info = getPartInfo(m.part);
    if (!info || !alive(inst) || !alive(m.part)) return;
    const body = info.body;
    if (body.type !== ENGINE.Body.DYNAMIC) return;
    const cls = inst.className;
    if (inst.hasProperty("Enabled") && inst.getProperty("Enabled") === false) return;
    const mass = Math.max(0.001, body.mass);

    if (cls === "BodyForce" || cls === "VectorForce") {
      let f = clampMagnitude(vec(inst, "Force"), MAX_FORCE);

      if (cls === "VectorForce") {
        const q = moverFrameQuat(inst, body, info);
        if (q) f = rotateVecByQuat(f, q);
      }
      body.applyForce(new ENGINE.Vec3(f.x, f.y, f.z), body.position);
      if (vecLength(f) > 0.001) body.wakeUp();
    } else if (cls === "BodyThrust") {
      const f = clampMagnitude(vec(inst, "Force"), MAX_FORCE);
      const loc = vec(inst, "Location");




      const locInBody = rotateVecByQuat(loc, info.localQuat);
      const localInBody = {
        x: info.localOffset.x + locInBody.x,
        y: info.localOffset.y + locInBody.y,
        z: info.localOffset.z + locInBody.z,
      };
      const wOff = rotateVecByQuat(localInBody, body.quaternion);
      const wp = new ENGINE.Vec3(
        body.position.x + wOff.x,
        body.position.y + wOff.y,
        body.position.z + wOff.z,
      );
      body.applyForce(new ENGINE.Vec3(f.x, f.y, f.z), wp);
      if (vecLength(f) > 0.001) body.wakeUp();
    } else if (cls === "Torque") {
      const t = clampMagnitude(vec(inst, "Torque"), MAX_FORCE);
      body.torque.x += t.x;
      body.torque.y += t.y;
      body.torque.z += t.z;
      if (vecLength(t) > 0.001) body.wakeUp();
    } else if (cls === "BodyVelocity" || cls === "LinearVelocity") {
      let target = vec(inst, cls === "BodyVelocity" ? "Velocity" : "VectorVelocity");

      if (cls === "LinearVelocity") {
        const q = moverFrameQuat(inst, body, info);
        if (q) target = rotateVecByQuat(target, q);
      }
      const gain = mass * 10;
      let fx = (target.x - body.velocity.x) * gain;
      let fy = (target.y - body.velocity.y) * gain;
      let fz = (target.z - body.velocity.z) * gain;
      if (cls === "BodyVelocity") {
        const mf = vec(inst, "MaxForce");
        fx = clampAxis(fx, mf.x); fy = clampAxis(fy, mf.y); fz = clampAxis(fz, mf.z);
      } else {
        const f = clampMagnitude({ x: fx, y: fy, z: fz }, Math.min(MAX_FORCE, Math.abs(num(inst, "MaxForce", 100000))));
        fx = f.x; fy = f.y; fz = f.z;
      }
      body.applyForce(new ENGINE.Vec3(fx, fy, fz), body.position);
      body.wakeUp();
    } else if (cls === "BodyAngularVelocity" || cls === "AngularVelocity") {
      const target = vec(inst, "AngularVelocity");
      const gain = mass * 4;
      let tx = (target.x - body.angularVelocity.x) * gain;
      let ty = (target.y - body.angularVelocity.y) * gain;
      let tz = (target.z - body.angularVelocity.z) * gain;
      if (cls === "BodyAngularVelocity") {
        const mt = vec(inst, "MaxTorque");
        tx = clampAxis(tx, mt.x); ty = clampAxis(ty, mt.y); tz = clampAxis(tz, mt.z);
      } else {
        const t = clampMagnitude({ x: tx, y: ty, z: tz }, Math.min(MAX_FORCE, Math.abs(num(inst, "MaxTorque", 100000))));
        tx = t.x; ty = t.y; tz = t.z;
      }
      body.torque.x += tx; body.torque.y += ty; body.torque.z += tz;
      body.wakeUp();
    } else if (cls === "BodyPosition" || cls === "AlignPosition") {
      const target = vec(inst, "Position");


      if (cls === "AlignPosition" && boolProp(inst, "RigidityEnabled", false)) {
        const maxV = Math.min(1e6, Math.max(0, num(inst, "MaxVelocity", 1e6)));
        const v = clampMagnitude({
          x: (target.x - body.position.x) / h,
          y: (target.y - body.position.y) / h,
          z: (target.z - body.position.z) / h,
        }, maxV);
        body.velocity.x = v.x; body.velocity.y = v.y; body.velocity.z = v.z;
        body.wakeUp();
        return;
      }
      let kp;
      let kd;
      if (cls === "BodyPosition") {
        kp = Math.min(1e6, Math.max(0, num(inst, "P", 10000))) / 1000;
        kd = Math.min(1e6, Math.max(0, num(inst, "D", 1250))) / 250;
      } else {
        const resp = Math.min(200, Math.max(0, num(inst, "Responsiveness", 10)));
        kp = resp;
        kd = Math.sqrt(Math.max(0.01, resp)) * 2;
      }
      let fx = ((target.x - body.position.x) * kp - body.velocity.x * kd) * mass;
      let fy = ((target.y - body.position.y) * kp - body.velocity.y * kd) * mass;
      let fz = ((target.z - body.position.z) * kp - body.velocity.z * kd) * mass;
      if (cls === "BodyPosition") {
        const mf = vec(inst, "MaxForce");
        fx = clampAxis(fx, mf.x); fy = clampAxis(fy, mf.y); fz = clampAxis(fz, mf.z);
      } else {
        const f = clampMagnitude({ x: fx, y: fy, z: fz }, Math.min(MAX_FORCE, Math.abs(num(inst, "MaxForce", 100000))));
        fx = f.x; fy = f.y; fz = f.z;
      }
      body.applyForce(new ENGINE.Vec3(fx, fy, fz), body.position);

      if (cls === "AlignPosition") {
        const maxV = Math.min(1e6, Math.max(0, num(inst, "MaxVelocity", 1e6)));
        if (maxV < 1e6) {
          const cv = clampMagnitude({ x: body.velocity.x, y: body.velocity.y, z: body.velocity.z }, maxV);
          body.velocity.x = cv.x; body.velocity.y = cv.y; body.velocity.z = cv.z;
        }
      }
      body.wakeUp();
    } else if (cls === "BodyGyro" || cls === "AlignOrientation") {

      const o = vec(inst, "Orientation");
      const qT = eulerDegToQuat(o.x, o.y, o.z);
      const qErr = quatMultiply(qT, quatConjugate(body.quaternion));
      const errVec = quatToAxisAngleVec(qErr);


      if (cls === "AlignOrientation" && boolProp(inst, "RigidityEnabled", false)) {
        const maxW = Math.min(1e6, Math.max(0, num(inst, "MaxAngularVelocity", 1e6)));
        const w = clampMagnitude({ x: errVec.x / h, y: errVec.y / h, z: errVec.z / h }, maxW);
        body.angularVelocity.x = w.x; body.angularVelocity.y = w.y; body.angularVelocity.z = w.z;
        body.wakeUp();
        return;
      }
      let kp;
      let kd;
      if (cls === "BodyGyro") {
        kp = Math.min(1e6, Math.max(0, num(inst, "P", 3000))) / 300;
        kd = Math.min(1e6, Math.max(0, num(inst, "D", 500))) / 100;
      } else {
        const resp = Math.min(200, Math.max(0, num(inst, "Responsiveness", 10)));
        kp = resp;
        kd = Math.sqrt(Math.max(0.01, resp)) * 2;
      }
      let tx = (errVec.x * kp - body.angularVelocity.x * kd) * mass;
      let ty = (errVec.y * kp - body.angularVelocity.y * kd) * mass;
      let tz = (errVec.z * kp - body.angularVelocity.z * kd) * mass;
      if (cls === "BodyGyro") {
        const mt = vec(inst, "MaxTorque");
        tx = clampAxis(tx, mt.x); ty = clampAxis(ty, mt.y); tz = clampAxis(tz, mt.z);
      } else {
        const t = clampMagnitude({ x: tx, y: ty, z: tz }, Math.min(MAX_FORCE, Math.abs(num(inst, "MaxTorque", 100000))));
        tx = t.x; ty = t.y; tz = t.z;
      }
      body.torque.x += tx; body.torque.y += ty; body.torque.z += tz;

      if (cls === "AlignOrientation") {
        const maxW = Math.min(1e6, Math.max(0, num(inst, "MaxAngularVelocity", 1e6)));
        if (maxW < 1e6) {
          const cw = clampMagnitude({ x: body.angularVelocity.x, y: body.angularVelocity.y, z: body.angularVelocity.z }, maxW);
          body.angularVelocity.x = cw.x; body.angularVelocity.y = cw.y; body.angularVelocity.z = cw.z;
        }
      }
      body.wakeUp();
    }
  }


  function preStep(h) {
    for (const rec of records) {
      if (rec.broken) continue;

      if (!alive(rec.inst) || !alive(rec.a0) || !alive(rec.a1) ||
        !boolProp(rec.inst, "Enabled", true)) {
        rec.broken = true;
        if (rec.native) {
          try { world.removeConstraint(rec.native); } catch (_e) {          }
          rec.native = null;
        }
        continue;
      }
      try {
        if (rec.cls === "HingeConstraint") stepHinge(rec);
        else if (rec.cls === "RopeConstraint") stepRope(rec);
        else if (rec.cls === "SpringConstraint") stepSpring(rec);
        else if (rec.cls === "BallSocketConstraint") stepBallSocket(rec);
        else if (rec.cls === "PrismaticConstraint") stepPrismatic(rec);
      } catch (e) {
        rec.errors += 1;
        if (rec.errors >= MAX_ERRORS_PER_RECORD) {
          rec.broken = true;
          warn(`${rec.cls} "${rec.inst.name}" desativada ap\u00f3s erros repetidos.`);
        }
      }
    }
    for (const m of movers) {
      if (m.errors >= MAX_ERRORS_PER_RECORD) continue;
      try {
        applyMover(m, h);
      } catch (_e) {
        m.errors += 1;
      }
    }
  }

  function count() {
    return records.filter((r) => !r.broken).length;
  }


  function getState(inst) {
    if (!inst || inst.className !== "HingeConstraint") return null;
    for (const rec of records) {
      if (rec.inst !== inst || rec.broken) continue;
      if (!rec.bodyA || !rec.bodyB || !rec.axisA) return null;
      const axisW = rotateVecByQuat(rec.axisA, rec.bodyA.quaternion);
      const dw = {
        x: rec.bodyB.angularVelocity.x - rec.bodyA.angularVelocity.x,
        y: rec.bodyB.angularVelocity.y - rec.bodyA.angularVelocity.y,
        z: rec.bodyB.angularVelocity.z - rec.bodyA.angularVelocity.z,
      };
      return {
        currentAngle: hingeAngle(rec) / DEG,
        angularSpeed: dw.x * axisW.x + dw.y * axisW.y + dw.z * axisW.z,
      };
    }
    return null;
  }

  return { build, clear, preStep, count, getState };
}
