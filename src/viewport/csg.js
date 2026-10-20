const MAX_INPUT_TRIANGLES = 150000;
const MAX_FRAGMENTS_PER_POLYGON = 512;
const LEAF_SIZE = 4;
const RAY_ATTEMPTS = 8;
const ALIGN_COS = 0.999;

const OUTSIDE = 0;
const INSIDE = 1;
const COPLANAR_SAME = 2;
const COPLANAR_OPP = 3;

class Vec {
  constructor(x, y, z) { this.x = x; this.y = y; this.z = z; }
  clone() { return new Vec(this.x, this.y, this.z); }
  negated() { return new Vec(-this.x, -this.y, -this.z); }
  plus(a) { return new Vec(this.x + a.x, this.y + a.y, this.z + a.z); }
  minus(a) { return new Vec(this.x - a.x, this.y - a.y, this.z - a.z); }
  times(s) { return new Vec(this.x * s, this.y * s, this.z * s); }
  dot(a) { return this.x * a.x + this.y * a.y + this.z * a.z; }
  lerp(a, t) { return this.plus(a.minus(this).times(t)); }
  length() { return Math.sqrt(this.dot(this)); }
  unit() { const l = this.length() || 1; return this.times(1 / l); }
  cross(a) {
    return new Vec(
      this.y * a.z - this.z * a.y,
      this.z * a.x - this.x * a.z,
      this.x * a.y - this.y * a.x,
    );
  }
  isFinite() { return Number.isFinite(this.x) && Number.isFinite(this.y) && Number.isFinite(this.z); }
}

class Vertex {
  constructor(pos, normal) { this.pos = pos; this.normal = normal; }
  clone() { return new Vertex(this.pos.clone(), this.normal.clone()); }
  flipped() { return new Vertex(this.pos.clone(), this.normal.negated()); }
  interpolate(other, t) {
    return new Vertex(this.pos.lerp(other.pos, t), this.normal.lerp(other.normal, t));
  }
}

class Polygon {
  constructor(vertices, plane) { this.vertices = vertices; this.plane = plane; }

  static create(vertices, plane) {
    if (!Array.isArray(vertices) || vertices.length < 3) return null;
    for (const v of vertices) {
      if (!v.pos.isFinite()) return null;
    }
    let maxE2 = 0;
    for (let i = 0; i < vertices.length; i++) {
      const a = vertices[i].pos;
      const b = vertices[(i + 1) % vertices.length].pos;
      const d = b.minus(a);
      const e2 = d.dot(d);
      if (e2 > maxE2) maxE2 = e2;
    }
    if (!(maxE2 > 0)) return null;
    const weldEps2 = maxE2 * 1e-18;
    const pts = [];
    for (const v of vertices) {
      const prev = pts.length ? pts[pts.length - 1].pos : null;
      if (prev) {
        const d = v.pos.minus(prev);
        if (d.dot(d) <= weldEps2) continue;
      }
      pts.push(v);
    }
    while (pts.length >= 3) {
      const d = pts[0].pos.minus(pts[pts.length - 1].pos);
      if (d.dot(d) <= weldEps2) pts.pop();
      else break;
    }
    if (pts.length < 3) return null;
    let nx = 0, ny = 0, nz = 0, cx = 0, cy = 0, cz = 0;
    for (let i = 0; i < pts.length; i++) {
      const a = pts[i].pos;
      const b = pts[(i + 1) % pts.length].pos;
      nx += (a.y - b.y) * (a.z + b.z);
      ny += (a.z - b.z) * (a.x + b.x);
      nz += (a.x - b.x) * (a.y + b.y);
      cx += a.x; cy += a.y; cz += a.z;
    }
    const nl = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (!Number.isFinite(nl) || nl <= maxE2 * 1e-9) return null;
    if (!plane) {
      const normal = new Vec(nx / nl, ny / nl, nz / nl);
      const inv = 1 / pts.length;
      plane = { normal, w: normal.dot(new Vec(cx * inv, cy * inv, cz * inv)) };
    }
    return new Polygon(pts, plane);
  }

  clone() {
    return new Polygon(
      this.vertices.map((v) => v.clone()),
      { normal: this.plane.normal.clone(), w: this.plane.w },
    );
  }

  flipped() {
    const vs = [];
    for (let i = this.vertices.length - 1; i >= 0; i--) vs.push(this.vertices[i].flipped());
    return new Polygon(vs, { normal: this.plane.normal.negated(), w: -this.plane.w });
  }

