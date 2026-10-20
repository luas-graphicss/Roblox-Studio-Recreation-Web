export const RT_SHADOWS_VERSION = "rt-shadows-7a";
export const BVH_MAX_TRIS = 1048576;                                             
export const BVH_MAX_DEPTH = 48;                                                
export const BVH_LEAF_SIZE = 4;                                
export const RT_SHADOW_TMIN = 1e-3;                                      
export const RT_MAX_SAMPLES = 16;                                 
export const RT_TRAVERSAL_STACK = 64;                             
export const BVH_GPU_LAYOUT = "rsw-bvh-gpu-1";
const TRI_EPS = 1e-7;                                 
const UV_EPS = 1e-7;                               

function num(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

function fract(v) {
  return v - Math.floor(v);
}


export function ign(x, y, frame) {
  const f = ((Math.floor(num(frame, 0)) % 64) + 64) % 64;
  const off = 5.588238 * f;
  return fract(52.9829189 * fract(0.06711056 * (num(x, 0) + off) + 0.00583715 * (num(y, 0) + off)));
}


export function buildBvh(triangles, opts) {
  const o = opts || {};
  const leafSize = Math.round(clamp(num(o.leafSize, BVH_LEAF_SIZE), 1, 16));
  const maxTris = Math.min(BVH_MAX_TRIS, Math.max(1, Math.floor(num(o.maxTris, BVH_MAX_TRIS))));
  const tris = triangles instanceof Float32Array ? triangles : Float32Array.from(triangles || []);
  if (tris.length % 9 !== 0) {
    throw new RangeError("bvhCore: a sopa de triângulos deve ter 9 floats por triângulo (v0 v1 v2)");
  }
  const triCount = tris.length / 9;
  if (triCount > maxTris) {
    throw new RangeError("bvhCore: " + triCount + " triângulos excede o teto de " + maxTris + " (anti-exploit)");
  }
  if (triCount === 0) {
    return {
      version: RT_SHADOWS_VERSION,
      triCount: 0,
      nodeCount: 0,
      nodeBounds: new Float32Array(0),
      nodeMeta: new Int32Array(0),
      triIndex: new Uint32Array(0),
      tris,
      leafSize,
      maxDepthSeen: 0,
    };
  }


  for (let i = 0; i < tris.length; i++) {
    if (!Number.isFinite(tris[i])) {
      throw new TypeError(
        "bvhCore: geometria com NaN/Infinity — vértices inválidos não podem entrar no BVH"
      );
    }
  }


  const triMin = new Float32Array(triCount * 3);
  const triMax = new Float32Array(triCount * 3);
  const cent = new Float32Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    const b = t * 9;
    for (let a = 0; a < 3; a++) {
      const v0 = tris[b + a];
      const v1 = tris[b + 3 + a];
      const v2 = tris[b + 6 + a];
      const mn = Math.min(v0, v1, v2);
      const mx = Math.max(v0, v1, v2);
      triMin[t * 3 + a] = mn;
      triMax[t * 3 + a] = mx;
      cent[t * 3 + a] = (mn + mx) * 0.5;
    }
  }

  const triIndex = new Uint32Array(triCount);
  for (let i = 0; i < triCount; i++) triIndex[i] = i;


  const maxNodes = Math.max(2 * triCount, 2);
  const nodeBounds = new Float32Array(maxNodes * 6);
  const nodeMeta = new Int32Array(maxNodes * 2);
  let nodeCount = 0;
  let maxDepthSeen = 0;

  function writeBounds(idx, first, count) {
    let mnx = Infinity;
    let mny = Infinity;
    let mnz = Infinity;
    let mxx = -Infinity;
    let mxy = -Infinity;
    let mxz = -Infinity;
    for (let i = first; i < first + count; i++) {
      const t = triIndex[i] * 3;
      if (triMin[t] < mnx) mnx = triMin[t];
      if (triMin[t + 1] < mny) mny = triMin[t + 1];
      if (triMin[t + 2] < mnz) mnz = triMin[t + 2];
      if (triMax[t] > mxx) mxx = triMax[t];
      if (triMax[t + 1] > mxy) mxy = triMax[t + 1];
      if (triMax[t + 2] > mxz) mxz = triMax[t + 2];
    }
    const b = idx * 6;
    nodeBounds[b] = mnx;
    nodeBounds[b + 1] = mny;
    nodeBounds[b + 2] = mnz;
    nodeBounds[b + 3] = mxx;
    nodeBounds[b + 4] = mxy;
    nodeBounds[b + 5] = mxz;
  }

  function buildNode(first, count, depth) {
    const idx = nodeCount++;
    if (idx >= maxNodes) {
      throw new Error("bvhCore: estouro do array de nós (invariante < 2N quebrada)");
    }
    if (depth > maxDepthSeen) maxDepthSeen = depth;
    writeBounds(idx, first, count);
    if (count <= leafSize || depth >= BVH_MAX_DEPTH) {
      nodeMeta[idx * 2] = first;
      nodeMeta[idx * 2 + 1] = count;
      return idx;
    }

    let cnx = Infinity;
    let cny = Infinity;
    let cnz = Infinity;
    let cxx = -Infinity;
    let cxy = -Infinity;
    let cxz = -Infinity;
    for (let i = first; i < first + count; i++) {
      const t = triIndex[i] * 3;
      if (cent[t] < cnx) cnx = cent[t];
      if (cent[t + 1] < cny) cny = cent[t + 1];
      if (cent[t + 2] < cnz) cnz = cent[t + 2];
      if (cent[t] > cxx) cxx = cent[t];
      if (cent[t + 1] > cxy) cxy = cent[t + 1];
      if (cent[t + 2] > cxz) cxz = cent[t + 2];
    }
    const ex = cxx - cnx;
    const ey = cxy - cny;
    const ez = cxz - cnz;
    let axis = 0;
    let ext = ex;
    if (ey > ext) {
      axis = 1;
      ext = ey;
    }
    if (ez > ext) {
      axis = 2;
      ext = ez;
    }
    if (!(ext > 0)) {

      nodeMeta[idx * 2] = first;
      nodeMeta[idx * 2 + 1] = count;
      return idx;
    }

    const slice = Array.from(triIndex.subarray(first, first + count));
    slice.sort((a, b) => cent[a * 3 + axis] - cent[b * 3 + axis] || a - b);
    triIndex.set(slice, first);
    const mid = first + (count >> 1);
    nodeMeta[idx * 2 + 1] = 0;
    buildNode(first, mid - first, depth + 1);                                
    const right = buildNode(mid, first + count - mid, depth + 1);
    nodeMeta[idx * 2] = right;
    return idx;
  }

  buildNode(0, triCount, 0);

  for (let i = 0; i < 6; i++) {
    if (!Number.isFinite(nodeBounds[i])) {
      throw new TypeError("bvhCore: geometria com NaN/Infinity — vértices inválidos não podem entrar no BVH");
    }
  }

  return {
    version: RT_SHADOWS_VERSION,
    triCount,
    nodeCount,
    nodeBounds: nodeBounds.slice(0, nodeCount * 6),
    nodeMeta: nodeMeta.slice(0, nodeCount * 2),
    triIndex,
    tris,
    leafSize,
    maxDepthSeen,
  };
}


