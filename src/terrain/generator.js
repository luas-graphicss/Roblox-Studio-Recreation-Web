import { TerrainData } from "./terrainData.js";
import { materialIndexByName, WATER_MATERIAL } from "./materials.js";
import { clampNumber } from "../utils/validate.js";

export const BIOME_NAMES = Object.freeze([
  "Plains", "Hills", "Mountains", "Canyons", "Dunes", "Lavascape", "Arctic", "Water",
]);

const BIOMES = Object.freeze({
  Plains:    { amp: 0.18, base: 0.18, top: "Grass", mid: "Ground", low: "Rock", water: true },
  Hills:     { amp: 0.45, base: 0.22, top: "Grass", mid: "Ground", low: "Rock", water: true },
  Mountains: { amp: 1.0,  base: 0.30, top: "Snow",  mid: "Rock",   low: "Slate", water: false, snowCap: 0.7 },
  Canyons:   { amp: 0.8,  base: 0.20, top: "Sandstone", mid: "Sandstone", low: "Rock", water: false, terrace: true },
  Dunes:     { amp: 0.32, base: 0.20, top: "Sand",  mid: "Sand",   low: "Sandstone", water: false },
  Lavascape: { amp: 0.6,  base: 0.24, top: "Basalt", mid: "Basalt", low: "CrackedLava", water: false, lava: true },
  Arctic:    { amp: 0.45, base: 0.30, top: "Snow",  mid: "Glacier", low: "Rock", water: true, frozen: true },
  Water:     { amp: 0.12, base: 0.10, top: "Sand",  mid: "Sand",   low: "Rock", water: true, highWater: true },
});

function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeNoise2D(seed) {
  const rng = mulberry32(seed >>> 0);
  const p = new Uint8Array(256);
  for (let i = 0; i < 256; i++) p[i] = i;
  for (let i = 255; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); const t = p[i]; p[i] = p[j]; p[j] = t; }
  const perm = new Uint8Array(512);
  for (let i = 0; i < 512; i++) perm[i] = p[i & 255];
  const lattice = (ix, iz) => perm[(ix + perm[iz & 255]) & 255] / 255;        
  const smooth = (t) => t * t * (3 - 2 * t);
  return function (x, z) {
    const x0 = Math.floor(x), z0 = Math.floor(z);
    const xf = x - x0, zf = z - z0;
    const v00 = lattice(x0, z0), v10 = lattice(x0 + 1, z0);
    const v01 = lattice(x0, z0 + 1), v11 = lattice(x0 + 1, z0 + 1);
    const u = smooth(xf), w = smooth(zf);
    const a = v00 + (v10 - v00) * u, b = v01 + (v11 - v01) * u;
    return a + (b - a) * w;
  };
}

function fbm(noise, x, z, octaves) {
  let sum = 0, amp = 0.5, freq = 1, norm = 0;
  for (let o = 0; o < octaves; o++) { sum += amp * noise(x * freq, z * freq); norm += amp; amp *= 0.5; freq *= 2; }
  return norm ? sum / norm : 0;
}

export function normalizeParams(params) {
  const p = params || {};
  const biome = BIOME_NAMES.indexOf(p.biome) !== -1 ? p.biome : "Hills";
  return {
    seed: (Number.isFinite(p.seed) ? p.seed : 42) | 0,
    biome,
    biomeSize: clampNumber(p.biomeSize, 0, 1, 0.5),
    caveFrequency: clampNumber(p.caveFrequency, 0, 1, 0.2),
    terrainHeight: clampNumber(p.terrainHeight, 0, 1, 0.5),
    waterLevel: clampNumber(p.waterLevel, 0, 1, 0.35),
  };
}

export function randomSeed() {
  return (Math.random() * 0x7fffffff) | 0;
}


