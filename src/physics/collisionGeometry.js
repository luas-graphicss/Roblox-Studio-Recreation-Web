const MAX_HULL_INPUT = 3000;                                             
const MAX_UNIQUE_POINTS = 1024;                                        
const DEFAULT_MAX_HULL_VERTS = 48;                                   
const DEFAULT_RES = 14;                                        
const MIN_RES = 6;                                                       
const DEFAULT_MAX_BOXES = 64;                                  
const MAX_SOUP_TRIS = 60000;                                                  
const MAX_QH_ITER = 512;                                    

function isFiniteVec(v) {
  return !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}

function sub(a, b) {
  return { x: a.x - b.x, y: a.y - b.y, z: a.z - b.z };
}

function cross(a, b) {
  return { x: a.y * b.z - a.z * b.y, y: a.z * b.x - a.x * b.z, z: a.x * b.y - a.y * b.x };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y + a.z * b.z;
}

function length(a) {
  return Math.sqrt(dot(a, a));
}

function boundsOfPoints(pts) {
  let loX = Infinity, loY = Infinity, loZ = Infinity;
  let hiX = -Infinity, hiY = -Infinity, hiZ = -Infinity;
  for (const p of pts) {
    if (p.x < loX) loX = p.x;
    if (p.y < loY) loY = p.y;
    if (p.z < loZ) loZ = p.z;
    if (p.x > hiX) hiX = p.x;
    if (p.y > hiY) hiY = p.y;
    if (p.z > hiZ) hiZ = p.z;
  }
  return { loX, loY, loZ, hiX, hiY, hiZ };
}


function uniquePoints(pts, cell) {
  const seen = new Set();
  const out = [];
  for (const p of pts) {
    let x = p.x, y = p.y, z = p.z;
    if (cell > 0) {
      x = Math.round(x / cell) * cell;
      y = Math.round(y / cell) * cell;
      z = Math.round(z / cell) * cell;
    }
    const key = x + "|" + y + "|" + z;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push({ x, y, z });
  }
  return out;
}


function makeFace(pts, i, j, k, interior) {
  const a = pts[i];
  const n0 = cross(sub(pts[j], a), sub(pts[k], a));
  const L = length(n0);
  if (L < 1e-12) return null;
  let n = { x: n0.x / L, y: n0.y / L, z: n0.z / L };
  let v = [i, j, k];
  let d = dot(n, a);
  if (dot(n, interior) - d > 0) {
    v = [i, k, j];
    n = { x: -n.x, y: -n.y, z: -n.z };
    d = -d;
  }
  return { v, n, d, pts: [], far: -1, farD: 0 };
}


function assignPointsUnique(facesArr, indices, pts, eps) {
  for (const idx of indices) {
    let bestF = null;
    let bestD = eps;
    for (const f of facesArr) {
      const dist = dot(f.n, pts[idx]) - f.d;
      if (dist > bestD) {
        bestD = dist;
        bestF = f;
      }
    }
    if (bestF) {
      bestF.pts.push(idx);
      if (bestD > bestF.farD) {
        bestF.farD = bestD;
        bestF.far = idx;
      }
    }
  }
}

