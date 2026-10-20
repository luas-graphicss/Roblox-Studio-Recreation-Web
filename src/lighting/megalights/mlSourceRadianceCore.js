import { MGL_LIGHT_SHAPE_INDEX } from "./mlLightSceneDataCore.js";
import {
  MINIMUM_SQUARED_DISTANCE,
  coneAttenuation,
  distanceFalloff,
} from "./mlSampleWeightCore.js";


export const SOURCE_RADIANCE_REFUSAL = Object.freeze({
  none: "none",
  degenerateSource: "degenerateSource",
  noEmission: "noEmission",
  outsideAttenuationRadius: "outsideAttenuationRadius",
  outsideCone: "outsideCone",
});

function positiveNumberOrZero(value) {
  const asNumber = Number(value);
  return Number.isFinite(asNumber) && asNumber > 0 ? asNumber : 0;
}


export function projectedAreaOfSource(light) {
  const source = light || {};
  const shapeIndex = Math.floor(Number(source.shapeIndex));
  const radiusOrWidth = positiveNumberOrZero(source.sourceRadiusOrWidth);
  const lengthOrHeight = positiveNumberOrZero(source.sourceLengthOrHeight);
  if (shapeIndex === MGL_LIGHT_SHAPE_INDEX.rect) return radiusOrWidth * lengthOrHeight;
  if (shapeIndex === MGL_LIGHT_SHAPE_INDEX.tube) {
    return 2 * radiusOrWidth * lengthOrHeight + Math.PI * radiusOrWidth * radiusOrWidth;
  }
  return Math.PI * radiusOrWidth * radiusOrWidth;
}


export function rangeWindowAt(squaredDistance, attenuationRadius) {
  const safeSquaredDistance = Math.max(Number(squaredDistance) || 0, MINIMUM_SQUARED_DISTANCE);
  return distanceFalloff(safeSquaredDistance, attenuationRadius) * safeSquaredDistance;
}

function refusedRadiance(refusal, projectedArea) {
  return Object.freeze({
    refusal,
    radiance: Object.freeze({ r: 0, g: 0, b: 0 }),
    projectedArea,
    rangeWindow: 0,
    coneMask: 0,
  });
}


export function sourceRadianceTowardsShadingPoint(request) {
  const input = request || {};
  const light = input.light || {};
  const direction = input.direction || { x: 0, y: 0, z: 0 };
  const distanceToSample = Number(input.distanceToSample) || 0;

  const projectedArea = projectedAreaOfSource(light);
  if (!(projectedArea > 0)) {
    return refusedRadiance(SOURCE_RADIANCE_REFUSAL.degenerateSource, projectedArea);
  }

  const luminousIntensity = positiveNumberOrZero(light.intensityCandela);
  const color = Array.isArray(light.color) ? light.color : [0, 0, 0];
  const red = Math.max(Number(color[0]) || 0, 0);
  const green = Math.max(Number(color[1]) || 0, 0);
  const blue = Math.max(Number(color[2]) || 0, 0);
  if (!(luminousIntensity > 0) || !(red + green + blue > 0)) {
    return refusedRadiance(SOURCE_RADIANCE_REFUSAL.noEmission, projectedArea);
  }

  const rangeWindow = rangeWindowAt(distanceToSample * distanceToSample, light.attenuationRadius);
  if (!(rangeWindow > 0)) {
    return refusedRadiance(SOURCE_RADIANCE_REFUSAL.outsideAttenuationRadius, projectedArea);
  }

  const coneMask = coneAttenuation(light, direction.x, direction.y, direction.z);
  if (!(coneMask > 0)) {
    return refusedRadiance(SOURCE_RADIANCE_REFUSAL.outsideCone, projectedArea);
  }

  const radianceScale = (luminousIntensity * rangeWindow * coneMask) / projectedArea;
  return Object.freeze({
    refusal: SOURCE_RADIANCE_REFUSAL.none,
    radiance: Object.freeze({
      r: red * radianceScale,
      g: green * radianceScale,
      b: blue * radianceScale,
    }),
    projectedArea,
    rangeWindow,
    coneMask,
  });
}


export function describeSourceRadiance() {
  return {
    identity: "radiance = intensityCandela * rangeWindow * coneMask / projectedArea",
    whyProjectedArea: "candela is an intensity of the whole source; the estimator divides by a solid angle density",
    inverseSquareCarriedBy: "pdfSolidAngle of ML-F7, never applied twice here",
    rangeWindowOwnedBy: "mlSampleWeightCore.distanceFalloff, derived and not copied",
    refusals: SOURCE_RADIANCE_REFUSAL,
  };
}
