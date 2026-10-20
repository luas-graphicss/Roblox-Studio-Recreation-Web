import {
  MSM_DEFAULT_RESOLUTION_DIVISOR,
  MSM_RESOLUTION_DIVISORS,
  resolveReducedResolution,
} from "./msmPipelineContract.js";


export const MSM_SAMPLE_PATTERN_PHASE_ID = "MSM-F12";


export const MSM_SAMPLE_OUTSIDE_IMAGE_COORDINATE = -1;


export const MSM_SAMPLE_PATTERN_REFUSALS = Object.freeze({
  divisorNotInContract: "divisorNotInContract",
  divisorIsNotPowerOfTwo: "divisorIsNotPowerOfTwo",
  degenerateFullResolution: "degenerateFullResolution",
  frameIndexNotFinite: "frameIndexNotFinite",
  reducedPixelOutsideGrid: "reducedPixelOutsideGrid",
  fullPixelOutsideImage: "fullPixelOutsideImage",
  sampleOutsideImage: "sampleOutsideImage",
  blockCoordinateNotFinite: "blockCoordinateNotFinite",
  noiseValueOutOfRange: "noiseValueOutOfRange",
  noiseResolverThrew: "noiseResolverThrew",
});


export const MSM_SAMPLE_PATTERN_PHASE_SOURCES = Object.freeze({
  regularGrid: "regularGrid",
  injectedNoise: "injectedNoise",
  refusedNoiseValue: "refusedNoiseValue",
});


export const MSM_SAMPLE_PATTERN_NOISE_CONTRACT = Object.freeze({
  dependencyPhaseId: "MSM-F11",
  resolverName: "resolveNoiseValue",
  resolverArgumentOrder: Object.freeze(["blockX", "blockY"]),
  acceptedRange: Object.freeze({ minimum: 0, maximum: 1 }),
  mustBeConstantPerBlock: true,
  whyItMustBeConstant:
    "the value rotates the WHOLE order of the block; a value that changes between frames re-rotates the block in the middle of the cycle and drops pixels - the coverage proof refuses that instead of letting it pass",
  whyItDoesNotReceiveTheFrame:
    "the resolver never receives the frame index on purpose: a phase that is constant in time closes the coverage in ANY window of consecutive frames, aligned with the cycle or not",
});


export const MSM_SAMPLE_PATTERN_NOT_MIRRORED = Object.freeze({
  shaderChunk:
    "MSM-F12 writes no shader text; the phase that owns the sample pass must read the order table of this core instead of retyping the equation on the GPU side",
  noiseVolume:
    "the noise volume belongs to MSM-F11; this core reads one injected value per block and nothing else",
});

function readInteger(value) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function isPowerOfTwo(value) {
  return typeof value === "number" && value >= 1 && (value & (value - 1)) === 0;
}

function axisBitCountOf(divisor) {
  let bitCount = 0;
  let remaining = divisor;
  while (remaining > 1) {
    remaining >>= 1;
    bitCount += 1;
  }
  return bitCount;
}

function firstRefusalOf(candidates) {
  for (let index = 0; index < candidates.length; index += 1) {
    if (candidates[index]) return candidates[index];
  }
  return null;
}

function positiveModulo(value, modulus) {
  return ((value % modulus) + modulus) % modulus;
}




function orderedDitherSlotOf(subPixelX, subPixelY, axisBitCount) {
  let slotIndex = 0;
  for (let bit = 0; bit < axisBitCount; bit += 1) {
    const diagonalBit = ((subPixelX ^ subPixelY) >> bit) & 1;
    const verticalBit = (subPixelY >> bit) & 1;
    const pairShift = 2 * (axisBitCount - 1 - bit);
    slotIndex |= diagonalBit << (pairShift + 1);
    slotIndex |= verticalBit << pairShift;
  }
  return slotIndex;
}

function buildRotationOrder(divisor) {
  const axisBitCount = axisBitCountOf(divisor);
  const positionBySlot = new Array(divisor * divisor);
  for (let subPixelY = 0; subPixelY < divisor; subPixelY += 1) {
    for (let subPixelX = 0; subPixelX < divisor; subPixelX += 1) {
      const slotIndex = orderedDitherSlotOf(subPixelX, subPixelY, axisBitCount);
      positionBySlot[slotIndex] = Object.freeze({ slotIndex, subPixelX, subPixelY });
    }
  }
  return Object.freeze(positionBySlot);
}


const rotationOrderByDivisor = new Map();
const acceptedCycleByDivisor = new Map();