function quickhull(pts, eps) {
  const n = pts.length;
  if (n < 4) return null;


  const ext = new Set();
  let ix0 = 0, ix1 = 0, iy0 = 0, iy1 = 0, iz0 = 0, iz1 = 0;
  for (let i = 1; i < n; i++) {
    if (pts[i].x < pts[ix0].x) ix0 = i;
    if (pts[i].x > pts[ix1].x) ix1 = i;
    if (pts[i].y < pts[iy0].y) iy0 = i;
    if (pts[i].y > pts[iy1].y) iy1 = i;
    if (pts[i].z < pts[iz0].z) iz0 = i;
    if (pts[i].z > pts[iz1].z) iz1 = i;
  }
  for (const i of [ix0, ix1, iy0, iy1, iz0, iz1]) ext.add(i);
  const extremes = [...ext];
  let a = -1, b = -1, bestAB = 0;
  for (let i = 0; i < extremes.length; i++) {
    for (let j = i + 1; j < extremes.length; j++) {
      const d = length(sub(pts[extremes[i]], pts[extremes[j]]));
      if (d > bestAB) {
        bestAB = d;
        a = extremes[i];
        b = extremes[j];
      }
    }
  }
  if (a < 0 || bestAB < eps) return null;
  const ab = sub(pts[b], pts[a]);
  const abLen = length(ab);
  const abU = { x: ab.x / abLen, y: ab.y / abLen, z: ab.z / abLen };
  let c = -1, bestC = eps;
  for (let i = 0; i < n; i++) {
    const d = length(cross(sub(pts[i], pts[a]), abU));
    if (d > bestC) {
      bestC = d;
      c = i;
    }
  }
  if (c < 0) return null;            
  const pn0 = cross(sub(pts[b], pts[a]), sub(pts[c], pts[a]));
  const pnL = length(pn0);
  if (pnL < 1e-12) return null;
  const pn = { x: pn0.x / pnL, y: pn0.y / pnL, z: pn0.z / pnL };
  let d4 = -1, bestD = eps;
  for (let i = 0; i < n; i++) {
    const dist = Math.abs(dot(pn, sub(pts[i], pts[a])));
    if (dist > bestD) {
      bestD = dist;
      d4 = i;
    }
  }
  if (d4 < 0) return null;            

  const interior = {
    x: (pts[a].x + pts[b].x + pts[c].x + pts[d4].x) / 4,
    y: (pts[a].y + pts[b].y + pts[c].y + pts[d4].y) / 4,
    z: (pts[a].z + pts[b].z + pts[c].z + pts[d4].z) / 4,
  };
  let faces = [];
  for (const tri of [[a, b, c], [a, b, d4], [a, c, d4], [b, c, d4]]) {
    const f = makeFace(pts, tri[0], tri[1], tri[2], interior);
    if (!f) return null;
    faces.push(f);
  }
  const initialSet = new Set([a, b, c, d4]);
  const rest = [];
  for (let i = 0; i < n; i++) if (!initialSet.has(i)) rest.push(i);
  assignPointsUnique(faces, rest, pts, eps);

  for (let iter = 0; iter < MAX_QH_ITER; iter++) {
    let fi = -1, best = 0;
    for (let i = 0; i < faces.length; i++) {
      if (faces[i].pts.length && faces[i].farD > best) {
        best = faces[i].farD;
        fi = i;
      }
    }
    if (fi < 0) {

      const used = new Map();
      const vertices = [];
      const outFaces = [];
      for (const f of faces) {
        const tri = f.v.map((vi) => {
          if (!used.has(vi)) {
            used.set(vi, vertices.length);
            vertices.push({ x: pts[vi].x, y: pts[vi].y, z: pts[vi].z });
          }
          return used.get(vi);
        });
        outFaces.push(tri);
      }
      if (vertices.length < 4 || outFaces.length < 4) return null;
      return { vertices, faces: outFaces };
    }
    const apex = faces[fi].far;
    const p = pts[apex];
    const visible = [];
    const visibleIdx = new Set();
    for (let i = 0; i < faces.length; i++) {
      if (i === fi || dot(faces[i].n, p) - faces[i].d > eps) {
        visible.push(faces[i]);
        visibleIdx.add(i);
      }
    }
    const edgeSet = new Set();
    for (const f of visible) {
      for (let e = 0; e < 3; e++) edgeSet.add(f.v[e] + "_" + f.v[(e + 1) % 3]);
    }
    const horizon = [];
    for (const f of visible) {
      for (let e = 0; e < 3; e++) {
        const u = f.v[e], v = f.v[(e + 1) % 3];
        if (!edgeSet.has(v + "_" + u)) horizon.push([u, v]);
      }
    }
    if (!horizon.length) return null;
    const orphans = [];
    for (const f of visible) {
      for (const idx of f.pts) if (idx !== apex) orphans.push(idx);
    }
    const kept = [];
    for (let i = 0; i < faces.length; i++) if (!visibleIdx.has(i)) kept.push(faces[i]);
    const fresh = [];
    for (const [u, v] of horizon) {
      const f = makeFace(pts, u, v, apex, interior);
      if (!f) return null;
      fresh.push(f);
    }
    assignPointsUnique(fresh, orphans, pts, eps);
    faces = kept.concat(fresh);
  }
  return null;                                  
}


