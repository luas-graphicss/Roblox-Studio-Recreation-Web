import {
  resolveDownsampleMode,
  downsampledResolution,
  pixelsInsideBlock,
} from "./mlDownsampleModeCore.js";
import { sampledPixelForBlock, sampleOffsetForBlock, DOWNSAMPLE_PATTERNS } from "./mlDownsamplePatternCore.js";


export const ML_F12_GATES = Object.freeze({
  maxOrphanPixelCount: 0,
  maxEnergyErrorRatio: 0.03,
  maxTemporalAutocorrelation: 0.2,
});

const FOUR_ROOKS_SIDE = 4;

function positiveInteger(value, fallbackValue) {
  const rounded = Math.floor(Number(value));
  return Number.isFinite(rounded) && rounded > 0 ? rounded : fallbackValue;
}

function zeroOrMore(value) {
  const rounded = Math.floor(Number(value));
  return Number.isFinite(rounded) && rounded > 0 ? rounded : 0;
}

function readSettings(request) {
  const settings = request || {};
  const fullWidth = positiveInteger(settings.fullWidth, 64);
  const fullHeight = positiveInteger(settings.fullHeight, 64);
  const factor = positiveInteger(settings.factor, 1);
  return {
    fullWidth,
    fullHeight,
    factor,
    pattern: settings.pattern || DOWNSAMPLE_PATTERNS.none,
    policy: settings.policy,
    groupPhaseSource: settings.groupPhaseSource,
    grid: downsampledResolution(fullWidth, fullHeight, factor),
  };
}

function eachSampledPixel(settings, frameIndex, visitPixel) {
  let blocksWithoutSample = 0;
  for (let blockY = 0; blockY !== settings.grid.height; blockY += 1) {
    for (let blockX = 0; blockX !== settings.grid.width; blockX += 1) {
      const pixel = sampledPixelForBlock({
        pattern: settings.pattern,
        factor: settings.factor,
        fullWidth: settings.fullWidth,
        fullHeight: settings.fullHeight,
        policy: settings.policy,
        groupPhaseSource: settings.groupPhaseSource,
        blockX,
        blockY,
        frameIndex,
      });
      if (!pixel) {
        blocksWithoutSample += 1;
        continue;
      }
      visitPixel(pixel, blockX, blockY);
    }
  }
  return blocksWithoutSample;
}


export function measureCoverageWindow(request) {
  const settings = readSettings(request);
  const startFrame = zeroOrMore(request && request.startFrame);
  const frameCount = positiveInteger(
    request && request.frameCount,
    settings.factor * settings.factor,
  );

  const sampleCountPerPixel = new Uint32Array(settings.fullWidth * settings.fullHeight);
  let blocksWithoutSample = 0;
  for (let step = 0; step !== frameCount; step += 1) {
    blocksWithoutSample += eachSampledPixel(settings, startFrame + step, (pixel) => {
      sampleCountPerPixel[pixel.y * settings.fullWidth + pixel.x] += 1;
    });
  }

  let orphanPixelCount = 0;
  let duplicateSampleCount = 0;
  let sampledPixelCount = 0;
  for (let index = 0; index !== sampleCountPerPixel.length; index += 1) {
    const timesSampled = sampleCountPerPixel[index];
    if (timesSampled === 0) {
      orphanPixelCount += 1;
      continue;
    }
    sampledPixelCount += 1;
    duplicateSampleCount += timesSampled - 1;
  }

  return Object.freeze({
    startFrame,
    frameCount,
    fullPixelCount: sampleCountPerPixel.length,
    sampledPixelCount,
    orphanPixelCount,
    duplicateSampleCount,
    blocksWithoutSample,
    samplesPerFrame: settings.grid.width * settings.grid.height,
    coversEveryPixel: orphanPixelCount === 0,
  });
}

function buildSampleMask(settings, frameIndex) {
  const mask = new Uint8Array(settings.fullWidth * settings.fullHeight);
  eachSampledPixel(settings, frameIndex, (pixel) => {
    mask[pixel.y * settings.fullWidth + pixel.x] = 1;
  });
  return mask;
}


export function measureTemporalMaskCorrelation(request) {
  const settings = readSettings(request);
  const frameIndex = zeroOrMore(request && request.frameIndex);
  const lag = positiveInteger(request && request.lag, 1);

  const maskA = buildSampleMask(settings, frameIndex);
  const maskB = buildSampleMask(settings, frameIndex + lag);

  const pixelCount = maskA.length;
  let sumA = 0;
  let sumB = 0;
  let sumBoth = 0;
  for (let index = 0; index !== pixelCount; index += 1) {
    sumA += maskA[index];
    sumB += maskB[index];
    if (maskA[index] === 1 && maskB[index] === 1) sumBoth += 1;
  }

  const meanA = sumA / pixelCount;
  const meanB = sumB / pixelCount;
  const varianceA = meanA * (1 - meanA);
  const varianceB = meanB * (1 - meanB);
  const covariance = sumBoth / pixelCount - meanA * meanB;
  const spread = Math.sqrt(varianceA * varianceB);

  return Object.freeze({
    frameIndex,
    lag,
    correlation: spread > 0 ? covariance / spread : 0,
    sampledFractionA: meanA,
    sampledFractionB: meanB,
    sharedFraction: sumBoth / pixelCount,
  });
}


