import {
  froxelIndexOf,
  froxelViewDirection,
  radialLengthFactor,
  sliceCentreDistance,
  sliceIndexAtDistance,
  sliceThickness,
} from "./mlFroxelGridCore.js";
import {
  VOLUME_MEDIUM_DEFAULTS,
  forwardScatteringCosine,
  inScatteringFromLightSample,
  integrateFroxelSegment,
} from "./mlVolumeScatteringCore.js";

export const VOLUME_FROXEL_REFUSAL = Object.freeze({
  none: "none",


  samplesDisabledByTier: "samplesDisabledByTier",
  lightSamplesMissing: "lightSamplesMissing",
  emptyGrid: "emptyGrid",
  overBudget: "overBudget",
});

export const VOLUME_FROXEL_FRAME_DEFAULTS = Object.freeze({


  maxSweptFroxels: 65536,
});

const FLOATS_PER_FROXEL = 4;

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


export function resolveVolumeFroxelFrame(request) {
  const options = request || {};
  const grid = options.grid || null;
  const medium = options.medium || VOLUME_MEDIUM_DEFAULTS;
  const samplesPerFroxel = nonNegativeIntegerOr(options.samplesPerFroxel, 0);
  const maxSweptFroxels = Math.max(
    1,
    nonNegativeIntegerOr(options.maxSweptFroxels, VOLUME_FROXEL_FRAME_DEFAULTS.maxSweptFroxels),
  );

  const emptyResult = (refusal) =>
    Object.freeze({
      resolved: false,
      refusal,
      grid,
      scattering: null,
      stats: null,
    });

  if (!grid || grid.froxelCount === 0) return emptyResult(VOLUME_FROXEL_REFUSAL.emptyGrid);
  if (samplesPerFroxel === 0) return emptyResult(VOLUME_FROXEL_REFUSAL.samplesDisabledByTier);
  if (!isFunction(options.readColumnLightSamples)) {
    return emptyResult(VOLUME_FROXEL_REFUSAL.lightSamplesMissing);
  }
  if (grid.froxelCount > maxSweptFroxels) return emptyResult(VOLUME_FROXEL_REFUSAL.overBudget);

  const readColumnLightSamples = options.readColumnLightSamples;
  const resolveLightSampleAtFroxel = isFunction(options.resolveLightSampleAtFroxel)
    ? options.resolveLightSampleAtFroxel
    : null;
  const readOpaqueDepthAtColumn = isFunction(options.readOpaqueDepthAtColumn)
    ? options.readOpaqueDepthAtColumn
    : null;

  const scattering = new Float32Array(grid.froxelCount * FLOATS_PER_FROXEL);
  let litFroxelCount = 0;
  let occludedFroxelCount = 0;
  let columnsWithoutSamples = 0;
  let reusedSampleCount = 0;
  let isotropicFallbackCount = 0;
  let shadowTracesInherited = 0;
  let transmittanceSum = 0;

  for (let columnY = 0; columnY !== grid.columnsDown; columnY += 1) {
    for (let columnX = 0; columnX !== grid.columnsAcross; columnX += 1) {
      const columnSamples = readColumnLightSamples(columnX, columnY) || [];
      if (columnSamples.length === 0) columnsWithoutSamples += 1;
      const rankedSamples = sortedByEnergyDescending(columnSamples).slice(0, samplesPerFroxel);

      const direction = froxelViewDirection(grid, columnX, columnY, options.frustum);
      const rayStretch = radialLengthFactor(direction);


      const directionTowardsCamera = { x: -direction.x, y: -direction.y, z: 1 };

      const opaqueDepth = readOpaqueDepthAtColumn ? readOpaqueDepthAtColumn(columnX, columnY) : null;
      const lastVisibleSlice = Number.isFinite(opaqueDepth)
        ? sliceIndexAtDistance(grid, opaqueDepth)
        : grid.depthSliceCount - 1;

      let columnTransmittance = 1;

      for (let sliceIndex = 0; sliceIndex !== grid.depthSliceCount; sliceIndex += 1) {
        const froxelOffset = froxelIndexOf(grid, columnX, columnY, sliceIndex) * FLOATS_PER_FROXEL;

        if (sliceIndex > lastVisibleSlice) {


          scattering[froxelOffset + 3] = columnTransmittance;
          occludedFroxelCount += 1;
          transmittanceSum += columnTransmittance;
          continue;
        }

        const centreInViewSpace = {
          x: direction.x * sliceCentreDistance(grid, sliceIndex),
          y: direction.y * sliceCentreDistance(grid, sliceIndex),
          z: -sliceCentreDistance(grid, sliceIndex),
        };
        const segmentLength = sliceThickness(grid, sliceIndex) * rayStretch;

        let inScatteredRed = 0;
        let inScatteredGreen = 0;
        let inScatteredBlue = 0;

        for (let sampleIndex = 0; sampleIndex !== rankedSamples.length; sampleIndex += 1) {
          const sample = rankedSamples[sampleIndex];
          reusedSampleCount += 1;
          if (sample.needsShadowTrace) shadowTracesInherited += 1;

          const resolved = resolveLightSampleAtFroxel
            ? resolveLightSampleAtFroxel({
                lightIndex: sample.lightIndex,
                energy: sample.energy,
                centreInViewSpace,
              })
            : null;

          if (!resolved) {


            isotropicFallbackCount += 1;
            const isotropic = Math.max(0, Number(sample.energy) || 0) / (4 * Math.PI);
            inScatteredRed += isotropic;
            inScatteredGreen += isotropic;
            inScatteredBlue += isotropic;
            continue;
          }

          const scattered = inScatteringFromLightSample({
            radiance: resolved.radiance,
            medium,
            cosineBetweenPhotonAndView: forwardScatteringCosine(
              resolved.directionTowardsLight,
              directionTowardsCamera,
            ),
            transmittanceToLight: resolved.transmittanceToLight,
          });
          inScatteredRed += scattered.red;
          inScatteredGreen += scattered.green;
          inScatteredBlue += scattered.blue;
        }

        const segment = integrateFroxelSegment({
          inScatteredRadiance: { red: inScatteredRed, green: inScatteredGreen, blue: inScatteredBlue },
          medium,
          segmentLength,
        });


        scattering[froxelOffset] = segment.scattering.red * columnTransmittance;
        scattering[froxelOffset + 1] = segment.scattering.green * columnTransmittance;
        scattering[froxelOffset + 2] = segment.scattering.blue * columnTransmittance;

        columnTransmittance *= segment.transmittance;
        scattering[froxelOffset + 3] = columnTransmittance;
        transmittanceSum += columnTransmittance;

        if (segment.scattering.red + segment.scattering.green + segment.scattering.blue > 0) {
          litFroxelCount += 1;
        }
      }
    }
  }

  return Object.freeze({
    resolved: true,
    refusal: VOLUME_FROXEL_REFUSAL.none,
    grid,
    scattering,
    stats: Object.freeze({
      froxelCount: grid.froxelCount,
      litFroxelCount,
      emptyFroxelCount: grid.froxelCount - litFroxelCount,
      occludedFroxelCount,
      columnCount: grid.columnsAcross * grid.columnsDown,
      columnsWithoutSamples,
      samplesPerFroxel,
      reusedSampleCount,
      shadowTracesInherited,
      isotropicFallbackCount,
      meanTransmittance: grid.froxelCount > 0 ? transmittanceSum / grid.froxelCount : 1,
    }),
  });
}
