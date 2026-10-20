import { validateCaptureColor } from "./captureColor.js";

export function validateExportFrame({ pixels, metadata, format }) {
  if (!metadata || !Number.isSafeInteger(metadata.width) || !Number.isSafeInteger(metadata.height) || metadata.width < 1 || metadata.height < 1 || metadata.width > 65536 || metadata.height > 65536) throw new TypeError("Invalid export dimensions");
  if (!(pixels instanceof Float32Array) || pixels.length !== metadata.width * metadata.height * 4 || pixels.byteLength > 1073741824) throw new Error("Export requires a bounded RGBA Float32 frame");
  if (metadata.origin !== "bottom-left") throw new Error("Export input orientation must be explicit bottom-left");
  const color = validateCaptureColor(metadata.color, format);
  if (color.preExposure !== 1) throw new Error("Pre-exposure must be removed exactly once before encoding");
  if (format === "png" && color.alphaMode === "premultiplied") throw new Error("PNG requires straight or opaque alpha");
  if (!pixels.every(Number.isFinite)) throw new Error("Export cannot contain NaN or Infinity");
  for (let offset = 0; offset < pixels.length; offset += 4) {
    if (pixels[offset + 3] < 0 || pixels[offset + 3] > 1) throw new Error("Export alpha is outside [0, 1]");
    if (format === "png" && [0, 1, 2].some((channel) => pixels[offset + channel] < 0 || pixels[offset + channel] > 1)) throw new Error("PNG output is outside display range; no implicit clipping");
  }
  if (new TextEncoder().encode(JSON.stringify(metadata)).length > 49152) throw new Error("Export metadata exceeds 48 KiB");
  return color;
}
