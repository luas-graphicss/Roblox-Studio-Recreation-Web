import { mlQa } from "../runtime/megaLightsTelemetry.js";
import { isFlagActive, registerFlag } from "../runtime/megaLightsFlagRegistry.js";
import { registerFrameStage } from "../mlFrameStages.js";
import { CLOCK_SAMPLE_REFUSAL, createFrameClockSampler } from "../mlFrameClockSampler.js";
import {
  PERFORMANCE_GATE_ROWS,
  describePerformanceVerdict,
  evaluatePerformanceGates,
} from "../mlPerfGateCore.js";

export const PHASE_ID = "ML-F29";
export const FLAG_ID = "MegaLightsPerfGates";
export const FRAME_STAGE_NAME = "performanceGateEvaluation";
const FRAME_STAGE_SLOT_NUMBER = 100;
const SHARED_LIGHTING_TEXTURE_UNITS = 0;


const FRAMES_BETWEEN_EVALUATIONS = 60;

export function installPhase(installContext) {
  const context = installContext || {};
  const telemetry = context.mlQa || mlQa;
  const bench = context.bench || null;
  const currentTier = () => (bench && bench.tier ? bench.tier : "medio");

  registerFlag({
    id: FLAG_ID,
    phase: PHASE_ID,
    description:
      "evaluates the acceptance numbers of MGL_GATES against what was really measured, and reports invalid instead of green when the clock is throttled",
    defaultsByTier: { fraco: true, medio: true, forte: true },
  });

  const sampler = createFrameClockSampler();

  const suppliedMeasurements = {};
  let framesUntilNextEvaluation = 0;
  let lastReport = null;

  const measurementsFrom = (clock) => {
    const tierName = clock.tier || currentTier();
    const measured = Object.assign({}, suppliedMeasurements);
    if (clock.measurementIsValid && clock.framesPerSecond !== null) {
      if (tierName === "medio") measured.framesPerSecondMediumTier = clock.framesPerSecond;
      if (tierName === "forte") measured.framesPerSecondStrongTier = clock.framesPerSecond;
    }
    if (clock.worstFrameMilliseconds !== null) {
      measured.warmupSpikeMilliseconds = clock.worstFrameMilliseconds;
    }
    return measured;
  };

  const evaluateFrom = (clock) => {
    const report = evaluatePerformanceGates({
      measured: measurementsFrom(clock),
      realClockFrozen: clock.refusal === CLOCK_SAMPLE_REFUSAL.deterministicClock,
      measurementValid: clock.measurementIsValid,
    });
    lastReport = report;
    telemetry.phase(PHASE_ID, {
      latestReport: {
        verdict: describePerformanceVerdict(report),
        passCount: report.passCount,
        failCount: report.failCount,
        invalidCount: report.invalidCount,
        notMeasuredCount: report.notMeasuredCount,
        measurementValidity: report.measurementValidity,
        certified: report.certified,
      },
    });
    return report;
  };

  registerFrameStage({
    stageName: FRAME_STAGE_NAME,
    owner: PHASE_ID,
    slot: FRAME_STAGE_SLOT_NUMBER,
    isEnabled: () => isFlagActive(FLAG_ID, currentTier()),
    execute: (frameContext) => {
      const clock = sampler.sample(frameContext);
      framesUntilNextEvaluation -= 1;
      if (framesUntilNextEvaluation > 0) return;
      framesUntilNextEvaluation = FRAMES_BETWEEN_EVALUATIONS;
      const report = evaluateFrom(clock);

      frameContext.performanceGates = {
        owner: PHASE_ID,
        passCount: report.passCount,
        failCount: report.failCount,
        invalidCount: report.invalidCount,
        notMeasuredCount: report.notMeasuredCount,
        measurementValidity: report.measurementValidity,
      };
    },
  });


  const supplyMeasurements = (measured) => {
    const supplied = measured && typeof measured === "object" ? measured : {};
    Object.keys(supplied).forEach((key) => {
      suppliedMeasurements[key] = supplied[key];
    });
    return evaluateFrom(sampler.read() || { tier: currentTier(), measurementIsValid: false, refusal: CLOCK_SAMPLE_REFUSAL.noPreviousFrame, framesPerSecond: null, worstFrameMilliseconds: null });
  };

  telemetry.textureUnit(PHASE_ID, SHARED_LIGHTING_TEXTURE_UNITS);
  telemetry.phase(PHASE_ID, {
    implemented: true,
    title: "Performance gates: the acceptance numbers, evaluated against real evidence only",
    block: "H",
    ownsPass: null,
    flag: FLAG_ID,
    frameStageName: FRAME_STAGE_NAME,
    frameStageSlot: FRAME_STAGE_SLOT_NUMBER,
    framesBetweenEvaluations: FRAMES_BETWEEN_EVALUATIONS,
    sharedLightingTextureUnits: SHARED_LIGHTING_TEXTURE_UNITS,
    injectsGlslInSharedProgram: false,
    gateCount: PERFORMANCE_GATE_ROWS.length,
    gates: PERFORMANCE_GATE_ROWS.map((row) => ({
      id: row.id,
      required: row.required,
      comparison: row.comparison,
      dependsOnWallClock: row.dependsOnWallClock,
    })),
    acceptance: {
      wallClockGatesAreInvalidWhenTheClockIsThrottled: true,
      unmeasuredGatesAreNeverGreen: true,
      certifiedRequiresEveryGateMeasuredAdmissibleAndPassing: true,
    },
    residuals: [
      "only fps and the worst frame are measured here: SSIM, firefly ratio, simultaneous light counts and the blind round must be supplied by a proof run through supplyMeasurements()",
      "the frame time is end to end, so a failing budget gate cannot name the phase that spent it",
      "in a headless or hidden preview every wall-clock gate reports invalid on purpose: ask for the project to be active on screen before quoting fps",
    ],
    waitingFor: "nothing to start: it reports the honest state of the scoreboard from the first window of frames",
  });

  return {
    implemented: true,
    phaseId: PHASE_ID,
    flagId: FLAG_ID,
    passName: null,
    frameStageName: FRAME_STAGE_NAME,
    supplyMeasurements,
    inspect: () => ({ lastReport, clock: sampler.read() }),
  };
}
