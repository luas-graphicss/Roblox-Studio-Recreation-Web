import { makeLightBasis, PAGE_SIZE_PX } from "./shadowPagesCore.js";

export const CLIPMAP_VERSION = "sun-clipmap-12a";

export const CLIPMAP_LIMITS = Object.freeze({
  minLevels: 4,
  maxLevels: 12,
  defaultLevels: 8,
  minLevel0Half: 4,
  maxLevel0Half: 64,
  defaultLevel0Half: 8,
  minVirtualRes: 1024,
  maxVirtualRes: 8192,
  defaultVirtualRes: 4096,
  minAtlas: 2048,
  maxAtlas: 8192,
  defaultAtlas: 4096,
  pageSize: PAGE_SIZE_PX,
  padTexels: 4,
  worldCap: 100000,
  maxTrackedDirty: 4096,
});

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function clampNum(v, lo, hi, d) {
  const n = num(v, d);
  return n < lo ? lo : n > hi ? hi : n;
}

export function sanitizeClipmapConfig(cfg) {
  const c = cfg && typeof cfg === "object" ? cfg : {};
  const L = CLIPMAP_LIMITS;
  const pageSize = L.pageSize;
  const levels = Math.round(clampNum(c.levels, L.minLevels, L.maxLevels, L.defaultLevels));
  const level0Half = clampNum(c.level0Half, L.minLevel0Half, L.maxLevel0Half, L.defaultLevel0Half);
  let virtualRes = Math.round(clampNum(c.virtualRes, L.minVirtualRes, L.maxVirtualRes, L.defaultVirtualRes));
  virtualRes = Math.max(pageSize, Math.round(virtualRes / pageSize) * pageSize);
  let atlasSize = Math.round(clampNum(c.atlasSize, L.minAtlas, L.maxAtlas, L.defaultAtlas));
  atlasSize = Math.max(pageSize, Math.round(atlasSize / pageSize) * pageSize);
  const gridPerLevel = Math.max(1, Math.round(virtualRes / pageSize));
  const atlasGrid = Math.max(1, Math.round(atlasSize / pageSize));
  return Object.freeze({
    levels,
    level0Half,
    virtualRes,
    atlasSize,
    pageSize,
    gridPerLevel,
    atlasGrid,
    atlasPages: atlasGrid * atlasGrid,
  });
}

function cfgOf(cfg) {
  return cfg && Number.isFinite(cfg.levels) && Number.isFinite(cfg.virtualRes) && Number.isFinite(cfg.pageSize)
    ? cfg
    : sanitizeClipmapConfig(cfg);
}


export function levelHalf(cfg, n) {
  const c = cfgOf(cfg);
  const lv = Math.round(clampNum(n, 0, c.levels - 1, 0));
  const h = c.level0Half * Math.pow(2, lv);
  return h > CLIPMAP_LIMITS.worldCap ? CLIPMAP_LIMITS.worldCap : h;
}


export function levelTexel(cfg, n) {
  const c = cfgOf(cfg);
  return (2 * levelHalf(c, n)) / c.virtualRes;
}


export function pageWorldSize(cfg, n) {
  const c = cfgOf(cfg);
  return levelTexel(c, n) * c.pageSize;
}



export function levelForDistance(cfg, dist) {
  const c = cfgOf(cfg);
  const d = num(dist, 0);
  for (let n = 0; n < c.levels; n++) {
    if (levelHalf(c, n) >= d) return n;
  }
  return c.levels - 1;
}


export function glslLevelFor(dist, half0, levels) {
  const h0 = Math.max(num(half0, CLIPMAP_LIMITS.defaultLevel0Half), 0.0001);
  const r = Math.max(num(dist, 0), 0) / h0;
  const lvl = Math.ceil(Math.max(Math.log2(Math.max(r, 1)), 0));
  return Math.min(Math.max(lvl, 0), Math.max(num(levels, 1) - 1, 0));
}


export function densityTable(cfg) {
  const c = cfgOf(cfg);
  const rows = [];
  for (let n = 0; n < c.levels; n++) {
    rows.push({ level: n, half: levelHalf(c, n), studPerTexel: levelTexel(c, n) });
  }
  return rows;
}

export function densityAtDistance(cfg, dist) {
  const c = cfgOf(cfg);
  return levelTexel(c, levelForDistance(c, dist));
}


