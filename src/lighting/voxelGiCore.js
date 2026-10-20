export const GI_DIM = 48;
export const GI_MAX_BOXES = 20000;
export const GI_MAX_LIGHTS = 16;


export const GI_MAX_TRANS_BOXES = 64;

export const GI_FOCUS_CELL = 4;


export function sanitizeGiDim(v) {
  const n = Math.floor(fin(v, GI_DIM));
  return n < 16 ? 16 : n > 96 ? 96 : n;
}

const GI_MIN_CELL = 1;
const GI_MAX_CELL = 16;
const WORLD_CAP = 10000;
const HALF_CAP = 512;


const LIGHT_SKIP_CELLS = 1.5;
const LIGHT_SKIP_STUDS = 2.5;
const SUN_BOUNCE = 0.85;
const LIGHT_BOUNCE = 0.35;
const DIFFUSE_DECAY = 0.86;
const BOUNCE2 = 0.6;
const BAKE_GAIN = 300;


const FACE_N = [
  [1, 0, 0],
  [-1, 0, 0],
  [0, 1, 0],
  [0, -1, 0],
  [0, 0, 1],
  [0, 0, -1],
];

function fin(v, d) {
  return Number.isFinite(v) ? v : d;
}

function clamp01(v) {
  v = fin(v, 0);
  return v < 0 ? 0 : v > 1 ? 1 : v;
}

function clampCenter(f, mn, mx, half) {
  if (mx - mn <= half * 2) return (mn + mx) / 2;
  return Math.min(mx - half, Math.max(mn + half, f));
}


export function fitGridToBoxes(boxes, focus, dimArg) {
  const dim = sanitizeGiDim(dimArg);                                    
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const end = Math.min(boxes ? boxes.length : 0, GI_MAX_BOXES);
  for (let i = 0; i < end; i++) {
    const b = boxes[i];
    if (!b || !b.c || !b.h) continue;
    const cx = fin(b.c[0], NaN), cy = fin(b.c[1], NaN), cz = fin(b.c[2], NaN);
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(cz)) continue;
    if (Math.abs(cx) > WORLD_CAP || Math.abs(cy) > WORLD_CAP || Math.abs(cz) > WORLD_CAP) continue;
    const r = Math.min(256, Math.hypot(fin(b.h[0], 0), fin(b.h[1], 0), fin(b.h[2], 0)));
    minX = Math.min(minX, cx - r); maxX = Math.max(maxX, cx + r);
    minY = Math.min(minY, cy - r); maxY = Math.max(maxY, cy + r);
    minZ = Math.min(minZ, cz - r); maxZ = Math.max(maxZ, cz + r);
  }
  if (!Number.isFinite(minX)) {
    minX = -64; maxX = 64; minY = -16; maxY = 48; minZ = -64; maxZ = 64;
  }
  const span = Math.max(maxX - minX, maxY - minY, maxZ - minZ, 32);
  let cell = Math.min(GI_MAX_CELL, Math.max(GI_MIN_CELL, (span * 1.05) / dim));
  let cx = (minX + maxX) / 2;
  let cy = (minY + maxY) / 2;
  let cz = (minZ + maxZ) / 2;
  const fx = focus ? fin(focus[0], NaN) : NaN;
  const fy = focus ? fin(focus[1], NaN) : NaN;
  const fz = focus ? fin(focus[2], NaN) : NaN;
  if (cell > GI_FOCUS_CELL && Number.isFinite(fx) && Number.isFinite(fy) && Number.isFinite(fz) &&
    Math.abs(fx) <= WORLD_CAP && Math.abs(fy) <= WORLD_CAP && Math.abs(fz) <= WORLD_CAP) {
    cell = GI_FOCUS_CELL;
    const h = (dim * cell) / 2;
    cx = clampCenter(fx, minX, maxX, h);
    cy = clampCenter(fy, minY, maxY, h);
    cz = clampCenter(fz, minZ, maxZ, h);
  }
  const half = (dim * cell) / 2;
  return {
    origin: [cx - half, cy - half, cz - half],
    cell,
  };
}

