export const LIGHT_GRID_TILE_COUNT_X = 16;
export const LIGHT_GRID_TILE_COUNT_Y = 9;
export const LIGHT_GRID_DEPTH_SLICE_COUNT = 24;
export const LIGHT_GRID_CELL_COUNT =
  LIGHT_GRID_TILE_COUNT_X * LIGHT_GRID_TILE_COUNT_Y * LIGHT_GRID_DEPTH_SLICE_COUNT;


export const MAIN_TILES_PER_COARSE_TILE_X = 4;
export const MAIN_TILES_PER_COARSE_TILE_Y = 3;
export const MAIN_SLICES_PER_COARSE_SLICE = 4;
export const COARSE_TILE_COUNT_X = LIGHT_GRID_TILE_COUNT_X / MAIN_TILES_PER_COARSE_TILE_X;
export const COARSE_TILE_COUNT_Y = LIGHT_GRID_TILE_COUNT_Y / MAIN_TILES_PER_COARSE_TILE_Y;
export const COARSE_DEPTH_SLICE_COUNT = LIGHT_GRID_DEPTH_SLICE_COUNT / MAIN_SLICES_PER_COARSE_SLICE;
export const COARSE_CELL_COUNT = COARSE_TILE_COUNT_X * COARSE_TILE_COUNT_Y * COARSE_DEPTH_SLICE_COUNT;


export const ENGINE_CLUSTER_SOURCE = Object.freeze({
  project: "engine web",
  file: "src/lighting/lightClusterCore.js",
  cellCounts: "CL_X = 16, CL_Y = 9, CL_Z = 24, CL_TOTAL = 3456",
  symbols: Object.freeze(["clZSlice", "clXYSlice", "clCellIndex", "clLightBounds", "packClusterBuffers"]),
  portInstruction:
    "extend lightClusterCore.js in place: keep its slice and index functions, add the coarse pass, " +
    "the packed lists and the HZB cell cull. Never allocate a second cluster.",
});

const MINIMUM_DEPTH_RANGE = 0.001;

function clampNumber(value, minimum, maximum) {
  const number = Number(value);
  if (!Number.isFinite(number)) return minimum;
  if (number < minimum) return minimum;
  if (number > maximum) return maximum;
  return number;
}

function clampInteger(value, minimum, maximum) {
  return Math.floor(clampNumber(value, minimum, maximum));
}

function nearDepthOf(near) {
  const number = Number(near);
  return Number.isFinite(number) && number > 0 ? number : 0.1;
}

function farDepthOf(near, far) {
  const nearDepth = nearDepthOf(near);
  const number = Number(far);
  return Number.isFinite(number) && number > nearDepth ? number : nearDepth + MINIMUM_DEPTH_RANGE;
}

function positiveOrFallback(value, fallback) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : fallback;
}


export function normalizeGridCamera(camera) {
  const source = camera || {};
  return Object.freeze({
    near: nearDepthOf(source.near),
    far: farDepthOf(source.near, source.far),
    projectionScaleX: positiveOrFallback(source.projectionScaleX, 1),
    projectionScaleY: positiveOrFallback(source.projectionScaleY, 1),
  });
}


export function lightGridCellIndex(tileX, tileY, sliceIndex) {
  return (
    sliceIndex * (LIGHT_GRID_TILE_COUNT_X * LIGHT_GRID_TILE_COUNT_Y) +
    tileY * LIGHT_GRID_TILE_COUNT_X +
    tileX
  );
}

export function lightGridCellCoordinates(cellIndex) {
  const tilesPerSlice = LIGHT_GRID_TILE_COUNT_X * LIGHT_GRID_TILE_COUNT_Y;
  const sliceIndex = Math.floor(cellIndex / tilesPerSlice);
  const withinSlice = cellIndex - sliceIndex * tilesPerSlice;
  return {
    tileX: withinSlice % LIGHT_GRID_TILE_COUNT_X,
    tileY: Math.floor(withinSlice / LIGHT_GRID_TILE_COUNT_X),
    sliceIndex,
  };
}

