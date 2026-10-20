import {
  FULL_RESOLUTION_MODE_NAME,
  resolveDownsampleMode,
  downsampleModeNameForTier,
  downsampledResolution,
  downsampleModeRows,
} from "./mlDownsampleModeCore.js";
import {
  DEFAULT_TEMPORAL_JITTER_POLICY,
  patternUniformValue,
  sampleOffsetForBlock,
  sampledPixelForBlock,
  isFullPixelSampled,
} from "./mlDownsamplePatternCore.js";
import { measureAcceptanceGates } from "./mlDownsampleGateMetricsCore.js";
import * as uniformRegistry from "./mlUniformNames.js";

export const DOWNSAMPLE_PHASE_ID = "ML-F12";
export const DOWNSAMPLE_FLAG_ID = "MegaLightsDownsample";

export const DOWNSAMPLE_UNIFORM_NAMES = Object.freeze({
  factor: "uMglDownsampleFactor",
  pattern: "uMglDownsamplePattern",
});


const GATE_REPORT_RESOLUTION = Object.freeze({ width: 64, height: 64 });

function positiveInteger(value, fallbackValue) {
  const rounded = Math.floor(Number(value));
  return Number.isFinite(rounded) && rounded > 0 ? rounded : fallbackValue;
}

function zeroOrMore(value) {
  const rounded = Math.floor(Number(value));
  return Number.isFinite(rounded) && rounded > 0 ? rounded : 0;
}


export function verifyUniformOwnership() {
  const problems = [];
  const names = [DOWNSAMPLE_UNIFORM_NAMES.factor, DOWNSAMPLE_UNIFORM_NAMES.pattern];
  names.forEach((uniformName) => {
    const definition =
      typeof uniformRegistry.uniformDefinition === "function"
        ? uniformRegistry.uniformDefinition(uniformName)
        : null;
    if (!definition) {
      problems.push(uniformName + " is not reserved in the contract");
      return;
    }
    if (definition.phase !== DOWNSAMPLE_PHASE_ID) {
      problems.push(uniformName + " belongs to " + String(definition.phase) + ", not " + DOWNSAMPLE_PHASE_ID);
    }
  });
  return Object.freeze({ ok: problems.length === 0, problems: Object.freeze(problems) });
}


