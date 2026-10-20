import { MGL_TRACE_TILE_SIZE } from "./mlPipelineContract.js";


export const TRACE_STENCIL_BIT = Object.freeze({
  screen: 1,
  virtualShadowMap: 2,
  rayTrace: 4,
});


export const DEFAULT_COMPACTED_LANE_ROW_WIDTH = 256;

export function stencilMaskForTracers(tracers) {
  const list = Array.isArray(tracers) ? tracers : [];
  let mask = 0;
  for (let index = 0; index < list.length; index++) {
    mask = mask | (TRACE_STENCIL_BIT[list[index]] || 0);
  }
  return mask;
}


export function stencilConfigurationFor(tracer) {
  const bit = TRACE_STENCIL_BIT[tracer] || 0;
  return Object.freeze({
    tracer: tracer || null,
    comparison: "equal",
    reference: bit,
    mask: bit,
    writeMask: 0,
  });
}

export function stencilSelects(stencilValue, stencilConfiguration) {
  if (!stencilConfiguration || !stencilConfiguration.mask) return false;
  const mask = stencilConfiguration.mask;
  return ((Number(stencilValue) || 0) & mask) === (stencilConfiguration.reference & mask);
}


export function lanesPerTileEdge(tileSize, downsampleFactor) {
  const edge = Math.max(1, Math.floor(Number(tileSize) || MGL_TRACE_TILE_SIZE));
  const factor = Math.max(1, Math.floor(Number(downsampleFactor) || 1));
  return Math.max(1, Math.floor(edge / factor));
}

export function laneRectFromTileRect(tileRect, lanesPerEdge) {
  const perEdge = Math.max(1, Math.floor(Number(lanesPerEdge) || 1));
  return {
    x: tileRect.tileX * perEdge,
    y: tileRect.tileY * perEdge,
    width: tileRect.tileWidth * perEdge,
    height: tileRect.tileHeight * perEdge,
  };
}

export function laneCountOfRect(rect) {
  return Math.max(0, Number(rect && rect.width) || 0) * Math.max(0, Number(rect && rect.height) || 0);
}


export function quadAlignedLaneCountOfRect(rect) {
  const width = Math.max(0, Number(rect && rect.width) || 0);
  const height = Math.max(0, Number(rect && rect.height) || 0);
  return Math.ceil(width / 2) * 2 * Math.ceil(height / 2) * 2;
}

function isAfterInRowMajorOrder(previousTile, tile) {
  if (tile.tileY > previousTile.tileY) return true;
  return tile.tileY === previousTile.tileY && tile.tileX > previousTile.tileX;
}


export function mergeTileRunsIntoRects(tiles) {
  const list = Array.isArray(tiles) ? tiles : [];
  const rects = [];
  let currentRect = null;
  let previousTile = null;
  let unsortedTileCount = 0;

  for (let index = 0; index < list.length; index++) {
    const tile = list[index];
    if (!tile) continue;
    if (previousTile && !isAfterInRowMajorOrder(previousTile, tile)) unsortedTileCount++;
    if (currentRect && tile.tileY === currentRect.tileY && tile.tileX === currentRect.tileX + currentRect.tileWidth) {
      currentRect.tileWidth++;
    } else {
      currentRect = { tileX: tile.tileX, tileY: tile.tileY, tileWidth: 1, tileHeight: 1 };
      rects.push(currentRect);
    }
    previousTile = tile;
  }

  return { rects, tileCount: list.length, unsortedTileCount };
}

export function tileNeedsTracer(tile, tracer) {
  if (!tile || !tracer) return false;
  if (Array.isArray(tile.requiredTracers)) return tile.requiredTracers.indexOf(tracer) >= 0;
  const counts = tile.sampleCountByTracer || {};
  return Number(counts[tracer]) > 0;
}

function neededLanesOf(tile, tracer, lanesPerEdge) {
  const counts = (tile && tile.sampleCountByTracer) || {};
  const requested = Math.max(0, Number(counts[tracer]) || 0);
  return Math.min(requested, lanesPerEdge * lanesPerEdge);
}


export function planTracerPass(input) {
  const settings = input || {};
  const tracer = settings.tracer;
  const tiles = Array.isArray(settings.tiles) ? settings.tiles : [];
  const perEdge = lanesPerTileEdge(settings.tileSize, settings.downsampleFactor);

  const selectedTiles = tiles.filter((tile) => tileNeedsTracer(tile, tracer));
  const merged = mergeTileRunsIntoRects(selectedTiles);
  const laneRects = merged.rects.map((rect) => laneRectFromTileRect(rect, perEdge));

  let rasterizedLaneCount = 0;
  let quadAlignedLaneCount = 0;
  for (let index = 0; index < laneRects.length; index++) {
    rasterizedLaneCount += laneCountOfRect(laneRects[index]);
    quadAlignedLaneCount += quadAlignedLaneCountOfRect(laneRects[index]);
  }

  let neededLaneCount = 0;
  for (let index = 0; index < selectedTiles.length; index++) {
    neededLaneCount += neededLanesOf(selectedTiles[index], tracer, perEdge);
  }

  return {
    tracer: tracer || null,
    stencil: stencilConfigurationFor(tracer),
    tileCount: selectedTiles.length,
    tileRects: merged.rects,
    laneRects,
    lanesPerTileEdge: perEdge,
    rasterizedLaneCount,
    quadAlignedLaneCount,
    neededLaneCount,
    unsortedTileCount: merged.unsortedTileCount,
    isCompacted: false,
  };
}


export function planCompactedLanePass(input) {
  const settings = input || {};
  const survivorLaneCount = Math.max(0, Math.floor(Number(settings.survivorLaneCount) || 0));
  const rowWidth = Math.max(1, Math.floor(Number(settings.rowWidth) || DEFAULT_COMPACTED_LANE_ROW_WIDTH));
  const fullRowCount = Math.floor(survivorLaneCount / rowWidth);
  const remainderLaneCount = survivorLaneCount % rowWidth;

  const laneRects = [];
  if (fullRowCount > 0) laneRects.push({ x: 0, y: 0, width: rowWidth, height: fullRowCount });
  if (remainderLaneCount > 0) laneRects.push({ x: 0, y: fullRowCount, width: remainderLaneCount, height: 1 });

  let rasterizedLaneCount = 0;
  let quadAlignedLaneCount = 0;
  for (let index = 0; index < laneRects.length; index++) {
    rasterizedLaneCount += laneCountOfRect(laneRects[index]);
    quadAlignedLaneCount += quadAlignedLaneCountOfRect(laneRects[index]);
  }

  return {
    tracer: settings.tracer || null,
    stencil: null,
    tileCount: 0,
    tileRects: [],
    laneRects,
    rowWidth,
    rasterizedLaneCount,
    quadAlignedLaneCount,
    neededLaneCount: survivorLaneCount,
    unsortedTileCount: 0,
    isCompacted: true,
  };
}
