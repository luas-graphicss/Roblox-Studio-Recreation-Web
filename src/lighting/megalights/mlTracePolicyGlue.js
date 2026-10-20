import { MGL_TRACE_RESULT } from "./mlPipelineContract.js";
import { MGL_TRACE_KIND } from "./mlTraceCascadeCore.js";
import {
  TRACE_RAY_BUDGET_UNIFORM,
  frameRayBudget,
  raysToCompleteOneSample,
} from "./mlTraceRayBudgetCore.js";
import {
  NO_HIT_DISTANCE,
  TRACE_FALLBACK_REASON,
  TRACE_FALLBACK_RESULT,
  resolveDisabledTracePolicy,
  resolveTracePolicy,
} from "./mlTracePolicyCore.js";
import { planRotationPulse, samplesServedPerPulse } from "./mlTraceRayRotationCore.js";
import {
  SAMPLE_VISIBILITY_BUFFER_NAME,
  SAMPLE_VISIBILITY_SAMPLER_UNIFORM,
  encodeSampleVisibility,
} from "./mlSampleVisibilityCore.js";
import { evaluateTracePolicy } from "./mlTracePolicyGatesCore.js";

export const TRACE_POLICY_OWNER = "ML-F17";
export const TRACE_POLICY_DEFAULT_TIER_NAME = "medio";

export const TRACE_POLICY_REFUSAL = Object.freeze({
  none: "none",
  inputsMissing:
    "nothing to decide: no phase published frameContext.tracePolicyInputs with samples and tracers",
  noSamples: "the frame published an empty sample list: there is no visibility to resolve",
  policyDisabled:
    "the phase flag is off for this tier: no cascade, no ray, every sample labelled policyDisabled",
  noTracerInstalled:
    "no tracer of ML-F14, ML-F15 or ML-F16 answered: every sample took the labelled fallback tracerUnavailable",
});

function allSampleIndices(sampleCount) {
  const sampleIndices = [];
  for (let sampleIndex = 0; sampleIndex !== sampleCount; sampleIndex += 1) {
    sampleIndices.push(sampleIndex);
  }
  return sampleIndices;
}

function installedTracerCount(tracers, cascade) {
  let tracerCount = 0;
  cascade.forEach((traceKind) => {
    if (typeof tracers[traceKind] === "function") tracerCount += 1;
  });
  return tracerCount;
}


function deferredSampleRecord(sampleIndex, retraceScheduledForPulse) {
  return {
    sampleIndex,
    traceResult: TRACE_FALLBACK_RESULT,
    traceKind: MGL_TRACE_KIND.policyFallback,
    normalizedHitDistance: NO_HIT_DISTANCE,
    raysSpent: 0,
    fallbackReason: TRACE_FALLBACK_REASON.rayBudgetExhausted,
    blockedBy: TRACE_FALLBACK_REASON.rayBudgetExhausted,
    retraceScheduledForPulse,
  };
}

function countFallbackReasons(records) {
  const countByReason = {};
  records.forEach((record) => {
    if (!record || !record.fallbackReason) return;
    countByReason[record.fallbackReason] = (countByReason[record.fallbackReason] || 0) + 1;
  });
  return Object.freeze(countByReason);
}


