export const REC709_LUMINANCE_COEFFICIENTS = Object.freeze({ red: 0.2126, green: 0.7152, blue: 0.0722 });
export const SAMPLE_WEIGHT_LOG2_BIAS = 1;
export const MINIMUM_SAMPLE_WEIGHT = Math.pow(2, -20);
export const MINIMUM_SQUARED_DISTANCE = 1e-8;
export const MINIMUM_ROUGHNESS = 0.02;
export const DEFAULT_SPECULAR_REFLECTANCE = 0.04;
export const NO_CONE_COSINE = -1;


export const SAMPLE_WEIGHT_REJECTION = Object.freeze({
  none: "none",
  shadingPointInsideSource: "shadingPointInsideSource",
  lightBelowHorizon: "lightBelowHorizon",
  outsideAttenuationRadius: "outsideAttenuationRadius",
  outsideCone: "outsideCone",
  noEmission: "noEmission",
});

function finiteNumberOr(value, fallback) {
  const asNumber = Number(value);
  return Number.isFinite(asNumber) ? asNumber : fallback;
}

export function luminanceOfRgb(color) {
  const red = Math.max(finiteNumberOr(color && color[0], 0), 0);
  const green = Math.max(finiteNumberOr(color && color[1], 0), 0);
  const blue = Math.max(finiteNumberOr(color && color[2], 0), 0);
  return (
    red * REC709_LUMINANCE_COEFFICIENTS.red +
    green * REC709_LUMINANCE_COEFFICIENTS.green +
    blue * REC709_LUMINANCE_COEFFICIENTS.blue
  );
}


export function distanceFalloff(squaredDistance, attenuationRadius) {
  const safeSquaredDistance = Math.max(finiteNumberOr(squaredDistance, 0), MINIMUM_SQUARED_DISTANCE);
  const inverseSquare = 1 / safeSquaredDistance;
  const radius = finiteNumberOr(attenuationRadius, 0);
  if (!(radius > 0)) return inverseSquare;
  const normalizedDistanceSquared = safeSquaredDistance / (radius * radius);
  if (normalizedDistanceSquared >= 1) return 0;
  const window = 1 - normalizedDistanceSquared * normalizedDistanceSquared;
  return inverseSquare * window * window;
}


export function coneAttenuation(light, lightDirectionX, lightDirectionY, lightDirectionZ) {
  const outerCosine = finiteNumberOr(light && light.coneCosOuter, NO_CONE_COSINE);
  if (!(outerCosine > NO_CONE_COSINE)) return 1;
  const emissionDirection = (light && (light.directionView || light.direction)) || [0, 0, -1];
  const cosineFromAxis = -(
    finiteNumberOr(emissionDirection[0], 0) * lightDirectionX +
    finiteNumberOr(emissionDirection[1], 0) * lightDirectionY +
    finiteNumberOr(emissionDirection[2], -1) * lightDirectionZ
  );
  if (cosineFromAxis <= outerCosine) return 0;
  const innerCosine = finiteNumberOr(light && light.coneCosInner, NO_CONE_COSINE);
  if (!(innerCosine > outerCosine) || cosineFromAxis >= innerCosine) return 1;

  const edgeRatio = (cosineFromAxis - outerCosine) / (innerCosine - outerCosine);
  return edgeRatio * edgeRatio * (3 - 2 * edgeRatio);
}

export function lambertDiffuseBrdf(diffuseAlbedo) {
  return Math.max(finiteNumberOr(diffuseAlbedo, 0), 0) / Math.PI;
}


export function ggxNormalDistribution(cosineNormalHalf, roughness) {
  const clampedRoughness = Math.max(finiteNumberOr(roughness, 1), MINIMUM_ROUGHNESS);
  const alpha = clampedRoughness * clampedRoughness;
  const alphaSquared = alpha * alpha;
  const cosine = Math.min(Math.max(finiteNumberOr(cosineNormalHalf, 0), 0), 1);
  const denominator = cosine * cosine * (alphaSquared - 1) + 1;
  return alphaSquared / (Math.PI * denominator * denominator);
}


