import {
  WORLD_BOUNDS_STRIDE,
  boundsOverlapFlat,
  clipSegmentToBox,
  createSegmentRange,
  segmentIntersectsBoundsFlat,
} from "./worldBounds.js";

export const SPATIAL_GRID_LIMITS = Object.freeze({
  minimumCellSize: 4,
  maximumCellsPerAxis: 128,
  maximumCellsPerEntry: 64,
  maximumVisitedCells: 8192,
});


export const GRID_QUERY_REFUSED = -1;

export function createSpatialGrid() {
  return {
    isUsable: false,
    entryCount: 0,
    boundsFlat: [],
    cellSize: SPATIAL_GRID_LIMITS.minimumCellSize,
    cellsX: 1,
    cellsY: 1,
    cellsZ: 1,
    sceneMinX: 0,
    sceneMinY: 0,
    sceneMinZ: 0,
    sceneMaxX: 0,
    sceneMaxY: 0,
    sceneMaxZ: 0,
    entriesByCell: new Map(),
    oversizedEntries: [],
    lastVisitByEntry: [],
    visitCounter: 0,
  };
}

const sceneClipRange = createSegmentRange();

function compareEntryOrder(first, second) {
  return first - second;
}

function axisCellCount(sceneExtent, cellSize) {
  const count = Math.floor(sceneExtent / cellSize) + 1;
  return Math.max(1, Math.min(SPATIAL_GRID_LIMITS.maximumCellsPerAxis, count));
}

function cellIndexOnAxis(value, sceneMinimum, cellSize, cellCount) {
  const index = Math.floor((value - sceneMinimum) / cellSize);
  if (!Number.isFinite(index) || index < 0) return 0;
  if (index >= cellCount) return cellCount - 1;
  return index;
}

function cellKey(grid, cellX, cellY, cellZ) {
  return cellX + cellY * grid.cellsX + cellZ * grid.cellsX * grid.cellsY;
}

function insertEntry(grid, entry) {
  const flat = grid.boundsFlat;
  const offset = entry * WORLD_BOUNDS_STRIDE;
  const firstCellX = cellIndexOnAxis(flat[offset], grid.sceneMinX, grid.cellSize, grid.cellsX);
  const firstCellY = cellIndexOnAxis(flat[offset + 1], grid.sceneMinY, grid.cellSize, grid.cellsY);
  const firstCellZ = cellIndexOnAxis(flat[offset + 2], grid.sceneMinZ, grid.cellSize, grid.cellsZ);
  const lastCellX = cellIndexOnAxis(flat[offset + 3], grid.sceneMinX, grid.cellSize, grid.cellsX);
  const lastCellY = cellIndexOnAxis(flat[offset + 4], grid.sceneMinY, grid.cellSize, grid.cellsY);
  const lastCellZ = cellIndexOnAxis(flat[offset + 5], grid.sceneMinZ, grid.cellSize, grid.cellsZ);
  const spannedCells =
    (lastCellX - firstCellX + 1) * (lastCellY - firstCellY + 1) * (lastCellZ - firstCellZ + 1);
  if (spannedCells > SPATIAL_GRID_LIMITS.maximumCellsPerEntry) {


    grid.oversizedEntries.push(entry);
    return;
  }
  for (let cellZ = firstCellZ; cellZ <= lastCellZ; cellZ += 1) {
    for (let cellY = firstCellY; cellY <= lastCellY; cellY += 1) {
      for (let cellX = firstCellX; cellX <= lastCellX; cellX += 1) {
        const key = cellKey(grid, cellX, cellY, cellZ);
        const bucket = grid.entriesByCell.get(key);
        if (bucket) bucket.push(entry);
        else grid.entriesByCell.set(key, [entry]);
      }
    }
  }
}


