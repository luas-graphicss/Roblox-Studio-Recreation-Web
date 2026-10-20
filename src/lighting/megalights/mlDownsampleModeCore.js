import { MGL_DOWNSAMPLE_MODES, tierDefaults } from "./mlPipelineContract.js";


export const FULL_RESOLUTION_MODE_NAME = "full";

export const DOWNSAMPLE_MODE_NAMES = Object.freeze(Object.keys(MGL_DOWNSAMPLE_MODES));

function positiveInteger(value, fallbackValue) {
  const rounded = Math.floor(Number(value));
  return Number.isFinite(rounded) && rounded > 0 ? rounded : fallbackValue;
}

function zeroOrMore(value) {
  const rounded = Math.floor(Number(value));
  return Number.isFinite(rounded) && rounded > 0 ? rounded : 0;
}


export function resolveDownsampleMode(modeName) {
  const mode = MGL_DOWNSAMPLE_MODES[String(modeName)];
  if (!mode) return null;
  const factor = positiveInteger(mode.factor, 1);
  return Object.freeze({
    name: String(modeName),
    factor,
    pattern: String(mode.pattern),
    blockPixelCount: factor * factor,

    coverageWindowFrames: factor * factor,
  });
}


export function downsampleModeNameForTier(tierName) {
  const defaults = tierDefaults(tierName);
  const modeName = defaults && defaults.downsampleMode;
  return modeName ? String(modeName) : FULL_RESOLUTION_MODE_NAME;
}

export function downsampleModeForTier(tierName) {
  return resolveDownsampleMode(downsampleModeNameForTier(tierName));
}

export function blockPixelCountForFactor(factor) {
  const safeFactor = positiveInteger(factor, 1);
  return safeFactor * safeFactor;
}


export function downsampledResolution(fullWidth, fullHeight, factor) {
  const safeFactor = positiveInteger(factor, 1);
  return Object.freeze({
    width: Math.ceil(zeroOrMore(fullWidth) / safeFactor),
    height: Math.ceil(zeroOrMore(fullHeight) / safeFactor),
    factor: safeFactor,
  });
}


export function sampleBlockCount(fullWidth, fullHeight, factor) {
  const grid = downsampledResolution(fullWidth, fullHeight, factor);
  return grid.width * grid.height;
}


export function blockForFullPixel(fullX, fullY, factor) {
  const safeFactor = positiveInteger(factor, 1);
  const x = zeroOrMore(fullX);
  const y = zeroOrMore(fullY);
  return Object.freeze({
    blockX: Math.floor(x / safeFactor),
    blockY: Math.floor(y / safeFactor),
    offsetX: x % safeFactor,
    offsetY: y % safeFactor,
  });
}


export function pixelsInsideBlock(blockX, blockY, factor, fullWidth, fullHeight) {
  const safeFactor = positiveInteger(factor, 1);
  const firstX = zeroOrMore(blockX) * safeFactor;
  const firstY = zeroOrMore(blockY) * safeFactor;
  const columns = Math.max(0, Math.min(safeFactor, zeroOrMore(fullWidth) - firstX));
  const rows = Math.max(0, Math.min(safeFactor, zeroOrMore(fullHeight) - firstY));
  return Object.freeze({
    firstX,
    firstY,
    columns,
    rows,
    pixelCount: columns * rows,
  });
}


export function fullPixelForBlockOffset(blockX, blockY, offsetX, offsetY, factor, fullWidth, fullHeight) {
  const safeFactor = positiveInteger(factor, 1);
  const insideBlock = pixelsInsideBlock(blockX, blockY, safeFactor, fullWidth, fullHeight);
  if (insideBlock.pixelCount === 0) return null;

  const requestedOffsetX = zeroOrMore(offsetX);
  const requestedOffsetY = zeroOrMore(offsetY);
  const clampedOffsetX = Math.min(requestedOffsetX, insideBlock.columns - 1);
  const clampedOffsetY = Math.min(requestedOffsetY, insideBlock.rows - 1);

  return Object.freeze({
    x: insideBlock.firstX + clampedOffsetX,
    y: insideBlock.firstY + clampedOffsetY,
    offsetX: clampedOffsetX,
    offsetY: clampedOffsetY,
    wasClamped: clampedOffsetX !== requestedOffsetX || clampedOffsetY !== requestedOffsetY,
  });
}


export function downsampleModeRows() {
  return DOWNSAMPLE_MODE_NAMES.map((modeName) => {
    const mode = resolveDownsampleMode(modeName);
    return Object.freeze({
      name: mode.name,
      factor: mode.factor,
      pattern: mode.pattern,
      blockPixelCount: mode.blockPixelCount,
      coverageWindowFrames: mode.coverageWindowFrames,
    });
  });
}