  centroid() {
    let x = 0, y = 0, z = 0;
    for (const v of this.vertices) { x += v.pos.x; y += v.pos.y; z += v.pos.z; }
    const inv = 1 / this.vertices.length;
    return new Vec(x * inv, y * inv, z * inv);
  }
}

class BVH {
  constructor(polys) {
    const n = polys.length;
    this.polys = polys;
    this.pmin = new Float64Array(n * 3);
    this.pmax = new Float64Array(n * 3);
    this.cen = new Float64Array(n * 3);
    for (let i = 0; i < n; i++) {
      let ax = Infinity, ay = Infinity, az = Infinity;
      let bx = -Infinity, by = -Infinity, bz = -Infinity;
      for (const v of polys[i].vertices) {
        const p = v.pos;
        if (p.x < ax) ax = p.x; if (p.x > bx) bx = p.x;
        if (p.y < ay) ay = p.y; if (p.y > by) by = p.y;
        if (p.z < az) az = p.z; if (p.z > bz) bz = p.z;
      }
      this.pmin[i * 3] = ax; this.pmin[i * 3 + 1] = ay; this.pmin[i * 3 + 2] = az;
      this.pmax[i * 3] = bx; this.pmax[i * 3 + 1] = by; this.pmax[i * 3 + 2] = bz;
      this.cen[i * 3] = (ax + bx) / 2;
      this.cen[i * 3 + 1] = (ay + by) / 2;
      this.cen[i * 3 + 2] = (az + bz) / 2;
    }
    const items = new Array(n);
    for (let i = 0; i < n; i++) items[i] = i;
    this.root = n ? this._build(items, 0, n) : null;
  }

  _build(items, lo, hi) {
    let ax = Infinity, ay = Infinity, az = Infinity;
    let bx = -Infinity, by = -Infinity, bz = -Infinity;
    for (let k = lo; k < hi; k++) {
      const i = items[k];
      if (this.pmin[i * 3] < ax) ax = this.pmin[i * 3];
      if (this.pmin[i * 3 + 1] < ay) ay = this.pmin[i * 3 + 1];
      if (this.pmin[i * 3 + 2] < az) az = this.pmin[i * 3 + 2];
      if (this.pmax[i * 3] > bx) bx = this.pmax[i * 3];
      if (this.pmax[i * 3 + 1] > by) by = this.pmax[i * 3 + 1];
      if (this.pmax[i * 3 + 2] > bz) bz = this.pmax[i * 3 + 2];
    }
    const node = { min: [ax, ay, az], max: [bx, by, bz], items: null, left: null, right: null };
    if (hi - lo <= LEAF_SIZE) {
      node.items = items.slice(lo, hi);
      return node;
    }
    const ex = bx - ax, ey = by - ay, ez = bz - az;
    const axis = ex >= ey && ex >= ez ? 0 : ey >= ez ? 1 : 2;
    const seg = items.slice(lo, hi).sort((p, q) => this.cen[p * 3 + axis] - this.cen[q * 3 + axis]);
    for (let k = 0; k < seg.length; k++) items[lo + k] = seg[k];
    const mid = (lo + hi) >> 1;
    node.left = this._build(items, lo, mid);
    node.right = this._build(items, mid, hi);
    return node;
  }

  queryBox(qmin, qmax) {
    const out = [];
    if (!this.root) return out;
    const stack = [this.root];
    while (stack.length) {
      const node = stack.pop();
      if (
        node.min[0] > qmax[0] || node.max[0] < qmin[0] ||
        node.min[1] > qmax[1] || node.max[1] < qmin[1] ||
        node.min[2] > qmax[2] || node.max[2] < qmin[2]
      ) continue;
      if (node.items) {
        for (const i of node.items) {
          if (
            this.pmin[i * 3] <= qmax[0] && this.pmax[i * 3] >= qmin[0] &&
            this.pmin[i * 3 + 1] <= qmax[1] && this.pmax[i * 3 + 1] >= qmin[1] &&
            this.pmin[i * 3 + 2] <= qmax[2] && this.pmax[i * 3 + 2] >= qmin[2]
          ) out.push(i);
        }
      } else {
        stack.push(node.left, node.right);
      }
    }
    return out;
  }

