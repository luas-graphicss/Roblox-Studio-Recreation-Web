import {
  SAMPLE_SHADING_ENFORCED_REFUSALS,
  SAMPLE_SHADING_PASS_NAME,
  SHADED_SIGNAL_CHANNELS,
  describeSampleShading,
} from "./mlSampleShadingCore.js";
import {
  readShadedRadiance,
  readShadedTexel,
  shadeFrame,
} from "./mlSampleShadingFrameCore.js";
import {
  SAMPLE_SHADING_ACCEPTANCE,
  createSampleShadingStats,
  describeSampleShadingStats,
} from "./mlSampleShadingStatsCore.js";
import {
  SAMPLE_SHADING_OUTPUT_LOCATIONS,
  buildSampleShadingFragmentShader,
  sampleShadingUniformNames,
} from "./mlSampleShadingGlsl.js";
import {
  SHADED_SIGNAL_BUFFER_NAMES,
  createShadedSignalTargets,
  shadedSignalBufferDeclaration,
} from "./mlShadedSignalTargets.js";
import { describeAlbedoFactorization } from "./mlAlbedoFactorizationCore.js";

export { SAMPLE_SHADING_PASS_NAME };
export const SAMPLE_SHADING_OWNER = "ML-F18";


export const SAMPLE_SHADING_OWNED_UNIFORM_NAMES = Object.freeze([
  "uMglShadedDiffuse",
  "uMglShadedSpecular",
]);

export const SAMPLE_SHADING_REFUSAL = Object.freeze({
  none: "none",
  inputsMissing:
    "nothing to shade: ML-F7 and ML-F11 (samples) and ML-F17 (visibility) do not publish sampleShadingInputs in the frame context yet",
  emptyTarget: "the downsampled target has no pixels",
});

function resolveDownsampleFactor(inputs) {
  const factor = Number(inputs && inputs.downsampleFactor);
  return Number.isFinite(factor) && factor >= 1 ? Math.floor(factor) : 1;
}