function hullContainsAll(hull, pts, tol) {
  const vs = hull.vertices;
  let cx = 0, cy = 0, cz = 0;
  for (const v of vs) {
    cx += v.x; cy += v.y; cz += v.z;
  }
  cx /= vs.length; cy /= vs.length; cz /= vs.length;
  for (const face of hull.faces) {
    const a = vs[face[0]], b = vs[face[1]], c = vs[face[2]];
    const n0 = cross(sub(b, a), sub(c, a));
    const L = length(n0);
    if (L < 1e-12) return false;
    let nx = n0.x / L, ny = n0.y / L, nz = n0.z / L;
    let d = nx * a.x + ny * a.y + nz * a.z;
    if (nx * cx + ny * cy + nz * cz - d > 1e-9) {
      nx = -nx; ny = -ny; nz = -nz; d = -d;
    }
    for (const p of pts) {
      if (nx * p.x + ny * p.y + nz * p.z - d > tol) return false;
    }
  }
  return true;
}


function axisExtremeIndices(pts) {
  let x0 = 0, x1 = 0, y0 = 0, y1 = 0, z0 = 0, z1 = 0;
  for (let i = 1; i < pts.length; i++) {
    if (pts[i].x < pts[x0].x) x0 = i;
    if (pts[i].x > pts[x1].x) x1 = i;
    if (pts[i].y < pts[y0].y) y0 = i;
    if (pts[i].y > pts[y1].y) y1 = i;
    if (pts[i].z < pts[z0].z) z0 = i;
    if (pts[i].z > pts[z1].z) z1 = i;
  }
  return [x0, x1, y0, y1, z0, z1];
}


function farthestPointSample(pts, count, seedIdx) {
  const chosen = [];
  const dist = new Float64Array(pts.length).fill(Infinity);
  const take = (idx) => {
    const p = pts[idx];
    chosen.push(p);
    for (let i = 0; i < pts.length; i++) {
      const dx = pts[i].x - p.x;
      const dy = pts[i].y - p.y;
      const dz = pts[i].z - p.z;
      const d2 = dx * dx + dy * dy + dz * dz;
      if (d2 < dist[i]) dist[i] = d2;
    }
  };
  const seen = new Set();
  for (const si of seedIdx) {
    if (!seen.has(si)) {
      seen.add(si);
      take(si);
      if (chosen.length >= count) return chosen;
    }
  }
  while (chosen.length < count) {
    let bi = -1;
    let bd = 0;
    for (let i = 0; i < pts.length; i++) {
      if (dist[i] > bd) {
        bd = dist[i];
        bi = i;
      }
    }
    if (bi < 0) break;                               
    take(bi);
  }
  return chosen;
}


export function computeConvexHull(points, maxVerts = DEFAULT_MAX_HULL_VERTS) {
  if (!Array.isArray(points) || points.length < 4) return null;
  const finite = points.filter(isFiniteVec);
  if (finite.length < 4) return null;
  const b = boundsOfPoints(finite);
  const diag = Math.sqrt(
    (b.hiX - b.loX) ** 2 + (b.hiY - b.loY) ** 2 + (b.hiZ - b.loZ) ** 2,
  );
  if (!(diag > 1e-9)) return null;
  const eps = Math.max(1e-10, diag * 1e-6);
  const cap = Math.max(4, Math.min(64, Math.floor(maxVerts) || DEFAULT_MAX_HULL_VERTS));
  let pts = uniquePoints(finite, 0);
  if (pts.length < 4) return null;
  if (pts.length > MAX_UNIQUE_POINTS) {

    const stride = Math.ceil(pts.length / (MAX_UNIQUE_POINTS - 6));
    const sub = [];
    for (let i = 0; i < pts.length; i += stride) sub.push(pts[i]);
    for (const i of axisExtremeIndices(pts)) sub.push(pts[i]);
    pts = sub;
  }
  const raw = quickhull(pts, eps);
  if (raw && raw.vertices.length <= cap && hullContainsAll(raw, pts, eps * 16)) {
    return raw;
  }


  const sample = farthestPointSample(pts, cap, axisExtremeIndices(pts));
  if (sample.length < 4) return null;
  const hull = quickhull(sample, eps);
  if (hull && hull.vertices.length <= cap && hullContainsAll(hull, sample, eps * 16)) {
    return hull;
  }
  return null;
}


