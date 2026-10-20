import {
  SPATIAL_FILTER_PASS_NAME,
  SPATIAL_FILTER_PHASE_ID,
  SPATIAL_KERNEL,
  describeSpatialKernel,
} from "./mlSpatialFilterKernelCore.js";
import { filterSpatialFrame } from "./mlSpatialFilterFrameCore.js";
import { SPATIAL_FILTER_GATES, evaluateSpatialFilterGates } from "./mlSpatialFilterGatesCore.js";
import { luminanceOf, relativeVarianceFrom, varianceIsTrusted } from "./mlTemporalVarianceCore.js";

export { SPATIAL_FILTER_PASS_NAME };
export const SPATIAL_FILTER_OWNER = SPATIAL_FILTER_PHASE_ID;


export const SPATIAL_FILTER_CONTEXT_KEY = "spatialFilteredShading";


export const SPATIAL_FILTER_INPUT_CONTEXT_KEY = "temporalFilteredShading";


export const SPATIAL_FILTER_MAX_PIXELS_PER_FRAME = 262144;

export const SPATIAL_FILTER_REFUSAL = Object.freeze({
  none: "none",
  temporalSignalMissing:
    "nothing to filter: no phase published frameContext.temporalFilteredShading this frame, which ML-F20 owns and refuses while it has no inputs",
  signalNotReadable:
    "the published signal carries no readFilteredTexel, so there is no radiance to read and this pass refuses instead of inventing one",
  emptyFrame: "the published signal has no pixels",
  frameTooLargeForCpuReference:
    "the signal is larger than the CPU reference budget: filtering it in JavaScript would freeze the frame, so the pass refuses and says so",
});


export const SPATIAL_FILTER_RESIDUALS = Object.freeze([
  "no driver compiled a GPU program for this phase: the filter runs as a CPU reference over the signal ML-F20 publishes, at the resolution that signal has, and slot 220 of MGL_PATCH_ORDER stays reserved and unused.",
  "the specular channel gets its own radius ceiling of 3 pixels but the SAME edge stopping weights as the diffuse one: a lobe aware kernel needs the roughness of the G-buffer at the filter resolution, which no phase publishes yet.",
  "ML-F22 runs as a frame stage AFTER the whole pass graph, so while its flag is on the composition latches disocclusionResolvedShading, which was refined from ML-F20's signal and not from this one. Reordering that needs a frame stage slot, and this phase owns a PASS.",
  "the depth and normal used for edge stopping come from the texel ML-F20 stored, so they are the geometry of the frame that WROTE that history, not of the current frame. The counters report whether either channel reached the filter at all.",
]);

function finiteNumberOrFallback(value, fallback) {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}


function createPerPixelReader(candidate, width, height) {
  if (typeof candidate === "function") {
    return { available: true, kind: "function", read: (x, y) => Number(candidate(x, y)) };
  }
  const isIndexable =
    !!candidate && typeof candidate.length === "number" && candidate.length >= width * height;
  if (isIndexable) {
    return { available: true, kind: "buffer", read: (x, y) => Number(candidate[y * width + x]) };
  }
  return { available: false, kind: "missing", read: () => NaN };
}






function radianceFieldsOf(texel) {
  if (!texel || typeof texel !== "object") return [];
  const fields = [];
  if (texel.diffuse && typeof texel.diffuse === "object") fields.push("diffuse");
  if (texel.specular && typeof texel.specular === "object") fields.push("specular");
  if (fields.length > 0) return fields;
  if (texel.radiance && typeof texel.radiance === "object") return ["radiance"];
  return [null];
}

function maximumRadiusForField(fieldName) {
  return fieldName === "specular"
    ? SPATIAL_KERNEL.maximumSpecularRadiusInPixels
    : SPATIAL_KERNEL.maximumRadiusInPixels;
}

function varianceSourceForField(signal, fieldName) {
  if (fieldName === "specular") return signal.specularVariance;
  return signal.diffuseVariance;
}