export function measureWorstAutocorrelationInsideWindow(request) {
  const settings = readSettings(request);
  const frameIndex = zeroOrMore(request && request.frameIndex);
  const windowFrames = settings.factor * settings.factor;

  let worst = Object.freeze({ frameIndex, lag: 0, correlation: 0 });
  for (let lag = 1; lag !== windowFrames; lag += 1) {
    const measured = measureTemporalMaskCorrelation({ ...request, frameIndex, lag });
    if (lag === 1 || measured.correlation > worst.correlation) worst = measured;
  }
  return worst;
}


export function measureFourRooksGroup(request) {
  const settings = request || {};
  const startFrame = zeroOrMore(settings.startFrame);
  const rows = new Set();
  const columns = new Set();
  for (let step = 0; step !== FOUR_ROOKS_SIDE; step += 1) {
    const offset = sampleOffsetForBlock({
      pattern: settings.pattern || DOWNSAMPLE_PATTERNS.fourRooks,
      blockX: settings.blockX,
      blockY: settings.blockY,
      frameIndex: startFrame + step,
      policy: settings.policy,
      groupPhaseSource: settings.groupPhaseSource,
    });
    rows.add(offset.offsetY);
    columns.add(offset.offsetX);
  }
  return Object.freeze({
    startFrame,
    distinctRowCount: rows.size,
    distinctColumnCount: columns.size,
    isRooksPattern: rows.size === FOUR_ROOKS_SIDE && columns.size === FOUR_ROOKS_SIDE,
  });
}


export function measureEnergyPreservation(request) {
  const settings = readSettings(request);
  const field = typeof (request && request.field) === "function" ? request.field : () => 1;
  const startFrame = zeroOrMore(request && request.startFrame);
  const frameCount = positiveInteger(
    request && request.frameCount,
    settings.factor * settings.factor,
  );

  let fullResolutionEnergy = 0;
  for (let y = 0; y !== settings.fullHeight; y += 1) {
    for (let x = 0; x !== settings.fullWidth; x += 1) fullResolutionEnergy += field(x, y);
  }

  const energyPerFrame = [];
  for (let step = 0; step !== frameCount; step += 1) {
    let frameEnergy = 0;
    eachSampledPixel(settings, startFrame + step, (pixel, blockX, blockY) => {
      const insideBlock = pixelsInsideBlock(
        blockX,
        blockY,
        settings.factor,
        settings.fullWidth,
        settings.fullHeight,
      );
      frameEnergy += field(pixel.x, pixel.y) * insideBlock.pixelCount;
    });
    energyPerFrame.push(frameEnergy);
  }

  const windowAveragedEnergy =
    energyPerFrame.reduce((total, energy) => total + energy, 0) / Math.max(1, energyPerFrame.length);
  const reference = Math.abs(fullResolutionEnergy) > 0 ? Math.abs(fullResolutionEnergy) : 1;
  const relativeErrorPerFrame = energyPerFrame.map((energy) => Math.abs(energy - fullResolutionEnergy) / reference);

  return Object.freeze({
    frameCount,
    fullResolutionEnergy,
    windowAveragedEnergy,
    windowRelativeError: Math.abs(windowAveragedEnergy - fullResolutionEnergy) / reference,
    worstFrameRelativeError: relativeErrorPerFrame.reduce((worst, error) => Math.max(worst, error), 0),
    relativeErrorPerFrame: Object.freeze(relativeErrorPerFrame),
  });
}


export function measureAcceptanceGates(request) {
  const settings = request || {};
  const mode = resolveDownsampleMode(settings.modeName) || resolveDownsampleMode("full");
  const measurementRequest = {
    fullWidth: settings.fullWidth,
    fullHeight: settings.fullHeight,
    factor: mode.factor,
    pattern: mode.pattern,
    policy: settings.policy,
    groupPhaseSource: settings.groupPhaseSource,
    startFrame: settings.startFrame,
    frameIndex: settings.startFrame,
    field: settings.field,
  };

  const coverage = measureCoverageWindow(measurementRequest);
  const autocorrelation = measureWorstAutocorrelationInsideWindow(measurementRequest);
  const energy = measureEnergyPreservation(measurementRequest);

  const coveragePassed = coverage.orphanPixelCount === ML_F12_GATES.maxOrphanPixelCount;
  const autocorrelationPassed = autocorrelation.correlation <= ML_F12_GATES.maxTemporalAutocorrelation;
  const energyPassed = energy.windowRelativeError <= ML_F12_GATES.maxEnergyErrorRatio;

  return Object.freeze({
    modeName: mode.name,
    factor: mode.factor,
    pattern: mode.pattern,
    coverage,
    autocorrelation,
    energy,
    coveragePassed,
    autocorrelationPassed,
    energyPassed,
    allGatesPassed: coveragePassed && autocorrelationPassed && energyPassed,
  });
}
