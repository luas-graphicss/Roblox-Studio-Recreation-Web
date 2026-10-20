export const MSM_PROXY_OCCLUSION_OWNER = "MSM-F19";


export const MSM_PROXY_BOX_CEILING = 8;


export const MSM_PROXY_FULL_VISIBILITY = 1;


export const MSM_PROXY_NO_VISIBILITY = 0;


export const MSM_PROXY_SURFACE_BIAS_STUDS = 0.5;


export const MSM_PROXY_INSIDE_BIAS_STUDS = 0.25;


export const MSM_PROXY_MINIMUM_SEGMENT_STUDS = 0.0001;


export const MSM_PROXY_MINIMUM_DIRECTION_COMPONENT = 0.000001;


export const MSM_PROXY_MIRROR_ARGUMENT_ORDER = Object.freeze({
  msmProxySafeReciprocal: Object.freeze(["directionComponent"]),
  msmProxyPointIsOutsideBox: Object.freeze(["point", "boxCenter", "boxHalfExtent"]),
  msmProxySlotOcclusion: Object.freeze([
    "boxCenter",
    "boxHalfExtent",
    "boxStrength",
    "segmentOrigin",
    "segmentTarget",
    "segmentDirection",
    "segmentLength",
  ]),
  msmProxyVisibility: Object.freeze(["surfaceWorldPosition", "lightWorldPosition", "proxyBoxes"]),
});


export const MSM_PROXY_JS_ONLY_ARGUMENT = "proxyBoxes";

function createZeroVector() {
  return [0, 0, 0];
}


export function createNeutralProxyBox() {
  return {
    center: createZeroVector(),
    halfExtent: createZeroVector(),
    strength: MSM_PROXY_NO_VISIBILITY,
  };
}


export const MSM_PROXY_NEUTRAL_BOX_SET = Object.freeze(
  Array.from({ length: MSM_PROXY_BOX_CEILING }, function freezeNeutralBox() {
    return Object.freeze({
      center: Object.freeze([0, 0, 0]),
      halfExtent: Object.freeze([0, 0, 0]),
      strength: MSM_PROXY_NO_VISIBILITY,
    });
  }),
);


export function resetProxyBoxToNeutral(box) {
  box.center[0] = 0;
  box.center[1] = 0;
  box.center[2] = 0;
  box.halfExtent[0] = 0;
  box.halfExtent[1] = 0;
  box.halfExtent[2] = 0;
  box.strength = MSM_PROXY_NO_VISIBILITY;
  return box;
}


export function writeProxyBox(box, center, halfExtent, strength) {
  box.center[0] = center[0];
  box.center[1] = center[1];
  box.center[2] = center[2];
  box.halfExtent[0] = Math.abs(halfExtent[0]);
  box.halfExtent[1] = Math.abs(halfExtent[1]);
  box.halfExtent[2] = Math.abs(halfExtent[2]);
  box.strength = strength;
  return box;
}


export function copyProxyBox(sourceBox, targetBox) {
  targetBox.center[0] = sourceBox.center[0];
  targetBox.center[1] = sourceBox.center[1];
  targetBox.center[2] = sourceBox.center[2];
  targetBox.halfExtent[0] = sourceBox.halfExtent[0];
  targetBox.halfExtent[1] = sourceBox.halfExtent[1];
  targetBox.halfExtent[2] = sourceBox.halfExtent[2];
  targetBox.strength = sourceBox.strength;
  return targetBox;
}


const operationCounter = {
  visibilityCalls: 0,
  slotEvaluations: 0,
  slabAxisTests: 0,
};


export function readMsmProxyOperationCounter() {
  return {
    visibilityCalls: operationCounter.visibilityCalls,
    slotEvaluations: operationCounter.slotEvaluations,
    slabAxisTests: operationCounter.slabAxisTests,
  };
}

export function resetMsmProxyOperationCounter() {
  operationCounter.visibilityCalls = 0;
  operationCounter.slotEvaluations = 0;
  operationCounter.slabAxisTests = 0;
}


function stepUnit(edge, value) {
  return value >= edge ? 1 : 0;
}

function clampUnitRange(value) {
  if (!Number.isFinite(value)) return MSM_PROXY_FULL_VISIBILITY;
  if (value > MSM_PROXY_FULL_VISIBILITY) return MSM_PROXY_FULL_VISIBILITY;
  if (MSM_PROXY_NO_VISIBILITY > value) return MSM_PROXY_NO_VISIBILITY;
  return value;
}


export function msmProxySafeReciprocal(directionComponent) {
  const directionSign = stepUnit(0, directionComponent) * 2 - 1;
  const safeMagnitude = Math.max(Math.abs(directionComponent), MSM_PROXY_MINIMUM_DIRECTION_COMPONENT);
  return 1 / (directionSign * safeMagnitude);
}