export function createTracePolicyInstrument(dependencies) {
  const settings = dependencies || {};
  const telemetry = settings.telemetry || null;
  const isPolicyActive =
    typeof settings.isPolicyActive === "function" ? settings.isPolicyActive : () => true;

  const state = {
    pulseIndex: 0,
    resolvedFrameCount: 0,
    refusal: TRACE_POLICY_REFUSAL.inputsMissing,
    lastFrameSummary: null,
    remainingRays: 0,
  };
  let lastPublishedSignature = "";

  function uniformValues() {
    const values = {};

    values[TRACE_RAY_BUDGET_UNIFORM] = state.remainingRays;
    return Object.freeze(values);
  }

  function publishWhenChanged() {
    if (!telemetry || typeof telemetry.phase !== "function") return;
    const summary = state.lastFrameSummary;
    const signature = [
      state.refusal,
      summary ? summary.tierName : "",
      summary ? summary.sampleCount : 0,
      summary ? summary.servedSampleCount : 0,
      summary ? summary.deferredSampleCount : 0,
      summary ? summary.unresolvedSampleCount : -1,
      summary ? summary.raysSpentTotal : 0,
    ].join("|");
    if (signature === lastPublishedSignature) return;
    lastPublishedSignature = signature;

    telemetry.phase(TRACE_POLICY_OWNER, {
      refusal: state.refusal,
      pulseIndex: state.pulseIndex,
      resolvedFrameCount: state.resolvedFrameCount,
      uniforms: uniformValues(),
      frame: summary,


      gate: summary ? evaluateTracePolicy(summary) : null,
    });
    if (typeof telemetry.uniform === "function") {
      telemetry.uniform(TRACE_RAY_BUDGET_UNIFORM, state.remainingRays);
    }
  }

  function refuse(reason) {
    state.refusal = reason;
    state.lastFrameSummary = null;
    publishWhenChanged();
  }

  function summarizeFrame(parts) {
    const records = parts.records;
    const sampleCount = records.length;
    let raysSpentTotal = 0;
    let unresolvedSampleCount = 0;
    let fallbackSampleCount = 0;
    let unlabelledFallbackCount = 0;

    records.forEach((record) => {
      raysSpentTotal += Number(record.raysSpent) || 0;
      if (record.traceResult === MGL_TRACE_RESULT.unknown) unresolvedSampleCount += 1;
      if (record.traceKind === MGL_TRACE_KIND.policyFallback) {
        fallbackSampleCount += 1;
        if (!record.fallbackReason) unlabelledFallbackCount += 1;
      }
    });

    const servedSampleCount = parts.plan.servedCount;
    return Object.freeze({
      tierName: parts.tierName,
      cascade: parts.run.cascade,
      pulseIndex: parts.plan.pulseIndex,
      sampleCount,
      servedSampleCount,
      deferredSampleCount: parts.plan.deferredCount,
      samplesPerPulse: parts.plan.samplesPerPulse,
      pulsesToServeAllPendingSamples: parts.plan.pulsesToServeAll,
      rotationStarvation: parts.plan.starvation,
      tracersInstalled: parts.tracersInstalled,


      unresolvedSampleCount,
      fallbackSampleCount,
      unlabelledFallbackCount,
      retracedResolvedSampleCount: parts.run.retracedResolvedSampleCount,
      fallbackReasonCounts: countFallbackReasons(records),
      raysSpentTotal,


      raysPerSample: sampleCount > 0 ? raysSpentTotal / sampleCount : 0,
      raysPerServedSample: servedSampleCount > 0 ? raysSpentTotal / servedSampleCount : 0,
      availableRays: parts.availableRays,
      rayBudget: parts.run.rayBudget,
      stepReports: parts.run.stepReports,
      problems: Object.freeze(parts.problems.slice()),
    });
  }

  function execute(frameContext) {
    const context = frameContext || {};
    const inputs = context.tracePolicyInputs || null;
    const tierName = context.tier || TRACE_POLICY_DEFAULT_TIER_NAME;

    function finishFrame(parts) {
      const encodingProblems = [];
      const texels = parts.records.map((record) => {
        const encoded = encodeSampleVisibility(record);
        encoded.problems.forEach((problem) => {
          encodingProblems.push("sample " + record.sampleIndex + ": " + problem);
        });
        return encoded.texel;
      });

      const summary = summarizeFrame({
        tierName: parts.tierName,
        run: parts.run,
        plan: parts.plan,
        records: parts.records,
        tracersInstalled: parts.tracersInstalled,
        availableRays: parts.availableRays,
        problems: parts.problems.concat(encodingProblems),
      });

      state.refusal = parts.refusal;
      state.lastFrameSummary = summary;
      state.remainingRays = summary.rayBudget ? summary.rayBudget.remainingRays : 0;
      state.resolvedFrameCount += 1;


      if (parts.advancePulse) state.pulseIndex += 1;
      publishWhenChanged();

      context.sampleVisibility = {
        owner: TRACE_POLICY_OWNER,
        bufferName: SAMPLE_VISIBILITY_BUFFER_NAME,
        samplerUniform: SAMPLE_VISIBILITY_SAMPLER_UNIFORM,
        texels,
        records: parts.records,
        counters: summary,
      };
      return context;
    }

    if (!inputs) {
      refuse(TRACE_POLICY_REFUSAL.inputsMissing);
      return frameContext;
    }
    const samples = Array.isArray(inputs.samples) ? inputs.samples : [];
    if (samples.length === 0) {
      refuse(TRACE_POLICY_REFUSAL.noSamples);
      return frameContext;
    }
    const tracers = inputs.tracers && typeof inputs.tracers === "object" ? inputs.tracers : {};

    if (!isPolicyActive(tierName)) {

      const disabledRun = resolveDisabledTracePolicy({ tierName, samples });
      return finishFrame({
        tierName,
        run: disabledRun,
        plan: planRotationPulse({
          pendingSampleIndices: [],
          samplesPerPulse: 0,
          pulseIndex: state.pulseIndex,
        }),
        records: disabledRun.records.map((record) => Object.assign({}, record)),
        tracersInstalled: 0,
        availableRays: 0,
        refusal: TRACE_POLICY_REFUSAL.policyDisabled,
        problems: [],
        advancePulse: false,
      });
    }

    const overrideRays = Math.floor(Number(inputs.rayBudgetOverride));
    const availableRays = Number.isFinite(overrideRays)
      ? Math.max(0, overrideRays)
      : frameRayBudget({ tierName, sampleCount: samples.length });

    const plan = planRotationPulse({
      pendingSampleIndices: allSampleIndices(samples.length),
      samplesPerPulse: samplesServedPerPulse({ tierName, availableRays }),
      pulseIndex: state.pulseIndex,
    });

    const run = resolveTracePolicy({
      tierName,
      samples: plan.servedSampleIndices.map((sampleIndex) => samples[sampleIndex]),
      tracers,


      rayBudgetOverride: plan.servedCount * raysToCompleteOneSample(tierName),
    });

    const records = new Array(samples.length);
    run.records.forEach((record, servedPosition) => {
      const sampleIndex = plan.servedSampleIndices[servedPosition];
      records[sampleIndex] = Object.assign({}, record, { sampleIndex });
    });
    plan.deferredSampleIndices.forEach((sampleIndex) => {
      records[sampleIndex] = deferredSampleRecord(sampleIndex, plan.pulseIndex + 1);
    });

    const tracersInstalled = installedTracerCount(tracers, run.cascade);
    return finishFrame({
      tierName,
      run,
      plan,
      records,
      tracersInstalled,
      availableRays,
      refusal:
        tracersInstalled === 0
          ? TRACE_POLICY_REFUSAL.noTracerInstalled
          : TRACE_POLICY_REFUSAL.none,
      problems: run.problems.slice(),
      advancePulse: true,
    });
  }

  return {
    execute,
    uniformValues,


    rotationState() {
      return Object.freeze({
        pulseIndex: state.pulseIndex,
        resolvedFrameCount: state.resolvedFrameCount,
      });
    },


    resetRotation() {
      state.pulseIndex = 0;
      state.resolvedFrameCount = 0;
      state.lastFrameSummary = null;
      state.remainingRays = 0;
      lastPublishedSignature = "";
    },


    inspect() {
      return {
        owner: TRACE_POLICY_OWNER,
        registersPass: false,
        refusal: state.refusal,
        pulseIndex: state.pulseIndex,
        resolvedFrameCount: state.resolvedFrameCount,
        uniforms: uniformValues(),
        bufferName: SAMPLE_VISIBILITY_BUFFER_NAME,
        samplerUniform: SAMPLE_VISIBILITY_SAMPLER_UNIFORM,
        frame: state.lastFrameSummary,
        gate: state.lastFrameSummary ? evaluateTracePolicy(state.lastFrameSummary) : null,
      };
    },

    lastFrame: () => state.lastFrameSummary,
  };
}