export function buildSpatialGrid(grid, boundsFlat, entryCount) {
  grid.boundsFlat = boundsFlat;
  grid.entryCount = Math.max(0, Math.floor(entryCount) || 0);
  grid.entriesByCell.clear();
  grid.oversizedEntries.length = 0;
  grid.visitCounter = 0;
  grid.lastVisitByEntry.length = grid.entryCount;
  for (let entry = 0; entry < grid.entryCount; entry += 1) grid.lastVisitByEntry[entry] = 0;
  grid.cellsX = 1;
  grid.cellsY = 1;
  grid.cellsZ = 1;
  grid.sceneMinX = 0;
  grid.sceneMinY = 0;
  grid.sceneMinZ = 0;
  grid.sceneMaxX = 0;
  grid.sceneMaxY = 0;
  grid.sceneMaxZ = 0;
  grid.isUsable = true;
  if (grid.entryCount === 0) return grid;

  let sceneMinX = Infinity;
  let sceneMinY = Infinity;
  let sceneMinZ = Infinity;
  let sceneMaxX = -Infinity;
  let sceneMaxY = -Infinity;
  let sceneMaxZ = -Infinity;
  let extentSum = 0;
  for (let entry = 0; entry < grid.entryCount; entry += 1) {
    const offset = entry * WORLD_BOUNDS_STRIDE;
    const minX = boundsFlat[offset];
    const minY = boundsFlat[offset + 1];
    const minZ = boundsFlat[offset + 2];
    const maxX = boundsFlat[offset + 3];
    const maxY = boundsFlat[offset + 4];
    const maxZ = boundsFlat[offset + 5];
    if (minX < sceneMinX) sceneMinX = minX;
    if (minY < sceneMinY) sceneMinY = minY;
    if (minZ < sceneMinZ) sceneMinZ = minZ;
    if (maxX > sceneMaxX) sceneMaxX = maxX;
    if (maxY > sceneMaxY) sceneMaxY = maxY;
    if (maxZ > sceneMaxZ) sceneMaxZ = maxZ;
    extentSum += (maxX - minX) + (maxY - minY) + (maxZ - minZ);
  }
  const sceneExtentX = sceneMaxX - sceneMinX;
  const sceneExtentY = sceneMaxY - sceneMinY;
  const sceneExtentZ = sceneMaxZ - sceneMinZ;
  const boundsAreSane =
    Number.isFinite(sceneMinX) && Number.isFinite(sceneMinY) && Number.isFinite(sceneMinZ) &&
    Number.isFinite(sceneMaxX) && Number.isFinite(sceneMaxY) && Number.isFinite(sceneMaxZ) &&
    sceneExtentX >= 0 && sceneExtentY >= 0 && sceneExtentZ >= 0;
  if (!boundsAreSane) {

    grid.isUsable = false;
    return grid;
  }

  const averageEntryExtent = extentSum / (grid.entryCount * 3);
  const largestSceneExtent = Math.max(sceneExtentX, sceneExtentY, sceneExtentZ, 1);
  const cellSizeForAxisLimit = largestSceneExtent / SPATIAL_GRID_LIMITS.maximumCellsPerAxis;
  const cellSize = Math.max(
    SPATIAL_GRID_LIMITS.minimumCellSize,
    averageEntryExtent * 2,
    cellSizeForAxisLimit,
  );
  if (!Number.isFinite(cellSize) || cellSize <= 0) {
    grid.isUsable = false;
    return grid;
  }
  grid.cellSize = cellSize;
  grid.sceneMinX = sceneMinX;
  grid.sceneMinY = sceneMinY;
  grid.sceneMinZ = sceneMinZ;
  grid.sceneMaxX = sceneMaxX;
  grid.sceneMaxY = sceneMaxY;
  grid.sceneMaxZ = sceneMaxZ;
  grid.cellsX = axisCellCount(sceneExtentX, cellSize);
  grid.cellsY = axisCellCount(sceneExtentY, cellSize);
  grid.cellsZ = axisCellCount(sceneExtentZ, cellSize);
  for (let entry = 0; entry < grid.entryCount; entry += 1) insertEntry(grid, entry);
  return grid;
}

