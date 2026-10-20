export function localExposureHistoryWeight(previous, current, deltaSeconds, halfLifeSeconds) {
  if (!Number.isFinite(deltaSeconds) || deltaSeconds < 0 || deltaSeconds > 1) throw new TypeError("CP-F10 deltaSeconds must be 0..1");
  if (!Number.isFinite(halfLifeSeconds) || halfLifeSeconds < 0 || halfLifeSeconds > 1) throw new TypeError("CP-F10 half life must be 0..1 seconds");
  if (!previous || current.cameraCut || halfLifeSeconds === 0) return 0;
  for (const key of ["width", "height", "generation", "viewId", "qualityTier", "settingsKey", "exposureOffsetStops", "encoding"]) {
    if (previous[key] !== current[key]) return 0;
  }
  if (previous.frameId !== current.frameId - 1) return 0;
  return Math.exp(-Math.LN2 * deltaSeconds / halfLifeSeconds);
}

export function reprojectLocalExposureUv(uv, velocity, jitterPixels, previousJitterPixels, width, height) {
  return [uv[0] - velocity[0] + (previousJitterPixels[0] - jitterPixels[0]) / width, uv[1] - velocity[1] + (previousJitterPixels[1] - jitterPixels[1]) / height];
}
