import { requireLocalExposureNumber } from "./localExposureSettings.js";

export const MINIMUM_LUMINANCE = 2 ** -24;
export const MAXIMUM_HALF_FLOAT = 65504;

export function sceneLogLuminance(red, green, blue, preExposure = 1) {
  for (const channel of [red, green, blue]) requireLocalExposureNumber(channel, "color channel", -MAXIMUM_HALF_FLOAT, MAXIMUM_HALF_FLOAT);
  requireLocalExposureNumber(preExposure, "preExposure", 2 ** -24, 2 ** 24);
  const luminance = 0.2126 * Math.max(0, red) + 0.7152 * Math.max(0, green) + 0.0722 * Math.max(0, blue);
  return Math.log2(Math.max(luminance / preExposure, MINIMUM_LUMINANCE));
}

export function resolveLocalBase(logLuminance, bilateralBase, blurredBase, edgeSpan, settings) {
  const edgeConfidence = Math.max(0, 1 - edgeSpan / settings.edgeThresholdStops);
  const blurWeight = settings.blurredLuminanceBlend * edgeConfidence ** 2;
  const mixedBase = bilateralBase + blurWeight * (blurredBase - bilateralBase);
  return Math.max(logLuminance - settings.detailLimitStops, Math.min(logLuminance + settings.detailLimitStops, mixedBase));
}

export function calculateLocalGainStops(logLuminance, baseLogLuminance, settings) {
  requireLocalExposureNumber(logLuminance, "log luminance");
  requireLocalExposureNumber(baseLogLuminance, "base log luminance");
  if (!settings.enabled || settings.maxGainStops === 0) return 0;
  const pivot = Math.log2(settings.middleGray) + settings.middleGrayBiasStops;
  const relativeBase = baseLogLuminance + settings.exposureOffsetStops - pivot;
  const contrast = relativeBase >= 0 ? settings.highlightContrast : settings.shadowContrast;
  const detail = logLuminance - baseLogLuminance;
  const gain = (contrast - 1) * relativeBase + (settings.detailStrength - 1) * detail;
  return gain === 0 ? 0 : Math.max(-settings.maxGainStops, Math.min(settings.maxGainStops, gain));
}

export function limitGainToHalfFloat(gainStops, maximumAbsoluteChannel) {
  requireLocalExposureNumber(gainStops, "gain stops", -8, 8);
  requireLocalExposureNumber(maximumAbsoluteChannel, "maximum channel", 0, MAXIMUM_HALF_FLOAT);
  const headroomStops = maximumAbsoluteChannel > 0 ? Math.log2(MAXIMUM_HALF_FLOAT / maximumAbsoluteChannel) : 24;
  const representableHeadroom = Math.floor(headroomStops * 256) / 256;
  return Math.min(gainStops, representableHeadroom);
}
