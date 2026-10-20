import { isBloomActive } from "./bloomSettings.js";

export function createBloomPyramidPlan(width, height, settings) {
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1) throw new TypeError("Bloom requires positive integer dimensions");
  if (!isBloomActive(settings)) {
    return Object.freeze({ active: false, levels: Object.freeze([]), estimatedBytes: width * height * 10 + 8, drawCount: 3 });
  }
  const totalWeight = settings.bands.reduce((total, band) => total + band.weight, 0);
  const channelGains = [0, 1, 2].map((channel) => settings.bands.reduce((sum, band) => sum + band.tint[channel] * band.weight / totalWeight, 0));
  const tintNormalization = Math.max(1, ...channelGains);
  let levelWidth = width;
  let levelHeight = height;
  const levels = settings.bands.map((band, index) => {
    levelWidth = Math.max(1, Math.ceil(levelWidth / 2));
    levelHeight = Math.max(1, Math.ceil(levelHeight / 2));
    return Object.freeze({
      index,
      width: levelWidth,
      height: levelHeight,
      scale: band.scale,
      gain: Object.freeze(band.tint.map((channel) => channel * band.weight / totalWeight / tintNormalization))
    });
  });
  const pyramidPixels = levels.reduce((total, level) => total + level.width * level.height, 0);
  return Object.freeze({
    active: true,
    tintNormalization,
    levels: Object.freeze(levels),
    estimatedBytes: pyramidPixels * 32 + width * height * 18,
    drawCount: levels.length * 4 + 3
  });
}
