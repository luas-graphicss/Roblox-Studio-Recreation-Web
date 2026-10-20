import {
  MGL_GUIDING_TILE_SIZE,
  MGL_TRACE_TILE_SIZE,
  tierDefaults,
} from "./mlPipelineContract.js";
import {
  FROXEL_GRID_DEFAULTS,
  resolveFroxelGrid,
  sliceIndexAtDistance,
} from "./mlFroxelGridCore.js";
import { VOLUME_MEDIUM_DEFAULTS } from "./mlVolumeScatteringCore.js";
import { resolveVolumeFroxelFrame } from "./mlVolumeFroxelFrameCore.js";

export const VOLUME_FROXEL_OWNER = "ML-F23";
export const VOLUME_FROXEL_STAGE_NAME = "volumeFroxelGrid";
export const VOLUME_FROXEL_CONTEXT_KEY = "volumeFroxelGrid";


export const VOLUME_TILE_SCALE = 2;


export const VOLUME_FROXEL_BUDGET = Object.freeze({
  maxSweptFroxels: 16384,
  depthSliceCount: 24,
});

export const VOLUME_FROXEL_GLUE_REFUSAL = Object.freeze({
  none: "none",
  samplesDisabledByTier: "samplesDisabledByTier",
  viewportMissing: "viewportMissing",
  perspectiveCameraMissing: "perspectiveCameraMissing",
  lightSamplesMissing: "lightSamplesMissing",
  sweepRefused: "sweepRefused",
});

const DEGREES_TO_RADIANS = Math.PI / 180;

function positiveNumberOr(value, fallback) {
  const candidate = Number(value);
  return Number.isFinite(candidate) && candidate > 0 ? candidate : fallback;
}

function tierNameOf(frameContext) {
  return typeof frameContext.tier === "string" ? frameContext.tier : "medio";
}

function viewportOf(frameContext) {
  const size = frameContext.drawingBufferSize || null;
  if (!size) return null;
  const width = Math.floor(positiveNumberOr(size.x, 0));
  const height = Math.floor(positiveNumberOr(size.y, 0));
  if (width === 0 || height === 0) return null;
  return { width, height };
}


function frustumOf(camera, viewport) {
  const verticalFieldOfView = positiveNumberOr(camera.fov, 0);
  if (verticalFieldOfView === 0) return null;
  return {
    tanHalfFieldOfViewY: Math.tan((verticalFieldOfView * DEGREES_TO_RADIANS) / 2),
    aspectRatio: positiveNumberOr(camera.aspect, viewport.width / viewport.height),
  };
}


function bucketObservationsByColumn(observations, grid) {
  const samplesByColumnIndex = new Map();
  let bucketedCount = 0;

  for (let index = 0; index !== observations.length; index += 1) {
    const observation = observations[index];
    if (!observation) continue;

    const pixelX = (Number(observation.tileX) || 0) * MGL_GUIDING_TILE_SIZE;
    const pixelY = (Number(observation.tileY) || 0) * MGL_GUIDING_TILE_SIZE;
    const columnX = Math.min(grid.columnsAcross - 1, Math.floor(pixelX / grid.tileSizeInPixels));
    const columnY = Math.min(grid.columnsDown - 1, Math.floor(pixelY / grid.tileSizeInPixels));

    const columnIndex = columnY * grid.columnsAcross + columnX;
    let bucket = samplesByColumnIndex.get(columnIndex);
    if (!bucket) {
      bucket = [];
      samplesByColumnIndex.set(columnIndex, bucket);
    }
    bucket.push({
      lightIndex: observation.lightIndex,
      energy: Math.max(0, Number(observation.energy) || 0),
      needsShadowTrace: !!observation.needsShadowTrace,
    });
    bucketedCount += 1;
  }

  return { samplesByColumnIndex, bucketedCount };
}

function froxelReaderFor(grid, scattering) {
  return function readFroxel(columnX, columnY, sliceIndex) {
    const insideGrid =
      columnX >= 0 &&
      columnY >= 0 &&
      sliceIndex >= 0 &&
      !(columnX >= grid.columnsAcross) &&
      !(columnY >= grid.columnsDown) &&
      !(sliceIndex >= grid.depthSliceCount);
    if (!insideGrid) return null;

    const offset = ((sliceIndex * grid.columnsDown + columnY) * grid.columnsAcross + columnX) * 4;
    return Object.freeze({
      red: scattering[offset],
      green: scattering[offset + 1],
      blue: scattering[offset + 2],
      transmittance: scattering[offset + 3],
    });
  };
}