function rotationOrderOf(divisor) {
  const cached = rotationOrderByDivisor.get(divisor);
  if (cached) return cached;
  const rotationOrder = buildRotationOrder(divisor);
  rotationOrderByDivisor.set(divisor, rotationOrder);
  return rotationOrder;
}

function freezeCycle(request) {
  const divisor = request.divisor;
  const positionsPerBlock = divisor * divisor;
  return Object.freeze({
    requestedDivisor: request.requestedDivisor,
    divisor,
    divisorAccepted: request.divisorAccepted,
    refusal: request.refusal,
    blockWidth: divisor,
    blockHeight: divisor,
    positionsPerBlock,
    coverageCycleFrames: positionsPerBlock,
    pixelFraction: 1 / positionsPerBlock,
    rotationOrder: rotationOrderOf(divisor),
  });
}

function cycleOfAcceptedDivisor(divisor) {
  const cached = acceptedCycleByDivisor.get(divisor);
  if (cached) return cached;
  const cycle = freezeCycle({
    requestedDivisor: divisor,
    divisor,
    divisorAccepted: true,
    refusal: null,
  });
  acceptedCycleByDivisor.set(divisor, cycle);
  return cycle;
}


export function resolveSamplePatternCycle(request) {
  const source = request && typeof request === "object" ? request : {};
  const requestedDivisor = readInteger(source.divisor);
  const listedInContract = requestedDivisor !== null && MSM_RESOLUTION_DIVISORS.indexOf(requestedDivisor) !== -1;
  if (listedInContract && isPowerOfTwo(requestedDivisor)) return cycleOfAcceptedDivisor(requestedDivisor);
  return freezeCycle({
    requestedDivisor,
    divisor: MSM_DEFAULT_RESOLUTION_DIVISOR,
    divisorAccepted: false,
    refusal: listedInContract
      ? MSM_SAMPLE_PATTERN_REFUSALS.divisorIsNotPowerOfTwo
      : MSM_SAMPLE_PATTERN_REFUSALS.divisorNotInContract,
  });
}


let memoizedGridKey = null;
let memoizedGrid = null;


export function resolveSamplePatternGrid(request) {
  const source = request && typeof request === "object" ? request : {};
  const memoKey = String(source.divisor) + "|" + String(source.fullWidth) + "|" + String(source.fullHeight);
  if (memoizedGrid !== null && memoizedGridKey === memoKey) return memoizedGrid;

  const cycle = resolveSamplePatternCycle({ divisor: source.divisor });
  const resolution = resolveReducedResolution({
    width: source.fullWidth,
    height: source.fullHeight,
    divisor: cycle.divisor,
  });
  const isDegenerate = resolution.width < 1 || resolution.height < 1;
  const grid = Object.freeze({
    cycle,
    divisor: cycle.divisor,
    coverageCycleFrames: cycle.coverageCycleFrames,
    fullWidth: resolution.fullWidth,
    fullHeight: resolution.fullHeight,
    fullPixelCount: resolution.fullWidth * resolution.fullHeight,
    reducedWidth: resolution.width,
    reducedHeight: resolution.height,
    reducedPixelCount: resolution.pixelCount,
    hasPartialBlocks: resolution.fullWidth % cycle.divisor !== 0 || resolution.fullHeight % cycle.divisor !== 0,
    refusal: firstRefusalOf([
      isDegenerate ? MSM_SAMPLE_PATTERN_REFUSALS.degenerateFullResolution : null,
      cycle.refusal,
    ]),
  });

  memoizedGridKey = memoKey;
  memoizedGrid = grid;
  return grid;
}


export function slotForSubPixel(request) {
  const source = request && typeof request === "object" ? request : {};
  const cycle = resolveSamplePatternCycle({ divisor: source.divisor });
  const subPixelX = readInteger(source.subPixelX);
  const subPixelY = readInteger(source.subPixelY);
  if (subPixelX === null || subPixelY === null) return null;
  if (subPixelX < 0 || subPixelY < 0 || subPixelX >= cycle.divisor || subPixelY >= cycle.divisor) return null;
  return orderedDitherSlotOf(subPixelX, subPixelY, axisBitCountOf(cycle.divisor));
}

function freezeBlockPhase(request) {
  return Object.freeze({
    blockPhase: request.blockPhase,
    phaseSource: request.phaseSource,
    noiseValue: request.noiseValue,
    refusal: request.refusal,
    divisor: request.cycle.divisor,
    coverageCycleFrames: request.cycle.coverageCycleFrames,
  });
}


