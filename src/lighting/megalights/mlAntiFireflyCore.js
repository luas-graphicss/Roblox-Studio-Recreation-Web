import { luminanceOf } from "./mlTonemappedAccumulationCore.js";

export const ANTI_FIREFLY_DEFAULTS = Object.freeze({

  clampRatio: 4,

  minimumNeighbourCount: 3,

  minimumLuminance: 1e-4,
});

function unclampedResult(radiance, luminance, allowedLuminance) {
  return Object.freeze({
    radiance: Object.freeze({ r: radiance.r, g: radiance.g, b: radiance.b }),
    wasClamped: false,
    luminance,
    allowedLuminance,
    appliedScale: 1,
  });
}


export function clampRadianceToNeighbourhood(request) {
  const settings = request || {};
  const radiance = settings.radiance || { r: 0, g: 0, b: 0 };
  const luminance = luminanceOf(radiance);

  const rawRatio = Number(settings.clampRatio);
  const clampRatio = Number.isFinite(rawRatio) && rawRatio > 0 ? rawRatio : ANTI_FIREFLY_DEFAULTS.clampRatio;
  const neighbourCount = Math.max(0, Math.floor(Number(settings.neighbourCount) || 0));
  const neighbourhoodMeanLuminance = Math.max(0, Number(settings.neighbourhoodMeanLuminance) || 0);

  const hasEnoughEvidence = neighbourCount >= ANTI_FIREFLY_DEFAULTS.minimumNeighbourCount;
  const isBrightEnoughToJudge = luminance > ANTI_FIREFLY_DEFAULTS.minimumLuminance;
  if (!hasEnoughEvidence || !isBrightEnoughToJudge) {
    return unclampedResult(radiance, luminance, luminance);
  }

  const allowedLuminance = Math.max(
    ANTI_FIREFLY_DEFAULTS.minimumLuminance,
    neighbourhoodMeanLuminance * clampRatio,
  );
  if (!(luminance > allowedLuminance)) return unclampedResult(radiance, luminance, allowedLuminance);

  const appliedScale = allowedLuminance / luminance;
  return Object.freeze({
    radiance: Object.freeze({
      r: radiance.r * appliedScale,
      g: radiance.g * appliedScale,
      b: radiance.b * appliedScale,
    }),
    wasClamped: true,
    luminance,
    allowedLuminance,
    appliedScale,
  });
}