  queryRay(o, d) {
    const out = [];
    if (!this.root) return out;
    const ox = [o.x, o.y, o.z];
    const dx = [d.x, d.y, d.z];
    const inv = [1 / d.x, 1 / d.y, 1 / d.z];
    const stack = [this.root];
    while (stack.length) {
      const node = stack.pop();
      let tmin = 0, tmax = Infinity, hit = true;
      for (let a = 0; a < 3; a++) {
        if (dx[a] === 0) {
          if (ox[a] < node.min[a] || ox[a] > node.max[a]) { hit = false; break; }
        } else {
          let t1 = (node.min[a] - ox[a]) * inv[a];
          let t2 = (node.max[a] - ox[a]) * inv[a];
          if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; }
          if (t1 > tmin) tmin = t1;
          if (t2 < tmax) tmax = t2;
          if (tmax < tmin) { hit = false; break; }
        }
      }
      if (!hit) continue;
      if (node.items) {
        for (const i of node.items) out.push(i);
      } else {
        stack.push(node.left, node.right);
      }
    }
    return out;
  }
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) >>> 0;
    let t = s;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeContext(aPolys, bPolys) {
  let ax = Infinity, ay = Infinity, az = Infinity;
  let bx = -Infinity, by = -Infinity, bz = -Infinity;
  for (const list of [aPolys, bPolys]) {
    for (const p of list) {
      for (const v of p.vertices) {
        const q = v.pos;
        if (q.x < ax) ax = q.x; if (q.x > bx) bx = q.x;
        if (q.y < ay) ay = q.y; if (q.y > by) by = q.y;
        if (q.z < az) az = q.z; if (q.z > bz) bz = q.z;
      }
    }
  }
  const extent = Math.max(bx - ax, by - ay, bz - az, 1e-3);
  const epsSplit = clamp(extent * 1e-8, 1e-9, 1e-4);
  const epsCop = clamp(extent * 5e-7, 1e-7, 5e-3);
  return {
    epsSplit,
    epsCop,
    epsSeg: Math.max(epsSplit * 4, extent * 1e-8),
    epsT: extent * 1e-7,
    rand: mulberry32(0x2f6e2b1d),
  };
}

function splitConvex(poly, n, w, eps) {
  const vs = poly.vertices;
  const d = new Array(vs.length);
  let hasF = false, hasB = false;
  for (let i = 0; i < vs.length; i++) {
    d[i] = n.dot(vs[i].pos) - w;
    if (d[i] > eps) hasF = true;
    else if (d[i] < -eps) hasB = true;
  }
  if (!hasF && !hasB) return { front: null, back: null };
  if (!hasB) return { front: poly, back: null };
  if (!hasF) return { front: null, back: poly };
  const f = [], b = [];
  for (let i = 0; i < vs.length; i++) {
    const j = (i + 1) % vs.length;
    const di = d[i], dj = d[j];
    const vi = vs[i];
    if (di >= -eps) f.push(vi);
    if (di <= eps) b.push(vi);
    if ((di > eps && dj < -eps) || (di < -eps && dj > eps)) {
      const v = vi.interpolate(vs[j], di / (di - dj));
      f.push(v);
      b.push(v);
    }
  }
  return {
    front: Polygon.create(f, poly.plane),
    back: Polygon.create(b, poly.plane),
  };
}

function crossInterval(poly, d, D, eps) {
  const vs = poly.vertices;
  const pts = [];
  for (let i = 0; i < vs.length; i++) {
    const j = (i + 1) % vs.length;
    const di = d[i], dj = d[j];
    if (Math.abs(di) <= eps) pts.push(vs[i].pos);
    else if ((di > eps && dj < -eps) || (di < -eps && dj > eps)) {
      pts.push(vs[i].pos.lerp(vs[j].pos, di / (di - dj)));
    }
  }
  if (pts.length < 2) return null;
  let t0 = Infinity, t1 = -Infinity, p0 = null, p1 = null;
  for (const p of pts) {
    const t = D.dot(p);
    if (t < t0) { t0 = t; p0 = p; }
    if (t > t1) { t1 = t; p1 = p; }
  }
  if (!(t1 - t0 > 0)) return null;
  return { t0, t1, p0, p1 };
}