export function refitBvh(bvh, newTriangles) {
  if (!bvh || !bvh.nodeCount) return bvh;
  if (newTriangles) {
    const nt = newTriangles instanceof Float32Array ? newTriangles : Float32Array.from(newTriangles);
    if (nt.length !== bvh.tris.length) {
      throw new RangeError("bvhCore: refit exige a mesma contagem de triângulos (rebuild para topologia nova)");
    }
    bvh.tris = nt;
  }
  const tris = bvh.tris;
  const nodeBounds = bvh.nodeBounds;
  const nodeMeta = bvh.nodeMeta;
  const triIndex = bvh.triIndex;
  for (let idx = bvh.nodeCount - 1; idx >= 0; idx--) {
    const b = idx * 6;
    const count = nodeMeta[idx * 2 + 1];
    if (count > 0) {
      const first = nodeMeta[idx * 2];
      let mnx = Infinity;
      let mny = Infinity;
      let mnz = Infinity;
      let mxx = -Infinity;
      let mxy = -Infinity;
      let mxz = -Infinity;
      for (let i = first; i < first + count; i++) {
        const t = triIndex[i] * 9;
        for (let v = 0; v < 9; v += 3) {
          const x = tris[t + v];
          const y = tris[t + v + 1];
          const z = tris[t + v + 2];
          if (x < mnx) mnx = x;
          if (y < mny) mny = y;
          if (z < mnz) mnz = z;
          if (x > mxx) mxx = x;
          if (y > mxy) mxy = y;
          if (z > mxz) mxz = z;
        }
      }
      nodeBounds[b] = mnx;
      nodeBounds[b + 1] = mny;
      nodeBounds[b + 2] = mnz;
      nodeBounds[b + 3] = mxx;
      nodeBounds[b + 4] = mxy;
      nodeBounds[b + 5] = mxz;
    } else {
      const l = (idx + 1) * 6;
      const r = nodeMeta[idx * 2] * 6;
      nodeBounds[b] = Math.min(nodeBounds[l], nodeBounds[r]);
      nodeBounds[b + 1] = Math.min(nodeBounds[l + 1], nodeBounds[r + 1]);
      nodeBounds[b + 2] = Math.min(nodeBounds[l + 2], nodeBounds[r + 2]);
      nodeBounds[b + 3] = Math.max(nodeBounds[l + 3], nodeBounds[r + 3]);
      nodeBounds[b + 4] = Math.max(nodeBounds[l + 4], nodeBounds[r + 4]);
      nodeBounds[b + 5] = Math.max(nodeBounds[l + 5], nodeBounds[r + 5]);
    }
  }
  for (let i = 0; i < 6; i++) {
    if (!Number.isFinite(nodeBounds[i])) {
      throw new TypeError("bvhCore: refit recebeu vértices com NaN/Infinity");
    }
  }
  return bvh;
}



