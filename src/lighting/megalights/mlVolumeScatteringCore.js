export const VOLUME_MEDIUM_DEFAULTS = Object.freeze({


  scatteringCoefficient: 0.02,
  absorptionCoefficient: 0.005,

  anisotropy: 0.7,
});

const MINIMUM_EXTINCTION_FOR_DIVISION = 1e-6;
const MAXIMUM_ANISOTROPY = 0.95;

function finiteNumberOr(value, fallback) {
  const candidate = Number(value);
  return Number.isFinite(candidate) ? candidate : fallback;
}

function nonNegativeNumberOr(value, fallback) {
  return Math.max(0, finiteNumberOr(value, fallback));
}

function clampToUnitRange(value) {
  return Math.min(Math.max(finiteNumberOr(value, 0), 0), 1);
}

function radianceOf(value) {
  const radiance = value || {};
  return {
    red: nonNegativeNumberOr(radiance.red === undefined ? radiance.r : radiance.red, 0),
    green: nonNegativeNumberOr(radiance.green === undefined ? radiance.g : radiance.green, 0),
    blue: nonNegativeNumberOr(radiance.blue === undefined ? radiance.b : radiance.blue, 0),
  };
}

export function scatteringCoefficientOf(medium) {
  return nonNegativeNumberOr(
    (medium || {}).scatteringCoefficient,
    VOLUME_MEDIUM_DEFAULTS.scatteringCoefficient,
  );
}


export function extinctionOf(medium) {
  const options = medium || {};
  return (
    scatteringCoefficientOf(options) +
    nonNegativeNumberOr(options.absorptionCoefficient, VOLUME_MEDIUM_DEFAULTS.absorptionCoefficient)
  );
}


export function henyeyGreensteinPhase(cosineBetweenPhotonAndView, anisotropy) {
  const g = Math.min(
    Math.max(finiteNumberOr(anisotropy, VOLUME_MEDIUM_DEFAULTS.anisotropy), -MAXIMUM_ANISOTROPY),
    MAXIMUM_ANISOTROPY,
  );
  const cosine = Math.min(Math.max(finiteNumberOr(cosineBetweenPhotonAndView, 0), -1), 1);
  const numerator = 1 - g * g;
  const denominatorBase = Math.max(MINIMUM_EXTINCTION_FOR_DIVISION, 1 + g * g - 2 * g * cosine);
  return numerator / (4 * Math.PI * Math.pow(denominatorBase, 1.5));
}


export function forwardScatteringCosine(directionTowardsLight, directionTowardsCamera) {
  const light = directionTowardsLight || {};
  const camera = directionTowardsCamera || {};
  const dotProduct =
    finiteNumberOr(light.x, 0) * finiteNumberOr(camera.x, 0) +
    finiteNumberOr(light.y, 0) * finiteNumberOr(camera.y, 0) +
    finiteNumberOr(light.z, 0) * finiteNumberOr(camera.z, 0);
  return -dotProduct;
}


export function transmittanceOverDistance(extinction, distance) {
  return Math.exp(-nonNegativeNumberOr(extinction, 0) * nonNegativeNumberOr(distance, 0));
}


export function inScatteringFromLightSample(request) {
  const options = request || {};
  const radiance = radianceOf(options.radiance);
  const phase = henyeyGreensteinPhase(
    options.cosineBetweenPhotonAndView,
    (options.medium || {}).anisotropy,
  );
  const visibility = clampToUnitRange(
    options.transmittanceToLight === undefined ? 1 : options.transmittanceToLight,
  );
  const weight = phase * visibility;

  return {
    red: radiance.red * weight,
    green: radiance.green * weight,
    blue: radiance.blue * weight,
  };
}


export function integrateFroxelSegment(request) {
  const options = request || {};
  const medium = options.medium || VOLUME_MEDIUM_DEFAULTS;
  const inScattered = radianceOf(options.inScatteredRadiance);
  const segmentLength = nonNegativeNumberOr(options.segmentLength, 0);

  const extinction = extinctionOf(medium);
  const transmittance = transmittanceOverDistance(extinction, segmentLength);


  const integratedPath =
    extinction >= MINIMUM_EXTINCTION_FOR_DIVISION ? (1 - transmittance) / extinction : segmentLength;
  const weight = scatteringCoefficientOf(medium) * integratedPath;

  return Object.freeze({
    scattering: Object.freeze({
      red: inScattered.red * weight,
      green: inScattered.green * weight,
      blue: inScattered.blue * weight,
    }),
    transmittance,
  });
}
