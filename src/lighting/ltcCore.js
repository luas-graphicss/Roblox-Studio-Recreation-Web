export const AREA_LIGHT_BUDGETS = Object.freeze({ alto: 4, medio: 1, fraco: 0 });


export const LTC_TEX_UNITS = 2;


export const AREA_MIN_TEX_UNITS_ALTO = 16;


export const AREA_CLAMPS = Object.freeze({
  width: Object.freeze([0.05, 64]),
  height: Object.freeze([0.05, 64]),
  sourceRadius: Object.freeze([0, 8]),
  range: Object.freeze([0, 60]),
  brightness: Object.freeze([0, 40]),
});


export const RECT_LUMENS_PER_BRIGHTNESS = 4 * Math.PI * (0.9 * Math.max(1, 8 * 8 * 0.12));


export function clampAreaNumber(v, min, max, dflt) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return dflt;
  return n < min ? min : n > max ? max : n;
}


export function sanitizeRectSize(input) {
  const src = input && typeof input === "object" ? input : {};
  return {
    width: clampAreaNumber(src.width, AREA_CLAMPS.width[0], AREA_CLAMPS.width[1], 2),
    height: clampAreaNumber(src.height, AREA_CLAMPS.height[0], AREA_CLAMPS.height[1], 1),
  };
}


export function resolveAreaTier(input) {
  const src = input && typeof input === "object" ? input : {};
  if (src.weakGpu === true) return "fraco";
  const maxTex = Number.isFinite(src.maxTexUnits) && src.maxTexUnits > 0 ? src.maxTexUnits : AREA_MIN_TEX_UNITS_ALTO;
  return maxTex < AREA_MIN_TEX_UNITS_ALTO ? "medio" : "alto";
}


export function planAreaLights(input) {
  const src = input && typeof input === "object" ? input : {};
  const tier = resolveAreaTier(src);
  const budget = AREA_LIGHT_BUDGETS[tier];
  const ltcReady = src.ltcReady === true;
  let reason;
  if (tier === "fraco") reason = "GPU fraca: toda RectLight vira point comum (orçamento 0)";
  else if (!ltcReady) reason = "tabelas LTC ainda não prontas: RectLight nasce como point e sobe quando carregar";
  else if (tier === "medio") reason = "poucas texture units: 1 área light LTC (demais viram point)";
  else reason = "orçamento alto: até 4 área lights LTC";
  return { tier, budget, ltcReady, reason };
}


export function computeAreaExtraTexUnits(activeLtcCount) {
  const n = Number(activeLtcCount);
  return Number.isFinite(n) && n > 0 ? LTC_TEX_UNITS : 0;
}


export function rectLightNits(brightness, width, height) {
  const b = clampAreaNumber(brightness, AREA_CLAMPS.brightness[0], AREA_CLAMPS.brightness[1], 1);
  const s = sanitizeRectSize({ width, height });
  const area = Math.max(s.width * s.height, 1e-4);
  const nits = (b * RECT_LUMENS_PER_BRIGHTNESS) / (Math.PI * area);
  return Number.isFinite(nits) && nits > 0 ? Math.min(nits, 1e5) : 0;
}


export function areaPointFallbackIntensity(brightness, range) {
  const b = clampAreaNumber(brightness, AREA_CLAMPS.brightness[0], AREA_CLAMPS.brightness[1], 1);
  const r = clampAreaNumber(range, AREA_CLAMPS.range[0], AREA_CLAMPS.range[1], 8);
  return b * 0.9 * Math.max(1, r * r * 0.12);
}


export const FACE_FRAMES = Object.freeze({
  Front: Object.freeze({ normal: Object.freeze([0, 0, -1]), right: Object.freeze([-1, 0, 0]), up: Object.freeze([0, 1, 0]) }),
  Back: Object.freeze({ normal: Object.freeze([0, 0, 1]), right: Object.freeze([1, 0, 0]), up: Object.freeze([0, 1, 0]) }),
  Right: Object.freeze({ normal: Object.freeze([1, 0, 0]), right: Object.freeze([0, 0, -1]), up: Object.freeze([0, 1, 0]) }),
  Left: Object.freeze({ normal: Object.freeze([-1, 0, 0]), right: Object.freeze([0, 0, 1]), up: Object.freeze([0, 1, 0]) }),
  Top: Object.freeze({ normal: Object.freeze([0, 1, 0]), right: Object.freeze([1, 0, 0]), up: Object.freeze([0, 0, -1]) }),
  Bottom: Object.freeze({ normal: Object.freeze([0, -1, 0]), right: Object.freeze([1, 0, 0]), up: Object.freeze([0, 0, 1]) }),
});

export function faceFrame(faceName) {
  return FACE_FRAMES[faceName] || FACE_FRAMES.Front;
}


export function rectIrradianceNumeric(width, height, dist, nits, steps) {
  const s = sanitizeRectSize({ width, height });
  const d = Number.isFinite(dist) && dist > 0.01 ? dist : 1;
  const L = Number.isFinite(nits) && nits > 0 ? nits : 0;
  const n = Number.isFinite(steps) && steps >= 8 ? Math.min(Math.floor(steps), 256) : 64;
  const dx = s.width / n;
  const dy = s.height / n;
  const dA = dx * dy;
  let sum = 0;
  for (let i = 0; i < n; i++) {
    const x = -s.width / 2 + (i + 0.5) * dx;
    for (let j = 0; j < n; j++) {
      const y = -s.height / 2 + (j + 0.5) * dy;
      const r2 = x * x + y * y + d * d;
      sum += (L * (d * d)) / (r2 * r2) * dA;
    }
  }
  return sum;
}
