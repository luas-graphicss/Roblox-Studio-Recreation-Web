import * as pipelineContract from "./mlPipelineContract.js";
import { froxelCentreInViewSpace } from "./mlFroxelGridCore.js";
import {
  SPHERICAL_HARMONIC_BAND_COUNT,
  evaluateIrradiance,
  normalizedDirectionOf,
} from "./mlSphericalHarmonicsCore.js";
import {
  WORLD_VOXEL_GRID_DEFAULTS,
  describeWorldVoxelGrid,
  isInsideWorldVoxelGrid,
  resolveWorldVoxelGrid,
  worldVoxelCoordinatesAt,
  worldVoxelIndexOf,
} from "./mlWorldVoxelGridCore.js";
import { createWorldVoxelShStore } from "./mlWorldVoxelShStoreCore.js";
import { resolveWorldVoxelShFrame } from "./mlWorldVoxelFrameCore.js";
import { VOLUME_FROXEL_CONTEXT_KEY, VOLUME_FROXEL_OWNER } from "./mlVolumeFroxelGlue.js";

export const WORLD_VOXEL_OWNER = "ML-F24";
export const WORLD_VOXEL_STAGE_NAME = "worldVoxelShGrid";
export const WORLD_VOXEL_CONTEXT_KEY = "worldVoxelShGrid";

export const WORLD_VOXEL_GLUE_REFUSAL = Object.freeze({
  none: "none",
  samplesDisabledByTier: "samplesDisabledByTier",
  cameraMissing: "cameraMissing",
  volumeFroxelGridMissing: "volumeFroxelGridMissing",
  sweepRefused: "sweepRefused",
});

const DEFAULT_TIER = "medio";


const DEFAULT_MAX_REUSED_FROXELS = 16384;

function tierNameOf(context) {
  return typeof context.tier === "string" && context.tier ? context.tier : DEFAULT_TIER;
}


function samplesPerVoxelFor(tierName) {
  const defaults =
    typeof pipelineContract.tierDefaults === "function" ? pipelineContract.tierDefaults(tierName) : null;
  const samples = defaults ? Number(defaults.volumeSamplesPerFroxel) : 0;
  return Number.isFinite(samples) && samples > 0 ? Math.floor(samples) : 0;
}

function positiveIntegerOr(value, fallback) {
  const candidate = Number(value);
  return Number.isFinite(candidate) && candidate >= 1 ? Math.floor(candidate) : fallback;
}

function cameraMatrixElementsOf(camera) {
  const matrixWorld = camera && camera.matrixWorld ? camera.matrixWorld : null;
  const elements = matrixWorld && matrixWorld.elements ? matrixWorld.elements : null;
  return elements && elements.length >= 16 ? elements : null;
}

function cameraWorldPositionOf(camera, matrixElements) {
  if (matrixElements) {
    return { x: matrixElements[12], y: matrixElements[13], z: matrixElements[14] };
  }
  const position = camera && camera.position ? camera.position : null;
  if (!position || !Number.isFinite(Number(position.x))) return null;
  return { x: Number(position.x), y: Number(position.y), z: Number(position.z) };
}


function viewPointToWorld(matrixElements, point) {
  if (!matrixElements) return { x: point.x, y: point.y, z: point.z };
  return {
    x:
      matrixElements[0] * point.x +
      matrixElements[4] * point.y +
      matrixElements[8] * point.z +
      matrixElements[12],
    y:
      matrixElements[1] * point.x +
      matrixElements[5] * point.y +
      matrixElements[9] * point.z +
      matrixElements[13],
    z:
      matrixElements[2] * point.x +
      matrixElements[6] * point.y +
      matrixElements[10] * point.z +
      matrixElements[14],
  };
}

function frustumOf(volumeFroxelGrid) {
  const frustum = volumeFroxelGrid.frustum || null;
  if (!frustum) return null;
  const tanHalfFieldOfViewY = Number(frustum.tanHalfFieldOfViewY);
  const aspectRatio = Number(frustum.aspectRatio);
  if (!(tanHalfFieldOfViewY > 0) || !(aspectRatio > 0)) return null;
  return frustum;
}