export function createGrid(origin, cell, dimArg) {
  const dim = sanitizeGiDim(dimArg);                                     
  const n = dim * dim * dim;
  return {
    dim,
    n,
    cell: Math.min(GI_MAX_CELL, Math.max(0.25, fin(cell, 2))),
    origin: [fin(origin && origin[0], 0), fin(origin && origin[1], 0), fin(origin && origin[2], 0)],
    occ: new Uint8Array(n),
    alb: new Float32Array(n * 3),
    src: new Float32Array(n * 3),
    ea: new Float32Array(n * 3),
    eb: new Float32Array(n * 3),

    surfLut: null,                                                       
    surfMask: null,                                                
    faceSrc: null,                                                              
  };
}


export function voxelizeBoxes(grid, boxes, from = 0, to = Infinity) {
  const { dim, cell, origin, occ, alb } = grid;
  const inv = 1 / cell;
  const pad = cell * 0.45;
  const end = Math.min(to, boxes.length, GI_MAX_BOXES);
  for (let bi = Math.max(0, from); bi < end; bi++) {
    const b = boxes[bi];
    if (!b || !b.c || !b.h) continue;
    const cx = fin(b.c[0], NaN), cy = fin(b.c[1], NaN), cz = fin(b.c[2], NaN);
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(cz)) continue;
    if (Math.abs(cx) > WORLD_CAP || Math.abs(cy) > WORLD_CAP || Math.abs(cz) > WORLD_CAP) continue;
    const hx = Math.min(HALF_CAP, Math.abs(fin(b.h[0], 0)));
    const hy = Math.min(HALF_CAP, Math.abs(fin(b.h[1], 0)));
    const hz = Math.min(HALF_CAP, Math.abs(fin(b.h[2], 0)));
    if (Math.max(hx, hy, hz) < 0.01) continue;
    const ax = b.axes ? b.axes[0] : null;
    const ay = b.axes ? b.axes[1] : null;
    const az = b.axes ? b.axes[2] : null;

    let ex, ey, ez;
    if (ax && ay && az) {
      ex = Math.abs(ax[0]) * hx + Math.abs(ay[0]) * hy + Math.abs(az[0]) * hz;
      ey = Math.abs(ax[1]) * hx + Math.abs(ay[1]) * hy + Math.abs(az[1]) * hz;
      ez = Math.abs(ax[2]) * hx + Math.abs(ay[2]) * hy + Math.abs(az[2]) * hz;
    } else {
      ex = hx; ey = hy; ez = hz;
    }
    let x0 = Math.floor((cx - ex - pad - origin[0]) * inv);
    let x1 = Math.floor((cx + ex + pad - origin[0]) * inv);
    let y0 = Math.floor((cy - ey - pad - origin[1]) * inv);
    let y1 = Math.floor((cy + ey + pad - origin[1]) * inv);
    let z0 = Math.floor((cz - ez - pad - origin[2]) * inv);
    let z1 = Math.floor((cz + ez + pad - origin[2]) * inv);
    if (x1 < 0 || y1 < 0 || z1 < 0 || x0 >= dim || y0 >= dim || z0 >= dim) continue;
    x0 = Math.max(0, x0); y0 = Math.max(0, y0); z0 = Math.max(0, z0);
    x1 = Math.min(dim - 1, x1); y1 = Math.min(dim - 1, y1); z1 = Math.min(dim - 1, z1);
    const cr = clamp01(b.color ? b.color[0] : 0.7);
    const cg = clamp01(b.color ? b.color[1] : 0.7);
    const cb = clamp01(b.color ? b.color[2] : 0.7);
    for (let z = z0; z <= z1; z++) {
      const pz = origin[2] + (z + 0.5) * cell - cz;
      for (let y = y0; y <= y1; y++) {
        const py = origin[1] + (y + 0.5) * cell - cy;
        for (let x = x0; x <= x1; x++) {
          const px = origin[0] + (x + 0.5) * cell - cx;
          let inside;
          if (ax && ay && az) {
            inside =
              Math.abs(px * ax[0] + py * ax[1] + pz * ax[2]) <= hx + pad &&
              Math.abs(px * ay[0] + py * ay[1] + pz * ay[2]) <= hy + pad &&
              Math.abs(px * az[0] + py * az[1] + pz * az[2]) <= hz + pad;
          } else {
            inside = Math.abs(px) <= hx + pad && Math.abs(py) <= hy + pad && Math.abs(pz) <= hz + pad;
          }
          if (!inside) continue;
          const i = x + dim * (y + dim * z);
          occ[i] = 1;
          alb[i * 3] = cr;
          alb[i * 3 + 1] = cg;
          alb[i * 3 + 2] = cb;
        }
      }
    }
  }
}