function rayTri(tris, base, ox, oy, oz, dx, dy, dz, tMin, tMax) {
  const ax = tris[base];
  const ay = tris[base + 1];
  const az = tris[base + 2];
  const e1x = tris[base + 3] - ax;
  const e1y = tris[base + 4] - ay;
  const e1z = tris[base + 5] - az;
  const e2x = tris[base + 6] - ax;
  const e2y = tris[base + 7] - ay;
  const e2z = tris[base + 8] - az;
  const px = dy * e2z - dz * e2y;
  const py = dz * e2x - dx * e2z;
  const pz = dx * e2y - dy * e2x;
  const det = e1x * px + e1y * py + e1z * pz;
  if (det > -TRI_EPS && det < TRI_EPS) return -1;
  const inv = 1 / det;
  const sx = ox - ax;
  const sy = oy - ay;
  const sz = oz - az;
  const u = (sx * px + sy * py + sz * pz) * inv;
  if (u < -UV_EPS || u > 1 + UV_EPS) return -1;
  const qx = sy * e1z - sz * e1y;
  const qy = sz * e1x - sx * e1z;
  const qz = sx * e1y - sy * e1x;
  const v = (dx * qx + dy * qy + dz * qz) * inv;
  if (v < -UV_EPS || u + v > 1 + UV_EPS) return -1;
  const t = (e2x * qx + e2y * qy + e2z * qz) * inv;
  return t > tMin && t < tMax ? t : -1;
}


function rayAabb(nodeBounds, b, ox, oy, oz, dx, dy, dz, tMin, tMax) {
  let t0 = tMin;
  let t1 = tMax;
  for (let a = 0; a < 3; a++) {
    const o = a === 0 ? ox : a === 1 ? oy : oz;
    const d = a === 0 ? dx : a === 1 ? dy : dz;
    const mn = nodeBounds[b + a];
    const mx = nodeBounds[b + 3 + a];
    if (d > -1e-12 && d < 1e-12) {
      if (o < mn || o > mx) return false;
      continue;
    }
    const inv = 1 / d;
    let tn = (mn - o) * inv;
    let tf = (mx - o) * inv;
    if (tn > tf) {
      const tmp = tn;
      tn = tf;
      tf = tmp;
    }
    if (tn > t0) t0 = tn;
    if (tf < t1) t1 = tf;
    if (t0 > t1) return false;
  }
  return true;
}


