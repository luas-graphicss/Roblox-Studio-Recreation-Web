import { ML_GATE_COMPARISON, compareMeasurement, isExecutableGate } from "./mlGateComparisonCore.js";
import { MGL_GATES, MGL_TEXTURE_UNIT_CEILING } from "./mlPipelineContract.js";
import { ML_PARITY_TERM_STATUS, parityLedgerSummary } from "./mlParityLedgerCore.js";


const FORWARD_PARITY_ENERGY_TOLERANCE = 0.03;
const LEGACY_TECHNOLOGY_REQUIRED_SIMILARITY = 1;
const BLIND_ROUND_REQUIRED_SCENES = 10;
const NOTHING_ALLOWED = 0;

function verdictGate(definition) {
  return Object.freeze({
    id: definition.id,
    section: definition.section,
    title: definition.title,
    metric: definition.metric,
    comparison: definition.comparison,
    target: definition.target,
    unit: definition.unit,


    numberFromPlan: true,
    note: definition.note || "",
  });
}

export const ML_VERDICT_GATES = Object.freeze([
  verdictGate({
    id: "fixedCostOneVersusThousandLights",
    section: "11.1",
    title: "Cost does not follow the number of lights",
    metric: "frameMillisecondDeviationOneVersusThousandLights",
    comparison: ML_GATE_COMPARISON.withinRelativeTolerance,
    target: MGL_GATES.fixedCostToleranceRatio,
    unit: "ratio",
    note: "same scene and same tier, one light against one thousand",
  }),
  verdictGate({
    id: "simultaneousAreaLightsOnTheStrongTier",
    section: "11.1",
    title: "Simultaneous area lights on the strong tier",
    metric: "simultaneousAreaLightsOnTheStrongTier",
    comparison: ML_GATE_COMPARISON.atLeast,
    target: MGL_GATES.minSimultaneousAreaLightsStrongTier,
    unit: "lights",
    note: "the declared aspiration is " + MGL_GATES.targetSimultaneousAreaLights + ", the gate refuses below the floor",
  }),
  verdictGate({
    id: "totalCostOnTheStrongTier",
    section: "11.1",
    title: "Total cost at 1080p with one sample per pixel",
    metric: "totalMillisecondsOnTheStrongTier",
    comparison: ML_GATE_COMPARISON.atMost,
    target: MGL_GATES.maxTotalMillisecondsStrongTier,
    unit: "milliseconds",
    note: "the published console reference is 4.08 ms with asynchronous compute off",
  }),
  verdictGate({
    id: "flagOffStructuralSimilarity",
    section: "11.2",
    title: "With the flag off the image is the baseline",
    metric: "structuralSimilarityWithEveryFlagOff",
    comparison: ML_GATE_COMPARISON.atLeast,
    target: MGL_GATES.flagOffMinimumSsim,
    unit: "ssim",
    note: "measured across the ten reference scenes",
  }),
  verdictGate({
    id: "legacyTechnologyStructuralSimilarity",
    section: "11.2",
    title: "The legacy technology path is untouched",
    metric: "structuralSimilarityOnTheLegacyTechnologyPath",
    comparison: ML_GATE_COMPARISON.atLeast,
    target: LEGACY_TECHNOLOGY_REQUIRED_SIMILARITY,
    unit: "ssim",
    note: "anything below a perfect match means the old path changed",
  }),
  verdictGate({
    id: "forwardParityEnergyDeviation",
    section: "11.2",
    title: "Energy parity against the forward path",
    metric: "energyDeviationAgainstTheForwardPath",
    comparison: ML_GATE_COMPARISON.withinRelativeTolerance,
    target: FORWARD_PARITY_ENERGY_TOLERANCE,
    unit: "ratio",
    note: "one light, diffuse plus specular",
  }),
  verdictGate({
    id: "fireflyLuminanceRatio",
    section: "11.2",
    title: "Fireflies under forced disocclusion",
    metric: "fireflyLuminanceRatioUnderForcedDisocclusion",
    comparison: ML_GATE_COMPARISON.atMost,
    target: MGL_GATES.maxFireflyLuminanceRatio,
    unit: "ratio",
  }),
  verdictGate({
    id: "blindRoundConfusionRate",
    section: "11.2",
    title: "Blind round confusion rate",
    metric: "blindRoundConfusionRate",
    comparison: ML_GATE_COMPARISON.atLeast,
    target: MGL_GATES.blindRoundMinimumConfusionRate,
    unit: "ratio",
    note: "an evaluator who cannot tell which image is ours is the point",
  }),
  verdictGate({
    id: "blindRoundEvaluators",
    section: "11.2",
    title: "Blind round evaluators",
    metric: "blindRoundEvaluators",
    comparison: ML_GATE_COMPARISON.atLeast,
    target: MGL_GATES.blindRoundMinimumEvaluators,
    unit: "people",
  }),
  verdictGate({
    id: "blindRoundScenes",
    section: "11.2",
    title: "Blind round coverage",
    metric: "blindRoundScenes",
    comparison: ML_GATE_COMPARISON.atLeast,
    target: BLIND_ROUND_REQUIRED_SCENES,
    unit: "scenes",
    note: "ten of ten, so a favourable scene cannot carry the verdict",
  }),
  verdictGate({
    id: "overheadWithEveryFlagOff",
    section: "11.3",
    title: "Overhead on the weak tier with everything off",
    metric: "overheadMillisecondsWithEveryFlagOff",
    comparison: ML_GATE_COMPARISON.atMost,
    target: MGL_GATES.maxOverheadMillisecondsAllFlagsOff,
    unit: "milliseconds",
  }),
  verdictGate({
    id: "compiledPatchesWithEveryFlagOff",
    section: "11.3",
    title: "Nothing compiles when every flag is off",
    metric: "compiledPatchesWithEveryFlagOff",
    comparison: ML_GATE_COMPARISON.exactly,
    target: NOTHING_ALLOWED,
    unit: "patches",
    note: "a flag that is off must not reach the shader compiler at all",
  }),
  verdictGate({
    id: "weakTierFrameRateRegression",
    section: "11.4",
    title: "No regression on the weak tier",
    metric: "framesPerSecondLostOnTheWeakTier",
    comparison: ML_GATE_COMPARISON.atMost,
    target: NOTHING_ALLOWED,
    unit: "frames per second",
    note: "MegaLights stays off by default on this tier",
  }),
  verdictGate({
    id: "mediumTierFrameRate",
    section: "11.4",
    title: "Frame rate on the medium tier",
    metric: "framesPerSecondOnTheMediumTier",
    comparison: ML_GATE_COMPARISON.atLeast,
    target: MGL_GATES.minFramesPerSecondMediumTier,
    unit: "frames per second",
  }),
  verdictGate({
    id: "strongTierFrameRate",
    section: "11.4",
    title: "Frame rate on the strong tier",
    metric: "framesPerSecondOnTheStrongTier",
    comparison: ML_GATE_COMPARISON.atLeast,
    target: MGL_GATES.minFramesPerSecondStrongTier,
    unit: "frames per second",
  }),
  verdictGate({
    id: "fragmentTextureUnits",
    section: "11.5",
    title: "Fragment texture units in use",
    metric: "fragmentTextureUnitsInUse",
    comparison: ML_GATE_COMPARISON.atMost,
    target: MGL_TEXTURE_UNIT_CEILING,
    unit: "texture units",
    note: "crossing this does not degrade quality, the shader fails to link",
  }),
  verdictGate({
    id: "allocationsPerFrameInSteadyState",
    section: "11.5",
    title: "Allocations per frame in steady state",
    metric: "allocationsPerFrameInSteadyState",
    comparison: ML_GATE_COMPARISON.exactly,
    target: NOTHING_ALLOWED,
    unit: "allocations",
  }),
  verdictGate({
    id: "warmupSpikeAboveSteadyState",
    section: "11.5",
    title: "Worst warm up frame above steady state",
    metric: "warmupSpikeMillisecondsAboveSteadyState",
    comparison: ML_GATE_COMPARISON.atMost,
    target: MGL_GATES.maxWarmupSpikeMilliseconds,
    unit: "milliseconds",
  }),
  verdictGate({
    id: "deviceResetsOnWeakHardware",
    section: "11.5",
    title: "Device resets on weak hardware",
    metric: "deviceResetsOnWeakHardware",
    comparison: ML_GATE_COMPARISON.exactly,
    target: NOTHING_ALLOWED,
    unit: "resets",
  }),
]);