export function listSurfaceCells(grid) {
  const { dim, occ } = grid;
  const dd = dim * dim;
  const out = [];
  const masks = [];
  const lut = new Int32Array(grid.n).fill(-1);
  for (let z = 0; z < dim; z++) {
    for (let y = 0; y < dim; y++) {
      for (let x = 0; x < dim; x++) {
        const i = x + dim * (y + dim * z);
        if (!occ[i]) continue;
        let m = 0;
        if (x === dim - 1 || !occ[i + 1]) m |= 1;      
        if (x === 0 || !occ[i - 1]) m |= 2;      
        if (y === dim - 1 || !occ[i + dim]) m |= 4;      
        if (y === 0 || !occ[i - dim]) m |= 8;      
        if (z === dim - 1 || !occ[i + dd]) m |= 16;      
        if (z === 0 || !occ[i - dd]) m |= 32;      
        if (!m) continue;
        lut[i] = out.length;
        out.push(i);
        masks.push(m);
      }
    }
  }
  grid.surfLut = lut;
  grid.surfMask = Uint8Array.from(masks);
  grid.faceSrc = new Float32Array(out.length * 18);
  return Int32Array.from(out);
}


export function sunVisibility(grid, ix, iy, iz, sd, sx, sy, sz) {
  const { dim, occ } = grid;
  const ox = Number.isFinite(sx) ? sx : ix + 0.5;
  const oy = Number.isFinite(sy) ? sy : iy + 0.5;
  const oz = Number.isFinite(sz) ? sz : iz + 0.5;
  const steps = dim * 4;
  let t = 0.5;
  for (let s = 0; s < steps; s++) {
    const fx = ox + sd[0] * t;
    const fy = oy + sd[1] * t;
    const fz = oz + sd[2] * t;
    const gx = Math.floor(fx);
    const gy = Math.floor(fy);
    const gz = Math.floor(fz);
    if (gx < 0 || gy < 0 || gz < 0 || gx >= dim || gy >= dim || gz >= dim) return 1;
    if (!(gx === ix && gy === iy && gz === iz) && occ[gx + dim * (gy + dim * gz)]) return 0;
    t += 0.5;
  }
  return 1;
}


function sunTintThrough(transBoxes, wx, wy, wz, sdx, sdy, sdz) {
  if (!transBoxes || !transBoxes.length) return null;
  let tr = 1, tg = 1, tb = 1;

  const endTb = Math.min(transBoxes.length, GI_MAX_TRANS_BOXES);
  for (let bi = 0; bi < endTb; bi++) {
    const tb2 = transBoxes[bi];
    if (!tb2 || !tb2.c || !tb2.h || !tb2.tint) continue;
    const cx = tb2.c[0], cy = tb2.c[1], cz = tb2.c[2];
    const hx = tb2.h[0], hy = tb2.h[1], hz = tb2.h[2];


    if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(cz) ||
      !Number.isFinite(hx) || !Number.isFinite(hy) || !Number.isFinite(hz)) continue;


    let tEnter = -Infinity;
    let tExit = Infinity;
    let miss = false;
    for (let ax = 0; ax < 3 && !miss; ax++) {
      const o = ax === 0 ? wx : ax === 1 ? wy : wz;
      const dRay = ax === 0 ? sdx : ax === 1 ? sdy : sdz;
      const cAx = ax === 0 ? cx : ax === 1 ? cy : cz;
      const hAx = ax === 0 ? hx : ax === 1 ? hy : hz;
      if (Math.abs(dRay) < 1e-9) {

        if (o < cAx - hAx || o > cAx + hAx) miss = true;
        continue;
      }
      let t0 = (cAx - hAx - o) / dRay;
      let t1 = (cAx + hAx - o) / dRay;
      if (t0 > t1) { const tSwap = t0; t0 = t1; t1 = tSwap; }
      if (t0 > tEnter) tEnter = t0;
      if (t1 < tExit) tExit = t1;
      if (tEnter > tExit) miss = true;
    }

    if (miss || tExit < 0) continue;


    tr *= clamp01(tb2.tint.r);
    tg *= clamp01(tb2.tint.g);
    tb *= clamp01(tb2.tint.b);
  }
  if (tr >= 0.99 && tg >= 0.99 && tb >= 0.99) return null;          
  return [tr, tg, tb];
}


