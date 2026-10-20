import { GPU_CLASS_BY_TIER, MIN_FRAMES_PER_SAMPLE } from "./llBatteryContract.js";
import { PERFORMANCE_GATES } from "./llVerdictGatesCore.js";

export const WEAK_TIER = "fraco";
export const MEDIUM_TIER = "medio";
export const STRONG_TIER = "forte";

export const OVERHEAD_GATE_ID = "weak-tier-overhead";
export const FPS_GATE_ID_BY_TIER = Object.freeze({ medio: "medium-tier-fps", forte: "strong-tier-fps" });

export const FPS_GATED_TIERS = Object.freeze([MEDIUM_TIER, STRONG_TIER]);

function finiteOrNull(value) {
  return Number.isFinite(value) ? value : null;
}

export function minimumFpsFor(tier) {
  if (tier === MEDIUM_TIER) return PERFORMANCE_GATES.mediumTierMinFps;
  if (tier === STRONG_TIER) return PERFORMANCE_GATES.strongTierMinFps;
  return null;
}


export function createPerfSample(input) {
  const source = input || {};
  const frames = Number.isFinite(source.frames) ? source.frames : 0;
  const fpsAverage = finiteOrNull(source.fpsAverage);
  return Object.freeze({
    tier: source.tier || "",
    gpuClass: GPU_CLASS_BY_TIER[source.tier] || "",
    sceneId: source.sceneId || "",
    frames,
    fpsAverage,
    msAverage: finiteOrNull(source.msAverage),
    msP95: finiteOrNull(source.msP95),
    msWorst: finiteOrNull(source.msWorst),
    drawCalls: finiteOrNull(source.drawCalls),
    triangles: finiteOrNull(source.triangles),
    measured: frames >= MIN_FRAMES_PER_SAMPLE && fpsAverage !== null,
  });
}

export function summarizeTierPerformance(samples, tier) {
  const list = (Array.isArray(samples) ? samples : []).filter((sample) => sample && sample.tier === tier);
  const measured = list.filter((sample) => sample.measured);
  const averageFps = measured.length
    ? measured.reduce((total, sample) => total + sample.fpsAverage, 0) / measured.length
    : null;
  let worst = null;
  measured.forEach((sample) => {
    if (worst === null || worst.fpsAverage > sample.fpsAverage) worst = sample;
  });
  return {
    tier,
    gpuClass: GPU_CLASS_BY_TIER[tier] || "",
    minimumFps: minimumFpsFor(tier),
    sceneCount: list.length,
    measuredSceneCount: measured.length,
    notMeasuredSceneIds: list.filter((sample) => !sample.measured).map((sample) => sample.sceneId),
    averageFps,
    worstSceneFps: worst ? worst.fpsAverage : null,
    worstSceneId: worst ? worst.sceneId : "",
    framesMeasured: list.reduce((total, sample) => total + sample.frames, 0),
    samples: list,
    measured: list.length > 0 && measured.length === list.length,
  };
}

export function evaluateFpsGate(summary, tier) {
  const targetTier = (summary && summary.tier) || tier || "";
  const minimumFps = minimumFpsFor(targetTier);
  const applicable = minimumFps !== null;
  const averageFps = summary ? finiteOrNull(summary.averageFps) : null;
  const measured = !!summary && summary.measured === true && averageFps !== null;
  const passed = applicable && measured && averageFps >= minimumFps;
  let detail = "";
  if (!applicable) {
    detail = "tier " + targetTier + " nao tem piso de fps no plano (o portao dele e o overhead)";
  } else if (!summary || summary.sceneCount === 0) {
    detail = "nenhuma cena medida no tier " + targetTier;
  } else if (!measured) {
    detail =
      "medicao nao confiavel no tier " +
      targetTier +
      ": " +
      summary.measuredSceneCount +
      " de " +
      summary.sceneCount +
      " cenas com quadros suficientes" +
      (summary.notMeasuredSceneIds.length ? " (sem quadros: " + summary.notMeasuredSceneIds.join(", ") + ")" : "");
  } else {
    detail =
      "media " +
      averageFps.toFixed(1) +
      " fps em " +
      summary.sceneCount +
      " cenas (piso " +
      minimumFps +
      "), pior cena " +
      summary.worstSceneId +
      " com " +
      (summary.worstSceneFps === null ? "?" : summary.worstSceneFps.toFixed(1)) +
      " fps";
  }
  return {
    id: FPS_GATE_ID_BY_TIER[targetTier] || "fps-" + targetTier,
    tier: targetTier,
    gpuClass: GPU_CLASS_BY_TIER[targetTier] || "",
    applicable,
    measured,
    minimumFps,
    averageFps,
    passed,
    detail,
  };
}


