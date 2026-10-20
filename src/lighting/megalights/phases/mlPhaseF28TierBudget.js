import { mlQa } from "../runtime/megaLightsTelemetry.js";
import { isFlagActive, registerFlag } from "../runtime/megaLightsFlagRegistry.js";
import { registerFrameStage } from "../mlFrameStages.js";
import { createFrameClockSampler } from "../mlFrameClockSampler.js";
import {
  BUDGET_DECISION,
  BUDGET_LIMITS,
  adaptedTierDefaults,
  budgetDecisionFor,
  samplesPerPixelRangeFor,
} from "../mlTierBudgetCore.js";

export const PHASE_ID = "ML-F28";
export const FLAG_ID = "MegaLightsTierBudget";
export const FRAME_STAGE_NAME = "tierBudgetGovernor";
const FRAME_STAGE_SLOT_NUMBER = 80;
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
      "measures the real frame time and publishes what the sample budget should be: it reads the clock and changes no pixel, so it is safe on every tier",
    defaultsByTier: { fraco: true, medio: true, forte: true },
  });

  const sampler = createFrameClockSampler();
  let appliedSamplesPerPixel = null;
  let lastDecision = null;
  let lastPublishedDecision = "";

  const publishWhenDecisionChanges = (decision) => {
    const signature = decision.decision + "|" + decision.reason + "|" + decision.samplesPerPixel;
    if (signature === lastPublishedDecision) return;
    lastPublishedDecision = signature;
    telemetry.phase(PHASE_ID, { latestDecision: decision });
  };

  registerFrameStage({
    stageName: FRAME_STAGE_NAME,
    owner: PHASE_ID,
    slot: FRAME_STAGE_SLOT_NUMBER,
    isEnabled: () => isFlagActive(FLAG_ID, currentTier()),
    execute: (frameContext) => {
      const clock = sampler.sample(frameContext);
      const tierName = clock.tier || currentTier();
      const decision = budgetDecisionFor({
        tierName,
        measuredMilliseconds: clock.meanFrameMilliseconds,
        measurementIsValid: clock.measurementIsValid,
        framesSinceChange: clock.framesSinceChange,
        currentSamplesPerPixel:
          appliedSamplesPerPixel === null ? samplesPerPixelRangeFor(tierName).maximum : appliedSamplesPerPixel,
      });
      lastDecision = decision;


      frameContext.tierBudget = {
        owner: PHASE_ID,
        decision: decision.decision,
        reason: decision.reason,
        samplesPerPixel: decision.samplesPerPixel,
        appliedSamplesPerPixel,
        measuredMilliseconds: clock.meanFrameMilliseconds,
        measurementIsValid: clock.measurementIsValid,
        clockRefusal: clock.refusal,
      };
      publishWhenDecisionChanges(decision);
    },
  });


  const applyDecision = () => {
    if (!lastDecision || lastDecision.decision === BUDGET_DECISION.refuse) {
      return { applied: false, reason: lastDecision ? lastDecision.reason : "no decision measured yet" };
    }
    appliedSamplesPerPixel = lastDecision.samplesPerPixel;
    const applied = adaptedTierDefaults(lastDecision.tier, lastDecision);
    telemetry.phase(PHASE_ID, { appliedBudget: applied });
    return { applied: true, samplesPerPixel: appliedSamplesPerPixel, tierDefaults: applied };
  };

  telemetry.textureUnit(PHASE_ID, SHARED_LIGHTING_TEXTURE_UNITS);
  telemetry.phase(PHASE_ID, {
    implemented: true,
    title: "Tier budget: a measured, hysteretic governor that advises and never surprises",
    block: "H",
    ownsPass: null,
    flag: FLAG_ID,
    frameStageName: FRAME_STAGE_NAME,
    frameStageSlot: FRAME_STAGE_SLOT_NUMBER,
    sharedLightingTextureUnits: SHARED_LIGHTING_TEXTURE_UNITS,
    injectsGlslInSharedProgram: false,
    limits: BUDGET_LIMITS,
    acceptance: {
      neverAdaptsOnInvalidMeasurement: true,
      neverAdaptsDuringWarmup: true,
      neverEnablesTheWeakTierByItself: true,
      hysteresisPreventsFlapping: true,
    },
    residuals: [
      "the decision is published on the frame context and in this table: no pass reads it yet, because ML-F11 owns samplesPerPixel and reads the contract directly",
      "applying the advice is a human act through applyDecision(), so an A/B comparison can never be silently re-tuned under the reviewer",
      "the frame time is measured end to end, not per pass: it cannot say WHICH phase went over budget",
    ],
    waitingFor: "nothing: it measures from the first frame and says out loud when the measurement is inadmissible",
  });

  return {
    implemented: true,
    phaseId: PHASE_ID,
    flagId: FLAG_ID,
    passName: null,
    frameStageName: FRAME_STAGE_NAME,
    applyDecision,
    inspect: () => ({ lastDecision, appliedSamplesPerPixel, clock: sampler.read() }),
  };
}
