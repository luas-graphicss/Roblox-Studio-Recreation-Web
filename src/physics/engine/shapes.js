import { Vec3, Mat3 } from "./math3d.js";

let nextShapeId = 0;

export const SHAPE = Object.freeze({ SPHERE: 1, CONVEX: 2, SDF: 3 });

export class Shape {
  constructor(type) {
    this.id = ++nextShapeId;
    this.type = type;
    this.collisionResponse = true;
    this.body = null;
    this.boundingRadius = 0;
  }
}

export class Sphere extends Shape {
  constructor(radius) {
    super(SHAPE.SPHERE);
    const r = Number(radius);
    this.radius = Number.isFinite(r) && r > 0.005 ? r : 0.005;
    this.boundingRadius = this.radius;
  }

  volume() {
    return (4 / 3) * Math.PI * this.radius * this.radius * this.radius;
  }

  computeLocalInertia(mass, target = new Mat3()) {
    const i = (2 / 5) * mass * this.radius * this.radius;
    target.setDiagonal(i, i, i);
    return target;
  }
}

export class ConvexPolyhedron extends Shape {
  constructor(options = {}) {
    super(SHAPE.CONVEX);
    const vertices = Array.isArray(options.vertices) ? options.vertices : [];
    const faces = Array.isArray(options.faces) ? options.faces : [];


    const finiteCoord = (n) => {
      const x = Number(n);
      return Number.isFinite(x) ? x : 0;
    };
    this.vertices = vertices.map(
      (v) => new Vec3(finiteCoord(v && v.x), finiteCoord(v && v.y), finiteCoord(v && v.z)),
    );
    const vertCount = this.vertices.length;
    this.faces = faces
      .filter(
        (f) =>
          Array.isArray(f) &&
          f.length >= 3 &&
          f.every((i) => Number.isInteger(i) && i >= 0 && i < vertCount),
      )
      .map((f) => f.slice());
    this.centroid = new Vec3();
    this.faceNormals = [];
    this.uniqueEdges = [];
    this.aabbLocalMin = new Vec3();
    this.aabbLocalMax = new Vec3();
    this.rebuildGeometry();
  }

  rebuildGeometry() {
    const verts = this.vertices;
    const c = this.centroid.set(0, 0, 0);
    for (const v of verts) {
      c.x += v.x;
      c.y += v.y;
      c.z += v.z;
    }
    if (verts.length > 0) c.scale(1 / verts.length, c);

    this.faceNormals = this.faces.map((f) => {
      const n = new Vec3();
      for (let i = 0; i < f.length; i++) {
        const va = verts[f[i]];
        const vb = verts[f[(i + 1) % f.length]];
        n.x += (va.y - vb.y) * (va.z + vb.z);
        n.y += (va.z - vb.z) * (va.x + vb.x);
        n.z += (va.x - vb.x) * (va.y + vb.y);
      }
      n.normalize();
      if (n.dot(verts[f[0]].vsub(c)) < 0) n.negate(n);
      return n;
    });

    this.uniqueEdges = [];
    for (const f of this.faces) {
      for (let i = 0; i < f.length; i++) {
        const e = verts[f[(i + 1) % f.length]].vsub(verts[f[i]]);
        if (e.normalize() < 1e-9) continue;
        let dup = false;
        for (const u of this.uniqueEdges) {
          if (Math.abs(u.dot(e)) > 0.9999) {
            dup = true;
            break;
          }
        }
        if (!dup) this.uniqueEdges.push(e);
      }
    }

    let br = 0;
    const lo = this.aabbLocalMin.set(Infinity, Infinity, Infinity);
    const hi = this.aabbLocalMax.set(-Infinity, -Infinity, -Infinity);
    for (const v of verts) {
      br = Math.max(br, v.length());
      lo.x = Math.min(lo.x, v.x);
      lo.y = Math.min(lo.y, v.y);
      lo.z = Math.min(lo.z, v.z);
      hi.x = Math.max(hi.x, v.x);
      hi.y = Math.max(hi.y, v.y);
      hi.z = Math.max(hi.z, v.z);
    }
    if (verts.length === 0) {
      lo.set(0, 0, 0);
      hi.set(0, 0, 0);
    }
    this.boundingRadius = br;
  }

  volume() {
    let vol = 0;
    const c = this.centroid;
    for (const f of this.faces) {
      const a = this.vertices[f[0]];
      for (let i = 1; i + 1 < f.length; i++) {
        const b = this.vertices[f[i]];
        const d = this.vertices[f[i + 1]];
        const ab = a.vsub(c);
        const bb = b.vsub(c);
        const db = d.vsub(c);
        vol += Math.abs(ab.dot(bb.cross(db))) / 6;
      }
    }
    return Math.max(vol, 1e-6);
  }

  computeLocalInertia(mass, target = new Mat3()) {
    const lo = this.aabbLocalMin, hi = this.aabbLocalMax;
    const ex = Math.max(0.01, hi.x - lo.x);
    const ey = Math.max(0.01, hi.y - lo.y);
    const ez = Math.max(0.01, hi.z - lo.z);
    target.setDiagonal(
      (mass / 12) * (ey * ey + ez * ez),
      (mass / 12) * (ex * ex + ez * ez),
      (mass / 12) * (ex * ex + ey * ey),
    );
    return target;
  }
}


