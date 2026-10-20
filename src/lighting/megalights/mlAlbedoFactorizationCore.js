export const DIELECTRIC_SPECULAR_REFLECTANCE = 0.04;
export const FACTORIZATION_FLOOR = 1e-3;

export function color(red, green, blue) {
  return { r: red, g: green, b: blue };
}

function finiteOrZero(value) {
  return Number.isFinite(value) ? value : 0;
}

export function clampUnitRange(value) {
  const number = finiteOrZero(value);
  if (number < 0) return 0;
  if (number > 1) return 1;
  return number;
}

function floorChannel(value) {
  const number = finiteOrZero(value);
  return number > FACTORIZATION_FLOOR ? number : FACTORIZATION_FLOOR;
}


export function diffuseAlbedoOf(baseColor, metalness) {
  const dielectricShare = 1 - clampUnitRange(metalness);
  return color(
    finiteOrZero(baseColor && baseColor.r) * dielectricShare,
    finiteOrZero(baseColor && baseColor.g) * dielectricShare,
    finiteOrZero(baseColor && baseColor.b) * dielectricShare,
  );
}


export function specularColorOf(baseColor, metalness) {
  const metal = clampUnitRange(metalness);
  const dielectricShare = 1 - metal;
  return color(
    DIELECTRIC_SPECULAR_REFLECTANCE * dielectricShare + finiteOrZero(baseColor && baseColor.r) * metal,
    DIELECTRIC_SPECULAR_REFLECTANCE * dielectricShare + finiteOrZero(baseColor && baseColor.g) * metal,
    DIELECTRIC_SPECULAR_REFLECTANCE * dielectricShare + finiteOrZero(baseColor && baseColor.b) * metal,
  );
}


export function envBrdfApproximation(specularColor, roughness, cosineViewAngle) {
  const clampedRoughness = clampUnitRange(roughness);
  const clampedCosine = clampUnitRange(cosineViewAngle);
  const rx = clampedRoughness * -1 + 1;
  const ry = clampedRoughness * -0.0275 + 0.0425;
  const rz = clampedRoughness * -0.572 + 1.04;
  const rw = clampedRoughness * 0.022 + -0.04;
  const a004 = Math.min(rx * rx, Math.pow(2, -9.28 * clampedCosine)) * rx + ry;
  const scale = -1.04 * a004 + rz;
  const bias = 1.04 * a004 + rw;
  return color(
    finiteOrZero(specularColor && specularColor.r) * scale + bias,
    finiteOrZero(specularColor && specularColor.g) * scale + bias,
    finiteOrZero(specularColor && specularColor.b) * scale + bias,
  );
}


export function diffuseFactorizationFactor(diffuseAlbedo) {
  return color(
    floorChannel(diffuseAlbedo && diffuseAlbedo.r),
    floorChannel(diffuseAlbedo && diffuseAlbedo.g),
    floorChannel(diffuseAlbedo && diffuseAlbedo.b),
  );
}


export function specularFactorizationFactor(specularColor, roughness, cosineViewAngle) {
  const envBrdf = envBrdfApproximation(specularColor, roughness, cosineViewAngle);
  return color(floorChannel(envBrdf.r), floorChannel(envBrdf.g), floorChannel(envBrdf.b));
}

export function factorOutSignal(radiance, factor) {
  return color(
    finiteOrZero(radiance && radiance.r) / factor.r,
    finiteOrZero(radiance && radiance.g) / factor.g,
    finiteOrZero(radiance && radiance.b) / factor.b,
  );
}

export function putSignalBack(signal, factor) {
  return color(
    finiteOrZero(signal && signal.r) * factor.r,
    finiteOrZero(signal && signal.g) * factor.g,
    finiteOrZero(signal && signal.b) * factor.b,
  );
}

export function describeAlbedoFactorization() {
  return {
    diffuseFactor: "albedo, clamped at the floor",
    specularFactor: "pre-integrated EnvBRDF (F0 * scale + bias), clamped at the floor",
    factorizationFloor: FACTORIZATION_FLOOR,
    dielectricSpecularReflectance: DIELECTRIC_SPECULAR_REFLECTANCE,
    restoredAfter: "the spatial filter of ML-F21, never before the denoiser",
  };
}