export function msmProxyPointIsOutsideBox(point, boxCenter, boxHalfExtent) {
  const insideX = stepUnit(Math.abs(point[0] - boxCenter[0]), boxHalfExtent[0] + MSM_PROXY_INSIDE_BIAS_STUDS);
  const insideY = stepUnit(Math.abs(point[1] - boxCenter[1]), boxHalfExtent[1] + MSM_PROXY_INSIDE_BIAS_STUDS);
  const insideZ = stepUnit(Math.abs(point[2] - boxCenter[2]), boxHalfExtent[2] + MSM_PROXY_INSIDE_BIAS_STUDS);
  return 1 - insideX * insideY * insideZ;
}


export function msmProxySlotOcclusion(
  boxCenter,
  boxHalfExtent,
  boxStrength,
  segmentOrigin,
  segmentTarget,
  segmentDirection,
  segmentLength,
) {
  const reciprocalX = msmProxySafeReciprocal(segmentDirection[0]);
  const reciprocalY = msmProxySafeReciprocal(segmentDirection[1]);
  const reciprocalZ = msmProxySafeReciprocal(segmentDirection[2]);

  const firstPlaneX = (boxCenter[0] - boxHalfExtent[0] - segmentOrigin[0]) * reciprocalX;
  const firstPlaneY = (boxCenter[1] - boxHalfExtent[1] - segmentOrigin[1]) * reciprocalY;
  const firstPlaneZ = (boxCenter[2] - boxHalfExtent[2] - segmentOrigin[2]) * reciprocalZ;
  const secondPlaneX = (boxCenter[0] + boxHalfExtent[0] - segmentOrigin[0]) * reciprocalX;
  const secondPlaneY = (boxCenter[1] + boxHalfExtent[1] - segmentOrigin[1]) * reciprocalY;
  const secondPlaneZ = (boxCenter[2] + boxHalfExtent[2] - segmentOrigin[2]) * reciprocalZ;

  const nearestHit = Math.max(
    Math.max(Math.min(firstPlaneX, secondPlaneX), Math.min(firstPlaneY, secondPlaneY)),
    Math.min(firstPlaneZ, secondPlaneZ),
  );
  const farthestHit = Math.min(
    Math.min(Math.max(firstPlaneX, secondPlaneX), Math.max(firstPlaneY, secondPlaneY)),
    Math.max(firstPlaneZ, secondPlaneZ),
  );

  const intervalExists = stepUnit(nearestHit, farthestHit);
  const endsAfterTheSurface = stepUnit(MSM_PROXY_SURFACE_BIAS_STUDS, farthestHit);
  const startsBeforeTheLight = stepUnit(nearestHit, segmentLength - MSM_PROXY_SURFACE_BIAS_STUDS);
  const surfaceIsOutside = msmProxyPointIsOutsideBox(segmentOrigin, boxCenter, boxHalfExtent);
  const lightIsOutside = msmProxyPointIsOutsideBox(segmentTarget, boxCenter, boxHalfExtent);

  operationCounter.slabAxisTests += 3;

  return (
    boxStrength *
    intervalExists *
    endsAfterTheSurface *
    startsBeforeTheLight *
    surfaceIsOutside *
    lightIsOutside
  );
}


const scratchSegmentDirection = [0, 0, 0];


export function msmProxyVisibility(surfaceWorldPosition, lightWorldPosition, proxyBoxes) {
  const boxes = Array.isArray(proxyBoxes) ? proxyBoxes : MSM_PROXY_NEUTRAL_BOX_SET;
  const segmentX = lightWorldPosition[0] - surfaceWorldPosition[0];
  const segmentY = lightWorldPosition[1] - surfaceWorldPosition[1];
  const segmentZ = lightWorldPosition[2] - surfaceWorldPosition[2];
  const segmentLength = Math.sqrt(segmentX * segmentX + segmentY * segmentY + segmentZ * segmentZ);
  const segmentIsReal = stepUnit(MSM_PROXY_MINIMUM_SEGMENT_STUDS, segmentLength);
  const safeLength = Math.max(segmentLength, MSM_PROXY_MINIMUM_SEGMENT_STUDS);

  scratchSegmentDirection[0] = segmentX / safeLength;
  scratchSegmentDirection[1] = segmentY / safeLength;
  scratchSegmentDirection[2] = segmentZ / safeLength;

  let transmittance = MSM_PROXY_FULL_VISIBILITY;
  for (let boxIndex = 0; MSM_PROXY_BOX_CEILING > boxIndex; boxIndex += 1) {
    const box = boxes[boxIndex] || MSM_PROXY_NEUTRAL_BOX_SET[boxIndex];
    const slotOcclusion = msmProxySlotOcclusion(
      box.center,
      box.halfExtent,
      box.strength,
      surfaceWorldPosition,
      lightWorldPosition,
      scratchSegmentDirection,
      segmentLength,
    );
    transmittance *= 1 - clampUnitRange(slotOcclusion * segmentIsReal);
    operationCounter.slotEvaluations += 1;
  }

  operationCounter.visibilityCalls += 1;
  return clampUnitRange(transmittance);
}
