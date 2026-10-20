export const LUMINANCE_WEIGHTS = Object.freeze({ red: 0.2126, green: 0.7152, blue: 0.0722 });


export const INVERSE_TONEMAP_FLOOR = 1e-4;

function channelOrZero(value) {
  const channel = Number(value);
  return Number.isFinite(channel) ? channel : 0;
}

function radianceFromValue(value) {
  if (Array.isArray(value)) {
    return { r: channelOrZero(value[0]), g: channelOrZero(value[1]), b: channelOrZero(value[2]) };
  }
  const source = value || {};
  return { r: channelOrZero(source.r), g: channelOrZero(source.g), b: channelOrZero(source.b) };
}

export function luminanceOf(radiance) {
  const value = radianceFromValue(radiance);
  return (
    value.r * LUMINANCE_WEIGHTS.red +
    value.g * LUMINANCE_WEIGHTS.green +
    value.b * LUMINANCE_WEIGHTS.blue
  );
}


export function tonemapRadiance(radiance) {
  const value = radianceFromValue(radiance);
  const weight = 1 / (1 + Math.max(0, luminanceOf(value)));
  return Object.freeze({ r: value.r * weight, g: value.g * weight, b: value.b * weight });
}


export function inverseTonemapRadiance(tonemapped) {
  const value = radianceFromValue(tonemapped);
  const weight = 1 / Math.max(INVERSE_TONEMAP_FLOOR, 1 - Math.max(0, luminanceOf(value)));
  return Object.freeze({ r: value.r * weight, g: value.g * weight, b: value.b * weight });
}


export function accumulateInTonemappedSpace(request) {
  const settings = request || {};
  const current = radianceFromValue(settings.current);
  if (!settings.history) return Object.freeze({ r: current.r, g: current.g, b: current.b });

  const rawWeight = Number(settings.historyWeight);
  const historyWeight = Number.isFinite(rawWeight) ? Math.min(1, Math.max(0, rawWeight)) : 0;
  const currentWeight = 1 - historyWeight;

  const tonemappedCurrent = tonemapRadiance(current);
  const tonemappedHistory = tonemapRadiance(settings.history);

  return inverseTonemapRadiance({
    r: tonemappedCurrent.r * currentWeight + tonemappedHistory.r * historyWeight,
    g: tonemappedCurrent.g * currentWeight + tonemappedHistory.g * historyWeight,
    b: tonemappedCurrent.b * currentWeight + tonemappedHistory.b * historyWeight,
  });
}
