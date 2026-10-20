import {
  MINIMUM_VECTOR_LENGTH,
  addVectors,
  areaPdfToSolidAnglePdf,
  clampToUnitRange,
  crossProduct,
  dotProduct,
  normalizeVector,
  scaleVector,
  subtractVectors,
  vectorLength,
} from "./mlSamplingGeometryCore.js";

export function rectangleArea(halfWidth, halfHeight) {
  return 4 * Math.max(0, halfWidth) * Math.max(0, halfHeight);
}

export function rectangleSamplePdfArea(halfWidth, halfHeight) {
  const area = rectangleArea(halfWidth, halfHeight);
  return area > 0 ? 1 / area : 0;
}


export function rectangleNormal(rightAxis, upAxis) {
  return normalizeVector(crossProduct(rightAxis, upAxis));
}

export function rectangleCorners(rectangle) {
  const alongWidth = scaleVector(rectangle.rightAxis, rectangle.halfWidth);
  const alongHeight = scaleVector(rectangle.upAxis, rectangle.halfHeight);
  return [
    subtractVectors(subtractVectors(rectangle.center, alongWidth), alongHeight),
    subtractVectors(addVectors(rectangle.center, alongWidth), alongHeight),
    addVectors(addVectors(rectangle.center, alongWidth), alongHeight),
    addVectors(subtractVectors(rectangle.center, alongWidth), alongHeight),
  ];
}


export function triangleSolidAngle(toFirst, toSecond, toThird) {
  const firstLength = vectorLength(toFirst);
  const secondLength = vectorLength(toSecond);
  const thirdLength = vectorLength(toThird);
  if (
    !(firstLength > MINIMUM_VECTOR_LENGTH) ||
    !(secondLength > MINIMUM_VECTOR_LENGTH) ||
    !(thirdLength > MINIMUM_VECTOR_LENGTH)
  ) {
    return 0;
  }
  const numerator = Math.abs(dotProduct(toFirst, crossProduct(toSecond, toThird)));
  const denominator =
    firstLength * secondLength * thirdLength +
    dotProduct(toFirst, toSecond) * thirdLength +
    dotProduct(toFirst, toThird) * secondLength +
    dotProduct(toSecond, toThird) * firstLength;
  return 2 * Math.atan2(numerator, denominator);
}

export function rectangleSolidAngle(request) {
  const corners = rectangleCorners(request);
  const toCorners = corners.map((corner) => subtractVectors(corner, request.shadingPoint));
  return (
    triangleSolidAngle(toCorners[0], toCorners[1], toCorners[2]) +
    triangleSolidAngle(toCorners[0], toCorners[2], toCorners[3])
  );
}


export function sampleRectangle(request) {
  const u1 = clampToUnitRange(request.u1);
  const u2 = clampToUnitRange(request.u2);
  const halfWidth = Math.max(0, Number(request.halfWidth) || 0);
  const halfHeight = Math.max(0, Number(request.halfHeight) || 0);

  const offsetAlongWidth = scaleVector(request.rightAxis, (2 * u1 - 1) * halfWidth);
  const offsetAlongHeight = scaleVector(request.upAxis, (2 * u2 - 1) * halfHeight);
  const position = addVectors(addVectors(request.center, offsetAlongWidth), offsetAlongHeight);
  const normal = rectangleNormal(request.rightAxis, request.upAxis);

  const shadingPointToSample = subtractVectors(position, request.shadingPoint);
  const distanceToSample = vectorLength(shadingPointToSample);
  const direction = normalizeVector(shadingPointToSample);
  const cosineAtLight = -dotProduct(normal, direction);
  const area = rectangleArea(halfWidth, halfHeight);
  const pdfArea = area > 0 ? 1 / area : 0;

  return {
    position: position,
    normal: normal,
    direction: direction,
    distanceToSample: distanceToSample,
    cosineAtLight: cosineAtLight,
    pdfArea: pdfArea,
    pdfSolidAngle: areaPdfToSolidAnglePdf(pdfArea, distanceToSample, cosineAtLight),
    area: area,
  };
}