export function basisFor(dirX, dirY, dirZ) {
  const raw = makeLightBasis(num(dirX, 0), num(dirY, 1), num(dirZ, 0));
  const hyb = (a, fx, fy, fz) => {
    const ok = a && Number.isFinite(Number(a[0])) && Number.isFinite(Number(a[1])) && Number.isFinite(Number(a[2]));
    const v = ok ? [Number(a[0]), Number(a[1]), Number(a[2])] : [fx, fy, fz];
    v.x = v[0]; v.y = v[1]; v.z = v[2];
    return v;
  };
  return {
    x: hyb(raw && raw.x, 1, 0, 0),
    y: hyb(raw && raw.y, 0, 1, 0),
    z: hyb(raw && raw.z, 0, 0, 1),
  };
}


export function worldToLightUv(x, y, z, basis) {
  const b = basis && basis.x && basis.y && basis.z ? basis : basisFor(0, 1, 0);
  const px = num(x, 0);
  const py = num(y, 0);
  const pz = num(z, 0);
  return {
    u: px * b.x.x + py * b.x.y + pz * b.x.z,
    v: px * b.y.x + py * b.y.y + pz * b.y.z,
    w: px * b.z.x + py * b.z.y + pz * b.z.z,
  };
}


export function pageColRow(u, v, cfg, n) {
  const pw = pageWorldSize(cfg, n);
  if (!(pw > 0)) return { col: 0, row: 0 };
  return { col: Math.floor(num(u, 0) / pw), row: Math.floor(num(v, 0) / pw) };
}

export function pageKey(level, col, row) {
  return (Math.round(num(level, 0))) + ":" + Math.round(num(col, 0)) + ":" + Math.round(num(row, 0));
}

export function pageKeyForWorld(x, y, z, basis, cfg, level) {
  const uv = worldToLightUv(x, y, z, basis);
  const cr = pageColRow(uv.u, uv.v, cfg, level);
  return pageKey(level, cr.col, cr.row);
}


export function levelWindow(cfg, n, camX, camY, camZ, basis) {
  const c = cfgOf(cfg);
  const lv = Math.round(clampNum(n, 0, c.levels - 1, 0));
  const pw = pageWorldSize(c, lv);
  const uv = worldToLightUv(camX, camY, camZ, basis);
  const cu = Math.round(uv.u / pw) * pw;
  const cv = Math.round(uv.v / pw) * pw;
  const hf = levelHalf(c, lv);
  const c0 = Math.floor((cu - hf) / pw);
  const r0 = Math.floor((cv - hf) / pw);
  return {
    level: lv,
    half: hf,
    texel: levelTexel(c, lv),
    pageWorld: pw,
    cu,
    cv,
    c0,
    r0,
    pages: c.gridPerLevel,
    signature: lv + "|" + c0 + "|" + r0 + "|" + hf,
  };
}


function aabbBounds(aabb) {
  if (!aabb || typeof aabb !== "object") return null;
  if (Number.isFinite(Number(aabb.minX))) {
    const b = {
      minX: num(aabb.minX, 0), minY: num(aabb.minY, 0), minZ: num(aabb.minZ, 0),
      maxX: num(aabb.maxX, 0), maxY: num(aabb.maxY, 0), maxZ: num(aabb.maxZ, 0),
    };
    return b;
  }
  const mn = aabb.min, mx = aabb.max;
  if (mn && mx) {
    const gx = (o, k, i) => (Array.isArray(o) ? num(o[i], NaN) : num(o[k], NaN));
    const b = {
      minX: gx(mn, "x", 0), minY: gx(mn, "y", 1), minZ: gx(mn, "z", 2),
      maxX: gx(mx, "x", 0), maxY: gx(mx, "y", 1), maxZ: gx(mx, "z", 2),
    };
    if ([b.minX, b.minY, b.minZ, b.maxX, b.maxY, b.maxZ].every(Number.isFinite)) return b;
  }
  return null;
}


