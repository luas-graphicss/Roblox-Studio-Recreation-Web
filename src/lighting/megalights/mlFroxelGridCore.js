import { MGL_TRACE_TILE_SIZE } from "./mlPipelineContract.js";

export const FROXEL_GRID_DEFAULTS = Object.freeze({
  tileSizeInPixels: MGL_TRACE_TILE_SIZE,
  depthSliceCount: 32,


  nearDistance: 0.5,
  farDistance: 64,


  maxFroxelCount: 65536,
});

function positiveNumberOr(value, fallback) {
  const candidate = Number(value);
  return Number.isFinite(candidate) && candidate > 0 ? candidate : fallback;
}

function tileCountFor(sizeInPixels, tileSizeInPixels) {
  return Math.max(1, Math.ceil(sizeInPixels / tileSizeInPixels));
}


export function resolveFroxelGrid(request) {
  const options = request || {};
  const tileSizeInPixels = Math.max(
    1,
    Math.floor(positiveNumberOr(options.tileSizeInPixels, FROXEL_GRID_DEFAULTS.tileSizeInPixels)),
  );
  const renderWidth = Math.max(1, Math.floor(positiveNumberOr(options.renderWidth, 1)));
  const renderHeight = Math.max(1, Math.floor(positiveNumberOr(options.renderHeight, 1)));

  const columnsAcross = tileCountFor(renderWidth, tileSizeInPixels);
  const columnsDown = tileCountFor(renderHeight, tileSizeInPixels);
  const columnCount = columnsAcross * columnsDown;

  const requestedSliceCount = Math.max(
    1,
    Math.floor(positiveNumberOr(options.depthSliceCount, FROXEL_GRID_DEFAULTS.depthSliceCount)),
  );
  const maxFroxelCount = Math.max(
    1,
    Math.floor(positiveNumberOr(options.maxFroxelCount, FROXEL_GRID_DEFAULTS.maxFroxelCount)),
  );
  const affordableSliceCount = Math.max(1, Math.floor(maxFroxelCount / columnCount));
  const depthSliceCount = Math.min(requestedSliceCount, affordableSliceCount);

  const nearDistance = positiveNumberOr(options.nearDistance, FROXEL_GRID_DEFAULTS.nearDistance);


  const farDistance = Math.max(
    nearDistance * 2,
    positiveNumberOr(options.farDistance, FROXEL_GRID_DEFAULTS.farDistance),
  );

  return Object.freeze({
    tileSizeInPixels,
    renderWidth,
    renderHeight,
    columnsAcross,
    columnsDown,
    depthSliceCount,
    froxelCount: columnCount * depthSliceCount,
    nearDistance,
    farDistance,
    depthDistribution: "geometric",
    depthSlicesDroppedForBudget: requestedSliceCount - depthSliceCount,
  });
}


export function sliceBoundaryDistance(grid, boundaryIndex) {
  const boundary = Math.min(Math.max(0, Number(boundaryIndex) || 0), grid.depthSliceCount);
  const ratio = boundary / grid.depthSliceCount;
  return grid.nearDistance * Math.pow(grid.farDistance / grid.nearDistance, ratio);
}


export function sliceCentreDistance(grid, sliceIndex) {
  const nearBoundary = sliceBoundaryDistance(grid, sliceIndex);
  const farBoundary = sliceBoundaryDistance(grid, sliceIndex + 1);
  return Math.sqrt(nearBoundary * farBoundary);
}


export function sliceThickness(grid, sliceIndex) {
  return sliceBoundaryDistance(grid, sliceIndex + 1) - sliceBoundaryDistance(grid, sliceIndex);
}


export function sliceIndexAtDistance(grid, distance) {
  const requested = Number(distance);
  const safeDistance = Number.isFinite(requested) ? requested : grid.nearDistance;
  const clampedDistance = Math.min(Math.max(safeDistance, grid.nearDistance), grid.farDistance);
  const ratio = Math.log(clampedDistance / grid.nearDistance) / Math.log(grid.farDistance / grid.nearDistance);
  return Math.min(grid.depthSliceCount - 1, Math.floor(ratio * grid.depthSliceCount));
}


export function froxelIndexOf(grid, columnX, columnY, sliceIndex) {
  return (sliceIndex * grid.columnsDown + columnY) * grid.columnsAcross + columnX;
}


export function froxelViewDirection(grid, columnX, columnY, frustum) {
  const view = frustum || {};
  const tanHalfFieldOfViewY = positiveNumberOr(view.tanHalfFieldOfViewY, 0.5);
  const aspectRatio = positiveNumberOr(view.aspectRatio, grid.renderWidth / grid.renderHeight);

  const pixelX = (columnX + 0.5) * grid.tileSizeInPixels;
  const pixelY = (columnY + 0.5) * grid.tileSizeInPixels;


  const normalisedX = (pixelX / grid.renderWidth) * 2 - 1;
  const normalisedY = 1 - (pixelY / grid.renderHeight) * 2;

  return {
    x: normalisedX * tanHalfFieldOfViewY * aspectRatio,
    y: normalisedY * tanHalfFieldOfViewY,
    z: -1,
  };
}


export function froxelCentreInViewSpace(grid, columnX, columnY, sliceIndex, frustum) {
  const direction = froxelViewDirection(grid, columnX, columnY, frustum);
  const depth = sliceCentreDistance(grid, sliceIndex);
  return { x: direction.x * depth, y: direction.y * depth, z: -depth };
}


export function radialLengthFactor(direction) {
  return Math.sqrt(direction.x * direction.x + direction.y * direction.y + 1);
}