function collectSegmentEntries(
  grid, bucket, visitStamp,
  originX, originY, originZ,
  directionX, directionY, directionZ,
  maxDistance, outEntries,
) {
  if (!bucket) return;
  for (let index = 0; index < bucket.length; index += 1) {
    const entry = bucket[index];
    if (grid.lastVisitByEntry[entry] === visitStamp) continue;
    grid.lastVisitByEntry[entry] = visitStamp;
    const hit = segmentIntersectsBoundsFlat(
      grid.boundsFlat, entry * WORLD_BOUNDS_STRIDE,
      originX, originY, originZ,
      directionX, directionY, directionZ,
      maxDistance,
    );
    if (hit) outEntries.push(entry);
  }
}

function collectBoxEntries(grid, bucket, visitStamp, box, outEntries) {
  if (!bucket) return;
  for (let index = 0; index < bucket.length; index += 1) {
    const entry = bucket[index];
    if (grid.lastVisitByEntry[entry] === visitStamp) continue;
    grid.lastVisitByEntry[entry] = visitStamp;
    if (boundsOverlapFlat(grid.boundsFlat, entry * WORLD_BOUNDS_STRIDE, box)) {
      outEntries.push(entry);
    }
  }
}

function nextBoundaryDistance(startDistance, startValue, direction, boundaryValue) {
  const distance = startDistance + (boundaryValue - startValue) / direction;
  return distance > startDistance ? distance : startDistance;
}


export function queryGridSegment(
  grid,
  originX, originY, originZ,
  directionX, directionY, directionZ,
  maxDistance, outEntries,
) {
  outEntries.length = 0;
  if (!grid.isUsable) return GRID_QUERY_REFUSED;
  if (grid.entryCount === 0) return 0;
  const visitStamp = grid.visitCounter + 1;
  grid.visitCounter = visitStamp;
  collectSegmentEntries(
    grid, grid.oversizedEntries, visitStamp,
    originX, originY, originZ,
    directionX, directionY, directionZ,
    maxDistance, outEntries,
  );
  const reachesScene = clipSegmentToBox(
    sceneClipRange,
    grid.sceneMinX, grid.sceneMinY, grid.sceneMinZ,
    grid.sceneMaxX, grid.sceneMaxY, grid.sceneMaxZ,
    originX, originY, originZ,
    directionX, directionY, directionZ,
    maxDistance,
  );
  if (!reachesScene) {
    outEntries.sort(compareEntryOrder);
    return outEntries.length;
  }

  const entryDistance = Math.max(0, sceneClipRange.entry);
  const exitDistance = Math.min(maxDistance, sceneClipRange.exit);
  const startX = originX + directionX * entryDistance;
  const startY = originY + directionY * entryDistance;
  const startZ = originZ + directionZ * entryDistance;
  let cellX = cellIndexOnAxis(startX, grid.sceneMinX, grid.cellSize, grid.cellsX);
  let cellY = cellIndexOnAxis(startY, grid.sceneMinY, grid.cellSize, grid.cellsY);
  let cellZ = cellIndexOnAxis(startZ, grid.sceneMinZ, grid.cellSize, grid.cellsZ);
  const stepX = directionX > 0 ? 1 : (directionX < 0 ? -1 : 0);
  const stepY = directionY > 0 ? 1 : (directionY < 0 ? -1 : 0);
  const stepZ = directionZ > 0 ? 1 : (directionZ < 0 ? -1 : 0);
  const crossingDeltaX = stepX === 0 ? Infinity : grid.cellSize / Math.abs(directionX);
  const crossingDeltaY = stepY === 0 ? Infinity : grid.cellSize / Math.abs(directionY);
  const crossingDeltaZ = stepZ === 0 ? Infinity : grid.cellSize / Math.abs(directionZ);
  let nextCrossingX = stepX === 0 ? Infinity : nextBoundaryDistance(
    entryDistance, startX, directionX,
    grid.sceneMinX + (cellX + (stepX > 0 ? 1 : 0)) * grid.cellSize,
  );
  let nextCrossingY = stepY === 0 ? Infinity : nextBoundaryDistance(
    entryDistance, startY, directionY,
    grid.sceneMinY + (cellY + (stepY > 0 ? 1 : 0)) * grid.cellSize,
  );
  let nextCrossingZ = stepZ === 0 ? Infinity : nextBoundaryDistance(
    entryDistance, startZ, directionZ,
    grid.sceneMinZ + (cellZ + (stepZ > 0 ? 1 : 0)) * grid.cellSize,
  );

  let visitedCells = 0;
  for (;;) {
    collectSegmentEntries(
      grid, grid.entriesByCell.get(cellKey(grid, cellX, cellY, cellZ)), visitStamp,
      originX, originY, originZ,
      directionX, directionY, directionZ,
      maxDistance, outEntries,
    );
    visitedCells += 1;
    if (visitedCells >= SPATIAL_GRID_LIMITS.maximumVisitedCells) return GRID_QUERY_REFUSED;
    const nextCrossing = Math.min(nextCrossingX, nextCrossingY, nextCrossingZ);
    if (!(nextCrossing <= exitDistance)) break;
    if (nextCrossing === nextCrossingX) {
      cellX += stepX;
      if (cellX < 0 || cellX >= grid.cellsX) break;
      nextCrossingX += crossingDeltaX;
    } else if (nextCrossing === nextCrossingY) {
      cellY += stepY;
      if (cellY < 0 || cellY >= grid.cellsY) break;
      nextCrossingY += crossingDeltaY;
    } else {
      cellZ += stepZ;
      if (cellZ < 0 || cellZ >= grid.cellsZ) break;
      nextCrossingZ += crossingDeltaZ;
    }
  }
  outEntries.sort(compareEntryOrder);
  return outEntries.length;
}