export function injectSun(grid, surf, sun, from = 0, to = Infinity, transBoxes) {
  if (!sun || !sun.dir) return;
  let dx = fin(sun.dir[0], 0), dy = fin(sun.dir[1], 1), dz = fin(sun.dir[2], 0);
  const len = Math.hypot(dx, dy, dz);
  if (len < 1e-6) return;
  dx /= len; dy /= len; dz /= len;
  const sd = [dx, dy, dz];
  const inten = Math.min(4, Math.max(0, fin(sun.intensity, 1)));
  const sr = clamp01(sun.color ? sun.color[0] : 1) * inten * SUN_BOUNCE;
  const sg = clamp01(sun.color ? sun.color[1] : 1) * inten * SUN_BOUNCE;
  const sb = clamp01(sun.color ? sun.color[2] : 1) * inten * SUN_BOUNCE;
  if (sr <= 0 && sg <= 0 && sb <= 0) return;
  const { dim, src, alb } = grid;
  const mask = grid.surfMask;
  const fsrc = grid.faceSrc;
  const end = Math.min(to, surf.length);
  for (let k = Math.max(0, from); k < end; k++) {
    const i = surf[k];
    const iz = (i / (dim * dim)) | 0;
    const iy = ((i / dim) | 0) % dim;
    const ix = i % dim;
    const m = mask ? mask[k] : 63;

    let best = -1;
    let bestW = 0;
    let w0 = 0, w1 = 0, w2 = 0, w3 = 0, w4 = 0, w5 = 0;
    for (let f = 0; f < 6; f++) {
      if (!((m >> f) & 1)) continue;
      const n = FACE_N[f];
      const w = n[0] * sd[0] + n[1] * sd[1] + n[2] * sd[2];
      if (w <= 1e-4) continue;
      if (f === 0) w0 = w; else if (f === 1) w1 = w; else if (f === 2) w2 = w;
      else if (f === 3) w3 = w; else if (f === 4) w4 = w; else w5 = w;
      if (w > bestW) { bestW = w; best = f; }
    }
    if (best < 0) continue;
    const bn = FACE_N[best];

    const sx0 = ix + 0.5 + bn[0] * 0.55;
    const sy0 = iy + 0.5 + bn[1] * 0.55;
    const sz0 = iz + 0.5 + bn[2] * 0.55;
    if (!sunVisibility(grid, ix, iy, iz, sd, sx0, sy0, sz0)) continue;
    const ar = alb[i * 3], ag = alb[i * 3 + 1], ab = alb[i * 3 + 2];
    const fb = fsrc ? k * 18 : -1;


    const wx = grid.origin[0] + (ix + 0.5) * grid.cell;
    const wy = grid.origin[1] + (iy + 0.5) * grid.cell;
    const wz = grid.origin[2] + (iz + 0.5) * grid.cell;
    const tint = sunTintThrough(transBoxes, wx, wy, wz, dx, dy, dz);
    const txr = tint ? tint[0] : 1;
    const txg = tint ? tint[1] : 1;
    const txb = tint ? tint[2] : 1;
    for (let f = 0; f < 6; f++) {
      const w = f === 0 ? w0 : f === 1 ? w1 : f === 2 ? w2 : f === 3 ? w3 : f === 4 ? w4 : w5;
      if (w <= 0) continue;
      const er = ar * sr * w * txr, eg = ag * sg * w * txg, eb2 = ab * sb * w * txb;
      if (fb >= 0) {
        fsrc[fb + f * 3] += er;
        fsrc[fb + f * 3 + 1] += eg;
        fsrc[fb + f * 3 + 2] += eb2;
      }
      src[i * 3] += er;
      src[i * 3 + 1] += eg;
      src[i * 3 + 2] += eb2;
    }
  }
}