export function resolveBlockPhase(request) {
  const source = request && typeof request === "object" ? request : {};
  const cycle = resolveSamplePatternCycle({ divisor: source.divisor });
  const blockX = readInteger(source.blockX);
  const blockY = readInteger(source.blockY);
  const resolveNoiseValue = typeof source.resolveNoiseValue === "function" ? source.resolveNoiseValue : null;

  if (blockX === null || blockY === null) {
    return freezeBlockPhase({
      blockPhase: 0,
      phaseSource: MSM_SAMPLE_PATTERN_PHASE_SOURCES.regularGrid,
      noiseValue: null,
      refusal: MSM_SAMPLE_PATTERN_REFUSALS.blockCoordinateNotFinite,
      cycle,
    });
  }

  if (resolveNoiseValue === null) {
    return freezeBlockPhase({
      blockPhase: 0,
      phaseSource: MSM_SAMPLE_PATTERN_PHASE_SOURCES.regularGrid,
      noiseValue: null,
      refusal: null,
      cycle,
    });
  }

  let noiseValue = Number.NaN;
  try {
    noiseValue = Number(resolveNoiseValue({ blockX, blockY }));
  } catch (thrownByResolver) {
    return freezeBlockPhase({
      blockPhase: 0,
      phaseSource: MSM_SAMPLE_PATTERN_PHASE_SOURCES.refusedNoiseValue,
      noiseValue: null,
      refusal: MSM_SAMPLE_PATTERN_REFUSALS.noiseResolverThrew,
      cycle,
    });
  }

  if (!Number.isFinite(noiseValue) || noiseValue < 0 || noiseValue > 1) {
    return freezeBlockPhase({
      blockPhase: 0,
      phaseSource: MSM_SAMPLE_PATTERN_PHASE_SOURCES.refusedNoiseValue,
      noiseValue: Number.isFinite(noiseValue) ? noiseValue : null,
      refusal: MSM_SAMPLE_PATTERN_REFUSALS.noiseValueOutOfRange,
      cycle,
    });
  }

  return freezeBlockPhase({
    blockPhase: Math.min(cycle.coverageCycleFrames - 1, Math.floor(noiseValue * cycle.coverageCycleFrames)),
    phaseSource: MSM_SAMPLE_PATTERN_PHASE_SOURCES.injectedNoise,
    noiseValue,
    refusal: null,
    cycle,
  });
}

function freezeSample(request) {
  const position = request.position;
  return Object.freeze({
    divisor: request.grid.divisor,
    coverageCycleFrames: request.grid.coverageCycleFrames,
    frameIndex: request.frameIndex,
    frameIndexInCycle: request.frameIndexInCycle,
    slotIndex: position === null ? null : position.slotIndex,
    subPixelX: position === null ? null : position.subPixelX,
    subPixelY: position === null ? null : position.subPixelY,
    blockPhase: request.blockPhase.blockPhase,
    phaseSource: request.blockPhase.phaseSource,
    inside: request.inside,
    fullX: request.inside ? request.fullX : MSM_SAMPLE_OUTSIDE_IMAGE_COORDINATE,
    fullY: request.inside ? request.fullY : MSM_SAMPLE_OUTSIDE_IMAGE_COORDINATE,
    refusal: request.refusal,
  });
}


export function sampledFullPixelForReducedPixel(request) {
  const source = request && typeof request === "object" ? request : {};
  const grid = resolveSamplePatternGrid({
    divisor: source.divisor,
    fullWidth: source.fullWidth,
    fullHeight: source.fullHeight,
  });
  const reducedX = readInteger(source.reducedX);
  const reducedY = readInteger(source.reducedY);
  const frameIndex = readInteger(source.frameIndex);
  const blockPhase = resolveBlockPhase({
    divisor: grid.divisor,
    blockX: reducedX,
    blockY: reducedY,
    resolveNoiseValue: source.resolveNoiseValue,
  });
  const isOutsideGrid =
    reducedX === null ||
    reducedY === null ||
    reducedX < 0 ||
    reducedY < 0 ||
    reducedX >= grid.reducedWidth ||
    reducedY >= grid.reducedHeight;
  const refusalBeforeMapping = firstRefusalOf([
    grid.refusal,
    frameIndex === null ? MSM_SAMPLE_PATTERN_REFUSALS.frameIndexNotFinite : null,
    isOutsideGrid ? MSM_SAMPLE_PATTERN_REFUSALS.reducedPixelOutsideGrid : null,
  ]);

  if (refusalBeforeMapping !== null) {
    return freezeSample({
      grid,
      frameIndex,
      frameIndexInCycle: null,
      position: null,
      blockPhase,
      inside: false,
      fullX: MSM_SAMPLE_OUTSIDE_IMAGE_COORDINATE,
      fullY: MSM_SAMPLE_OUTSIDE_IMAGE_COORDINATE,
      refusal: refusalBeforeMapping,
    });
  }

  const cycleFrames = grid.coverageCycleFrames;
  const frameIndexInCycle = positiveModulo(frameIndex, cycleFrames);
  const slotIndex = positiveModulo(frameIndexInCycle + blockPhase.blockPhase, cycleFrames);
  const position = grid.cycle.rotationOrder[slotIndex];
  const fullX = reducedX * grid.divisor + position.subPixelX;
  const fullY = reducedY * grid.divisor + position.subPixelY;
  const inside = fullX < grid.fullWidth && fullY < grid.fullHeight;

  return freezeSample({
    grid,
    frameIndex,
    frameIndexInCycle,
    position,
    blockPhase,
    inside,
    fullX,
    fullY,
    refusal: inside ? blockPhase.refusal : MSM_SAMPLE_PATTERN_REFUSALS.sampleOutsideImage,
  });
}


