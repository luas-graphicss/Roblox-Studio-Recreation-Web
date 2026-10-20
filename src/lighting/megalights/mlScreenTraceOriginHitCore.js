import { MGL_TRACE_RESULT } from "./mlPipelineContract.js";
import { traceScreenSpaceRay } from "./mlScreenTraceCore.js";

export const DEFAULT_ORIGIN_NEIGHBOURHOOD_IN_TEXELS = 1;
export const MAXIMUM_ORIGIN_HIT_COUNT = 0;

const MAXIMUM_EXAMPLES_KEPT = 12;

function readNeighbourhoodInTexels(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_ORIGIN_NEIGHBOURHOOD_IN_TEXELS;
  return Math.max(0, Math.floor(parsed));
}

function originTexelOfRay(ray) {
  return { x: Math.floor(ray.startX), y: Math.floor(ray.startY) };
}


export function isHitAtRayOrigin(ray, outcome, neighbourhoodInTexels) {
  if (!ray || !outcome) return false;
  if (outcome.result !== MGL_TRACE_RESULT.occluded) return false;

  const radius = readNeighbourhoodInTexels(neighbourhoodInTexels);
  const origin = originTexelOfRay(ray);
  const distanceX = Math.abs(outcome.hitTexelX - origin.x);
  const distanceY = Math.abs(outcome.hitTexelY - origin.y);
  return radius >= Math.max(distanceX, distanceY);
}


export function evaluateSelfIntersectionAtRayOrigin(request) {
  const pyramidLevels = request.pyramidLevels;
  const rays = request.rays || [];
  const settings = request.settings;
  const neighbourhoodInTexels = readNeighbourhoodInTexels(request.neighbourhoodInTexels);

  let occludedCount = 0;
  let originHitCount = 0;
  const examples = [];

  for (let rayIndex = 0; rayIndex !== rays.length; rayIndex++) {
    const ray = rays[rayIndex];
    const outcome = traceScreenSpaceRay({ pyramidLevels, ray, settings });
    if (outcome.result !== MGL_TRACE_RESULT.occluded) continue;
    occludedCount++;
    if (!isHitAtRayOrigin(ray, outcome, neighbourhoodInTexels)) continue;

    originHitCount++;
    if (MAXIMUM_EXAMPLES_KEPT > examples.length) {
      const origin = originTexelOfRay(ray);
      examples.push({
        rayIndex,
        originTexelX: origin.x,
        originTexelY: origin.y,
        hitTexelX: outcome.hitTexelX,
        hitTexelY: outcome.hitTexelY,
        stepCount: outcome.stepCount,
      });
    }
  }

  return {
    rayCount: rays.length,
    neighbourhoodInTexels,
    originHitCount,
    originHitRatio: rays.length > 0 ? originHitCount / rays.length : 0,
    occludedCount,


    occludedAwayFromOriginCount: occludedCount - originHitCount,
    examples,
  };
}


export function buildOriginHitGate(measurement) {
  const originHitCount = measurement ? measurement.originHitCount : -1;
  return {
    id: "zeroSelfIntersectionAtRayOrigin",
    measured: originHitCount,
    required: MAXIMUM_ORIGIN_HIT_COUNT,
    pass: originHitCount >= 0 && MAXIMUM_ORIGIN_HIT_COUNT >= originHitCount,
    note: "rays leaving a real surface must not report that surface as their occluder",
  };
}