function bucketFroxelsIntoVoxels(request) {
  const volumeFroxelGrid = request.volumeFroxelGrid;
  const froxelGrid = volumeFroxelGrid.grid;
  const readFroxel = volumeFroxelGrid.readFroxel;
  const frustum = request.frustum;
  const worldVoxelGrid = request.worldVoxelGrid;
  const matrixElements = request.cameraMatrixElements;
  const maxReusedFroxels = request.maxReusedFroxels;
  const resolveLightDirectionAtPoint = request.resolveLightDirectionAtPoint;

  const samplesByVoxelIndex = new Map();
  let reusedFroxelCount = 0;
  let froxelsOutsideGrid = 0;
  let darkFroxelsSkipped = 0;
  let resolvedLightDirectionCount = 0;
  let budgetReached = false;

  for (let sliceIndex = 0; sliceIndex !== froxelGrid.depthSliceCount && !budgetReached; sliceIndex += 1) {
    for (let columnY = 0; columnY !== froxelGrid.columnsDown && !budgetReached; columnY += 1) {
      for (let columnX = 0; columnX !== froxelGrid.columnsAcross; columnX += 1) {
        if (reusedFroxelCount >= maxReusedFroxels) {
          budgetReached = true;
          break;
        }

        const froxel = readFroxel(columnX, columnY, sliceIndex);
        if (!froxel) continue;

        const energy = froxel.red + froxel.green + froxel.blue;
        if (!(energy > 0)) {


          darkFroxelsSkipped += 1;
          continue;
        }

        const centreInView = froxelCentreInViewSpace(froxelGrid, columnX, columnY, sliceIndex, frustum);
        const centreInWorld = viewPointToWorld(matrixElements, centreInView);
        const voxel = worldVoxelCoordinatesAt(worldVoxelGrid, centreInWorld);
        if (!voxel) {
          froxelsOutsideGrid += 1;
          continue;
        }

        const voxelIndex = worldVoxelIndexOf(worldVoxelGrid, voxel.x, voxel.y, voxel.z);
        let bucket = samplesByVoxelIndex.get(voxelIndex);
        if (!bucket) {
          bucket = [];
          samplesByVoxelIndex.set(voxelIndex, bucket);
        }

        const sample = {
          energy,
          radiance: { red: froxel.red, green: froxel.green, blue: froxel.blue },
        };

        if (resolveLightDirectionAtPoint) {
          const direction = resolveLightDirectionAtPoint(centreInWorld);
          if (direction) {
            sample.directionTowardsLight = normalizedDirectionOf(direction);
            resolvedLightDirectionCount += 1;
          }
        }


        bucket.push(sample);
        reusedFroxelCount += 1;
      }
    }
  }

  return {
    samplesByVoxelIndex,
    reusedFroxelCount,
    froxelsOutsideGrid,
    darkFroxelsSkipped,
    resolvedLightDirectionCount,
    budgetReached,
  };
}


