export const SOURCE_TEXTURE_NEUTRAL_TINT = Object.freeze([1, 1, 1]);

export const SOURCE_TEXTURE_REASON = Object.freeze({
  EMPTY: "empty",
  UNKNOWN: "unknown",
  RESOLVED: "resolved",
});

const TEXTURE_SIZE = 4;

function pushColor(pixels, color) {
  pixels.push(color[0], color[1], color[2]);
}

function freezeTexture(id, label, width, height, pixels) {
  return Object.freeze({ id, label, width, height, channels: 3, pixels: Object.freeze(pixels) });
}

function uniformTexture(id, label, color) {
  const pixels = [];
  for (let index = 0; index < TEXTURE_SIZE * TEXTURE_SIZE; index++) pushColor(pixels, color);
  return freezeTexture(id, label, TEXTURE_SIZE, TEXTURE_SIZE, pixels);
}

function columnsTexture(id, label, columnColors) {
  const pixels = [];
  for (let y = 0; y < TEXTURE_SIZE; y++) {
    for (let x = 0; x < columnColors.length; x++) pushColor(pixels, columnColors[x]);
  }
  return freezeTexture(id, label, columnColors.length, TEXTURE_SIZE, pixels);
}

function gradientTexture(id, label, topColor, bottomColor) {
  const pixels = [];
  for (let y = 0; y < TEXTURE_SIZE; y++) {
    const mix = y / (TEXTURE_SIZE - 1);
    const row = [0, 1, 2].map((channel) => Math.round(topColor[channel] + (bottomColor[channel] - topColor[channel]) * mix));
    for (let x = 0; x < TEXTURE_SIZE; x++) pushColor(pixels, row);
  }
  return freezeTexture(id, label, TEXTURE_SIZE, TEXTURE_SIZE, pixels);
}

function gridTexture(id, label, baseColor, lineColor) {
  const pixels = [];
  for (let y = 0; y < TEXTURE_SIZE; y++) {
    for (let x = 0; x < TEXTURE_SIZE; x++) pushColor(pixels, x === 1 || y === 2 ? lineColor : baseColor);
  }
  return freezeTexture(id, label, TEXTURE_SIZE, TEXTURE_SIZE, pixels);
}

export const SOURCE_TEXTURES = Object.freeze({
  "tv-colorbars": columnsTexture("tv-colorbars", "TV com barras de cor", [
    [255, 255, 255],
    [255, 214, 0],
    [214, 32, 32],
    [32, 96, 214],
  ]),
  "window-grid": gridTexture("window-grid", "Janela com caixilho", [255, 255, 255], [26, 26, 26]),
  "softbox-gradient": gradientTexture("softbox-gradient", "Softbox com queda", [255, 255, 255], [96, 96, 96]),
  "gel-warm": uniformTexture("gel-warm", "Gelatina quente", [255, 168, 92]),
  "gel-cool": uniformTexture("gel-cool", "Gelatina fria", [124, 176, 255]),
});

export function listSourceTextureIds() {
  return Object.keys(SOURCE_TEXTURES);
}

export function findSourceTexture(id) {
  if (!id) return null;
  return SOURCE_TEXTURES[String(id)] || null;
}

export function srgbByteToLinear(byte) {
  const value = Math.min(Math.max(Number(byte) || 0, 0), 255) / 255;
  return value <= 0.04045 ? value / 12.92 : Math.pow((value + 0.055) / 1.055, 2.4);
}

export function linearToSrgbByte(linear) {
  const value = Math.min(Math.max(Number(linear) || 0, 0), 1);
  const encoded = value <= 0.0031308 ? value * 12.92 : 1.055 * Math.pow(value, 1 / 2.4) - 0.055;
  return Math.round(encoded * 255);
}

export function relativeLuminance(linearColor) {
  const color = linearColor || SOURCE_TEXTURE_NEUTRAL_TINT;
  return 0.2126 * Number(color[0]) + 0.7152 * Number(color[1]) + 0.0722 * Number(color[2]);
}


export function toLinearLevel(texture) {
  const source = texture || { width: 0, height: 0, pixels: [] };
  const pixels = [];
  for (let index = 0; index < source.pixels.length; index++) pixels.push(srgbByteToLinear(source.pixels[index]));
  return { width: source.width, height: source.height, pixels };
}


export function halveLinearLevel(level) {
  const width = Math.floor(level.width / 2);
  const height = Math.floor(level.height / 2);
  if (width < 1 || height < 1) return null;
  const pixels = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      for (let channel = 0; channel < 3; channel++) {
        const topLeft = ((y * 2) * level.width + x * 2) * 3 + channel;
        const topRight = ((y * 2) * level.width + x * 2 + 1) * 3 + channel;
        const bottomLeft = ((y * 2 + 1) * level.width + x * 2) * 3 + channel;
        const bottomRight = ((y * 2 + 1) * level.width + x * 2 + 1) * 3 + channel;
        pixels.push((level.pixels[topLeft] + level.pixels[topRight] + level.pixels[bottomLeft] + level.pixels[bottomRight]) / 4);
      }
    }
  }
  return { width, height, pixels };
}

export function buildLinearMipChain(texture) {
  const levels = [toLinearLevel(texture)];
  let current = levels[0];
  while (current.width > 1 || current.height > 1) {
    const next = halveLinearLevel(current);
    if (!next) break;
    levels.push(next);
    current = next;
  }
  return levels;
}

export function averageLinearColorOfLevel(level) {
  const pixelCount = Math.max(level.width * level.height, 1);
  const total = [0, 0, 0];
  for (let index = 0; index < pixelCount; index++) {
    for (let channel = 0; channel < 3; channel++) total[channel] += level.pixels[index * 3 + channel];
  }
  return total.map((sum) => sum / pixelCount);
}

export function averageLinearColor(texture) {
  return averageLinearColorOfLevel(toLinearLevel(texture));
}

export function mipAverageColors(texture) {
  return buildLinearMipChain(texture).map(averageLinearColorOfLevel);
}


export function resolveSourceTextureTint(id) {
  const key = id === undefined || id === null ? "" : String(id);
  if (!key) {
    return {
      id: key,
      found: false,
      reason: SOURCE_TEXTURE_REASON.EMPTY,
      linearTint: SOURCE_TEXTURE_NEUTRAL_TINT.slice(),
      luminance: 1,
    };
  }
  const texture = findSourceTexture(key);
  if (!texture) {
    return {
      id: key,
      found: false,
      reason: SOURCE_TEXTURE_REASON.UNKNOWN,
      linearTint: SOURCE_TEXTURE_NEUTRAL_TINT.slice(),
      luminance: 1,
    };
  }
  const linearTint = averageLinearColor(texture);
  return {
    id: key,
    found: true,
    reason: SOURCE_TEXTURE_REASON.RESOLVED,
    label: texture.label,
    width: texture.width,
    height: texture.height,
    linearTint,
    luminance: relativeLuminance(linearTint),
  };
}


export function applySourceTextureTint(linearColor, tint, options) {
  const settings = options || {};
  const color = linearColor || SOURCE_TEXTURE_NEUTRAL_TINT;
  const modulation = tint || SOURCE_TEXTURE_NEUTRAL_TINT;
  const tinted = [0, 1, 2].map((channel) => Number(color[channel]) * Number(modulation[channel]));
  if (!settings.preserveLuminance) return tinted;
  const before = relativeLuminance(color);
  const after = relativeLuminance(tinted);
  if (!(after > 0) || !(before > 0)) return tinted;
  return tinted.map((channel) => (channel * before) / after);
}