function triBoxOverlap(cx, cy, cz, hx, hy, hz, t) {


  const pad = 1e-7 * (hx + hy + hz) + 1e-12;
  hx += pad;
  hy += pad;
  hz += pad;
  const v0x = t[0] - cx, v0y = t[1] - cy, v0z = t[2] - cz;
  const v1x = t[3] - cx, v1y = t[4] - cy, v1z = t[5] - cz;
  const v2x = t[6] - cx, v2y = t[7] - cy, v2z = t[8] - cz;
  let min = Math.min(v0x, v1x, v2x), max = Math.max(v0x, v1x, v2x);
  if (min > hx || max < -hx) return false;
  min = Math.min(v0y, v1y, v2y); max = Math.max(v0y, v1y, v2y);
  if (min > hy || max < -hy) return false;
  min = Math.min(v0z, v1z, v2z); max = Math.max(v0z, v1z, v2z);
  if (min > hz || max < -hz) return false;

  const e0x = v1x - v0x, e0y = v1y - v0y, e0z = v1z - v0z;
  const e1x = v2x - v1x, e1y = v2y - v1y, e1z = v2z - v1z;
  const e2x = v0x - v2x, e2y = v0y - v2y, e2z = v0z - v2z;


  const nx = e0y * e1z - e0z * e1y;
  const ny = e0z * e1x - e0x * e1z;
  const nz = e0x * e1y - e0y * e1x;
  const dPlane = nx * v0x + ny * v0y + nz * v0z;
  const rPlane = hx * Math.abs(nx) + hy * Math.abs(ny) + hz * Math.abs(nz);
  if (dPlane > rPlane || dPlane < -rPlane) return false;


  const axisTest = (ax, ay, az) => {
    const p0 = ax * v0x + ay * v0y + az * v0z;
    const p1 = ax * v1x + ay * v1y + az * v1z;
    const p2 = ax * v2x + ay * v2y + az * v2z;
    const r = hx * Math.abs(ax) + hy * Math.abs(ay) + hz * Math.abs(az);
    return Math.min(p0, p1, p2) > r || Math.max(p0, p1, p2) < -r;
  };
  if (axisTest(0, -e0z, e0y)) return false;
  if (axisTest(0, -e1z, e1y)) return false;
  if (axisTest(0, -e2z, e2y)) return false;
  if (axisTest(e0z, 0, -e0x)) return false;
  if (axisTest(e1z, 0, -e1x)) return false;
  if (axisTest(e2z, 0, -e2x)) return false;
  if (axisTest(-e0y, e0x, 0)) return false;
  if (axisTest(-e1y, e1x, 0)) return false;
  if (axisTest(-e2y, e2x, 0)) return false;
  return true;
}

