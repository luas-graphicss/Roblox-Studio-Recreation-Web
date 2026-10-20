export const MINIMUM_ROUGHNESS = 0.045;
export const MINIMUM_COSINE = 1e-6;
export const LAMBERT_DIFFUSE_WITHOUT_ALBEDO = 1 / Math.PI;

export function clampCosine(value) {
  if (!Number.isFinite(value)) return 0;
  if (value < 0) return 0;
  if (value > 1) return 1;
  return value;
}


export function clampRoughness(value) {
  const roughness = Number.isFinite(value) ? value : 1;
  if (roughness < MINIMUM_ROUGHNESS) return MINIMUM_ROUGHNESS;
  if (roughness > 1) return 1;
  return roughness;
}

export function alphaFromRoughness(roughness) {
  const clampedRoughness = clampRoughness(roughness);
  return clampedRoughness * clampedRoughness;
}


export function diffuseLobeWithoutAlbedo() {
  return LAMBERT_DIFFUSE_WITHOUT_ALBEDO;
}


export function ggxNormalDistribution(roughness, cosineHalfAngle) {
  const alpha = alphaFromRoughness(roughness);
  const alphaSquared = alpha * alpha;
  const cosine = clampCosine(cosineHalfAngle);
  const denominator = cosine * cosine * (alphaSquared - 1) + 1;
  if (!(denominator > 0)) return 0;
  return alphaSquared / (Math.PI * denominator * denominator);
}


export function smithHeightCorrelatedVisibility(roughness, cosineViewAngle, cosineLightAngle) {
  const alpha = alphaFromRoughness(roughness);
  const alphaSquared = alpha * alpha;
  const cosineView = clampCosine(cosineViewAngle);
  const cosineLight = clampCosine(cosineLightAngle);
  if (!(cosineView > MINIMUM_COSINE) || !(cosineLight > MINIMUM_COSINE)) return 0;
  const viewTerm = cosineLight * Math.sqrt(cosineView * cosineView * (1 - alphaSquared) + alphaSquared);
  const lightTerm = cosineView * Math.sqrt(cosineLight * cosineLight * (1 - alphaSquared) + alphaSquared);
  const sum = viewTerm + lightTerm;
  if (!(sum > 0)) return 0;
  return 0.5 / sum;
}


export function specularLobeWithoutEnvBrdf(request) {
  const distribution = ggxNormalDistribution(request.roughness, request.cosineHalfAngle);
  if (!(distribution > 0)) return 0;
  const visibility = smithHeightCorrelatedVisibility(
    request.roughness,
    request.cosineViewAngle,
    request.cosineLightAngle,
  );
  return distribution * visibility;
}

export function describeMicrofacetBrdf() {
  return {
    diffuseModel: "lambert without albedo",
    specularDistribution: "ggx / trowbridge-reitz",
    specularVisibility: "smith height correlated, 1/(4 NdotL NdotV) included",
    fresnelIncluded: false,
    albedoIncluded: false,
    minimumRoughness: MINIMUM_ROUGHNESS,
  };
}
