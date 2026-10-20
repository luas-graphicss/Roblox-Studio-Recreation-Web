import { createCocOptics } from "./cocOptics.js";
import { requireNumber, requirePositiveGpuFloat, requireRecord, resolveCropRectangle } from "./cocValidation.js";

export function resolveCocCamera(cameraState) {
  requireRecord(cameraState, "CP-F03 camera value");
  const { lens, aperture, focus } = cameraState;
  requireRecord(lens, "CP-F03 lens");
  requireRecord(aperture, "CP-F03 aperture");
  requireRecord(focus, "CP-F03 focus");
  if (typeof focus.atInfinity !== "boolean") throw new TypeError("CP-F03 focus.atInfinity must be explicit");
  const focusDiopters = requireNumber(focus.diopters, "focus.diopters", 0);
  if (focus.atInfinity !== (focusDiopters === 0)) throw new Error("CP-F03 focus infinity and diopters disagree");
  if (!focus.atInfinity) {
    requireNumber(focus.distanceMeters, "focus.distanceMeters", Number.MIN_VALUE);
    if (Math.abs(focus.distanceMeters * focusDiopters - 1) > 1e-6) throw new Error("CP-F03 focus distance and diopters disagree");
  }
  const optics = createCocOptics({ focalLengthMm: lens.focalLengthMm, apertureFNumber: aperture.fNumber, focusDiopters });
  const activeWidthMm = requireNumber(lens.activeWidthMm, "lens.activeWidthMm", Number.MIN_VALUE, 100000);
  const activeHeightMm = requireNumber(lens.activeHeightMm, "lens.activeHeightMm", Number.MIN_VALUE, 100000);
  const overscan = requireNumber(lens.overscan, "lens.overscan", 1, 4);
  const squeezeFactor = requireNumber(lens.squeezeFactor, "lens.squeezeFactor", 1, 4);
  const nearMeters = requireNumber(cameraState.nearMeters, "camera.nearMeters", Number.MIN_VALUE);
  const farMeters = requireNumber(cameraState.farMeters, "camera.farMeters", nearMeters);
  requirePositiveGpuFloat(nearMeters, "camera.nearMeters");
  requirePositiveGpuFloat(farMeters, "camera.farMeters");
  if (Math.fround(farMeters) <= Math.fround(nearMeters)) throw new Error("Camera far must exceed near at GPU precision");
  return Object.freeze({ optics, activeWidthMm, activeHeightMm, overscan, squeezeFactor, nearMeters, farMeters, outputCropUv: resolveCropRectangle(lens.outputCropUv), source: cameraState.source ?? "explicit-camera-resource" });
}