function tryDecompose(soup, b, res, maxBoxes) {
  const ex = b.hiX - b.loX, ey = b.hiY - b.loY, ez = b.hiZ - b.loZ;
  const maxExt = Math.max(ex, ey, ez);
  const cell = maxExt / res;
  if (!(cell > 1e-9)) return null;
  const nx = Math.max(1, Math.min(res, Math.ceil(ex / cell - 1e-9) || 1));
  const ny = Math.max(1, Math.min(res, Math.ceil(ey / cell - 1e-9) || 1));
  const nz = Math.max(1, Math.min(res, Math.ceil(ez / cell - 1e-9) || 1));

  const gx = (b.loX + b.hiX) / 2 - (nx * cell) / 2;
  const gy = (b.loY + b.hiY) / 2 - (ny * cell) / 2;
  const gz = (b.loZ + b.hiZ) / 2 - (nz * cell) / 2;
  const total = nx * ny * nz;
  const at = (x, y, z) => x + nx * (y + ny * z);
  const surface = new Uint8Array(total);
  const h = cell / 2;
  const tri = new Array(9);
  const triCount = Math.floor(soup.length / 9);
  for (let ti = 0; ti < triCount; ti++) {
    const base = ti * 9;
    let bad = false;
    let tLoX = Infinity, tLoY = Infinity, tLoZ = Infinity;
    let tHiX = -Infinity, tHiY = -Infinity, tHiZ = -Infinity;
    for (let k = 0; k < 9; k++) {
      const val = soup[base + k];
      if (!Number.isFinite(val)) {
        bad = true;
        break;
      }
      tri[k] = val;
      const axis = k % 3;
      if (axis === 0) {
        if (val < tLoX) tLoX = val;
        if (val > tHiX) tHiX = val;
      } else if (axis === 1) {
        if (val < tLoY) tLoY = val;
        if (val > tHiY) tHiY = val;
      } else {
        if (val < tLoZ) tLoZ = val;
        if (val > tHiZ) tHiZ = val;
      }
    }
    if (bad) continue;


    const x0 = Math.min(nx - 1, Math.max(0, Math.floor((tLoX - gx) / cell)));
    const x1 = Math.min(nx - 1, Math.max(0, Math.floor((tHiX - gx) / cell)));
    const y0 = Math.min(ny - 1, Math.max(0, Math.floor((tLoY - gy) / cell)));
    const y1 = Math.min(ny - 1, Math.max(0, Math.floor((tHiY - gy) / cell)));
    const z0 = Math.min(nz - 1, Math.max(0, Math.floor((tLoZ - gz) / cell)));
    const z1 = Math.min(nz - 1, Math.max(0, Math.floor((tHiZ - gz) / cell)));
    for (let z = z0; z <= z1; z++) {
      for (let y = y0; y <= y1; y++) {
        for (let x = x0; x <= x1; x++) {
          const idx = at(x, y, z);
          if (surface[idx]) continue;
          if (
            triBoxOverlap(
              gx + (x + 0.5) * cell,
              gy + (y + 0.5) * cell,
              gz + (z + 0.5) * cell,
              h, h, h, tri,
            )
          ) {
            surface[idx] = 1;
          }
        }
      }
    }
  }


  const outside = new Uint8Array(total);
  const stack = [];
  const pushIfEmpty = (x, y, z) => {
    const idx = at(x, y, z);
    if (!surface[idx] && !outside[idx]) {
      outside[idx] = 1;
      stack.push(x, y, z);
    }
  };
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      for (let x = 0; x < nx; x++) {
        if (x === 0 || y === 0 || z === 0 || x === nx - 1 || y === ny - 1 || z === nz - 1) {
          pushIfEmpty(x, y, z);
        }
      }
    }
  }
  while (stack.length) {
    const z = stack.pop(), y = stack.pop(), x = stack.pop();
    if (x > 0) pushIfEmpty(x - 1, y, z);
    if (x < nx - 1) pushIfEmpty(x + 1, y, z);
    if (y > 0) pushIfEmpty(x, y - 1, z);
    if (y < ny - 1) pushIfEmpty(x, y + 1, z);
    if (z > 0) pushIfEmpty(x, y, z - 1);
    if (z < nz - 1) pushIfEmpty(x, y, z + 1);
  }


  const boxes = [];
  for (let z = 0; z < nz; z++) {
    for (let y = 0; y < ny; y++) {
      let runStart = -1;
      for (let x = 0; x < nx; x++) {
        const idx = at(x, y, z);
        const occ = surface[idx] === 1 || outside[idx] === 0;
        if (occ && runStart < 0) runStart = x;
        if ((!occ || x === nx - 1) && runStart >= 0) {
          const runEnd = occ ? x : x - 1;
          const lenCells = runEnd - runStart + 1;
          boxes.push({
            c: {
              x: gx + ((runStart + runEnd + 1) / 2) * cell,
              y: gy + (y + 0.5) * cell,
              z: gz + (z + 0.5) * cell,
            },
            h: { x: h * lenCells, y: h, z: h },
          });
          runStart = -1;
          if (boxes.length > maxBoxes) return null;
        }
      }
    }
  }
  return boxes.length ? boxes : null;
}