export function createSampleShadingPass(dependencies) {
  const settings = dependencies || {};
  const telemetry = settings.telemetry || null;
  const targets = settings.THREE ? createShadedSignalTargets({ THREE: settings.THREE }) : null;
  const stats = createSampleShadingStats();

  const state = {
    ranAtLeastOnce: false,
    refusal: SAMPLE_SHADING_REFUSAL.inputsMissing,
    samplesPerPixel: fallbackSamplesPerPixel(),
    downsampleFactor: 1,
    lastFrame: null,
    lastStats: null,
  };

  let lastPublishedSignature = "";

  function fallbackSamplesPerPixel() {
    const budget = settings.samplesPerPixel;
    const value = typeof budget === "function" ? Number(budget()) : Number(budget);
    return Number.isFinite(value) && value >= 1 ? Math.floor(value) : 1;
  }


  function resolveSamplesPerPixel(inputs) {
    const requested = Number(inputs && inputs.samplesPerPixel);
    if (Number.isFinite(requested) && requested >= 1) return Math.floor(requested);
    return fallbackSamplesPerPixel();
  }


  function programUniformValues() {
    return {
      uMglSamplesPerPixel: state.samplesPerPixel,
      uMglDownsampleFactor: state.downsampleFactor,
    };
  }

  function publishWhenChanged() {
    if (!telemetry || typeof telemetry.phase !== "function") return;
    const summary = state.lastStats;
    const signature = [
      state.refusal,
      state.ranAtLeastOnce,
      state.samplesPerPixel,
      summary ? summary.shadedSamples : 0,
      summary ? summary.occludedSamples : 0,
      summary ? summary.occludedSamplesShaded : 0,
      summary ? summary.skyPixels : 0,
    ].join("|");
    if (signature === lastPublishedSignature) return;
    lastPublishedSignature = signature;
    telemetry.phase(SAMPLE_SHADING_OWNER, {
      pass: SAMPLE_SHADING_PASS_NAME,
      shadedThisFrame: state.ranAtLeastOnce,
      refusal: state.refusal,
      uniforms: programUniformValues(),
      counters: summary,
      countersInPlainWords: describeSampleShadingStats(summary),
      meetsNoOccludedShadingGate: summary ? summary.meetsNoOccludedShadingGate : null,
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
    const inputs = context.sampleShadingInputs || null;

    if (!inputs) {
      refuse(SAMPLE_SHADING_REFUSAL.inputsMissing);
      return frameContext;
    }

    const width = Math.floor(Number(inputs.width) || 0);
    const height = Math.floor(Number(inputs.height) || 0);
    if (!(width >= 1 && height >= 1)) {
      refuse(SAMPLE_SHADING_REFUSAL.emptyTarget);
      return frameContext;
    }

    state.samplesPerPixel = resolveSamplesPerPixel(inputs);
    state.downsampleFactor = resolveDownsampleFactor(inputs);

    stats.reset();
    const frame = shadeFrame({
      width,
      height,
      samplesPerPixel: state.samplesPerPixel,
      readSurface: inputs.readSurface,
      readSamples: inputs.readSamples,
      collectTexels: inputs.collectTexels === true,
      stats,
    });

    state.ranAtLeastOnce = true;
    state.refusal = SAMPLE_SHADING_REFUSAL.none;
    state.lastFrame = frame;
    state.lastStats = frame.stats;
    publishWhenChanged();


    context.shadedSignals = {
      owner: SAMPLE_SHADING_OWNER,
      buffers: SHADED_SIGNAL_BUFFER_NAMES.slice(),
      channels: SHADED_SIGNAL_CHANNELS,
      width: frame.width,
      height: frame.height,
      downsampleFactor: state.downsampleFactor,
      samplesPerPixel: state.samplesPerPixel,
      factoredOut: ["albedo", "envBrdf"],
      replacesDirectShading: true,
      darkensExistingBuffer: false,
      totals: frame.totals,
      counters: frame.stats,
      readShadedTexel: (pixelX, pixelY) => readShadedTexel(frame, pixelX, pixelY),
      readTapRadiance: (pixelX, pixelY) => readShadedRadiance(frame, pixelX, pixelY),
    };
    return context;
  }

  return {
    execute,
    programUniformValues,
    ownedUniformNames: () => SAMPLE_SHADING_OWNED_UNIFORM_NAMES.slice(),


    ensureTargets(fullWidth, fullHeight, downsampleFactor) {
      if (!targets) return { allocated: false, reason: "no THREE injected", width: 0, height: 0 };
      return targets.ensure(fullWidth, fullHeight, downsampleFactor);
    },

    disposeTargets() {
      if (targets) targets.dispose();
    },

    textureFor(bufferName) {
      return targets ? targets.textureFor(bufferName) : null;
    },


    shaderSource(options) {
      return {
        fragmentShader: buildSampleShadingFragmentShader(options),
        outputLocations: SAMPLE_SHADING_OUTPUT_LOCATIONS,
        uniformNames: sampleShadingUniformNames(options),
        ownedUniformNames: SAMPLE_SHADING_OWNED_UNIFORM_NAMES.slice(),
      };
    },


    inspect() {
      return {
        owner: SAMPLE_SHADING_OWNER,
        pass: SAMPLE_SHADING_PASS_NAME,
        refusal: state.refusal,
        ranAtLeastOnce: state.ranAtLeastOnce,
        uniforms: programUniformValues(),
        estimator: describeSampleShading(),
        factorization: describeAlbedoFactorization(),
        enforcedRefusals: SAMPLE_SHADING_ENFORCED_REFUSALS,
        acceptance: SAMPLE_SHADING_ACCEPTANCE,
        counters: state.lastStats,
        countersInPlainWords: describeSampleShadingStats(state.lastStats),
        outputBuffers: SHADED_SIGNAL_BUFFER_NAMES.map((bufferName) => ({
          name: bufferName,
          declared: shadedSignalBufferDeclaration(bufferName),
        })),
        targets: targets ? targets.describe() : null,
      };
    },

    lastFrame: () => state.lastFrame,
  };
}
