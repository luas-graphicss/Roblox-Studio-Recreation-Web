const MIN_TRIS = 2;
const NEAR_CELLS_MAX = 44;
const NEAR_CELLS_MIN = 10;
const FAR_CELLS_MAX = 16;
const FAR_CELLS_MIN = 6;
const CELLS_HARD_MIN = 2;


function cellsFor(triCount, nearMin, farMin) {
  const near = Math.max(
    nearMin,
    Math.min(NEAR_CELLS_MAX, Math.round(0.8 * Math.sqrt(triCount))),
  );
  const far = Math.max(farMin, Math.min(FAR_CELLS_MAX, Math.round(near * 0.36)));
  return { near, far };
}


function decimateAdaptive(THREE, geo, cells) {
  let c = Math.max(CELLS_HARD_MIN, cells | 0);
  for (;;) {
    const out = decimate(THREE, geo, c);
    if (out) return out;
    if (c <= CELLS_HARD_MIN) return null;
    c = Math.max(CELLS_HARD_MIN, Math.round(c * 0.7));
  }
}

function readTriangles(geo) {
  const pos = geo.getAttribute("position");
  if (!pos || pos.count < 3) return null;
  const idx = geo.getIndex();
  const triCount = Math.floor((idx ? idx.count : pos.count) / 3);
  const cornerIndex = idx
    ? (tri, k) => idx.getX(tri * 3 + k)
    : (tri, k) => tri * 3 + k;
  return {
    pos,
    col: geo.getAttribute("color"),
    nor: geo.getAttribute("normal"),
    uv: geo.getAttribute("uv"),
    uv1: geo.getAttribute("uv1"),
    uv2: geo.getAttribute("uv2"),
    tan: geo.getAttribute("tangent"),
    si: geo.getAttribute("skinIndex"),
    sw: geo.getAttribute("skinWeight"),
    triCount,
    cornerIndex,
  };
}