export function anyHit(bvh, origin, dir, tMin, tMax) {
  if (!bvh || !bvh.nodeCount) return false;
  const ox = num(origin && origin[0], NaN);
  const oy = num(origin && origin[1], NaN);
  const oz = num(origin && origin[2], NaN);
  const dx = num(dir && dir[0], NaN);
  const dy = num(dir && dir[1], NaN);
  const dz = num(dir && dir[2], NaN);
  const t0 = num(tMin, RT_SHADOW_TMIN);
  const t1 = num(tMax, Infinity);
  if (!Number.isFinite(ox) || !Number.isFinite(oy) || !Number.isFinite(oz)) return false;
  if (!Number.isFinite(dx) || !Number.isFinite(dy) || !Number.isFinite(dz)) return false;
  if (!(t1 > t0)) return false;
  const nodeBounds = bvh.nodeBounds;
  const nodeMeta = bvh.nodeMeta;
  const triIndex = bvh.triIndex;
  const tris = bvh.tris;
  const stack = new Int32Array(RT_TRAVERSAL_STACK);
  let sp = 0;
  stack[sp++] = 0;
  while (sp > 0) {
    const idx = stack[--sp];
    if (!rayAabb(nodeBounds, idx * 6, ox, oy, oz, dx, dy, dz, t0, t1)) continue;
    const count = nodeMeta[idx * 2 + 1];
    if (count > 0) {
      const first = nodeMeta[idx * 2];
      for (let i = first; i < first + count; i++) {
        if (rayTri(tris, triIndex[i] * 9, ox, oy, oz, dx, dy, dz, t0, t1) >= 0) return true;
      }
    } else {

      stack[sp++] = idx + 1;
      stack[sp++] = nodeMeta[idx * 2];
    }
  }
  return false;
}

function basisFromDir(dx, dy, dz) {

  const upY = Math.abs(dy) < 0.98;
  const ux = upY ? 0 : 1;
  const uy = upY ? 1 : 0;
  let t1x = uy * dz - 0 * dy;
  let t1y = 0 * dx - ux * dz;
  let t1z = ux * dy - uy * dx;
  const l1 = Math.hypot(t1x, t1y, t1z) || 1;
  t1x /= l1;
  t1y /= l1;
  t1z /= l1;
  const t2x = dy * t1z - dz * t1y;
  const t2y = dz * t1x - dx * t1z;
  const t2z = dx * t1y - dy * t1x;
  return [t1x, t1y, t1z, t2x, t2y, t2z];
}

function sanitizeSampleOpts(opts) {
  const o = opts || {};
  return {
    samples: Math.round(clamp(num(o.samples, 1), 1, RT_MAX_SAMPLES)),
    px: num(o.px, 0),
    py: num(o.py, 0),
    frame: Math.floor(num(o.frame, 0)),
    tMin: Math.max(1e-6, num(o.tMin, RT_SHADOW_TMIN)),
  };
}


export function traceShadowSun(bvh, point, sunDir, opts) {
  const o = sanitizeSampleOpts(opts);
  const tanHalf = clamp(num(opts && opts.tanHalfAngle, 0), 0, 0.2);
  const px = num(point && point[0], NaN);
  const py = num(point && point[1], NaN);
  const pz = num(point && point[2], NaN);
  let dx = -num(sunDir && sunDir[0], NaN);
  let dy = -num(sunDir && sunDir[1], NaN);
  let dz = -num(sunDir && sunDir[2], NaN);
  const len = Math.hypot(dx, dy, dz);
  if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz) || !(len > 0)) return 1;
  dx /= len;
  dy /= len;
  dz /= len;
  if (!bvh || !bvh.nodeCount) return 1;
  const samples = tanHalf > 0 ? o.samples : 1;
  if (tanHalf <= 0) {

    return anyHit(bvh, [px, py, pz], [dx, dy, dz], o.tMin, Infinity) ? 0 : 1;
  }

  const [t1x, t1y, t1z, t2x, t2y, t2z] = basisFromDir(dx, dy, dz);
  let vis = 0;
  for (let i = 0; i < samples; i++) {

    const u1 = ign(o.px + i * 61, o.py + i * 23, o.frame);
    const u2 = ign(o.px + i * 23 + 17, o.py + i * 61 + 43, o.frame);
    const r = Math.sqrt(u1) * tanHalf;
    const th = 2 * Math.PI * u2;
    const jx = t1x * (r * Math.cos(th)) + t2x * (r * Math.sin(th));
    const jy = t1y * (r * Math.cos(th)) + t2y * (r * Math.sin(th));
    const jz = t1z * (r * Math.cos(th)) + t2z * (r * Math.sin(th));
    let sx = dx + jx;
    let sy = dy + jy;
    let sz = dz + jz;
    const sl = Math.hypot(sx, sy, sz) || 1;
    sx /= sl;
    sy /= sl;
    sz /= sl;
    if (!anyHit(bvh, [px, py, pz], [sx, sy, sz], o.tMin, Infinity)) vis += 1;
  }
  return vis / samples;
}


