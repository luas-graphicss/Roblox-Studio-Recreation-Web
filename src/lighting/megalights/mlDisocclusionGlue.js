import { mlQa } from "./runtime/megaLightsTelemetry.js";
import {
  DISOCCLUSION_FRAME_REFUSAL,
  resolveDisocclusionFrame,
} from "./mlDisocclusionFrameCore.js";
import { SHADING_CONFIDENCE_DEFINITION } from "./mlShadingConfidenceCore.js";

export const DISOCCLUSION_OWNER = "ML-F22";
export const DISOCCLUSION_STAGE_NAME = "disocclusionRefinement";


export const DISOCCLUSION_SIGNAL_CONTEXT_KEY = "disocclusionResolvedShading";

export const DISOCCLUSION_REFUSAL = Object.freeze({
  none: "none",
  denoisedSignalMissing: "denoisedSignalMissing",
  signalNotReadable: "signalNotReadable",
  emptyFrame: "emptyFrame",
  overBudget: "overBudget",
});

const FRAME_REFUSAL_TO_GLUE_REFUSAL = Object.freeze({
  [DISOCCLUSION_FRAME_REFUSAL.signalMissing]: DISOCCLUSION_REFUSAL.signalNotReadable,
  [DISOCCLUSION_FRAME_REFUSAL.emptyFrame]: DISOCCLUSION_REFUSAL.emptyFrame,
  [DISOCCLUSION_FRAME_REFUSAL.overBudget]: DISOCCLUSION_REFUSAL.overBudget,
});

const UPSAMPLE_FALLBACK_STATE = Object.freeze({
  used: "used",
  noUpsampledShading: "noUpsampledShading",
  radianceMissing: "radianceMissing",
  resolutionMismatch: "resolutionMismatch",
});

function isReadableDenoisedSignal(signal) {
  return !!signal && typeof signal.readFilteredTexel === "function";
}


function resolveUpsampleFallback(upsampledShading, width, height) {
  if (!upsampledShading) return { read: null, state: UPSAMPLE_FALLBACK_STATE.noUpsampledShading };

  const radiance = upsampledShading.radiance;
  if (!radiance || typeof radiance.length !== "number") {
    return { read: null, state: UPSAMPLE_FALLBACK_STATE.radianceMissing };
  }

  const fullWidth = Math.floor(Number(upsampledShading.fullWidth) || 0);
  const fullHeight = Math.floor(Number(upsampledShading.fullHeight) || 0);
  if (fullWidth !== width || fullHeight !== height) {
    return { read: null, state: UPSAMPLE_FALLBACK_STATE.resolutionMismatch };
  }

  const read = (pixelX, pixelY) => {
    const offset = (pixelY * fullWidth + pixelX) * 3;
    if (offset >= radiance.length) return null;
    return { r: radiance[offset], g: radiance[offset + 1], b: radiance[offset + 2] };
  };
  return { read, state: UPSAMPLE_FALLBACK_STATE.used };
}

function publishRefinedSignal(frameContext, frameResult, counters) {
  const { width, height, diffuse, specular, accumulatedFrameCounts, shadingConfidence } = frameResult;

  const pixelIsInsideFrame = (pixelX, pixelY) =>
    pixelX >= 0 && pixelY >= 0 && !(pixelX >= width) && !(pixelY >= height);

  const readFilteredTexel = (pixelX, pixelY) => {
    if (!pixelIsInsideFrame(pixelX, pixelY)) return null;
    const pixelIndex = pixelY * width + pixelX;
    const offset = pixelIndex * 3;
    return {
      diffuse: { r: diffuse[offset], g: diffuse[offset + 1], b: diffuse[offset + 2] },
      specular: { r: specular[offset], g: specular[offset + 1], b: specular[offset + 2] },
      accumulatedFrameCount: accumulatedFrameCounts[pixelIndex],
    };
  };

  const readShadingConfidence = (pixelX, pixelY) => {
    if (!pixelIsInsideFrame(pixelX, pixelY)) return 0;
    return shadingConfidence[pixelY * width + pixelX] / 255;
  };

  frameContext[DISOCCLUSION_SIGNAL_CONTEXT_KEY] = {
    owner: DISOCCLUSION_OWNER,
    refinedFrom: "ML-F20",
    width,
    height,
    readFilteredTexel,
    readShadingConfidence,
    accumulatedFrameCounts,
    counters,
  };

  frameContext.shadingConfidence = {
    owner: DISOCCLUSION_OWNER,
    width,
    height,
    read: readShadingConfidence,
    values: shadingConfidence,
    meanConfidence: frameResult.stats.meanConfidence,
    definition: SHADING_CONFIDENCE_DEFINITION.historyLengthAndRelativeVariance,
  };
}