export function voxelDecompose(soup, opts = {}) {
  if (!soup || soup.length < 9) return null;
  let loX = Infinity, loY = Infinity, loZ = Infinity;
  let hiX = -Infinity, hiY = -Infinity, hiZ = -Infinity;
  let finite = 0;
  const usable = Math.floor(soup.length / 9) * 9;
  for (let i = 0; i < usable; i += 3) {
    const x = soup[i], y = soup[i + 1], z = soup[i + 2];
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) continue;
    finite++;
    if (x < loX) loX = x;
    if (y < loY) loY = y;
    if (z < loZ) loZ = z;
    if (x > hiX) hiX = x;
    if (y > hiY) hiY = y;
    if (z > hiZ) hiZ = z;
  }
  if (finite < 3) return null;
  const b = { loX, loY, loZ, hiX, hiY, hiZ };
  if (!(Math.max(hiX - loX, hiY - loY, hiZ - loZ) > 1e-9)) return null;
  const maxBoxes = Math.max(8, Math.min(128, Math.floor(opts.maxBoxes) || DEFAULT_MAX_BOXES));
  const res0 = Math.max(MIN_RES, Math.min(16, Math.floor(opts.res) || DEFAULT_RES));
  for (let res = res0; res >= MIN_RES; res -= 4) {
    const boxes = tryDecompose(soup, b, res, maxBoxes);
    if (boxes) return boxes;
  }
  return null;
}


export function normalizeSoup(positions, center, maxDim) {
  if (!positions || positions.length < 9) return null;
  const inv = Number.isFinite(maxDim) && maxDim > 1e-9 ? 1 / maxDim : 1;
  const cx = (center && Number.isFinite(center.x) && center.x) || 0;
  const cy = (center && Number.isFinite(center.y) && center.y) || 0;
  const cz = (center && Number.isFinite(center.z) && center.z) || 0;
  const usable = Math.floor(positions.length / 9) * 9;
  const out = new Float64Array(usable);
  for (let i = 0; i < usable; i += 3) {
    out[i] = (positions[i] - cx) * inv;
    out[i + 1] = (positions[i + 1] - cy) * inv;
    out[i + 2] = (positions[i + 2] - cz) * inv;
  }
  return out;
}


export function closedSoupVolume(soup) {
  if (!soup || typeof soup.length !== "number") return null;
  const len = Math.floor(soup.length / 9) * 9;
  const tris = len / 9;
  if (tris < 4 || tris > MAX_SOUP_TRIS) return null;
  const edges = new Map();                                               
  let six = 0;
  for (let i = 0; i < len; i += 9) {
    const ax = soup[i], ay = soup[i + 1], az = soup[i + 2];
    const bx = soup[i + 3], by = soup[i + 4], bz = soup[i + 5];
    const cx = soup[i + 6], cy = soup[i + 7], cz = soup[i + 8];
    if (
      !Number.isFinite(ax) || !Number.isFinite(ay) || !Number.isFinite(az) ||
      !Number.isFinite(bx) || !Number.isFinite(by) || !Number.isFinite(bz) ||
      !Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(cz)
    ) {
      return null;
    }
    six += ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx);
    const ka = ax + "," + ay + "," + az;
    const kb = bx + "," + by + "," + bz;
    const kc = cx + "," + cy + "," + cz;
    edges.set(ka + "|" + kb, (edges.get(ka + "|" + kb) || 0) + 1);
    edges.set(kb + "|" + kc, (edges.get(kb + "|" + kc) || 0) + 1);
    edges.set(kc + "|" + ka, (edges.get(kc + "|" + ka) || 0) + 1);
  }
  for (const [key, count] of edges) {
    const sep = key.indexOf("|");
    const rev = key.slice(sep + 1) + "|" + key.slice(0, sep);
    if ((edges.get(rev) || 0) !== count) return null;                          
  }
  const vol = Math.abs(six) / 6;
  return Number.isFinite(vol) && vol > 1e-12 ? vol : null;
}