export function frameThatSamplesFullPixel(request) {
  const source = request && typeof request === "object" ? request : {};
  const grid = resolveSamplePatternGrid({
    divisor: source.divisor,
    fullWidth: source.fullWidth,
    fullHeight: source.fullHeight,
  });
  const fullX = readInteger(source.fullX);
  const fullY = readInteger(source.fullY);
  const isOutsideImage =
    fullX === null ||
    fullY === null ||
    fullX < 0 ||
    fullY < 0 ||
    fullX >= grid.fullWidth ||
    fullY >= grid.fullHeight;

  if (grid.refusal !== null || isOutsideImage) {
    return Object.freeze({
      divisor: grid.divisor,
      coverageCycleFrames: grid.coverageCycleFrames,
      inside: false,
      reducedX: MSM_SAMPLE_OUTSIDE_IMAGE_COORDINATE,
      reducedY: MSM_SAMPLE_OUTSIDE_IMAGE_COORDINATE,
      subPixelX: null,
      subPixelY: null,
      slotIndex: null,
      frameIndexInCycle: null,
      blockPhase: 0,
      phaseSource: MSM_SAMPLE_PATTERN_PHASE_SOURCES.regularGrid,
      refusal: firstRefusalOf([grid.refusal, MSM_SAMPLE_PATTERN_REFUSALS.fullPixelOutsideImage]),
    });
  }

  const reducedX = Math.floor(fullX / grid.divisor);
  const reducedY = Math.floor(fullY / grid.divisor);
  const subPixelX = fullX - reducedX * grid.divisor;
  const subPixelY = fullY - reducedY * grid.divisor;
  const blockPhase = resolveBlockPhase({
    divisor: grid.divisor,
    blockX: reducedX,
    blockY: reducedY,
    resolveNoiseValue: source.resolveNoiseValue,
  });
  const slotIndex = orderedDitherSlotOf(subPixelX, subPixelY, axisBitCountOf(grid.divisor));

  return Object.freeze({
    divisor: grid.divisor,
    coverageCycleFrames: grid.coverageCycleFrames,
    inside: true,
    reducedX,
    reducedY,
    subPixelX,
    subPixelY,
    slotIndex,
    frameIndexInCycle: positiveModulo(slotIndex - blockPhase.blockPhase, grid.coverageCycleFrames),
    blockPhase: blockPhase.blockPhase,
    phaseSource: blockPhase.phaseSource,
    refusal: blockPhase.refusal,
  });
}


export function describeSamplePattern(request) {
  const grid = resolveSamplePatternGrid(request);
  return {
    phaseId: MSM_SAMPLE_PATTERN_PHASE_ID,
    divisor: grid.divisor,
    divisorAccepted: grid.cycle.divisorAccepted,
    fullResolution: grid.fullWidth + "x" + grid.fullHeight,
    reducedResolution: grid.reducedWidth + "x" + grid.reducedHeight,
    reducedPixelCount: grid.reducedPixelCount,
    pixelFraction: grid.cycle.pixelFraction,
    coverageCycleFrames: grid.coverageCycleFrames,
    hasPartialBlocks: grid.hasPartialBlocks,
    rotationOrder: grid.cycle.rotationOrder.map((entry) => entry.subPixelX + "," + entry.subPixelY),
    refusal: grid.refusal,
  };
}
