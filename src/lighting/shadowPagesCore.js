export const SHADOW_PAGES_VERSION = "vsm-lite-1";


export const PAGE_SIZE_PX = 128;


export const PAGE_LIMITS = Object.freeze({
  minMap: 64,
  maxMap: 8192,
  maxGrid: 64,                                                          
  maxBudget: 32,
  defaultBudget: 8,                                                        
  padTexels: 4,                                                            
  fullRatio: 0.6,                                                       
  worldCap: 100000,
});

function num(v, fb) {
  return typeof v === "number" && Number.isFinite(v) ? v : fb;
}

function clampNum(v, min, max, fb) {
  const n = num(v, fb);
  return n < min ? min : n > max ? max : n;
}


export function makeLightBasis(dirX, dirY, dirZ) {
  let zx = num(dirX, 0), zy = num(dirY, 1), zz = num(dirZ, 0);
  let len = Math.hypot(zx, zy, zz);
  if (!(len > 1e-12)) { zx = 0; zy = 0; zz = 1; len = 1; }
  zx /= len; zy /= len; zz /= len;

  let xx = zz, xy = 0, xz = -zx;
  let xl2 = xx * xx + xz * xz;
  if (xl2 < 1e-12) {
    zz += 0.0001;                                       
    len = Math.hypot(zx, zy, zz);
    zx /= len; zy /= len; zz /= len;
    xx = zz; xy = 0; xz = -zx;
    xl2 = xx * xx + xz * xz;
  }
  const xl = Math.sqrt(xl2);
  xx /= xl; xz /= xl;

  const yx = zy * xz - zz * xy;
  const yy = zz * xx - zx * xz;
  const yz = zx * xy - zy * xx;
  return { x: [xx, xy, xz], y: [yx, yy, yz], z: [zx, zy, zz] };
}


export function makeWindow(args) {
  const a = args || {};
  return {
    cx: clampNum(a.cx, -PAGE_LIMITS.worldCap, PAGE_LIMITS.worldCap, 0),
    cy: clampNum(a.cy, -PAGE_LIMITS.worldCap, PAGE_LIMITS.worldCap, 0),
    cz: clampNum(a.cz, -PAGE_LIMITS.worldCap, PAGE_LIMITS.worldCap, 0),
    half: clampNum(a.half, 1, PAGE_LIMITS.worldCap, 180),
    mapSize: Math.round(clampNum(a.mapSize, PAGE_LIMITS.minMap, PAGE_LIMITS.maxMap, 2048)),
    basis: makeLightBasis(a.dirX, a.dirY, a.dirZ),
  };
}


export function windowSignature(win) {
  if (!win || !win.basis) return "none";
  const q = (v, s) => Math.round(num(v, 0) * s);
  const z = win.basis.z;
  return [
    q(win.cx, 4), q(win.cy, 4), q(win.cz, 4), q(win.half, 4), win.mapSize | 0,
    q(z[0], 1000), q(z[1], 1000), q(z[2], 1000),
  ].join(",");
}


export function worldToUv(px, py, pz, win) {
  if (!win || !win.basis) return null;
  const dx = num(px, NaN) - win.cx;
  const dy = num(py, NaN) - win.cy;
  const dz = num(pz, NaN) - win.cz;
  if (!Number.isFinite(dx + dy + dz)) return null;
  const bx = win.basis.x, by = win.basis.y;
  const vx = dx * bx[0] + dy * bx[1] + dz * bx[2];
  const vy = dx * by[0] + dy * by[1] + dz * by[2];
  return { u: (vx / win.half) * 0.5 + 0.5, v: (vy / win.half) * 0.5 + 0.5 };
}


export function pageGridFor(mapSize, pageSize) {
  const ms = clampNum(mapSize, PAGE_LIMITS.minMap, PAGE_LIMITS.maxMap, 2048);
  const ps = clampNum(pageSize, 16, PAGE_LIMITS.maxMap, PAGE_SIZE_PX);
  return Math.max(1, Math.min(PAGE_LIMITS.maxGrid, Math.ceil(ms / ps)));
}


export function createPageTable(mapSize, pageSize) {
  const ms = Math.round(clampNum(mapSize, PAGE_LIMITS.minMap, PAGE_LIMITS.maxMap, 2048));
  const grid = pageGridFor(ms, pageSize);
  const table = {
    mapSize: ms,
    pageSize: ms / grid,                                                   
    grid,
    state: new Uint8Array(grid * grid),                        
    dirtyCount: 0,
  };
  invalidateAll(table);
  return table;
}

export function invalidateAll(table) {
  if (!table || !table.state) return;
  table.state.fill(1);
  table.dirtyCount = table.grid * table.grid;
}


