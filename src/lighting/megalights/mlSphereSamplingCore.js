import {
  MINIMUM_VECTOR_LENGTH,
  addVectors,
  buildOrthonormalBasis,
  clampNumber,
  clampToUnitRange,
  directionFromFrame,
  dotProduct,
  normalizeVector,
  scaleVector,
  subtractVectors,
  vectorLength,
} from "./mlSamplingGeometryCore.js";

const TWO_PI = Math.PI * 2;
const FOUR_PI = Math.PI * 4;


export function sphereConeCosine(radius, distanceToCenter) {
  if (!(distanceToCenter > radius)) return -1;
  const sineSquared = (radius * radius) / (distanceToCenter * distanceToCenter);
  return Math.sqrt(Math.max(0, 1 - sineSquared));
}

export function sphereSolidAngle(radius, distanceToCenter) {
  return TWO_PI * (1 - sphereConeCosine(radius, distanceToCenter));
}

export function sphereSamplePdfSolidAngle(radius, distanceToCenter) {
  const solidAngle = sphereSolidAngle(radius, distanceToCenter);
  return solidAngle > 0 ? 1 / solidAngle : 0;
}


export function sampleSphere(request) {
  const shadingPoint = request.shadingPoint;
  const center = request.center;
  const radius = Math.max(0, Number(request.radius) || 0);
  const u1 = clampToUnitRange(request.u1);
  const u2 = clampToUnitRange(request.u2);

  const shadingPointToCenter = subtractVectors(center, shadingPoint);
  const distanceToCenter = vectorLength(shadingPointToCenter);

  if (!(distanceToCenter > radius + MINIMUM_VECTOR_LENGTH)) {
    return sampleSphereFromInside(shadingPoint, center, radius, u1, u2);
  }

  const coneAxis = scaleVector(shadingPointToCenter, 1 / distanceToCenter);
  const frame = buildOrthonormalBasis(coneAxis);
  const cosineOfConeEdge = sphereConeCosine(radius, distanceToCenter);
  const solidAngle = TWO_PI * (1 - cosineOfConeEdge);


  const cosineTheta = 1 - u1 * (1 - cosineOfConeEdge);
  const sineTheta = Math.sqrt(Math.max(0, 1 - cosineTheta * cosineTheta));
  const azimuth = TWO_PI * u2;
  const cosineAzimuth = Math.cos(azimuth);
  const sineAzimuth = Math.sin(azimuth);


  const distanceAlongDirection =
    distanceToCenter * cosineTheta -
    Math.sqrt(Math.max(0, radius * radius - distanceToCenter * distanceToCenter * sineTheta * sineTheta));
  const cosineAlpha = clampNumber(
    (distanceToCenter * distanceToCenter + radius * radius - distanceAlongDirection * distanceAlongDirection) /
      (2 * distanceToCenter * radius),
    -1,
    1,
  );
  const sineAlpha = Math.sqrt(Math.max(0, 1 - cosineAlpha * cosineAlpha));


  const normal = normalizeVector(
    directionFromFrame(frame, -sineAlpha * cosineAzimuth, -sineAlpha * sineAzimuth, -cosineAlpha),
  );
  const position = addVectors(center, scaleVector(normal, radius));
  const shadingPointToSample = subtractVectors(position, shadingPoint);
  const distanceToSample = vectorLength(shadingPointToSample);
  const direction = normalizeVector(shadingPointToSample);

  return {
    position: position,
    normal: normal,
    direction: direction,
    distanceToSample: distanceToSample,
    cosineAtLight: -dotProduct(normal, direction),
    pdfSolidAngle: solidAngle > 0 ? 1 / solidAngle : 0,
    solidAngle: solidAngle,
    cosineOfConeEdge: cosineOfConeEdge,
    shadingPointIsInsideSphere: false,
  };
}


function sampleSphereFromInside(shadingPoint, center, radius, u1, u2) {
  const cosineTheta = 1 - 2 * u1;
  const sineTheta = Math.sqrt(Math.max(0, 1 - cosineTheta * cosineTheta));
  const azimuth = TWO_PI * u2;
  const direction = {
    x: sineTheta * Math.cos(azimuth),
    y: sineTheta * Math.sin(azimuth),
    z: cosineTheta,
  };

  const centerToShadingPoint = subtractVectors(shadingPoint, center);
  const alongDirection = dotProduct(centerToShadingPoint, direction);
  const centerDistanceSquared = dotProduct(centerToShadingPoint, centerToShadingPoint);
  const exitDistance =
    -alongDirection + Math.sqrt(Math.max(0, alongDirection * alongDirection - (centerDistanceSquared - radius * radius)));
  const position = addVectors(shadingPoint, scaleVector(direction, exitDistance));
  const normal = normalizeVector(subtractVectors(position, center));

  return {
    position: position,
    normal: normal,
    direction: direction,
    distanceToSample: exitDistance,
    cosineAtLight: -dotProduct(normal, direction),
    pdfSolidAngle: 1 / FOUR_PI,
    solidAngle: FOUR_PI,
    cosineOfConeEdge: -1,
    shadingPointIsInsideSphere: true,
  };
}
