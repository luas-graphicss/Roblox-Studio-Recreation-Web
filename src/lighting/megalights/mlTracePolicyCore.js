import { MGL_TRACE_RESULT } from "./mlPipelineContract.js";
import { MGL_TRACE_KIND, resolveTraceCascade } from "./mlTraceCascadeCore.js";
import { compactUnresolvedSamples } from "./mlTraceSampleCompactionCore.js";
import { createTraceRayBudget, raysPerSampleEntitlement } from "./mlTraceRayBudgetCore.js";

export const TRACE_POLICY_DEFAULT_TIER = "medio";


export const TRACE_FALLBACK_RESULT = MGL_TRACE_RESULT.visible;


export const NO_HIT_DISTANCE = 1;

export const TRACE_FALLBACK_REASON = Object.freeze({

  policyDisabled: "policyDisabled",

  tracerUnavailable: "tracerUnavailable",

  rayBudgetExhausted: "rayBudgetExhausted",

  cascadeExhausted: "cascadeExhausted",
});

function createSampleRecord(sampleIndex) {
  return {
    sampleIndex,
    traceResult: MGL_TRACE_RESULT.unknown,
    traceKind: MGL_TRACE_KIND.none,
    normalizedHitDistance: NO_HIT_DISTANCE,
    raysSpent: 0,
    fallbackReason: null,

    blockedBy: null,
  };
}

function isDecisiveResult(traceResult) {
  return traceResult === MGL_TRACE_RESULT.visible || traceResult === MGL_TRACE_RESULT.occluded;
}

function isContractResult(traceResult) {
  return isDecisiveResult(traceResult) || traceResult === MGL_TRACE_RESULT.unknown;
}

function clampToUnitRange(value) {
  if (value <= 0) return 0;
  if (value >= 1) return 1;
  return value;
}


function normalizeTracerAnswer(rawAnswer) {
  if (typeof rawAnswer === "string") {
    return {
      traceResult: rawAnswer,
      normalizedHitDistance: null,
      understood: isContractResult(rawAnswer),
      threw: false,
    };
  }
  if (rawAnswer && typeof rawAnswer === "object") {
    const traceResult = rawAnswer.traceResult;
    const hitDistance = Number(rawAnswer.normalizedHitDistance);
    return {
      traceResult,
      normalizedHitDistance: Number.isFinite(hitDistance) ? hitDistance : null,
      understood: isContractResult(traceResult),
      threw: false,
    };
  }
  return {
    traceResult: MGL_TRACE_RESULT.unknown,
    normalizedHitDistance: null,
    understood: false,
    threw: false,
  };
}

function callTracer(tracer, sample, sampleIndex, traceKind, problems) {
  try {
    return normalizeTracerAnswer(tracer(sample, sampleIndex));
  } catch (error) {
    problems.push(
      traceKind + " threw on sample " + sampleIndex + ": " + (error && error.message ? error.message : String(error))
    );
    return {
      traceResult: MGL_TRACE_RESULT.unknown,
      normalizedHitDistance: null,
      understood: false,
      threw: true,
    };
  }
}

function skippedStepReport(traceKind, compaction, skipReason) {
  return Object.freeze({
    traceKind,
    tracerAvailable: skipReason !== "tracer not installed",
    promotedCount: compaction.promotedCount,
    compactionRatio: compaction.compactionRatio,
    tracedSampleCount: 0,
    resolvedSampleCount: 0,
    raysSpentInStep: 0,
    budgetRefusalCount: 0,
    skipReason,
  });
}


function applyTerminalFallback(records, forcedReason) {
  let fallbackSampleCount = 0;
  records.forEach((record) => {
    if (record.traceResult !== MGL_TRACE_RESULT.unknown) return;
    record.traceResult = TRACE_FALLBACK_RESULT;
    record.traceKind = MGL_TRACE_KIND.policyFallback;
    record.fallbackReason =
      forcedReason || record.blockedBy || TRACE_FALLBACK_REASON.cascadeExhausted;
    record.normalizedHitDistance = NO_HIT_DISTANCE;
    fallbackSampleCount += 1;
  });
  return fallbackSampleCount;
}

function countFallbackReasons(records) {
  const countByReason = {};
  records.forEach((record) => {
    if (!record.fallbackReason) return;
    countByReason[record.fallbackReason] = (countByReason[record.fallbackReason] || 0) + 1;
  });
  return Object.freeze(countByReason);
}

function summarizeRun(parts) {
  const records = parts.records;
  const sampleCount = records.length;
  let raysSpentTotal = 0;
  let unresolvedSampleCount = 0;
  let unlabelledFallbackCount = 0;

  records.forEach((record) => {
    raysSpentTotal += record.raysSpent;
    if (record.traceResult === MGL_TRACE_RESULT.unknown) unresolvedSampleCount += 1;
    if (record.traceKind === MGL_TRACE_KIND.policyFallback && !record.fallbackReason) {
      unlabelledFallbackCount += 1;
    }
  });

  return Object.freeze({
    tierName: parts.tierName,
    cascade: parts.cascade,
    sampleCount,
    records: Object.freeze(records.map((record) => Object.freeze(Object.assign({}, record)))),
    stepReports: Object.freeze(parts.stepReports.slice()),

    unresolvedSampleCount,
    fallbackSampleCount: parts.fallbackSampleCount,
    unlabelledFallbackCount,
    retracedResolvedSampleCount: parts.retracedResolvedSampleCount,
    fallbackReasonCounts: countFallbackReasons(records),
    raysSpentTotal,
    raysPerSample: sampleCount > 0 ? raysSpentTotal / sampleCount : 0,
    rayBudget: parts.rayBudget.describe(),
    problems: Object.freeze(parts.problems.slice()),
  });
}


