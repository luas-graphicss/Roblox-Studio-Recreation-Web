import { EDGE_STOPPING_DEFAULTS } from "./mlUpsampleEdgeWeightCore.js";
import { UPSAMPLE_ACCEPTANCE, createUpsampleStats, describeUpsampleStats } from "./mlUpsampleStatsCore.js";
import { upsampleFrame } from "./mlUpsampleFrameCore.js";
import {
  MGL_UPSAMPLE_GLSL_REVISION,
  STOCHASTIC_UPSAMPLE_INPUT_UNIFORM_NAMES,
  STOCHASTIC_UPSAMPLE_UNIFORM_NAMES,
  buildStochasticUpsampleFragmentShader,
  buildStochasticUpsampleVertexShader,
} from "./mlStochasticUpsampleGlsl.js";
import { MGL_DOWNSAMPLE_MODES } from "./mlPipelineContract.js";

export const STOCHASTIC_UPSAMPLE_PASS_NAME = "stochasticUpsample";
export const STOCHASTIC_UPSAMPLE_OWNER = "ML-F19";

export const UPSAMPLE_REFUSAL = Object.freeze({
  none: "none",
  inputsMissing:
    "nothing to upsample: ML-F12 and ML-F18 do not publish a downsampled shading result in the frame context yet",
  emptyTarget: "the target has no pixels",
});

function resolveDownsampleFactor(inputs) {
  const factor = Number(inputs && inputs.downsampleFactor);
  if (Number.isFinite(factor) && factor >= 1) return Math.floor(factor);
  return Number(MGL_DOWNSAMPLE_MODES.full.factor) || 1;
}


export function createStochasticUpsamplePass(dependencies) {
  const settings = dependencies || {};
  const telemetry = settings.telemetry || null;
  const edgeStopping = Object.assign({}, EDGE_STOPPING_DEFAULTS, settings.edgeStopping || {});
  const stats = createUpsampleStats();

  const state = {
    ranAtLeastOnce: false,
    refusal: UPSAMPLE_REFUSAL.inputsMissing,
    lastFrame: null,
    lastStats: null,
  };

  let lastPublishedSignature = "";

  function uniformValues() {
    return {
      uMglUpsampleDepthWeight: edgeStopping.depthWeight,
      uMglUpsampleNormalWeight: edgeStopping.normalWeight,
    };
  }

  function publishWhenChanged() {
    if (!telemetry || typeof telemetry.phase !== "function") return;
    const summary = state.lastStats;
    const signature = [
      state.refusal,
      state.ranAtLeastOnce,
      summary ? summary.resolvedPixels : 0,
      summary ? summary.holePixels : 0,
      summary ? summary.historyFallbacks : 0,
      summary ? summary.nearestNeighborLastResorts : 0,
    ].join("|");
    if (signature === lastPublishedSignature) return;
    lastPublishedSignature = signature;
    telemetry.phase(STOCHASTIC_UPSAMPLE_OWNER, {
      pass: STOCHASTIC_UPSAMPLE_PASS_NAME,
      resolvedThisFrame: state.ranAtLeastOnce,
      refusal: state.refusal,
      uniforms: uniformValues(),
      counters: summary,
      countersInPlainWords: describeUpsampleStats(summary),
      meetsNoHoleGate: summary ? summary.meetsNoHoleGate : null,
    });
  }

  function refuse(reason) {
    state.refusal = reason;
    state.lastFrame = null;
    state.lastStats = null;
    publishWhenChanged();
  }


  function execute(frameContext) {
    const context = frameContext || {};
    const inputs = context.upsampleInputs || null;

    if (!inputs) {
      refuse(UPSAMPLE_REFUSAL.inputsMissing);
      return frameContext;
    }
    const fullWidth = Math.floor(Number(inputs.fullWidth) || 0);
    const fullHeight = Math.floor(Number(inputs.fullHeight) || 0);
    if (!(fullWidth >= 1 && fullHeight >= 1)) {
      refuse(UPSAMPLE_REFUSAL.emptyTarget);
      return frameContext;
    }

    stats.reset();
    const frame = upsampleFrame({
      fullWidth,
      fullHeight,
      downsampleFactor: resolveDownsampleFactor(inputs),
      readCenterGeometry: inputs.readCenterGeometry,
      readTapGeometry: inputs.readTapGeometry,
      readTapRadiance: inputs.readTapRadiance,
      readHistory: inputs.readHistory,
      randomValueAt: inputs.randomValueAt,
      edgeStopping,
      collectRadiance: inputs.collectRadiance === true,
      stats,
    });

    state.ranAtLeastOnce = true;
    state.refusal = UPSAMPLE_REFUSAL.none;
    state.lastFrame = frame;
    state.lastStats = frame.stats;
    publishWhenChanged();

    context.upsampledShading = {
      owner: STOCHASTIC_UPSAMPLE_OWNER,
      fullWidth: frame.fullWidth,
      fullHeight: frame.fullHeight,
      downsampleFactor: frame.downsampleFactor,
      radiance: frame.radiance,
      counters: frame.stats,
    };
    return context;
  }

  return {
    execute,
    uniformValues,
    edgeStopping: () => Object.assign({}, edgeStopping),


    shaderSource(options) {
      return {
        revision: MGL_UPSAMPLE_GLSL_REVISION,
        vertexShader: buildStochasticUpsampleVertexShader(),
        fragmentShader: buildStochasticUpsampleFragmentShader(options),
        ownedUniformNames: STOCHASTIC_UPSAMPLE_UNIFORM_NAMES.slice(),
        inputUniformNames: STOCHASTIC_UPSAMPLE_INPUT_UNIFORM_NAMES.slice(),
      };
    },


    inspect() {
      return {
        owner: STOCHASTIC_UPSAMPLE_OWNER,
        pass: STOCHASTIC_UPSAMPLE_PASS_NAME,
        refusal: state.refusal,
        ranAtLeastOnce: state.ranAtLeastOnce,
        uniforms: uniformValues(),
        edgeStopping: Object.assign({}, edgeStopping),
        acceptance: UPSAMPLE_ACCEPTANCE,
        counters: state.lastStats,
        countersInPlainWords: describeUpsampleStats(state.lastStats),
        glslRevision: MGL_UPSAMPLE_GLSL_REVISION,
      };
    },

    lastFrame: () => state.lastFrame,
  };
}