export function prepareLights(lights) {
  const out = [];
  if (!lights) return out;
  for (let i = 0; i < lights.length && out.length < GI_MAX_LIGHTS; i++) {
    const l = lights[i];
    if (!l || !l.pos) continue;
    const px = fin(l.pos[0], NaN), py = fin(l.pos[1], NaN), pz = fin(l.pos[2], NaN);
    if (!Number.isFinite(px) || !Number.isFinite(py) || !Number.isFinite(pz)) continue;
    const range = Math.min(60, Math.max(0, fin(l.range, 8)));
    const inten = Math.min(40, Math.max(0, fin(l.intensity, 1)));
    if (range <= 0.05 || inten <= 0) continue;
    const rec = {
      pos: [px, py, pz],
      color: [clamp01(l.color ? l.color[0] : 1), clamp01(l.color ? l.color[1] : 1), clamp01(l.color ? l.color[2] : 1)],
      range,
      intensity: inten,
      dir: null,
      cosAngle: -1,
    };
    if (l.dir) {
      const dl = Math.hypot(fin(l.dir[0], 0), fin(l.dir[1], 0), fin(l.dir[2], 0));
      if (dl > 1e-6) {
        rec.dir = [l.dir[0] / dl, l.dir[1] / dl, l.dir[2] / dl];
        rec.cosAngle = Math.min(1, Math.max(-1, fin(l.cosAngle, 0)));
      }
    }
    out.push(rec);
  }
  return out;
}


export function lightVisibility(grid, ix, iy, iz, lgx, lgy, lgz, sx, sy, sz) {
  const { dim, occ } = grid;
  const cell = Math.max(0.25, fin(grid.cell, 1));
  const ox = Number.isFinite(sx) ? sx : ix + 0.5;
  const oy = Number.isFinite(sy) ? sy : iy + 0.5;
  const oz = Number.isFinite(sz) ? sz : iz + 0.5;
  let dx = fin(lgx, NaN) - ox;
  let dy = fin(lgy, NaN) - oy;
  let dz = fin(lgz, NaN) - oz;
  const dist = Math.hypot(dx, dy, dz);
  if (!Number.isFinite(dist) || dist < 1e-6) return 1;
  dx /= dist;
  dy /= dist;
  dz /= dist;
  const lcx = Math.floor(fin(lgx, 0));
  const lcy = Math.floor(fin(lgy, 0));
  const lcz = Math.floor(fin(lgz, 0));
  const skipEnd = Math.min(LIGHT_SKIP_CELLS, Math.max(1, LIGHT_SKIP_STUDS / cell));
  const maxT = dist - skipEnd;
  let guard = dim * 4;
  for (let t = 0.5; t < maxT && guard > 0; t += 0.5, guard--) {
    const fx = ox + dx * t;
    const fy = oy + dy * t;
    const fz = oz + dz * t;
    const gx = Math.floor(fx);
    const gy = Math.floor(fy);
    const gz = Math.floor(fz);
    if (gx < 0 || gy < 0 || gz < 0 || gx >= dim || gy >= dim || gz >= dim) return 1;
    if (gx === ix && gy === iy && gz === iz) continue;                      
    if (gx === lcx && gy === lcy && gz === lcz) continue;                     
    if (occ[gx + dim * (gy + dim * gz)]) return 0;
  }
  return 1;
}