export function traceShadowPoint(bvh, point, lightPos, opts) {
  const o = sanitizeSampleOpts(opts);
  const radius = Math.max(0, num(opts && opts.lightRadius, 0));
  const px = num(point && point[0], NaN);
  const py = num(point && point[1], NaN);
  const pz = num(point && point[2], NaN);
  const lx = num(lightPos && lightPos[0], NaN);
  const ly = num(lightPos && lightPos[1], NaN);
  const lz = num(lightPos && lightPos[2], NaN);
  if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) return 1;
  if (!Number.isFinite(lx) || !Number.isFinite(ly) || !Number.isFinite(lz)) return 1;
  if (!bvh || !bvh.nodeCount) return 1;
  const bx = lx - px;
  const by = ly - py;
  const bz = lz - pz;
  const dist = Math.hypot(bx, by, bz);
  if (dist <= o.tMin) return 1;                           


  const samples = radius > 0 ? o.samples : 1;
  if (radius <= 0) {
    const d = [bx / dist, by / dist, bz / dist];
    return anyHit(bvh, [px, py, pz], d, o.tMin, dist - o.tMin) ? 0 : 1;
  }
  const [t1x, t1y, t1z, t2x, t2y, t2z] = basisFromDir(bx / dist, by / dist, bz / dist);
  let vis = 0;
  for (let i = 0; i < samples; i++) {
    const u1 = ign(o.px + i * 61, o.py + i * 23, o.frame);
    const u2 = ign(o.px + i * 23 + 17, o.py + i * 61 + 43, o.frame);
    const r = Math.sqrt(u1) * radius;
    const th = 2 * Math.PI * u2;
    const tx = lx + t1x * (r * Math.cos(th)) + t2x * (r * Math.sin(th));
    const ty = ly + t1y * (r * Math.cos(th)) + t2y * (r * Math.sin(th));
    const tz = lz + t1z * (r * Math.cos(th)) + t2z * (r * Math.sin(th));
    const ddx = tx - px;
    const ddy = ty - py;
    const ddz = tz - pz;
    const dl = Math.hypot(ddx, ddy, ddz);
    if (!(dl > o.tMin)) {
      vis += 1;
      continue;
    }
    const d = [ddx / dl, ddy / dl, ddz / dl];
    if (!anyHit(bvh, [px, py, pz], d, o.tMin, dl - o.tMin)) vis += 1;
  }
  return vis / samples;
}


export function packBvhForGpu(bvh) {
  if (!bvh) throw new TypeError("bvhCore: packBvhForGpu exige um BVH construído");
  const nodeCount = bvh.nodeCount | 0;
  const triCount = bvh.triCount | 0;
  const nodesF32 = new Float32Array(nodeCount * 8);
  const nodesU32 = new Uint32Array(nodesF32.buffer);
  for (let i = 0; i < nodeCount; i++) {
    const b = i * 6;
    const p = i * 8;
    nodesF32[p] = bvh.nodeBounds[b];
    nodesF32[p + 1] = bvh.nodeBounds[b + 1];
    nodesF32[p + 2] = bvh.nodeBounds[b + 2];
    nodesU32[p + 3] = bvh.nodeMeta[i * 2] >>> 0;
    nodesF32[p + 4] = bvh.nodeBounds[b + 3];
    nodesF32[p + 5] = bvh.nodeBounds[b + 4];
    nodesF32[p + 6] = bvh.nodeBounds[b + 5];
    nodesU32[p + 7] = bvh.nodeMeta[i * 2 + 1] >>> 0;
  }
  const trisF32 = new Float32Array(triCount * 12);
  for (let k = 0; k < triCount; k++) {
    const src = bvh.triIndex[k] * 9;
    const dst = k * 12;
    for (let v = 0; v < 3; v++) {
      trisF32[dst + v * 4] = bvh.tris[src + v * 3];
      trisF32[dst + v * 4 + 1] = bvh.tris[src + v * 3 + 1];
      trisF32[dst + v * 4 + 2] = bvh.tris[src + v * 3 + 2];
      trisF32[dst + v * 4 + 3] = 0;
    }
  }
  return { layout: BVH_GPU_LAYOUT, nodesF32, trisF32, nodeCount, triCount };
}


