export const RECIPROCAL_PI = 0.3183098861837907;
export const GGX_VISIBILITY_EPSILON = 1e-6;                               
export const MIN_STANDARD_ROUGHNESS = 0.0525;                                         
export const MIN_PHONG_SHININESS = 1;
export const MAX_PHONG_SHININESS = 1e6;
export const DIELECTRIC_F0 = 0.04;                                               
export const DEFAULT_ALBEDO_SAMPLE_COUNT = 4096;
export const CALIBRATION_SAMPLE_COUNT = 16384;
export const NORMAL_VIEW_COSINE = 1;
export const GRAZING_VIEW_COSINE = 0.5;                           

export function saturate(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return Math.min(1, Math.max(0, numeric));
}

export function clampShininess(shininess) {
  const numeric = Number(shininess);
  if (!Number.isFinite(numeric)) return MIN_PHONG_SHININESS;
  return Math.min(Math.max(numeric, MIN_PHONG_SHININESS), MAX_PHONG_SHININESS);
}


export function roughnessToShininess(roughness) {
  const alpha = saturate(roughness) * saturate(roughness);
  if (alpha <= 0) return MAX_PHONG_SHININESS;
  return clampShininess(2 / (alpha * alpha) - 2);
}


export function shininessToRoughness(shininess) {
  const safeShininess = clampShininess(shininess);
  const roughness = Math.pow(2 / (safeShininess + 2), 0.25);
  return Math.min(Math.max(roughness, MIN_STANDARD_ROUGHNESS), 1);
}


export function schlickFresnel(f0, f90, dotVH) {
  const fresnel = Math.pow(2, (-5.55473 * dotVH - 6.98316) * dotVH);
  return f0 * (1 - fresnel) + f90 * fresnel;
}


export function ggxSpecularBrdf(sample) {
  const roughness = saturate(sample.roughness);
  const alpha = roughness * roughness;
  const alphaSquared = alpha * alpha;
  const dotNL = saturate(sample.dotNL);
  const dotNV = saturate(sample.dotNV);
  const dotNH = saturate(sample.dotNH);
  const dotVH = saturate(sample.dotVH);
  const maskingView = dotNL * Math.sqrt(alphaSquared + (1 - alphaSquared) * dotNV * dotNV);
  const maskingLight = dotNV * Math.sqrt(alphaSquared + (1 - alphaSquared) * dotNL * dotNL);
  const visibility = 0.5 / Math.max(maskingView + maskingLight, GGX_VISIBILITY_EPSILON);
  const denominator = dotNH * dotNH * (alphaSquared - 1) + 1;
  const distribution = (RECIPROCAL_PI * alphaSquared) / (denominator * denominator);
  const f0 = sample.f0 === undefined ? DIELECTRIC_F0 : sample.f0;
  const f90 = sample.f90 === undefined ? 1 : sample.f90;
  return schlickFresnel(f0, f90, dotVH) * visibility * distribution;
}


export function blinnPhongSpecularBrdf(sample) {
  const shininess = clampShininess(sample.shininess);
  const dotNH = saturate(sample.dotNH);
  const dotVH = saturate(sample.dotVH);
  const distribution = RECIPROCAL_PI * (shininess * 0.5 + 1) * Math.pow(dotNH, shininess);
  const f0 = sample.f0 === undefined ? DIELECTRIC_F0 : sample.f0;
  const f90 = sample.f90 === undefined ? 1 : sample.f90;
  return schlickFresnel(f0, f90, dotVH) * 0.25 * distribution;
}


export function parityPhongSpecularBrdf(sample) {
  return ggxSpecularBrdf({
    roughness: shininessToRoughness(sample.shininess),
    dotNL: sample.dotNL,
    dotNV: sample.dotNV,
    dotNH: sample.dotNH,
    dotVH: sample.dotVH,
    f0: sample.f0 === undefined ? DIELECTRIC_F0 : sample.f0,
    f90: sample.f90 === undefined ? 1 : sample.f90,
  });
}


export function radicalInverse(index) {
  let bits = index >>> 0;
  bits = ((bits << 16) | (bits >>> 16)) >>> 0;
  bits = (((bits & 0x55555555) << 1) | ((bits & 0xaaaaaaaa) >>> 1)) >>> 0;
  bits = (((bits & 0x33333333) << 2) | ((bits & 0xcccccccc) >>> 2)) >>> 0;
  bits = (((bits & 0x0f0f0f0f) << 4) | ((bits & 0xf0f0f0f0) >>> 4)) >>> 0;
  bits = (((bits & 0x00ff00ff) << 8) | ((bits & 0xff00ff00) >>> 8)) >>> 0;
  return bits * 2.3283064365386963e-10;
}