export function coarseCellIndex(coarseTileX, coarseTileY, coarseSliceIndex) {
  return (
    coarseSliceIndex * (COARSE_TILE_COUNT_X * COARSE_TILE_COUNT_Y) +
    coarseTileY * COARSE_TILE_COUNT_X +
    coarseTileX
  );
}


export function coarseCellIndexOfCell(tileX, tileY, sliceIndex) {
  return coarseCellIndex(
    Math.floor(tileX / MAIN_TILES_PER_COARSE_TILE_X),
    Math.floor(tileY / MAIN_TILES_PER_COARSE_TILE_Y),
    Math.floor(sliceIndex / MAIN_SLICES_PER_COARSE_SLICE),
  );
}


export function depthSliceForViewDepth(viewDepth, near, far) {
  const nearDepth = nearDepthOf(near);
  const farDepth = farDepthOf(near, far);
  const depth = Math.max(Number(viewDepth) || 0, nearDepth);
  const slice = Math.floor(
    (LIGHT_GRID_DEPTH_SLICE_COUNT * (Math.log(depth) - Math.log(nearDepth))) /
      (Math.log(farDepth) - Math.log(nearDepth)),
  );
  return clampInteger(slice, 0, LIGHT_GRID_DEPTH_SLICE_COUNT - 1);
}


export function viewDepthAtDepthSliceBoundary(boundaryIndex, near, far) {
  const nearDepth = nearDepthOf(near);
  const farDepth = farDepthOf(near, far);
  const ratio = clampNumber(boundaryIndex, 0, LIGHT_GRID_DEPTH_SLICE_COUNT) / LIGHT_GRID_DEPTH_SLICE_COUNT;
  return nearDepth * Math.pow(farDepth / nearDepth, ratio);
}

export function depthRangeOfSlice(sliceIndex, near, far) {
  const firstSlice = clampInteger(sliceIndex, 0, LIGHT_GRID_DEPTH_SLICE_COUNT - 1);
  return {
    nearDepth: viewDepthAtDepthSliceBoundary(firstSlice, near, far),
    farDepth: viewDepthAtDepthSliceBoundary(firstSlice + 1, near, far),
  };
}

export function depthSpanOfSlice(sliceIndex, near, far) {
  const range = depthRangeOfSlice(sliceIndex, near, far);
  return range.farDepth - range.nearDepth;
}


export function screenTileForNdc(ndcX, ndcY) {
  const tileX = Math.floor(((Number(ndcX) || 0) + 1) * 0.5 * LIGHT_GRID_TILE_COUNT_X);
  const tileY = Math.floor((1 - (Number(ndcY) || 0)) * 0.5 * LIGHT_GRID_TILE_COUNT_Y);
  return {
    tileX: clampInteger(tileX, 0, LIGHT_GRID_TILE_COUNT_X - 1),
    tileY: clampInteger(tileY, 0, LIGHT_GRID_TILE_COUNT_Y - 1),
  };
}

export function ndcRangeOfTileSpan(firstTileX, tileSpanX, firstTileY, tileSpanY) {
  return {
    minNdcX: (firstTileX / LIGHT_GRID_TILE_COUNT_X) * 2 - 1,
    maxNdcX: ((firstTileX + tileSpanX) / LIGHT_GRID_TILE_COUNT_X) * 2 - 1,
    minNdcY: 1 - ((firstTileY + tileSpanY) / LIGHT_GRID_TILE_COUNT_Y) * 2,
    maxNdcY: 1 - (firstTileY / LIGHT_GRID_TILE_COUNT_Y) * 2,
  };
}


