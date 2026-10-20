import { MOTION_BLUR_TILE_SIZE } from "./motionBlurContract.js";

export function createMotionBlurPlan(size, settings, shutter) {
  if (
    !Number.isInteger(size.width) ||
    !Number.isInteger(size.height) ||
    size.width < 1 ||
    size.height < 1
  )
    throw new TypeError("CP-F22 requires positive integer output dimensions");
  const tiles = {
    width: Math.ceil(size.width / MOTION_BLUR_TILE_SIZE),
    height: Math.ceil(size.height / MOTION_BLUR_TILE_SIZE),
  };
  const outputBytes = size.width * size.height * 8;
  const intermediateBytes = shutter.active
    ? outputBytes + tiles.width * tiles.height * 16
    : 0;
  const bytes = outputBytes + intermediateBytes;
  if (bytes > settings.maximumBytes)
    throw new RangeError(
      `CP-F22 target budget exceeded: ${bytes} > ${settings.maximumBytes}`,
    );
  return Object.freeze({
    size: Object.freeze({ ...size }),
    tiles: Object.freeze(tiles),
    bytes,
    outputBytes,
    intermediateBytes,
    tileSize: MOTION_BLUR_TILE_SIZE,
    neighborRadius: Math.min(
      17,
      Math.ceil(shutter.maximumSupport / MOTION_BLUR_TILE_SIZE) + 1,
    ),
    sampleCount: settings.sampleCount,
    maximumColorSamples: settings.sampleCount * 8,
    shutter,
    settings,
    memoryAccounting: "declared-target-bytes",
    timingClass: "not-production-timing",
  });
}
