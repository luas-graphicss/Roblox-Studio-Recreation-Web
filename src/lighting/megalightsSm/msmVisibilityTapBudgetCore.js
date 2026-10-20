import { MSM_ATLAS_MAX_DEPTH_TAPS_PER_SAMPLE } from "./msmAtlasVisibilityCore.js";
import { MSM_PROXY_BOX_CEILING } from "./msmProxyOcclusionCore.js";
import { depthTapsPerPixel, screenTraceStepsForTier } from "./msmScreenTraceBudgetCore.js";
import { MSM_ACTIVE_TIERS, isMsmTier } from "./msmTierPolicy.js";

export const MSM_VISIBILITY_BUDGET_OWNER = "MSM-F20";


export const MSM_VISIBILITY_SOURCE = Object.freeze({
  ATLAS: "atlas",
  SCREEN_TRACE: "screen-trace",
  PROXY: "proxy",
  NONE: "none",
});


export const MSM_ANSWERING_VISIBILITY_SOURCES = Object.freeze([
  MSM_VISIBILITY_SOURCE.ATLAS,
  MSM_VISIBILITY_SOURCE.SCREEN_TRACE,
  MSM_VISIBILITY_SOURCE.PROXY,
]);


export const MSM_VISIBILITY_SOURCE_OWNER_PHASE = Object.freeze({
  [MSM_VISIBILITY_SOURCE.ATLAS]: "MSM-F16",
  [MSM_VISIBILITY_SOURCE.SCREEN_TRACE]: "MSM-F18",
  [MSM_VISIBILITY_SOURCE.PROXY]: "MSM-F19",
  [MSM_VISIBILITY_SOURCE.NONE]: "MSM-F20",
});


export const MSM_PROXY_DEPTH_TAPS_PER_SAMPLE = 0;


export const MSM_PROXY_SLOT_EVALUATIONS_PER_SAMPLE = MSM_PROXY_BOX_CEILING;


export const MSM_NO_SLOT_EVALUATIONS = 0;


export const MSM_SECTION_6_1_ATLAS_TAP_ALLOWANCE = MSM_ATLAS_MAX_DEPTH_TAPS_PER_SAMPLE;

function readTierText(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}

function readSourceText(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}


export function isAnsweringVisibilitySource(source) {
  return MSM_ANSWERING_VISIBILITY_SOURCES.indexOf(readSourceText(source)) !== -1;
}


export function visibilityDepthTapsForSource(source, tier) {
  if (!isMsmTier(tier)) return 0;

  const sourceId = readSourceText(source);
  if (sourceId === MSM_VISIBILITY_SOURCE.ATLAS) return MSM_ATLAS_MAX_DEPTH_TAPS_PER_SAMPLE;
  if (sourceId === MSM_VISIBILITY_SOURCE.PROXY) return MSM_PROXY_DEPTH_TAPS_PER_SAMPLE;
  if (sourceId === MSM_VISIBILITY_SOURCE.SCREEN_TRACE) {
    const stepCount = screenTraceStepsForTier(tier);
    return stepCount === null ? 0 : depthTapsPerPixel(stepCount);
  }
  return 0;
}


export function visibilitySlotEvaluationsForSource(source, tier) {
  if (!isMsmTier(tier)) return MSM_NO_SLOT_EVALUATIONS;
  return readSourceText(source) === MSM_VISIBILITY_SOURCE.PROXY
    ? MSM_PROXY_SLOT_EVALUATIONS_PER_SAMPLE
    : MSM_NO_SLOT_EVALUATIONS;
}


export function describeVisibilityCostForSource(source, tier) {
  const sourceId = readSourceText(source);
  const normalizedTier = readTierText(tier);

  return {
    source: sourceId,
    tier: normalizedTier,
    ownerPhase: MSM_VISIBILITY_SOURCE_OWNER_PHASE[sourceId] || MSM_VISIBILITY_BUDGET_OWNER,
    depthTapCount: visibilityDepthTapsForSource(sourceId, normalizedTier),
    slotEvaluationCount: visibilitySlotEvaluationsForSource(sourceId, normalizedTier),
    newTextureUnits: 0,
  };
}


export function worstCaseVisibilityTapsForTier(tier) {
  return MSM_ANSWERING_VISIBILITY_SOURCES.reduce(function keepTheLargest(largest, source) {
    const taps = visibilityDepthTapsForSource(source, tier);
    return taps > largest ? taps : largest;
  }, 0);
}


