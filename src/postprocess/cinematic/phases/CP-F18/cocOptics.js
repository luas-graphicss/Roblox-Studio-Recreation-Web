import { requireNumber } from "./cocValidation.js";

export function createCocOptics({ focalLengthMm, apertureFNumber, focusDiopters }) {
  requireNumber(focalLengthMm, "focalLengthMm", 0.1, 10000);
  requireNumber(apertureFNumber, "apertureFNumber", 0.1, 128);
  requireNumber(focusDiopters, "focusDiopters", 0);
  const focalLengthMeters = focalLengthMm / 1000;
  const denominator = 1 - focalLengthMeters * focusDiopters;
  if (denominator <= 0) throw new RangeError("Focus must lie beyond the lens focal length");
  const radiusScaleMmMeters = focalLengthMm * focalLengthMeters / (2 * apertureFNumber * denominator);
  requireNumber(radiusScaleMmMeters, "CoC optical scale", Number.MIN_VALUE, 1e20);
  return Object.freeze({ focalLengthMm, apertureFNumber, focusDiopters, radiusScaleMmMeters });
}

export function sensorCocRadiusMm(depthMeters, optics) {
  if (depthMeters !== Infinity) requireNumber(depthMeters, "depthMeters", Number.MIN_VALUE);
  const reciprocalDepth = depthMeters === Infinity ? 0 : 1 / depthMeters;
  return requireNumber(optics.radiusScaleMmMeters * (optics.focusDiopters - reciprocalDepth), "sensor CoC radius");
}

export function projectCocRadius(depthMeters, plan) {
  const signedSensorRadius = plan.settings.enabled ? sensorCocRadiusMm(depthMeters, plan.optics) : 0;
  const uncappedOutput = plan.outputPixelsPerSensorMm.map((scale) => signedSensorRadius * scale);
  const largestRadius = Math.max(...uncappedOutput.map(Math.abs));
  const clampScale = largestRadius === 0 ? 1 : Math.min(1, plan.settings.maxRadiusOutputPixels / largestRadius);
  const outputPixels = uncappedOutput.map((radius) => radius * clampScale);
  const renderPixels = outputPixels.map((radius, axis) => radius / plan.outputPerRenderPixel[axis]);
  return Object.freeze({ sensorRadiusMm: signedSensorRadius, outputPixels: Object.freeze(outputPixels), renderPixels: Object.freeze(renderPixels), clamped: clampScale < 1 });
}