function viewBoundsOfSpan(firstTileX, tileSpanX, firstTileY, tileSpanY, firstSlice, sliceSpan, camera) {
  const gridCamera = camera.projectionScaleX ? camera : normalizeGridCamera(camera);
  const ndc = ndcRangeOfTileSpan(firstTileX, tileSpanX, firstTileY, tileSpanY);
  const nearDepth = viewDepthAtDepthSliceBoundary(firstSlice, gridCamera.near, gridCamera.far);
  const farDepth = viewDepthAtDepthSliceBoundary(firstSlice + sliceSpan, gridCamera.near, gridCamera.far);

  const leftNear = (ndc.minNdcX * nearDepth) / gridCamera.projectionScaleX;
  const leftFar = (ndc.minNdcX * farDepth) / gridCamera.projectionScaleX;
  const rightNear = (ndc.maxNdcX * nearDepth) / gridCamera.projectionScaleX;
  const rightFar = (ndc.maxNdcX * farDepth) / gridCamera.projectionScaleX;
  const bottomNear = (ndc.minNdcY * nearDepth) / gridCamera.projectionScaleY;
  const bottomFar = (ndc.minNdcY * farDepth) / gridCamera.projectionScaleY;
  const topNear = (ndc.maxNdcY * nearDepth) / gridCamera.projectionScaleY;
  const topFar = (ndc.maxNdcY * farDepth) / gridCamera.projectionScaleY;

  return {
    minX: Math.min(leftNear, leftFar, rightNear, rightFar),
    maxX: Math.max(leftNear, leftFar, rightNear, rightFar),
    minY: Math.min(bottomNear, bottomFar, topNear, topFar),
    maxY: Math.max(bottomNear, bottomFar, topNear, topFar),
    nearDepth,
    farDepth,
  };
}

export function cellViewBounds(tileX, tileY, sliceIndex, camera) {
  return viewBoundsOfSpan(tileX, 1, tileY, 1, sliceIndex, 1, camera);
}

export function coarseCellViewBounds(coarseTileX, coarseTileY, coarseSliceIndex, camera) {
  return viewBoundsOfSpan(
    coarseTileX * MAIN_TILES_PER_COARSE_TILE_X,
    MAIN_TILES_PER_COARSE_TILE_X,
    coarseTileY * MAIN_TILES_PER_COARSE_TILE_Y,
    MAIN_TILES_PER_COARSE_TILE_Y,
    coarseSliceIndex * MAIN_SLICES_PER_COARSE_SLICE,
    MAIN_SLICES_PER_COARSE_SLICE,
    camera,
  );
}

function distanceToInterval(value, minimum, maximum) {
  const number = Number(value) || 0;
  if (number < minimum) return minimum - number;
  if (number > maximum) return number - maximum;
  return 0;
}


export function sphereTouchesCellBounds(light, bounds) {
  if (!light || !bounds) return false;
  const radius = Number(light.attenuationRadius) || 0;
  if (radius <= 0) return false;
  const distanceX = distanceToInterval(light.viewX, bounds.minX, bounds.maxX);
  const distanceY = distanceToInterval(light.viewY, bounds.minY, bounds.maxY);
  const distanceDepth = distanceToInterval(light.viewDepth, bounds.nearDepth, bounds.farDepth);
  const squaredDistance = distanceX * distanceX + distanceY * distanceY + distanceDepth * distanceDepth;
  return squaredDistance <= radius * radius;
}

function sphereContainsCellBounds(light, bounds) {
  const radius = Number(light.attenuationRadius) || 0;
  if (!(radius > 0)) return false;
  const viewX = Number(light.viewX) || 0;
  const viewY = Number(light.viewY) || 0;
  const viewDepth = Number(light.viewDepth) || 0;
  const distanceX = Math.max(Math.abs(viewX - bounds.minX), Math.abs(viewX - bounds.maxX));
  const distanceY = Math.max(Math.abs(viewY - bounds.minY), Math.abs(viewY - bounds.maxY));
  const distanceDepth = Math.max(Math.abs(viewDepth - bounds.nearDepth), Math.abs(viewDepth - bounds.farDepth));
  const squaredDistance = distanceX * distanceX + distanceY * distanceY + distanceDepth * distanceDepth;
  const squaredRadius = radius * radius;
  return Number.isFinite(squaredDistance) && Number.isFinite(squaredRadius) &&
    squaredDistance < squaredRadius * (1 - Number.EPSILON * 32);
}


