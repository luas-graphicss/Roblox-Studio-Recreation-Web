import { sampleSkyRGB } from "./skyPhysicalCore.js";


export const SM_LITE_MAT_KIND = "phong";


export const SM_LITE_AO_RES_DIV = 4;
export const SM_LITE_AO_TEMPORAL = false;


export const SM_LITE_SPEC_INTENSITY = 0.6;
export const SM_LITE_VIGNETTE = 0.16;
export const SM_LITE_GRADE_TINT = Object.freeze([1.02, 1.0, 0.975]);
export const SM_LITE_GRADE_PUNCH = 1.03;


export function sanitizeSmLiteSpecIntensity(raw) {
  let n;
  if (typeof raw === "number") n = raw;
  else if (typeof raw === "string" && raw.trim() !== "") n = Number(raw);
  else return SM_LITE_SPEC_INTENSITY;
  if (!Number.isFinite(n)) return SM_LITE_SPEC_INTENSITY;
  return Math.min(1, Math.max(0, n));
}


export function smRealisticLitePlan(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const weak = src.weakGpu === true;
  const sm = src.tech === "ShadowMap";
  const realistic = src.renderStyle === "Realistic";
  const forced = src.forced === true ? true : src.forced === false ? false : null;
  const eligible = sm && realistic;
  const on = eligible && (forced === true ? true : forced === false ? false : weak);
  let reason;
  if (!sm) reason = "tech!=ShadowMap (o pacote é exclusivo do ShadowMap)";
  else if (!realistic) reason = "RenderStyle!=Realistic (Classic byte a byte)";
  else if (forced === true) reason = "forçado ON (QA __rswSmRealista)";
  else if (forced === false) reason = "forçado OFF (QA __rswSmRealista)";
  else if (weak) reason = "AUTO: perfil fraco + ShadowMap + Realistic";
  else reason = "AUTO: GPU forte segue byte a byte (realismo pleno = Future)";
  return Object.freeze({
    on,


    matKind: on ? SM_LITE_MAT_KIND : null,


    aoLite: on
      ? Object.freeze({ resDiv: SM_LITE_AO_RES_DIV, temporal: SM_LITE_AO_TEMPORAL })
      : null,


    specOcc: on,
    auto: forced === null,
    flag: forced,
    reason,


    specIntensity: on ? sanitizeSmLiteSpecIntensity(src.specKnob) : 1,
    vignette: on ? SM_LITE_VIGNETTE : 0,
    gradeTint: on ? SM_LITE_GRADE_TINT : null,
    gradePunch: on ? SM_LITE_GRADE_PUNCH : 1,
    flareLite: on === true,
  });
}


const LUMA_R = 0.2126;
const LUMA_G = 0.7152;
const LUMA_B = 0.0722;


const SM_LITE_AMB_CHROMA_MAX = 3;


export const SM_LITE_AMB_TINT_STRENGTH = 0.85;

function lumaOf(rgb) {
  return LUMA_R * rgb[0] + LUMA_G * rgb[1] + LUMA_B * rgb[2];
}


function chromaOf(rgb) {
  const l = lumaOf(rgb);
  if (!Number.isFinite(l) || l < 1e-4) return [1, 1, 1];
  const cap = SM_LITE_AMB_CHROMA_MAX;
  const c0 = rgb[0] / l;
  const c1 = rgb[1] / l;
  const c2 = rgb[2] / l;
  return [
    c0 > cap ? cap : c0 < 0 ? 0 : c0,
    c1 > cap ? cap : c1 < 0 ? 0 : c1,
    c2 > cap ? cap : c2 < 0 ? 0 : c2,
  ];
}


export const SM_LITE_NIGHT_SKY_CHROMA = Object.freeze(chromaOf([0.62, 0.75, 1.18]));

export const SM_LITE_NIGHT_GROUND_CHROMA = Object.freeze(chromaOf([0.72, 0.82, 1.05]));


