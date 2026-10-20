export const MAX_SCENE_ANTIALIASING_SAMPLES = 4;
export const MAX_SCENE_ANTIALIASING_BYTES = 128 * 1024 * 1024;

export function selectSceneAntialiasingSamples({
  supportedSamples = [],
  width,
  height,
  maxSamples = MAX_SCENE_ANTIALIASING_SAMPLES,
  maxBytes = MAX_SCENE_ANTIALIASING_BYTES,
} = {}) {
  if (!Number.isFinite(width) || !Number.isFinite(height)) return 0;
  if (width < 1 || height < 1 || !Number.isFinite(maxBytes)) return 0;
  const pixelCount = Math.floor(width) * Math.floor(height);
  let selectedSamples = 0;
  for (const samples of supportedSamples) {
    if (!Number.isInteger(samples) || samples < 2 || samples > maxSamples) continue;
    const estimatedBytes = pixelCount * 12 * (samples + 1);
    if (estimatedBytes <= maxBytes && samples > selectedSamples) {
      selectedSamples = samples;
    }
  }
  return selectedSamples;
}