export function smithHeightCorrelatedVisibility(cosineAtSurface, cosineTowardsView, roughness) {
  const clampedRoughness = Math.max(finiteNumberOr(roughness, 1), MINIMUM_ROUGHNESS);
  const alpha = clampedRoughness * clampedRoughness;
  const alphaSquared = alpha * alpha;
  const cosineLight = Math.max(finiteNumberOr(cosineAtSurface, 0), 0);
  const cosineView = Math.max(finiteNumberOr(cosineTowardsView, 0), 0);
  const lambdaView = cosineLight * Math.sqrt(cosineView * cosineView * (1 - alphaSquared) + alphaSquared);
  const lambdaLight = cosineView * Math.sqrt(cosineLight * cosineLight * (1 - alphaSquared) + alphaSquared);
  const sum = lambdaView + lambdaLight;
  return sum > 0 ? 0.5 / sum : 0;
}

export function schlickFresnel(cosineViewHalf, specularReflectance) {
  const clampedCosine = Math.min(Math.max(finiteNumberOr(cosineViewHalf, 0), 0), 1);
  const reflectanceAtNormalIncidence = finiteNumberOr(specularReflectance, DEFAULT_SPECULAR_REFLECTANCE);
  const oneMinusCosine = 1 - clampedCosine;
  const fifthPower =
    oneMinusCosine * oneMinusCosine * oneMinusCosine * oneMinusCosine * oneMinusCosine;
  return reflectanceAtNormalIncidence + (1 - reflectanceAtNormalIncidence) * fifthPower;
}


export function ggxSpecularBrdf(request) {
  const input = request || {};
  const cosineAtSurface = finiteNumberOr(input.cosineAtSurface, 0);
  const cosineTowardsView = finiteNumberOr(input.cosineTowardsView, 0);
  if (!(cosineAtSurface > 0) || !(cosineTowardsView > 0)) return 0;
  const normalDistribution = ggxNormalDistribution(input.cosineNormalHalf, input.roughness);
  const visibility = smithHeightCorrelatedVisibility(cosineAtSurface, cosineTowardsView, input.roughness);
  const fresnel = schlickFresnel(input.cosineViewHalf, input.specularReflectance);
  return normalDistribution * visibility * fresnel;
}


export function createSurfaceDescription(overrides) {
  const source = overrides && typeof overrides === "object" ? overrides : {};
  return {
    positionView: source.positionView || [0, 0, 0],
    normalView: source.normalView || [0, 0, 1],
    viewDirection: source.viewDirection || [0, 0, 1],
    diffuseAlbedoLuminance: finiteNumberOr(source.diffuseAlbedoLuminance, 0.18),
    specularReflectance: finiteNumberOr(source.specularReflectance, DEFAULT_SPECULAR_REFLECTANCE),
    roughness: finiteNumberOr(source.roughness, 0.5),
  };
}

function rejectedContribution(rejection, distance) {
  return {
    value: 0,
    distance: finiteNumberOr(distance, 0),
    cosineAtSurface: 0,
    diffuseBrdf: 0,
    specularBrdf: 0,
    rejection,
  };
}


