import { readHierarchicalDepthTexel } from "./mlHzbCore.js";
import { viewDepthAtFraction } from "./mlScreenTraceRayCore.js";
import {
  SCREEN_TRACE_EXIT_REASON,
  normalizeScreenTraceSettings,
  resultForExitReason,
} from "./mlScreenTraceContract.js";
import { walkScreenSegmentTexels } from "./mlScreenSegmentTexelWalkCore.js";

export const LITE_FIXED_STEP_COUNT = 16;
const MINIMUM_SEGMENT_LENGTH_IN_TEXELS = 1e-3;


const TEXEL_DECISION = Object.freeze({
  emptySpace: "emptySpace",
  behindSurface: "behindSurface",
  hit: "hit",
});


function decideAtTexel(texel, nearestRayDepth, deepestRayDepth, thickness) {
  if (deepestRayDepth <= texel.minimum) return TEXEL_DECISION.emptySpace;
  if (nearestRayDepth >= texel.maximum + thickness) return TEXEL_DECISION.behindSurface;
  return TEXEL_DECISION.hit;
}

function endOfRayExitReason(ray) {
  return ray.leavesScreen
    ? SCREEN_TRACE_EXIT_REASON.leftScreen
    : SCREEN_TRACE_EXIT_REASON.reachedRayEnd;
}

function buildOutcome(exitReason, stepCount, extras) {
  return Object.assign(
    {
      result: resultForExitReason(exitReason),
      exitReason,
      stepCount,
      travelledFraction: 0,
      hitTexelX: -1,
      hitTexelY: -1,
      hitViewDepth: 0,
    },
    extras || {},
  );
}


export function traceScreenSpaceRayLinearly(request) {
  const levels = request && request.pyramidLevels;
  const ray = request && request.ray;
  const settings = normalizeScreenTraceSettings(request && request.settings);

  if (!levels || levels.length === 0) {
    return buildOutcome(SCREEN_TRACE_EXIT_REASON.noHierarchicalDepth, 0);
  }
  if (!ray || !ray.valid) {
    return buildOutcome(SCREEN_TRACE_EXIT_REASON.rayBehindCamera, 0);
  }

  const deltaX = ray.endX - ray.startX;
  const deltaY = ray.endY - ray.startY;
  const segmentLengthInTexels = Math.sqrt(deltaX * deltaX + deltaY * deltaY);
  if (segmentLengthInTexels < MINIMUM_SEGMENT_LENGTH_IN_TEXELS) {
    return buildOutcome(SCREEN_TRACE_EXIT_REASON.degenerateScreenSegment, 0);
  }

  const level0 = levels[0];
  const startOffsetFraction = Math.min(
    0.5,
    (settings.startOffsetInTexels + settings.jitter) / segmentLengthInTexels,
  );
  const requestedSampleCount = Number(request && request.fixedSampleCount);
  const isTheLiteRole = Number.isFinite(requestedSampleCount) && requestedSampleCount > 0;


  if (isTheLiteRole) {
    return traceByFixedPointSamples({
      ray,
      level0,
      settings,
      startOffsetFraction,
      deltaX,
      deltaY,
      sampleCount: Math.floor(requestedSampleCount),
    });
  }
  return traceByWalkingEveryCrossedTexel({ ray, level0, settings, startOffsetFraction });
}


function traceByWalkingEveryCrossedTexel(request) {
  const ray = request.ray;
  const level0 = request.level0;
  const thickness = request.settings.thicknessInViewDepth;
  const bias = request.settings.depthBiasInViewDepth;

  const visits = walkScreenSegmentTexels({
    startX: ray.startX,
    startY: ray.startY,
    endX: ray.endX,
    endY: ray.endY,
    fromFraction: request.startOffsetFraction,
  });

  let stepCount = 0;
  for (let visitIndex = 0; visitIndex !== visits.length; visitIndex++) {
    const visit = visits[visitIndex];
    const texel = readHierarchicalDepthTexel(level0, visit.texelX, visit.texelY);
    stepCount++;
    if (!texel) {
      return buildOutcome(SCREEN_TRACE_EXIT_REASON.leftScreen, stepCount, {
        travelledFraction: visit.entryFraction,
      });
    }

    const depthAtEntry = viewDepthAtFraction(ray.startViewDepth, ray.endViewDepth, visit.entryFraction);
    const depthAtExit = viewDepthAtFraction(ray.startViewDepth, ray.endViewDepth, visit.exitFraction);
    const decision = decideAtTexel(
      texel,
      Math.min(depthAtEntry, depthAtExit) - bias,
      Math.max(depthAtEntry, depthAtExit) - bias,
      thickness,
    );
    if (decision === TEXEL_DECISION.emptySpace) continue;
    if (decision === TEXEL_DECISION.behindSurface) {
      return buildOutcome(SCREEN_TRACE_EXIT_REASON.behindSurfaceBeyondThickness, stepCount, {
        travelledFraction: visit.entryFraction,
      });
    }
    return buildOutcome(SCREEN_TRACE_EXIT_REASON.hitConfirmed, stepCount, {
      travelledFraction: visit.entryFraction,
      hitTexelX: visit.texelX,
      hitTexelY: visit.texelY,
      hitViewDepth: texel.minimum,
    });
  }

  return buildOutcome(endOfRayExitReason(ray), stepCount, { travelledFraction: 1 });
}


function traceByFixedPointSamples(request) {
  const ray = request.ray;
  const level0 = request.level0;
  const thickness = request.settings.thicknessInViewDepth;
  const bias = request.settings.depthBiasInViewDepth;
  const startOffsetFraction = request.startOffsetFraction;
  const sampleCount = request.sampleCount;

  let stepCount = 0;
  for (let sampleIndex = 1; sampleIndex <= sampleCount; sampleIndex++) {
    const travelledFraction =
      startOffsetFraction + (sampleIndex / sampleCount) * (1 - startOffsetFraction);
    const positionX = ray.startX + request.deltaX * travelledFraction;
    const positionY = ray.startY + request.deltaY * travelledFraction;
    const texelX = Math.floor(positionX);
    const texelY = Math.floor(positionY);
    const texel = readHierarchicalDepthTexel(level0, texelX, texelY);
    stepCount++;
    if (!texel) {
      return buildOutcome(SCREEN_TRACE_EXIT_REASON.leftScreen, stepCount, { travelledFraction });
    }

    const rayDepth = viewDepthAtFraction(ray.startViewDepth, ray.endViewDepth, travelledFraction) - bias;
    const decision = decideAtTexel(texel, rayDepth, rayDepth, thickness);
    if (decision === TEXEL_DECISION.emptySpace) continue;
    if (decision === TEXEL_DECISION.behindSurface) {
      return buildOutcome(SCREEN_TRACE_EXIT_REASON.behindSurfaceBeyondThickness, stepCount, {
        travelledFraction,
      });
    }
    return buildOutcome(SCREEN_TRACE_EXIT_REASON.hitConfirmed, stepCount, {
      travelledFraction,
      hitTexelX: texelX,
      hitTexelY: texelY,
      hitViewDepth: texel.minimum,
    });
  }

  return buildOutcome(endOfRayExitReason(ray), stepCount, { travelledFraction: 1 });
}
