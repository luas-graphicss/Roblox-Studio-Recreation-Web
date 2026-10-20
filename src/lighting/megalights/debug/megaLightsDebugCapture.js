import { debugHeatColor, debugIdColor } from "./megaLightsDebugCore.js";
import { analyzeDebugPixels } from "./megaLightsDebugImageEvidence.js";

function colorFor(texel, encoding, range, exposure) {
  if (texel.some((value) => !Number.isFinite(value))) return [255, 0, 255];
  const [red, green, blue, alpha] = texel;
  if (encoding === "id") return debugIdColor(red);
  if (encoding === "visibility")
    return red === 0
      ? [61, 218, 166]
      : red === 1
        ? [236, 91, 111]
        : [247, 192, 82];
  if (encoding === "radiance")
    return [red, green, blue].map((value) =>
      Math.round(
        255 *
          Math.pow(
            Math.max(0, value * exposure) / (1 + Math.max(0, value * exposure)),
            1 / 2.2,
          ),
      ),
    );
  if (encoding === "rgb")
    return [red, green, blue].map((value) =>
      Math.round(255 * Math.max(0, Math.min(1, value))),
    );
  if (encoding === "velocity")
    return alpha < 0.5
      ? [28, 35, 46]
      : [
          Math.round(red * 255),
          Math.round(green * 255),
          Math.round(
            Math.min(1, Math.hypot(red - 0.5, green - 0.5) * 12) * 255,
          ),
        ];
  if (encoding === "alpha")
    return [alpha, alpha, alpha].map((value) =>
      Math.round(Math.max(0, Math.min(1, value)) * 255),
    );
  const scalar =
    encoding === "green" ? green : encoding === "blue" ? blue : red;
  return debugHeatColor(
    (scalar - range.minimum) / (range.maximum - range.minimum || 1),
  );
}

export function captureDebugSource({
  source,
  mode,
  textureReader,
  exposure = 1,
  pixel = null,
}) {
  if (!source.available)
    return { available: false, reason: source.reason, origin: source.origin };
  let raw;
  if (source.texture) raw = textureReader.read(source.texture, source, pixel);
  else {
    const width = pixel ? 1 : Math.max(1, Math.min(128, source.width));
    const height = pixel
      ? 1
      : Math.max(
          1,
          Math.min(96, Math.round((width * source.height) / source.width)),
        );
    const pixels = new Float32Array(width * height * 4);
    for (let row = 0; row < height; row += 1) {
      for (let column = 0; column < width; column += 1) {
        const x =
          pixel?.x ??
          Math.min(
            source.width - 1,
            Math.floor(((column + 0.5) / width) * source.width),
          );
        const y =
          pixel?.y ??
          Math.min(
            source.height - 1,
            Math.floor(((row + 0.5) / height) * source.height),
          );
        const values = source.read(x, y);
        for (let channel = 0; channel < 4; channel += 1)
          pixels[(row * width + column) * 4 + channel] =
            values?.[channel] ?? NaN;
      }
    }
    raw = {
      width,
      height,
      pixels,
      sourceWidth: source.width,
      sourceHeight: source.height,
    };
  }
  const channel =
    mode.encoding === "green"
      ? 1
      : mode.encoding === "blue"
        ? 2
        : mode.encoding === "alpha"
          ? 3
          : 0;
  const range = analyzeDebugPixels(raw.pixels, channel);
  const pixels = new Uint8ClampedArray(raw.width * raw.height * 4);
  for (let row = 0; row < raw.height; row += 1) {
    for (let column = 0; column < raw.width; column += 1) {
      const sourceOffset = (row * raw.width + column) * 4;
      const destinationOffset =
        ((raw.height - row - 1) * raw.width + column) * 4;
      const color = colorFor(
        Array.from(raw.pixels.subarray(sourceOffset, sourceOffset + 4)),
        mode.encoding,
        range,
        exposure,
      );
      pixels.set([...color, 255], destinationOffset);
    }
  }
  return {
    available: true,
    ...raw,
    rawPixels: raw.pixels,
    pixels,
    range,
    origin: source.origin,
    backend: source.backend,
    encoding: mode.encoding,
    level: source.level,
    levelCount: source.levelCount,
    producerFrame: source.producerFrame ?? null,
    inputFrame: source.inputFrame ?? null,
    observedFrame: source.observedFrame ?? null,
    legend:
      "Nearest sampled texels, not a full-buffer scan; top = source top; magenta = any non-finite RGBA channel. " +
      ({
        rgb: "RGB is clamped to [0,1].",
        radiance: "RGB is exposure-tonemapped; black = zero radiance.",
        velocity:
          "RG encodes direction around 0.5; blue = magnitude; dark = invalid history.",
        alpha: "Black = 0; white = 1 in alpha.",
        id: "Stable categorical ID colors; dark = negative ID, not ID zero.",
        visibility: "Green = visible; red = occluded; amber = unresolved.",
      }[mode.encoding] ||
        "Blue = local minimum; red = local maximum. A constant buffer is blue, not evidence of missing data."),
  };
}