export function resolveTracePolicy(request) {
  const input = request || {};
  const tierName = input.tierName || TRACE_POLICY_DEFAULT_TIER;
  const samples = Array.isArray(input.samples) ? input.samples : [];
  const tracers = input.tracers && typeof input.tracers === "object" ? input.tracers : {};

  const cascade = resolveTraceCascade(tierName);
  const raysPerAttempt = raysPerSampleEntitlement(tierName);
  const rayBudget = createTraceRayBudget({
    tierName,
    sampleCount: samples.length,
    rayBudgetOverride: input.rayBudgetOverride,
  });

  const records = samples.map((sample, sampleIndex) => createSampleRecord(sampleIndex));
  const stepReports = [];
  const problems = [];
  let retracedResolvedSampleCount = 0;

  cascade.forEach((traceKind) => {
    const compaction = compactUnresolvedSamples(records);
    if (compaction.promotedCount === 0) {
      stepReports.push(skippedStepReport(traceKind, compaction, "nothing left unresolved"));
      return;
    }

    const tracer = typeof tracers[traceKind] === "function" ? tracers[traceKind] : null;
    if (tracer === null) {
      compaction.promotedIndices.forEach((sampleIndex) => {
        records[sampleIndex].blockedBy = TRACE_FALLBACK_REASON.tracerUnavailable;
      });
      stepReports.push(skippedStepReport(traceKind, compaction, "tracer not installed"));
      return;
    }

    let tracedSampleCount = 0;
    let resolvedSampleCount = 0;
    let raysSpentInStep = 0;
    let budgetRefusalCount = 0;

    compaction.promotedIndices.forEach((sampleIndex) => {
      const record = records[sampleIndex];
      if (record.traceResult !== MGL_TRACE_RESULT.unknown) {

        retracedResolvedSampleCount += 1;
        return;
      }
      if (!rayBudget.trySpendRays(raysPerAttempt)) {
        record.blockedBy = TRACE_FALLBACK_REASON.rayBudgetExhausted;
        budgetRefusalCount += 1;
        return;
      }

      record.raysSpent += raysPerAttempt;
      raysSpentInStep += raysPerAttempt;
      tracedSampleCount += 1;

      const answer = callTracer(tracer, samples[sampleIndex], sampleIndex, traceKind, problems);
      if (!answer.understood && !answer.threw) {
        problems.push(
          traceKind + " answered \"" + String(answer.traceResult) + "\" on sample " + sampleIndex + ": kept as unknown, never promoted to visible"
        );
      }
      if (answer.threw) {
        record.blockedBy = TRACE_FALLBACK_REASON.tracerUnavailable;
        return;
      }
      if (!isDecisiveResult(answer.traceResult)) {

        return;
      }

      record.traceResult = answer.traceResult;
      record.traceKind = traceKind;
      record.blockedBy = null;
      if (answer.normalizedHitDistance !== null) {
        record.normalizedHitDistance = clampToUnitRange(answer.normalizedHitDistance);
      }
      resolvedSampleCount += 1;
    });

    stepReports.push(
      Object.freeze({
        traceKind,
        tracerAvailable: true,
        promotedCount: compaction.promotedCount,
        compactionRatio: compaction.compactionRatio,
        tracedSampleCount,
        resolvedSampleCount,
        raysSpentInStep,
        budgetRefusalCount,
        skipReason: null,
      })
    );
  });

  const fallbackSampleCount = applyTerminalFallback(records, null);

  return summarizeRun({
    tierName,
    cascade,
    records,
    stepReports,
    problems,
    rayBudget,
    retracedResolvedSampleCount,
    fallbackSampleCount,
  });
}


export function resolveDisabledTracePolicy(request) {
  const input = request || {};
  const tierName = input.tierName || TRACE_POLICY_DEFAULT_TIER;
  const samples = Array.isArray(input.samples) ? input.samples : [];
  const records = samples.map((sample, sampleIndex) => createSampleRecord(sampleIndex));
  const rayBudget = createTraceRayBudget({ tierName, sampleCount: samples.length, rayBudgetOverride: 0 });
  const fallbackSampleCount = applyTerminalFallback(records, TRACE_FALLBACK_REASON.policyDisabled);

  return summarizeRun({
    tierName,
    cascade: Object.freeze([]),
    records,
    stepReports: [],
    problems: [],
    rayBudget,
    retracedResolvedSampleCount: 0,
    fallbackSampleCount,
  });
}