export function brdfWeightedLuminance(request) {
  const input = request || {};
  const light = input.light || {};
  const surface = input.surface || {};

  const lightPosition = light.positionView || light.position || [0, 0, 0];
  const surfacePosition = surface.positionView || [0, 0, 0];
  const toLightX = finiteNumberOr(lightPosition[0], 0) - finiteNumberOr(surfacePosition[0], 0);
  const toLightY = finiteNumberOr(lightPosition[1], 0) - finiteNumberOr(surfacePosition[1], 0);
  const toLightZ = finiteNumberOr(lightPosition[2], 0) - finiteNumberOr(surfacePosition[2], 0);

  const squaredDistance = toLightX * toLightX + toLightY * toLightY + toLightZ * toLightZ;
  if (!(squaredDistance > MINIMUM_SQUARED_DISTANCE)) {
    return rejectedContribution(SAMPLE_WEIGHT_REJECTION.shadingPointInsideSource, 0);
  }
  const distance = Math.sqrt(squaredDistance);
  const inverseDistance = 1 / distance;
  const lightDirectionX = toLightX * inverseDistance;
  const lightDirectionY = toLightY * inverseDistance;
  const lightDirectionZ = toLightZ * inverseDistance;

  const normal = surface.normalView || [0, 0, 1];
  const normalX = finiteNumberOr(normal[0], 0);
  const normalY = finiteNumberOr(normal[1], 0);
  const normalZ = finiteNumberOr(normal[2], 1);
  const cosineAtSurface =
    normalX * lightDirectionX + normalY * lightDirectionY + normalZ * lightDirectionZ;
  if (!(cosineAtSurface > 0)) {
    return rejectedContribution(SAMPLE_WEIGHT_REJECTION.lightBelowHorizon, distance);
  }

  const emittedLuminance =
    luminanceOfRgb(light.color) * Math.max(finiteNumberOr(light.intensityCandela, 0), 0);
  if (!(emittedLuminance > 0)) {
    return rejectedContribution(SAMPLE_WEIGHT_REJECTION.noEmission, distance);
  }

  const falloff = distanceFalloff(squaredDistance, light.attenuationRadius);
  if (!(falloff > 0)) {
    return rejectedContribution(SAMPLE_WEIGHT_REJECTION.outsideAttenuationRadius, distance);
  }
  const cone = coneAttenuation(light, lightDirectionX, lightDirectionY, lightDirectionZ);
  if (!(cone > 0)) {
    return rejectedContribution(SAMPLE_WEIGHT_REJECTION.outsideCone, distance);
  }

  const view = surface.viewDirection || [0, 0, 1];
  const viewX = finiteNumberOr(view[0], 0);
  const viewY = finiteNumberOr(view[1], 0);
  const viewZ = finiteNumberOr(view[2], 1);
  const halfX = lightDirectionX + viewX;
  const halfY = lightDirectionY + viewY;
  const halfZ = lightDirectionZ + viewZ;
  const halfLength = Math.sqrt(halfX * halfX + halfY * halfY + halfZ * halfZ);
  const inverseHalfLength = halfLength > 0 ? 1 / halfLength : 0;
  const cosineNormalHalf =
    (normalX * halfX + normalY * halfY + normalZ * halfZ) * inverseHalfLength;
  const cosineViewHalf = (viewX * halfX + viewY * halfY + viewZ * halfZ) * inverseHalfLength;
  const cosineTowardsView = normalX * viewX + normalY * viewY + normalZ * viewZ;

  const diffuseBrdf = lambertDiffuseBrdf(surface.diffuseAlbedoLuminance);
  const specularBrdf = ggxSpecularBrdf({
    cosineAtSurface,
    cosineTowardsView,
    cosineNormalHalf,
    cosineViewHalf,
    roughness: surface.roughness,
    specularReflectance: surface.specularReflectance,
  });

  return {
    value: emittedLuminance * falloff * cone * cosineAtSurface * (diffuseBrdf + specularBrdf),
    distance,
    cosineAtSurface,
    diffuseBrdf,
    specularBrdf,
    rejection: SAMPLE_WEIGHT_REJECTION.none,
  };
}


export function rawSampleWeight(brdfWeightedLuminanceValue) {
  if (!(brdfWeightedLuminanceValue > 0)) return Number.NEGATIVE_INFINITY;
  return Math.log2(brdfWeightedLuminanceValue) + SAMPLE_WEIGHT_LOG2_BIAS;
}


export function clampSampleWeight(rawWeight) {
  if (!Number.isFinite(rawWeight)) return MINIMUM_SAMPLE_WEIGHT;
  return Math.max(rawWeight, MINIMUM_SAMPLE_WEIGHT);
}


export function sampleWeightForLight(request) {
  const contribution = brdfWeightedLuminance(request);
  const rawWeight = rawSampleWeight(contribution.value);
  const weight = clampSampleWeight(rawWeight);
  return {
    weight,
    rawWeight,
    brdfWeightedLuminance: contribution.value,
    clampedToFloor: weight !== rawWeight,
    rejection: contribution.rejection,
    distance: contribution.distance,
    cosineAtSurface: contribution.cosineAtSurface,
  };
}


export function describeSampleWeight() {
  return {
    formula: "log2(luminance(BRDF weighted contribution)) + " + SAMPLE_WEIGHT_LOG2_BIAS,
    luminanceCoefficients: REC709_LUMINANCE_COEFFICIENTS,
    minimumSampleWeight: MINIMUM_SAMPLE_WEIGHT,
    sourceModel: "point approximation (area integral belongs to ML-F7 and ML-F18)",
  };
}
