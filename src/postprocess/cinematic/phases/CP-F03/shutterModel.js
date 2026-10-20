import { enumValue, finiteNumber, positiveNumber } from "./cameraValidation.js";

export function secondsFromShutterSpeed(reciprocalSeconds) {
  return finiteNumber(1 / positiveNumber(reciprocalSeconds, "shutterSpeedDenominator"), "convertedShutterSeconds", Number.MIN_VALUE);
}

export function resolveShutter({ shutterMode = "seconds", shutterSeconds, shutterAngleDegrees, captureFrameRate = 24, iso = 100 }, apertureFNumber) {
  enumValue(shutterMode, "shutterMode", ["seconds", "angle"]);
  finiteNumber(captureFrameRate, "captureFrameRate", 0.001, 100000);
  finiteNumber(iso, "iso", 1, 10000000);
  finiteNumber(apertureFNumber, "apertureFNumber", 0.1, 128);
  const seconds = shutterMode === "angle"
    ? finiteNumber(shutterAngleDegrees, "shutterAngleDegrees", 0, 360) / (360 * captureFrameRate)
    : finiteNumber(shutterSeconds, "shutterSeconds", 0, 3600);
  const relativeExposure = seconds * (iso / 100) / (apertureFNumber * apertureFNumber);
  return Object.freeze({
    mode: shutterMode,
    seconds,
    angleDegrees: seconds * captureFrameRate * 360,
    speedDenominator: seconds === 0 || !Number.isFinite(1 / seconds) ? null : 1 / seconds,
    captureFrameRate,
    iso,
    closed: seconds === 0,
    overlapsCaptureFrames: seconds > 1 / captureFrameRate,
    exposureValue100: seconds === 0 ? null : -Math.log2(seconds) - Math.log2(iso / 100) + 2 * Math.log2(apertureFNumber),
    relativeExposure,
    exposureAppliedToColor: false,
    clockSource: "authored-capture-frame-rate-not-render-delta"
  });
}