export function aabbToPageRect(aabb, win, table, padTexels) {
  if (!aabb || !win || !win.basis || !table) return null;
  const mn = aabb.min, mx = aabb.max;
  if (!mn || !mx || mn.length !== 3 || mx.length !== 3) return null;
  for (let i = 0; i < 3; i++) {
    if (!Number.isFinite(mn[i]) || !Number.isFinite(mx[i]) || mn[i] > mx[i]) return null;
  }
  const bx = win.basis.x, by = win.basis.y;
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (let k = 0; k < 8; k++) {
    const px = (k & 1 ? mx : mn)[0] - win.cx;
    const py = (k & 2 ? mx : mn)[1] - win.cy;
    const pz = (k & 4 ? mx : mn)[2] - win.cz;
    const vx = px * bx[0] + py * bx[1] + pz * bx[2];
    const vy = px * by[0] + py * by[1] + pz * by[2];
    if (vx < minU) minU = vx;
    if (vx > maxU) maxU = vx;
    if (vy < minV) minV = vy;
    if (vy > maxV) maxV = vy;
  }
  const ms = table.mapSize;
  const pad = clampNum(padTexels, 0, ms, PAGE_LIMITS.padTexels);
  const toPx = (v) => ((v / win.half) * 0.5 + 0.5) * ms;
  const x0 = toPx(minU) - pad, x1 = toPx(maxU) + pad;
  const y0 = toPx(minV) - pad, y1 = toPx(maxV) + pad;
  if (!Number.isFinite(x0 + x1 + y0 + y1)) return null;
  if (x1 < 0 || y1 < 0 || x0 > ms || y0 > ms) return null;                  
  const ps = table.pageSize, last = table.grid - 1;
  const idx = (v) => Math.max(0, Math.min(last, Math.floor(v / ps)));
  return { c0: idx(x0), r0: idx(y0), c1: idx(x1), r1: idx(y1) };
}


export function aabbInsideWindow(aabb, win, table, padTexels) {
  if (!aabb || !win || !win.basis || !table) return false;
  const mn = aabb.min, mx = aabb.max;
  if (!mn || !mx || mn.length !== 3 || mx.length !== 3) return false;
  for (let i = 0; i < 3; i++) {
    if (!Number.isFinite(mn[i]) || !Number.isFinite(mx[i]) || mn[i] > mx[i]) return false;
  }
  const bx = win.basis.x, by = win.basis.y;
  let minU = Infinity, maxU = -Infinity, minV = Infinity, maxV = -Infinity;
  for (let k = 0; k < 8; k++) {
    const px = (k & 1 ? mx : mn)[0] - win.cx;
    const py = (k & 2 ? mx : mn)[1] - win.cy;
    const pz = (k & 4 ? mx : mn)[2] - win.cz;
    const vx = px * bx[0] + py * bx[1] + pz * bx[2];
    const vy = px * by[0] + py * by[1] + pz * by[2];
    if (vx < minU) minU = vx;
    if (vx > maxU) maxU = vx;
    if (vy < minV) minV = vy;
    if (vy > maxV) maxV = vy;
  }
  const ms = table.mapSize;
  const pad = clampNum(padTexels, 0, ms, PAGE_LIMITS.padTexels);
  const toPx = (v) => ((v / win.half) * 0.5 + 0.5) * ms;
  const x0 = toPx(minU) - pad, x1 = toPx(maxU) + pad;
  const y0 = toPx(minV) - pad, y1 = toPx(maxV) + pad;
  if (!Number.isFinite(x0 + x1 + y0 + y1)) return false;
  return x0 >= 0 && y0 >= 0 && x1 <= ms && y1 <= ms;
}


export function invalidateRect(table, rect) {
  if (!table || !table.state || !rect) return 0;
  const g = table.grid;
  const c0 = Math.max(0, Math.min(g - 1, rect.c0 | 0));
  const c1 = Math.max(c0, Math.min(g - 1, rect.c1 | 0));
  const r0 = Math.max(0, Math.min(g - 1, rect.r0 | 0));
  const r1 = Math.max(r0, Math.min(g - 1, rect.r1 | 0));
  let marked = 0;
  for (let r = r0; r <= r1; r++) {
    for (let c = c0; c <= c1; c++) {
      const i = r * g + c;
      if (table.state[i] === 0) {
        table.state[i] = 1;
        table.dirtyCount++;
        marked++;
      }
    }
  }
  return marked;
}


