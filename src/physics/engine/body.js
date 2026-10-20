import { Vec3, Quaternion, Mat3 } from "./math3d.js";

let nextBodyId = 0;

export class Body {
  static DYNAMIC = 1;
  static STATIC = 2;
  static KINEMATIC = 4;
  static AWAKE = 0;
  static SLEEPY = 1;
  static SLEEPING = 2;

  constructor(options = {}) {
    this.id = ++nextBodyId;
    this.world = null;
    const mass = Number(options.mass);
    this.mass = Number.isFinite(mass) && mass > 0 ? mass : 0;
    this.type = options.type || (this.mass > 0 ? Body.DYNAMIC : Body.STATIC);
    this.position = new Vec3();
    if (options.position) this.position.copy(options.position);
    this.quaternion = new Quaternion();
    if (options.quaternion) this.quaternion.copy(options.quaternion);
    this.velocity = new Vec3();
    this.angularVelocity = new Vec3();
    this.force = new Vec3();
    this.torque = new Vec3();


    this.pseudoVelocity = new Vec3();
    this.pseudoAngularVelocity = new Vec3();
    this.material = options.material || null;
    this.linearDamping = 0.01;
    this.angularDamping = 0.01;
    this.allowSleep = options.allowSleep !== false;
    this.sleepState = Body.AWAKE;
    this.sleepSpeedLimit = 0.1;
    this.sleepTimeLimit = 1;
    this.sleepTimer = 0;
    this.collisionFilterGroup =
      typeof options.collisionFilterGroup === "number" ? options.collisionFilterGroup : 1;
    this.collisionFilterMask =
      typeof options.collisionFilterMask === "number" ? options.collisionFilterMask : -1;
    this.shapes = [];
    this.shapeOffsets = [];
    this.shapeOrientations = [];
    this.invMass = 0;
    this.invInertiaLocal = new Mat3();
    this.invInertiaWorld = new Mat3();
    this.aabbMin = new Vec3();
    this.aabbMax = new Vec3();
    this.aabbPos = new Vec3(NaN, NaN, NaN);
    this.aabbQuat = new Quaternion(NaN, NaN, NaN, NaN);
    this.aabbNeedsUpdate = true;
    this.updateMassProperties();
  }

  isDynamic() {
    return this.type === Body.DYNAMIC;
  }

  isSleeping() {
    return this.sleepState === Body.SLEEPING;
  }

  addShape(shape, offset, orientation) {
    shape.body = this;
    const off = new Vec3();
    if (offset) off.copy(offset);
    const q = new Quaternion();
    if (orientation) q.copy(orientation);
    this.shapes.push(shape);
    this.shapeOffsets.push(off);
    this.shapeOrientations.push(q);
    this.updateMassProperties();
    this.aabbNeedsUpdate = true;
    return this;
  }

  updateMassProperties() {
    const dynamic = this.type === Body.DYNAMIC && this.mass > 0;
    this.invMass = dynamic ? 1 / this.mass : 0;
    this.invInertiaLocal.setZero();
    this.invInertiaWorld.setZero();
    if (!dynamic || this.shapes.length === 0) return;

    const volumes = this.shapes.map((s) => Math.max(1e-6, s.volume()));
    let total = 0;
    for (const v of volumes) total += v;

    const inertia = new Mat3().setZero();
    const shapeI = new Mat3();
    const rot = new Mat3();
    const rotT = new Mat3();
    const tmp = new Mat3();
    for (let i = 0; i < this.shapes.length; i++) {
      const m = this.mass * (volumes[i] / total);
      this.shapes[i].computeLocalInertia(m, shapeI);
      rot.setRotationFromQuaternion(this.shapeOrientations[i]);
      rot.transpose(rotT);
      rot.mmult(shapeI, tmp);
      tmp.mmult(rotT, shapeI);
      const d = this.shapeOffsets[i];
      const dd = d.lengthSquared();
      const e = shapeI.e;
      e[0] += m * (dd - d.x * d.x);
      e[1] += m * (-d.x * d.y);
      e[2] += m * (-d.x * d.z);
      e[3] += m * (-d.y * d.x);
      e[4] += m * (dd - d.y * d.y);
      e[5] += m * (-d.y * d.z);
      e[6] += m * (-d.z * d.x);
      e[7] += m * (-d.z * d.y);
      e[8] += m * (dd - d.z * d.z);
      inertia.add(shapeI, inertia);
    }
    inertia.invert(this.invInertiaLocal);
    this.updateInertiaWorld();
  }