export function aabbPageRange(aabb, basis, cfg, n, padTexels) {
  const b = aabbBounds(aabb);
  if (!b) return null;
  const c = cfgOf(cfg);
  const lv = Math.round(clampNum(n, 0, c.levels - 1, 0));
  const pad = clampNum(padTexels, 0, 64, CLIPMAP_LIMITS.padTexels) * levelTexel(c, lv);
  let minU = Infinity, minV = Infinity, maxU = -Infinity, maxV = -Infinity;
  for (let i = 0; i < 8; i++) {
    const x = i & 1 ? b.maxX : b.minX;
    const y = i & 2 ? b.maxY : b.minY;
    const z = i & 4 ? b.maxZ : b.minZ;
    const uv = worldToLightUv(x, y, z, basis);
    if (uv.u < minU) minU = uv.u;
    if (uv.u > maxU) maxU = uv.u;
    if (uv.v < minV) minV = uv.v;
    if (uv.v > maxV) maxV = uv.v;
  }
  if (!Number.isFinite(minU + minV + maxU + maxV)) return null;
  const pw = pageWorldSize(c, lv);
  if (!(pw > 0)) return null;
  return {
    level: lv,
    c0: Math.floor((minU - pad) / pw),
    r0: Math.floor((minV - pad) / pw),
    c1: Math.floor((maxU + pad) / pw),
    r1: Math.floor((maxV + pad) / pw),
  };
}


export function pagesTouchedByAabb(aabb, basis, cfg) {
  const c = cfgOf(cfg);
  const out = [];
  for (let n = 0; n < c.levels; n++) {
    const r = aabbPageRange(aabb, basis, c, n);
    if (!r) continue;
    out.push({
      level: n,
      c0: r.c0,
      r0: r.r0,
      c1: r.c1,
      r1: r.r1,
      count: (r.c1 - r.c0 + 1) * (r.r1 - r.r0 + 1),
    });
  }
  return out;
}


export function speculativeGroundPoints(cam, forward, cfg) {
  const c = cfgOf(cfg);
  const px = num(cam && cam.x, 0), py = num(cam && cam.y, 0), pz = num(cam && cam.z, 0);
  let fx = num(forward && forward.x, 0), fy = num(forward && forward.y, 0), fz = num(forward && forward.z, -1);
  let fl = Math.hypot(fx, fy, fz);
  if (!(fl > 1e-12)) { fx = 0; fy = 0; fz = -1; fl = 1; }
  fx /= fl; fy /= fl; fz /= fl;

  let sx = -fz, sy = 0, sz = fx;
  let sl = Math.hypot(sx, sy, sz);
  if (!(sl > 1e-12)) { sx = 1; sy = 0; sz = 0; sl = 1; }
  sx /= sl; sy /= sl; sz /= sl;
  const pts = [];
  const cap = CLIPMAP_LIMITS.worldCap;
  for (let n = 0; n < c.levels; n++) {
    const d = Math.min(levelHalf(c, n) * 0.75, cap);
    const bx = px + fx * d, by = py + fy * d, bz = pz + fz * d;
    const w = d * 0.5;
    pts.push({ x: bx, y: by, z: bz });
    pts.push({ x: bx + sx * w, y: by + sy * w, z: bz + sz * w });
    pts.push({ x: bx - sx * w, y: by - sy * w, z: bz - sz * w });
  }
  return pts;
}


export function pagesForPoints(points, cam, basis, cfg) {
  const c = cfgOf(cfg);
  const px = num(cam && cam.x, 0), py = num(cam && cam.y, 0), pz = num(cam && cam.z, 0);
  const keys = [];
  const seen = new Set();
  const perLevel = new Array(c.levels).fill(0);
  const list = Array.isArray(points) ? points : [];
  for (const p of list) {
    if (!p) continue;
    const x = num(p.x, NaN), y = num(p.y, NaN), z = num(p.z, NaN);
    if (!Number.isFinite(x + y + z)) continue;
    const dist = Math.hypot(x - px, y - py, z - pz);
    const n = levelForDistance(c, dist);
    const uv = worldToLightUv(x, y, z, basis);
    const cr = pageColRow(uv.u, uv.v, c, n);
    const cand = [
      [cr.col, cr.row],
      [cr.col + 1, cr.row],
      [cr.col - 1, cr.row],
      [cr.col, cr.row + 1],
      [cr.col, cr.row - 1],
    ];
    for (const [cc, rr] of cand) {
      const k = pageKey(n, cc, rr);
      if (seen.has(k)) continue;
      seen.add(k);
      keys.push(k);
      perLevel[n] += 1;
    }
  }
  return { keys, perLevel };
}


export function createClipmapAtlas(cfg) {
  const c = cfgOf(cfg);
  const free = [];
  for (let i = c.atlasPages - 1; i >= 0; i--) free.push(i);
  return { cap: c.atlasPages, map: new Map(), free, evictions: 0, reused: 0, allocs: 0 };
}