function decimate(THREE, geo, cells) {
  const src = readTriangles(geo);
  if (!src || src.triCount < 2) return null;
  const { pos, col, nor, uv, uv1, uv2, tan, triCount, cornerIndex } = src;
  const si = src.si && src.sw ? src.si : null;
  const sw = si ? src.sw : null;
  const comp = (attr, vi, k) =>
    k === 0 ? attr.getX(vi) : k === 1 ? attr.getY(vi) : k === 2 ? attr.getZ(vi) : attr.getW(vi);

  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < pos.count; i++) {
    const x = pos.getX(i), y = pos.getY(i), z = pos.getZ(i);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  const maxDim = Math.max(maxX - minX, maxY - minY, maxZ - minZ);
  if (!(maxDim > 0)) return null;
  const cell = maxDim / Math.max(2, cells | 0);

  const clusters = new Map();
  const refs = new Array(triCount * 3);
  for (let t = 0; t < triCount; t++) {
    for (let k = 0; k < 3; k++) {
      const vi = cornerIndex(t, k);
      const x = pos.getX(vi), y = pos.getY(vi), z = pos.getZ(vi);
      const key =
        Math.floor((x - minX) / cell) + "_" +
        Math.floor((y - minY) / cell) + "_" +
        Math.floor((z - minZ) / cell);
      let c = clusters.get(key);
      if (!c) {
        c = {
          x: 0, y: 0, z: 0, r: 0, g: 0, b: 0, nx: 0, ny: 0, nz: 0,
          u: 0, v: 0, u1: 0, v1: 0, u2: 0, v2: 0, tx: 0, ty: 0, tz: 0, tw: 0,
          bw: null, n: 0,
        };
        clusters.set(key, c);
      }
      c.x += x;
      c.y += y;
      c.z += z;
      if (col) {
        c.r += col.getX(vi);
        c.g += col.getY(vi);
        c.b += col.getZ(vi);
      }
      if (nor) {
        c.nx += nor.getX(vi);
        c.ny += nor.getY(vi);
        c.nz += nor.getZ(vi);
      }
      if (uv) {
        c.u += uv.getX(vi);
        c.v += uv.getY(vi);
      }
      if (uv1) {
        c.u1 += uv1.getX(vi);
        c.v1 += uv1.getY(vi);
      }
      if (uv2) {
        c.u2 += uv2.getX(vi);
        c.v2 += uv2.getY(vi);
      }
      if (tan) {
        c.tx += tan.getX(vi);
        c.ty += tan.getY(vi);
        c.tz += tan.getZ(vi);
        c.tw += tan.getW(vi);
      }
      if (si) {
        if (!c.bw) c.bw = new Map();
        for (let s = 0; s < 4; s += 1) {
          const w = comp(sw, vi, s);
          if (w > 0) {
            const bone = comp(si, vi, s);
            c.bw.set(bone, (c.bw.get(bone) || 0) + w);
          }
        }
      }
      c.n += 1;
      refs[t * 3 + k] = c;
    }
  }

  const outPos = [];
  const outCol = col ? [] : null;
  const outNor = nor ? [] : null;
  const outUv = uv ? [] : null;
  const outUv1 = uv1 ? [] : null;
  const outUv2 = uv2 ? [] : null;
  const outTan = tan ? [] : null;
  const outSi = si ? [] : null;
  const outSw = si ? [] : null;
  const pushCorner = (c) => {
    outPos.push(c.x / c.n, c.y / c.n, c.z / c.n);
    if (outCol) outCol.push(c.r / c.n, c.g / c.n, c.b / c.n);
    if (outNor) {
      const nx = c.nx / c.n, ny = c.ny / c.n, nz = c.nz / c.n;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      if (len > 1e-6) outNor.push(nx / len, ny / len, nz / len);
      else outNor.push(0, 1, 0);
    }
    if (outUv) outUv.push(c.u / c.n, c.v / c.n);
    if (outUv1) outUv1.push(c.u1 / c.n, c.v1 / c.n);
    if (outUv2) outUv2.push(c.u2 / c.n, c.v2 / c.n);
    if (outTan) {
      const tx = c.tx / c.n, ty = c.ty / c.n, tz = c.tz / c.n;
      const tl = Math.sqrt(tx * tx + ty * ty + tz * tz);
      if (tl > 1e-6) outTan.push(tx / tl, ty / tl, tz / tl, c.tw >= 0 ? 1 : -1);
      else outTan.push(1, 0, 0, c.tw >= 0 ? 1 : -1);
    }
    if (outSi) {
      let top = c.bw ? Array.from(c.bw.entries()).sort((a, b) => b[1] - a[1]).slice(0, 4) : [];
      let sum = 0;
      for (const p of top) sum += p[1];
      if (!(sum > 0)) { top = [[0, 1]]; sum = 1; }
      for (let s = 0; s < 4; s += 1) {
        outSi.push(top[s] ? top[s][0] : 0);
        outSw.push(top[s] ? top[s][1] / sum : 0);
      }
    }
  };
  for (let t = 0; t < triCount; t++) {
    const a = refs[t * 3], b = refs[t * 3 + 1], c = refs[t * 3 + 2];
    if (a === b || b === c || a === c) continue;
    pushCorner(a);
    pushCorner(b);
    pushCorner(c);
  }
  const outTris = outPos.length / 9;


  if (!outTris || outTris >= triCount) return null;

  const out = new THREE.BufferGeometry();
  out.setAttribute("position", new THREE.Float32BufferAttribute(outPos, 3));
  if (outCol) out.setAttribute("color", new THREE.Float32BufferAttribute(outCol, 3));
  if (outNor) out.setAttribute("normal", new THREE.Float32BufferAttribute(outNor, 3));
  if (outUv) out.setAttribute("uv", new THREE.Float32BufferAttribute(outUv, 2));
  if (outUv1) out.setAttribute("uv1", new THREE.Float32BufferAttribute(outUv1, 2));
  if (outUv2) out.setAttribute("uv2", new THREE.Float32BufferAttribute(outUv2, 2));
  if (outTan) out.setAttribute("tangent", new THREE.Float32BufferAttribute(outTan, 4));
  if (outSi) {
    out.setAttribute("skinIndex", new THREE.Uint16BufferAttribute(outSi, 4));
    out.setAttribute("skinWeight", new THREE.Float32BufferAttribute(outSw, 4));
  }
  out.computeBoundingSphere();
  return out;
}

export function buildLodLevels(THREE, geo, opts) {
  const o = opts || {};
  const src = readTriangles(geo);
  if (!src || src.triCount < (o.minTris || MIN_TRIS)) return null;
  if (!geo.boundingSphere) geo.computeBoundingSphere();
  const radius =
    geo.boundingSphere && geo.boundingSphere.radius > 0 ? geo.boundingSphere.radius : 1;

  const nearMin = o.nearCellsMin || NEAR_CELLS_MIN;
  const farMin = o.farCellsMin || FAR_CELLS_MIN;
  const cells = cellsFor(src.triCount, nearMin, farMin);
  const levels = [{ minDist: 0, geo }];
  const d1 = Math.max(60, radius * 12);
  const near = decimateAdaptive(THREE, geo, cells.near);
  if (near) levels.push({ minDist: d1, geo: near, role: "near" });
  const far = decimateAdaptive(THREE, geo, cells.far);
  if (far) levels.push({ minDist: Math.max(d1 * 2.5, 150), geo: far, role: "far" });
  return levels.length > 1 ? levels : null;
}

export function buildCsgLods(THREE, geo, opts) {
  return buildLodLevels(THREE, geo, opts);
}
