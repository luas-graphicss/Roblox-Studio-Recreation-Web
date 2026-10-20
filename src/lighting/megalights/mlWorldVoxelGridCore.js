export const WORLD_VOXEL_GRID_DEFAULTS = Object.freeze({


  voxelSizeInMeters: 2,
  voxelsAcross: 16,
  voxelsUp: 8,
  voxelsDeep: 16,
  maxVoxelCount: 4096,
});

function positiveNumberOr(value, fallback) {
  const candidate = Number(value);
  return Number.isFinite(candidate) && candidate > 0 ? candidate : fallback;
}

function positiveIntegerOr(value, fallback) {
  const candidate = Number(value);
  return Number.isFinite(candidate) && candidate >= 1 ? Math.floor(candidate) : fallback;
}

function worldPositionOf(value) {
  const position = value || {};
  return {
    x: Number.isFinite(Number(position.x)) ? Number(position.x) : 0,
    y: Number.isFinite(Number(position.y)) ? Number(position.y) : 0,
    z: Number.isFinite(Number(position.z)) ? Number(position.z) : 0,
  };
}


export function resolveWorldVoxelGrid(request) {
  const options = request || {};
  const voxelSizeInMeters = positiveNumberOr(
    options.voxelSizeInMeters,
    WORLD_VOXEL_GRID_DEFAULTS.voxelSizeInMeters,
  );
  const voxelsAcross = positiveIntegerOr(options.voxelsAcross, WORLD_VOXEL_GRID_DEFAULTS.voxelsAcross);
  const voxelsDeep = positiveIntegerOr(options.voxelsDeep, WORLD_VOXEL_GRID_DEFAULTS.voxelsDeep);
  const requestedVoxelsUp = positiveIntegerOr(options.voxelsUp, WORLD_VOXEL_GRID_DEFAULTS.voxelsUp);
  const maxVoxelCount = positiveIntegerOr(options.maxVoxelCount, WORLD_VOXEL_GRID_DEFAULTS.maxVoxelCount);

  const affordableVoxelsUp = Math.max(1, Math.floor(maxVoxelCount / (voxelsAcross * voxelsDeep)));
  const voxelsUp = Math.min(requestedVoxelsUp, affordableVoxelsUp);

  const centre = worldPositionOf(options.centredOnWorldPosition);


  const originVoxelX = Math.floor(centre.x / voxelSizeInMeters) - Math.floor(voxelsAcross / 2);
  const originVoxelY = Math.floor(centre.y / voxelSizeInMeters) - Math.floor(voxelsUp / 2);
  const originVoxelZ = Math.floor(centre.z / voxelSizeInMeters) - Math.floor(voxelsDeep / 2);

  return Object.freeze({
    voxelSizeInMeters,
    voxelsAcross,
    voxelsUp,
    voxelsDeep,
    voxelCount: voxelsAcross * voxelsUp * voxelsDeep,
    anchoredTo: "world",
    originVoxel: Object.freeze({ x: originVoxelX, y: originVoxelY, z: originVoxelZ }),
    originInWorld: Object.freeze({
      x: originVoxelX * voxelSizeInMeters,
      y: originVoxelY * voxelSizeInMeters,
      z: originVoxelZ * voxelSizeInMeters,
    }),
    maxVoxelCount,
    voxelsDroppedForBudget: requestedVoxelsUp - voxelsUp,
    budgetPaidIn: "vertical layers",
  });
}


export function worldVoxelIndexOf(grid, voxelX, voxelY, voxelZ) {
  return (voxelY * grid.voxelsDeep + voxelZ) * grid.voxelsAcross + voxelX;
}

export function isInsideWorldVoxelGrid(grid, voxelX, voxelY, voxelZ) {
  return (
    voxelX >= 0 &&
    voxelY >= 0 &&
    voxelZ >= 0 &&
    !(voxelX >= grid.voxelsAcross) &&
    !(voxelY >= grid.voxelsUp) &&
    !(voxelZ >= grid.voxelsDeep)
  );
}

export function worldVoxelCentre(grid, voxelX, voxelY, voxelZ) {
  const halfVoxel = grid.voxelSizeInMeters / 2;
  return {
    x: grid.originInWorld.x + voxelX * grid.voxelSizeInMeters + halfVoxel,
    y: grid.originInWorld.y + voxelY * grid.voxelSizeInMeters + halfVoxel,
    z: grid.originInWorld.z + voxelZ * grid.voxelSizeInMeters + halfVoxel,
  };
}


export function worldVoxelCoordinatesAt(grid, positionInWorld) {
  const position = worldPositionOf(positionInWorld);
  const voxelX = Math.floor((position.x - grid.originInWorld.x) / grid.voxelSizeInMeters);
  const voxelY = Math.floor((position.y - grid.originInWorld.y) / grid.voxelSizeInMeters);
  const voxelZ = Math.floor((position.z - grid.originInWorld.z) / grid.voxelSizeInMeters);
  if (!isInsideWorldVoxelGrid(grid, voxelX, voxelY, voxelZ)) return null;
  return { x: voxelX, y: voxelY, z: voxelZ };
}


export function worldVoxelGridShiftBetween(previousGrid, grid) {
  if (!previousGrid || !grid) return null;
  if (previousGrid.voxelSizeInMeters !== grid.voxelSizeInMeters) return null;
  if (previousGrid.voxelsAcross !== grid.voxelsAcross) return null;
  if (previousGrid.voxelsUp !== grid.voxelsUp) return null;
  if (previousGrid.voxelsDeep !== grid.voxelsDeep) return null;
  return Object.freeze({
    x: grid.originVoxel.x - previousGrid.originVoxel.x,
    y: grid.originVoxel.y - previousGrid.originVoxel.y,
    z: grid.originVoxel.z - previousGrid.originVoxel.z,
  });
}

export function describeWorldVoxelGrid(grid) {
  if (!grid) return null;
  return {
    voxelSizeInMeters: grid.voxelSizeInMeters,
    voxelsAcross: grid.voxelsAcross,
    voxelsUp: grid.voxelsUp,
    voxelsDeep: grid.voxelsDeep,
    voxelCount: grid.voxelCount,
    anchoredTo: grid.anchoredTo,
    originInWorld: grid.originInWorld,
    voxelsDroppedForBudget: grid.voxelsDroppedForBudget,
  };
}
