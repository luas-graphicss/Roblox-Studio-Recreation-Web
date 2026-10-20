import { Vec3, Mat3, Quaternion, setSkew, buildTangents } from "./math3d.js";
import { Body } from "./body.js";


const POSITION_SLOP = 1e-3;


const JOINT_WAKE_ERROR = 0.02;
const ANGULAR_SLOP = 0.5 * (Math.PI / 180);


const JOINT_WAKE_ANGLE = 0.05;
const MAX_LINEAR_CORRECTION = 0.2;
const MAX_ANGULAR_CORRECTION = 8 * (Math.PI / 180);
const ZERO_MAT = new Mat3().setZero();


function wrapPi(a) {
  let x = a % (2 * Math.PI);
  if (x > Math.PI) x -= 2 * Math.PI;
  else if (x < -Math.PI) x += 2 * Math.PI;
  return x;
}

function activeInvMass(body) {
  return body && body.type === Body.DYNAMIC && !body.isSleeping() ? body.invMass : 0;
}

function activeInvInertia(body) {
  return body && body.type === Body.DYNAMIC && !body.isSleeping() ? body.invInertiaWorld : ZERO_MAT;
}

function subtractSkewTerm(K, r, invInertia) {
  const S = setSkew(new Mat3(), r);
  const tmp = S.mmult(invInertia, new Mat3());
  const term = tmp.mmult(S, new Mat3());
  K.sub(term, K);
}


function integrateOrientationDelta(body, w) {
  const len = w.length();
  if (!Number.isFinite(len) || len < 1e-12) return;
  if (len > MAX_ANGULAR_CORRECTION) w.scale(MAX_ANGULAR_CORRECTION / len, w);
  body.quaternion.integrate(w, 1);
  body.updateInertiaWorld();
  body.aabbNeedsUpdate = true;
}

export class Constraint {
  constructor(bodyA, bodyB) {
    this.bodyA = bodyA || null;
    this.bodyB = bodyB || null;
    this.collideConnected = true;
    this.enabled = true;
  }

  initSolve(_h) {}

  solveIteration() {}


  solvePosition() {
    return true;
  }

  wantsWake() {
    return false;
  }
}

export class PointToPointConstraint extends Constraint {
  constructor(bodyA, pivotA, bodyB, pivotB, maxForce = 1e6) {
    super(bodyA, bodyB);
    this.pivotA = new Vec3();
    if (pivotA) this.pivotA.copy(pivotA);
    this.pivotB = new Vec3();
    if (pivotB) this.pivotB.copy(pivotB);
    const mf = Number(maxForce);
    this.maxForce = Number.isFinite(mf) && mf > 0 ? mf : 1e6;
    this.lambda = new Vec3();
    this.rA = new Vec3();
    this.rB = new Vec3();
    this.kInv = new Mat3();
    this.maxImpulse = 0;
    this.imA = 0;
    this.imB = 0;
    this.IiA = ZERO_MAT;
    this.IiB = ZERO_MAT;
  }

  applyAnchorImpulse(P) {
    const A = this.bodyA, B = this.bodyB;
    A.velocity.addScaled(-this.imA, P);
    const LA = this.rA.cross(P, new Vec3());
    A.angularVelocity.addScaled(-1, this.IiA.vmult(LA, LA));
    B.velocity.addScaled(this.imB, P);
    const LB = this.rB.cross(P, new Vec3());
    B.angularVelocity.addScaled(1, this.IiB.vmult(LB, LB));
  }

  initSolve(h) {
    const A = this.bodyA, B = this.bodyB;
    this.imA = activeInvMass(A);
    this.imB = activeInvMass(B);
    this.IiA = activeInvInertia(A);
    this.IiB = activeInvInertia(B);
    A.quaternion.vmult(this.pivotA, this.rA);
    B.quaternion.vmult(this.pivotB, this.rB);
    const K = new Mat3().setDiagonal(
      this.imA + this.imB,
      this.imA + this.imB,
      this.imA + this.imB,
    );
    subtractSkewTerm(K, this.rA, this.IiA);
    subtractSkewTerm(K, this.rB, this.IiB);
    K.invert(this.kInv);
    this.maxImpulse = this.maxForce * h;
    if (!this.lambda.almostZero(1e-12)) {
      this.applyAnchorImpulse(this.lambda);
    }
  }

  solveIteration() {
    if (this.imA === 0 && this.imB === 0) return;
    const A = this.bodyA, B = this.bodyB;
    const wA = A.angularVelocity, wB = B.angularVelocity;
    const vAx = A.velocity.x + wA.y * this.rA.z - wA.z * this.rA.y;
    const vAy = A.velocity.y + wA.z * this.rA.x - wA.x * this.rA.z;
    const vAz = A.velocity.z + wA.x * this.rA.y - wA.y * this.rA.x;
    const vBx = B.velocity.x + wB.y * this.rB.z - wB.z * this.rB.y;
    const vBy = B.velocity.y + wB.z * this.rB.x - wB.x * this.rB.z;
    const vBz = B.velocity.z + wB.x * this.rB.y - wB.y * this.rB.x;
    const rhs = new Vec3(-(vBx - vAx), -(vBy - vAy), -(vBz - vAz));
    const dl = this.kInv.vmult(rhs, new Vec3());
    const next = this.lambda.vadd(dl, new Vec3());
    const len = next.length();
    if (len > this.maxImpulse && len > 1e-12) {
      next.scale(this.maxImpulse / len, next);
    }
    next.vsub(this.lambda, dl);
    this.lambda.copy(next);
    if (!dl.almostZero(1e-12)) {
      this.applyAnchorImpulse(dl);
    }
  }


  solvePosition() {
    const A = this.bodyA, B = this.bodyB;
    const rA = A.quaternion.vmult(this.pivotA, new Vec3());
    const rB = B.quaternion.vmult(this.pivotB, new Vec3());
    const C = new Vec3(
      B.position.x + rB.x - (A.position.x + rA.x),
      B.position.y + rB.y - (A.position.y + rA.y),
      B.position.z + rB.z - (A.position.z + rA.z),
    );
    if (!C.isFiniteVec()) return true;
    const err = C.length();


    if (err > JOINT_WAKE_ERROR) {
      if (A.mass > 0 && A.isSleeping()) A.wakeUp();
      if (B.mass > 0 && B.isSleeping()) B.wakeUp();
    }
    const imA = activeInvMass(A);
    const imB = activeInvMass(B);
    if (imA === 0 && imB === 0) return true;
    const IiA = activeInvInertia(A);
    const IiB = activeInvInertia(B);
    if (err <= POSITION_SLOP) return true;
    if (err > MAX_LINEAR_CORRECTION) C.scale(MAX_LINEAR_CORRECTION / err, C);
    const K = new Mat3().setDiagonal(imA + imB, imA + imB, imA + imB);
    subtractSkewTerm(K, rA, IiA);
    subtractSkewTerm(K, rB, IiB);
    const P = K.invert(new Mat3()).vmult(C.negate(new Vec3()), new Vec3());
    if (!P.isFiniteVec() || P.almostZero(1e-12)) return true;
    if (imA > 0) {
      A.position.addScaled(-imA, P);
      const LA = rA.cross(P, new Vec3());
      integrateOrientationDelta(A, IiA.vmult(LA, LA).negate(new Vec3()));
      A.aabbNeedsUpdate = true;
    }
    if (imB > 0) {
      B.position.addScaled(imB, P);
      const LB = rB.cross(P, new Vec3());
      integrateOrientationDelta(B, IiB.vmult(LB, LB));
      B.aabbNeedsUpdate = true;
    }
    return false;
  }


