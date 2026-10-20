export const ATLAS_TILE = 64;
export const ATLAS_COLS = 8;
export const ATLAS_ROWS = 4;
export const ATLAS_SLOTS = ATLAS_COLS * ATLAS_ROWS;

export function atlasLayout() {
  return {
    tile: ATLAS_TILE,
    cols: ATLAS_COLS,
    rows: ATLAS_ROWS,
    slots: ATLAS_SLOTS,
    width: ATLAS_COLS * ATLAS_TILE,
    height: ATLAS_ROWS * ATLAS_TILE,
  };
}

export function makeLcg(seed) {
  let s = (Math.floor(seed) >>> 0) || 1;
  return function next() {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}


export function makeTileableNoise(seed, period) {
  const p = Math.max(2, Math.floor(period) || 8);
  const rnd = makeLcg(seed);
  const g = new Float32Array(p * p);
  for (let i = 0; i < g.length; i++) g[i] = rnd();
  const at = (x, y) => g[(((x % p) + p) % p) + (((y % p) + p) % p) * p];
  return {
    period: p,
    sample(x, y) {
      const x0 = Math.floor(x);
      const y0 = Math.floor(y);
      let fx = x - x0;
      let fy = y - y0;
      fx = fx * fx * (3 - 2 * fx);
      fy = fy * fy * (3 - 2 * fy);
      const a = at(x0, y0);
      const b = at(x0 + 1, y0);
      const c = at(x0, y0 + 1);
      const d = at(x0 + 1, y0 + 1);
      return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
    },
  };
}

const clamp01 = (v) => (v < 0 ? 0 : v > 1 ? 1 : v);


const RECIPES = {
  Grass: { contrast: 0.3, streaks: 0.5, patches: 0.35 },
  Sand: { contrast: 0.14, speckle: 0.45, waves: 0.18 },
  Rock: { contrast: 0.34, cracks: 0.45 },
  Water: { contrast: 0.1, waves: 0.35 },
  Sandstone: { contrast: 0.2, strata: 0.4, speckle: 0.15 },
  Slate: { contrast: 0.26, strata: 0.5, cracks: 0.25 },
  Concrete: { contrast: 0.12, speckle: 0.4 },
  Brick: { contrast: 0.2, bricks: true },
  Cobblestone: { contrast: 0.24, cells: true },
  Basalt: { contrast: 0.3, cracks: 0.55 },
  CrackedLava: { contrast: 0.28, cracks: 0.5, lava: [1.0, 0.42, 0.1] },
  Limestone: { contrast: 0.16, speckle: 0.25, waves: 0.12 },
  Pavement: { contrast: 0.16, speckle: 0.3, cells: true },
  Glacier: { contrast: 0.18, waves: 0.25, sparkle: 0.35 },
  Snow: { contrast: 0.1, speckle: 0.15, sparkle: 0.5 },
  Ground: { contrast: 0.26, patches: 0.45, speckle: 0.25 },
  Mud: { contrast: 0.3, patches: 0.5, waves: 0.1 },
  Asphalt: { contrast: 0.12, speckle: 0.5 },
  Salt: { contrast: 0.1, speckle: 0.2, sparkle: 0.3 },


  LeafyGrass: { contrast: 0.32, patches: 0.5, streaks: 0.3 },
  Ice: { contrast: 0.14, waves: 0.22, sparkle: 0.45, cracks: 0.18 },
  WoodPlanks: { contrast: 0.22, strata: 0.45, streaks: 0.35 },
};
const GENERIC = { contrast: 0.18, speckle: 0.2 };


export function buildTilePixels(slot, name, baseRgb) {
  const t = ATLAS_TILE;
  const r = RECIPES[name] || GENERIC;
  const seed = 90001 + (Math.max(0, Math.floor(slot)) % ATLAS_SLOTS) * 7919;
  const nBase = [
    makeTileableNoise(seed + 1, 8),
    makeTileableNoise(seed + 2, 16),
    makeTileableNoise(seed + 3, 32),
  ];
  const nDetail = makeTileableNoise(seed + 4, 32);
  const nCrack = makeTileableNoise(seed + 5, 12);
  const nStreak = makeTileableNoise(seed + 6, 6);
  const sparkleRnd = makeLcg(seed + 7);
  const sparkleMap = new Float32Array(t * t);
  for (let i = 0; i < sparkleMap.length; i++) sparkleMap[i] = sparkleRnd();
  const cellRnd = makeLcg(seed + 8);
  const cellShade = new Float32Array(64);
  for (let i = 0; i < cellShade.length; i++) cellShade[i] = cellRnd();
  const base = Array.isArray(baseRgb) && baseRgb.length >= 3 ? baseRgb : [0.55, 0.55, 0.55];
  const out = new Uint8Array(t * t * 4);
  for (let y = 0; y < t; y++) {
    for (let x = 0; x < t; x++) {
      const u = x / t;
      const v = y / t;
      let fbm = 0;
      let amp = 0.55;
      for (let o = 0; o < 3; o++) {
        fbm += nBase[o].sample(u * nBase[o].period, v * nBase[o].period) * amp;
        amp *= 0.5;
      }
      fbm /= 0.9625;
      let shade = 1 + (fbm - 0.5) * 2 * (r.contrast || 0.18);
      let cr = base[0], cg = base[1], cb = base[2];
      if (r.speckle) {
        const sp = nDetail.sample(u * 32, v * 32);
        shade *= 1 + (sp - 0.5) * r.speckle;
      }
      if (r.streaks) {
        const st = nStreak.sample(u * 24, v * 6);
        shade *= 1 + (st - 0.5) * r.streaks;
      }
      if (r.patches) {
        const pt = nBase[1].sample(u * 16 + 5, v * 16 + 9);
        shade *= 1 + (pt - 0.5) * r.patches;
      }
      if (r.waves || r.strata) {
        const k = r.strata ? 6 : 4;
        const band = Math.sin((v * k + (fbm - 0.5) * 1.6) * Math.PI * 2) * 0.5 + 0.5;
        shade *= 1 + (band - 0.5) * (r.waves || r.strata);
      }
      if (r.cracks) {
        const d = Math.abs(nCrack.sample(u * 12, v * 12) - 0.5);
        if (d < 0.035) {
          const q = 1 - d / 0.035;
          if (r.lava) {
            const heat = q * q;
            cr = cr * (1 - heat) + r.lava[0] * heat;
            cg = cg * (1 - heat) + r.lava[1] * heat;
            cb = cb * (1 - heat) + r.lava[2] * heat;
            shade = 1 + heat * 0.9;
          } else {
            shade *= 1 - q * r.cracks;
          }
        }
      }
      if (r.bricks) {
        const rows = 8, colsB = 4;
        const row = Math.floor(v * rows) % rows;
        const bu = (u * colsB + (row % 2) * 0.5) % colsB;
        const col = Math.floor(bu);
        const fu = bu - col;
        const fv = v * rows - Math.floor(v * rows);
        if (fu < 0.06 || fv < 0.12) {
          cr = cg = cb = 0.62;
          shade *= 0.8;
        } else {
          shade *= 0.88 + cellShade[(row * colsB + col) % 64] * 0.28;
        }
      }
      if (r.cells) {
        const cells = 6;
        const gu = u * cells, gv = v * cells;
        const fu = gu - Math.floor(gu), fv = gv - Math.floor(gv);
        const j = nDetail.sample(u * 32, v * 32) * 0.12;
        const edge = Math.min(Math.min(fu, 1 - fu), Math.min(fv, 1 - fv)) + j;
        if (edge < 0.16) shade *= 0.68 + edge * 1.6;
        else shade *= 0.9 + cellShade[(Math.floor(gu) + Math.floor(gv) * cells) % 64] * 0.2;
      }
      if (r.sparkle) {
        const sv = sparkleMap[x + y * t];
        if (sv > 0.985) shade += (r.sparkle * (sv - 0.985)) / 0.015;
      }
      const idx = (x + y * t) * 4;
      out[idx] = Math.round(clamp01(cr * shade) * 255);
      out[idx + 1] = Math.round(clamp01(cg * shade) * 255);
      out[idx + 2] = Math.round(clamp01(cb * shade) * 255);
      out[idx + 3] = 255;
    }
  }
  return out;
}


export function buildAtlasPixels({ count, nameOf, colorOf }) {
  const layout = atlasLayout();
  const n = Math.max(0, Math.min(Math.floor(count) || 0, layout.slots));
  const data = new Uint8Array(layout.width * layout.height * 4);
  for (let slot = 0; slot < layout.slots; slot++) {
    const inRange = slot < n;
    const name = inRange && typeof nameOf === "function" ? nameOf(slot) : "";
    const base = inRange && typeof colorOf === "function" ? colorOf(slot) : [0.55, 0.55, 0.55];
    const tilePx = buildTilePixels(slot, name, base);
    const ox = (slot % layout.cols) * layout.tile;
    const oy = Math.floor(slot / layout.cols) * layout.tile;
    for (let y = 0; y < layout.tile; y++) {
      const src = y * layout.tile * 4;
      data.set(tilePx.subarray(src, src + layout.tile * 4), ((oy + y) * layout.width + ox) * 4);
    }
  }
  return { data, layout };
}
