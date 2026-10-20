export const DEFAULT_VOXEL_RESOLUTION = 12;
export const MIN_VOXEL_RESOLUTION = 1;
export const MAX_VOXEL_RESOLUTION = 64;

export const MIN_CELL_SIZE = 1e-3;

export const VOXEL_GRID_MARGIN = 0.5;
export const VOXEL_KEY_SEPARATOR = "|";

function clampResolution(resolution) {
  const asInteger = Math.floor(Number(resolution));
  if (!Number.isFinite(asInteger)) return DEFAULT_VOXEL_RESOLUTION;
  return Math.min(Math.max(asInteger, MIN_VOXEL_RESOLUTION), MAX_VOXEL_RESOLUTION);
}

function readBoundsVector(value) {
  if (!value) return [0, 0, 0];
  return [Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0];
}


export function createVoxelGrid(options) {
  const input = options || {};
  const resolution = clampResolution(input.resolution);
  const margin = Number.isFinite(Number(input.margin)) ? Math.max(Number(input.margin), 0) : VOXEL_GRID_MARGIN;
  const rawMin = readBoundsVector(input.bounds && input.bounds.min);
  const rawMax = readBoundsVector(input.bounds && input.bounds.max);
  const min = [];
  const max = [];
  const size = [];
  const cellSize = [];
  for (let axis = 0; axis !== 3; axis += 1) {
    const lower = Math.min(rawMin[axis], rawMax[axis]) - margin;
    const upper = Math.max(rawMin[axis], rawMax[axis]) + margin;
    const axisSize = Math.max(upper - lower, MIN_CELL_SIZE * resolution);
    min.push(lower);
    max.push(lower + axisSize);
    size.push(axisSize);
    cellSize.push(Math.max(axisSize / resolution, MIN_CELL_SIZE));
  }
  const diagonal = Math.sqrt(cellSize[0] * cellSize[0] + cellSize[1] * cellSize[1] + cellSize[2] * cellSize[2]);
  return Object.freeze({
    min: Object.freeze(min),
    max: Object.freeze(max),
    size: Object.freeze(size),
    cellSize: Object.freeze(cellSize),
    resolution: resolution,
    cellCount: resolution * resolution * resolution,
    cellDiagonal: diagonal,
  });
}


export function voxelCoordinatesAt(grid, position) {
  const coordinates = [0, 0, 0];
  for (let axis = 0; axis !== 3; axis += 1) {
    const offset = (Number(position[axis]) || 0) - grid.min[axis];
    const raw = Math.floor(offset / grid.cellSize[axis]);
    coordinates[axis] = Math.min(Math.max(raw, 0), grid.resolution - 1);
  }
  return coordinates;
}

export function voxelKeyOfCoordinates(coordinates) {
  return coordinates[0] + VOXEL_KEY_SEPARATOR + coordinates[1] + VOXEL_KEY_SEPARATOR + coordinates[2];
}

export function voxelKeyAt(grid, position) {
  return voxelKeyOfCoordinates(voxelCoordinatesAt(grid, position));
}

export function voxelCoordinatesFromKey(key) {
  const parts = String(key).split(VOXEL_KEY_SEPARATOR);
  return [Math.floor(Number(parts[0]) || 0), Math.floor(Number(parts[1]) || 0), Math.floor(Number(parts[2]) || 0)];
}

export function voxelCenterOfCoordinates(grid, coordinates) {
  return [
    grid.min[0] + (coordinates[0] + 0.5) * grid.cellSize[0],
    grid.min[1] + (coordinates[1] + 0.5) * grid.cellSize[1],
    grid.min[2] + (coordinates[2] + 0.5) * grid.cellSize[2],
  ];
}

export function voxelCenterOfKey(grid, key) {
  return voxelCenterOfCoordinates(grid, voxelCoordinatesFromKey(key));
}


export function voxelIndexOfCoordinates(grid, coordinates) {
  return coordinates[0] + coordinates[1] * grid.resolution + coordinates[2] * grid.resolution * grid.resolution;
}

export function voxelIndexAt(grid, position) {
  return voxelIndexOfCoordinates(grid, voxelCoordinatesAt(grid, position));
}


export function isInsideGrid(grid, position) {
  for (let axis = 0; axis !== 3; axis += 1) {
    const value = Number(position[axis]) || 0;
    if (value < grid.min[axis] || value > grid.max[axis]) return false;
  }
  return true;
}


export function boundsOfPoints(points) {
  const list = Array.isArray(points) ? points : [];
  if (list.length === 0) return { min: [0, 0, 0], max: [0, 0, 0], empty: true };
  const min = [Infinity, Infinity, Infinity];
  const max = [-Infinity, -Infinity, -Infinity];
  for (let index = 0; index !== list.length; index += 1) {
    const point = list[index];
    for (let axis = 0; axis !== 3; axis += 1) {
      const value = Number(point[axis]) || 0;
      if (value < min[axis]) min[axis] = value;
      if (value > max[axis]) max[axis] = value;
    }
  }
  return { min: min, max: max, empty: false };
}