export function injectLights(grid, surf, lights, from = 0, to = Infinity) {
  if (!lights || lights.length === 0) return;
  const { dim, cell, origin, src, alb } = grid;
  const inv = 1 / cell;
  const mask = grid.surfMask;
  const fsrc = grid.faceSrc;


  const lgs = [];
  const skip = [];
  const coarse = cell > 6;
  for (let li = 0; li < lights.length; li++) {
    const l = lights[li];
    const gx = (l.pos[0] - origin[0]) * inv;
    const gy = (l.pos[1] - origin[1]) * inv;
    const gz = (l.pos[2] - origin[2]) * inv;
    lgs.push([gx, gy, gz]);
    let sk = false;
    if (coarse) {
      const cx = Math.floor(gx), cy = Math.floor(gy), cz = Math.floor(gz);
      if (cx >= 0 && cy >= 0 && cz >= 0 && cx < dim && cy < dim && cz < dim &&
        grid.occ[cx + dim * (cy + dim * cz)]) sk = true;
    }
    skip.push(sk);
  }
  const end = Math.min(to, surf.length);
  for (let k = Math.max(0, from); k < end; k++) {
    const i = surf[k];
    const iz = (i / (dim * dim)) | 0;
    const iy = ((i / dim) | 0) % dim;
    const ix = i % dim;
    const wx = origin[0] + (ix + 0.5) * cell;
    const wy = origin[1] + (iy + 0.5) * cell;
    const wz = origin[2] + (iz + 0.5) * cell;
    const m = mask ? mask[k] : 63;
    for (let li = 0; li < lights.length; li++) {
      if (skip[li]) continue;
      const l = lights[li];
      const dx = wx - l.pos[0];
      const dy = wy - l.pos[1];
      const dz = wz - l.pos[2];
      const d = Math.hypot(dx, dy, dz);
      if (d >= l.range) continue;
      if (l.dir) {
        const dot = d > 1e-6 ? (dx * l.dir[0] + dy * l.dir[1] + dz * l.dir[2]) / d : 1;
        if (dot < l.cosAngle) continue;
      }

      let tx = 0, ty = 1, tz = 0;
      const grazing = d <= 1e-6;                               
      if (!grazing) {
        tx = -dx / d; ty = -dy / d; tz = -dz / d;
      }
      let best = -1;
      let bestW = 0;
      let w0 = 0, w1 = 0, w2 = 0, w3 = 0, w4 = 0, w5 = 0;
      for (let f = 0; f < 6; f++) {
        if (!((m >> f) & 1)) continue;
        let w;
        if (grazing) {
          w = 1;
        } else {
          const nrm = FACE_N[f];
          w = nrm[0] * tx + nrm[1] * ty + nrm[2] * tz;
        }
        if (w <= 1e-4) continue;
        if (f === 0) w0 = w; else if (f === 1) w1 = w; else if (f === 2) w2 = w;
        else if (f === 3) w3 = w; else if (f === 4) w4 = w; else w5 = w;
        if (w > bestW) { bestW = w; best = f; }
      }
      if (best < 0) continue;                                                
      const lg = lgs[li];
      const bn = FACE_N[best];
      const sx0 = ix + 0.5 + bn[0] * 0.55;
      const sy0 = iy + 0.5 + bn[1] * 0.55;
      const sz0 = iz + 0.5 + bn[2] * 0.55;
      if (!grazing && !lightVisibility(grid, ix, iy, iz, lg[0], lg[1], lg[2], sx0, sy0, sz0)) continue;
      const att = 1 - d / l.range;
      const e = att * att * l.intensity * LIGHT_BOUNCE;
      const ar = alb[i * 3], ag = alb[i * 3 + 1], ab = alb[i * 3 + 2];
      const fb = fsrc ? k * 18 : -1;
      for (let f = 0; f < 6; f++) {
        const w = f === 0 ? w0 : f === 1 ? w1 : f === 2 ? w2 : f === 3 ? w3 : f === 4 ? w4 : w5;
        if (w <= 0) continue;
        const er = ar * l.color[0] * e * w;
        const eg = ag * l.color[1] * e * w;
        const eb2 = ab * l.color[2] * e * w;
        if (fb >= 0) {
          fsrc[fb + f * 3] += er;
          fsrc[fb + f * 3 + 1] += eg;
          fsrc[fb + f * 3 + 2] += eb2;
        }
        src[i * 3] += er;
        src[i * 3 + 1] += eg;
        src[i * 3 + 2] += eb2;
      }
    }
  }
}