export function planPages(table, maxPages, focusU, focusV) {
  const out = [];
  if (!table || !table.state || table.dirtyCount <= 0) return { pages: out, remaining: table ? table.dirtyCount : 0 };
  const g = table.grid;
  const budget = Math.round(clampNum(maxPages, 1, PAGE_LIMITS.maxBudget, PAGE_LIMITS.defaultBudget));
  const fu = clampNum(focusU, -4, 4, 0.5);
  const fv = clampNum(focusV, -4, 4, 0.5);
  const cand = [];
  for (let r = 0; r < g; r++) {
    for (let c = 0; c < g; c++) {
      if (table.state[r * g + c] !== 1) continue;
      const du = (c + 0.5) / g - fu;
      const dv = (r + 0.5) / g - fv;
      cand.push({ col: c, row: r, d2: du * du + dv * dv });
    }
  }
  cand.sort((a, b) => a.d2 - b.d2 || a.row - b.row || a.col - b.col);
  const n = Math.min(budget, cand.length);
  for (let i = 0; i < n; i++) {
    const pg = cand[i];
    table.state[pg.row * g + pg.col] = 0;
    table.dirtyCount--;
    out.push({ col: pg.col, row: pg.row });
  }
  return { pages: out, remaining: table.dirtyCount };
}


export function mergePagesToRects(pages, table) {
  const out = [];
  if (!Array.isArray(pages) || pages.length === 0 || !table) return out;
  const ps = table.pageSize, ms = table.mapSize;
  const sorted = pages.slice().sort((a, b) => (a.row - b.row) || (a.col - b.col));
  const strips = [];
  for (const pg of sorted) {
    const last = strips[strips.length - 1];
    if (last && last.row === pg.row && pg.col === last.c1 + 1) last.c1 = pg.col;
    else strips.push({ row: pg.row, c0: pg.col, c1: pg.col });
  }
  const rects = [];
  for (const s of strips) {
    const prev = rects.find((r) => r.c0 === s.c0 && r.c1 === s.c1 && r.r1 + 1 === s.row);
    if (prev) prev.r1 = s.row;
    else rects.push({ c0: s.c0, c1: s.c1, r0: s.row, r1: s.row });
  }
  for (const r of rects) {
    const x = Math.round(r.c0 * ps);
    const y = Math.round(r.r0 * ps);
    const w = Math.min(ms - x, Math.round((r.c1 - r.c0 + 1) * ps));
    const h = Math.min(ms - y, Math.round((r.r1 - r.r0 + 1) * ps));
    if (w > 0 && h > 0) out.push({ x, y, w, h });
  }
  return out;
}


export function scissorToOrtho(rect, table, half) {
  if (!rect || !table) return null;
  const ms = table.mapSize;
  const h = clampNum(half, 1, PAGE_LIMITS.worldCap, 180);
  const cv = (px) => ((px / ms) * 2 - 1) * h;
  const left = cv(rect.x);
  const right = cv(rect.x + rect.w);
  const bottom = cv(rect.y);
  const top = cv(rect.y + rect.h);
  if (!Number.isFinite(left + right + bottom + top) || right <= left || top <= bottom) return null;
  return { left, right, bottom, top };
}


export function partAabb(position, size) {
  if (!position || !size || typeof position !== "object" || typeof size !== "object") return null;
  const px = num(position.x, NaN), py = num(position.y, NaN), pz = num(position.z, NaN);
  const sx = num(size.x, NaN), sy = num(size.y, NaN), sz = num(size.z, NaN);
  if (!Number.isFinite(px + py + pz) || !Number.isFinite(sx + sy + sz)) return null;
  if (Math.abs(px) + Math.abs(py) + Math.abs(pz) > PAGE_LIMITS.worldCap) return null;
  const r = Math.max(0.05, 0.5 * Math.hypot(
    Math.min(Math.abs(sx), 4096),
    Math.min(Math.abs(sy), 4096),
    Math.min(Math.abs(sz), 4096),
  ));
  return { min: [px - r, py - r, pz - r], max: [px + r, py + r, pz + r] };
}

export function unionAabb(a, b) {
  if (!a) return b || null;
  if (!b) return a;
  return {
    min: [
      Math.min(a.min[0], b.min[0]),
      Math.min(a.min[1], b.min[1]),
      Math.min(a.min[2], b.min[2]),
    ],
    max: [
      Math.max(a.max[0], b.max[0]),
      Math.max(a.max[1], b.max[1]),
      Math.max(a.max[2], b.max[2]),
    ],
  };
}


export function sphereIntersectsAabb(cx, cy, cz, radius, aabb) {
  if (!aabb || !aabb.min || !aabb.max) return true;
  if (!Number.isFinite(cx + cy + cz)) return true;
  const r = clampNum(radius, 0, PAGE_LIMITS.worldCap, 8);
  let d2 = 0;
  for (let i = 0; i < 3; i++) {
    const v = i === 0 ? cx : i === 1 ? cy : cz;
    const lo = aabb.min[i], hi = aabb.max[i];
    const c = v < lo ? lo : v > hi ? hi : v;
    d2 += (v - c) * (v - c);
  }
  return d2 <= r * r;
}