function sampleCountOf(sampleCount) {
  const numeric = Math.floor(Number(sampleCount));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : DEFAULT_ALBEDO_SAMPLE_COUNT;
}


export function ggxDirectionalAlbedo(roughness, dotNV, sampleCount) {
  const total = sampleCountOf(sampleCount);
  const alpha = saturate(roughness) * saturate(roughness);
  const alphaSquared = alpha * alpha;
  const viewCosine = saturate(dotNV);
  const viewSine = Math.sqrt(Math.max(0, 1 - viewCosine * viewCosine));
  let sum = 0;
  for (let index = 0; index < total; index++) {
    const stratified = (index + 0.5) / total;
    const azimuth = 2 * Math.PI * radicalInverse(index);
    const halfCosine = Math.sqrt((1 - stratified) / (1 + (alphaSquared - 1) * stratified));
    const halfSine = Math.sqrt(Math.max(0, 1 - halfCosine * halfCosine));
    const halfX = halfSine * Math.cos(azimuth);
    const halfZ = halfCosine;
    const dotVH = halfX * viewSine + halfZ * viewCosine;
    if (dotVH <= 0) continue;
    const dotNL = 2 * dotVH * halfZ - viewCosine;
    if (dotNL <= 0) continue;
    const maskingView = dotNL * Math.sqrt(alphaSquared + (1 - alphaSquared) * viewCosine * viewCosine);
    const maskingLight = viewCosine * Math.sqrt(alphaSquared + (1 - alphaSquared) * dotNL * dotNL);
    const visibility = 0.5 / Math.max(maskingView + maskingLight, GGX_VISIBILITY_EPSILON);
    sum += (4 * visibility * dotNL * dotVH) / Math.max(halfZ, GGX_VISIBILITY_EPSILON);
  }
  return sum / total;
}

export function blinnPhongDirectionalAlbedo(shininess, dotNV, sampleCount) {
  const total = sampleCountOf(sampleCount);
  const safeShininess = clampShininess(shininess);
  const viewCosine = saturate(dotNV);
  const viewSine = Math.sqrt(Math.max(0, 1 - viewCosine * viewCosine));
  const estimatorWeight = (safeShininess + 2) / (safeShininess + 1);
  let sum = 0;
  for (let index = 0; index < total; index++) {
    const stratified = (index + 0.5) / total;
    const azimuth = 2 * Math.PI * radicalInverse(index);
    const halfCosine = Math.pow(stratified, 1 / (safeShininess + 1));
    const halfSine = Math.sqrt(Math.max(0, 1 - halfCosine * halfCosine));
    const halfX = halfSine * Math.cos(azimuth);
    const halfZ = halfCosine;
    const dotVH = halfX * viewSine + halfZ * viewCosine;
    if (dotVH <= 0) continue;
    const dotNL = 2 * dotVH * halfZ - viewCosine;
    if (dotNL <= 0) continue;
    sum += dotNL * dotVH * estimatorWeight;
  }
  return sum / total;
}


export function blinnPhongDirectionalAlbedoAtNormalIncidence(shininess) {
  const safeShininess = clampShininess(shininess);
  const halfAngleCosine = Math.SQRT1_2;                                       
  const atNormal = 2 / (safeShininess + 4) - 1 / (safeShininess + 2);
  const atHorizon =
    (2 * Math.pow(halfAngleCosine, safeShininess + 4)) / (safeShininess + 4) -
    Math.pow(halfAngleCosine, safeShininess + 2) / (safeShininess + 2);
  return (safeShininess + 2) * (atNormal - atHorizon);
}