export function buildMeshCollision(soup, opts = {}) {
  if (!soup || soup.length < 9) return null;
  const tris = Math.floor(soup.length / 9);
  const strideTris = Math.max(1, Math.ceil(tris / Math.floor(MAX_HULL_INPUT / 3)));
  const pts = [];
  for (let t = 0; t < tris; t += strideTris) {
    const base = t * 9;
    for (let k = 0; k < 9; k += 3) {
      pts.push({ x: soup[base + k], y: soup[base + k + 1], z: soup[base + k + 2] });
    }
  }


  if (strideTris > 1) {
    const nV = tris * 3;
    const exi = [0, 0, 0, 0, 0, 0];
    for (let v = 1; v < nV; v++) {
      const off = v * 3;
      if (soup[off] < soup[exi[0] * 3]) exi[0] = v;
      if (soup[off] > soup[exi[1] * 3]) exi[1] = v;
      if (soup[off + 1] < soup[exi[2] * 3 + 1]) exi[2] = v;
      if (soup[off + 1] > soup[exi[3] * 3 + 1]) exi[3] = v;
      if (soup[off + 2] < soup[exi[4] * 3 + 2]) exi[4] = v;
      if (soup[off + 2] > soup[exi[5] * 3 + 2]) exi[5] = v;
    }
    for (const v of exi) {
      pts.push({ x: soup[v * 3], y: soup[v * 3 + 1], z: soup[v * 3 + 2] });
    }
  }
  let hull = null;
  let boxes = null;
  try {
    hull = computeConvexHull(pts, opts.maxHullVerts || DEFAULT_MAX_HULL_VERTS);
  } catch (_) {
    hull = null;
  }
  try {
    if (tris <= MAX_SOUP_TRIS) boxes = voxelDecompose(soup, opts);
  } catch (_) {
    boxes = null;
  }
  if (!hull && !boxes) return null;
  let volume = null;
  try {
    volume = closedSoupVolume(soup);
  } catch (_) {
    volume = null;                                                  
  }
  return { hull, boxes, volume };
}


const RAY_EPS = 1e-9;


function rayAabb(o, d, cx, cy, cz, hx, hy, hz, tMax) {
  let tEnter = 0;
  let tExit = tMax;
  let nX = 0, nY = 0, nZ = 0;
  const ox = o.x - cx, oy = o.y - cy, oz = o.z - cz;
  if (Math.abs(d.x) < 1e-12) {
    if (ox > hx || ox < -hx) return null;
  } else {
    let t1 = (-hx - ox) / d.x;
    let t2 = (hx - ox) / d.x;
    let s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tEnter) { tEnter = t1; nX = s; nY = 0; nZ = 0; }
    if (t2 < tExit) tExit = t2;
    if (tEnter > tExit) return null;
  }
  if (Math.abs(d.y) < 1e-12) {
    if (oy > hy || oy < -hy) return null;
  } else {
    let t1 = (-hy - oy) / d.y;
    let t2 = (hy - oy) / d.y;
    let s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tEnter) { tEnter = t1; nX = 0; nY = s; nZ = 0; }
    if (t2 < tExit) tExit = t2;
    if (tEnter > tExit) return null;
  }
  if (Math.abs(d.z) < 1e-12) {
    if (oz > hz || oz < -hz) return null;
  } else {
    let t1 = (-hz - oz) / d.z;
    let t2 = (hz - oz) / d.z;
    let s = -1;
    if (t1 > t2) { const tmp = t1; t1 = t2; t2 = tmp; s = 1; }
    if (t1 > tEnter) { tEnter = t1; nX = 0; nY = 0; nZ = s; }
    if (t2 < tExit) tExit = t2;
    if (tEnter > tExit) return null;
  }
  if (tEnter <= RAY_EPS || (nX === 0 && nY === 0 && nZ === 0)) return null;
  return { t: tEnter, normal: { x: nX, y: nY, z: nZ } };
}