export function generateInto(target, params, callbacks) {
  const cb = callbacks || {};
  const p = normalizeParams(params);
  const preset = BIOMES[p.biome] || BIOMES.Hills;


  const N = Math.max(32, Math.min(96, Math.round(48 + p.biomeSize * 48)));
  const half = Math.floor(N / 2);
  const maxH = Math.max(6, Math.min(56, Math.round(8 + p.terrainHeight * 44)));
  const waterLevel = Math.round(maxH * p.waterLevel) + (preset.highWater ? Math.round(maxH * 0.25) : 0);

  const freq = 0.015 + (1 - p.biomeSize) * 0.06;

  const heightNoise = makeNoise2D(p.seed);
  const matNoise = makeNoise2D(p.seed + 19);
  const caveNoise = makeNoise2D(p.seed + 777);

  const warpNoiseX = makeNoise2D(p.seed + 51);
  const warpNoiseZ = makeNoise2D(p.seed + 87);
  const detailNoise = makeNoise2D(p.seed + 131);

  const topIdx = materialIndexByName(preset.top);
  const midIdx = materialIndexByName(preset.mid);
  const lowIdx = materialIndexByName(preset.low);
  const iceIdx = materialIndexByName("Ice");                                 

  function columnHeight(x, z) {


    const wx = (fbm(warpNoiseX, x * freq * 0.6, z * freq * 0.6, 2) - 0.5) * 24;
    const wz = (fbm(warpNoiseZ, x * freq * 0.6 + 7.3, z * freq * 0.6 - 3.1, 2) - 0.5) * 24;
    let n = fbm(heightNoise, (x + wx) * freq, (z + wz) * freq, 6);
    n = n * 0.85 + fbm(detailNoise, x * freq * 4.0, z * freq * 4.0, 3) * 0.15;
    if (preset.terrace) n = Math.round(n * 5) / 5;                         
    const h = preset.base * maxH + n * preset.amp * maxH;
    return Math.max(1, Math.min(maxH, h));
  }

  function matFor(x, y, z, h) {
    const surface = y === h;
    if (surface) {

      if (preset.water && h <= waterLevel + 1) return materialIndexByName("Sand");


      if (preset.snowCap) return y >= maxH * preset.snowCap ? topIdx : midIdx;

      if (preset.lava && matNoise(x * 0.2, z * 0.2) > 0.6) return materialIndexByName("CrackedLava");

      return topIdx;
    }
    if (y >= h - 2) return midIdx;
    if (y < 3) return lowIdx;
    return midIdx;
  }

  function fillRow(z) {
    for (let x = -half; x < half; x++) {
      const h = columnHeight(x, z);                                        
      const hTop = Math.max(1, Math.floor(h));
      const frac = h - Math.floor(h);
      for (let y = 0; y <= hTop; y++) {
        let carve = false;
        if (p.caveFrequency > 0 && y > 0 && y < hTop) {
          const c = fbm(caveNoise, x * 0.18 + y * 0.12, z * 0.18 - y * 0.1, 3);
          if (Math.abs(c - 0.5) < p.caveFrequency * 0.18) carve = true;
        }
        if (!carve) target.set(x, y, z, matFor(x, y, z, hTop), 1);
      }


      const _submerged = preset.water && (hTop + 1) <= waterLevel;
      if (frac > 0.02 && hTop < maxH && !_submerged) {
        target.set(x, hTop + 1, z, matFor(x, hTop + 1, z, hTop + 1), frac);
      }
      if (preset.water && h < waterLevel) {
        for (let y = hTop + 1; y <= waterLevel; y++) {
          if (target.getOcc(x, y, z) <= 0) {


            const frozenTop = preset.frozen && y === waterLevel;
            target.set(x, y, z, frozenTop ? iceIdx : WATER_MATERIAL, 1);
          }
        }
      }
    }
  }

  let z = -half;
  let cancelled = false;
  const ROWS_PER_TICK = 3;
  function step() {
    if (cancelled) return;
    let rows = 0;
    while (z < half && rows < ROWS_PER_TICK) { fillRow(z); z++; rows++; }
    if (typeof cb.onProgress === "function") cb.onProgress(Math.min(1, (z + half) / N));
    if (z < half) { setTimeout(step, 0); }
    else if (typeof cb.onComplete === "function") cb.onComplete(target);
  }
  setTimeout(step, 0);
  return { cancel() { cancelled = true; } };
}


export function generateNew(params, callbacks) {
  const target = new TerrainData();
  return generateInto(target, params, callbacks);
}