export function buildShadowWgsl(opts) {
  const o = opts || {};
  const wg = Math.round(clamp(num(o.workgroupSize, 64), 1, 256));
  return (
    "// rt-shadows-7a: sombra do sol por raio (anyHit) sobre BVH " + BVH_GPU_LAYOUT + "\n" +
    "struct RtParams {\n" +
    "  sunDir : vec4f, // xyz = direcao sol->cena; w = tanHalfAngle\n" +
    "  counts : vec4u, // x = rayCount, y = samples, z = frame, w = nodeCount (lido por rswAnyHit; a cola escreve bvh.nodeCount aqui)\n" +
    "  limits : vec4f, // x = tMin, y = tMax, zw reservado\n" +
    "};\n" +
    "@group(0) @binding(0) var<storage, read> bvhNodes : array<vec4f>;\n" +
    "@group(0) @binding(1) var<storage, read> bvhTris : array<vec4f>;\n" +
    "@group(0) @binding(2) var<storage, read> rayOrigins : array<vec4f>;\n" +
    "@group(0) @binding(3) var<storage, read_write> visibilityOut : array<f32>;\n" +
    "@group(0) @binding(4) var<uniform> params : RtParams;\n" +
    "fn rswIgn(x : f32, y : f32, frame : u32) -> f32 {\n" +
    "  let f = f32(frame % 64u) * 5.588238;\n" +
    "  return fract(52.9829189 * fract(0.06711056 * (x + f) + 0.00583715 * (y + f)));\n" +
    "}\n" +
    "fn rswRayTri(o : vec3f, d : vec3f, a : vec3f, b : vec3f, c : vec3f, tMin : f32, tMax : f32) -> bool {\n" +
    "  let e1 = b - a;\n" +
    "  let e2 = c - a;\n" +
    "  let p = cross(d, e2);\n" +
    "  let det = dot(e1, p);\n" +
    "  if (abs(det) < 1e-7) { return false; }\n" +
    "  let inv = 1.0 / det;\n" +
    "  let s = o - a;\n" +
    "  let u = dot(s, p) * inv;\n" +
    "  if (u < -1e-7 || u > 1.0000001) { return false; }\n" +
    "  let q = cross(s, e1);\n" +
    "  let v = dot(d, q) * inv;\n" +
    "  if (v < -1e-7 || u + v > 1.0000001) { return false; }\n" +
    "  let t = dot(e2, q) * inv;\n" +
    "  return t > tMin && t < tMax;\n" +
    "}\n" +
    "fn rswSlab(o : vec3f, invD : vec3f, mn : vec3f, mx : vec3f, tMin : f32, tMax : f32) -> bool {\n" +
    "  let t1 = (mn - o) * invD;\n" +
    "  let t2 = (mx - o) * invD;\n" +
    "  let tn = max(max(min(t1.x, t2.x), min(t1.y, t2.y)), min(t1.z, t2.z));\n" +
    "  let tf = min(min(max(t1.x, t2.x), max(t1.y, t2.y)), max(t1.z, t2.z));\n" +
    "  return tn <= tf && tf >= tMin && tn <= tMax;\n" +
    "}\n" +
    "fn rswAnyHit(o : vec3f, d : vec3f, tMin : f32, tMax : f32, nodeCount : u32) -> bool {\n" +
    "  // nodeCount vem de params.counts.w (fix: evita arrayLength() no hot path por raio).\n" +
    "  if (nodeCount == 0u) { return false; }\n" +
    "  // 1/d protegido PRESERVANDO SINAL (fix: select sem sinal causava slab test errado\n" +
    "  // para dire\u00e7\u00f5es negativas pequenas — light leak / shadow leak em raios quase-paralelos ao eixo).\n" +
    "  let safeD = vec3f(\n" +
    "    select(d.x, select(-1e-9, 1e-9, d.x >= 0.0), abs(d.x) < 1e-9),\n" +
    "    select(d.y, select(-1e-9, 1e-9, d.y >= 0.0), abs(d.y) < 1e-9),\n" +
    "    select(d.z, select(-1e-9, 1e-9, d.z >= 0.0), abs(d.z) < 1e-9));\n" +
    "  let invD = 1.0 / safeD;\n" +
    "  var stack : array<u32, " + RT_TRAVERSAL_STACK + ">;\n" +
    "  var sp : u32 = 0u;\n" +
    "  stack[sp] = 0u;\n" +
    "  sp = 1u;\n" +
    "  loop {\n" +
    "    if (sp == 0u) { break; }\n" +
    "    sp = sp - 1u;\n" +
    "    let idx = stack[sp];\n" +
    "    let n0 = bvhNodes[idx * 2u];\n" +
    "    let n1 = bvhNodes[idx * 2u + 1u];\n" +
    "    if (!rswSlab(o, invD, n0.xyz, n1.xyz, tMin, tMax)) { continue; }\n" +
    "    let meta0 = bitcast<u32>(n0.w);\n" +
    "    let count = bitcast<u32>(n1.w);\n" +
    "    if (count > 0u) {\n" +
    "      for (var i : u32 = 0u; i < count; i = i + 1u) {\n" +
    "        let t = (meta0 + i) * 3u;\n" +
    "        if (rswRayTri(o, d, bvhTris[t].xyz, bvhTris[t + 1u].xyz, bvhTris[t + 2u].xyz, tMin, tMax)) { return true; }\n" +
    "      }\n" +
    "    } else if (sp + 2u <= " + RT_TRAVERSAL_STACK + "u) {\n" +
    "      stack[sp] = idx + 1u;\n" +
    "      stack[sp + 1u] = meta0;\n" +
    "      sp = sp + 2u;\n" +
    "    }\n" +
    "  }\n" +
    "  return false;\n" +
    "}\n" +
    "@compute @workgroup_size(" + wg + ")\n" +
    "fn rswRtShadow(@builtin(global_invocation_id) gid : vec3u) {\n" +
    "  let rayCount = params.counts.x;\n" +
    "  if (gid.x >= rayCount) { return; }\n" +
    "  let origin = rayOrigins[gid.x].xyz;\n" +
    "  var d = -params.sunDir.xyz;\n" +
    "  let len = length(d);\n" +
    "  if (len <= 0.0) { visibilityOut[gid.x] = 1.0; return; }\n" +
    "  d = d / len;\n" +
    "  let tanHalf = clamp(params.sunDir.w, 0.0, 0.2);\n" +
    "  let tMin = params.limits.x;\n" +
    "  let tMax = params.limits.y;\n" +
    "  var samples = max(params.counts.y, 1u);\n" +
    "  if (tanHalf <= 0.0) { samples = 1u; }\n" +
    "  samples = min(samples, " + RT_MAX_SAMPLES + "u);\n" +
    "  let up = select(vec3f(1.0, 0.0, 0.0), vec3f(0.0, 1.0, 0.0), abs(d.y) < 0.98);\n" +
    "  let t1 = normalize(cross(up, d));\n" +
    "  let t2 = cross(d, t1);\n" +
    "  let px = f32(gid.x % 4096u);\n" +
    "  let py = f32(gid.x / 4096u);\n" +
    "  var vis : f32 = 0.0;\n" +
    "  for (var i : u32 = 0u; i < samples; i = i + 1u) {\n" +
    "    let fi = f32(i);\n" +
    "    let u1 = rswIgn(px + fi * 61.0, py + fi * 23.0, params.counts.z);\n" +
    "    let u2 = rswIgn(px + fi * 23.0 + 17.0, py + fi * 61.0 + 43.0, params.counts.z);\n" +
    "    let r = sqrt(u1) * tanHalf;\n" +
    "    let th = 6.2831853 * u2;\n" +
    "    let sd = normalize(d + t1 * (r * cos(th)) + t2 * (r * sin(th)));\n" +
    "    if (!rswAnyHit(origin, sd, tMin, tMax, params.counts.w)) { vis = vis + 1.0; }\n" +
    "  }\n" +
    "  visibilityOut[gid.x] = vis / f32(samples);\n" +
    "}\n"
  );
}