  updateInertiaWorld() {
    if (this.invMass === 0) {
      this.invInertiaWorld.setZero();
      return;
    }
    const rot = new Mat3().setRotationFromQuaternion(this.quaternion);
    const rotT = rot.transpose(new Mat3());
    const tmp = rot.mmult(this.invInertiaLocal, new Mat3());
    tmp.mmult(rotT, this.invInertiaWorld);
  }

  getVelocityAtWorldPoint(worldPoint, target = new Vec3()) {
    const rx = worldPoint.x - this.position.x;
    const ry = worldPoint.y - this.position.y;
    const rz = worldPoint.z - this.position.z;
    const w = this.angularVelocity;
    target.x = this.velocity.x + w.y * rz - w.z * ry;
    target.y = this.velocity.y + w.z * rx - w.x * rz;
    target.z = this.velocity.z + w.x * ry - w.y * rx;
    return target;
  }

  applyForce(force, worldPoint = this.position) {
    if (this.type !== Body.DYNAMIC) return;


    if (this.sleepState === Body.SLEEPING) this.wakeUp();
    this.force.x += force.x;
    this.force.y += force.y;
    this.force.z += force.z;
    const rx = worldPoint.x - this.position.x;
    const ry = worldPoint.y - this.position.y;
    const rz = worldPoint.z - this.position.z;
    this.torque.x += ry * force.z - rz * force.y;
    this.torque.y += rz * force.x - rx * force.z;
    this.torque.z += rx * force.y - ry * force.x;
  }

  applyImpulse(impulse, worldPoint = this.position) {
    if (this.type !== Body.DYNAMIC || this.invMass === 0) return;
    this.velocity.addScaled(this.invMass, impulse);
    const r = new Vec3(
      worldPoint.x - this.position.x,
      worldPoint.y - this.position.y,
      worldPoint.z - this.position.z,
    );
    const angularImpulse = r.cross(impulse);
    const dw = this.invInertiaWorld.vmult(angularImpulse);
    this.angularVelocity.x += dw.x;
    this.angularVelocity.y += dw.y;
    this.angularVelocity.z += dw.z;
    this.wakeUp();
  }

  wakeUp() {
    if (this.type !== Body.DYNAMIC) return;
    this.sleepState = Body.AWAKE;
    this.sleepTimer = 0;
  }

  sleep() {
    this.sleepState = Body.SLEEPING;
    this.velocity.set(0, 0, 0);
    this.angularVelocity.set(0, 0, 0);
    this.pseudoVelocity.set(0, 0, 0);
    this.pseudoAngularVelocity.set(0, 0, 0);
    this.force.set(0, 0, 0);
    this.torque.set(0, 0, 0);
    this.sleepTimer = 0;


    this.computeAABB();
  }

  updateSleep(dt) {
    if (
      !this.allowSleep ||
      this.type !== Body.DYNAMIC ||
      this.sleepState === Body.SLEEPING ||
      (this.world && this.world.allowSleep === false)
    ) {
      return;
    }
    const speed2 = this.velocity.lengthSquared() + this.angularVelocity.lengthSquared();
    const limit2 = this.sleepSpeedLimit * this.sleepSpeedLimit;
    if (speed2 < limit2) {
      this.sleepTimer += dt;
      this.sleepState = Body.SLEEPY;
      if (this.sleepTimer >= this.sleepTimeLimit) this.sleep();
    } else {
      this.sleepTimer = 0;
      this.sleepState = Body.AWAKE;
    }
  }

  computeAABB() {
    const min = this.aabbMin.set(Infinity, Infinity, Infinity);
    const max = this.aabbMax.set(-Infinity, -Infinity, -Infinity);
    const c = new Vec3();
    for (let i = 0; i < this.shapes.length; i++) {
      this.quaternion.vmult(this.shapeOffsets[i], c);
      c.x += this.position.x;
      c.y += this.position.y;
      c.z += this.position.z;
      const r = this.shapes[i].boundingRadius;
      min.x = Math.min(min.x, c.x - r);
      min.y = Math.min(min.y, c.y - r);
      min.z = Math.min(min.z, c.z - r);
      max.x = Math.max(max.x, c.x + r);
      max.y = Math.max(max.y, c.y + r);
      max.z = Math.max(max.z, c.z + r);
    }
    if (this.shapes.length === 0) {
      min.copy(this.position);
      max.copy(this.position);
    }
    this.aabbPos.copy(this.position);
    this.aabbQuat.copy(this.quaternion);
    this.aabbNeedsUpdate = false;
  }
}