export function listVerdictGates() {
  return ML_VERDICT_GATES;
}

export function verdictGateById(gateId) {
  return ML_VERDICT_GATES.find((gate) => gate.id === gateId) || null;
}

export function verdictGatesForSection(section) {
  return ML_VERDICT_GATES.filter((gate) => gate.section === section);
}







export function evaluateGate(gateId, measured) {
  const gate = verdictGateById(gateId);
  if (!gate) {
    return Object.freeze({
      gateId,
      known: false,
      passed: false,
      reason: 'unknown gate "' + String(gateId) + '"',
    });
  }
  const comparison = compareMeasurement(gate.comparison, measured, gate.target);
  const measurementTaken = typeof measured === "number" && Number.isFinite(measured);
  return Object.freeze({
    gateId: gate.id,
    known: true,
    section: gate.section,
    metric: gate.metric,
    comparison: gate.comparison,
    target: gate.target,
    unit: gate.unit,
    measured: measurementTaken ? measured : null,
    measurementTaken,
    passed: comparison.passed,
    reason: comparison.reason,
  });
}


export function evaluateAllGates(measurementsByGateId) {
  const measurements = measurementsByGateId || {};
  const results = ML_VERDICT_GATES.map((gate) => evaluateGate(gate.id, measurements[gate.id]));
  const measured = results.filter((result) => result.measurementTaken);
  const passed = results.filter((result) => result.passed);
  return {
    totalGates: results.length,
    measured: measured.length,
    notMeasured: results.length - measured.length,
    passed: passed.length,
    failed: measured.length - passed.length,
    allPassed: passed.length === results.length,
    results,
  };
}









