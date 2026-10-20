import { requireExposureNumber, requireExposureObject } from "./exposureValidation.js";

export function physicalCameraEv100(camera) {
  requireExposureObject(camera, "physical camera");
  const aperture = requireExposureNumber(camera.apertureFNumber, "apertureFNumber", Number.MIN_VALUE);
  const shutter = requireExposureNumber(camera.shutterSeconds, "shutterSeconds", Number.MIN_VALUE);
  const iso = requireExposureNumber(camera.iso, "iso", Number.MIN_VALUE);
  return requireExposureNumber(2 * Math.log2(aperture) - Math.log2(shutter) + Math.log2(100) - Math.log2(iso), "physical camera EV100", -64, 64);
}

export function exposureMultiplierFromEv(ev100, exposureScale = 1) {
  requireExposureNumber(ev100, "effective EV100", -128, 128);
  requireExposureNumber(exposureScale, "exposureScale", 1 / 65536, 65536);
  return requireExposureNumber(exposureScale * 2 ** -ev100, "exposure multiplier", Number.MIN_VALUE);
}

export function exposureEvFromMultiplier(multiplier, exposureScale = 1) {
  requireExposureNumber(multiplier, "exposure multiplier", Number.MIN_VALUE);
  requireExposureNumber(exposureScale, "exposureScale", 1 / 65536, 65536);
  return requireExposureNumber(Math.log2(exposureScale) - Math.log2(multiplier), "effective EV100", -128, 128);
}

export function exposureColorGain(exposureMultiplier, preExposure) {
  requireExposureNumber(exposureMultiplier, "exposure multiplier", Number.MIN_VALUE);
  requireExposureNumber(preExposure, "preExposure", Number.MIN_VALUE);
  return requireExposureNumber(exposureMultiplier / preExposure, "color gain", Number.MIN_VALUE);
}