export function propagateStep(grid, inBuf, outBuf, from = 0, to = Infinity) {
  const { dim, occ, src } = grid;
  const dd = dim * dim;
  const zFrom = Math.max(0, Math.floor(Math.max(0, from) / dd));
  const zEnd = Math.min(dim, Math.ceil(Math.min(to, grid.n) / dd));
  const lut = grid.surfLut;
  const fs = grid.faceSrc;


  for (let z = zFrom; z < zEnd; z++) {
    for (let y = 0; y < dim; y++) {
      for (let x = 0; x < dim; x++) {
        const i = x + dim * (y + dim * z);
        const o = i * 3;
        if (occ[i]) {
          outBuf[o] = 0; outBuf[o + 1] = 0; outBuf[o + 2] = 0;
          continue;
        }
        let r = 0, g = 0, b = 0;
        if (x > 0) {
          const nn = i - 1, no = nn * 3;
          if (occ[nn]) {
            const si = lut && fs ? lut[nn] : -1;
            if (si >= 0) { const fo = si * 18; r += fs[fo]; g += fs[fo + 1]; b += fs[fo + 2]; }
            else { r += src[no]; g += src[no + 1]; b += src[no + 2]; }
          } else { r += inBuf[no]; g += inBuf[no + 1]; b += inBuf[no + 2]; }
        }
        if (x < dim - 1) {
          const nn = i + 1, no = nn * 3;
          if (occ[nn]) {
            const si = lut && fs ? lut[nn] : -1;
            if (si >= 0) { const fo = si * 18 + 3; r += fs[fo]; g += fs[fo + 1]; b += fs[fo + 2]; }
            else { r += src[no]; g += src[no + 1]; b += src[no + 2]; }
          } else { r += inBuf[no]; g += inBuf[no + 1]; b += inBuf[no + 2]; }
        }
        if (y > 0) {
          const nn = i - dim, no = nn * 3;
          if (occ[nn]) {
            const si = lut && fs ? lut[nn] : -1;
            if (si >= 0) { const fo = si * 18 + 6; r += fs[fo]; g += fs[fo + 1]; b += fs[fo + 2]; }
            else { r += src[no]; g += src[no + 1]; b += src[no + 2]; }
          } else { r += inBuf[no]; g += inBuf[no + 1]; b += inBuf[no + 2]; }
        }
        if (y < dim - 1) {
          const nn = i + dim, no = nn * 3;
          if (occ[nn]) {
            const si = lut && fs ? lut[nn] : -1;
            if (si >= 0) { const fo = si * 18 + 9; r += fs[fo]; g += fs[fo + 1]; b += fs[fo + 2]; }
            else { r += src[no]; g += src[no + 1]; b += src[no + 2]; }
          } else { r += inBuf[no]; g += inBuf[no + 1]; b += inBuf[no + 2]; }
        }
        if (z > 0) {
          const nn = i - dd, no = nn * 3;
          if (occ[nn]) {
            const si = lut && fs ? lut[nn] : -1;
            if (si >= 0) { const fo = si * 18 + 12; r += fs[fo]; g += fs[fo + 1]; b += fs[fo + 2]; }
            else { r += src[no]; g += src[no + 1]; b += src[no + 2]; }
          } else { r += inBuf[no]; g += inBuf[no + 1]; b += inBuf[no + 2]; }
        }
        if (z < dim - 1) {
          const nn = i + dd, no = nn * 3;
          if (occ[nn]) {
            const si = lut && fs ? lut[nn] : -1;
            if (si >= 0) { const fo = si * 18 + 15; r += fs[fo]; g += fs[fo + 1]; b += fs[fo + 2]; }
            else { r += src[no]; g += src[no + 1]; b += src[no + 2]; }
          } else { r += inBuf[no]; g += inBuf[no + 1]; b += inBuf[no + 2]; }
        }
        const f = DIFFUSE_DECAY / 6;
        outBuf[o] = r * f;
        outBuf[o + 1] = g * f;
        outBuf[o + 2] = b * f;
      }
    }
  }
}