export function buildCoarseLightGrid(request) {
  const lights = Array.isArray(request && request.lights) ? request.lights : [];
  const camera = normalizeGridCamera(request && request.camera);
  const lightIndicesByCell = new Array(COARSE_CELL_COUNT);
  const fullyCoveredCells = new Uint8Array(COARSE_CELL_COUNT);
  let containmentTests = 0;

  for (let sliceIndex = 0; sliceIndex < COARSE_DEPTH_SLICE_COUNT; sliceIndex++) {
    for (let tileY = 0; tileY < COARSE_TILE_COUNT_Y; tileY++) {
      for (let tileX = 0; tileX < COARSE_TILE_COUNT_X; tileX++) {
        const bounds = coarseCellViewBounds(tileX, tileY, sliceIndex, camera);
        const lightIndices = [];
        let fullyCovered = true;
        for (let lightIndex = 0; lightIndex < lights.length; lightIndex++) {
          const light = lights[lightIndex];
          if (!sphereTouchesCellBounds(light, bounds)) continue;
          lightIndices.push(lightIndex);
          if (fullyCovered) {
            containmentTests += 1;
            fullyCovered = sphereContainsCellBounds(light, bounds);
          }
        }
        const cellIndex = coarseCellIndex(tileX, tileY, sliceIndex);
        lightIndicesByCell[cellIndex] = lightIndices;
        fullyCoveredCells[cellIndex] = fullyCovered ? 1 : 0;
      }
    }
  }

  return {
    cellCount: COARSE_CELL_COUNT,
    lightIndicesByCell,
    fullyCoveredCells,
    containmentTests,
    candidateTests: COARSE_CELL_COUNT * lights.length,
  };
}


export function buildLightGrid(request) {
  const lights = Array.isArray(request && request.lights) ? request.lights : [];
  const camera = normalizeGridCamera(request && request.camera);
  const isCellVisible =
    request && typeof request.isCellVisible === "function" ? request.isCellVisible : null;

  const coarse = buildCoarseLightGrid({ lights, camera });
  const lightIndicesByCell = new Array(LIGHT_GRID_CELL_COUNT);

  let mainCandidateTests = 0;
  let containedCandidateAccepts = 0;
  let skippedCellCount = 0;
  let occupiedCellCount = 0;
  let entryCount = 0;
  let maximumLightsInOneCell = 0;

  for (let sliceIndex = 0; sliceIndex < LIGHT_GRID_DEPTH_SLICE_COUNT; sliceIndex++) {
    const depthRange = depthRangeOfSlice(sliceIndex, camera.near, camera.far);
    for (let tileY = 0; tileY < LIGHT_GRID_TILE_COUNT_Y; tileY++) {
      for (let tileX = 0; tileX < LIGHT_GRID_TILE_COUNT_X; tileX++) {
        const cellIndex = lightGridCellIndex(tileX, tileY, sliceIndex);

        if (isCellVisible && !isCellVisible({ tileX, tileY, sliceIndex, cellIndex, depthRange })) {
          lightIndicesByCell[cellIndex] = [];
          skippedCellCount++;
          continue;
        }

        const coarseIndex = coarseCellIndexOfCell(tileX, tileY, sliceIndex);
        const candidates = coarse.lightIndicesByCell[coarseIndex];
        let cellLightIndices;
        if (coarse.fullyCoveredCells[coarseIndex]) {
          cellLightIndices = candidates.slice();
          containedCandidateAccepts += candidates.length;
        } else {
          mainCandidateTests += candidates.length;
          const bounds = cellViewBounds(tileX, tileY, sliceIndex, camera);
          cellLightIndices = [];
          for (let candidate = 0; candidate < candidates.length; candidate++) {
            const lightIndex = candidates[candidate];
            if (sphereTouchesCellBounds(lights[lightIndex], bounds)) cellLightIndices.push(lightIndex);
          }
        }

        lightIndicesByCell[cellIndex] = cellLightIndices;
        entryCount += cellLightIndices.length;
        if (cellLightIndices.length > 0) occupiedCellCount++;
        if (cellLightIndices.length > maximumLightsInOneCell) maximumLightsInOneCell = cellLightIndices.length;
      }
    }
  }

  const bruteForceCandidateTests = LIGHT_GRID_CELL_COUNT * lights.length;
  const totalCandidateTests = coarse.candidateTests + coarse.containmentTests + mainCandidateTests;

  return {
    camera,
    coarse,
    lightIndicesByCell,
    cellCount: LIGHT_GRID_CELL_COUNT,
    statistics: {
      lightCount: lights.length,
      cellCount: LIGHT_GRID_CELL_COUNT,
      coarseCellCount: COARSE_CELL_COUNT,
      bruteForceCandidateTests,
      coarseCandidateTests: coarse.candidateTests,
      coarseContainmentTests: coarse.containmentTests,
      containedCandidateAccepts,
      mainCandidateTests,
      totalCandidateTests,

      mainWorkReductionRatio:
        bruteForceCandidateTests > 0 ? 1 - mainCandidateTests / bruteForceCandidateTests : 0,


      totalWorkReductionRatio:
        bruteForceCandidateTests > 0 ? 1 - totalCandidateTests / bruteForceCandidateTests : 0,
      skippedCellCount,
      occupiedCellCount,
      entryCount,
      maximumLightsInOneCell,
    },
  };
}