export function cheapestVisibilityTapsForTier(tier) {
  if (!isMsmTier(tier)) return 0;

  return MSM_ANSWERING_VISIBILITY_SOURCES.reduce(function keepTheSmallest(smallest, source) {
    const taps = visibilityDepthTapsForSource(source, tier);
    if (!(taps > 0)) return smallest;
    return smallest === 0 || smallest > taps ? taps : smallest;
  }, 0);
}


export function visibilityTapAllowanceForTier(tier) {
  if (!isMsmTier(tier)) return 0;
  const traceTaps = visibilityDepthTapsForSource(MSM_VISIBILITY_SOURCE.SCREEN_TRACE, tier);
  return traceTaps + MSM_SECTION_6_1_ATLAS_TAP_ALLOWANCE;
}


export function describeVisibilityBudgetHeadroom(tier) {
  const allowance = visibilityTapAllowanceForTier(tier);
  const worstCase = worstCaseVisibilityTapsForTier(tier);

  return {
    tier: readTierText(tier),
    allowance,
    worstCase,
    headroom: allowance - worstCase,
    isUnderBudget: allowance >= worstCase,
  };
}


export function validateVisibilityTapBudget() {
  const problems = [];

  MSM_ACTIVE_TIERS.forEach(function checkOneTier(tier) {
    const atlasTaps = visibilityDepthTapsForSource(MSM_VISIBILITY_SOURCE.ATLAS, tier);
    const traceTaps = visibilityDepthTapsForSource(MSM_VISIBILITY_SOURCE.SCREEN_TRACE, tier);
    const proxyTaps = visibilityDepthTapsForSource(MSM_VISIBILITY_SOURCE.PROXY, tier);
    const headroom = describeVisibilityBudgetHeadroom(tier);

    if (atlasTaps !== 1) {
      problems.push("tier " + tier + " prices the atlas at " + atlasTaps + " taps, and MSM-F16 promised exactly one");
    }
    if (proxyTaps !== 0) {
      problems.push("tier " + tier + " prices the proxy at " + proxyTaps + " taps, and MSM-F19 promised zero textures");
    }
    if (!(traceTaps > atlasTaps)) {
      problems.push(
        "tier " + tier + " prices the screen trace at " + traceTaps + " taps, at or below the atlas - the ceiling of this tier is no longer the trace",
      );
    }
    if (!headroom.isUnderBudget) {
      problems.push(
        "tier " + tier + " spends up to " + headroom.worstCase + " taps against the " + headroom.allowance + " allowed by section 6.1",
      );
    }
  });

  return { ok: problems.length === 0, problems };
}

function createEmptyCountBySource() {
  const countBySource = {};
  MSM_ANSWERING_VISIBILITY_SOURCES.forEach(function startAtZero(source) {
    countBySource[source] = 0;
  });
  countBySource[MSM_VISIBILITY_SOURCE.NONE] = 0;
  return countBySource;
}

function toCount(value) {
  const numeric = Math.floor(Number(value));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : 0;
}


export function createVisibilityTapLedger() {
  let sampleCount = 0;
  let sourcesExecutedTotal = 0;
  let maximumSourcesExecutedInOneSample = 0;
  let unansweredSampleCount = 0;
  let depthTapTotal = 0;
  let slotEvaluationTotal = 0;
  let sampleCountBySource = createEmptyCountBySource();
  let depthTapCountBySource = createEmptyCountBySource();

  function recordSample(answer) {
    const record = answer && typeof answer === "object" ? answer : {};
    const source = readSourceText(record.source) || MSM_VISIBILITY_SOURCE.NONE;
    const sourcesExecuted = toCount(record.sourcesExecuted);
    const depthTapCount = toCount(record.depthTapCount);
    const slotEvaluationCount = toCount(record.slotEvaluationCount);

    sampleCount += 1;
    sourcesExecutedTotal += sourcesExecuted;
    if (sourcesExecuted > maximumSourcesExecutedInOneSample) {
      maximumSourcesExecutedInOneSample = sourcesExecuted;
    }
    if (sourcesExecuted === 0) unansweredSampleCount += 1;

    depthTapTotal += depthTapCount;
    slotEvaluationTotal += slotEvaluationCount;

    if (typeof sampleCountBySource[source] === "number") {
      sampleCountBySource[source] += 1;
      depthTapCountBySource[source] += depthTapCount;
    }

    return record;
  }

  function read() {
    return Object.freeze({
      owner: MSM_VISIBILITY_BUDGET_OWNER,
      sampleCount,
      sourcesExecutedTotal,
      maximumSourcesExecutedInOneSample,
      unansweredSampleCount,
      depthTapTotal,
      slotEvaluationTotal,
      depthTapsPerSample: sampleCount === 0 ? 0 : depthTapTotal / sampleCount,
      sampleCountBySource: Object.freeze({ ...sampleCountBySource }),
      depthTapCountBySource: Object.freeze({ ...depthTapCountBySource }),
    });
  }

  function reset() {
    sampleCount = 0;
    sourcesExecutedTotal = 0;
    maximumSourcesExecutedInOneSample = 0;
    unansweredSampleCount = 0;
    depthTapTotal = 0;
    slotEvaluationTotal = 0;
    sampleCountBySource = createEmptyCountBySource();
    depthTapCountBySource = createEmptyCountBySource();
  }

  return { recordSample, read, reset };
}


