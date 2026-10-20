export class Vec3 {
  constructor(x = 0, y = 0, z = 0) {
    this.x = x;
    this.y = y;
    this.z = z;
  }

  set(x, y, z) {
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }

  copy(v) {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }

  clone() {
    return new Vec3(this.x, this.y, this.z);
  }

  vadd(v, target = new Vec3()) {
    target.x = this.x + v.x;
    target.y = this.y + v.y;
    target.z = this.z + v.z;
    return target;
  }

  vsub(v, target = new Vec3()) {
    target.x = this.x - v.x;
    target.y = this.y - v.y;
    target.z = this.z - v.z;
    return target;
  }

  scale(s, target = new Vec3()) {
    target.x = this.x * s;
    target.y = this.y * s;
    target.z = this.z * s;
    return target;
  }

  addScaled(s, v) {
    this.x += s * v.x;
    this.y += s * v.y;
    this.z += s * v.z;
    return this;
  }

  negate(target = new Vec3()) {
    target.x = -this.x;
    target.y = -this.y;
    target.z = -this.z;
    return target;
  }

  dot(v) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }

  cross(v, target = new Vec3()) {
    const ax = this.x, ay = this.y, az = this.z;
    const bx = v.x, by = v.y, bz = v.z;
    target.x = ay * bz - az * by;
    target.y = az * bx - ax * bz;
    target.z = ax * by - ay * bx;
    return target;
  }

  lengthSquared() {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }

  length() {
    return Math.sqrt(this.lengthSquared());
  }

  distanceSquared(v) {
    const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z;
    return dx * dx + dy * dy + dz * dz;
  }

  normalize() {
    const len = this.length();


    if (!Number.isFinite(len) || len < 1e-12) {
      this.set(0, 0, 0);
      return 0;
    }
    const inv = 1 / len;
    this.x *= inv;
    this.y *= inv;
    this.z *= inv;
    return len;
  }

  unit(target = new Vec3()) {
    target.copy(this);
    target.normalize();
    return target;
  }

  almostZero(eps = 1e-9) {
    return Math.abs(this.x) < eps && Math.abs(this.y) < eps && Math.abs(this.z) < eps;
  }

  isFiniteVec() {
    return Number.isFinite(this.x) && Number.isFinite(this.y) && Number.isFinite(this.z);
  }
}

export class Quaternion {
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
  }

  set(x, y, z, w) {
    this.x = x;
    this.y = y;
    this.z = z;
    this.w = w;
    return this;
  }

  copy(q) {
    this.x = q.x;
    this.y = q.y;
    this.z = q.z;
    this.w = q.w;
    return this;
  }

  clone() {
    return new Quaternion(this.x, this.y, this.z, this.w);
  }

  mult(q, target = new Quaternion()) {
    const ax = this.x, ay = this.y, az = this.z, aw = this.w;
    const bx = q.x, by = q.y, bz = q.z, bw = q.w;
    target.x = aw * bx + ax * bw + ay * bz - az * by;
    target.y = aw * by - ax * bz + ay * bw + az * bx;
    target.z = aw * bz + ax * by - ay * bx + az * bw;
    target.w = aw * bw - ax * bx - ay * by - az * bz;
    return target;
  }

  conjugate(target = new Quaternion()) {
    target.x = -this.x;
    target.y = -this.y;
    target.z = -this.z;
    target.w = this.w;
    return target;
  }

  normalize() {
    let len = Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z + this.w * this.w);


    if (!Number.isFinite(len) || len < 1e-12) {
      this.set(0, 0, 0, 1);
      return this;
    }
    len = 1 / len;
    this.x *= len;
    this.y *= len;
    this.z *= len;
    this.w *= len;
    return this;
  }

  vmult(v, target = new Vec3()) {
    const qx = this.x, qy = this.y, qz = this.z, qw = this.w;
    const tx = 2 * (qy * v.z - qz * v.y);
    const ty = 2 * (qz * v.x - qx * v.z);
    const tz = 2 * (qx * v.y - qy * v.x);
    target.x = v.x + qw * tx + (qy * tz - qz * ty);
    target.y = v.y + qw * ty + (qz * tx - qx * tz);
    target.z = v.z + qw * tz + (qx * ty - qy * tx);
    return target;
  }

  setFromAxisAngle(axis, angle) {
    const half = angle * 0.5;
    const s = Math.sin(half);
    this.x = axis.x * s;
    this.y = axis.y * s;
    this.z = axis.z * s;
    this.w = Math.cos(half);
    return this;
  }

  integrate(angularVelocity, dt) {
    const half = dt * 0.5;
    const wx = angularVelocity.x, wy = angularVelocity.y, wz = angularVelocity.z;
    const qx = this.x, qy = this.y, qz = this.z, qw = this.w;
    this.x += half * (wx * qw + wy * qz - wz * qy);
    this.y += half * (wy * qw + wz * qx - wx * qz);
    this.z += half * (wz * qw + wx * qy - wy * qx);
    this.w += half * (-wx * qx - wy * qy - wz * qz);
    return this.normalize();
  }
}

