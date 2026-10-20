import {
  SPHERICAL_HARMONIC_BAND_COUNT,
  addIsotropicRadianceSample,
  addRadianceSample,
  band0LuminanceOf,
  clearVoxelCoefficients,
  createVoxelCoefficients,
} from "./mlSphericalHarmonicsCore.js";
import { worldVoxelIndexOf } from "./mlWorldVoxelGridCore.js";

export const WORLD_VOXEL_FRAME_REFUSAL = Object.freeze({
  none: "none",
  emptyGrid: "emptyGrid",


  samplesDisabledByTier: "samplesDisabledByTier",
  lightSamplesMissing: "lightSamplesMissing",
  storeMissing: "storeMissing",
  overBudget: "overBudget",
});

export const WORLD_VOXEL_FRAME_DEFAULTS = Object.freeze({
  maxSweptVoxels: 4096,
});

const SCRATCH_VOXEL_INDEX = 0;

function nonNegativeIntegerOr(value, fallback) {
  const candidate = Number(value);
  return Number.isFinite(candidate) && candidate >= 0 ? Math.floor(candidate) : fallback;
}

function isFunction(candidate) {
  return typeof candidate === "function";
}

function sortedByEnergyDescending(samples) {


  return samples.slice().sort((first, second) => (second.energy || 0) - (first.energy || 0));
}


export function resolveWorldVoxelShFrame(request) {
  const options = request || {};
  const grid = options.grid || null;
  const store = options.store || null;
  const samplesPerVoxel = nonNegativeIntegerOr(options.samplesPerVoxel, 0);
  const maxSweptVoxels = Math.max(
    1,
    nonNegativeIntegerOr(options.maxSweptVoxels, WORLD_VOXEL_FRAME_DEFAULTS.maxSweptVoxels),
  );

  const refusedResult = (refusal) =>
    Object.freeze({
      resolved: false,
      refusal,
      grid,
      stats: null,
    });

  if (!grid || !(grid.voxelCount >= 1)) return refusedResult(WORLD_VOXEL_FRAME_REFUSAL.emptyGrid);
  if (samplesPerVoxel === 0) return refusedResult(WORLD_VOXEL_FRAME_REFUSAL.samplesDisabledByTier);
  if (!store || !isFunction(store.blendVoxel)) return refusedResult(WORLD_VOXEL_FRAME_REFUSAL.storeMissing);
  if (!isFunction(options.readVoxelLightSamples)) {
    return refusedResult(WORLD_VOXEL_FRAME_REFUSAL.lightSamplesMissing);
  }
  if (grid.voxelCount > maxSweptVoxels) return refusedResult(WORLD_VOXEL_FRAME_REFUSAL.overBudget);

  const readVoxelLightSamples = options.readVoxelLightSamples;
  const sampleCoefficients = createVoxelCoefficients(1);

  let sweptVoxelCount = 0;
  let litVoxelCount = 0;
  let voxelsWithoutSamples = 0;
  let reusedSampleCount = 0;
  let isotropicFallbackCount = 0;
  let historyLengthSum = 0;

  for (let voxelY = 0; voxelY !== grid.voxelsUp; voxelY += 1) {
    for (let voxelZ = 0; voxelZ !== grid.voxelsDeep; voxelZ += 1) {
      for (let voxelX = 0; voxelX !== grid.voxelsAcross; voxelX += 1) {
        const voxelSamples = readVoxelLightSamples(voxelX, voxelY, voxelZ) || [];
        if (voxelSamples.length === 0) {
          voxelsWithoutSamples += 1;
          continue;
        }

        const rankedSamples = sortedByEnergyDescending(voxelSamples).slice(0, samplesPerVoxel);
        clearVoxelCoefficients(sampleCoefficients, SCRATCH_VOXEL_INDEX);

        for (let sampleIndex = 0; sampleIndex !== rankedSamples.length; sampleIndex += 1) {
          const sample = rankedSamples[sampleIndex];
          reusedSampleCount += 1;
          const radiance = sample.radiance || { red: sample.energy, green: sample.energy, blue: sample.energy };
          const weight = sample.transmittanceToLight === undefined ? 1 : sample.transmittanceToLight;

          if (!sample.directionTowardsLight) {
            isotropicFallbackCount += 1;
            addIsotropicRadianceSample(sampleCoefficients, SCRATCH_VOXEL_INDEX, radiance, weight);
            continue;
          }
          addRadianceSample(
            sampleCoefficients,
            SCRATCH_VOXEL_INDEX,
            sample.directionTowardsLight,
            radiance,
            weight,
          );
        }

        const voxelIndex = worldVoxelIndexOf(grid, voxelX, voxelY, voxelZ);
        historyLengthSum += store.blendVoxel(voxelIndex, sampleCoefficients, SCRATCH_VOXEL_INDEX);
        sweptVoxelCount += 1;
        if (band0LuminanceOf(sampleCoefficients, SCRATCH_VOXEL_INDEX) > 0) litVoxelCount += 1;
      }
    }
  }

  return Object.freeze({
    resolved: true,
    refusal: WORLD_VOXEL_FRAME_REFUSAL.none,
    grid,
    stats: Object.freeze({
      voxelCount: grid.voxelCount,
      sweptVoxelCount,
      litVoxelCount,
      voxelsWithoutSamples,
      samplesPerVoxel,
      reusedSampleCount,
      isotropicFallbackCount,

      bandsWritten: SPHERICAL_HARMONIC_BAND_COUNT,
      meanHistoryLength: sweptVoxelCount > 0 ? historyLengthSum / sweptVoxelCount : 0,
    }),
  });
}