export function createWorldVoxelGridGlue(options) {
  const settings = options || {};
  const telemetry = settings.telemetry || null;
  const voxelSizeInMeters = settings.voxelSizeInMeters || WORLD_VOXEL_GRID_DEFAULTS.voxelSizeInMeters;
  const voxelsAcross = positiveIntegerOr(settings.voxelsAcross, WORLD_VOXEL_GRID_DEFAULTS.voxelsAcross);
  const voxelsUp = positiveIntegerOr(settings.voxelsUp, WORLD_VOXEL_GRID_DEFAULTS.voxelsUp);
  const voxelsDeep = positiveIntegerOr(settings.voxelsDeep, WORLD_VOXEL_GRID_DEFAULTS.voxelsDeep);
  const maxVoxelCount = positiveIntegerOr(settings.maxVoxelCount, WORLD_VOXEL_GRID_DEFAULTS.maxVoxelCount);
  const maxReusedFroxels = positiveIntegerOr(settings.maxReusedFroxels, DEFAULT_MAX_REUSED_FROXELS);
  const resolveLightDirectionAtPoint =
    typeof settings.resolveLightDirectionAtPoint === "function" ? settings.resolveLightDirectionAtPoint : null;

  const store = createWorldVoxelShStore({ historyFrameCeiling: settings.historyFrameCeiling });
  let lastFrameReport = null;

  function report(values) {
    lastFrameReport = values;
    if (telemetry && typeof telemetry.phase === "function") {
      telemetry.phase(WORLD_VOXEL_OWNER, values);
    }
  }

  function refuse(refusal, extraValues) {
    report(
      Object.assign(
        {
          stage: WORLD_VOXEL_STAGE_NAME,
          runsAfter: VOLUME_FROXEL_OWNER + ":" + VOLUME_FROXEL_CONTEXT_KEY,
          publishes: null,
          refusal,
        },
        extraValues || {},
      ),
    );
  }

  function publish(context, worldVoxelGrid, frame, bucketed, reanchor) {
    const coefficients = store.coefficientsView();

    context[WORLD_VOXEL_CONTEXT_KEY] = {
      owner: WORLD_VOXEL_OWNER,
      reusedFrom: VOLUME_FROXEL_OWNER + ":" + VOLUME_FROXEL_CONTEXT_KEY,
      grid: worldVoxelGrid,
      bands: SPHERICAL_HARMONIC_BAND_COUNT,
      anchoredTo: worldVoxelGrid.anchoredTo,
      reanchor,

      readSphericalHarmonics: (voxelX, voxelY, voxelZ) => {
        if (!isInsideWorldVoxelGrid(worldVoxelGrid, voxelX, voxelY, voxelZ)) return null;
        return store.readVoxel(worldVoxelIndexOf(worldVoxelGrid, voxelX, voxelY, voxelZ));
      },

      evaluateIrradianceAt: (positionInWorld, direction) => {
        const voxel = worldVoxelCoordinatesAt(worldVoxelGrid, positionInWorld);
        if (!voxel) return null;
        return evaluateIrradiance(
          coefficients,
          worldVoxelIndexOf(worldVoxelGrid, voxel.x, voxel.y, voxel.z),
          direction,
        );
      },

      accumulatedFrameCountAt: (voxelX, voxelY, voxelZ) => {
        if (!isInsideWorldVoxelGrid(worldVoxelGrid, voxelX, voxelY, voxelZ)) return 0;
        return store.frameCountAt(worldVoxelIndexOf(worldVoxelGrid, voxelX, voxelY, voxelZ));
      },
      counters: Object.assign({}, frame.stats, {
        reusedFroxelCount: bucketed.reusedFroxelCount,
        froxelsOutsideGrid: bucketed.froxelsOutsideGrid,
        darkFroxelsSkipped: bucketed.darkFroxelsSkipped,
        resolvedLightDirectionCount: bucketed.resolvedLightDirectionCount,
        reusedFroxelBudgetReached: bucketed.budgetReached,


        lightSamplesTracedHere: 0,
        raysTracedHere: 0,
      }),
    };
  }

  function execute(frameContext) {
    const context = frameContext || {};
    const tierName = tierNameOf(context);
    const samplesPerVoxel = samplesPerVoxelFor(tierName);

    if (samplesPerVoxel === 0) {
      refuse(WORLD_VOXEL_GLUE_REFUSAL.samplesDisabledByTier, { tier: tierName });
      return lastFrameReport;
    }

    const camera = context.camera || null;
    const cameraMatrixElements = cameraMatrixElementsOf(camera);
    const cameraPositionInWorld = cameraWorldPositionOf(camera, cameraMatrixElements);
    if (!cameraPositionInWorld) {
      refuse(WORLD_VOXEL_GLUE_REFUSAL.cameraMissing);
      return lastFrameReport;
    }

    const volumeFroxelGrid = context[VOLUME_FROXEL_CONTEXT_KEY] || null;
    const frustum = volumeFroxelGrid ? frustumOf(volumeFroxelGrid) : null;
    const froxelGridReadable =
      !!volumeFroxelGrid && !!volumeFroxelGrid.grid && typeof volumeFroxelGrid.readFroxel === "function";
    if (!froxelGridReadable || !frustum) {
      refuse(WORLD_VOXEL_GLUE_REFUSAL.volumeFroxelGridMissing, {
        needs: "frameContext." + VOLUME_FROXEL_CONTEXT_KEY + " from " + VOLUME_FROXEL_OWNER,
        tier: tierName,
      });
      return lastFrameReport;
    }

    const worldVoxelGrid = resolveWorldVoxelGrid({
      centredOnWorldPosition: cameraPositionInWorld,
      voxelSizeInMeters,
      voxelsAcross,
      voxelsUp,
      voxelsDeep,
      maxVoxelCount,
    });
    const reanchor = store.resolve(worldVoxelGrid);

    const bucketed = bucketFroxelsIntoVoxels({
      volumeFroxelGrid,
      frustum,
      worldVoxelGrid,
      cameraMatrixElements,
      maxReusedFroxels,
      resolveLightDirectionAtPoint,
    });

    const frame = resolveWorldVoxelShFrame({
      grid: worldVoxelGrid,
      store,
      samplesPerVoxel,
      maxSweptVoxels: maxVoxelCount,
      readVoxelLightSamples: (voxelX, voxelY, voxelZ) =>
        bucketed.samplesByVoxelIndex.get(worldVoxelIndexOf(worldVoxelGrid, voxelX, voxelY, voxelZ)) || [],
    });

    if (!frame.resolved) {
      refuse(WORLD_VOXEL_GLUE_REFUSAL.sweepRefused, {
        sweepRefusal: frame.refusal,
        tier: tierName,
        grid: describeWorldVoxelGrid(worldVoxelGrid),
      });
      return lastFrameReport;
    }

    publish(context, worldVoxelGrid, frame, bucketed, reanchor.reanchor);

    report({
      stage: WORLD_VOXEL_STAGE_NAME,
      runsAfter: VOLUME_FROXEL_OWNER + ":" + VOLUME_FROXEL_CONTEXT_KEY,
      publishes: "frameContext." + WORLD_VOXEL_CONTEXT_KEY,
      refusal: WORLD_VOXEL_GLUE_REFUSAL.none,
      tier: tierName,
      grid: describeWorldVoxelGrid(worldVoxelGrid),
      reanchor: reanchor.reanchor,
      bandsStored: SPHERICAL_HARMONIC_BAND_COUNT,
      bandsCarryingDirection: bucketed.resolvedLightDirectionCount > 0 ? 2 : 1,
      lightDirectionResolverWired: !!resolveLightDirectionAtPoint,
      store: store.describe(),
      counters: Object.assign({}, frame.stats, {
        reusedFroxelCount: bucketed.reusedFroxelCount,
        froxelsOutsideGrid: bucketed.froxelsOutsideGrid,
        darkFroxelsSkipped: bucketed.darkFroxelsSkipped,
        resolvedLightDirectionCount: bucketed.resolvedLightDirectionCount,
        reusedFroxelBudgetReached: bucketed.budgetReached,
        lightSamplesTracedHere: 0,
        raysTracedHere: 0,
      }),
    });

    return lastFrameReport;
  }

  return {
    execute,
    inspect: () => ({
      owner: WORLD_VOXEL_OWNER,
      stageName: WORLD_VOXEL_STAGE_NAME,
      contextKey: WORLD_VOXEL_CONTEXT_KEY,
      voxelSizeInMeters,
      voxelsAcross,
      voxelsUp,
      voxelsDeep,
      maxVoxelCount,
      maxReusedFroxels,
      lightDirectionResolverWired: !!resolveLightDirectionAtPoint,
      store: store.describe(),
    }),
    store: () => store,
    lastFrame: () => lastFrameReport,
  };
}