function sanitizeHalfExtent(v) {
  if (v == null) return 0.5;
  const n = Math.abs(Number(v));
  if (!Number.isFinite(n)) return 0.5;
  return Math.max(0.005, n);
}

export class Box extends ConvexPolyhedron {
  constructor(halfExtents) {
    const hx = sanitizeHalfExtent(halfExtents && halfExtents.x);
    const hy = sanitizeHalfExtent(halfExtents && halfExtents.y);
    const hz = sanitizeHalfExtent(halfExtents && halfExtents.z);
    super({
      vertices: [
        { x: -hx, y: -hy, z: -hz },
        { x: hx, y: -hy, z: -hz },
        { x: hx, y: hy, z: -hz },
        { x: -hx, y: hy, z: -hz },
        { x: -hx, y: -hy, z: hz },
        { x: hx, y: -hy, z: hz },
        { x: hx, y: hy, z: hz },
        { x: -hx, y: hy, z: hz },
      ],
      faces: [
        [0, 3, 2, 1],
        [4, 5, 6, 7],
        [0, 1, 5, 4],
        [3, 7, 6, 2],
        [0, 4, 7, 3],
        [1, 2, 6, 5],
      ],
    });
    this.halfExtents = new Vec3(hx, hy, hz);
  }

  volume() {
    const h = this.halfExtents;
    return 8 * h.x * h.y * h.z;
  }

  computeLocalInertia(mass, target = new Mat3()) {
    const h = this.halfExtents;
    const ex = 2 * h.x, ey = 2 * h.y, ez = 2 * h.z;
    target.setDiagonal(
      (mass / 12) * (ey * ey + ez * ez),
      (mass / 12) * (ex * ex + ez * ez),
      (mass / 12) * (ex * ex + ey * ey),
    );
    return target;
  }
}


export class ImplicitSurface extends Shape {
  constructor(options = {}) {
    super(SHAPE.SDF);
    this.sample = typeof options.sample === "function" ? options.sample : null;
    const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
    const b = options.bounds || {};
    const bmin = b.min || {};
    const bmax = b.max || {};
    const x0 = num(bmin.x, -1e6), y0 = num(bmin.y, -1e6), z0 = num(bmin.z, -1e6);
    const x1 = num(bmax.x, 1e6), y1 = num(bmax.y, 1e6), z1 = num(bmax.z, 1e6);
    this.boundsMin = new Vec3(Math.min(x0, x1), Math.min(y0, y1), Math.min(z0, z1));
    this.boundsMax = new Vec3(Math.max(x0, x1), Math.max(y0, y1), Math.max(z0, z1));


    this.center = new Vec3(
      (this.boundsMin.x + this.boundsMax.x) / 2,
      (this.boundsMin.y + this.boundsMax.y) / 2,
      (this.boundsMin.z + this.boundsMax.z) / 2,
    );
    const dx = (this.boundsMax.x - this.boundsMin.x) / 2;
    const dy = (this.boundsMax.y - this.boundsMin.y) / 2;
    const dz = (this.boundsMax.z - this.boundsMin.z) / 2;
    this.boundingRadius = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const md = num(options.maxDepth, 4);
    this.maxDepth = md > 0 ? md : 4;
  }

  volume() {
    return 1e-6;                                                           
  }

  computeLocalInertia(mass, target = new Mat3()) {
    target.setDiagonal(mass, mass, mass);
    return target;
  }
}

export class Cylinder extends ConvexPolyhedron {
  constructor(radiusTop = 1, radiusBottom = 1, height = 1, numSegments = 12) {
    const rt = Math.max(0.005, Math.abs(radiusTop));
    const rb = Math.max(0.005, Math.abs(radiusBottom));
    const h = Math.max(0.01, Math.abs(height)) / 2;
    const n = Math.min(32, Math.max(6, Math.floor(numSegments) || 12));
    const vertices = [];
    for (let i = 0; i < n; i++) {
      const theta = (2 * Math.PI * i) / n;
      vertices.push({ x: rt * Math.cos(theta), y: h, z: rt * Math.sin(theta) });
    }
    for (let i = 0; i < n; i++) {
      const theta = (2 * Math.PI * i) / n;
      vertices.push({ x: rb * Math.cos(theta), y: -h, z: rb * Math.sin(theta) });
    }
    const faces = [];
    const top = [];
    const bottom = [];
    for (let i = 0; i < n; i++) {
      top.push(i);
      bottom.push(n + (n - 1 - i));
      const i2 = (i + 1) % n;
      faces.push([i, i2, n + i2, n + i]);
    }
    faces.push(top);
    faces.push(bottom);
    super({ vertices, faces });
    this.radiusTop = rt;
    this.radiusBottom = rb;
    this.height = h * 2;
  }


  computeLocalInertia(mass, target = new Mat3()) {
    const r2 = (this.radiusTop * this.radiusTop + this.radiusBottom * this.radiusBottom) / 2;
    const h2 = this.height * this.height;
    const ixz = (mass / 12) * (3 * r2 + h2);
    target.setDiagonal(ixz, (mass / 2) * r2, ixz);
    return target;
  }
}