  pivotError() {
    const A = this.bodyA, B = this.bodyB;
    if (!A || !B) return 0;
    const rA = A.quaternion.vmult(this.pivotA, new Vec3());
    const rB = B.quaternion.vmult(this.pivotB, new Vec3());
    const dx = B.position.x + rB.x - (A.position.x + rA.x);
    const dy = B.position.y + rB.y - (A.position.y + rA.y);
    const dz = B.position.z + rB.z - (A.position.z + rA.z);
    const err = Math.sqrt(dx * dx + dy * dy + dz * dz);
    return Number.isFinite(err) ? err : 0;
  }

  wantsWake() {
    return this.pivotError() > JOINT_WAKE_ERROR;
  }
}

export class HingeConstraint extends PointToPointConstraint {
  constructor(bodyA, bodyB, options = {}) {
    super(bodyA, options.pivotA, bodyB, options.pivotB, options.maxForce || 1e6);


    this.axisA = new Vec3(1, 0, 0);
    if (options.axisA) this.axisA.copy(options.axisA);
    this.axisA.normalize();
    if (this.axisA.almostZero(1e-9)) this.axisA.set(1, 0, 0);
    this.axisB = new Vec3(1, 0, 0);
    if (options.axisB) this.axisB.copy(options.axisB);
    this.axisB.normalize();
    if (this.axisB.almostZero(1e-9)) this.axisB.set(1, 0, 0);


    this.refA = new Vec3(0, 1, 0);
    if (options.refA) this.refA.copy(options.refA);
    this.refA.normalize();
    if (this.refA.almostZero(1e-9)) this.refA.set(0, 1, 0);
    this.refB = new Vec3(0, 1, 0);
    if (options.refB) this.refB.copy(options.refB);
    this.refB.normalize();
    if (this.refB.almostZero(1e-9)) this.refB.set(0, 1, 0);


    this.qAttA = attachmentFrameQuat(this.axisA, this.refA);
    this.qAttB = attachmentFrameQuat(this.axisB, this.refB);
    this.collideConnected = options.collideConnected !== false;
    this.motorEnabled = false;
    this.motorSpeed = 0;
    this.motorMaxForce = 1e6;
    this.lambdaAng1 = 0;
    this.lambdaAng2 = 0;
    this.lambdaMotor = 0;


    this.limitEnabled = false;
    this.lowerAngle = -Math.PI / 4;
    this.upperAngle = Math.PI / 4;
    this.lambdaLimit = 0;


    this.limitState = 0;

    this.stats = { limitActiveSteps: 0 };
    this.aW = new Vec3();
    this.bW = new Vec3();
    this.p = new Vec3();
    this.q = new Vec3();
    this.massP = 0;
    this.massQ = 0;
    this.massM = 0;
    this.motorMaxImpulse = 0;
  }

  enableMotor() {
    this.motorEnabled = true;
  }

  disableMotor() {
    this.motorEnabled = false;
    this.lambdaMotor = 0;
  }

  setMotorSpeed(speed) {
    const s = Number(speed);
    this.motorSpeed = Number.isFinite(s) ? s : 0;
  }

  setMotorMaxForce(force) {
    const f = Number(force);
    this.motorMaxForce = Number.isFinite(f) && f >= 0 ? f : 0;
  }


  setLimits(enabled, lower, upper) {
    this.limitEnabled = enabled === true;
    const lo = Number(lower);
    const hi = Number(upper);
    if (Number.isFinite(lo)) this.lowerAngle = Math.min(Math.PI, Math.max(-Math.PI, lo));
    if (Number.isFinite(hi)) {
      this.upperAngle = Math.min(Math.PI, Math.max(this.lowerAngle, hi));
    } else {
      this.upperAngle = Math.max(this.lowerAngle, this.upperAngle);
    }
    if (!this.limitEnabled) {
      this.lambdaLimit = 0;
      this.limitState = 0;
    }
  }


  hingeAngle() {
    const qWA = this.bodyA.quaternion.mult(this.qAttA, new Quaternion());
    const qWB = this.bodyB.quaternion.mult(this.qAttB, new Quaternion());
    const qRel = qWA.conjugate(new Quaternion()).mult(qWB, new Quaternion());
    let x = qRel.x, w = qRel.w;
    if (w < 0) { x = -x; w = -w; }
    return 2 * Math.atan2(x, w);
  }


  limitError() {
    const t = this.hingeAngle();
    if (t >= this.lowerAngle && t <= this.upperAngle) return 0;
    const eUp = wrapPi(t - this.upperAngle);
    const eLow = wrapPi(t - this.lowerAngle);


    const e = Math.abs(eUp) <= Math.abs(eLow) ? eUp : eLow;
    return Number.isFinite(e) ? e : 0;
  }


  applyLimitImpulse(dj) {
    const LA = this.aW.scale(dj, new Vec3());
    const LB = this.bW.scale(dj, new Vec3());
    this.bodyA.angularVelocity.addScaled(-1, this.IiA.vmult(LA, LA));
    this.bodyB.angularVelocity.addScaled(1, this.IiB.vmult(LB, LB));
  }

  wantsWake() {

    if (super.wantsWake()) return true;
    if (this.motorEnabled && this.motorSpeed !== 0 && this.motorMaxForce > 0) return true;


    if (this.limitEnabled && Math.abs(this.limitError()) > JOINT_WAKE_ANGLE) {
      return true;
    }


    const aW = this.bodyA.quaternion.vmult(this.axisA, new Vec3());
    aW.normalize();
    const bW = this.bodyB.quaternion.vmult(this.axisB, new Vec3());
    bW.normalize();
    const mis = aW.cross(bW, new Vec3()).length();
    return Number.isFinite(mis) && mis > JOINT_WAKE_ANGLE;
  }

  applyAngularImpulse(dir1, dir2, d1, d2) {
    const L = new Vec3(
      dir1.x * d1 + (dir2 ? dir2.x * d2 : 0),
      dir1.y * d1 + (dir2 ? dir2.y * d2 : 0),
      dir1.z * d1 + (dir2 ? dir2.z * d2 : 0),
    );
    this.bodyB.angularVelocity.addScaled(1, this.IiB.vmult(L, new Vec3()));
    this.bodyA.angularVelocity.addScaled(-1, this.IiA.vmult(L, new Vec3()));
  }

  initSolve(h) {
    super.initSolve(h);
    const A = this.bodyA, B = this.bodyB;
    A.quaternion.vmult(this.axisA, this.aW);
    this.aW.normalize();
    B.quaternion.vmult(this.axisB, this.bW);
    this.bW.normalize();
    buildTangents(this.aW, this.p, this.q);

    const kp = this.p.dot(this.IiA.vmult(this.p, new Vec3())) +
      this.p.dot(this.IiB.vmult(this.p, new Vec3()));
    this.massP = kp > 1e-12 ? 1 / kp : 0;
    const kq = this.q.dot(this.IiA.vmult(this.q, new Vec3())) +
      this.q.dot(this.IiB.vmult(this.q, new Vec3()));
    this.massQ = kq > 1e-12 ? 1 / kq : 0;
    const km = this.aW.dot(this.IiA.vmult(this.aW, new Vec3())) +
      this.bW.dot(this.IiB.vmult(this.bW, new Vec3()));
    this.massM = km > 1e-12 ? 1 / km : 0;

    this.motorMaxImpulse = this.motorMaxForce * h;

    if (this.lambdaAng1 !== 0 || this.lambdaAng2 !== 0) {
      this.applyAngularImpulse(this.p, this.q, this.lambdaAng1, this.lambdaAng2);
    }
    if (this.motorEnabled && this.lambdaMotor !== 0) {
      const LA = this.aW.scale(this.lambdaMotor, new Vec3());
      const LB = this.bW.scale(this.lambdaMotor, new Vec3());
      this.bodyA.angularVelocity.addScaled(-1, this.IiA.vmult(LA, LA));
      this.bodyB.angularVelocity.addScaled(1, this.IiB.vmult(LB, LB));
    }


    let limitState = 0;
    if (this.limitEnabled && this.imA + this.imB > 0 && this.massM > 0) {
      if (this.upperAngle - this.lowerAngle >= 2 * Math.PI - 2 * ANGULAR_SLOP) {


        limitState = 0;
      } else if (this.upperAngle - this.lowerAngle < 2 * ANGULAR_SLOP) {
        limitState = 2;                                                     
      } else {
        const t = this.hingeAngle();
        if (t <= this.lowerAngle + ANGULAR_SLOP || t >= this.upperAngle - ANGULAR_SLOP) {


          const eUp = wrapPi(t - this.upperAngle);
          const eLow = wrapPi(t - this.lowerAngle);
          limitState = Math.abs(eUp) <= Math.abs(eLow) ? 1 : -1;
        }
      }
    }
    if (limitState !== this.limitState) this.lambdaLimit = 0;
    this.limitState = limitState;
    if (this.limitState !== 0) {
      this.stats.limitActiveSteps++;

      if (this.lambdaLimit !== 0) this.applyLimitImpulse(this.lambdaLimit);
    }
  }