export function canAnswerYes(measurementsByGateId) {
  const ledger = parityLedgerSummary();
  const gates = evaluateAllGates(measurementsByGateId);
  const reasons = [];

  const unproven = ledger.totalTerms - ledger.proven;
  if (unproven > 0) {
    reasons.push(unproven + " of " + ledger.totalTerms + " parity terms are not proven yet");
  }
  if (ledger.needingVerification > 0) {
    reasons.push(
      ledger.needingVerification +
        " terms have no source verified against Unreal " +
        ledger.targetUnrealVersion,
    );
  }
  if (ledger.withOwningPhase < ledger.totalTerms) {
    reasons.push(ledger.totalTerms - ledger.withOwningPhase + " terms have no owning phase");
  }
  if (ledger.withExecutableGate < ledger.totalTerms) {
    reasons.push(ledger.totalTerms - ledger.withExecutableGate + " terms have no executable gate");
  }
  if (gates.notMeasured > 0) {
    reasons.push(gates.notMeasured + " of " + gates.totalGates + " verdict gates were never measured");
  }
  if (gates.failed > 0) {
    reasons.push(gates.failed + " verdict gates were measured and failed");
  }

  return {
    yes: reasons.length === 0,
    reasons,
    ledger,
    gates: {
      totalGates: gates.totalGates,
      measured: gates.measured,
      notMeasured: gates.notMeasured,
      passed: gates.passed,
      failed: gates.failed,
    },
    provenStatus: ML_PARITY_TERM_STATUS.proven,
  };
}


export function gatesWithoutExecutableTarget() {
  return ML_VERDICT_GATES.filter((gate) => !isExecutableGate(gate));
}