export function createDisocclusionGlue(settings) {
  const options = settings || {};
  const telemetry = options.telemetry || mlQa;

  let lastFrameReport = null;

  function publishTelemetry(report) {
    telemetry.phase(DISOCCLUSION_OWNER, {
      stage: DISOCCLUSION_STAGE_NAME,
      runsAfter: "ML-F20:temporalFilter",
      publishes: "frameContext." + DISOCCLUSION_SIGNAL_CONTEXT_KEY,
      refusal: report.refusal,


      antiFireflyScope: "pixelsInsideDisocclusionWindow",
      shadingConfidenceDefinition: SHADING_CONFIDENCE_DEFINITION.historyLengthAndRelativeVariance,
      upsampleFallback: report.upsampleFallback,
      counters: report.counters,
    });
  }

  function refuse(refusal, extra) {
    const report = {
      refusal,
      upsampleFallback: (extra && extra.upsampleFallback) || null,
      counters: (extra && extra.counters) || null,
    };
    lastFrameReport = report;
    publishTelemetry(report);
    return report;
  }

  return {
    execute(frameContext) {
      const context = frameContext || {};
      const denoisedSignal = context.temporalFilteredShading;

      if (!denoisedSignal) return refuse(DISOCCLUSION_REFUSAL.denoisedSignalMissing);
      if (!isReadableDenoisedSignal(denoisedSignal)) {
        return refuse(DISOCCLUSION_REFUSAL.signalNotReadable);
      }

      const width = Math.floor(Number(denoisedSignal.width) || 0);
      const height = Math.floor(Number(denoisedSignal.height) || 0);
      const fallback = resolveUpsampleFallback(context.upsampledShading, width, height);

      const frameResult = resolveDisocclusionFrame({
        width,
        height,
        readTexel: denoisedSignal.readFilteredTexel,
        readUpsampledRadiance: fallback.read,
        maxResolvedPixels: options.maxResolvedPixels,
        clampRatio: options.clampRatio,
      });

      if (!frameResult.resolved) {
        const mapped = FRAME_REFUSAL_TO_GLUE_REFUSAL[frameResult.refusal] || DISOCCLUSION_REFUSAL.emptyFrame;
        return refuse(mapped, { upsampleFallback: fallback.state });
      }

      const counters = {
        width,
        height,
        pixelCount: frameResult.stats.pixelCount,
        pixelsInsideWindow: frameResult.stats.pixelsInsideWindow,
        disoccludedPixelCount: frameResult.stats.disoccludedPixelCount,
        convergingPixelCount: frameResult.stats.convergingPixelCount,
        convergedPixelCount: frameResult.stats.convergedPixelCount,
        pixelsWithoutHistory: frameResult.stats.pixelsWithoutHistory,
        filledFromUpsampleCount: frameResult.stats.filledFromUpsampleCount,
        filledFromNeighbourhoodCount: frameResult.stats.filledFromNeighbourhoodCount,
        leftBlackPixelCount: frameResult.stats.leftBlackPixelCount,
        spatialTapsAccepted: frameResult.stats.spatialTapsAccepted,
        spatialTapsRejected: frameResult.stats.spatialTapsRejected,
        clampedPixelCount: frameResult.stats.clampedPixelCount,
        clampedPixelRatio: frameResult.stats.clampedPixelRatio,


        residualFireflyPixelRatio: frameResult.stats.residualFireflyPixelRatio,
        meanConfidence: frameResult.stats.meanConfidence,
      };

      publishRefinedSignal(context, frameResult, counters);

      const report = {
        refusal: DISOCCLUSION_REFUSAL.none,
        upsampleFallback: fallback.state,
        counters,
      };
      lastFrameReport = report;
      publishTelemetry(report);
      return report;
    },

    inspect() {
      return {
        owner: DISOCCLUSION_OWNER,
        stageName: DISOCCLUSION_STAGE_NAME,
        publishesContextKey: DISOCCLUSION_SIGNAL_CONTEXT_KEY,
        maxResolvedPixels: options.maxResolvedPixels || null,
      };
    },

    lastFrame() {
      return lastFrameReport;
    },
  };
}
