export const TONEMAP_IDS = Object.freeze({
  Legacy: 0,
  AgX: 1,
  ACES: 2,
  PBRNeutral: 3,
});


export const TONEMAP_NAMES = Object.freeze(["Legacy", "AgX", "ACES", "PBRNeutral"]);


export function resolveToneMapper(raw) {
  if (typeof raw === "string" && Object.prototype.hasOwnProperty.call(TONEMAP_IDS, raw)) {
    return TONEMAP_IDS[raw];
  }
  return 0;
}


const SRGB_TO_REC2020 = Object.freeze([
  0.6274, 0.0691, 0.0164,
  0.3293, 0.9195, 0.0880,
  0.0433, 0.0113, 0.8956,
]);
const REC2020_TO_SRGB = Object.freeze([
  1.6605, -0.1246, -0.0182,
  -0.5876, 1.1329, -0.1006,
  -0.0728, -0.0083, 1.1187,
]);
const AGX_INSET = Object.freeze([
  0.856627153315983, 0.137318972929847, 0.11189821299995,
  0.0951212405381588, 0.761241990602591, 0.0767994186031903,
  0.0482516061458583, 0.101439036467562, 0.811302368396859,
]);
const AGX_OUTSET = Object.freeze([
  1.1271005818144368, -0.1413297634984383, -0.14132976349843826,
  -0.11060664309660323, 1.157823702216272, -0.11060664309660294,
  -0.016493938717834573, -0.016493938717834257, 1.2519364065950405,
]);
const AGX_MIN_EV = -12.47393;
const AGX_MAX_EV = 4.026069;
const ACES_INPUT = Object.freeze([
  0.59719, 0.07600, 0.02840,
  0.35458, 0.90834, 0.13383,
  0.04823, 0.01566, 0.83777,
]);
const ACES_OUTPUT = Object.freeze([
  1.60475, -0.10208, -0.00327,
  -0.53108, 1.10813, -0.07276,
  -0.07367, -0.00605, 1.07602,
]);

function mul3(m, v) {
  return [
    m[0] * v[0] + m[3] * v[1] + m[6] * v[2],
    m[1] * v[0] + m[4] * v[1] + m[7] * v[2],
    m[2] * v[0] + m[5] * v[1] + m[8] * v[2],
  ];
}

function clamp01(x) {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}


function agxContrast(x) {
  const x2 = x * x;
  const x4 = x2 * x2;
  return 15.5 * x4 * x2 - 40.14 * x4 * x + 31.96 * x4
    - 6.868 * x2 * x + 0.4298 * x2 + 0.1191 * x - 0.00232;
}


export function tonemapAgxJs(rgb) {
  let c = mul3(SRGB_TO_REC2020, rgb);
  c = mul3(AGX_INSET, c);
  c = [Math.max(c[0], 1e-10), Math.max(c[1], 1e-10), Math.max(c[2], 1e-10)];
  c = [Math.log2(c[0]), Math.log2(c[1]), Math.log2(c[2])];
  c = c.map((v) => clamp01((v - AGX_MIN_EV) / (AGX_MAX_EV - AGX_MIN_EV)));
  c = c.map(agxContrast);
  c = mul3(AGX_OUTSET, c);
  c = c.map((v) => Math.pow(Math.max(v, 0), 2.2));
  c = mul3(REC2020_TO_SRGB, c);
  return c.map(clamp01);
}


function rrtOdtFit(v) {
  const a = v * (v + 0.0245786) - 0.000090537;
  const b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}


export function tonemapAcesJs(rgb) {
  let c = [rgb[0] * (1 / 0.6), rgb[1] * (1 / 0.6), rgb[2] * (1 / 0.6)];
  c = mul3(ACES_INPUT, c);
  c = c.map(rrtOdtFit);
  c = mul3(ACES_OUTPUT, c);
  return c.map(clamp01);
}


export function tonemapPbrNeutralJs(rgb) {
  let r = Math.max(rgb[0], 0);
  let g = Math.max(rgb[1], 0);
  let b = Math.max(rgb[2], 0);
  const startCompression = 0.8 - 0.04;
  const desaturation = 0.15;
  const x = Math.min(r, Math.min(g, b));
  const offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  r -= offset;
  g -= offset;
  b -= offset;
  const peak = Math.max(r, Math.max(g, b));
  if (peak < startCompression) return [r, g, b];
  const d = 1 - startCompression;
  const newPeak = 1 - (d * d) / (peak + d - startCompression);
  const scale = newPeak / peak;
  r *= scale;
  g *= scale;
  b *= scale;
  const f = 1 - 1 / (desaturation * (peak - newPeak) + 1);
  return [
    r + (newPeak - r) * f,
    g + (newPeak - g) * f,
    b + (newPeak - b) * f,
  ];
}


