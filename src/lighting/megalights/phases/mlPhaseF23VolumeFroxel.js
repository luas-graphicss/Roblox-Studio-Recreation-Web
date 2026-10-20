import { mlQa } from "../runtime/megaLightsTelemetry.js";
import { isFlagActive, registerFlag } from "../runtime/megaLightsFlagRegistry.js";
import { FRAME_STAGE_SLOT, registerFrameStage } from "../mlFrameStages.js";
import * as pipelineContract from "../mlPipelineContract.js";
import {
  VOLUME_FROXEL_BUDGET,
  VOLUME_FROXEL_CONTEXT_KEY,
  VOLUME_FROXEL_OWNER,
  VOLUME_FROXEL_STAGE_NAME,
  VOLUME_TILE_SCALE,
  createVolumeFroxelGlue,
} from "../mlVolumeFroxelGlue.js";
import { FROXEL_GRID_DEFAULTS } from "../mlFroxelGridCore.js";
import { VOLUME_MEDIUM_DEFAULTS } from "../mlVolumeScatteringCore.js";

export const PHASE_ID = "ML-F23";
export const FLAG_ID = "MegaLightsVolumeFroxel";


const SHARED_LIGHTING_TEXTURE_UNITS = 0;
const DEFAULT_TIER = "medio";


export const VOLUME_FROXEL_RESIDUALS = Object.freeze([
  "no lobe resolver is wired yet: without resolveLightSampleAtFroxel the sweep scatters each reused sample isotropically and counts it in isotropicFallbackCount, so a shaft has the right ENERGY and not yet the right SHAPE",
  "no opaque depth reader is wired yet: readOpaqueDepthAtColumn is optional and, while no phase publishes a per column depth on the frame context, fog behind a wall is integrated in front of it. The parity gate spotShaftsWithoutRealOcclusion therefore stays notMeasured instead of green",
  "MGL_BUFFERS.volumeFroxel (rgba16f) is not allocated on the GPU: the scattering lives in a CPU Float32Array published on the frame context, so no texture unit is spent and slot 260 of MGL_PATCH_ORDER stays reserved and unused",
  "the samples are ML-F11 observations, which are screen tile observations: while ML-F11 publishes none the stage refuses with lightSamplesMissing instead of inventing a light",
  "this is the CPU reference path, so no number measured through it is a performance number",
]);

function reservedPatchOrderOf(phaseId) {
  const patchOrderByPhase = pipelineContract.MGL_PATCH_ORDER || {};
  const order = patchOrderByPhase[phaseId];
  return Number.isFinite(order) ? order : null;
}

function volumeSamplesPerFroxelByTier() {
  const samplesByTier = {};
  ["fraco", "medio", "forte"].forEach((tierName) => {
    const defaults =
      typeof pipelineContract.tierDefaults === "function" ? pipelineContract.tierDefaults(tierName) : null;
    samplesByTier[tierName] = defaults ? defaults.volumeSamplesPerFroxel : null;
  });
  return samplesByTier;
}

export function installPhase(installContext) {
  const context = installContext || {};
  const telemetry = context.mlQa || mlQa;
  const bench = context.bench || null;
  const currentTier = () => (bench && bench.tier ? bench.tier : DEFAULT_TIER);

  registerFlag({
    id: FLAG_ID,
    phase: PHASE_ID,
    description:
      "sweeps a camera aligned froxel grid and injects volumetric scattering, reusing the light samples and the traces the surface path already paid for instead of running a second visibility loop",
    defaultsByTier: { fraco: false, medio: true, forte: true },
  });

  const stage = createVolumeFroxelGlue({
    telemetry,
    medium: VOLUME_MEDIUM_DEFAULTS,
    maxSweptFroxels: VOLUME_FROXEL_BUDGET.maxSweptFroxels,
  });

  registerFrameStage({
    stageName: VOLUME_FROXEL_STAGE_NAME,
    owner: VOLUME_FROXEL_OWNER,
    slot: FRAME_STAGE_SLOT[VOLUME_FROXEL_OWNER],
    isEnabled: () => isFlagActive(FLAG_ID, currentTier()),


    execute: (frameContext) => {
      stage.execute(frameContext);
    },
  });

  telemetry.textureUnit(PHASE_ID, SHARED_LIGHTING_TEXTURE_UNITS);
  telemetry.phase(PHASE_ID, {
    implemented: true,
    title: "Volumetric fog froxel grid, shared with the surface path",
    block: "G",
    ownsPass: null,
    ownsFrameStage: VOLUME_FROXEL_STAGE_NAME,
    runsAfter: "mlPassGraph.executeGraph, so it can read the samples ML-F11 generated this frame",
    publishes: "frameContext." + VOLUME_FROXEL_CONTEXT_KEY,
    flag: FLAG_ID,
    sharedLightingTextureUnits: SHARED_LIGHTING_TEXTURE_UNITS,
    injectsGlslInSharedProgram: false,
    reservedPatchOrder: reservedPatchOrderOf(PHASE_ID),
    reservedPatchOrderIsUsedBy: null,
    writesBuffers: ["volumeFroxel"],
    grid: {
      tileSizeInPixels: FROXEL_GRID_DEFAULTS.tileSizeInPixels * VOLUME_TILE_SCALE,
      froxelColumnCoversTraceTiles: VOLUME_TILE_SCALE * VOLUME_TILE_SCALE,
      depthSliceCount: VOLUME_FROXEL_BUDGET.depthSliceCount,
      depthDistribution: "geometric",
      maxSweptFroxels: VOLUME_FROXEL_BUDGET.maxSweptFroxels,
      budgetPaidIn: "depth slices, never columns: the tile alignment is what makes the reuse exact",
    },
    medium: VOLUME_MEDIUM_DEFAULTS,
    volumeSamplesPerFroxelByTier: volumeSamplesPerFroxelByTier(),
    reuses: "ML-F11:lightSampleObservations - no light is sampled here and no ray is traced here",
    acceptance: {
      scene: "scene06 streetlight shafts",
      flagOffMinimumSsim: pipelineContract.MGL_GATES.flagOffMinimumSsim,
      costShareRespected: "froxel count capped by maxSweptFroxels, slices dropped before columns",
    },
    residuals: VOLUME_FROXEL_RESIDUALS,
    waitingFor:
      "ML-F11: the stage runs every frame and refuses with lightSamplesMissing until frameContext.lightSampleObservations arrives, which is the honest answer instead of fog nobody lit",
  });

  return {
    implemented: true,
    phaseId: PHASE_ID,
    flagId: FLAG_ID,
    passName: null,
    frameStageName: VOLUME_FROXEL_STAGE_NAME,
    stage,
    inspect: () => stage.inspect(),
  };
}