export function measureOverhead(input) {
  const source = input || {};
  const msWithEverythingOff = finiteOrNull(source.msWithEverythingOff);
  const msWithTierDefaults = finiteOrNull(source.msWithTierDefaults);
  const framesWithEverythingOff = Number.isFinite(source.framesWithEverythingOff) ? source.framesWithEverythingOff : 0;
  const framesWithTierDefaults = Number.isFinite(source.framesWithTierDefaults) ? source.framesWithTierDefaults : 0;
  const measured =
    msWithEverythingOff !== null &&
    msWithTierDefaults !== null &&
    framesWithEverythingOff >= MIN_FRAMES_PER_SAMPLE &&
    framesWithTierDefaults >= MIN_FRAMES_PER_SAMPLE;
  return Object.freeze({
    tier: source.tier || WEAK_TIER,
    sceneId: source.sceneId || "",
    msWithEverythingOff,
    msWithTierDefaults,
    framesWithEverythingOff,
    framesWithTierDefaults,
    overheadMs: measured ? msWithTierDefaults - msWithEverythingOff : null,
    measured,
  });
}

export function summarizeOverhead(overheads) {
  const list = Array.isArray(overheads) ? overheads.filter(Boolean) : [];
  const measured = list.filter((item) => item.measured);
  let worst = null;
  measured.forEach((item) => {
    if (worst === null || item.overheadMs > worst.overheadMs) worst = item;
  });
  return {
    tier: list.length ? list[0].tier : WEAK_TIER,
    budgetMs: PERFORMANCE_GATES.weakTierMaxOverheadMs,
    total: list.length,
    measuredCount: measured.length,
    notMeasuredSceneIds: list.filter((item) => !item.measured).map((item) => item.sceneId),
    worstOverheadMs: worst ? worst.overheadMs : null,
    worstSceneId: worst ? worst.sceneId : "",
    items: list,
    measured: list.length > 0 && measured.length === list.length,
  };
}

export function evaluateOverheadGate(summary) {
  const budgetMs = PERFORMANCE_GATES.weakTierMaxOverheadMs;
  const worstOverheadMs = summary ? finiteOrNull(summary.worstOverheadMs) : null;
  const measured = !!summary && summary.measured === true && worstOverheadMs !== null;
  const passed = measured && budgetMs >= worstOverheadMs;
  let detail = "";
  if (!summary || summary.total === 0) {
    detail = "overhead da GPU fraca nao medido";
  } else if (!measured) {
    detail =
      "overhead nao confiavel: " +
      summary.measuredCount +
      " de " +
      summary.total +
      " cenas com quadros suficientes" +
      (summary.notMeasuredSceneIds.length ? " (sem quadros: " + summary.notMeasuredSceneIds.join(", ") + ")" : "");
  } else {
    detail =
      "pior caso " +
      worstOverheadMs.toFixed(3) +
      " ms na cena " +
      summary.worstSceneId +
      " (orcamento " +
      budgetMs +
      " ms)";
  }
  return { id: OVERHEAD_GATE_ID, tier: WEAK_TIER, budgetMs, worstOverheadMs, measured, passed, detail };
}