export function applyTonemapJs(rgb, id) {
  const fin = (x) => (Number.isFinite(x) ? x : 0);
  const c = [fin(Number(rgb && rgb[0])), fin(Number(rgb && rgb[1])), fin(Number(rgb && rgb[2]))];
  const mode = id | 0;
  if (mode === 1) return tonemapAgxJs([Math.max(c[0], 0), Math.max(c[1], 0), Math.max(c[2], 0)]);
  if (mode === 2) return tonemapAcesJs([Math.max(c[0], 0), Math.max(c[1], 0), Math.max(c[2], 0)]);
  if (mode === 3) return tonemapPbrNeutralJs(c);
  return c;
}


export function tonemapGlslChunk() {
  return `
                                                                          
                                                                     
                                                                   
                                                
vec3 rswTmAgxContrast(vec3 x) {
  vec3 x2 = x * x;
  vec3 x4 = x2 * x2;
  return + 15.5 * x4 * x2
    - 40.14 * x4 * x
    + 31.96 * x4
    - 6.868 * x2 * x
    + 0.4298 * x2
    + 0.1191 * x
    - 0.00232;
}
vec3 rswTmAgx(vec3 c) {
  mat3 rswToRec2020 = mat3(
    0.6274, 0.0691, 0.0164,
    0.3293, 0.9195, 0.0880,
    0.0433, 0.0113, 0.8956);
  mat3 rswToSrgb = mat3(
    1.6605, -0.1246, -0.0182,
    -0.5876, 1.1329, -0.1006,
    -0.0728, -0.0083, 1.1187);
  mat3 rswAgxInset = mat3(
    0.856627153315983, 0.137318972929847, 0.11189821299995,
    0.0951212405381588, 0.761241990602591, 0.0767994186031903,
    0.0482516061458583, 0.101439036467562, 0.811302368396859);
  mat3 rswAgxOutset = mat3(
    1.1271005818144368, -0.1413297634984383, -0.14132976349843826,
    -0.11060664309660323, 1.157823702216272, -0.11060664309660294,
    -0.016493938717834573, -0.016493938717834257, 1.2519364065950405);
  c = rswToRec2020 * c;
  c = rswAgxInset * c;
  c = max(c, vec3(1e-10));
  c = log2(c);
  c = (c - (-12.47393)) / (4.026069 - (-12.47393));
  c = clamp(c, 0.0, 1.0);
  c = rswTmAgxContrast(c);
  c = rswAgxOutset * c;
  c = pow(max(c, vec3(0.0)), vec3(2.2));
  c = rswToSrgb * c;
  return clamp(c, 0.0, 1.0);
}
vec3 rswTmRrtOdt(vec3 v) {
  vec3 a = v * (v + 0.0245786) - 0.000090537;
  vec3 b = v * (0.983729 * v + 0.4329510) + 0.238081;
  return a / b;
}
vec3 rswTmAces(vec3 c) {
  mat3 rswAcesIn = mat3(
    0.59719, 0.07600, 0.02840,
    0.35458, 0.90834, 0.13383,
    0.04823, 0.01566, 0.83777);
  mat3 rswAcesOut = mat3(
    1.60475, -0.10208, -0.00327,
    -0.53108, 1.10813, -0.07276,
    -0.07367, -0.00605, 1.07602);
  c = c * (1.0 / 0.6);
  c = rswAcesIn * c;
  c = rswTmRrtOdt(c);
  c = rswAcesOut * c;
  return clamp(c, 0.0, 1.0);
}
vec3 rswTmPbrNeutral(vec3 c) {
  c = max(c, vec3(0.0));
  float startCompression = 0.8 - 0.04;
  float desaturation = 0.15;
  float x = min(c.r, min(c.g, c.b));
  float offset = x < 0.08 ? x - 6.25 * x * x : 0.04;
  c -= offset;
  float peak = max(c.r, max(c.g, c.b));
  if (peak < startCompression) return c;
  float d = 1.0 - startCompression;
  float newPeak = 1.0 - d * d / (peak + d - startCompression);
  c *= newPeak / peak;
  float g = 1.0 - 1.0 / (desaturation * (peak - newPeak) + 1.0);
  return mix(c, vec3(newPeak), g);
}
vec3 rswApplyTonemap(vec3 c, int mode) {
  if (mode == 1) return rswTmAgx(c);
  if (mode == 2) return rswTmAces(c);
  if (mode == 3) return rswTmPbrNeutral(c);
  return c;
}
`;
}
