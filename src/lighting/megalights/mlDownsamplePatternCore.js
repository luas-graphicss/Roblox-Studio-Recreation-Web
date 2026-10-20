import { fullPixelForBlockOffset, blockForFullPixel } from "./mlDownsampleModeCore.js";

export const DOWNSAMPLE_PATTERNS = Object.freeze({
  none: "none",
  checkerboard: "checkerboard",
  fourRooks: "fourRooks",
});


export const PATTERN_UNIFORM_VALUES = Object.freeze({
  none: 0,
  checkerboard: 1,
  fourRooks: 2,
});

export const TEMPORAL_JITTER_POLICIES = Object.freeze({
  strictSlidingWindow: "strictSlidingWindow",
  jitteredGroups: "jitteredGroups",
});

export const DEFAULT_TEMPORAL_JITTER_POLICY = TEMPORAL_JITTER_POLICIES.strictSlidingWindow;

const FOUR_ROOKS_SIDE = 4;
const GROUP_PHASE_SEED = 0x4d474c31;

function zeroOrMore(value) {
  const rounded = Math.floor(Number(value));
  return Number.isFinite(rounded) && rounded > 0 ? rounded : 0;
}

function positiveInteger(value, fallbackValue) {
  const rounded = Math.floor(Number(value));
  return Number.isFinite(rounded) && rounded > 0 ? rounded : fallbackValue;
}


const CHECKERBOARD_ORDER = Object.freeze([
  Object.freeze({ offsetX: 0, offsetY: 0 }),
  Object.freeze({ offsetX: 1, offsetY: 1 }),
  Object.freeze({ offsetX: 1, offsetY: 0 }),
  Object.freeze({ offsetX: 0, offsetY: 1 }),
]);

const SINGLE_PIXEL_ORDER = Object.freeze([Object.freeze({ offsetX: 0, offsetY: 0 })]);


function buildFourRooksOrder() {
  const order = [];
  for (let index = 0; index !== FOUR_ROOKS_SIDE * FOUR_ROOKS_SIDE; index += 1) {
    const rowInsideBlock = index % FOUR_ROOKS_SIDE;
    const groupIndex = Math.floor(index / FOUR_ROOKS_SIDE);
    order.push(
      Object.freeze({
        offsetX: (rowInsideBlock + groupIndex) % FOUR_ROOKS_SIDE,
        offsetY: rowInsideBlock,
      }),
    );
  }
  return Object.freeze(order);
}

const FOUR_ROOKS_ORDER = buildFourRooksOrder();


export function patternOffsetOrder(pattern) {
  if (pattern === DOWNSAMPLE_PATTERNS.checkerboard) return CHECKERBOARD_ORDER;
  if (pattern === DOWNSAMPLE_PATTERNS.fourRooks) return FOUR_ROOKS_ORDER;
  return SINGLE_PIXEL_ORDER;
}

export function patternUniformValue(pattern) {
  const value = PATTERN_UNIFORM_VALUES[String(pattern)];
  return typeof value === "number" ? value : PATTERN_UNIFORM_VALUES.none;
}


export function integerHash(seedA, seedB) {
  let hashed = Math.imul(zeroOrMore(seedA) + 0x9e3779b9, 0x85ebca6b);
  hashed ^= hashed >>> 13;
  hashed = Math.imul(hashed + zeroOrMore(seedB) + 0xc2b2ae35, 0x27d4eb2f);
  hashed ^= hashed >>> 16;
  return hashed >>> 0;
}


export function blockSpatialPhase(blockX, blockY, offsetCount) {
  const count = positiveInteger(offsetCount, 1);
  if (count === 1) return 0;
  return integerHash(blockX, blockY) % count;
}


export function structuralPhase(pattern, blockX, blockY) {
  const x = zeroOrMore(blockX);
  const y = zeroOrMore(blockY);
  if (pattern === DOWNSAMPLE_PATTERNS.checkerboard) return ((x + y) % 2) * 2;
  if (pattern === DOWNSAMPLE_PATTERNS.fourRooks) return ((x + 3 * y) % FOUR_ROOKS_SIDE) * FOUR_ROOKS_SIDE;
  return 0;
}

