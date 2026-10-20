import { measureLightScreenFootprint } from "./llShadowScreenSizeCore.js";
import { CULL_REVIVE_MARGIN, cullRadiusPixelsForTier } from "./llLightFadeContract.js";

export const SCREEN_CULL_REASON = Object.freeze({
  BEHIND_CAMERA: "behind-camera",
  BELOW_SCREEN_SIZE: "below-screen-size",
});

function asObject(value) {
  return value && typeof value === "object" ? value : {};
}

function finiteOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveOr(value, fallback) {
  return Math.max(finiteOr(value, fallback === undefined ? 0 : fallback), 0);
}


export function measureLightFootprint(input) {
  const request = asObject(input);
  return measureLightScreenFootprint({
    light: request.light,
    view: request.view,
    camera: request.camera,
  });
}




export function screenCullThresholds(input) {
  const request = asObject(input);
  const cullRadiusPixels = positiveOr(
    request.cullRadiusPixels === undefined ? cullRadiusPixelsForTier(request.tier) : request.cullRadiusPixels
  );
  const reviveMargin = Math.max(finiteOr(request.reviveMargin, CULL_REVIVE_MARGIN), 1);
  return Object.freeze({
    cullRadiusPixels,
    reviveRadiusPixels: cullRadiusPixels * reviveMargin,
    reviveMargin,
  });
}


export function screenCullVerdict(input) {
  const request = asObject(input);
  const footprint = asObject(request.footprint);
  const thresholds = screenCullThresholds(request);
  const wasVisible = request.wasVisible !== false;
  const radiusPixels = positiveOr(footprint.radiusPixels);
  const thresholdPixels = wasVisible ? thresholds.cullRadiusPixels : thresholds.reviveRadiusPixels;

  if (footprint.cameraInside === true) {
    return Object.freeze({ culled: false, reason: null, radiusPixels, thresholdPixels, cameraInside: true });
  }
  if (footprint.behindCamera === true) {
    return Object.freeze({
      culled: true,
      reason: SCREEN_CULL_REASON.BEHIND_CAMERA,
      radiusPixels,
      thresholdPixels,
      cameraInside: false,
    });
  }
  const bigEnough = radiusPixels >= thresholdPixels;
  return Object.freeze({
    culled: !bigEnough,
    reason: bigEnough ? null : SCREEN_CULL_REASON.BELOW_SCREEN_SIZE,
    radiusPixels,
    thresholdPixels,
    cameraInside: false,
  });
}