  solveIteration() {
    super.solveIteration();
    if (this.imA === 0 && this.imB === 0) return;
    const wA = this.bodyA.angularVelocity;
    const wB = this.bodyB.angularVelocity;

    if (this.massP > 0) {
      const relP = this.p.x * (wB.x - wA.x) + this.p.y * (wB.y - wA.y) + this.p.z * (wB.z - wA.z);
      const d1 = -this.massP * relP;
      this.lambdaAng1 += d1;
      this.applyAngularImpulse(this.p, null, d1, 0);
    }
    if (this.massQ > 0) {
      const relQ = this.q.x * (wB.x - wA.x) + this.q.y * (wB.y - wA.y) + this.q.z * (wB.z - wA.z);
      const d2 = -this.massQ * relQ;
      this.lambdaAng2 += d2;
      this.applyAngularImpulse(this.q, null, d2, 0);
    }
    if (this.motorEnabled && this.massM > 0 && this.motorMaxImpulse > 0) {


      const rel = this.bW.dot(wB) - this.aW.dot(wA);
      let dm = this.massM * (this.motorSpeed - rel);
      const next = Math.max(-this.motorMaxImpulse, Math.min(this.motorMaxImpulse, this.lambdaMotor + dm));
      dm = next - this.lambdaMotor;
      this.lambdaMotor = next;
      if (dm !== 0) {
        const LA = this.aW.scale(dm, new Vec3());
        const LB = this.bW.scale(dm, new Vec3());
        this.bodyA.angularVelocity.addScaled(-1, this.IiA.vmult(LA, LA));
        this.bodyB.angularVelocity.addScaled(1, this.IiB.vmult(LB, LB));
      }
    }
    if (this.limitState !== 0 && this.massM > 0) {


      const wA2 = this.bodyA.angularVelocity;
      const wB2 = this.bodyB.angularVelocity;
      const rel = this.bW.dot(wB2) - this.aW.dot(wA2);
      let next = this.lambdaLimit - this.massM * rel;
      if (this.limitState === 1) next = Math.min(0, Math.max(-this.maxImpulse, next));
      else if (this.limitState === -1) next = Math.max(0, Math.min(this.maxImpulse, next));
      else next = Math.max(-this.maxImpulse, Math.min(this.maxImpulse, next));
      const dl = next - this.lambdaLimit;
      this.lambdaLimit = next;
      if (dl !== 0) this.applyLimitImpulse(dl);
    }
  }


  solvePosition() {
    let ok = super.solvePosition();
    const A = this.bodyA, B = this.bodyB;


    if (this.limitEnabled) {
      const e0 = this.limitError();
      if (Math.abs(e0) > JOINT_WAKE_ANGLE) {
        if (A.mass > 0 && A.isSleeping()) A.wakeUp();
        if (B.mass > 0 && B.isSleeping()) B.wakeUp();
      }
    }
    const imA = activeInvMass(A);
    const imB = activeInvMass(B);
    if (imA === 0 && imB === 0) return ok;
    const IiA = activeInvInertia(A);
    const IiB = activeInvInertia(B);
    const aW = A.quaternion.vmult(this.axisA, new Vec3());
    aW.normalize();
    const bW = B.quaternion.vmult(this.axisB, new Vec3());
    bW.normalize();
    const err = bW.cross(aW, new Vec3());
    if (err.isFiniteVec()) {
      const errLen = err.length();
      if (errLen > ANGULAR_SLOP) {
        const errC = errLen > MAX_ANGULAR_CORRECTION
          ? err.scale(MAX_ANGULAR_CORRECTION / errLen, err)
          : err;
        const K = IiA.add(IiB, new Mat3());
        const L = K.invert(new Mat3()).vmult(errC, new Vec3());
        if (L.isFiniteVec() && !L.almostZero(1e-12)) {
          integrateOrientationDelta(B, IiB.vmult(L, new Vec3()));
          integrateOrientationDelta(A, IiA.vmult(L, new Vec3()).negate(new Vec3()));
          ok = false;
        }
      }
    }


    if (this.limitEnabled) {
      const e = this.limitError();
      if (Math.abs(e) > ANGULAR_SLOP) {
        const axW = A.quaternion.vmult(this.axisA, new Vec3());
        axW.normalize();
        const corr = Math.max(-MAX_ANGULAR_CORRECTION, Math.min(MAX_ANGULAR_CORRECTION, e));
        const K2 = IiA.add(IiB, new Mat3()).invert(new Mat3());
        const L2 = K2.vmult(axW.scale(-corr, new Vec3()), new Vec3());
        if (L2.isFiniteVec() && !L2.almostZero(1e-12)) {
          integrateOrientationDelta(B, IiB.vmult(L2, new Vec3()));
          integrateOrientationDelta(A, IiA.vmult(L2, new Vec3()).negate(new Vec3()));
          ok = false;
        }
      }
    }
    return ok;
  }
}


function quatErrorVec(qTarget, qCur, out) {
  const qe = qTarget.mult(qCur.conjugate(new Quaternion()), new Quaternion());
  let w = qe.w, x = qe.x, y = qe.y, z = qe.z;
  if (w < 0) { w = -w; x = -x; y = -y; z = -z; }
  const s = Math.sqrt(Math.max(0, 1 - w * w));
  if (s < 1e-6) { out.set(0, 0, 0); return out; }
  const angle = 2 * Math.acos(Math.min(1, w));
  out.set((x / s) * angle, (y / s) * angle, (z / s) * angle);
  return out;
}


const ROPE_RESTITUTION_THRESHOLD = 1;


export class RopeConstraint extends Constraint {
  constructor(bodyA, pivotA, bodyB, pivotB, options = {}) {
    super(bodyA, bodyB);
    this.pivotA = new Vec3();
    if (pivotA) this.pivotA.copy(pivotA);
    this.pivotB = new Vec3();
    if (pivotB) this.pivotB.copy(pivotB);
    const len = Number(options.length);
    this.length = Number.isFinite(len) && len >= 0 ? len : 1;
    const mf = Number(options.maxForce);
    this.maxForce = Number.isFinite(mf) && mf > 0 ? mf : 1e6;
    this.collideConnected = options.collideConnected !== false;

    const rest = Number(options.restitution);
    this.restitution = Number.isFinite(rest) ? Math.min(1, Math.max(0, rest)) : 0;
    this.restitutionBias = 0;
    this.lambda = 0;
    this.rA = new Vec3();
    this.rB = new Vec3();
    this.n = new Vec3();
    this.armA = new Vec3();
    this.armB = new Vec3();
    this.massN = 0;
    this.maxImpulse = 0;
    this.imA = 0;
    this.imB = 0;
    this.IiA = ZERO_MAT;
    this.IiB = ZERO_MAT;
    this.taut = false;
  }

  setLength(len) {
    const l = Number(len);
    if (Number.isFinite(l) && l >= 0) this.length = l;
  }


  setRestitution(r) {
    const v = Number(r);
    if (Number.isFinite(v)) this.restitution = Math.min(1, Math.max(0, v));
  }