function triIntersect(P, Q, ctx) {
  const nQ = Q.plane.normal, wQ = Q.plane.w;
  const dP = new Array(P.vertices.length);
  let copl = true;
  for (let i = 0; i < P.vertices.length; i++) {
    dP[i] = nQ.dot(P.vertices[i].pos) - wQ;
    if (Math.abs(dP[i]) > ctx.epsCop) copl = false;
  }
  const nP = P.plane.normal, wP = P.plane.w;
  if (copl && Math.abs(nP.dot(nQ)) > ALIGN_COS) return { coplanar: true };
  let allF = true, allB = true;
  for (const v of dP) {
    if (v <= ctx.epsSplit) allF = false;
    if (v >= -ctx.epsSplit) allB = false;
  }
  if (allF || allB) return null;
  const dQ = new Array(Q.vertices.length);
  allF = true; allB = true;
  for (let i = 0; i < Q.vertices.length; i++) {
    dQ[i] = nP.dot(Q.vertices[i].pos) - wP;
    if (dQ[i] <= ctx.epsSplit) allF = false;
    if (dQ[i] >= -ctx.epsSplit) allB = false;
  }
  if (allF || allB) return null;
  const dirRaw = nP.cross(nQ);
  if (dirRaw.length() < 1e-9) return null;
  const D = dirRaw.unit();
  const iP = crossInterval(P, dP, D, ctx.epsSplit);
  const iQ = crossInterval(Q, dQ, D, ctx.epsSplit);
  if (!iP || !iQ) return null;
  const lo = Math.max(iP.t0, iQ.t0);
  const hi = Math.min(iP.t1, iQ.t1);
  if (hi - lo <= ctx.epsSeg) return null;
  return {
    a: iP.t0 >= iQ.t0 ? iP.p0 : iQ.p0,
    b: iP.t1 <= iQ.t1 ? iP.p1 : iQ.p1,
  };
}

function addSegmentCutter(poly, a, b, cutters) {
  const n = poly.plane.normal.cross(b.minus(a));
  const nl = n.length();
  if (nl < 1e-12) return;
  const un = n.times(1 / nl);
  cutters.push({ n: un, w: un.dot(a) });
}

function addEdgeCutters(q, cutters) {
  const vs = q.vertices;
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i].pos;
    const b = vs[(i + 1) % vs.length].pos;
    const n = q.plane.normal.cross(b.minus(a));
    const nl = n.length();
    if (nl < 1e-12) continue;
    const un = n.times(1 / nl);
    cutters.push({ n: un, w: un.dot(a) });
  }
}

function fragmentPolygon(poly, otherPolys, otherBVH, ctx) {
  let ax = Infinity, ay = Infinity, az = Infinity;
  let bx = -Infinity, by = -Infinity, bz = -Infinity;
  for (const v of poly.vertices) {
    const p = v.pos;
    if (p.x < ax) ax = p.x; if (p.x > bx) bx = p.x;
    if (p.y < ay) ay = p.y; if (p.y > by) by = p.y;
    if (p.z < az) az = p.z; if (p.z > bz) bz = p.z;
  }
  const pad = ctx.epsCop;
  const cand = otherBVH.queryBox([ax - pad, ay - pad, az - pad], [bx + pad, by + pad, bz + pad]);
  if (!cand.length) return [poly];
  const cutters = [];
  for (const qi of cand) {
    const q = otherPolys[qi];
    const r = triIntersect(poly, q, ctx);
    if (!r) continue;
    if (r.coplanar) addEdgeCutters(q, cutters);
    else addSegmentCutter(poly, r.a, r.b, cutters);
  }
  if (!cutters.length) return [poly];
  let frags = [poly];
  for (const c of cutters) {
    if (frags.length >= MAX_FRAGMENTS_PER_POLYGON) break;
    const next = [];
    for (const f of frags) {
      const s = splitConvex(f, c.n, c.w, ctx.epsSplit);
      if (s.front) next.push(s.front);
      if (s.back) next.push(s.back);
      if (!s.front && !s.back) next.push(f);
    }
    frags = next;
  }
  return frags;
}

function pointInConvex(p, poly, eps) {
  const vs = poly.vertices;
  const n = poly.plane.normal;
  let graze = false;
  for (let i = 0; i < vs.length; i++) {
    const a = vs[i].pos;
    const b = vs[(i + 1) % vs.length].pos;
    const e = b.minus(a);
    const el = e.length();
    if (el < 1e-12) continue;
    const s = e.cross(p.minus(a)).dot(n) / el;
    if (s < -eps) return 0;
    if (s <= eps) graze = true;
  }
  return graze ? -1 : 1;
}

