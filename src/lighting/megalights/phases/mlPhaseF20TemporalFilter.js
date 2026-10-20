import { mlQa } from "../runtime/megaLightsTelemetry.js";
import { isFlagActive, registerFlag } from "../runtime/megaLightsFlagRegistry.js";
import { registerPass } from "../mlPassGraph.js";
import {
  TEMPORAL_FILTER_OWNER,
  TEMPORAL_FILTER_PASS_NAME,
  TEMPORAL_FILTER_RESIDUALS,
  createTemporalFilterPass,
} from "../mlTemporalFilterGlue.js";
import { TEMPORAL_FILTER_GATES } from "../mlTemporalFilterGatesCore.js";
import { TEMPORAL_FILTER_HISTORY_FRAME_COUNT } from "../mlTemporalFilterCore.js";

export const PHASE_ID = "ML-F20";
export const FLAG_ID = "MegaLightsTemporalFilter";


const SHARED_LIGHTING_TEXTURE_UNITS = 2;

export function installPhase(installContext) {
  const context = installContext || {};
  const telemetry = context.mlQa || mlQa;
  const bench = context.bench || null;
  const currentTier = () => (bench && bench.tier ? bench.tier : "medio");

  registerFlag({
    id: FLAG_ID,
    phase: PHASE_ID,
    description:
      "accumulates diffuse and specular across frames by motion vector, rejects history on depth or normal disagreement, and measures the temporal variance that drives ML-F21",
    defaultsByTier: { fraco: false, medio: true, forte: true },
  });

  const pass = createTemporalFilterPass({ telemetry });

  registerPass(TEMPORAL_FILTER_PASS_NAME, {
    owner: TEMPORAL_FILTER_OWNER,
    isEnabled: () => isFlagActive(FLAG_ID, currentTier()),
    execute: (frameContext) => pass.execute(frameContext),
  });

  telemetry.textureUnit(PHASE_ID, SHARED_LIGHTING_TEXTURE_UNITS);
  telemetry.phase(PHASE_ID, {
    implemented: true,
    title: "Temporal filter and temporal variance (SVGF)",
    block: "F",
    ownsPass: TEMPORAL_FILTER_PASS_NAME,
    flag: FLAG_ID,
    sharedLightingTextureUnits: SHARED_LIGHTING_TEXTURE_UNITS,
    injectsGlslInSharedProgram: false,
    historyFrameCount: TEMPORAL_FILTER_HISTORY_FRAME_COUNT,
    uniforms: pass.uniformValues(),
    acceptance: TEMPORAL_FILTER_GATES,
    measurements: pass.measurements(),
    residuals: TEMPORAL_FILTER_RESIDUALS,
    waitingFor:
      "ML-F18 and ML-F19: without a full resolution shaded signal the pass refuses and says so instead of filtering an empty buffer",
  });

  return {
    implemented: true,
    phaseId: PHASE_ID,
    flagId: FLAG_ID,
    passName: TEMPORAL_FILTER_PASS_NAME,
    pass,
    inspect: () => pass.inspect(),
  };
}