  currentDistance() {
    const A = this.bodyA, B = this.bodyB;
    const rA = A.quaternion.vmult(this.pivotA, new Vec3());
    const rB = B.quaternion.vmult(this.pivotB, new Vec3());
    const dx = B.position.x + rB.x - (A.position.x + rA.x);
    const dy = B.position.y + rB.y - (A.position.y + rA.y);
    const dz = B.position.z + rB.z - (A.position.z + rA.z);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }


  wantsWake() {
    const err = this.currentDistance() - this.length;
    return Number.isFinite(err) && err > JOINT_WAKE_ERROR;
  }


  applyRopeImpulse(dj) {
    const P = this.n.scale(dj, new Vec3());
    const A = this.bodyA, B = this.bodyB;
    A.velocity.addScaled(this.imA, P);
    A.angularVelocity.addScaled(1, this.IiA.vmult(this.armA.scale(dj, new Vec3()), new Vec3()));
    B.velocity.addScaled(-this.imB, P);
    B.angularVelocity.addScaled(-1, this.IiB.vmult(this.armB.scale(dj, new Vec3()), new Vec3()));
  }

  initSolve(h) {
    const A = this.bodyA, B = this.bodyB;
    this.imA = activeInvMass(A);
    this.imB = activeInvMass(B);
    this.IiA = activeInvInertia(A);
    this.IiB = activeInvInertia(B);
    A.quaternion.vmult(this.pivotA, this.rA);
    B.quaternion.vmult(this.pivotB, this.rB);
    const dx = B.position.x + this.rB.x - (A.position.x + this.rA.x);
    const dy = B.position.y + this.rB.y - (A.position.y + this.rA.y);
    const dz = B.position.z + this.rB.z - (A.position.z + this.rA.z);
    const dist = Math.sqrt(dx * dx + dy * dy + dz * dz);
    this.taut = Number.isFinite(dist) && dist > 1e-9 && dist >= this.length;
    if (!this.taut) {
      this.lambda = 0;
      this.massN = 0;
      this.restitutionBias = 0;
      return;
    }
    this.n.set(dx / dist, dy / dist, dz / dist);
    this.rA.cross(this.n, this.armA);
    this.rB.cross(this.n, this.armB);
    const k = this.imA + this.imB +
      this.armA.dot(this.IiA.vmult(this.armA, new Vec3())) +
      this.armB.dot(this.IiB.vmult(this.armB, new Vec3()));
    this.massN = k > 1e-12 ? 1 / k : 0;
    this.maxImpulse = this.maxForce * h;


    this.restitutionBias = 0;
    if (this.restitution > 0 && this.massN > 0) {
      const cdot0 = this.n.dot(B.velocity) + this.armB.dot(B.angularVelocity) -
        this.n.dot(A.velocity) - this.armA.dot(A.angularVelocity);
      if (Number.isFinite(cdot0) && cdot0 > ROPE_RESTITUTION_THRESHOLD) {
        this.restitutionBias = this.restitution * cdot0;
      }
    }


    if (this.lambda !== 0) this.applyRopeImpulse(this.lambda);
  }

  solveIteration() {
    if (!this.taut || this.massN === 0) return;
    if (this.imA === 0 && this.imB === 0) return;
    const A = this.bodyA, B = this.bodyB;
    const vA = A.velocity, vB = B.velocity;
    const wA = A.angularVelocity, wB = B.angularVelocity;

    const cdot = this.n.dot(vB) + this.armB.dot(wB) - this.n.dot(vA) - this.armA.dot(wA);

    let dj = this.massN * (cdot + this.restitutionBias);
    const next = Math.max(0, Math.min(this.maxImpulse, this.lambda + dj));
    dj = next - this.lambda;
    this.lambda = next;
    if (dj !== 0) this.applyRopeImpulse(dj);
  }


  solvePosition() {
    const A = this.bodyA, B = this.bodyB;
    const rA = A.quaternion.vmult(this.pivotA, new Vec3());
    const rB = B.quaternion.vmult(this.pivotB, new Vec3());
    const d = new Vec3(
      B.position.x + rB.x - (A.position.x + rA.x),
      B.position.y + rB.y - (A.position.y + rA.y),
      B.position.z + rB.z - (A.position.z + rA.z),
    );
    if (!d.isFiniteVec()) return true;
    const dist = d.length();
    const err = dist - this.length;
    if (err > JOINT_WAKE_ERROR) {
      if (A.mass > 0 && A.isSleeping()) A.wakeUp();
      if (B.mass > 0 && B.isSleeping()) B.wakeUp();
    }
    if (dist < 1e-9 || err <= POSITION_SLOP) return true;
    const imA = activeInvMass(A);
    const imB = activeInvMass(B);
    if (imA === 0 && imB === 0) return true;
    const IiA = activeInvInertia(A);
    const IiB = activeInvInertia(B);
    const n = d.scale(1 / dist, new Vec3());
    const armA = rA.cross(n, new Vec3());
    const armB = rB.cross(n, new Vec3());
    const k = imA + imB +
      armA.dot(IiA.vmult(armA, new Vec3())) +
      armB.dot(IiB.vmult(armB, new Vec3()));
    if (k <= 1e-12) return true;
    const P = Math.min(err, MAX_LINEAR_CORRECTION) / k;
    if (!Number.isFinite(P) || P === 0) return true;
    if (imA > 0) {
      A.position.addScaled(imA * P, n);
      integrateOrientationDelta(A, IiA.vmult(armA.scale(P, new Vec3()), new Vec3()));
      A.aabbNeedsUpdate = true;
    }
    if (imB > 0) {
      B.position.addScaled(-imB * P, n);
      integrateOrientationDelta(B, IiB.vmult(armB.scale(P, new Vec3()), new Vec3()).negate(new Vec3()));
      B.aabbNeedsUpdate = true;
    }
    return false;
  }
}


export class PrismaticConstraint extends Constraint {
  constructor(bodyA, bodyB, options = {}) {
    super(bodyA, bodyB);
    this.pivotA = new Vec3();
    if (options.pivotA) this.pivotA.copy(options.pivotA);
    this.pivotB = new Vec3();
    if (options.pivotB) this.pivotB.copy(options.pivotB);
    this.axisA = new Vec3(1, 0, 0);
    if (options.axisA) this.axisA.copy(options.axisA);


    const axLen = this.axisA.length();
    if (Number.isFinite(axLen) && axLen > 1e-9) this.axisA.scale(1 / axLen, this.axisA);
    else this.axisA.set(1, 0, 0);
    const mf = Number(options.maxForce);
    this.maxForce = Number.isFinite(mf) && mf > 0 ? mf : 1e6;
    this.collideConnected = options.collideConnected !== false;


    this.frameAligned = !!options.axisB;
    if (this.frameAligned) {
      const sanitizeDir = (src, fx, fy, fz) => {
        const v = new Vec3(fx, fy, fz);
        if (src) v.copy(src);
        const len = v.length();
        if (Number.isFinite(len) && len > 1e-9) v.scale(1 / len, v);
        else v.set(fx, fy, fz);
        return v;
      };
      this.axisB = sanitizeDir(options.axisB, 1, 0, 0);
      this.refA = sanitizeDir(options.refA, 0, 1, 0);
      this.refB = sanitizeDir(options.refB, 0, 1, 0);


      this.qAttA = attachmentFrameQuat(this.axisA, this.refA);
      this.qAttB = attachmentFrameQuat(this.axisB, this.refB);
      this.qRel0 = this.qAttA.mult(this.qAttB.conjugate(new Quaternion()), new Quaternion());
      if (!Number.isFinite(this.qRel0.x) || !Number.isFinite(this.qRel0.w)) {
        this.qRel0 = new Quaternion();
      }
      this.qRel0.normalize();
    } else {

      this.qRel0 = bodyA && bodyB
        ? bodyA.quaternion.conjugate(new Quaternion()).mult(bodyB.quaternion, new Quaternion())
        : new Quaternion();
    }
    this.limitsEnabled = false;
    this.lowerLimit = 0;
    this.upperLimit = 0;
    this.motorEnabled = false;
    this.motorSpeed = 0;
    this.motorMaxForce = 1e6;
    this.lambdaAng = new Vec3();
    this.lambdaP = 0;
    this.lambdaQ = 0;
    this.lambdaMotor = 0;
    this.lambdaLimit = 0;
    this.limitState = 0;                                                          
    this.rA = new Vec3();
    this.rB = new Vec3();
    this.aW = new Vec3();
    this.p = new Vec3();
    this.q = new Vec3();
    this.armAp = new Vec3(); this.armBp = new Vec3();
    this.armAq = new Vec3(); this.armBq = new Vec3();
    this.armAa = new Vec3(); this.armBa = new Vec3();
    this.massP = 0;
    this.massQ = 0;
    this.massAxis = 0;
    this.kAngInv = new Mat3();
    this.angOk = false;
    this.maxImpulse = 0;
    this.motorMaxImpulse = 0;
    this.imA = 0;
    this.imB = 0;
    this.IiA = ZERO_MAT;
    this.IiB = ZERO_MAT;
  }