function coplanarHit(c, n, otherPolys, otherBVH, ctx) {
  const pad = ctx.epsCop;
  const cand = otherBVH.queryBox([c.x - pad, c.y - pad, c.z - pad], [c.x + pad, c.y + pad, c.z + pad]);
  for (const qi of cand) {
    const q = otherPolys[qi];
    const align = n.dot(q.plane.normal);
    if (Math.abs(align) < ALIGN_COS) continue;
    if (Math.abs(q.plane.normal.dot(c) - q.plane.w) > ctx.epsCop) continue;
    if (pointInConvex(c, q, ctx.epsCop) !== 1) continue;
    return align > 0 ? COPLANAR_SAME : COPLANAR_OPP;
  }
  return null;
}

function rayParity(c, dir, otherPolys, otherBVH, ctx) {
  const hits = otherBVH.queryRay(c, dir);
  let count = 0;
  for (const qi of hits) {
    const q = otherPolys[qi];
    const n = q.plane.normal;
    const denom = n.dot(dir);
    if (Math.abs(denom) < 1e-9) {
      if (Math.abs(n.dot(c) - q.plane.w) <= ctx.epsCop) return null;
      continue;
    }
    const t = (q.plane.w - n.dot(c)) / denom;
    if (t <= ctx.epsT) {
      if (t > -ctx.epsT) {
        const pTouch = c.plus(dir.times(t));
        if (pointInConvex(pTouch, q, ctx.epsCop) !== 0) return null;
      }
      continue;
    }
    const p = c.plus(dir.times(t));
    const side = pointInConvex(p, q, ctx.epsCop);
    if (side === -1) return null;
    if (side === 1) count++;
  }
  return { inside: count % 2 === 1 };
}

function solidAngle(c, pa, pb, pc) {
  const a = pa.minus(c), b = pb.minus(c), d = pc.minus(c);
  const la = a.length(), lb = b.length(), ld = d.length();
  if (la < 1e-12 || lb < 1e-12 || ld < 1e-12) return 0;
  const det = a.dot(b.cross(d));
  const div = la * lb * ld + a.dot(b) * ld + b.dot(d) * la + d.dot(a) * lb;
  return 2 * Math.atan2(det, div);
}

function windingNumber(c, polys) {
  let sum = 0;
  for (const q of polys) {
    const vs = q.vertices;
    for (let i = 2; i < vs.length; i++) {
      sum += solidAngle(c, vs[0].pos, vs[i - 1].pos, vs[i].pos);
    }
  }
  return sum / (4 * Math.PI);
}

function randomDir(ctx) {
  const u = ctx.rand() * 2 - 1;
  const a = ctx.rand() * 2 * Math.PI;
  const s = Math.sqrt(Math.max(0, 1 - u * u));
  return new Vec(s * Math.cos(a), s * Math.sin(a), u);
}

function classifyFragment(frag, otherPolys, otherBVH, ctx) {
  const c = frag.centroid();
  const cop = coplanarHit(c, frag.plane.normal, otherPolys, otherBVH, ctx);
  if (cop !== null) return cop;
  for (let k = 0; k < RAY_ATTEMPTS; k++) {
    const r = rayParity(c, randomDir(ctx), otherPolys, otherBVH, ctx);
    if (r !== null) return r.inside ? INSIDE : OUTSIDE;
  }
  return windingNumber(c, otherPolys) > 0.5 ? INSIDE : OUTSIDE;
}

function keepFragment(cls, op, isB) {
  if (op === "union") {
    return isB ? cls === OUTSIDE : cls === OUTSIDE || cls === COPLANAR_SAME;
  }
  if (op === "intersect") {
    return isB ? cls === INSIDE : cls === INSIDE || cls === COPLANAR_SAME;
  }
  return isB ? cls === INSIDE : cls === OUTSIDE || cls === COPLANAR_OPP;
}

function collectSide(polys, otherPolys, otherBVH, op, isB, ctx, out) {
  const flip = isB && op === "subtract";
  for (const poly of polys) {
    const frags = fragmentPolygon(poly, otherPolys, otherBVH, ctx);
    for (const f of frags) {
      const cls = classifyFragment(f, otherPolys, otherBVH, ctx);
      if (!keepFragment(cls, op, isB)) continue;
      out.push(flip ? f.flipped() : f);
    }
  }
}

function countTriangles(polys) {
  let t = 0;
  for (const p of polys) t += Math.max(0, p.vertices.length - 2);
  return t;
}