export function evaluateSingleSourcePerSample(snapshot) {
  const reading = snapshot && typeof snapshot === "object" ? snapshot : {};
  const sampleCount = toCount(reading.sampleCount);
  const sourcesExecutedTotal = toCount(reading.sourcesExecutedTotal);
  const unansweredSampleCount = toCount(reading.unansweredSampleCount);
  const maximumSourcesExecutedInOneSample = toCount(reading.maximumSourcesExecutedInOneSample);
  const problems = [];

  if (sampleCount === 0) {
    problems.push("the ledger recorded no sample at all - there is nothing to prove");
  }
  if (maximumSourcesExecutedInOneSample > 1) {
    problems.push(
      "one sample executed " + maximumSourcesExecutedInOneSample + " sources - the acceptance of MSM-F20 allows exactly one",
    );
  }
  if (sourcesExecutedTotal + unansweredSampleCount !== sampleCount) {
    problems.push(
      "the books do not close: " +
        sourcesExecutedTotal +
        " executions plus " +
        unansweredSampleCount +
        " unanswered samples against " +
        sampleCount +
        " samples",
    );
  }

  return {
    pass: problems.length === 0,
    sampleCount,
    sourcesExecutedTotal,
    unansweredSampleCount,
    maximumSourcesExecutedInOneSample,
    problems,
  };
}

function varianceOf(values) {
  if (values.length === 0) return 0;
  const mean = values.reduce(function addUp(total, value) {
    return total + value;
  }, 0) / values.length;
  return values.reduce(function addSquaredDistance(total, value) {
    return total + (value - mean) * (value - mean);
  }, 0) / values.length;
}


export function evaluateLightCountInvariance(scenes) {
  const rows = Array.isArray(scenes) ? scenes : [];
  const problems = [];

  if (2 > rows.length) {
    problems.push("invariance needs at least two scenes to compare, received " + rows.length);
  }

  const lightCounts = rows.map(function readLightCount(scene) {
    return toCount(scene && scene.lightCount);
  });
  if (new Set(lightCounts).size === 1 && rows.length > 1) {
    problems.push("every scene declares the same light count - the comparison would prove nothing");
  }

  const pixelCounts = rows.map(function readPixelCount(scene) {
    return Array.isArray(scene && scene.tapCountsByPixel) ? scene.tapCountsByPixel.length : -1;
  });
  const pixelCount = pixelCounts.length > 0 ? pixelCounts[0] : 0;
  if (pixelCounts.some(function isDifferent(count) {
    return count !== pixelCount;
  })) {
    problems.push("the scenes report different pixel counts (" + pixelCounts.join(", ") + ") and cannot be compared pixel by pixel");
  }
  if (1 > pixelCount) {
    problems.push("the scenes report no pixel at all");
  }

  const variancePerPixel = [];
  let worstVariance = 0;
  if (problems.length === 0) {
    for (let pixelIndex = 0; pixelCount > pixelIndex; pixelIndex += 1) {
      const tapCounts = rows.map(function readTapCount(scene) {
        return Number(scene.tapCountsByPixel[pixelIndex]);
      });
      const variance = varianceOf(tapCounts);
      variancePerPixel.push(variance);
      if (variance > worstVariance) worstVariance = variance;
      if (variance !== 0) {
        problems.push(
          "pixel " +
            pixelIndex +
            " spent " +
            tapCounts.join(" / ") +
            " taps across scenes of " +
            lightCounts.join(" / ") +
            " lights - gate G1 demands zero variance",
        );
      }
    }
  }

  return {
    pass: problems.length === 0,
    sceneCount: rows.length,
    pixelCount: pixelCount > 0 ? pixelCount : 0,
    lightCounts,
    variancePerPixel,
    worstVariance,
    problems,
  };
}
