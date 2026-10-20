import { FILM_GRAIN_AMPLITUDE } from "./grainContract.js";

function smoothstep(minimum, maximum, value) {
  const fraction = Math.min(1, Math.max(0, (value - minimum) / (maximum - minimum)));
  return fraction * fraction * (3 - 2 * fraction);
}

export function grainZoneWeights(relativeLuminance, settings) {
  if (!Number.isFinite(relativeLuminance)) throw new TypeError("CP-F25 luminance must be finite");
  const shadows = 1 - smoothstep(0, settings.shadowsMax, relativeLuminance);
  const highlights = smoothstep(settings.highlightsMin, settings.highlightsMax, relativeLuminance);
  return [shadows, 1 - shadows - highlights, highlights];
}

export function grainTonalIntensity(relativeLuminance, settings) {
  const [shadows, midtones, highlights] = grainZoneWeights(relativeLuminance, settings);
  return settings.intensity * (shadows * settings.shadowsIntensity + midtones * settings.midtonesIntensity + highlights * settings.highlightsIntensity);
}

export function applyGrainSample(color, noise, settings, coefficients = [0.2126, 0.7152, 0.0722]) {
  if (color.length < 3 || ![...color].every(Number.isFinite) || !Number.isFinite(noise)) throw new TypeError("CP-F25 requires finite color and grain samples");
  if (!settings.enabled || settings.intensity === 0) return [...color];
  const luminance = Math.max(0, color[0] * coefficients[0] + color[1] * coefficients[1] + color[2] * coefficients[2]);
  const multiplier = 1 + FILM_GRAIN_AMPLITUDE * grainTonalIntensity(luminance, settings) * noise;
  return color.map((value, index) => index < 3 ? value * multiplier : value);
}