function defaultGroupPhase(groupIndex) {
  return integerHash(groupIndex, GROUP_PHASE_SEED);
}


export function temporalRotation(frameIndex, offsetCount, options) {
  const count = positiveInteger(offsetCount, 1);
  if (count === 1) return 0;

  const frame = zeroOrMore(frameIndex);
  const settings = options || {};
  if (settings.policy !== TEMPORAL_JITTER_POLICIES.jitteredGroups) return frame % count;

  const groupPhaseSource =
    typeof settings.groupPhaseSource === "function" ? settings.groupPhaseSource : defaultGroupPhase;
  const groupIndex = Math.floor(frame / count);
  const groupPhase = zeroOrMore(groupPhaseSource(groupIndex)) % count;
  return (frame + groupPhase) % count;
}


export function sampleOffsetForBlock(request) {
  const settings = request || {};
  const pattern = settings.pattern || DOWNSAMPLE_PATTERNS.none;
  const order = patternOffsetOrder(pattern);
  const offsetCount = order.length;

  const offsetIndex =
    (structuralPhase(pattern, settings.blockX, settings.blockY) +
      blockSpatialPhase(settings.blockX, settings.blockY, offsetCount) +
      temporalRotation(settings.frameIndex, offsetCount, settings)) %
    offsetCount;

  const offset = order[offsetIndex];
  return Object.freeze({
    pattern,
    offsetIndex,
    offsetCount,
    offsetX: offset.offsetX,
    offsetY: offset.offsetY,
  });
}


export function sampledPixelForBlock(request) {
  const settings = request || {};
  const offset = sampleOffsetForBlock(settings);
  const pixel = fullPixelForBlockOffset(
    settings.blockX,
    settings.blockY,
    offset.offsetX,
    offset.offsetY,
    settings.factor,
    settings.fullWidth,
    settings.fullHeight,
  );
  if (!pixel) return null;
  return Object.freeze({
    x: pixel.x,
    y: pixel.y,
    offsetIndex: offset.offsetIndex,
    offsetX: pixel.offsetX,
    offsetY: pixel.offsetY,
    wasClamped: pixel.wasClamped,
  });
}


export function isFullPixelSampled(request) {
  const settings = request || {};
  const block = blockForFullPixel(settings.fullX, settings.fullY, settings.factor);
  const sampled = sampledPixelForBlock({
    pattern: settings.pattern,
    factor: settings.factor,
    frameIndex: settings.frameIndex,
    fullWidth: settings.fullWidth,
    fullHeight: settings.fullHeight,
    policy: settings.policy,
    groupPhaseSource: settings.groupPhaseSource,
    blockX: block.blockX,
    blockY: block.blockY,
  });
  if (!sampled) return false;
  return sampled.x === zeroOrMore(settings.fullX) && sampled.y === zeroOrMore(settings.fullY);
}


export function offsetIndexSequenceForBlock(request) {
  const settings = request || {};
  const startFrame = zeroOrMore(settings.startFrame);
  const frameCount = positiveInteger(settings.frameCount, 1);
  const sequence = [];
  for (let step = 0; step !== frameCount; step += 1) {
    sequence.push(
      sampleOffsetForBlock({
        pattern: settings.pattern,
        blockX: settings.blockX,
        blockY: settings.blockY,
        frameIndex: startFrame + step,
        policy: settings.policy,
        groupPhaseSource: settings.groupPhaseSource,
      }).offsetIndex,
    );
  }
  return sequence;
}


export function alignedFourRooksStartFrame(pattern, blockX, blockY) {
  const firstIndex = sampleOffsetForBlock({ pattern, blockX, blockY, frameIndex: 0 }).offsetIndex;
  return (FOUR_ROOKS_SIDE - (firstIndex % FOUR_ROOKS_SIDE)) % FOUR_ROOKS_SIDE;
}
