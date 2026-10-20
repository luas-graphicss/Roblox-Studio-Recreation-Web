export const MAXIMUM_WALKED_TEXEL_COUNT = 4096;

const MINIMUM_SEGMENT_DELTA_IN_TEXELS = 1e-9;


function fractionFromOriginToFirstBoundary(origin, texel, delta) {
  if (delta > 0) return (texel + 1 - origin) / delta;
  if (delta < 0) return (texel - origin) / delta;
  return Infinity;
}


export function walkScreenSegmentTexels(request) {
  const deltaX = request.endX - request.startX;
  const deltaY = request.endY - request.startY;
  const isDegenerate =
    Math.abs(deltaX) < MINIMUM_SEGMENT_DELTA_IN_TEXELS &&
    Math.abs(deltaY) < MINIMUM_SEGMENT_DELTA_IN_TEXELS;
  if (isDegenerate) return [];

  const requestedFromFraction = Number(request.fromFraction);
  const fromFraction = Number.isFinite(requestedFromFraction)
    ? Math.min(1, Math.max(0, requestedFromFraction))
    : 0;
  const requestedMaximumTexelCount = Number(request.maximumTexelCount);
  const maximumTexelCount =
    Number.isFinite(requestedMaximumTexelCount) && requestedMaximumTexelCount > 0
      ? Math.floor(requestedMaximumTexelCount)
      : MAXIMUM_WALKED_TEXEL_COUNT;

  const originX = request.startX + deltaX * fromFraction;
  const originY = request.startY + deltaY * fromFraction;

  let texelX = Math.floor(originX);
  let texelY = Math.floor(originY);
  const stepX = deltaX > 0 ? 1 : deltaX < 0 ? -1 : 0;
  const stepY = deltaY > 0 ? 1 : deltaY < 0 ? -1 : 0;
  const fractionPerTexelX = deltaX !== 0 ? Math.abs(1 / deltaX) : Infinity;
  const fractionPerTexelY = deltaY !== 0 ? Math.abs(1 / deltaY) : Infinity;

  let nextBoundaryFractionX =
    fromFraction + fractionFromOriginToFirstBoundary(originX, texelX, deltaX);
  let nextBoundaryFractionY =
    fromFraction + fractionFromOriginToFirstBoundary(originY, texelY, deltaY);

  const visits = [];
  let entryFraction = fromFraction;


  while (visits.length !== maximumTexelCount) {
    const exitFraction = Math.min(1, nextBoundaryFractionX, nextBoundaryFractionY);
    visits.push({ texelX, texelY, entryFraction, exitFraction });
    if (exitFraction >= 1) break;

    entryFraction = exitFraction;
    if (nextBoundaryFractionX <= nextBoundaryFractionY) {
      texelX += stepX;
      nextBoundaryFractionX += fractionPerTexelX;
    } else {
      texelY += stepY;
      nextBoundaryFractionY += fractionPerTexelY;
    }
  }
  return visits;
}