export function atlasAlloc(atlas, key) {
  if (!atlas || !atlas.map || !atlas.free) return { slot: -1, evicted: null, fresh: false };
  const k = String(key);
  if (atlas.map.has(k)) {
    const slot = atlas.map.get(k);
    atlas.map.delete(k);
    atlas.map.set(k, slot);
    atlas.reused++;
    return { slot, evicted: null, fresh: false };
  }
  let slot;
  let evicted = null;
  if (atlas.free.length > 0) {
    slot = atlas.free.pop();
  } else {
    const oldest = atlas.map.keys().next().value;
    if (oldest === undefined) return { slot: -1, evicted: null, fresh: false };
    slot = atlas.map.get(oldest);
    atlas.map.delete(oldest);
    evicted = oldest;
    atlas.evictions++;
  }
  atlas.map.set(k, slot);
  atlas.allocs++;
  return { slot, evicted, fresh: true };
}

export function atlasTouch(atlas, key) {
  if (!atlas || !atlas.map) return false;
  const k = String(key);
  if (!atlas.map.has(k)) return false;
  const slot = atlas.map.get(k);
  atlas.map.delete(k);
  atlas.map.set(k, slot);
  return true;
}

export function atlasStats(atlas) {
  if (!atlas || !atlas.map) return { capacity: 0, used: 0, free: 0, evictions: 0, reused: 0, allocs: 0 };
  return {
    capacity: atlas.cap,
    used: atlas.map.size,
    free: atlas.cap - atlas.map.size,
    evictions: atlas.evictions,
    reused: atlas.reused,
    allocs: atlas.allocs,
  };
}


export function scissorForSlot(cfg, slot) {
  const c = cfgOf(cfg);
  const s = Math.round(clampNum(slot, 0, c.atlasPages - 1, 0));
  return {
    x: (s % c.atlasGrid) * c.pageSize,
    y: Math.floor(s / c.atlasGrid) * c.pageSize,
    w: c.pageSize,
    h: c.pageSize,
  };
}


export function orthoBoundsForPage(cfg, n, col, row) {
  const c = cfgOf(cfg);
  const pw = pageWorldSize(c, n);
  const left = Math.round(num(col, 0)) * pw;
  const bottom = Math.round(num(row, 0)) * pw;
  return { left, right: left + pw, bottom, top: bottom + pw, pageWorld: pw };
}


export function rswClipCapKFor(cfg, n) {
  const c = cfgOf(cfg);
  const t0 = levelTexel(c, 0);
  const tn = levelTexel(c, n);
  const k = t0 > 0 ? tn / t0 : 1;
  return k < 1 ? 1 : k > 6 ? 6 : k;
}


export function resolveClipmapGate(args) {
  const a = args && typeof args === "object" ? args : {};
  if (a.safeMode === true) return { on: false, reason: "modo-seguro" };
  if (a.threeOk !== true) return { on: false, reason: "three-nao-pinado" };
  if (a.shadowsOn !== true) return { on: false, reason: "sombras-off" };
  if (String(a.tech || "") !== "Future") return { on: false, reason: "tech-nao-future" };
  if (a.weakGpu === true) return { on: false, reason: "gpu-fraca-segue-fase8" };
  const tier = String(a.tier || "");
  if (!(tier === "medium" || tier === "high" || tier === "ultra")) {
    return { on: false, reason: "tier-abaixo-de-medium" };
  }
  if (a.virtualShadows !== true) return { on: false, reason: "virtualshadows-off" };
  if (a.sunClipmap !== true) {
    return { on: false, reason: a.sunClipmap == null ? "auto-off-fatia-a" : "flag-off" };
  }
  return { on: true, reason: "ok" };
}


export const CLIPMAP_GLSL_UNIFORMS = [
  "uniform float uRswClipOn;",
  "uniform float uRswClipLevels;",
  "uniform float uRswClipHalf0;",
].join("\n");


export function buildClipmapGlsl() {
  return [
    "// Fase 12 (sun-clipmap-12a): seleção de nível do clipmap por distância.",
    "float rswClipLevelFor(float dist) {",
    "  float lvl = 0.0;",
    "  float h0 = max(uRswClipHalf0, 0.0001);",
    "  float r = max(dist, 0.0) / h0;",
    "  lvl = ceil(max(log2(max(r, 1.0)), 0.0));",
    "  return clamp(lvl, 0.0, max(uRswClipLevels - 1.0, 0.0));",
    "}",
  ].join("\n");
}
