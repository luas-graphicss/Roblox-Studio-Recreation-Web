import { mlQa } from "../runtime/megaLightsTelemetry.js";
import { isFlagActive, registerFlag } from "../runtime/megaLightsFlagRegistry.js";
import { registerPass } from "../mlPassGraph.js";
import { MGL_PATCH_ORDER } from "../mlPipelineContract.js";
import {
  SPATIAL_FILTER_CONTEXT_KEY,
  SPATIAL_FILTER_INPUT_CONTEXT_KEY,
  SPATIAL_FILTER_OWNER,
  SPATIAL_FILTER_PASS_NAME,
  SPATIAL_FILTER_RESIDUALS,
  createSpatialFilterPass,
} from "../mlSpatialFilterGlue.js";
import { SPATIAL_FILTER_GATES } from "../mlSpatialFilterGatesCore.js";
import { describeSpatialKernel } from "../mlSpatialFilterKernelCore.js";

export const PHASE_ID = "ML-F21";
export const FLAG_ID = "MegaLightsSpatialFilter";


const SHARED_LIGHTING_TEXTURE_UNITS = 0;

export function installPhase(installContext) {
  const context = installContext || {};
  const telemetry = context.mlQa || mlQa;
  const bench = context.bench || null;
  const currentTier = () => (bench && bench.tier ? bench.tier : "medio");

  registerFlag({
    id: FLAG_ID,
    phase: PHASE_ID,
    description:
      "spends the variance measured by ML-F20: a sparse 8 tap kernel, rotated per pixel and per frame, whose radius grows with the noise and whose taps are stopped by depth, normal and luminance edges",
    defaultsByTier: { fraco: false, medio: true, forte: true },
  });

  const pass = createSpatialFilterPass({ telemetry });

  registerPass(SPATIAL_FILTER_PASS_NAME, {
    owner: SPATIAL_FILTER_OWNER,
    isEnabled: () => isFlagActive(FLAG_ID, currentTier()),
    execute: (frameContext) => pass.execute(frameContext),
  });

  telemetry.textureUnit(PHASE_ID, SHARED_LIGHTING_TEXTURE_UNITS);
  telemetry.phase(PHASE_ID, {
    implemented: true,
    title: "Spatial filter: sparse rotated kernel driven by the temporal variance",
    block: "F",
    ownsPass: SPATIAL_FILTER_PASS_NAME,
    flag: FLAG_ID,
    sharedLightingTextureUnits: SHARED_LIGHTING_TEXTURE_UNITS,
    injectsGlslInSharedProgram: false,
    reservedPatchOrder: MGL_PATCH_ORDER[PHASE_ID],
    reservedPatchOrderIsUsedBy: "nobody: this phase composes through ML-F18 instead of patching the shared program",
    kernel: describeSpatialKernel(),
    readsContextKey: SPATIAL_FILTER_INPUT_CONTEXT_KEY,
    publishesContextKey: SPATIAL_FILTER_CONTEXT_KEY,
    composedBy: "ML-F18 through mlDenoisedSignalLatch.js",
    uniforms: pass.uniformValues(),
    acceptance: SPATIAL_FILTER_GATES,
    measurements: pass.measurements(),
    residuals: SPATIAL_FILTER_RESIDUALS,
    waitingFor:
      "nothing to start: it filters whatever ML-F20 publishes and refuses out loud, with a named reason, on any frame where that signal is absent",
  });

  return {
    implemented: true,
    phaseId: PHASE_ID,
    flagId: FLAG_ID,
    passName: SPATIAL_FILTER_PASS_NAME,
    pass,
    inspect: () => pass.inspect(),
  };
}