function rayHull(hull, sx, sy, sz, o, d, tMax) {
  const vs = hull.vertices;
  let ccx = 0, ccy = 0, ccz = 0;
  for (const v of vs) {
    ccx += v.x * sx; ccy += v.y * sy; ccz += v.z * sz;
  }
  ccx /= vs.length; ccy /= vs.length; ccz /= vs.length;
  let tEnter = 0;
  let tExit = tMax;
  let enterN = null;
  for (const face of hull.faces) {
    const a = vs[face[0]], b = vs[face[1]], c = vs[face[2]];
    const ax = a.x * sx, ay = a.y * sy, az = a.z * sz;
    const ux = b.x * sx - ax, uy = b.y * sy - ay, uz = b.z * sz - az;
    const wx = c.x * sx - ax, wy = c.y * sy - ay, wz = c.z * sz - az;
    let nx = uy * wz - uz * wy;
    let ny = uz * wx - ux * wz;
    let nz = ux * wy - uy * wx;
    const L = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (L < 1e-12) continue;                                   
    nx /= L; ny /= L; nz /= L;
    let dd = nx * ax + ny * ay + nz * az;
    if (nx * ccx + ny * ccy + nz * ccz - dd > 0) {
      nx = -nx; ny = -ny; nz = -nz; dd = -dd;
    }
    const denom = nx * d.x + ny * d.y + nz * d.z;
    const dist = nx * o.x + ny * o.y + nz * o.z - dd;
    if (Math.abs(denom) < 1e-12) {
      if (dist > 0) return null;                   
      continue;
    }
    const t = -dist / denom;
    if (denom < 0) {
      if (t > tEnter) {
        tEnter = t;
        enterN = { x: nx, y: ny, z: nz };
      }
    } else if (t < tExit) {
      tExit = t;
    }
    if (tEnter > tExit) return null;
  }
  if (tEnter <= RAY_EPS || !enterN) return null;
  return { t: tEnter, normal: enterN };
}


export function raycastMeshCollision(col, fidelity, sx, sy, sz, o, d, tMax) {
  if (!col || !(tMax > 0)) return undefined;
  const wantDecomp = fidelity === "Default" || fidelity === "PreciseConvexDecomposition";
  if (wantDecomp && col.boxes && col.boxes.length) {
    for (const b of col.boxes) {
      if (
        Math.abs(o.x - b.c.x * sx) <= Math.max(0.025, b.h.x * sx) &&
        Math.abs(o.y - b.c.y * sy) <= Math.max(0.025, b.h.y * sy) &&
        Math.abs(o.z - b.c.z * sz) <= Math.max(0.025, b.h.z * sz)
      ) {
        return null;                           
      }
    }
    let best = null;
    for (const b of col.boxes) {
      const hit = rayAabb(
        o, d,
        b.c.x * sx, b.c.y * sy, b.c.z * sz,
        Math.max(0.025, b.h.x * sx),
        Math.max(0.025, b.h.y * sy),
        Math.max(0.025, b.h.z * sz),
        best ? best.t : tMax,
      );
      if (hit && (!best || hit.t < best.t)) best = hit;
    }
    return best;
  }
  if (col.hull && Array.isArray(col.hull.vertices) && col.hull.vertices.length >= 4) {
    return rayHull(col.hull, sx, sy, sz, o, d, tMax);
  }
  return undefined;
}