const SM_LITE_AMB_SAMPLE_DIRS = Object.freeze([
  Object.freeze({ x: 0, y: 1, z: 0 }),
  Object.freeze({ x: 0.8660254037844387, y: 0.5, z: 0 }),
  Object.freeze({ x: -0.8660254037844387, y: 0.5, z: 0 }),
  Object.freeze({ x: 0, y: 0.5, z: 0.8660254037844387 }),
  Object.freeze({ x: 0, y: 0.5, z: -0.8660254037844387 }),
]);


export function sanitizeSmLiteAmbStrength(raw) {
  let n;
  if (typeof raw === "number") n = raw;
  else if (typeof raw === "string" && raw.trim() !== "") n = Number(raw);
  else return SM_LITE_AMB_TINT_STRENGTH;
  if (!Number.isFinite(n)) return SM_LITE_AMB_TINT_STRENGTH;
  return Math.min(1, Math.max(0, n));
}

function sanitizeRgb01(raw) {
  const out = [0, 0, 0];
  if (Array.isArray(raw)) {
    for (let i = 0; i < 3; i++) {
      const n = Number(raw[i]);
      out[i] = Number.isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
    }
  }
  return out;
}

function mix3(a, b, t) {
  return [
    a[0] + (b[0] - a[0]) * t,
    a[1] + (b[1] - a[1]) * t,
    a[2] + (b[2] - a[2]) * t,
  ];
}


function tintKeepLuma(legacy, chroma, strength) {
  const l = lumaOf(legacy);
  const out = [0, 0, 0];
  for (let i = 0; i < 3; i++) {
    const target = l * chroma[i];
    const v = legacy[i] + (target - legacy[i]) * strength;
    out[i] = Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : legacy[i];
  }
  return Object.freeze(out);
}


export function smLiteAmbientTint(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const legacySky = sanitizeRgb01(src.legacySky);
  const legacyGround = sanitizeRgb01(src.legacyGround);
  const strength = sanitizeSmLiteAmbStrength(src.strength);
  const neutral = (reason) =>
    Object.freeze({
      applied: false,
      blend: 0,
      strength,
      sky: Object.freeze(legacySky.slice()),
      ground: Object.freeze(legacyGround.slice()),
      reason,
    });
  if (src.on !== true) return neutral("pacote OFF — ambiente legado byte a byte");
  if (strength <= 0) return neutral("strength 0 — tinte desligado pelo knob");
  const uni = src.uni;
  if (!uni || typeof uni !== "object" || !Array.isArray(uni.zenith) || !Array.isArray(uni.ground)) {
    return neutral("uniforms do céu ausentes/inválidos — fallback legado");
  }
  let blend = Number(uni.blend);
  if (!Number.isFinite(blend)) blend = 0;
  blend = blend < 0 ? 0 : blend > 1 ? 1 : blend;


  let r = 0;
  let g = 0;
  let b = 0;
  for (let i = 0; i < SM_LITE_AMB_SAMPLE_DIRS.length; i++) {
    let s = null;
    try {
      s = sampleSkyRGB(uni, SM_LITE_AMB_SAMPLE_DIRS[i]);
    } catch (e) {
      s = null;
    }
    if (!s || !Number.isFinite(Number(s[0]) + Number(s[1]) + Number(s[2]))) {
      return neutral("amostra do céu inválida — fallback legado");
    }
    r += s[0];
    g += s[1];
    b += s[2];
  }
  const n = SM_LITE_AMB_SAMPLE_DIRS.length;
  const dayChroma = chromaOf([r / n, g / n, b / n]);
  const gndChroma = chromaOf([uni.ground[0], uni.ground[1], uni.ground[2]]);
  const skyChroma = mix3(SM_LITE_NIGHT_SKY_CHROMA, dayChroma, blend);
  const groundChroma = mix3(SM_LITE_NIGHT_GROUND_CHROMA, gndChroma, blend);
  return Object.freeze({
    applied: true,
    blend,
    strength,
    sky: tintKeepLuma(legacySky, skyChroma, strength),
    ground: tintKeepLuma(legacyGround, groundChroma, strength),
    reason: "tinte espectral do céu físico (F8)",
  });
}