export function bounceInject(grid, surf, field, from = 0, to = Infinity) {
  const { dim, occ, src, alb } = grid;
  const dd = dim * dim;
  const fs = grid.faceSrc;
  const end = Math.min(surf.length, to);
  for (let k = Math.max(0, from); k < end; k++) {
    const i = surf[k];
    const iz = (i / dd) | 0;
    const iy = ((i / dim) | 0) % dim;
    const ix = i % dim;
    let cnt = 0;
    if (ix > 0 && !occ[i - 1]) cnt++;
    if (ix < dim - 1 && !occ[i + 1]) cnt++;
    if (iy > 0 && !occ[i - dim]) cnt++;
    if (iy < dim - 1 && !occ[i + dim]) cnt++;
    if (iz > 0 && !occ[i - dd]) cnt++;
    if (iz < dim - 1 && !occ[i + dd]) cnt++;
    if (!cnt) continue;
    const f = BOUNCE2 / cnt;
    const ar = alb[i * 3], ag = alb[i * 3 + 1], ab = alb[i * 3 + 2];
    const fb = fs ? k * 18 : -1;

    const add = (no, face) => {
      const er = ar * field[no] * f;
      const eg = ag * field[no + 1] * f;
      const eb2 = ab * field[no + 2] * f;
      if (fb >= 0) {
        fs[fb + face * 3] += er;
        fs[fb + face * 3 + 1] += eg;
        fs[fb + face * 3 + 2] += eb2;
      }
      src[i * 3] += er;
      src[i * 3 + 1] += eg;
      src[i * 3 + 2] += eb2;
    };
    if (ix > 0 && !occ[i - 1]) add((i - 1) * 3, 1);
    if (ix < dim - 1 && !occ[i + 1]) add((i + 1) * 3, 0);
    if (iy > 0 && !occ[i - dim]) add((i - dim) * 3, 3);
    if (iy < dim - 1 && !occ[i + dim]) add((i + dim) * 3, 2);
    if (iz > 0 && !occ[i - dd]) add((i - dd) * 3, 5);
    if (iz < dim - 1 && !occ[i + dd]) add((i + dd) * 3, 4);
  }
}


export function bake(grid, field, out, from = 0, to = Infinity) {
  const { n, occ, src } = grid;
  const lut = grid.surfLut;
  const fs = grid.faceSrc;
  const mask = grid.surfMask;
  const end = Math.min(n, to);
  for (let i = Math.max(0, from); i < end; i++) {
    const o = i * 3;
    const q = i * 4;
    let r, g, b;
    if (occ[i]) {
      const si = lut && fs && mask ? lut[i] : -1;
      if (si >= 0) {
        const m = mask[si];
        let mr = 0, mg = 0, mb = 0;
        let msum = Infinity;
        for (let f = 0; f < 6; f++) {
          if (!((m >> f) & 1)) continue;
          const fo = si * 18 + f * 3;
          const sum = fs[fo] + fs[fo + 1] + fs[fo + 2];
          if (sum < msum) {
            msum = sum;
            mr = fs[fo]; mg = fs[fo + 1]; mb = fs[fo + 2];
          }
        }
        if (!Number.isFinite(msum)) { mr = src[o]; mg = src[o + 1]; mb = src[o + 2]; }
        r = mr; g = mg; b = mb;
      } else {
        r = src[o]; g = src[o + 1]; b = src[o + 2];
      }
    } else {
      r = field[o]; g = field[o + 1]; b = field[o + 2];
    }
    r *= BAKE_GAIN; g *= BAKE_GAIN; b *= BAKE_GAIN;
    out[q] = r > 255 ? 255 : r < 0 ? 0 : r | 0;
    out[q + 1] = g > 255 ? 255 : g < 0 ? 0 : g | 0;
    out[q + 2] = b > 255 ? 255 : b < 0 ? 0 : b | 0;
    out[q + 3] = 255;
  }
}


export function computeGiSync({ boxes, sun, lights, focus, iterationsA = 4, iterationsB = 3 }) {
  const fit = fitGridToBoxes(boxes || [], focus || null);
  const grid = createGrid(fit.origin, fit.cell);
  voxelizeBoxes(grid, boxes || []);
  const surf = listSurfaceCells(grid);
  if (sun) injectSun(grid, surf, sun);
  const prepared = prepareLights(lights);
  if (prepared.length) injectLights(grid, surf, prepared);
  let a = grid.ea;
  let b = grid.eb;
  for (let i = 0; i < iterationsA; i++) {
    propagateStep(grid, a, b);
    const t = a; a = b; b = t;
  }
  bounceInject(grid, surf, a);
  for (let i = 0; i < iterationsB; i++) {
    propagateStep(grid, a, b);
    const t = a; a = b; b = t;
  }
  return { grid, surf, field: a };
}
