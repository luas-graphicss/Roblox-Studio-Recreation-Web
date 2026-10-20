import { TEMPORAL_FILTER_HISTORY_FRAME_COUNT, TEMPORAL_FILTER_PASS_NAME, TEMPORAL_FILTER_PHASE_ID } from "./mlTemporalFilterCore.js";
import { resolveTemporalFrame } from "./mlTemporalFilterFrameCore.js";
import { createTemporalHistoryStore } from "./mlTemporalHistoryStoreCore.js";
import { TEMPORAL_FILTER_GATES, evaluateTemporalFilterGates } from "./mlTemporalFilterGatesCore.js";
import {
  MGL_TEMPORAL_FILTER_GLSL_REVISION,
  TEMPORAL_FILTER_INPUT_UNIFORM_NAMES,
  TEMPORAL_FILTER_OUTPUT_NAMES,
  TEMPORAL_FILTER_UNIFORM_NAMES,
  buildTemporalFilterFragmentShader,
  buildTemporalFilterVertexShader,
} from "./mlTemporalFilterGlsl.js";
import { uniformDefinition } from "./mlUniformNames.js";

export { TEMPORAL_FILTER_PASS_NAME };
export const TEMPORAL_FILTER_OWNER = TEMPORAL_FILTER_PHASE_ID;

export const TEMPORAL_FILTER_REFUSAL = Object.freeze({
  none: "none",
  inputsMissing:
    "nothing to filter: no phase publishes frameContext.temporalFilterInputs yet (ML-F18 shades, ML-F19 resolves to full resolution, ML-F3 owns depth, normal and velocity)",
  geometryMissing:
    "frameContext.upsampledShading carries radiance only: reprojection needs depth, normal and velocity per pixel, so this pass refuses instead of reprojecting blind",
  emptyFrame: "the frame has no pixels",
  uniformNotOwned: "a uniform this pass publishes is not reserved to ML-F20 in the contract",
});


export const TEMPORAL_FILTER_RESIDUALS = Object.freeze([
  "GPU rejection reads the depth and normal of the CURRENT frame at the reprojected tap: MGL_BUFFERS reserves no previous-frame geometry channel and both history layouts are frozen with alpha already spent on the accumulated frame count. The CPU reference, which the acceptance numbers are measured on, uses the geometry stored in its own history texel.",
  "no driver compiled the GPU program from this phase: parity with the cores is proven by shared constants and by transcription, not by a rendered frame.",
  "the full resolution signal arrives through uMglShadedDiffuse and uMglShadedSpecular, the names the contract already reserves, because ML-F19 has no full resolution output buffer of its own. Inventing a third name would be a contract change ML-F20 does not own.",
  "no GLSL patch is registered in the shared lighting program: this pass runs in its own offscreen program, and the composite that samples the history belongs to ML-F21. Slot 200 of MGL_PATCH_ORDER stays reserved and unused.",
]);

function uniformsNotOwnedByThisPhase() {
  return TEMPORAL_FILTER_UNIFORM_NAMES.filter((uniformName) => {
    const definition = uniformDefinition(uniformName);
    return !definition || definition.phase !== TEMPORAL_FILTER_PHASE_ID;
  });
}






