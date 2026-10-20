import { MGL_TRACE_TILE_CLASS, MGL_TRACE_TILE_SIZE } from "./mlPipelineContract.js";


export const TRACE_TILE_TRACER = Object.freeze({
  screen: "screen",
  virtualShadowMap: "virtualShadowMap",
  rayTrace: "rayTrace",
});


export const TRACE_STAGE_ORDER = Object.freeze([
  TRACE_TILE_TRACER.screen,
  TRACE_TILE_TRACER.virtualShadowMap,
  TRACE_TILE_TRACER.rayTrace,
]);


export const TRACE_TILE_CLASS_INDEX = Object.freeze({
  empty: 0,
  screenOnly: 1,
  virtualShadowMap: 2,
  rayTrace: 3,
  mixed: 4,
});

const TRACE_TILE_CLASS_NAME_BY_INDEX = Object.freeze([
  MGL_TRACE_TILE_CLASS.empty,
  MGL_TRACE_TILE_CLASS.screenOnly,
  MGL_TRACE_TILE_CLASS.virtualShadowMap,
  MGL_TRACE_TILE_CLASS.rayTrace,
  MGL_TRACE_TILE_CLASS.mixed,
]);

const CLASS_OF_SINGLE_TRACER = Object.freeze({
  screen: MGL_TRACE_TILE_CLASS.screenOnly,
  virtualShadowMap: MGL_TRACE_TILE_CLASS.virtualShadowMap,
  rayTrace: MGL_TRACE_TILE_CLASS.rayTrace,
});

export function isKnownTracer(tracer) {
  return typeof tracer === "string" && Object.prototype.hasOwnProperty.call(TRACE_TILE_TRACER, tracer);
}

export function traceTileClassIndexOf(tileClass) {
  const classIndex = TRACE_TILE_CLASS_INDEX[tileClass];
  return Number.isInteger(classIndex) ? classIndex : TRACE_TILE_CLASS_INDEX.empty;
}

export function traceTileClassFromIndex(classIndex) {
  return TRACE_TILE_CLASS_NAME_BY_INDEX[classIndex] || MGL_TRACE_TILE_CLASS.empty;
}


export function traceTileGridFor(renderResolution, tileSize) {
  const edge = Math.max(1, Math.floor(Number(tileSize) || MGL_TRACE_TILE_SIZE));
  const width = Math.max(0, Math.floor(Number(renderResolution && renderResolution.width) || 0));
  const height = Math.max(0, Math.floor(Number(renderResolution && renderResolution.height) || 0));
  const tileCountX = Math.ceil(width / edge);
  const tileCountY = Math.ceil(height / edge);
  return Object.freeze({
    tileSize: edge,
    width,
    height,
    tileCountX,
    tileCountY,
    tileCount: tileCountX * tileCountY,
  });
}


export function traceTileIndexOfPixel(pixelX, pixelY, grid) {
  if (!grid || !grid.tileCount) return -1;
  const x = Math.floor(Number(pixelX));
  const y = Math.floor(Number(pixelY));
  if (!Number.isFinite(x) || !Number.isFinite(y)) return -1;
  if (x < 0 || y < 0 || x >= grid.width || y >= grid.height) return -1;
  return Math.floor(y / grid.tileSize) * grid.tileCountX + Math.floor(x / grid.tileSize);
}


export function requiredTracersFromCounts(sampleCountByTracer) {
  const counts = sampleCountByTracer || {};
  return TRACE_STAGE_ORDER.filter((tracer) => Number(counts[tracer]) > 0);
}


export function classifyTracerCounts(sampleCountByTracer) {
  const tracers = requiredTracersFromCounts(sampleCountByTracer);
  if (tracers.length === 0) return MGL_TRACE_TILE_CLASS.empty;
  if (tracers.length === 1) return CLASS_OF_SINGLE_TRACER[tracers[0]];
  return MGL_TRACE_TILE_CLASS.mixed;
}