export function createVolumeFroxelGlue(options) {
  const settings = options || {};
  const telemetry = settings.telemetry || null;
  const medium = settings.medium || VOLUME_MEDIUM_DEFAULTS;
  const maxSweptFroxels = Math.max(
    1,
    Math.floor(positiveNumberOr(settings.maxSweptFroxels, VOLUME_FROXEL_BUDGET.maxSweptFroxels)),
  );
  const tileSizeInPixels = MGL_TRACE_TILE_SIZE * VOLUME_TILE_SCALE;
  const resolveLightSampleAtFroxel =
    typeof settings.resolveLightSampleAtFroxel === "function" ? settings.resolveLightSampleAtFroxel : null;

  let lastFrameReport = null;

  function report(values) {
    lastFrameReport = values;
    if (telemetry && typeof telemetry.phase === "function") {
      telemetry.phase(VOLUME_FROXEL_OWNER, values);
    }
  }

  function refuse(refusal, extraValues) {
    report(
      Object.assign(
        {
          stage: VOLUME_FROXEL_STAGE_NAME,
          runsAfter: "ML-F11:lightSampleGeneration",
          publishes: null,
          refusal,
        },
        extraValues || {},
      ),
    );
  }

  function execute(frameContext) {
    const context = frameContext || {};

    const samplesPerFroxel = Math.max(
      0,
      Math.floor(Number(tierDefaults(tierNameOf(context)).volumeSamplesPerFroxel) || 0),
    );
    if (samplesPerFroxel === 0) {


      refuse(VOLUME_FROXEL_GLUE_REFUSAL.samplesDisabledByTier, { tier: tierNameOf(context) });
      return lastFrameReport;
    }

    const viewport = viewportOf(context);
    if (!viewport) {
      refuse(VOLUME_FROXEL_GLUE_REFUSAL.viewportMissing);
      return lastFrameReport;
    }

    const camera = context.camera || null;
    const frustum = camera ? frustumOf(camera, viewport) : null;
    if (!frustum) {
      refuse(VOLUME_FROXEL_GLUE_REFUSAL.perspectiveCameraMissing);
      return lastFrameReport;
    }

    const observations = Array.isArray(context.lightSampleObservations)
      ? context.lightSampleObservations
      : [];
    const lightSampleHandle = context.lightSamples || null;
    const sharedWorkAvailable = observations.length > 0 || !!(lightSampleHandle && lightSampleHandle.ready);
    if (!sharedWorkAvailable) {


      refuse(VOLUME_FROXEL_GLUE_REFUSAL.lightSamplesMissing, {
        needs: "frameContext.lightSampleObservations from ML-F11",
      });
      return lastFrameReport;
    }

    const grid = resolveFroxelGrid({
      renderWidth: viewport.width,
      renderHeight: viewport.height,
      tileSizeInPixels,
      depthSliceCount: VOLUME_FROXEL_BUDGET.depthSliceCount,
      maxFroxelCount: maxSweptFroxels,
      nearDistance: Math.max(FROXEL_GRID_DEFAULTS.nearDistance, positiveNumberOr(camera.near, 0)),
      farDistance: Math.min(FROXEL_GRID_DEFAULTS.farDistance, positiveNumberOr(camera.far, FROXEL_GRID_DEFAULTS.farDistance)),
    });

    const bucketed = bucketObservationsByColumn(observations, grid);
    const readColumnLightSamples = (columnX, columnY) =>
      bucketed.samplesByColumnIndex.get(columnY * grid.columnsAcross + columnX) || [];

    const frame = resolveVolumeFroxelFrame({
      grid,
      frustum,
      medium,
      samplesPerFroxel,
      readColumnLightSamples,
      resolveLightSampleAtFroxel,
      maxSweptFroxels,
    });

    if (!frame.resolved) {
      refuse(VOLUME_FROXEL_GLUE_REFUSAL.sweepRefused, { sweepRefusal: frame.refusal });
      return lastFrameReport;
    }

    context[VOLUME_FROXEL_CONTEXT_KEY] = {
      owner: VOLUME_FROXEL_OWNER,
      reusedFrom: "ML-F11:lightSampleGeneration",
      grid,


      frustum,
      scattering: frame.scattering,
      readFroxel: froxelReaderFor(grid, frame.scattering),
      sliceIndexAtDistance: (distance) => sliceIndexAtDistance(grid, distance),
      counters: frame.stats,
    };

    report({
      stage: VOLUME_FROXEL_STAGE_NAME,
      runsAfter: "ML-F11:lightSampleGeneration",
      publishes: `frameContext.${VOLUME_FROXEL_CONTEXT_KEY}`,
      refusal: VOLUME_FROXEL_GLUE_REFUSAL.none,
      tier: tierNameOf(context),
      tileSizeInPixels: grid.tileSizeInPixels,
      columnsAcross: grid.columnsAcross,
      columnsDown: grid.columnsDown,
      depthSliceCount: grid.depthSliceCount,
      depthSlicesDroppedForBudget: grid.depthSlicesDroppedForBudget,
      froxelCount: grid.froxelCount,
      observationsBucketed: bucketed.bucketedCount,
      medium: {
        scatteringCoefficient: medium.scatteringCoefficient,
        absorptionCoefficient: medium.absorptionCoefficient,
        anisotropy: medium.anisotropy,
      },
      anisotropyApplied: !!resolveLightSampleAtFroxel,
      counters: frame.stats,
    });

    return lastFrameReport;
  }

  return {
    execute,
    inspect: () => ({
      owner: VOLUME_FROXEL_OWNER,
      stageName: VOLUME_FROXEL_STAGE_NAME,
      contextKey: VOLUME_FROXEL_CONTEXT_KEY,
      tileSizeInPixels,
      maxSweptFroxels,
      anisotropyApplied: !!resolveLightSampleAtFroxel,
    }),
    lastFrame: () => lastFrameReport,
  };
}