  enableMotor() { this.motorEnabled = true; }

  disableMotor() {
    this.motorEnabled = false;
    this.lambdaMotor = 0;
  }

  setMotorSpeed(speed) {
    const s = Number(speed);
    this.motorSpeed = Number.isFinite(s) ? s : 0;
  }

  setMotorMaxForce(force) {
    const f = Number(force);
    this.motorMaxForce = Number.isFinite(f) && f >= 0 ? f : 0;
  }


  setLimits(enabled, lower, upper) {
    this.limitsEnabled = enabled === true;
    const lo = Number(lower);
    const hi = Number(upper);
    if (Number.isFinite(lo)) this.lowerLimit = lo;
    if (Number.isFinite(hi)) this.upperLimit = Math.max(this.lowerLimit, hi);
    else this.upperLimit = Math.max(this.lowerLimit, this.upperLimit);
  }

  wantsWake() {
    if (this.motorEnabled && this.motorSpeed !== 0 && this.motorMaxForce > 0) return true;


    const A = this.bodyA, B = this.bodyB;
    const rA = A.quaternion.vmult(this.pivotA, new Vec3());
    const rB = B.quaternion.vmult(this.pivotB, new Vec3());
    const aW = A.quaternion.vmult(this.axisA, new Vec3());
    aW.normalize();
    const d = new Vec3(
      B.position.x + rB.x - (A.position.x + rA.x),
      B.position.y + rB.y - (A.position.y + rA.y),
      B.position.z + rB.z - (A.position.z + rA.z),
    );
    if (!d.isFiniteVec()) return false;
    const along = d.dot(aW);
    if (this.limitsEnabled &&
      (along < this.lowerLimit - JOINT_WAKE_ERROR || along > this.upperLimit + JOINT_WAKE_ERROR)) {
      return true;
    }
    const perp = d.vsub(aW.scale(along, new Vec3()), new Vec3());
    if (perp.length() > JOINT_WAKE_ERROR) return true;
    const qTarget = A.quaternion.mult(this.qRel0, new Quaternion());
    const angErr = quatErrorVec(qTarget, B.quaternion, new Vec3());
    return angErr.isFiniteVec() && angErr.length() > JOINT_WAKE_ANGLE;
  }


  getTranslation() {
    const A = this.bodyA, B = this.bodyB;
    const rA = A.quaternion.vmult(this.pivotA, new Vec3());
    const rB = B.quaternion.vmult(this.pivotB, new Vec3());
    const aW = A.quaternion.vmult(this.axisA, new Vec3());
    aW.normalize();
    const dx = B.position.x + rB.x - (A.position.x + rA.x);
    const dy = B.position.y + rB.y - (A.position.y + rA.y);
    const dz = B.position.z + rB.z - (A.position.z + rA.z);
    return dx * aW.x + dy * aW.y + dz * aW.z;
  }

  rowEffectiveMass(armA, armB) {
    const k = this.imA + this.imB +
      armA.dot(this.IiA.vmult(armA, new Vec3())) +
      armB.dot(this.IiB.vmult(armB, new Vec3()));
    return k > 1e-12 ? 1 / k : 0;
  }


  applyRowImpulse(t, armA, armB, dj) {
    const P = t.scale(dj, new Vec3());
    const A = this.bodyA, B = this.bodyB;
    B.velocity.addScaled(this.imB, P);
    B.angularVelocity.addScaled(1, this.IiB.vmult(armB.scale(dj, new Vec3()), new Vec3()));
    A.velocity.addScaled(-this.imA, P);
    A.angularVelocity.addScaled(-1, this.IiA.vmult(armA.scale(dj, new Vec3()), new Vec3()));
  }

  initSolve(h) {
    const A = this.bodyA, B = this.bodyB;
    this.imA = activeInvMass(A);
    this.imB = activeInvMass(B);
    this.IiA = activeInvInertia(A);
    this.IiB = activeInvInertia(B);
    A.quaternion.vmult(this.pivotA, this.rA);
    B.quaternion.vmult(this.pivotB, this.rB);
    A.quaternion.vmult(this.axisA, this.aW);
    this.aW.normalize();
    buildTangents(this.aW, this.p, this.q);
    const d = new Vec3(
      B.position.x + this.rB.x - (A.position.x + this.rA.x),
      B.position.y + this.rB.y - (A.position.y + this.rA.y),
      B.position.z + this.rB.z - (A.position.z + this.rA.z),
    );
    const translation = d.dot(this.aW);


    const rAd = this.rA.vadd(d, new Vec3());
    rAd.cross(this.p, this.armAp);
    this.rB.cross(this.p, this.armBp);
    rAd.cross(this.q, this.armAq);
    this.rB.cross(this.q, this.armBq);
    rAd.cross(this.aW, this.armAa);
    this.rB.cross(this.aW, this.armBa);
    this.massP = this.rowEffectiveMass(this.armAp, this.armBp);
    this.massQ = this.rowEffectiveMass(this.armAq, this.armBq);
    this.massAxis = this.rowEffectiveMass(this.armAa, this.armBa);
    this.angOk = false;
    if (this.imA + this.imB > 0) {
      this.IiA.add(this.IiB, new Mat3()).invert(this.kAngInv);
      this.angOk = true;
    }
    if (this.limitsEnabled) {
      if (this.upperLimit - this.lowerLimit < 2 * POSITION_SLOP) {


        if (this.limitState !== 2) this.lambdaLimit = 0;
        this.limitState = 2;
      } else if (translation <= this.lowerLimit + POSITION_SLOP) {
        if (this.limitState !== -1) this.lambdaLimit = 0;
        this.limitState = -1;
      } else if (translation >= this.upperLimit - POSITION_SLOP) {
        if (this.limitState !== 1) this.lambdaLimit = 0;
        this.limitState = 1;
      } else {
        this.limitState = 0;
        this.lambdaLimit = 0;
      }
    } else {
      this.limitState = 0;
      this.lambdaLimit = 0;
    }
    this.maxImpulse = this.maxForce * h;
    this.motorMaxImpulse = this.motorMaxForce * h;

    if (this.angOk && !this.lambdaAng.almostZero(1e-12)) {
      B.angularVelocity.addScaled(1, this.IiB.vmult(this.lambdaAng, new Vec3()));
      A.angularVelocity.addScaled(-1, this.IiA.vmult(this.lambdaAng, new Vec3()));
    }
    if (this.lambdaP !== 0) this.applyRowImpulse(this.p, this.armAp, this.armBp, this.lambdaP);
    if (this.lambdaQ !== 0) this.applyRowImpulse(this.q, this.armAq, this.armBq, this.lambdaQ);
    const la = (this.motorEnabled ? this.lambdaMotor : 0) + (this.limitState !== 0 ? this.lambdaLimit : 0);
    if (la !== 0) this.applyRowImpulse(this.aW, this.armAa, this.armBa, la);
  }