export function createTraceTileClassifier(traceTileGrid) {
  if (!traceTileGrid || !Number.isFinite(traceTileGrid.tileCount)) {
    throw new Error("createTraceTileClassifier: needs the grid returned by traceTileGridFor");
  }

  const grid = traceTileGrid;
  const tileCount = grid.tileCount;
  const sampleCountByTracer = {
    screen: new Int32Array(tileCount),
    virtualShadowMap: new Int32Array(tileCount),
    rayTrace: new Int32Array(tileCount),
  };
  const sampleCountTotal = new Int32Array(tileCount);
  const requestStatistics = {
    requestCount: 0,
    acceptedRequestCount: 0,
    refusedOutsideGridCount: 0,
    refusedUnknownTracerCount: 0,
  };


  const scratchCounts = { screen: 0, virtualShadowMap: 0, rayTrace: 0 };

  function countsIntoScratch(tileIndex) {
    scratchCounts.screen = sampleCountByTracer.screen[tileIndex];
    scratchCounts.virtualShadowMap = sampleCountByTracer.virtualShadowMap[tileIndex];
    scratchCounts.rayTrace = sampleCountByTracer.rayTrace[tileIndex];
    return scratchCounts;
  }


  function addRequest(request) {
    requestStatistics.requestCount++;
    const tracer = request && request.tracer;
    if (!isKnownTracer(tracer)) {
      requestStatistics.refusedUnknownTracerCount++;
      return false;
    }
    const tileIndex = traceTileIndexOfPixel(request.pixelX, request.pixelY, grid);
    if (tileIndex < 0) {
      requestStatistics.refusedOutsideGridCount++;
      return false;
    }
    sampleCountByTracer[tracer][tileIndex]++;
    sampleCountTotal[tileIndex]++;
    requestStatistics.acceptedRequestCount++;
    return true;
  }

  function addRequests(requests) {
    const list = Array.isArray(requests) ? requests : [];
    let acceptedCount = 0;
    for (let index = 0; index < list.length; index++) {
      if (addRequest(list[index])) acceptedCount++;
    }
    return acceptedCount;
  }

  function tileClassAt(tileIndex) {
    return classifyTracerCounts(countsIntoScratch(tileIndex));
  }


  function tileRecordAt(tileIndex) {
    if (!Number.isInteger(tileIndex) || tileIndex < 0 || tileIndex >= tileCount) return null;
    const counts = {
      screen: sampleCountByTracer.screen[tileIndex],
      virtualShadowMap: sampleCountByTracer.virtualShadowMap[tileIndex],
      rayTrace: sampleCountByTracer.rayTrace[tileIndex],
    };
    const tileClass = classifyTracerCounts(counts);
    return {
      tileIndex,
      tileX: tileIndex % grid.tileCountX,
      tileY: Math.floor(tileIndex / grid.tileCountX),
      tileClass,
      tileClassIndex: traceTileClassIndexOf(tileClass),
      sampleCount: sampleCountTotal[tileIndex],
      sampleCountByTracer: counts,
      requiredTracers: requiredTracersFromCounts(counts),
    };
  }

  function classify() {
    const tileClassIndex = new Int32Array(tileCount);
    const statistics = Object.assign({}, requestStatistics, {
      tileCount,
      emptyTileCount: 0,
      screenOnlyTileCount: 0,
      virtualShadowMapTileCount: 0,
      rayTraceTileCount: 0,
      mixedTileCount: 0,
      occupiedTileCount: 0,
      emptyTileRatio: 0,
    });

    for (let tileIndex = 0; tileIndex < tileCount; tileIndex++) {
      const tileClass = tileClassAt(tileIndex);
      tileClassIndex[tileIndex] = traceTileClassIndexOf(tileClass);
      if (tileClass === MGL_TRACE_TILE_CLASS.empty) statistics.emptyTileCount++;
      else if (tileClass === MGL_TRACE_TILE_CLASS.screenOnly) statistics.screenOnlyTileCount++;
      else if (tileClass === MGL_TRACE_TILE_CLASS.virtualShadowMap) statistics.virtualShadowMapTileCount++;
      else if (tileClass === MGL_TRACE_TILE_CLASS.rayTrace) statistics.rayTraceTileCount++;
      else statistics.mixedTileCount++;
    }

    statistics.occupiedTileCount = tileCount - statistics.emptyTileCount;
    statistics.emptyTileRatio = tileCount > 0 ? statistics.emptyTileCount / tileCount : 0;

    return { grid, tileClassIndex, sampleCountTotal, sampleCountByTracer, statistics };
  }

  function reset() {
    sampleCountByTracer.screen.fill(0);
    sampleCountByTracer.virtualShadowMap.fill(0);
    sampleCountByTracer.rayTrace.fill(0);
    sampleCountTotal.fill(0);
    requestStatistics.requestCount = 0;
    requestStatistics.acceptedRequestCount = 0;
    requestStatistics.refusedOutsideGridCount = 0;
    requestStatistics.refusedUnknownTracerCount = 0;
  }

  return { grid, addRequest, addRequests, classify, tileRecordAt, reset };
}
