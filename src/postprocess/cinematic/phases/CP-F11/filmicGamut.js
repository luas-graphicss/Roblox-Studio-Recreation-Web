import { AP1_LUMINANCE } from "./filmicColorSpaces.js";

export function luminance(color, weights) {
  return color[0] * weights[0] + color[1] * weights[1] + color[2] * weights[2];
}

export function prepareFilmicGamut(color, settings) {
  const positive = color.map((value) => Math.max(0, value));
  const gray = luminance(positive, AP1_LUMINANCE);
  if (gray <= 0) return [0, 0, 0];
  const chromaDistance = Math.hypot(...positive.map((value) => value / gray - 1));
  const highlightWeight = 1 - 2 ** (-4 * gray * gray);
  const expansion = 1 + 0.25 * settings.expandGamut * highlightWeight * (1 - 2 ** (-chromaDistance * chromaDistance));
  const blueDominance = Math.max(0, (positive[2] - Math.max(positive[0], positive[1])) / Math.max(positive[2], 0.000001));
  const blueDesaturation = 1 - 0.3 * settings.blueCorrection * blueDominance * blueDominance * highlightWeight;
  return positive.map((value) => Math.max(0, gray + (value - gray) * expansion * blueDesaturation * 0.96));
}

export function compressOutputGamut(color, weights, headroom) {
  const gray = Math.max(0, Math.min(headroom, luminance(color, weights)));
  let scale = 1;
  for (const channel of color) {
    const difference = channel - gray;
    if (difference < 0) scale = Math.min(scale, gray / -difference);
    if (difference > 0) scale = Math.min(scale, (headroom - gray) / difference);
  }
  return color.map((value) => Math.max(0, Math.min(headroom, gray + (value - gray) * scale)));
}
