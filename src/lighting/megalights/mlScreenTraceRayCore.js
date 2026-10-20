const MINIMUM_VIEW_DEPTH = 1e-6;


export function projectViewPositionToScreen(
  viewPosition,
  projectionMatrixElements,
  screenWidth,
  screenHeight,
) {
  const matrix = projectionMatrixElements;
  const x = Number(viewPosition[0]) || 0;
  const y = Number(viewPosition[1]) || 0;
  const z = Number(viewPosition[2]) || 0;

  const clipX = matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12];
  const clipY = matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13];
  const clipW = matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15];


  if (!(clipW > MINIMUM_VIEW_DEPTH)) {
    return { x: 0, y: 0, viewDepth: 0, inFrontOfCamera: false };
  }

  return {
    x: (clipX / clipW * 0.5 + 0.5) * screenWidth,
    y: (clipY / clipW * 0.5 + 0.5) * screenHeight,

    viewDepth: -z,
    inFrontOfCamera: true,
  };
}


export function viewDepthAtFraction(startViewDepth, endViewDepth, fraction) {
  const start = Math.max(MINIMUM_VIEW_DEPTH, Number(startViewDepth) || 0);
  const end = Math.max(MINIMUM_VIEW_DEPTH, Number(endViewDepth) || 0);
  const clampedFraction = Math.min(1, Math.max(0, Number(fraction) || 0));
  const reciprocal = (1 - clampedFraction) / start + clampedFraction / end;
  return reciprocal > 0 ? 1 / reciprocal : end;
}


export function clipSegmentToScreenRectangle(startX, startY, endX, endY, screenWidth, screenHeight) {
  const deltaX = endX - startX;
  const deltaY = endY - startY;
  let entryFraction = 0;
  let exitFraction = 1;

  const boundaries = [
    { direction: -deltaX, distance: startX - 0 },
    { direction: deltaX, distance: screenWidth - startX },
    { direction: -deltaY, distance: startY - 0 },
    { direction: deltaY, distance: screenHeight - startY },
  ];

  for (let index = 0; index !== boundaries.length; index++) {
    const direction = boundaries[index].direction;
    const distance = boundaries[index].distance;
    if (direction === 0) {

      if (distance < 0) return { inside: false, entryFraction: 0, exitFraction: 0, farEndWasCut: true };
      continue;
    }
    const fraction = distance / direction;
    if (direction < 0) {
      if (fraction > exitFraction) return { inside: false, entryFraction: 0, exitFraction: 0, farEndWasCut: true };
      if (fraction > entryFraction) entryFraction = fraction;
    } else {
      if (fraction < entryFraction) return { inside: false, entryFraction: 0, exitFraction: 0, farEndWasCut: true };
      if (fraction < exitFraction) exitFraction = fraction;
    }
  }

  return {
    inside: true,
    entryFraction,
    exitFraction,
    farEndWasCut: exitFraction < 1,
  };
}

function buildInvalidRay(reason) {
  return {
    valid: false,
    reason,
    startX: 0,
    startY: 0,
    startViewDepth: 0,
    endX: 0,
    endY: 0,
    endViewDepth: 0,
    lengthInTexels: 0,
    leavesScreen: true,
  };
}


export function buildScreenSpaceRayFromScreenPoints(request) {
  const start = request.start || {};
  const end = request.end || {};
  const screenWidth = Math.max(1, Math.floor(request.screenWidth) || 1);
  const screenHeight = Math.max(1, Math.floor(request.screenHeight) || 1);

  const clip = clipSegmentToScreenRectangle(start.x, start.y, end.x, end.y, screenWidth, screenHeight);
  if (!clip.inside) return buildInvalidRay("the segment does not cross the screen rectangle");

  const deltaX = end.x - start.x;
  const deltaY = end.y - start.y;
  const clippedStartX = start.x + deltaX * clip.entryFraction;
  const clippedStartY = start.y + deltaY * clip.entryFraction;
  const clippedEndX = start.x + deltaX * clip.exitFraction;
  const clippedEndY = start.y + deltaY * clip.exitFraction;

  return {
    valid: true,
    reason: "",
    startX: clippedStartX,
    startY: clippedStartY,
    startViewDepth: viewDepthAtFraction(start.viewDepth, end.viewDepth, clip.entryFraction),
    endX: clippedEndX,
    endY: clippedEndY,
    endViewDepth: viewDepthAtFraction(start.viewDepth, end.viewDepth, clip.exitFraction),
    lengthInTexels: Math.sqrt(
      (clippedEndX - clippedStartX) * (clippedEndX - clippedStartX) +
        (clippedEndY - clippedStartY) * (clippedEndY - clippedStartY),
    ),

    leavesScreen: clip.farEndWasCut,
  };
}


export function buildScreenSpaceRayFromViewPositions(request) {
  const projection = request.projectionMatrixElements;
  const screenWidth = request.screenWidth;
  const screenHeight = request.screenHeight;

  const start = projectViewPositionToScreen(request.viewOrigin, projection, screenWidth, screenHeight);
  const end = projectViewPositionToScreen(request.viewTarget, projection, screenWidth, screenHeight);
  if (!start.inFrontOfCamera || !end.inFrontOfCamera) {
    return buildInvalidRay("the ray starts or ends at or behind the camera plane");
  }

  return buildScreenSpaceRayFromScreenPoints({ start, end, screenWidth, screenHeight });
}