  solveIteration() {
    if (this.imA === 0 && this.imB === 0) return;
    const A = this.bodyA, B = this.bodyB;

    if (this.angOk) {
      const wA = A.angularVelocity, wB = B.angularVelocity;
      const relW = new Vec3(wB.x - wA.x, wB.y - wA.y, wB.z - wA.z);
      const dL = this.kAngInv.vmult(relW.negate(new Vec3()), new Vec3());
      const next = this.lambdaAng.vadd(dL, new Vec3());
      const len = next.length();
      if (len > this.maxImpulse && len > 1e-12) next.scale(this.maxImpulse / len, next);
      next.vsub(this.lambdaAng, dL);
      this.lambdaAng.copy(next);
      if (!dL.almostZero(1e-12)) {
        B.angularVelocity.addScaled(1, this.IiB.vmult(dL, new Vec3()));
        A.angularVelocity.addScaled(-1, this.IiA.vmult(dL, new Vec3()));
      }
    }

    if (this.massP > 0) {
      const cdot = this.p.dot(B.velocity) + this.armBp.dot(B.angularVelocity) -
        this.p.dot(A.velocity) - this.armAp.dot(A.angularVelocity);
      let dj = -this.massP * cdot;
      const next = Math.max(-this.maxImpulse, Math.min(this.maxImpulse, this.lambdaP + dj));
      dj = next - this.lambdaP;
      this.lambdaP = next;
      if (dj !== 0) this.applyRowImpulse(this.p, this.armAp, this.armBp, dj);
    }
    if (this.massQ > 0) {
      const cdot = this.q.dot(B.velocity) + this.armBq.dot(B.angularVelocity) -
        this.q.dot(A.velocity) - this.armAq.dot(A.angularVelocity);
      let dj = -this.massQ * cdot;
      const next = Math.max(-this.maxImpulse, Math.min(this.maxImpulse, this.lambdaQ + dj));
      dj = next - this.lambdaQ;
      this.lambdaQ = next;
      if (dj !== 0) this.applyRowImpulse(this.q, this.armAq, this.armBq, dj);
    }

    if (this.motorEnabled && this.massAxis > 0 && this.motorMaxImpulse > 0) {
      const cdot = this.aW.dot(B.velocity) + this.armBa.dot(B.angularVelocity) -
        this.aW.dot(A.velocity) - this.armAa.dot(A.angularVelocity);
      let dj = this.massAxis * (this.motorSpeed - cdot);
      const next = Math.max(-this.motorMaxImpulse, Math.min(this.motorMaxImpulse, this.lambdaMotor + dj));
      dj = next - this.lambdaMotor;
      this.lambdaMotor = next;
      if (dj !== 0) this.applyRowImpulse(this.aW, this.armAa, this.armBa, dj);
    }


    if (this.limitState !== 0 && this.massAxis > 0) {
      const cdot = this.aW.dot(B.velocity) + this.armBa.dot(B.angularVelocity) -
        this.aW.dot(A.velocity) - this.armAa.dot(A.angularVelocity);
      let dj = -this.massAxis * cdot;
      let next = this.lambdaLimit + dj;
      if (this.limitState === -1) next = Math.max(0, Math.min(this.maxImpulse, next));
      else if (this.limitState === 1) next = Math.min(0, Math.max(-this.maxImpulse, next));
      else next = Math.max(-this.maxImpulse, Math.min(this.maxImpulse, next));
      dj = next - this.lambdaLimit;
      this.lambdaLimit = next;
      if (dj !== 0) this.applyRowImpulse(this.aW, this.armAa, this.armBa, dj);
    }
  }


  applyPositionRow(A, B, rA, rB, d, t, deltaC) {
    const imA = activeInvMass(A);
    const imB = activeInvMass(B);
    const IiA = activeInvInertia(A);
    const IiB = activeInvInertia(B);
    const rAd = rA.vadd(d, new Vec3());
    const armA = rAd.cross(t, new Vec3());
    const armB = rB.cross(t, new Vec3());
    const k = imA + imB +
      armA.dot(IiA.vmult(armA, new Vec3())) +
      armB.dot(IiB.vmult(armB, new Vec3()));
    if (k <= 1e-12) return false;
    const Pn = deltaC / k;
    if (!Number.isFinite(Pn) || Pn === 0) return false;
    if (imB > 0) {
      B.position.addScaled(imB * Pn, t);
      integrateOrientationDelta(B, IiB.vmult(armB.scale(Pn, new Vec3()), new Vec3()));
      B.aabbNeedsUpdate = true;
    }
    if (imA > 0) {
      A.position.addScaled(-imA * Pn, t);
      integrateOrientationDelta(A, IiA.vmult(armA.scale(Pn, new Vec3()), new Vec3()).negate(new Vec3()));
      A.aabbNeedsUpdate = true;
    }
    return true;
  }


  solvePosition() {
    const A = this.bodyA, B = this.bodyB;
    const qTarget = A.quaternion.mult(this.qRel0, new Quaternion());
    const angErr = quatErrorVec(qTarget, B.quaternion, new Vec3());
    const rA = A.quaternion.vmult(this.pivotA, new Vec3());
    const rB = B.quaternion.vmult(this.pivotB, new Vec3());
    const aW = A.quaternion.vmult(this.axisA, new Vec3());
    aW.normalize();
    const d = new Vec3(
      B.position.x + rB.x - (A.position.x + rA.x),
      B.position.y + rB.y - (A.position.y + rA.y),
      B.position.z + rB.z - (A.position.z + rA.z),
    );
    if (!d.isFiniteVec() || !angErr.isFiniteVec()) return true;
    const along = d.dot(aW);
    const perp = d.vsub(aW.scale(along, new Vec3()), new Vec3());
    const perpLen = perp.length();
    let limitErr = 0;
    if (this.limitsEnabled) {
      if (along < this.lowerLimit) limitErr = this.lowerLimit - along;
      else if (along > this.upperLimit) limitErr = along - this.upperLimit;
    }

    if (perpLen > JOINT_WAKE_ERROR || limitErr > JOINT_WAKE_ERROR || angErr.length() > 0.05) {
      if (A.mass > 0 && A.isSleeping()) A.wakeUp();
      if (B.mass > 0 && B.isSleeping()) B.wakeUp();
    }
    const imA = activeInvMass(A);
    const imB = activeInvMass(B);
    if (imA === 0 && imB === 0) return true;
    const IiA = activeInvInertia(A);
    const IiB = activeInvInertia(B);
    let ok = true;

    const angLen = angErr.length();
    if (angLen > ANGULAR_SLOP) {
      if (angLen > MAX_ANGULAR_CORRECTION) angErr.scale(MAX_ANGULAR_CORRECTION / angLen, angErr);
      const L = IiA.add(IiB, new Mat3()).invert(new Mat3()).vmult(angErr, new Vec3());
      if (L.isFiniteVec() && !L.almostZero(1e-12)) {
        integrateOrientationDelta(B, IiB.vmult(L, new Vec3()));
        integrateOrientationDelta(A, IiA.vmult(L, new Vec3()).negate(new Vec3()));
        ok = false;
      }
    }

    if (perpLen > POSITION_SLOP) {
      const n = perp.scale(1 / perpLen, new Vec3());
      const corr = Math.min(perpLen, MAX_LINEAR_CORRECTION);
      if (this.applyPositionRow(A, B, rA, rB, d, n, -corr)) ok = false;
    }

    if (limitErr > POSITION_SLOP) {
      const dir = along < this.lowerLimit ? 1 : -1;
      const corr = Math.min(limitErr, MAX_LINEAR_CORRECTION);
      if (this.applyPositionRow(A, B, rA, rB, d, aW, dir * corr)) ok = false;
    }
    return ok;
  }
}