export function buildBruteForceLightGrid(request) {
  const lights = Array.isArray(request && request.lights) ? request.lights : [];
  const camera = normalizeGridCamera(request && request.camera);
  const lightIndicesByCell = new Array(LIGHT_GRID_CELL_COUNT);

  for (let sliceIndex = 0; sliceIndex < LIGHT_GRID_DEPTH_SLICE_COUNT; sliceIndex++) {
    for (let tileY = 0; tileY < LIGHT_GRID_TILE_COUNT_Y; tileY++) {
      for (let tileX = 0; tileX < LIGHT_GRID_TILE_COUNT_X; tileX++) {
        const bounds = cellViewBounds(tileX, tileY, sliceIndex, camera);
        const cellLightIndices = [];
        for (let lightIndex = 0; lightIndex < lights.length; lightIndex++) {
          if (sphereTouchesCellBounds(lights[lightIndex], bounds)) cellLightIndices.push(lightIndex);
        }
        lightIndicesByCell[lightGridCellIndex(tileX, tileY, sliceIndex)] = cellLightIndices;
      }
    }
  }

  return {
    camera,
    lightIndicesByCell,
    cellCount: LIGHT_GRID_CELL_COUNT,
    candidateTests: LIGHT_GRID_CELL_COUNT * lights.length,
  };
}


export function findMissingLights(gridUnderTest, referenceGrid) {
  const missing = [];
  for (let cellIndex = 0; cellIndex < LIGHT_GRID_CELL_COUNT; cellIndex++) {
    const testedCell = gridUnderTest.lightIndicesByCell[cellIndex] || [];
    const referenceCell = referenceGrid.lightIndicesByCell[cellIndex] || [];
    if (referenceCell.length === 0) continue;
    const testedSet = new Set(testedCell);
    for (let entry = 0; entry < referenceCell.length; entry++) {
      if (!testedSet.has(referenceCell[entry])) {
        missing.push({ cellIndex, lightIndex: referenceCell[entry] });
      }
    }
  }
  return missing;
}

export function describeLightGridGeometry() {
  return {
    tileCountX: LIGHT_GRID_TILE_COUNT_X,
    tileCountY: LIGHT_GRID_TILE_COUNT_Y,
    depthSliceCount: LIGHT_GRID_DEPTH_SLICE_COUNT,
    cellCount: LIGHT_GRID_CELL_COUNT,
    coarseTileCountX: COARSE_TILE_COUNT_X,
    coarseTileCountY: COARSE_TILE_COUNT_Y,
    coarseDepthSliceCount: COARSE_DEPTH_SLICE_COUNT,
    coarseCellCount: COARSE_CELL_COUNT,
    mainCellsPerCoarseCell:
      MAIN_TILES_PER_COARSE_TILE_X * MAIN_TILES_PER_COARSE_TILE_Y * MAIN_SLICES_PER_COARSE_SLICE,
    engineClusterSource: ENGINE_CLUSTER_SOURCE,
  };
}