export class Mat3 {
  constructor() {
    this.e = [1, 0, 0, 0, 1, 0, 0, 0, 1];
  }

  identity() {
    const e = this.e;
    e[0] = 1; e[1] = 0; e[2] = 0;
    e[3] = 0; e[4] = 1; e[5] = 0;
    e[6] = 0; e[7] = 0; e[8] = 1;
    return this;
  }

  setZero() {
    const e = this.e;
    for (let i = 0; i < 9; i++) e[i] = 0;
    return this;
  }

  copy(m) {
    for (let i = 0; i < 9; i++) this.e[i] = m.e[i];
    return this;
  }

  setDiagonal(x, y, z) {
    this.setZero();
    this.e[0] = x;
    this.e[4] = y;
    this.e[8] = z;
    return this;
  }

  setRotationFromQuaternion(q) {
    const x = q.x, y = q.y, z = q.z, w = q.w;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    const e = this.e;
    e[0] = 1 - (yy + zz); e[1] = xy - wz; e[2] = xz + wy;
    e[3] = xy + wz; e[4] = 1 - (xx + zz); e[5] = yz - wx;
    e[6] = xz - wy; e[7] = yz + wx; e[8] = 1 - (xx + yy);
    return this;
  }

  transpose(target = new Mat3()) {
    const e = this.e, t = target.e;
    const a1 = e[1], a2 = e[2], a5 = e[5];
    t[0] = e[0]; t[4] = e[4]; t[8] = e[8];
    t[1] = e[3]; t[2] = e[6]; t[5] = e[7];
    t[3] = a1; t[6] = a2; t[7] = a5;
    return target;
  }

  mmult(m, target = new Mat3()) {
    const a = this.e, b = m.e;
    const r = [0, 0, 0, 0, 0, 0, 0, 0, 0];
    for (let row = 0; row < 3; row++) {
      for (let col = 0; col < 3; col++) {
        r[row * 3 + col] =
          a[row * 3] * b[col] +
          a[row * 3 + 1] * b[3 + col] +
          a[row * 3 + 2] * b[6 + col];
      }
    }
    for (let i = 0; i < 9; i++) target.e[i] = r[i];
    return target;
  }

  vmult(v, target = new Vec3()) {
    const e = this.e;
    const x = v.x, y = v.y, z = v.z;
    target.x = e[0] * x + e[1] * y + e[2] * z;
    target.y = e[3] * x + e[4] * y + e[5] * z;
    target.z = e[6] * x + e[7] * y + e[8] * z;
    return target;
  }

  add(m, target = new Mat3()) {
    for (let i = 0; i < 9; i++) target.e[i] = this.e[i] + m.e[i];
    return target;
  }

  sub(m, target = new Mat3()) {
    for (let i = 0; i < 9; i++) target.e[i] = this.e[i] - m.e[i];
    return target;
  }

  invert(target = new Mat3()) {
    const e = this.e;
    const a = e[0], b = e[1], c = e[2];
    const d = e[3], f = e[4], g = e[5];
    const h = e[6], i = e[7], j = e[8];
    const A = f * j - g * i;
    const B = g * h - d * j;
    const C = d * i - f * h;
    const det = a * A + b * B + c * C;
    if (!Number.isFinite(det) || Math.abs(det) < 1e-18) {
      target.setZero();
      return target;
    }
    const inv = 1 / det;
    const t = target.e;
    t[0] = A * inv;
    t[1] = (c * i - b * j) * inv;
    t[2] = (b * g - c * f) * inv;
    t[3] = B * inv;
    t[4] = (a * j - c * h) * inv;
    t[5] = (c * d - a * g) * inv;
    t[6] = C * inv;
    t[7] = (b * h - a * i) * inv;
    t[8] = (a * f - b * d) * inv;
    return target;
  }
}

export function setSkew(m, v) {
  const e = m.e;
  e[0] = 0; e[1] = -v.z; e[2] = v.y;
  e[3] = v.z; e[4] = 0; e[5] = -v.x;
  e[6] = -v.y; e[7] = v.x; e[8] = 0;
  return m;
}

export function buildTangents(n, t1, t2) {
  if (Math.abs(n.x) > 0.57735) {
    t1.set(n.y, -n.x, 0);
  } else {
    t1.set(0, n.z, -n.y);
  }
  t1.normalize();
  n.cross(t1, t2);
  t2.normalize();
}