function quatFromBasis(x, y, z, out) {
  const m00 = x.x, m01 = y.x, m02 = z.x;
  const m10 = x.y, m11 = y.y, m12 = z.y;
  const m20 = x.z, m21 = y.z, m22 = z.z;
  const tr = m00 + m11 + m22;
  if (tr > 0) {
    const s = Math.sqrt(tr + 1) * 2;
    out.set((m21 - m12) / s, (m02 - m20) / s, (m10 - m01) / s, s / 4);
  } else if (m00 > m11 && m00 > m22) {
    const s = Math.sqrt(1 + m00 - m11 - m22) * 2;
    out.set(s / 4, (m01 + m10) / s, (m02 + m20) / s, (m21 - m12) / s);
  } else if (m11 > m22) {
    const s = Math.sqrt(1 + m11 - m00 - m22) * 2;
    out.set((m01 + m10) / s, s / 4, (m12 + m21) / s, (m02 - m20) / s);
  } else {
    const s = Math.sqrt(1 + m22 - m00 - m11) * 2;
    out.set((m02 + m20) / s, (m12 + m21) / s, s / 4, (m10 - m01) / s);
  }
  return out.normalize();
}


function attachmentFrameQuat(axis, ref) {
  const y = ref.vsub(axis.scale(ref.dot(axis), new Vec3()), new Vec3());
  if (y.length() < 1e-6) buildTangents(axis, y, new Vec3());
  y.normalize();
  const z = axis.cross(y, new Vec3());
  z.normalize();
  return quatFromBasis(axis, y, z, new Quaternion());
}

export class BallSocketConstraint extends PointToPointConstraint {
  constructor(bodyA, pivotA, bodyB, pivotB, options = {}) {
    super(bodyA, pivotA, bodyB, pivotB, options.maxForce || 1e6);


    this.axisA = new Vec3(1, 0, 0);
    if (options.axisA) this.axisA.copy(options.axisA);
    this.axisA.normalize();
    if (this.axisA.almostZero(1e-9)) this.axisA.set(1, 0, 0);
    this.axisB = new Vec3(1, 0, 0);
    if (options.axisB) this.axisB.copy(options.axisB);
    this.axisB.normalize();
    if (this.axisB.almostZero(1e-9)) this.axisB.set(1, 0, 0);


    this.refA = new Vec3(0, 1, 0);
    if (options.refA) this.refA.copy(options.refA);
    this.refA.normalize();
    if (this.refA.almostZero(1e-9)) this.refA.set(0, 1, 0);
    this.refB = new Vec3(0, 1, 0);
    if (options.refB) this.refB.copy(options.refB);
    this.refB.normalize();
    if (this.refB.almostZero(1e-9)) this.refB.set(0, 1, 0);


    this.qAttA = attachmentFrameQuat(this.axisA, this.refA);
    this.qAttB = attachmentFrameQuat(this.axisB, this.refB);
    this.collideConnected = options.collideConnected !== false;
    this.coneLimitEnabled = false;
    this.coneUpperAngle = Math.PI / 4;
    this.twistLimitEnabled = false;
    this.twistLowerAngle = -Math.PI / 4;
    this.twistUpperAngle = Math.PI / 4;
    this.lambdaCone = 0;
    this.lambdaTwist = 0;
    this.coneActive = false;


    this.twistState = 0;
    this.coneAxis = new Vec3();
    this.massCone = 0;
    this.aW = new Vec3();
    this.bW = new Vec3();
    this.massTwist = 0;

    this.stats = { coneActiveSteps: 0, twistActiveSteps: 0 };
  }


  setConeLimit(enabled, upperAngle) {
    this.coneLimitEnabled = enabled === true;
    const u = Number(upperAngle);
    if (Number.isFinite(u)) this.coneUpperAngle = Math.min(Math.PI, Math.max(0, u));
    if (!this.coneLimitEnabled) this.lambdaCone = 0;
  }

  setTwistLimit(enabled, lower, upper) {
    this.twistLimitEnabled = enabled === true;
    const lo = Number(lower);
    const hi = Number(upper);
    if (Number.isFinite(lo)) this.twistLowerAngle = Math.min(Math.PI, Math.max(-Math.PI, lo));
    if (Number.isFinite(hi)) {
      this.twistUpperAngle = Math.min(Math.PI, Math.max(this.twistLowerAngle, hi));
    } else {
      this.twistUpperAngle = Math.max(this.twistLowerAngle, this.twistUpperAngle);
    }
    if (!this.twistLimitEnabled) this.lambdaTwist = 0;
  }


  coneAngle() {
    const aW = this.bodyA.quaternion.vmult(this.axisA, new Vec3());
    const bW = this.bodyB.quaternion.vmult(this.axisB, new Vec3());
    aW.normalize();
    bW.normalize();
    const dot = Math.max(-1, Math.min(1, aW.dot(bW)));
    return Math.acos(dot);
  }


  twistAngle() {
    const qWA = this.bodyA.quaternion.mult(this.qAttA, new Quaternion());
    const qWB = this.bodyB.quaternion.mult(this.qAttB, new Quaternion());
    const qRel = qWA.conjugate(new Quaternion()).mult(qWB, new Quaternion());
    let x = qRel.x, w = qRel.w;
    if (w < 0) { x = -x; w = -w; }
    return 2 * Math.atan2(x, w);
  }


  twistLimitError() {
    if (!this.twistLimitEnabled) return 0;
    if (this.twistUpperAngle - this.twistLowerAngle >= 2 * Math.PI - 2 * ANGULAR_SLOP) {
      return 0;                                                   
    }
    const t = this.twistAngle();
    if (t >= this.twistLowerAngle && t <= this.twistUpperAngle) return 0;
    const eUp = wrapPi(t - this.twistUpperAngle);
    const eLow = wrapPi(t - this.twistLowerAngle);
    const e = Math.abs(eUp) <= Math.abs(eLow) ? eUp : eLow;
    return Number.isFinite(e) ? e : 0;
  }


  coneAxisInto(aW, bW, out) {
    aW.cross(bW, out);
    const len = out.length();
    if (len > 1e-6) {
      out.scale(1 / len, out);
    } else {
      buildTangents(aW, out, new Vec3());
    }
    return out;
  }


  wantsWake() {
    if (super.wantsWake()) return true;
    if (this.coneLimitEnabled &&
      this.coneAngle() - this.coneUpperAngle > JOINT_WAKE_ANGLE) {
      return true;
    }


    if (Math.abs(this.twistLimitError()) > JOINT_WAKE_ANGLE) {
      return true;
    }
    return false;
  }

  applyConeImpulse(dj) {
    const L = this.coneAxis.scale(dj, new Vec3());
    this.bodyB.angularVelocity.addScaled(1, this.IiB.vmult(L, new Vec3()));
    this.bodyA.angularVelocity.addScaled(-1, this.IiA.vmult(L, new Vec3()));
  }

  applyTwistImpulse(dj) {
    const LA = this.aW.scale(dj, new Vec3());
    const LB = this.bW.scale(dj, new Vec3());
    this.bodyB.angularVelocity.addScaled(1, this.IiB.vmult(LB, LB));
    this.bodyA.angularVelocity.addScaled(-1, this.IiA.vmult(LA, LA));
  }