export function legacyPhongEnergyRatio(options) {
  const settings = options || {};
  const roughness = saturate(settings.roughness);
  const dotNV = settings.dotNV === undefined ? NORMAL_VIEW_COSINE : saturate(settings.dotNV);
  const sampleCount = sampleCountOf(settings.sampleCount);
  const shininess = settings.shininess === undefined ? roughnessToShininess(roughness) : clampShininess(settings.shininess);
  const standardAlbedo = ggxDirectionalAlbedo(roughness, dotNV, sampleCount);
  const phongAlbedo = blinnPhongDirectionalAlbedo(shininess, dotNV, sampleCount);
  return {
    roughness,
    shininess,
    dotNV,
    sampleCount,
    standardAlbedo,
    phongAlbedo,
    ratio: standardAlbedo > 0 ? phongAlbedo / standardAlbedo : 0,
    correctionFactor: phongAlbedo > 0 ? standardAlbedo / phongAlbedo : 0,
  };
}


export const PHONG_ENERGY_RESIDUAL_TABLE = Object.freeze([
  Object.freeze({ roughness: 0.05, shininess: 319998, standardAlbedo: 1.0, phongAlbedo: 0.99999, ratioNormal: 0.99999, ratioGrazing: 0.25 }),
  Object.freeze({ roughness: 0.1, shininess: 19998, standardAlbedo: 0.99988, phongAlbedo: 0.9998, ratioNormal: 0.99992, ratioGrazing: 0.25006 }),
  Object.freeze({ roughness: 0.15, shininess: 3948.62, standardAlbedo: 0.99949, phongAlbedo: 0.99899, ratioNormal: 0.9995, ratioGrazing: 0.25051 }),
  Object.freeze({ roughness: 0.2, shininess: 1248, standardAlbedo: 0.9983, phongAlbedo: 0.99681, ratioNormal: 0.9985, ratioGrazing: 0.25153 }),
  Object.freeze({ roughness: 0.25, shininess: 510, standardAlbedo: 0.99569, phongAlbedo: 0.99222, ratioNormal: 0.99651, ratioGrazing: 0.25399 }),
  Object.freeze({ roughness: 0.3, shininess: 244.91, standardAlbedo: 0.99067, phongAlbedo: 0.98393, ratioNormal: 0.9932, ratioGrazing: 0.25843 }),
  Object.freeze({ roughness: 0.4, shininess: 76.12, standardAlbedo: 0.9677, phongAlbedo: 0.95008, ratioNormal: 0.98179, ratioGrazing: 0.27678 }),
  Object.freeze({ roughness: 0.5, shininess: 30, standardAlbedo: 0.91581, phongAlbedo: 0.88235, ratioNormal: 0.96346, ratioGrazing: 0.31072 }),
  Object.freeze({ roughness: 0.6, shininess: 13.43, standardAlbedo: 0.82453, phongAlbedo: 0.77108, ratioNormal: 0.93517, ratioGrazing: 0.35945 }),
  Object.freeze({ roughness: 0.7, shininess: 6.33, standardAlbedo: 0.69775, phongAlbedo: 0.62357, ratioNormal: 0.89369, ratioGrazing: 0.41755 }),
  Object.freeze({ roughness: 0.8, shininess: 2.88, standardAlbedo: 0.55517, phongAlbedo: 0.47234, ratioNormal: 0.8508, ratioGrazing: 0.47608 }),
  Object.freeze({ roughness: 0.9, shininess: 1.05, standardAlbedo: 0.41997, phongAlbedo: 0.3454, ratioNormal: 0.82244, ratioGrazing: 0.52393 }),
]);


export function lookupPhongEnergyResidual(roughness) {
  const target = saturate(roughness);
  const table = PHONG_ENERGY_RESIDUAL_TABLE;
  if (target <= table[0].roughness) return table[0];
  const last = table[table.length - 1];
  if (target >= last.roughness) return last;
  for (let index = 1; index < table.length; index++) {
    const upper = table[index];
    if (target > upper.roughness) continue;
    const lower = table[index - 1];
    const span = upper.roughness - lower.roughness;
    const mix = span > 0 ? (target - lower.roughness) / span : 0;
    return Object.freeze({
      roughness: target,
      shininess: roughnessToShininess(target),
      standardAlbedo: lower.standardAlbedo + (upper.standardAlbedo - lower.standardAlbedo) * mix,
      phongAlbedo: lower.phongAlbedo + (upper.phongAlbedo - lower.phongAlbedo) * mix,
      ratioNormal: lower.ratioNormal + (upper.ratioNormal - lower.ratioNormal) * mix,
      ratioGrazing: lower.ratioGrazing + (upper.ratioGrazing - lower.ratioGrazing) * mix,
      interpolado: true,
    });
  }
  return last;
}
