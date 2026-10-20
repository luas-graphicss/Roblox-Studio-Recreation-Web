import {
  LIGHT_GRID_TILE_COUNT_X,
  LIGHT_GRID_TILE_COUNT_Y,
} from "./mlLightGridCore.js";

export const CELL_VISIBILITY = Object.freeze({
  visible: "visible",
  occluded: "occluded",
  empty: "empty",
});


export function hierarchicalDepthLevelForTileGrid(levelSizes) {
  if (!Array.isArray(levelSizes) || levelSizes.length === 0) return -1;
  let chosenLevel = 0;
  for (let levelIndex = 0; levelIndex < levelSizes.length; levelIndex++) {
    const level = levelSizes[levelIndex];
    if (!level) break;
    if (level.width >= LIGHT_GRID_TILE_COUNT_X && level.height >= LIGHT_GRID_TILE_COUNT_Y) {
      chosenLevel = levelIndex;
    } else {
      break;
    }
  }
  return chosenLevel;
}


export function footprintForTile(tileX, tileY, levelWidth, levelHeight) {
  const width = Math.max(1, Math.floor(levelWidth) || 1);
  const height = Math.max(1, Math.floor(levelHeight) || 1);
  const startX = Math.floor((tileX * width) / LIGHT_GRID_TILE_COUNT_X);
  const startY = Math.floor((tileY * height) / LIGHT_GRID_TILE_COUNT_Y);
  const endX = Math.ceil(((tileX + 1) * width) / LIGHT_GRID_TILE_COUNT_X) - 1;
  const endY = Math.ceil(((tileY + 1) * height) / LIGHT_GRID_TILE_COUNT_Y) - 1;
  return {
    startX: Math.min(Math.max(startX, 0), width - 1),
    startY: Math.min(Math.max(startY, 0), height - 1),
    endX: Math.min(Math.max(endX, startX), width - 1),
    endY: Math.min(Math.max(endY, startY), height - 1),
  };
}


export function reduceFootprintDepth(level, footprint) {
  if (!level || !level.minimum || !level.maximum || !footprint) return null;
  let minimumDepth = Infinity;
  let maximumDepth = -Infinity;
  let texelCount = 0;

  for (let y = footprint.startY; y <= footprint.endY; y++) {
    for (let x = footprint.startX; x <= footprint.endX; x++) {
      const texelIndex = y * level.width + x;
      const minimumValue = Number(level.minimum[texelIndex]);
      const maximumValue = Number(level.maximum[texelIndex]);
      if (!Number.isFinite(minimumValue) || !Number.isFinite(maximumValue)) return null;
      if (minimumValue < minimumDepth) minimumDepth = minimumValue;
      if (maximumValue > maximumDepth) maximumDepth = maximumValue;
      texelCount++;
    }
  }

  if (texelCount === 0) return null;
  return { minimumDepth, maximumDepth, texelCount };
}


export function classifyCellVisibility(cellDepthRange, footprintDepth) {
  if (!cellDepthRange || !footprintDepth) return CELL_VISIBILITY.visible;
  const nearDepth = Number(cellDepthRange.nearDepth);
  const farDepth = Number(cellDepthRange.farDepth);
  if (!Number.isFinite(nearDepth) || !Number.isFinite(farDepth)) return CELL_VISIBILITY.visible;
  if (nearDepth > footprintDepth.maximumDepth) return CELL_VISIBILITY.occluded;
  if (farDepth < footprintDepth.minimumDepth) return CELL_VISIBILITY.empty;
  return CELL_VISIBILITY.visible;
}


export function createCellVisibilityTest(dependencies) {
  const settings = dependencies || {};
  const level = settings.level || null;
  const skipEmptyCells = !!settings.skipEmptyCells;

  const footprintCache = new Map();
  const statistics = {
    hierarchicalDepthAvailable: !!level,
    testedCellCount: 0,
    visibleCellCount: 0,
    occludedCellCount: 0,
    emptyCellCount: 0,
    skippedCellCount: 0,
    reducedTexelCount: 0,
  };

  function footprintDepthForTile(tileX, tileY) {
    if (!level) return null;
    const cacheKey = tileY * LIGHT_GRID_TILE_COUNT_X + tileX;
    if (footprintCache.has(cacheKey)) return footprintCache.get(cacheKey);
    const footprint = footprintForTile(tileX, tileY, level.width, level.height);
    const reduced = reduceFootprintDepth(level, footprint);
    if (reduced) statistics.reducedTexelCount += reduced.texelCount;
    footprintCache.set(cacheKey, reduced);
    return reduced;
  }

  return {
    statistics,

    classify(cell) {
      return classifyCellVisibility(cell.depthRange, footprintDepthForTile(cell.tileX, cell.tileY));
    },


    isCellVisible(cell) {
      const visibility = classifyCellVisibility(
        cell.depthRange,
        footprintDepthForTile(cell.tileX, cell.tileY),
      );
      statistics.testedCellCount++;
      if (visibility === CELL_VISIBILITY.occluded) {
        statistics.occludedCellCount++;
        statistics.skippedCellCount++;
        return false;
      }
      if (visibility === CELL_VISIBILITY.empty) {
        statistics.emptyCellCount++;
        if (skipEmptyCells) {
          statistics.skippedCellCount++;
          return false;
        }
      }
      statistics.visibleCellCount++;
      return true;
    },

    reset() {
      footprintCache.clear();
      statistics.testedCellCount = 0;
      statistics.visibleCellCount = 0;
      statistics.occludedCellCount = 0;
      statistics.emptyCellCount = 0;
      statistics.skippedCellCount = 0;
      statistics.reducedTexelCount = 0;
    },
  };
}