export function createTemporalFilterPass(dependencies) {
  const settings = dependencies || {};
  const telemetry = settings.telemetry || null;
  const historyStore = settings.historyStore || createTemporalHistoryStore({ width: 0, height: 0 });

  const state = {
    ranAtLeastOnce: false,
    refusal: TEMPORAL_FILTER_REFUSAL.inputsMissing,
    lastFrame: null,
    resolvedFrameCount: 0,
    lastFrameIndex: null,
    resolvesInCurrentFrame: 0,
    maximumResolvesInAFrame: 0,
  };

  let lastPublishedSignature = "";

  function uniformValues() {
    return { uMglTemporalFrameCount: TEMPORAL_FILTER_HISTORY_FRAME_COUNT };
  }








  function measurements() {
    const measured = {};
    if (state.resolvedFrameCount > 0) {
      measured.temporalPassesPerFrame = state.maximumResolvesInAFrame;
    }
    return measured;
  }

  function evaluateGates(measuredElsewhere) {
    return evaluateTemporalFilterGates(Object.assign({}, measuredElsewhere || {}, measurements()));
  }

  function publishWhenChanged() {
    if (!telemetry || typeof telemetry.phase !== "function") return;
    const frame = state.lastFrame;
    const signature = [
      state.refusal,
      state.ranAtLeastOnce,
      state.maximumResolvesInAFrame,
      frame ? frame.resolvedPixelCount : 0,
      frame ? frame.historyAcceptedPixelCount : 0,
      frame ? frame.trustedVariancePixelCount : 0,
    ].join("|");
    if (signature === lastPublishedSignature) return;
    lastPublishedSignature = signature;
    telemetry.phase(TEMPORAL_FILTER_OWNER, {
      pass: TEMPORAL_FILTER_PASS_NAME,
      resolvedThisFrame: state.ranAtLeastOnce,
      refusal: state.refusal,
      uniforms: uniformValues(),
      measurements: measurements(),
      temporalPassesPerFrameWorstCase: state.maximumResolvesInAFrame,
      counters: frame
        ? {
            resolvedPixelCount: frame.resolvedPixelCount,
            historyAcceptedPixelCount: frame.historyAcceptedPixelCount,
            historyRejectedPixelCount: frame.historyRejectedPixelCount,
            trustedVariancePixelCount: frame.trustedVariancePixelCount,
            meanDiffuseVariance: frame.meanDiffuseVariance,
            meanSpecularVariance: frame.meanSpecularVariance,
            resolveReasonCounts: frame.resolveReasonCounts,
          }
        : null,
      residuals: TEMPORAL_FILTER_RESIDUALS,
    });
  }

  function refuse(reason) {
    state.refusal = reason;
    state.lastFrame = null;
    publishWhenChanged();
  }

  function countResolveInFrame(frameIndexValue) {
    const frameIndex = Number.isFinite(Number(frameIndexValue)) ? Math.floor(Number(frameIndexValue)) : null;
    if (frameIndex !== null && frameIndex === state.lastFrameIndex) {
      state.resolvesInCurrentFrame += 1;
    } else {
      state.lastFrameIndex = frameIndex;
      state.resolvesInCurrentFrame = 1;
    }
    state.maximumResolvesInAFrame = Math.max(state.maximumResolvesInAFrame, state.resolvesInCurrentFrame);
  }


  function execute(frameContext) {
    const context = frameContext || {};
    const inputs = context.temporalFilterInputs || null;

    if (!inputs) {
      refuse(context.upsampledShading ? TEMPORAL_FILTER_REFUSAL.geometryMissing : TEMPORAL_FILTER_REFUSAL.inputsMissing);
      return frameContext;
    }

    const width = Math.floor(Number(inputs.width) || 0);
    const height = Math.floor(Number(inputs.height) || 0);
    if (!(width >= 1 && height >= 1)) {
      refuse(TEMPORAL_FILTER_REFUSAL.emptyFrame);
      return frameContext;
    }

    const notOwned = uniformsNotOwnedByThisPhase();
    if (notOwned.length > 0) {
      refuse(`${TEMPORAL_FILTER_REFUSAL.uniformNotOwned}: ${notOwned.join(", ")}`);
      return frameContext;
    }

    const frameIndex = inputs.frameIndex === undefined ? context.frameIndex : inputs.frameIndex;
    countResolveInFrame(frameIndex);

    historyStore.resize(width, height);
    const frame = resolveTemporalFrame({
      width,
      height,
      readCurrentPixel: inputs.readCurrentPixel,
      historyStore,
      collectPixels: inputs.collectPixels === true,
    });


    historyStore.swap();

    state.ranAtLeastOnce = true;
    state.refusal = TEMPORAL_FILTER_REFUSAL.none;
    state.lastFrame = frame;
    state.resolvedFrameCount += 1;
    publishWhenChanged();

    context.temporalFilteredShading = {
      owner: TEMPORAL_FILTER_OWNER,
      width: frame.width,
      height: frame.height,
      readFilteredTexel: (pixelX, pixelY) => historyStore.readTexel(pixelX, pixelY),
      diffuseVariance: frame.diffuseVariance,
      specularVariance: frame.specularVariance,
      accumulatedFrameCounts: frame.accumulatedFrameCounts,
      counters: frame,
    };
    return context;
  }

  return {
    execute,
    uniformValues,
    measurements,
    evaluateGates,
    historyStore: () => historyStore,


    shaderSource(options) {
      return {
        revision: MGL_TEMPORAL_FILTER_GLSL_REVISION,
        vertexShader: buildTemporalFilterVertexShader(),
        fragmentShader: buildTemporalFilterFragmentShader(options),
        ownedUniformNames: TEMPORAL_FILTER_UNIFORM_NAMES.slice(),
        inputUniformNames: TEMPORAL_FILTER_INPUT_UNIFORM_NAMES.slice(),
        outputNames: TEMPORAL_FILTER_OUTPUT_NAMES.slice(),
      };
    },


    inspect() {
      return {
        owner: TEMPORAL_FILTER_OWNER,
        pass: TEMPORAL_FILTER_PASS_NAME,
        refusal: state.refusal,
        ranAtLeastOnce: state.ranAtLeastOnce,
        uniforms: uniformValues(),
        gates: TEMPORAL_FILTER_GATES,
        measurements: measurements(),
        historyFrameCount: TEMPORAL_FILTER_HISTORY_FRAME_COUNT,
        historyStore: historyStore.describe(),
        counters: state.lastFrame,
        residuals: TEMPORAL_FILTER_RESIDUALS,
        glslRevision: MGL_TEMPORAL_FILTER_GLSL_REVISION,
      };
    },

    lastFrame: () => state.lastFrame,
  };
}