export function createDownsampleController(options) {
  const settings = options || {};
  const telemetry = settings.telemetry || null;
  const isFlagEnabled =
    typeof settings.isFlagEnabled === "function" ? settings.isFlagEnabled : () => true;
  const temporalJitterPolicy = settings.temporalJitterPolicy || DEFAULT_TEMPORAL_JITTER_POLICY;
  const groupPhaseSource =
    typeof settings.groupPhaseSource === "function" ? settings.groupPhaseSource : undefined;

  const refusalCountByReason = new Map();
  let planCount = 0;
  let lastPlan = null;

  function recordRefusal(reason) {
    refusalCountByReason.set(reason, (refusalCountByReason.get(reason) || 0) + 1);
  }

  function publishUniforms(plan) {
    if (!telemetry || typeof telemetry.uniform !== "function") return;
    telemetry.uniform(DOWNSAMPLE_UNIFORM_NAMES.factor, plan.uniforms[DOWNSAMPLE_UNIFORM_NAMES.factor]);
    telemetry.uniform(DOWNSAMPLE_UNIFORM_NAMES.pattern, plan.uniforms[DOWNSAMPLE_UNIFORM_NAMES.pattern]);
  }





  function planForFrame(request) {
    const frameRequest = request || {};
    const tier = String(frameRequest.tier || "");
    const frameIndex = zeroOrMore(frameRequest.frameIndex);
    const fullWidth = positiveInteger(frameRequest.fullWidth, 1);
    const fullHeight = positiveInteger(frameRequest.fullHeight, 1);
    const requestedModeName = String(frameRequest.modeName || downsampleModeNameForTier(tier));

    let refusal = "";
    let mode = resolveDownsampleMode(requestedModeName);
    if (!mode) {
      refusal = 'unknown downsample mode "' + requestedModeName + '": staying at full resolution';
    } else if (!isFlagEnabled(tier)) {
      refusal = "flag " + DOWNSAMPLE_FLAG_ID + " is off for tier " + tier + ": staying at full resolution";
    }
    if (refusal) {
      recordRefusal(refusal);
      mode = resolveDownsampleMode(FULL_RESOLUTION_MODE_NAME);
    }

    const grid = downsampledResolution(fullWidth, fullHeight, mode.factor);
    const samplesThisFrame = grid.width * grid.height;
    const plan = Object.freeze({
      phase: DOWNSAMPLE_PHASE_ID,
      tier,
      frameIndex,
      modeName: mode.name,
      factor: mode.factor,
      pattern: mode.pattern,
      blockPixelCount: mode.blockPixelCount,
      coverageWindowFrames: mode.coverageWindowFrames,
      temporalJitterPolicy,
      fullWidth,
      fullHeight,
      downsampledWidth: grid.width,
      downsampledHeight: grid.height,
      samplesThisFrame,
      samplesAtFullResolution: fullWidth * fullHeight,
      sampleReductionRatio: samplesThisFrame / (fullWidth * fullHeight),
      uniforms: Object.freeze({
        [DOWNSAMPLE_UNIFORM_NAMES.factor]: mode.factor,
        [DOWNSAMPLE_UNIFORM_NAMES.pattern]: patternUniformValue(mode.pattern),
      }),
      refusal,
    });

    planCount += 1;
    lastPlan = plan;
    publishUniforms(plan);
    return plan;
  }

  function patternRequestFromPlan(plan, extra) {
    return {
      pattern: plan.pattern,
      factor: plan.factor,
      fullWidth: plan.fullWidth,
      fullHeight: plan.fullHeight,
      frameIndex: plan.frameIndex,
      policy: temporalJitterPolicy,
      groupPhaseSource,
      ...extra,
    };
  }

  return Object.freeze({
    phaseId: DOWNSAMPLE_PHASE_ID,
    flagId: DOWNSAMPLE_FLAG_ID,
    uniformNames: DOWNSAMPLE_UNIFORM_NAMES,
    temporalJitterPolicy,

    planForFrame,


    sampledPixelForBlock(plan, blockX, blockY) {
      return sampledPixelForBlock(patternRequestFromPlan(plan, { blockX, blockY }));
    },


    sampleOffsetForBlock(plan, blockX, blockY) {
      return sampleOffsetForBlock(patternRequestFromPlan(plan, { blockX, blockY }));
    },


    isFullPixelSampled(plan, fullX, fullY) {
      return isFullPixelSampled(patternRequestFromPlan(plan, { fullX, fullY }));
    },


    gateReport(request) {
      const gateRequest = request || {};
      return measureAcceptanceGates({
        modeName: gateRequest.modeName || (lastPlan ? lastPlan.modeName : FULL_RESOLUTION_MODE_NAME),
        fullWidth: gateRequest.fullWidth || GATE_REPORT_RESOLUTION.width,
        fullHeight: gateRequest.fullHeight || GATE_REPORT_RESOLUTION.height,
        startFrame: gateRequest.startFrame,
        field: gateRequest.field,
        policy: temporalJitterPolicy,
        groupPhaseSource,
      });
    },

    describe() {
      return Object.freeze({
        phase: DOWNSAMPLE_PHASE_ID,
        flag: DOWNSAMPLE_FLAG_ID,
        ownsPass: false,
        glslPatchCount: 0,
        reservedTextureUnits: 0,
        uniforms: Object.freeze([DOWNSAMPLE_UNIFORM_NAMES.factor, DOWNSAMPLE_UNIFORM_NAMES.pattern]),
        uniformOwnership: verifyUniformOwnership(),
        modes: Object.freeze(downsampleModeRows()),
        temporalJitterPolicy,
        planCount,
        lastPlan,
        refusals: Object.freeze(
          Array.from(refusalCountByReason.entries()).map(([reason, count]) =>
            Object.freeze({ reason, count }),
          ),
        ),
      });
    },
  });
}