function boolOp(aPolys, bPolys, op) {
  if (op === "union") {
    if (!aPolys.length) return bPolys.slice();
    if (!bPolys.length) return aPolys.slice();
  } else if (op === "subtract") {
    if (!aPolys.length) return [];
    if (!bPolys.length) return aPolys.slice();
  } else if (!aPolys.length || !bPolys.length) {
    return [];
  }
  if (countTriangles(aPolys) + countTriangles(bPolys) > MAX_INPUT_TRIANGLES) {
    throw new Error(`Operação CSG excede ${MAX_INPUT_TRIANGLES} triângulos.`);
  }
  const ctx = makeContext(aPolys, bPolys);
  const bvhA = new BVH(aPolys);
  const bvhB = new BVH(bPolys);
  const out = [];
  collectSide(aPolys, bPolys, bvhB, op, false, ctx, out);
  collectSide(bPolys, aPolys, bvhA, op, true, ctx, out);
  return out;
}

export class CSG {
  constructor() { this.polygons = []; }

  static fromPolygons(polygons) {
    const csg = new CSG();
    csg.polygons = polygons;
    return csg;
  }

  clone() {
    const csg = new CSG();
    csg.polygons = this.polygons.map((p) => p.clone());
    return csg;
  }

  toPolygons() { return this.polygons; }

  union(csg) { return CSG.fromPolygons(boolOp(this.polygons, csg.polygons, "union")); }

  subtract(csg) { return CSG.fromPolygons(boolOp(this.polygons, csg.polygons, "subtract")); }

  intersect(csg) { return CSG.fromPolygons(boolOp(this.polygons, csg.polygons, "intersect")); }

  static fromGeometry(THREE, geometry) {
    const geo = geometry.index ? geometry.toNonIndexed() : geometry;
    const pos = geo.getAttribute("position");
    const norm = geo.getAttribute("normal");
    const polygons = [];
    for (let i = 0; i < pos.count; i += 3) {
      const verts = [];
      for (let k = 0; k < 3; k++) {
        const idx = i + k;
        const p = new Vec(pos.getX(idx), pos.getY(idx), pos.getZ(idx));
        const n = norm
          ? new Vec(norm.getX(idx), norm.getY(idx), norm.getZ(idx))
          : new Vec(0, 0, 0);
        verts.push(new Vertex(p, n.isFinite() ? n : new Vec(0, 0, 0)));
      }
      const poly = Polygon.create(verts);
      if (poly) polygons.push(poly);
    }
    if (geo !== geometry && geo.dispose) geo.dispose();
    return CSG.fromPolygons(polygons);
  }

  static toGeometry(THREE, csg) {
    const positions = [];
    const normals = [];
    for (const poly of csg.polygons) {
      const vs = poly.vertices;
      for (let i = 2; i < vs.length; i++) {
        const tri = [vs[0], vs[i - 1], vs[i]];
        for (const v of tri) {
          positions.push(v.pos.x, v.pos.y, v.pos.z);
          const n = v.normal && v.normal.length() > 1e-6 ? v.normal.unit() : poly.plane.normal;
          normals.push(n.x, n.y, n.z);
        }
      }
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(normals, 3));
    if (positions.length) {
      geo.computeBoundingSphere();
      geo.computeBoundingBox();
    }
    return geo;
  }

  static fromArrays(positions, normals) {
    const polygons = [];
    for (let i = 0; i + 8 < positions.length; i += 9) {
      const verts = [];
      for (let k = 0; k < 3; k++) {
        const b = i + k * 3;
        const p = new Vec(positions[b], positions[b + 1], positions[b + 2]);
        const n = normals
          ? new Vec(normals[b] || 0, normals[b + 1] || 0, normals[b + 2] || 0)
          : new Vec(0, 0, 0);
        verts.push(new Vertex(p, n.isFinite() ? n : new Vec(0, 0, 0)));
      }
      const poly = Polygon.create(verts);
      if (poly) polygons.push(poly);
    }
    return CSG.fromPolygons(polygons);
  }

  static toArrays(csg) {
    const positions = [];
    const normals = [];
    for (const poly of csg.polygons) {
      const vs = poly.vertices;
      for (let i = 2; i < vs.length; i++) {
        const tri = [vs[0], vs[i - 1], vs[i]];
        for (const v of tri) {
          positions.push(v.pos.x, v.pos.y, v.pos.z);
          const n = v.normal && v.normal.length() > 1e-6 ? v.normal.unit() : poly.plane.normal;
          normals.push(n.x, n.y, n.z);
        }
      }
    }
    return { positions, normals };
  }
}
