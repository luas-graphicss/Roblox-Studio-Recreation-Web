import {
  MINIMUM_VECTOR_LENGTH,
  addVectors,
  areaPdfToSolidAnglePdf,
  buildOrthonormalBasis,
  clampToUnitRange,
  directionFromFrame,
  dotProduct,
  normalizeVector,
  scaleVector,
  subtractVectors,
  vectorLength,
} from "./mlSamplingGeometryCore.js";
import { sphereSolidAngle } from "./mlSphereSamplingCore.js";

const TWO_PI = Math.PI * 2;

export const TUBE_SURFACE_REGION = Object.freeze({
  lateral: "lateral",
  positiveCap: "positiveCap",
  negativeCap: "negativeCap",
});

export function tubeLateralArea(radius, halfLength) {
  return TWO_PI * Math.max(0, radius) * 2 * Math.max(0, halfLength);
}


export function tubeCapArea(radius) {
  return 4 * Math.PI * Math.max(0, radius) * Math.max(0, radius);
}

export function tubeArea(radius, halfLength) {
  return tubeLateralArea(radius, halfLength) + tubeCapArea(radius);
}

export function tubeSamplePdfArea(radius, halfLength) {
  const area = tubeArea(radius, halfLength);
  return area > 0 ? 1 / area : 0;
}


export function distanceToTubeAxis(point, center, axis, halfLength) {
  const unitAxis = normalizeVector(axis);
  const centerToPoint = subtractVectors(point, center);
  const alongAxis = dotProduct(centerToPoint, unitAxis);
  const clampedAlongAxis = Math.max(-halfLength, Math.min(halfLength, alongAxis));
  const closestPointOnSegment = addVectors(center, scaleVector(unitAxis, clampedAlongAxis));
  return vectorLength(subtractVectors(point, closestPointOnSegment));
}


export function tubeSolidAngleUpperBound(request) {
  const boundingRadius = Math.max(0, request.radius) + Math.max(0, request.halfLength);
  const distanceToCenter = vectorLength(subtractVectors(request.center, request.shadingPoint));
  return sphereSolidAngle(boundingRadius, distanceToCenter);
}


export function sampleTube(request) {
  const u1 = clampToUnitRange(request.u1);
  const u2 = clampToUnitRange(request.u2);
  const radius = Math.max(0, Number(request.radius) || 0);
  const halfLength = Math.max(0, Number(request.halfLength) || 0);

  const unitAxis = normalizeVector(request.axis);
  const frame = buildOrthonormalBasis(unitAxis);
  const lateralArea = tubeLateralArea(radius, halfLength);
  const totalArea = lateralArea + tubeCapArea(radius);
  const lateralFraction = totalArea > 0 ? lateralArea / totalArea : 0;
  const azimuth = TWO_PI * u2;
  const cosineAzimuth = Math.cos(azimuth);
  const sineAzimuth = Math.sin(azimuth);

  const capFraction = (1 - lateralFraction) * 0.5;
  const lateralEnd = capFraction + lateralFraction;

  let normal = null;
  let position = null;
  let region = TUBE_SURFACE_REGION.lateral;

  if (u1 >= capFraction && u1 < lateralEnd && lateralFraction > 0) {
    const lateralParameter = (u1 - capFraction) / lateralFraction;
    const offsetAlongAxis = (2 * lateralParameter - 1) * halfLength;
    normal = directionFromFrame(frame, cosineAzimuth, sineAzimuth, 0);
    position = addVectors(
      addVectors(request.center, scaleVector(unitAxis, offsetAlongAxis)),
      scaleVector(normal, radius),
    );
  } else {


    const isPositiveCap = u1 >= lateralEnd;
    const distanceFromSeam = isPositiveCap ? u1 - lateralEnd : capFraction - u1;
    const capParameter = capFraction > 0 ? distanceFromSeam / capFraction : 0;
    const capSign = isPositiveCap ? 1 : -1;
    const cosinePolar = clampToUnitRange(capParameter);
    const sinePolar = Math.sqrt(Math.max(0, 1 - cosinePolar * cosinePolar));
    normal = directionFromFrame(frame, sinePolar * cosineAzimuth, sinePolar * sineAzimuth, capSign * cosinePolar);
    const capCenter = addVectors(request.center, scaleVector(unitAxis, capSign * halfLength));
    position = addVectors(capCenter, scaleVector(normal, radius));
    region = isPositiveCap ? TUBE_SURFACE_REGION.positiveCap : TUBE_SURFACE_REGION.negativeCap;
  }

  const shadingPointToSample = subtractVectors(position, request.shadingPoint);
  const distanceToSample = vectorLength(shadingPointToSample);
  const direction =
    distanceToSample > MINIMUM_VECTOR_LENGTH ? scaleVector(shadingPointToSample, 1 / distanceToSample) : { x: 0, y: 0, z: 0 };
  const cosineAtLight = -dotProduct(normal, direction);
  const pdfArea = totalArea > 0 ? 1 / totalArea : 0;

  return {
    position: position,
    normal: normal,
    direction: direction,
    distanceToSample: distanceToSample,
    cosineAtLight: cosineAtLight,
    pdfArea: pdfArea,
    pdfSolidAngle: areaPdfToSolidAnglePdf(pdfArea, distanceToSample, cosineAtLight),
    area: totalArea,
    region: region,
  };
}
