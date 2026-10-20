import { BASELINE_IDENTITY_SSIM, BASELINE_SCENE_IDS } from "./llBaselineCore.js";

export const LOCAL_LIGHT_PHASE_COUNT = 24;
export const BLIND_ROUND_MIN_HIT_RATE = 0.7;
export const BLIND_ROUND_MIN_EVALUATORS = 3;
export const MAX_TEXTURE_UNITS = 16;

export const PERFORMANCE_GATES = Object.freeze({
  weakTierMaxOverheadMs: 0.5,
  mediumTierMinFps: 30,
  strongTierMinFps: 45,
});

export const FINAL_VERDICT_GATES = Object.freeze([
  Object.freeze({
    id: "phases-delivered",
    title: "All 24 phases delivered with status block, spec and QA",
    requirement: "phasesDelivered equals " + LOCAL_LIGHT_PHASE_COUNT,
  }),
  Object.freeze({
    id: "scene-battery-green",
    title: "The battery of the " + BASELINE_SCENE_IDS.length + " scenes is green",
    requirement: "every scene of section 9 passes its QA",
  }),
  Object.freeze({
    id: "performance-two-classes",
    title: "Performance measured on two GPU classes",
    requirement:
      "weak tier overhead at most " +
      PERFORMANCE_GATES.weakTierMaxOverheadMs +
      " ms, medium tier at least " +
      PERFORMANCE_GATES.mediumTierMinFps +
      " fps, strong tier at least " +
      PERFORMANCE_GATES.strongTierMinFps +
      " fps",
  }),
  Object.freeze({
    id: "blind-round",
    title: "Blind round with real evaluators",
    requirement:
      "hit rate at least " +
      BLIND_ROUND_MIN_HIT_RATE +
      " with at least " +
      BLIND_ROUND_MIN_EVALUATORS +
      " evaluators over " +
      BASELINE_SCENE_IDS.length +
      " scenes",
  }),
  Object.freeze({
    id: "flag-off-byte-exact",
    title: "Every phase flag off returns the legacy image",
    requirement: "ssim at least " + BASELINE_IDENTITY_SSIM + " against the baseline of every scene",
  }),
  Object.freeze({
    id: "texture-units-budget",
    title: "Texture unit budget respected",
    requirement: "at most " + MAX_TEXTURE_UNITS + " texture units in the worst case",
  }),
  Object.freeze({
    id: "residuals-declared",
    title: "Residuals declared honestly",
    requirement: "every known gap is written in the phase status block",
  }),
]);

function gateResult(id, passed, detail) {
  const gate = FINAL_VERDICT_GATES.find((item) => item.id === id);
  return {
    id,
    title: gate ? gate.title : id,
    requirement: gate ? gate.requirement : "",
    passed: passed === true,
    detail: detail || "",
  };
}

export function evaluatePerformanceGates(measurements) {
  const source = measurements || {};
  const weakOverheadMs = Number.isFinite(source.weakOverheadMs) ? source.weakOverheadMs : null;
  const mediumFps = Number.isFinite(source.mediumFps) ? source.mediumFps : null;
  const strongFps = Number.isFinite(source.strongFps) ? source.strongFps : null;
  const problems = [];
  if (weakOverheadMs === null) problems.push("weak tier overhead not measured");
  else if (weakOverheadMs > PERFORMANCE_GATES.weakTierMaxOverheadMs) {
    problems.push("weak tier overhead " + weakOverheadMs + " ms above budget");
  }
  if (mediumFps === null) problems.push("medium tier fps not measured");
  else if (mediumFps < PERFORMANCE_GATES.mediumTierMinFps) {
    problems.push("medium tier " + mediumFps + " fps below budget");
  }
  if (strongFps === null) problems.push("strong tier fps not measured");
  else if (strongFps < PERFORMANCE_GATES.strongTierMinFps) {
    problems.push("strong tier " + strongFps + " fps below budget");
  }
  return { passed: problems.length === 0, problems, weakOverheadMs, mediumFps, strongFps };
}

export function evaluateBlindRound(blindRound) {
  const source = blindRound || {};
  const hitRate = Number.isFinite(source.hitRate) ? source.hitRate : null;
  const evaluators = Number.isFinite(source.evaluators) ? source.evaluators : 0;
  const scenes = Number.isFinite(source.scenes) ? source.scenes : 0;
  const problems = [];
  if (hitRate === null) problems.push("blind round never ran");
  else if (hitRate < BLIND_ROUND_MIN_HIT_RATE) problems.push("hit rate " + hitRate + " below gate");
  if (evaluators < BLIND_ROUND_MIN_EVALUATORS) problems.push("only " + evaluators + " evaluators");
  if (scenes < BASELINE_SCENE_IDS.length) problems.push("only " + scenes + " scenes covered");
  return { passed: problems.length === 0, problems, hitRate, evaluators, scenes };
}

export function evaluateFinalVerdict(state) {
  const source = state || {};
  const phasesDelivered = Number.isFinite(source.phasesDelivered) ? source.phasesDelivered : 0;
  const performance = evaluatePerformanceGates(source.performance);
  const blindRound = evaluateBlindRound(source.blindRound);
  const textureUnits = Number.isFinite(source.textureUnits) ? source.textureUnits : null;
  const gates = [
    gateResult(
      "phases-delivered",
      phasesDelivered >= LOCAL_LIGHT_PHASE_COUNT,
      phasesDelivered + " of " + LOCAL_LIGHT_PHASE_COUNT + " phases delivered",
    ),
    gateResult(
      "scene-battery-green",
      source.sceneBatteryGreen === true,
      source.sceneBatteryGreen === true ? "battery green" : "battery not green yet",
    ),
    gateResult("performance-two-classes", performance.passed, performance.problems.join("; ")),
    gateResult("blind-round", blindRound.passed, blindRound.problems.join("; ")),
    gateResult(
      "flag-off-byte-exact",
      source.flagOffByteExact === true,
      source.flagOffByteExact === true ? "every scene identical with flags off" : "identity not proven for every scene",
    ),
    gateResult(
      "texture-units-budget",
      textureUnits !== null && textureUnits <= MAX_TEXTURE_UNITS,
      textureUnits === null ? "texture units not measured" : textureUnits + " of " + MAX_TEXTURE_UNITS + " units",
    ),
    gateResult(
      "residuals-declared",
      source.residualsDeclared === true,
      source.residualsDeclared === true ? "residuals written in the status blocks" : "residuals not declared",
    ),
  ];
  const passedCount = gates.filter((gate) => gate.passed).length;
  return {
    gates,
    passedCount,
    totalCount: gates.length,
    canAnswerYes: passedCount === gates.length,
    performance,
    blindRound,
  };
}
