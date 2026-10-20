import { mlQa } from "../runtime/megaLightsTelemetry.js";
import { isFlagActive, registerFlag } from "../runtime/megaLightsFlagRegistry.js";
import { FRAME_STAGE_SLOT, registerFrameStage } from "../mlFrameStages.js";
import { MGL_DISOCCLUSION_FRAME_COUNT, MGL_GATES } from "../mlPipelineContract.js";
import {
  DISOCCLUSION_OWNER,
  DISOCCLUSION_SIGNAL_CONTEXT_KEY,
  DISOCCLUSION_STAGE_NAME,
  createDisocclusionGlue,
} from "../mlDisocclusionGlue.js";
import { DISOCCLUSION_POLICY_DEFAULTS } from "../mlDisocclusionPolicyCore.js";
import { ANTI_FIREFLY_DEFAULTS } from "../mlAntiFireflyCore.js";
import {
  SHADING_CONFIDENCE_DEFAULTS,
  SHADING_CONFIDENCE_DEFINITION,
} from "../mlShadingConfidenceCore.js";

export const PHASE_ID = "ML-F22";
export const FLAG_ID = "MegaLightsDisocclusion";


const SHARED_LIGHTING_TEXTURE_UNITS = 0;


export const DISOCCLUSION_RESIDUALS = Object.freeze([
  "the published confidence is historyLengthAndRelativeVariance, not the contract's guidedEnergyFraction: that definition needs the visible light list of ML-F9, which is still a stub. The value carries its own definition so the two can never be confused",
  "MGL_BUFFERS.shadingConfidence (r8) is not allocated on the GPU yet: the confidence lives in a CPU array published on the frame context, so no texture unit is spent and no GLSL is injected",
  "the anti firefly clamp only judges pixels inside the disocclusion window, where a single bright sample can still dominate a short history. A converged pixel is already divided by its own frame count",
  "no GPU mirror yet: this is the CPU reference stage, and slot 240 of MGL_PATCH_ORDER stays reserved and unused",
  "the spatial sample budget fades to zero at MGL_DISOCCLUSION_FRAME_COUNT frames, so ML-F21 still owns every converged pixel: this phase never blurs one",
]);

export function installPhase(installContext) {
  const context = installContext || {};
  const telemetry = context.mlQa || mlQa;
  const bench = context.bench || null;
  const currentTier = () => (bench && bench.tier ? bench.tier : "medio");

  registerFlag({
    id: FLAG_ID,
    phase: PHASE_ID,
    description:
      "refines freshly disoccluded pixels: averages them in tonemapped space, clamps fireflies against the neighbourhood that saw the same surface, fills pixels with no history from ML-F19, and publishes a per pixel shading confidence",
    defaultsByTier: { fraco: false, medio: true, forte: true },
  });

  const stage = createDisocclusionGlue({ telemetry });

  registerFrameStage({
    stageName: DISOCCLUSION_STAGE_NAME,
    owner: DISOCCLUSION_OWNER,
    slot: FRAME_STAGE_SLOT[DISOCCLUSION_OWNER],
    isEnabled: () => isFlagActive(FLAG_ID, currentTier()),


    execute: (frameContext) => {
      stage.execute(frameContext);
    },
  });

  telemetry.phase(PHASE_ID, {
    implemented: true,
    title: "Disocclusion, anti firefly and shading confidence",
    block: "F",
    ownsPass: null,
    ownsFrameStage: DISOCCLUSION_STAGE_NAME,
    runsAfter: "mlPassGraph.executeGraph, so it can read the history length ML-F20 wrote",
    publishes: "frameContext." + DISOCCLUSION_SIGNAL_CONTEXT_KEY + " and frameContext.shadingConfidence",
    flag: FLAG_ID,
    sharedLightingTextureUnits: SHARED_LIGHTING_TEXTURE_UNITS,
    injectsGlslInSharedProgram: false,
    disocclusionFrameCount: MGL_DISOCCLUSION_FRAME_COUNT,
    policy: DISOCCLUSION_POLICY_DEFAULTS,
    antiFirefly: ANTI_FIREFLY_DEFAULTS,
    shadingConfidence: {
      definition: SHADING_CONFIDENCE_DEFINITION.historyLengthAndRelativeVariance,
      convergedFrameCount: SHADING_CONFIDENCE_DEFAULTS.convergedFrameCount,
      quantisationSteps: SHADING_CONFIDENCE_DEFAULTS.quantisationSteps,
      buffer: "shadingConfidence",
    },
    acceptance: {
      maxFireflyLuminanceRatio: MGL_GATES.maxFireflyLuminanceRatio,
      minShadingConfidenceCorrelation: MGL_GATES.minShadingConfidenceCorrelation,
      flagOffMinimumSsim: MGL_GATES.flagOffMinimumSsim,
      scene: "scene08 disocclusionSweep",
    },
    residuals: DISOCCLUSION_RESIDUALS,
    waitingFor:
      "nothing to run: ML-F19 publishes upsampledShading and ML-F20 publishes temporalFilteredShading, and both are consumed here. Only the guidedEnergyFraction definition of the confidence still waits for ML-F9",
  });

  return {
    implemented: true,
    phaseId: PHASE_ID,
    flagId: FLAG_ID,
    passName: null,
    frameStageName: DISOCCLUSION_STAGE_NAME,
    stage,
    inspect: () => stage.inspect(),
  };
}
