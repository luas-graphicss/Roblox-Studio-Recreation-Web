import { compareDebugImages, numericSummary } from "./megaLightsDebugCore.js";

export function analyzeDebugPixels(pixels, selectedChannel = 0) {
  if (
    !pixels ||
    pixels.length % 4 !== 0 ||
    !Number.isInteger(selectedChannel) ||
    selectedChannel < 0 ||
    selectedChannel > 3
  )
    throw new RangeError(
      "Expected complete RGBA texels and a channel from 0 to 3",
    );
  const channels = [0, 1, 2, 3].map((channel) =>
    numericSummary(
      Array.from(
        { length: pixels.length / 4 },
        (_, index) => pixels[index * 4 + channel],
      ),
    ),
  );
  let invalidTexels = 0;
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (
      [0, 1, 2, 3].some((channel) => !Number.isFinite(pixels[offset + channel]))
    )
      invalidTexels += 1;
  }
  const range = channels[selectedChannel];
  const histogram = new Array(32).fill(0);
  for (let offset = selectedChannel; offset < pixels.length; offset += 4) {
    const value = pixels[offset];
    if (!Number.isFinite(value)) continue;
    const bin = Math.max(
      0,
      Math.min(
        31,
        Math.floor(
          (31 * (value - range.minimum)) / (range.maximum - range.minimum || 1),
        ),
      ),
    );
    histogram[bin] += 1;
  }
  return {
    ...range,
    selectedChannel,
    selectedChannelInvalidCount: range.invalidCount,
    invalidCount: invalidTexels,
    channelRanges: channels,
    histogram,
  };
}

export function compareDebugCaptures(left, right) {
  const comparison = compareDebugImages(left, right);
  const knownCamera =
    left?.camera?.length === 16 &&
    right?.camera?.length === 16 &&
    left?.projection?.length === 16 &&
    right?.projection?.length === 16;
  return {
    ...comparison,
    cameraUnchanged: knownCamera
      ? JSON.stringify([left.camera, left.projection]) ===
        JSON.stringify([right.camera, right.projection])
      : null,
    frames: [left?.frameIndex ?? null, right?.frameIndex ?? null],
    baselines: [left?.baseline ?? null, right?.baseline ?? null],
    controlWarning:
      "Sequential real draws include temporal noise, postprocessing and existing scene contributions. A difference is not a correctness or parity pass.",
  };
}

export function createDebugDifference(left, right, gain = 4) {
  const comparison = compareDebugCaptures(left, right);
  if (!comparison.comparable) return { available: false, ...comparison };
  const pixels = new Uint8ClampedArray(left.pixels.length);
  for (let offset = 0; offset < pixels.length; offset += 4) {
    const delta = Math.max(
      ...[0, 1, 2].map((channel) =>
        Math.abs(
          left.pixels[offset + channel] - right.pixels[offset + channel],
        ),
      ),
    );
    const value = Math.min(255, Math.round(delta * gain));
    pixels.set(
      [value, Math.round(value * 0.55), Math.round(value * 0.12), 255],
      offset,
    );
  }
  return {
    available: true,
    width: left.width,
    height: left.height,
    pixels,
    comparison,
    gain,
  };
}
