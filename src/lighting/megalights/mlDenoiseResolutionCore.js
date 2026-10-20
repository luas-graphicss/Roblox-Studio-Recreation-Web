export const DEFAULT_MAX_DENOISE_PIXELS = 65536;
export const DEFAULT_DENOISE_UPSAMPLE_FACTOR = 2;

function positiveIntegerOr(value, fallbackValue) {
  const rounded = Math.floor(Number(value));
  return Number.isFinite(rounded) && rounded > 0 ? rounded : fallbackValue;
}

function zeroOrMoreInteger(value) {
  const rounded = Math.floor(Number(value));
  return Number.isFinite(rounded) && rounded > 0 ? rounded : 0;
}


export function denoiseResolutionFor(request) {
  const settings = request || {};
  const shadedGridWidth = zeroOrMoreInteger(settings.shadedGridWidth);
  const shadedGridHeight = zeroOrMoreInteger(settings.shadedGridHeight);
  const requestedUpsampleFactor = positiveIntegerOr(
    settings.requestedUpsampleFactor,
    DEFAULT_DENOISE_UPSAMPLE_FACTOR,
  );
  const maxDenoisePixels = positiveIntegerOr(settings.maxDenoisePixels, DEFAULT_MAX_DENOISE_PIXELS);

  const requestedPixelCount =
    shadedGridWidth * requestedUpsampleFactor * shadedGridHeight * requestedUpsampleFactor;
  const fitsRequestedFactor = requestedPixelCount <= maxDenoisePixels;
  const upsampleFactor = fitsRequestedFactor ? requestedUpsampleFactor : 1;

  return {
    width: shadedGridWidth * upsampleFactor,
    height: shadedGridHeight * upsampleFactor,
    upsampleFactor,
    requestedUpsampleFactor,
    budgetLimitedTheResolution: !fitsRequestedFactor,
    maxDenoisePixels,
  };
}


function fullPixelOfCellCentre(cellIndex, cellCount, fullSize) {
  const cells = Math.max(1, zeroOrMoreInteger(cellCount) || 1);
  const size = Math.max(1, zeroOrMoreInteger(fullSize) || 1);
  const index = zeroOrMoreInteger(cellIndex);
  const mapped = Math.floor(((index + 0.5) * size) / cells);
  return mapped >= size ? size - 1 : mapped;
}

export function fullPixelColumnOfDenoiseColumn(denoiseColumn, denoiseWidth, fullWidth) {
  return fullPixelOfCellCentre(denoiseColumn, denoiseWidth, fullWidth);
}

export function fullPixelRowOfDenoiseRow(denoiseRow, denoiseHeight, fullHeight) {
  return fullPixelOfCellCentre(denoiseRow, denoiseHeight, fullHeight);
}

export function describeDenoiseResolution() {
  return {
    owner: "ML-F19+ML-F20",
    defaultMaxDenoisePixels: DEFAULT_MAX_DENOISE_PIXELS,
    defaultUpsampleFactor: DEFAULT_DENOISE_UPSAMPLE_FACTOR,
    grantsTheRequestedFactor: "whole or not at all",
    readBy: [
      "mlDenoiseInputsBridge.js, to size its sweep",
      "mlSampleShadingInputsBridge.js, to declare the readback lattice before the sweep exists",
    ],
  };
}
