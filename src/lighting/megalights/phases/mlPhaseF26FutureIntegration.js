import { mlQa } from "../runtime/megaLightsTelemetry.js";
import { listFrameStages } from "../mlFrameStages.js";
import { listPasses } from "../mlPassGraph.js";
import {
  FUTURE_REQUIREMENTS,
  READINESS,
  describeFutureSurface,
  evaluateFutureReadiness,
} from "../mlFutureIntegrationCore.js";

export const PHASE_ID = "ML-F26";
const SHARED_LIGHTING_TEXTURE_UNITS = 0;
const READINESS_GLOBAL_NAME = "__mlFutureReadiness";

export function installPhase(installContext) {
  const context = installContext || {};
  const telemetry = context.mlQa || mlQa;

  const phaseTableNow = () => {
    const published = telemetry.get && telemetry.get();
    return published && published.phases ? published.phases : {};
  };


  const evaluate = () =>
    evaluateFutureReadiness({
      phaseTable: phaseTableNow(),
      passTable: listPasses(),
      frameStages: listFrameStages(),
    });

  const publish = () => {
    const readiness = evaluate();
    telemetry.phase(PHASE_ID, {
      implemented: true,
      title: "Future integration: the readiness gate and the surface Future may read",
      block: "H",
      ownsPass: null,
      flag: null,
      sharedLightingTextureUnits: SHARED_LIGHTING_TEXTURE_UNITS,
      injectsGlslInSharedProgram: false,
      globalName: READINESS_GLOBAL_NAME,
      requirementCount: FUTURE_REQUIREMENTS.length,
      readiness: readiness.readiness,
      metCount: readiness.metCount,
      total: readiness.total,
      mayExposeAsLightingBase: readiness.mayExposeAsLightingBase,
      blockingReasons: readiness.blockingReasons,
      requirements: readiness.rows,
      surface: describeFutureSurface(),
      acceptance: {
        readsLiveRegistriesAndNotAChecklist: true,
        futureReadsThroughTheNamedSurfaceOnly: true,
        aPartialAnswerNamesEveryMissingRequirement: true,
      },
      residuals: [
        "src/engine/index.js is reserved and empty: the integration itself cannot be written against a seam that has no other side yet",
        "readiness is computed from what this session installed: a phase that failed to load makes the answer honestly worse, which is the intent",
        "the shading confidence signal is produced but its correlation gate is still unmeasured, so Future would inherit an unproven confidence",
      ],
      waitingFor: "the Future side of the seam: everything MegaLights owes it is enumerated above, with a live met or unmet next to each item",
    });
    return readiness;
  };

  const readinessNow = publish();
  telemetry.textureUnit(PHASE_ID, SHARED_LIGHTING_TEXTURE_UNITS);

  const futureReadiness = { evaluate: publish, surface: describeFutureSurface, requirements: FUTURE_REQUIREMENTS, READINESS };
  if (typeof window !== "undefined") window[READINESS_GLOBAL_NAME] = futureReadiness;

  return {
    implemented: true,
    phaseId: PHASE_ID,
    passName: null,
    futureReadiness,
    inspect: () => publish(),
    readinessAtInstall: readinessNow.readiness,
  };
}
