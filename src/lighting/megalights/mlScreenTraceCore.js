import { readHierarchicalDepthTexel } from "./mlHzbCore.js";
import { viewDepthAtFraction } from "./mlScreenTraceRayCore.js";
import {
  SCREEN_TRACE_EXIT_REASON,
  normalizeScreenTraceSettings,
  resultForExitReason,
} from "./mlScreenTraceContract.js";


const BOUNDARY_CROSSING_EPSILON = 1e-5;
const MINIMUM_SEGMENT_LENGTH_IN_TEXELS = 1e-3;

function buildTraceOutcome(exitReason, stepCount, extras) {
  return Object.assign(
    {
      result: resultForExitReason(exitReason),
      exitReason,
      stepCount,
      travelledFraction: 0,
      hitTexelX: -1,
      hitTexelY: -1,
      hitViewDepth: 0,
      deepestLevelReached: 0,
      descentCount: 0,
    },
    extras || {},
  );
}


export function fractionToNextCellBoundary(positionX, positionY, deltaX, deltaY, cellSize) {
  const cellMinimumX = Math.floor(positionX / cellSize) * cellSize;
  const cellMinimumY = Math.floor(positionY / cellSize) * cellSize;

  let fractionX = Number.POSITIVE_INFINITY;
  if (deltaX > 0) fractionX = (cellMinimumX + cellSize - positionX) / deltaX;
  else if (deltaX < 0) fractionX = (cellMinimumX - positionX) / deltaX;

  let fractionY = Number.POSITIVE_INFINITY;
  if (deltaY > 0) fractionY = (cellMinimumY + cellSize - positionY) / deltaY;
  else if (deltaY < 0) fractionY = (cellMinimumY - positionY) / deltaY;

  return Math.min(fractionX, fractionY);
}


export function traceScreenSpaceRay(request) {
  const levels = request && request.pyramidLevels;
  const ray = request && request.ray;
  const settings = normalizeScreenTraceSettings(request && request.settings);


  if (!levels || levels.length === 0) {
    return buildTraceOutcome(SCREEN_TRACE_EXIT_REASON.noHierarchicalDepth, 0);
  }
  if (!ray || !ray.valid) {
    return buildTraceOutcome(SCREEN_TRACE_EXIT_REASON.rayBehindCamera, 0);
  }

  const deltaX = ray.endX - ray.startX;
  const deltaY = ray.endY - ray.startY;
  const segmentLengthInTexels = Math.sqrt(deltaX * deltaX + deltaY * deltaY);


  if (segmentLengthInTexels < MINIMUM_SEGMENT_LENGTH_IN_TEXELS) {
    return buildTraceOutcome(SCREEN_TRACE_EXIT_REASON.degenerateScreenSegment, 0);
  }

  const highestLevel = Math.min(settings.maximumLevel, levels.length - 1);
  const thickness = settings.thicknessInViewDepth;
  const bias = settings.depthBiasInViewDepth;


  const startOffsetFraction = Math.min(
    0.5,
    (settings.startOffsetInTexels + settings.jitter) / segmentLengthInTexels,
  );

  let travelledFraction = startOffsetFraction;
  let level = Math.min(settings.startLevel, highestLevel);
  let stepCount = 0;
  let descentCount = 0;
  let deepestLevelReached = level;

  while (stepCount < settings.maximumStepCount) {
    const cellSize = Math.pow(2, level);
    const positionX = ray.startX + deltaX * travelledFraction;
    const positionY = ray.startY + deltaY * travelledFraction;
    const texelX = Math.floor(positionX / cellSize);
    const texelY = Math.floor(positionY / cellSize);

    const cell = readHierarchicalDepthTexel(levels[level], texelX, texelY);
    stepCount++;

    if (!cell) {
      return buildTraceOutcome(SCREEN_TRACE_EXIT_REASON.leftScreen, stepCount, {
        travelledFraction,
        deepestLevelReached,
        descentCount,
      });
    }

    const fractionInsideCell = fractionToNextCellBoundary(positionX, positionY, deltaX, deltaY, cellSize);
    const cellExitFraction = Math.min(1, travelledFraction + fractionInsideCell);
    const depthAtEntry = viewDepthAtFraction(ray.startViewDepth, ray.endViewDepth, travelledFraction);
    const depthAtExit = viewDepthAtFraction(ray.startViewDepth, ray.endViewDepth, cellExitFraction);
    const nearestRayDepth = Math.min(depthAtEntry, depthAtExit) - bias;
    const deepestRayDepth = Math.max(depthAtEntry, depthAtExit) - bias;

    if (deepestRayDepth <= cell.minimum) {


      travelledFraction = cellExitFraction + BOUNDARY_CROSSING_EPSILON;
      if (travelledFraction >= 1) {


        const exitReason = ray.leavesScreen
          ? SCREEN_TRACE_EXIT_REASON.leftScreen
          : SCREEN_TRACE_EXIT_REASON.reachedRayEnd;
        return buildTraceOutcome(exitReason, stepCount, {
          travelledFraction: 1,
          deepestLevelReached,
          descentCount,
        });
      }
      level = Math.min(level + 1, highestLevel);
      continue;
    }

    if (level > 0) {


      level--;
      descentCount++;
      deepestLevelReached = Math.max(deepestLevelReached, level);
      continue;
    }


    const surfaceEntry = cell.minimum;
    const surfaceExit = cell.maximum + thickness;
    if (nearestRayDepth >= surfaceExit) {


      return buildTraceOutcome(SCREEN_TRACE_EXIT_REASON.behindSurfaceBeyondThickness, stepCount, {
        travelledFraction,
        deepestLevelReached,
        descentCount,
      });
    }

    return buildTraceOutcome(SCREEN_TRACE_EXIT_REASON.hitConfirmed, stepCount, {
      travelledFraction,
      hitTexelX: texelX,
      hitTexelY: texelY,
      hitViewDepth: surfaceEntry,
      deepestLevelReached,
      descentCount,
    });
  }


  return buildTraceOutcome(SCREEN_TRACE_EXIT_REASON.stepBudgetExhausted, stepCount, {
    travelledFraction,
    deepestLevelReached,
    descentCount,
  });
}