export function queryGridBox(grid, box, outEntries) {
  outEntries.length = 0;
  if (!grid.isUsable) return GRID_QUERY_REFUSED;
  if (grid.entryCount === 0) return 0;
  const visitStamp = grid.visitCounter + 1;
  grid.visitCounter = visitStamp;
  collectBoxEntries(grid, grid.oversizedEntries, visitStamp, box, outEntries);
  const reachesScene =
    box.minX <= grid.sceneMaxX && box.maxX >= grid.sceneMinX &&
    box.minY <= grid.sceneMaxY && box.maxY >= grid.sceneMinY &&
    box.minZ <= grid.sceneMaxZ && box.maxZ >= grid.sceneMinZ;
  if (!reachesScene) {
    outEntries.sort(compareEntryOrder);
    return outEntries.length;
  }
  const firstCellX = cellIndexOnAxis(box.minX, grid.sceneMinX, grid.cellSize, grid.cellsX);
  const firstCellY = cellIndexOnAxis(box.minY, grid.sceneMinY, grid.cellSize, grid.cellsY);
  const firstCellZ = cellIndexOnAxis(box.minZ, grid.sceneMinZ, grid.cellSize, grid.cellsZ);
  const lastCellX = cellIndexOnAxis(box.maxX, grid.sceneMinX, grid.cellSize, grid.cellsX);
  const lastCellY = cellIndexOnAxis(box.maxY, grid.sceneMinY, grid.cellSize, grid.cellsY);
  const lastCellZ = cellIndexOnAxis(box.maxZ, grid.sceneMinZ, grid.cellSize, grid.cellsZ);
  const spannedCells =
    (lastCellX - firstCellX + 1) * (lastCellY - firstCellY + 1) * (lastCellZ - firstCellZ + 1);
  if (spannedCells > SPATIAL_GRID_LIMITS.maximumVisitedCells) return GRID_QUERY_REFUSED;
  for (let cellZ = firstCellZ; cellZ <= lastCellZ; cellZ += 1) {
    for (let cellY = firstCellY; cellY <= lastCellY; cellY += 1) {
      for (let cellX = firstCellX; cellX <= lastCellX; cellX += 1) {
        collectBoxEntries(
          grid, grid.entriesByCell.get(cellKey(grid, cellX, cellY, cellZ)),
          visitStamp, box, outEntries,
        );
      }
    }
  }
  outEntries.sort(compareEntryOrder);
  return outEntries.length;
}