  initSolve(h) {
    super.initSolve(h);
    const A = this.bodyA, B = this.bodyB;
    A.quaternion.vmult(this.axisA, this.aW);
    this.aW.normalize();
    B.quaternion.vmult(this.axisB, this.bW);
    this.bW.normalize();
    const hasMass = this.imA + this.imB > 0;

    this.coneActive = false;
    this.massCone = 0;
    if (this.coneLimitEnabled && hasMass) {
      const dot = Math.max(-1, Math.min(1, this.aW.dot(this.bW)));
      const angle = Math.acos(dot);
      if (angle >= this.coneUpperAngle - ANGULAR_SLOP) {
        this.coneAxisInto(this.aW, this.bW, this.coneAxis);
        const k = this.coneAxis.dot(this.IiA.vmult(this.coneAxis, new Vec3())) +
          this.coneAxis.dot(this.IiB.vmult(this.coneAxis, new Vec3()));
        this.massCone = k > 1e-12 ? 1 / k : 0;
        this.coneActive = this.massCone > 0;
      }
    }
    if (!this.coneActive) this.lambdaCone = 0;
    else this.stats.coneActiveSteps++;


    let twistState = 0;
    this.massTwist = 0;
    if (this.twistLimitEnabled && hasMass) {
      const span = this.twistUpperAngle - this.twistLowerAngle;
      if (span >= 2 * Math.PI - 2 * ANGULAR_SLOP) {


        twistState = 0;
      } else if (span < 2 * ANGULAR_SLOP) {


        twistState = 2;
      } else {
        const t = this.twistAngle();
        if (t <= this.twistLowerAngle + ANGULAR_SLOP || t >= this.twistUpperAngle - ANGULAR_SLOP) {


          const eUp = wrapPi(t - this.twistUpperAngle);
          const eLow = wrapPi(t - this.twistLowerAngle);
          twistState = Math.abs(eUp) <= Math.abs(eLow) ? 1 : -1;
        }
      }
      if (twistState !== 0) {
        const k = this.aW.dot(this.IiA.vmult(this.aW, new Vec3())) +
          this.bW.dot(this.IiB.vmult(this.bW, new Vec3()));
        this.massTwist = k > 1e-12 ? 1 / k : 0;
        if (this.massTwist === 0) twistState = 0;
      }
    }
    if (twistState !== this.twistState) this.lambdaTwist = 0;
    this.twistState = twistState;
    if (this.twistState !== 0) this.stats.twistActiveSteps++;

    if (this.coneActive && this.lambdaCone !== 0) this.applyConeImpulse(this.lambdaCone);
    if (this.twistState !== 0 && this.lambdaTwist !== 0) this.applyTwistImpulse(this.lambdaTwist);
  }

  solveIteration() {
    super.solveIteration();
    if (this.imA === 0 && this.imB === 0) return;
    const wA = this.bodyA.angularVelocity;
    const wB = this.bodyB.angularVelocity;
    if (this.coneActive && this.massCone > 0) {

      const cdot = this.coneAxis.dot(wB) - this.coneAxis.dot(wA);
      let dj = -this.massCone * cdot;
      const next = Math.min(0, Math.max(-this.maxImpulse, this.lambdaCone + dj));
      dj = next - this.lambdaCone;
      this.lambdaCone = next;
      if (dj !== 0) this.applyConeImpulse(dj);
    }
    if (this.twistState !== 0 && this.massTwist > 0) {


      const cdot = this.bW.dot(wB) - this.aW.dot(wA);
      let dj = -this.massTwist * cdot;
      let next = this.lambdaTwist + dj;
      if (this.twistState === 1) next = Math.min(0, Math.max(-this.maxImpulse, next));
      else if (this.twistState === -1) next = Math.max(0, Math.min(this.maxImpulse, next));
      else next = Math.max(-this.maxImpulse, Math.min(this.maxImpulse, next));
      dj = next - this.lambdaTwist;
      this.lambdaTwist = next;
      if (dj !== 0) this.applyTwistImpulse(dj);
    }
  }


  solvePosition() {
    let ok = super.solvePosition();
    if (!this.coneLimitEnabled && !this.twistLimitEnabled) return ok;
    const A = this.bodyA, B = this.bodyB;
    let coneErr = 0;
    if (this.coneLimitEnabled) {
      coneErr = this.coneAngle() - this.coneUpperAngle;
    }


    const twistErr = this.twistLimitError();
    if (!Number.isFinite(coneErr) || !Number.isFinite(twistErr)) return ok;

    if (coneErr > JOINT_WAKE_ANGLE || Math.abs(twistErr) > JOINT_WAKE_ANGLE) {
      if (A.mass > 0 && A.isSleeping()) A.wakeUp();
      if (B.mass > 0 && B.isSleeping()) B.wakeUp();
    }
    const imA = activeInvMass(A);
    const imB = activeInvMass(B);
    if (imA === 0 && imB === 0) return ok;
    const IiA = activeInvInertia(A);
    const IiB = activeInvInertia(B);
    const K = IiA.add(IiB, new Mat3()).invert(new Mat3());

    if (coneErr > ANGULAR_SLOP) {
      const aW = A.quaternion.vmult(this.axisA, new Vec3());
      aW.normalize();
      const bW = B.quaternion.vmult(this.axisB, new Vec3());
      bW.normalize();
      const u = this.coneAxisInto(aW, bW, new Vec3());
      const corr = Math.min(coneErr, MAX_ANGULAR_CORRECTION);
      const L = K.vmult(u.scale(-corr, new Vec3()), new Vec3());
      if (L.isFiniteVec() && !L.almostZero(1e-12)) {
        integrateOrientationDelta(B, IiB.vmult(L, new Vec3()));
        integrateOrientationDelta(A, IiA.vmult(L, new Vec3()).negate(new Vec3()));
        ok = false;
      }
    }

    if (Math.abs(twistErr) > ANGULAR_SLOP) {
      const aW = A.quaternion.vmult(this.axisA, new Vec3());
      aW.normalize();
      const corr = Math.max(-MAX_ANGULAR_CORRECTION, Math.min(MAX_ANGULAR_CORRECTION, twistErr));
      const L = K.vmult(aW.scale(-corr, new Vec3()), new Vec3());
      if (L.isFiniteVec() && !L.almostZero(1e-12)) {
        integrateOrientationDelta(B, IiB.vmult(L, new Vec3()));
        integrateOrientationDelta(A, IiA.vmult(L, new Vec3()).negate(new Vec3()));
        ok = false;
      }
    }
    return ok;
  }
}

export class Spring {
  constructor(bodyA, bodyB, options = {}) {
    this.bodyA = bodyA;
    this.bodyB = bodyB;
    this.localAnchorA = new Vec3();
    if (options.localAnchorA) this.localAnchorA.copy(options.localAnchorA);
    this.localAnchorB = new Vec3();
    if (options.localAnchorB) this.localAnchorB.copy(options.localAnchorB);
    const rest = Number(options.restLength);
    this.restLength = Number.isFinite(rest) && rest >= 0 ? rest : 1;
    const k = Number(options.stiffness);
    this.stiffness = Number.isFinite(k) && k >= 0 ? k : 100;
    const c = Number(options.damping);
    this.damping = Number.isFinite(c) && c >= 0 ? c : 1;
  }

  applyForce() {
    const A = this.bodyA, B = this.bodyB;
    const rA = A.quaternion.vmult(this.localAnchorA, new Vec3());
    const rB = B.quaternion.vmult(this.localAnchorB, new Vec3());
    const pA = A.position.vadd(rA);
    const pB = B.position.vadd(rB);
    const d = pB.vsub(pA);
    const len = d.length();
    if (len < 1e-9) return;
    const n = d.scale(1 / len, new Vec3());
    const vA = A.getVelocityAtWorldPoint(pA, new Vec3());
    const vB = B.getVelocityAtWorldPoint(pB, new Vec3());
    const relVel = (vB.x - vA.x) * n.x + (vB.y - vA.y) * n.y + (vB.z - vA.z) * n.z;
    const magnitude = this.stiffness * (len - this.restLength) + this.damping * relVel;
    if (!Number.isFinite(magnitude)) return;
    const accel = Math.abs(magnitude) * Math.max(A.invMass, B.invMass);
    if (accel > 1) {
      if (A.isSleeping()) A.wakeUp();
      if (B.isSleeping()) B.wakeUp();
    }
    const F = n.scale(magnitude, new Vec3());


    if (!A.isSleeping()) A.applyForce(F, pA);
    if (!B.isSleeping()) B.applyForce(F.negate(new Vec3()), pB);
  }
}
