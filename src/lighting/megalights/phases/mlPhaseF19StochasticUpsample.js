import { mlQa } from "../runtime/megaLightsTelemetry.js";
import { isFlagActive, registerFlag } from "../runtime/megaLightsFlagRegistry.js";
import { registerPass } from "../mlPassGraph.js";
import {
  STOCHASTIC_UPSAMPLE_OWNER,
  STOCHASTIC_UPSAMPLE_PASS_NAME,
  createStochasticUpsamplePass,
} from "../mlUpsampleGlue.js";
import { UPSAMPLE_ACCEPTANCE } from "../mlUpsampleStatsCore.js";
import { EDGE_STOPPING_DEFAULTS } from "../mlUpsampleEdgeWeightCore.js";

export const PHASE_ID = "ML-F19";
export const FLAG_ID = "MegaLightsStochasticUpsample";


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
      "resolves the downsampled shading back to full resolution by picking ONE neighbour per pixel, weighted by depth and normal",
    defaultsByTier: { fraco: false, medio: true, forte: true },
  });

  const pass = createStochasticUpsamplePass({
    telemetry,
    edgeStopping: EDGE_STOPPING_DEFAULTS,
  });

  registerPass(STOCHASTIC_UPSAMPLE_PASS_NAME, {
    owner: STOCHASTIC_UPSAMPLE_OWNER,
    isEnabled: () => isFlagActive(FLAG_ID, currentTier()),
    execute: (frameContext) => pass.execute(frameContext),
  });

  telemetry.textureUnit(PHASE_ID, SHARED_LIGHTING_TEXTURE_UNITS);
  telemetry.phase(PHASE_ID, {
    implemented: true,
    title: "Stochastic upsample with history fallback",
    block: "E",
    ownsPass: STOCHASTIC_UPSAMPLE_PASS_NAME,
    flag: FLAG_ID,
    sharedLightingTextureUnits: SHARED_LIGHTING_TEXTURE_UNITS,
    injectsGlslInSharedProgram: false,
    uniforms: pass.uniformValues(),
    acceptance: UPSAMPLE_ACCEPTANCE,
    waitingFor: "ML-F12 and ML-F18: without a downsampled shading buffer the pass refuses and says so",
  });

  return {
    implemented: true,
    phaseId: PHASE_ID,
    flagId: FLAG_ID,
    passName: STOCHASTIC_UPSAMPLE_PASS_NAME,
    pass,
    inspect: () => pass.inspect(),
  };
}
