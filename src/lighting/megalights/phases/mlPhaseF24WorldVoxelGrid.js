import { mlQa } from "../runtime/megaLightsTelemetry.js";
import { isFlagActive, registerFlag } from "../runtime/megaLightsFlagRegistry.js";
import { FRAME_STAGE_SLOT, registerFrameStage } from "../mlFrameStages.js";
import * as pipelineContract from "../mlPipelineContract.js";
import {
  WORLD_VOXEL_CONTEXT_KEY,
  WORLD_VOXEL_OWNER,
  WORLD_VOXEL_STAGE_NAME,
  createWorldVoxelGridGlue,
} from "../mlWorldVoxelGridGlue.js";
import { WORLD_VOXEL_GRID_DEFAULTS } from "../mlWorldVoxelGridCore.js";
import { WORLD_VOXEL_HISTORY_FRAME_CEILING } from "../mlWorldVoxelShStoreCore.js";
import {
  SPHERICAL_HARMONIC_BAND_COUNT,
  SPHERICAL_HARMONIC_FLOATS_PER_VOXEL,
} from "../mlSphericalHarmonicsCore.js";

export const PHASE_ID = "ML-F24";
export const FLAG_ID = "MegaLightsWorldVoxelGrid";


const SHARED_LIGHTING_TEXTURE_UNITS = 0;
const DEFAULT_TIER = "medio";

export const WORLD_VOXEL_RESIDUALS = Object.freeze([
  "band 1 stays at zero until a light direction resolver is wired: the reused froxel energy is already integrated towards the camera, and writing the camera direction into a world anchored voxel would make the stored lighting depend on where the player is looking - the swimming this phase exists to remove. The energy is therefore stored isotropically and isotropicFallbackCount says exactly how much, while bandsCarryingDirection reports 1 instead of 2",
  "MGL_BUFFERS.worldVoxelSh (rgba16f, two texels) is not allocated on the GPU and its layout stays reserved in MGL_BUFFER_LAYOUTS: the CPU reference keeps all 12 floats per voxel, which is more than a two texel upload can carry, and freezing that packing is a contract change this phase does not need yet",
  "no GPU mirror: slot 280 of MGL_PATCH_ORDER stays reserved and unused, no GLSL is injected in the shared lighting program and the reserved uniforms uMglWorldVoxelSh and uMglWorldVoxelGridSize are deliberately NOT registered - a uniform with no shader to read it is dead weight",
  "the consumer does not exist yet: ML-F25 (hair, particles, translucents) is what reads this grid, so today it is published on the frame context and read by QA alone",
  "the measured saving of the hybrid (parity term sharedSamplingAndTracing, at least 15%) stays notMeasured: there is no second implementation paying for its own sampling to compare against, and the honest numbers are the hard zeros lightSamplesTracedHere and raysTracedHere",
  "voxels no froxel lands in keep the light the world left there instead of blending towards black, so a voxel behind the camera holds old light and accumulatedFrameCountAt is how a reader tells how old",
]);

function reservedPatchOrderOf(phaseId) {
  const patchOrderByPhase = pipelineContract.MGL_PATCH_ORDER || {};
  const order = patchOrderByPhase[phaseId];
  return Number.isFinite(order) ? order : null;
}

function volumeSamplesPerVoxelByTier() {
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
      "accumulates two bands of spherical harmonics in a grid anchored to the world, reusing the volumetric froxels of ML-F23 so hair, particles and translucents can be lit without a second sampling pass",
    defaultsByTier: { fraco: false, medio: true, forte: true },
  });

  const stage = createWorldVoxelGridGlue({ telemetry });

  registerFrameStage({
    stageName: WORLD_VOXEL_STAGE_NAME,
    owner: WORLD_VOXEL_OWNER,


    slot: FRAME_STAGE_SLOT[WORLD_VOXEL_OWNER],
    isEnabled: () => isFlagActive(FLAG_ID, currentTier()),



    execute: (frameContext) => {
      stage.execute(frameContext);
    },
  });

  telemetry.textureUnit(PHASE_ID, SHARED_LIGHTING_TEXTURE_UNITS);
  telemetry.phase(PHASE_ID, {
    implemented: true,
    title: "World anchored voxel grid of two band spherical harmonics",
    block: "G",
    ownsPass: null,
    ownsFrameStage: WORLD_VOXEL_STAGE_NAME,
    runsAfter: "ML-F23:volumeFroxelGrid, in the same frame",
    publishes: "frameContext." + WORLD_VOXEL_CONTEXT_KEY,
    flag: FLAG_ID,
    sharedLightingTextureUnits: SHARED_LIGHTING_TEXTURE_UNITS,
    injectsGlslInSharedProgram: false,
    reservedPatchOrder: reservedPatchOrderOf(PHASE_ID),
    reservedPatchOrderIsUsedBy: null,
    reservedUniformsNotRegistered: ["uMglWorldVoxelSh", "uMglWorldVoxelGridSize"],
    writesBuffers: ["worldVoxelSh"],
    grid: {
      anchoredTo: "world",
      voxelSizeInMeters: WORLD_VOXEL_GRID_DEFAULTS.voxelSizeInMeters,
      voxelsAcross: WORLD_VOXEL_GRID_DEFAULTS.voxelsAcross,
      voxelsUp: WORLD_VOXEL_GRID_DEFAULTS.voxelsUp,
      voxelsDeep: WORLD_VOXEL_GRID_DEFAULTS.voxelsDeep,
      maxVoxelCount: WORLD_VOXEL_GRID_DEFAULTS.maxVoxelCount,
      budgetPaidIn: "vertical layers, never horizontal extent: a camera outside its own grid reads nothing",
      originSnappedToVoxelSize: true,
    },
    sphericalHarmonics: {
      bands: SPHERICAL_HARMONIC_BAND_COUNT,
      coefficientsPerChannel: 4,
      floatsPerVoxel: SPHERICAL_HARMONIC_FLOATS_PER_VOXEL,
      readBackWith: "evaluateIrradiance, clamped at zero because two bands cannot represent a hard cut",
    },
    history: {
      frameCeiling: WORLD_VOXEL_HISTORY_FRAME_CEILING,
      blendWeight: "1/(n+1), so the first frame of a voxel takes its sample whole",
      onCameraCrossingAVoxel: "the history is shifted to the new index, never cleared",
    },
    volumeSamplesPerFroxelByTier: volumeSamplesPerVoxelByTier(),
    reuses: "ML-F23:volumeFroxelGrid, which reuses ML-F11:lightSampleObservations",
    acceptance: {
      scene: "scene06 streetlight shafts, walked through so the grid re-anchors",
      flagOffMinimumSsim: pipelineContract.MGL_GATES.flagOffMinimumSsim,
      anchorProof: "moving the camera less than one voxel must not move the grid origin",
    },
    residuals: WORLD_VOXEL_RESIDUALS,
    waitingFor:
      "ML-F23: the stage runs every frame and refuses with volumeFroxelGridMissing until frameContext.volumeFroxelGrid arrives, which is the honest answer instead of a grid lit by nobody",
  });

  return {
    implemented: true,
    phaseId: PHASE_ID,
    flagId: FLAG_ID,
    passName: null,
    frameStageName: WORLD_VOXEL_STAGE_NAME,
    stage,
    inspect: () => stage.inspect(),
  };
}