export function createSpatialFilterPass(dependencies) {
  const settings = dependencies || {};
  const telemetry = settings.telemetry || null;

  const state = {
    ranAtLeastOnce: false,
    refusal: SPATIAL_FILTER_REFUSAL.temporalSignalMissing,
    filteredFrameCount: 0,
    lastFrames: [],
    lastSummary: null,
  };

  let lastPublishedSignature = "";


  function uniformValues() {
    return {};
  }







  function measurements() {
    return state.lastSummary ? Object.assign({}, state.lastSummary) : {};
  }

  function evaluateGates(measuredElsewhere) {
    return evaluateSpatialFilterGates(Object.assign({}, measuredElsewhere || {}, measurements()));
  }

  function publishWhenChanged() {
    if (!telemetry || typeof telemetry.phase !== "function") return;
    const summary = state.lastSummary;
    const signature = [
      state.refusal,
      state.ranAtLeastOnce,
      summary ? summary.readPixelCount : 0,
      summary ? summary.blurredPixelCount : 0,
      summary ? summary.tapsUsedTotal : 0,
      summary ? summary.channelNames.join("+") : "",
    ].join("|");
    if (signature === lastPublishedSignature) return;
    lastPublishedSignature = signature;
    telemetry.phase(SPATIAL_FILTER_OWNER, {
      pass: SPATIAL_FILTER_PASS_NAME,
      filteredThisFrame: state.ranAtLeastOnce,
      refusal: state.refusal,
      kernel: describeSpatialKernel(),
      uniforms: uniformValues(),
      measurements: measurements(),
      publishesContextKey: SPATIAL_FILTER_CONTEXT_KEY,
      readsContextKey: SPATIAL_FILTER_INPUT_CONTEXT_KEY,
      injectsGlslInSharedProgram: false,
      residuals: SPATIAL_FILTER_RESIDUALS,
    });
  }

  function refuse(reason) {
    state.refusal = reason;
    state.lastFrames = [];
    state.lastSummary = null;
    publishWhenChanged();
  }


  function summarizeChannels(channels) {
    const summary = {
      channelNames: channels.map((channel) => channel.fieldName || "radiance"),
      readPixelCount: 0,
      blurredPixelCount: 0,
      cleanPixelCount: 0,
      edgePixelCount: 0,
      untrustedVariancePixelCount: 0,
      tapsRequestedTotal: 0,
      tapsUsedTotal: 0,
      tapsRejectedTotal: 0,
      tapsOutOfFrameTotal: 0,
      tapsCollapsedOnCentreTotal: 0,
      maximumRadiusUsedInPixels: 0,
      distinctRotationCount: 0,
      edgeStoppingUsedDepth: false,
      edgeStoppingUsedNormal: false,
      meanRadiusInPixels: 0,
      meanTapsRequestedPerPixel: 0,
      meanTapsUsedPerPixel: 0,
      meanAbsoluteLuminanceChange: 0,
      sparseTapCountPerPixel: SPATIAL_KERNEL.tapCount,
      denseEquivalentTapCount: SPATIAL_KERNEL.denseEquivalentTapCount,
      tapSavingRatioVersusDenseKernel: 0,
    };
    channels.forEach((channel) => {
      const frame = channel.frame;
      summary.readPixelCount += frame.readPixelCount;
      summary.blurredPixelCount += frame.blurredPixelCount;
      summary.cleanPixelCount += frame.cleanPixelCount;
      summary.edgePixelCount += frame.edgePixelCount;
      summary.untrustedVariancePixelCount += frame.untrustedVariancePixelCount;
      summary.tapsRequestedTotal += frame.tapsRequestedTotal;
      summary.tapsUsedTotal += frame.tapsUsedTotal;
      summary.tapsRejectedTotal += frame.tapsRejectedTotal;
      summary.tapsOutOfFrameTotal += frame.tapsOutOfFrameTotal;
      summary.tapsCollapsedOnCentreTotal += frame.tapsCollapsedOnCentreTotal;
      if (frame.maximumRadiusUsedInPixels > summary.maximumRadiusUsedInPixels) {
        summary.maximumRadiusUsedInPixels = frame.maximumRadiusUsedInPixels;
      }
      if (frame.distinctRotationCount > summary.distinctRotationCount) {
        summary.distinctRotationCount = frame.distinctRotationCount;
      }
      if (frame.edgeStoppingUsedDepth) summary.edgeStoppingUsedDepth = true;
      if (frame.edgeStoppingUsedNormal) summary.edgeStoppingUsedNormal = true;
      summary.tapSavingRatioVersusDenseKernel = frame.tapSavingRatioVersusDenseKernel;
    });
    const channelCount = Math.max(1, channels.length);
    summary.meanRadiusInPixels =
      channels.reduce((total, channel) => total + channel.frame.meanRadiusInPixels, 0) / channelCount;
    summary.meanTapsRequestedPerPixel =
      channels.reduce((total, channel) => total + channel.frame.meanTapsRequestedPerPixel, 0) / channelCount;
    summary.meanTapsUsedPerPixel =
      channels.reduce((total, channel) => total + channel.frame.meanTapsUsedPerPixel, 0) / channelCount;
    summary.meanAbsoluteLuminanceChange =
      channels.reduce((total, channel) => total + channel.frame.meanAbsoluteLuminanceChange, 0) / channelCount;
    return summary;
  }

  function execute(frameContext) {
    const context = frameContext || {};
    const signal = context[SPATIAL_FILTER_INPUT_CONTEXT_KEY] || null;

    if (!signal) {
      refuse(SPATIAL_FILTER_REFUSAL.temporalSignalMissing);
      return frameContext;
    }
    if (typeof signal.readFilteredTexel !== "function") {
      refuse(SPATIAL_FILTER_REFUSAL.signalNotReadable);
      return frameContext;
    }

    const width = Math.floor(finiteNumberOrFallback(signal.width, 0));
    const height = Math.floor(finiteNumberOrFallback(signal.height, 0));
    if (!(width >= 1 && height >= 1)) {
      refuse(SPATIAL_FILTER_REFUSAL.emptyFrame);
      return frameContext;
    }
    if (width * height > SPATIAL_FILTER_MAX_PIXELS_PER_FRAME) {
      refuse(SPATIAL_FILTER_REFUSAL.frameTooLargeForCpuReference);
      return frameContext;
    }

    const frameIndex = finiteNumberOrFallback(context.frameIndex, 0);
    const accumulatedFrameCounts = createPerPixelReader(signal.accumulatedFrameCounts, width, height);
    const fieldNames = radianceFieldsOf(signal.readFilteredTexel(0, 0));

    const channels = fieldNames.map((fieldName) => {
      const varianceReader = createPerPixelReader(
        varianceSourceForField(signal, fieldName),
        width,
        height,
      );

      function radianceAt(texel) {
        if (!texel) return null;
        return fieldName ? texel[fieldName] : texel;
      }

      function readPixel(pixelX, pixelY) {
        const texel = signal.readFilteredTexel(pixelX, pixelY);
        if (!texel) return null;
        return { radiance: radianceAt(texel), depth: texel.depth, normal: texel.normal };
      }

      const frame = filterSpatialFrame({
        width,
        height,
        frameIndex,
        channelName: fieldName || "radiance",
        maximumRadiusInPixels: maximumRadiusForField(fieldName),
        readPixel,
        relativeVarianceAt(pixelX, pixelY) {
          const variance = varianceReader.read(pixelX, pixelY);
          if (!Number.isFinite(variance)) return 0;
          const texel = signal.readFilteredTexel(pixelX, pixelY);
          return relativeVarianceFrom(variance, luminanceOf(radianceAt(texel) || { r: 0, g: 0, b: 0 }));
        },
        varianceIsTrustedAt(pixelX, pixelY) {


          if (!varianceReader.available || !accumulatedFrameCounts.available) return false;
          return varianceIsTrusted(accumulatedFrameCounts.read(pixelX, pixelY));
        },
      });

      return { fieldName, frame, varianceKind: varianceReader.kind };
    });

    state.ranAtLeastOnce = true;
    state.refusal = SPATIAL_FILTER_REFUSAL.none;
    state.filteredFrameCount += 1;
    state.lastFrames = channels.map((channel) => channel.frame);
    state.lastSummary = summarizeChannels(channels);
    state.lastSummary.accumulatedFrameCountSource = accumulatedFrameCounts.kind;
    publishWhenChanged();

    context[SPATIAL_FILTER_CONTEXT_KEY] = {
      owner: SPATIAL_FILTER_OWNER,
      width,
      height,


      readFilteredTexel(pixelX, pixelY) {
        const original = signal.readFilteredTexel(pixelX, pixelY);
        if (!original) return original;
        const patched = Object.assign({}, original);
        channels.forEach((channel) => {
          const filtered = channel.frame.readFilteredTexel(pixelX, pixelY);
          if (!filtered) return;
          if (channel.fieldName) {
            patched[channel.fieldName] = filtered;
            return;
          }
          patched.r = filtered.r;
          patched.g = filtered.g;
          patched.b = filtered.b;
        });
        return patched;
      },
      diffuseVariance: signal.diffuseVariance,
      specularVariance: signal.specularVariance,
      accumulatedFrameCounts: signal.accumulatedFrameCounts,
      filteredBy: SPATIAL_FILTER_OWNER,
      spatialFilter: state.lastSummary,
    };
    return context;
  }

  return {
    execute,
    uniformValues,
    measurements,
    evaluateGates,


    inspect() {
      return {
        owner: SPATIAL_FILTER_OWNER,
        pass: SPATIAL_FILTER_PASS_NAME,
        refusal: state.refusal,
        ranAtLeastOnce: state.ranAtLeastOnce,
        filteredFrameCount: state.filteredFrameCount,
        kernel: describeSpatialKernel(),
        gates: SPATIAL_FILTER_GATES,
        measurements: measurements(),
        readsContextKey: SPATIAL_FILTER_INPUT_CONTEXT_KEY,
        publishesContextKey: SPATIAL_FILTER_CONTEXT_KEY,
        maxPixelsPerFrame: SPATIAL_FILTER_MAX_PIXELS_PER_FRAME,
        residuals: SPATIAL_FILTER_RESIDUALS,
      };
    },

    lastFrames: () => state.lastFrames,
  };
}
