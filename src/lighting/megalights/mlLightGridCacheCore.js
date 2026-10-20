import {
  buildLightGrid,
  depthRangeOfSlice,
  LIGHT_GRID_CELL_COUNT,
  LIGHT_GRID_DEPTH_SLICE_COUNT,
  LIGHT_GRID_TILE_COUNT_X,
  LIGHT_GRID_TILE_COUNT_Y,
  normalizeGridCamera,
} from "./mlLightGridCore.js";

const LIGHT_GEOMETRY_STRIDE = 4;
const CAMERA_FIELDS = ["near", "far", "projectionScaleX", "projectionScaleY"];

export function createLightGridCache() {
  let previousCamera = null;
  let previousLightCount = -1;
  let previousGeometry = new Float64Array(0);
  let previousGrid = null;
  let previousVisibilityEnabled = false;
  let buildCount = 0;
  let reuseCount = 0;
  const currentVisibility = new Uint8Array(LIGHT_GRID_CELL_COUNT);
  const previousVisibility = new Uint8Array(LIGHT_GRID_CELL_COUNT);
  const cell = { tileX: 0, tileY: 0, sliceIndex: 0, cellIndex: 0, depthRange: null };

  function updateGeometry(lights) {
    const requiredLength = lights.length * LIGHT_GEOMETRY_STRIDE;
    let unchanged = lights.length === previousLightCount;
    if (previousGeometry.length < requiredLength) {
      previousGeometry = new Float64Array(requiredLength);
      unchanged = false;
    }
    for (let index = 0; index < lights.length; index += 1) {
      const light = lights[index];
      const offset = index * LIGHT_GEOMETRY_STRIDE;
      const viewX = Number(light?.viewX) || 0;
      const viewY = Number(light?.viewY) || 0;
      const viewDepth = Number(light?.viewDepth) || 0;
      const radius = Number(light?.attenuationRadius) || 0;
      if (previousGeometry[offset] !== viewX || previousGeometry[offset + 1] !== viewY ||
          previousGeometry[offset + 2] !== viewDepth || previousGeometry[offset + 3] !== radius) unchanged = false;
      previousGeometry[offset] = viewX;
      previousGeometry[offset + 1] = viewY;
      previousGeometry[offset + 2] = viewDepth;
      previousGeometry[offset + 3] = radius;
    }
    previousLightCount = lights.length;
    return unchanged;
  }

  function updateVisibility(camera, isCellVisible) {
    const visibilityEnabled = typeof isCellVisible === "function";
    let unchanged = visibilityEnabled === previousVisibilityEnabled;
    if (!visibilityEnabled) {
      if (previousVisibilityEnabled || !previousGrid) currentVisibility.fill(1);
      previousVisibilityEnabled = false;
      return unchanged;
    }
    let cellIndex = 0;
    for (let sliceIndex = 0; sliceIndex < LIGHT_GRID_DEPTH_SLICE_COUNT; sliceIndex += 1) {
      cell.sliceIndex = sliceIndex;
      cell.depthRange = depthRangeOfSlice(sliceIndex, camera.near, camera.far);
      for (let tileY = 0; tileY < LIGHT_GRID_TILE_COUNT_Y; tileY += 1) {
        cell.tileY = tileY;
        for (let tileX = 0; tileX < LIGHT_GRID_TILE_COUNT_X; tileX += 1) {
          cell.tileX = tileX;
          cell.cellIndex = cellIndex;
          const visible = isCellVisible(cell) ? 1 : 0;
          if (visible !== previousVisibility[cellIndex]) unchanged = false;
          currentVisibility[cellIndex] = visible;
          cellIndex += 1;
        }
      }
    }
    previousVisibilityEnabled = true;
    return unchanged;
  }

  function build(request = {}) {
    const lights = Array.isArray(request.lights) ? request.lights : [];
    const camera = normalizeGridCamera(request.camera);
    const cameraUnchanged = previousCamera !== null &&
      CAMERA_FIELDS.every(field => camera[field] === previousCamera[field]);
    let geometryUnchanged;
    let visibilityUnchanged;
    try {
      geometryUnchanged = updateGeometry(lights);
      visibilityUnchanged = updateVisibility(camera, request.isCellVisible);
    } catch (error) {
      previousGrid = null;
      throw error;
    }
    if (previousGrid && cameraUnchanged && geometryUnchanged && visibilityUnchanged) {
      reuseCount += 1;
      return { grid: previousGrid, reused: true, candidateTests: 0 };
    }
    previousGrid = null;
    const grid = buildLightGrid({
      lights,
      camera,
      isCellVisible: previousVisibilityEnabled ? entry => currentVisibility[entry.cellIndex] === 1 : null,
    });
    previousCamera = camera;
    previousVisibility.set(currentVisibility);
    previousGrid = grid;
    buildCount += 1;
    return { grid, reused: false, candidateTests: grid.statistics.totalCandidateTests };
  }

  function reset() {
    previousCamera = null;
    previousGrid = null;
    previousLightCount = -1;
    previousGeometry = new Float64Array(0);
    previousVisibilityEnabled = false;
    previousVisibility.fill(0);
    currentVisibility.fill(0);
  }

  return { build, reset, describe: () => ({ buildCount, reuseCount, cached: previousGrid !== null }) };
}
