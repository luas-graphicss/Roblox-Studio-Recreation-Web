import { requireFinite } from "./diagnosticValidation.js";
import { canonicalJson } from "./canonicalEvidence.js";
import { inspectDiagnosticSnapshot } from "./inspectDiagnosticSnapshot.js";

export function compareSnapshots(reference, candidate, { maxAbsoluteError = 0, allowFrameDifference = false, errors = [], sceneAvailable = true } = {}) {
  requireFinite(maxAbsoluteError, "maxAbsoluteError", 0);
  const reasons = [];
  if (!sceneAvailable) reasons.push("Scene is empty or unavailable");
  if (!Array.isArray(errors)) throw new TypeError("errors must be an array");
  if (errors.length) reasons.push("Renderer or pipeline errors are present");
  if (!reference || !candidate) return { status: "blocked", reasons: [...reasons, "Two captured buffers are required"], metrics: null };
  try { inspectDiagnosticSnapshot(reference); inspectDiagnosticSnapshot(candidate); }
  catch (error) { return { status: "blocked", reasons: [...reasons, error.message], metrics: null, referenceCertified: false }; }
  const left = reference.metadata;
  const right = candidate.metadata;
  if (left.width !== right.width || left.height !== right.height) reasons.push("Capture dimensions do not match; no implicit resampling");
  if (left.domain !== right.domain || left.unit !== right.unit || canonicalJson(left.channels) !== canonicalJson(right.channels)) reasons.push("Metric domains or units do not match");
  if (left.frame.viewId !== right.frame.viewId || left.frame.generation !== right.frame.generation) reasons.push("Captures belong to different views or generations");
  if (!allowFrameDifference && (left.frame.frameId !== right.frame.frameId || left.frame.timeSeconds !== right.frame.timeSeconds)) reasons.push("Frame or clock mismatch; temporal comparison must be explicit");
  if (canonicalJson(left.frame.outputSize) !== canonicalJson(right.frame.outputSize)) reasons.push("Output pixel domains do not match");
  if (left.state.seed !== right.state.seed) reasons.push("Capture seeds do not match");
  if (reasons.length) return { status: "blocked", reasons, metrics: null, referenceCertified: false };
  let maximum = 0;
  let absoluteSum = 0;
  let squaredSum = 0;
  let changedPixels = 0;
  let outOfTolerancePixels = 0;
  const totalPixels = left.width * left.height;
  for (let offset = 0; offset < reference.pixels.length; offset += 4) {
    let pixelMaximum = 0;
    for (const channel of left.channels) {
      const difference = Math.abs(reference.pixels[offset + channel] - candidate.pixels[offset + channel]);
      maximum = Math.max(maximum, difference);
      pixelMaximum = Math.max(pixelMaximum, difference);
      absoluteSum += difference;
      squaredSum += difference * difference;
    }
    if (pixelMaximum > 0) changedPixels += 1;
    if (pixelMaximum > maxAbsoluteError) outOfTolerancePixels += 1;
  }
  const samples = totalPixels * left.channels.length;
  const metrics = { maxAbsoluteError: maximum, meanAbsoluteError: absoluteSum / samples, rootMeanSquaredError: Math.sqrt(squaredSum / samples), changedPixels, outOfTolerancePixels, totalPixels, samples, unit: left.unit, domain: left.domain, threshold: maxAbsoluteError, alphaCompared: left.channels.includes(3), alignment: "none" };
  return { status: outOfTolerancePixels === 0 ? "pass" : "fail", reasons: outOfTolerancePixels ? ["Pixel difference exceeds the declared threshold"] : [], metrics, referenceCertified: false };
}
