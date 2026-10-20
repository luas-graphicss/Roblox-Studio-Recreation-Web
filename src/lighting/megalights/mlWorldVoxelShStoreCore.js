import {
  SPHERICAL_HARMONIC_BAND_COUNT,
  SPHERICAL_HARMONIC_FLOATS_PER_VOXEL,
  blendVoxelCoefficients,
  clearVoxelCoefficients,
  copyVoxelCoefficients,
  createVoxelCoefficients,
} from "./mlSphericalHarmonicsCore.js";
import {
  isInsideWorldVoxelGrid,
  worldVoxelGridShiftBetween,
  worldVoxelIndexOf,
} from "./mlWorldVoxelGridCore.js";

export const WORLD_VOXEL_REANCHOR_STATE = Object.freeze({
  allocated: "allocated",
  kept: "kept",
  shifted: "shifted",
  reallocated: "reallocated",
});

export const WORLD_VOXEL_HISTORY_FRAME_CEILING = 16;

function historyCeilingOf(value) {
  const candidate = Number(value);
  return Number.isFinite(candidate) && candidate >= 1
    ? Math.floor(candidate)
    : WORLD_VOXEL_HISTORY_FRAME_CEILING;
}


export function createWorldVoxelShStore(options) {
  const settings = options || {};
  const historyFrameCeiling = historyCeilingOf(settings.historyFrameCeiling);

  let grid = null;
  let coefficients = null;
  let accumulatedFrameCounts = null;
  let shiftedCoefficients = null;
  let shiftedFrameCounts = null;
  let lastReanchor = Object.freeze({
    state: null,
    shift: null,
    shiftedVoxelCount: 0,
    clearedVoxelCount: 0,
  });

  function allocateFor(nextGrid, state) {
    coefficients = createVoxelCoefficients(nextGrid.voxelCount);
    accumulatedFrameCounts = new Uint16Array(nextGrid.voxelCount);
    shiftedCoefficients = createVoxelCoefficients(nextGrid.voxelCount);
    shiftedFrameCounts = new Uint16Array(nextGrid.voxelCount);
    grid = nextGrid;
    lastReanchor = Object.freeze({
      state,
      shift: null,
      shiftedVoxelCount: 0,
      clearedVoxelCount: nextGrid.voxelCount,
    });
  }

  function shiftHistoryTo(nextGrid, shift) {
    shiftedCoefficients.fill(0);
    shiftedFrameCounts.fill(0);

    let shiftedVoxelCount = 0;
    let clearedVoxelCount = 0;

    for (let voxelY = 0; voxelY !== nextGrid.voxelsUp; voxelY += 1) {
      for (let voxelZ = 0; voxelZ !== nextGrid.voxelsDeep; voxelZ += 1) {
        for (let voxelX = 0; voxelX !== nextGrid.voxelsAcross; voxelX += 1) {

          const sourceX = voxelX + shift.x;
          const sourceY = voxelY + shift.y;
          const sourceZ = voxelZ + shift.z;
          const destinationIndex = worldVoxelIndexOf(nextGrid, voxelX, voxelY, voxelZ);

          if (!isInsideWorldVoxelGrid(grid, sourceX, sourceY, sourceZ)) {

            clearedVoxelCount += 1;
            continue;
          }

          const sourceIndex = worldVoxelIndexOf(grid, sourceX, sourceY, sourceZ);
          copyVoxelCoefficients(coefficients, sourceIndex, shiftedCoefficients, destinationIndex);
          shiftedFrameCounts[destinationIndex] = accumulatedFrameCounts[sourceIndex];
          shiftedVoxelCount += 1;
        }
      }
    }

    const previousCoefficients = coefficients;
    coefficients = shiftedCoefficients;
    shiftedCoefficients = previousCoefficients;

    const previousFrameCounts = accumulatedFrameCounts;
    accumulatedFrameCounts = shiftedFrameCounts;
    shiftedFrameCounts = previousFrameCounts;

    grid = nextGrid;
    lastReanchor = Object.freeze({
      state: WORLD_VOXEL_REANCHOR_STATE.shifted,
      shift,
      shiftedVoxelCount,
      clearedVoxelCount,
    });
  }

  function describe() {
    return Object.freeze({
      voxelCount: grid ? grid.voxelCount : 0,
      floatsPerVoxel: SPHERICAL_HARMONIC_FLOATS_PER_VOXEL,
      bands: SPHERICAL_HARMONIC_BAND_COUNT,
      bytes: coefficients ? coefficients.byteLength + accumulatedFrameCounts.byteLength : 0,
      historyFrameCeiling,
      reanchor: lastReanchor,
    });
  }

  return {


    resolve(nextGrid) {
      if (!nextGrid || !(nextGrid.voxelCount >= 1)) return describe();
      if (!grid || !coefficients) {
        allocateFor(nextGrid, WORLD_VOXEL_REANCHOR_STATE.allocated);
        return describe();
      }

      const shift = worldVoxelGridShiftBetween(grid, nextGrid);
      if (!shift) {
        allocateFor(nextGrid, WORLD_VOXEL_REANCHOR_STATE.reallocated);
        return describe();
      }
      if (shift.x === 0 && shift.y === 0 && shift.z === 0) {


        grid = nextGrid;
        lastReanchor = Object.freeze({
          state: WORLD_VOXEL_REANCHOR_STATE.kept,
          shift,
          shiftedVoxelCount: nextGrid.voxelCount,
          clearedVoxelCount: 0,
        });
        return describe();
      }

      shiftHistoryTo(nextGrid, shift);
      return describe();
    },


    blendVoxel(voxelIndex, sampleCoefficients, sampleVoxelIndex) {
      const previousFrames = Math.min(accumulatedFrameCounts[voxelIndex], historyFrameCeiling);
      const sampleWeight = 1 / (previousFrames + 1);
      blendVoxelCoefficients(
        coefficients,
        voxelIndex,
        sampleCoefficients,
        sampleVoxelIndex === undefined ? 0 : sampleVoxelIndex,
        sampleWeight,
      );
      accumulatedFrameCounts[voxelIndex] = Math.min(previousFrames + 1, historyFrameCeiling);
      return accumulatedFrameCounts[voxelIndex];
    },

    frameCountAt(voxelIndex) {
      return accumulatedFrameCounts ? accumulatedFrameCounts[voxelIndex] : 0;
    },


    readVoxel(voxelIndex) {
      if (!coefficients) return null;
      const offset = voxelIndex * SPHERICAL_HARMONIC_FLOATS_PER_VOXEL;
      return coefficients.slice(offset, offset + SPHERICAL_HARMONIC_FLOATS_PER_VOXEL);
    },


    coefficientsView() {
      return coefficients;
    },

    clearVoxel(voxelIndex) {
      if (!coefficients) return false;
      clearVoxelCoefficients(coefficients, voxelIndex);
      accumulatedFrameCounts[voxelIndex] = 0;
      return true;
    },

    grid() {
      return grid;
    },

    describe,
  };
}
