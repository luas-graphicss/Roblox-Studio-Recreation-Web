import { captureColorSignature, validateCaptureColor } from "./captureColor.js";
import { integer, choice, throwIfAborted } from "./captureValidation.js";

export function createCaptureAccumulator(width, height, sampleCount) {
  integer(width, "accumulator width", 1, 32768);
  integer(height, "accumulator height", 1, 32768);
  integer(sampleCount, "accumulator samples", 1, 4096);
  if (width * height * 32 > 1073741824) throw new RangeError("Accumulator exceeds one GiB");
  const accumulated = new Float64Array(width * height * 4);
  let accepted = 0;
  let firstColor = null;
  let signature = null;
  let busy = false;
  let failed = false;

  function start(pixels, metadata, sampleIndex) {
    if (busy || failed) throw new Error("Capture accumulator is busy or failed");
    if (sampleIndex !== accepted || accepted >= sampleCount) throw new Error("Duplicate or out-of-order capture sample");
    if (!(pixels instanceof Float32Array) || pixels.length !== accumulated.length) throw new Error("Capture sample size or precision mismatch");
    const sourceFormat = metadata?.domain === "display-encoded" ? "png" : "exr";
    const color = validateCaptureColor(metadata, sourceFormat);
    if (sourceFormat === "png" && sampleCount > 1) throw new Error("Display-encoded samples cannot be accumulated; resolve the output transform after linear accumulation");
    if (signature !== null && captureColorSignature(color) !== signature) throw new Error("Color domain changed during accumulation");
    firstColor ??= color;
    signature = captureColorSignature(color);
    busy = true;
    return color;
  }

  function accumulateBlock(pixels, color, startOffset, endOffset) {
    const exposureScale = color.domain === "scene-linear" ? 1 / color.preExposure : 1;
    for (let offset = startOffset; offset < endOffset; offset += 4) {
      if (!Number.isFinite(pixels[offset + 3]) || pixels[offset + 3] < 0 || pixels[offset + 3] > 1) throw new Error("Capture alpha is invalid");
      const alpha = color.alphaMode === "opaque" ? 1 : pixels[offset + 3];
      for (let channel = 0; channel < 3; channel += 1) {
        const value = pixels[offset + channel];
        if (!Number.isFinite(value)) throw new Error("Capture contains non-finite color");
        if (color.domain === "display-encoded" && (value < 0 || value > 1)) throw new Error("Display color out of range; capture never silently clips");
        accumulated[offset + channel] += value * exposureScale * (color.alphaMode === "straight" ? alpha : 1) / sampleCount;
      }
      accumulated[offset + 3] += alpha / sampleCount;
    }
  }

  function prepareResolve(alphaMode) {
    choice(alphaMode, "alpha mode", ["straight", "premultiplied", "opaque"]);
    if (busy || failed || accepted !== sampleCount) throw new Error("Capture has incomplete samples");
    return { pixels: new Float32Array(accumulated.length), color: Object.freeze({ ...firstColor, alphaMode, preExposure: 1, exposureNormalization: firstColor.domain === "scene-linear" ? "per-sample-radiance" : "none" }) };
  }

  function resolveBlock(output, alphaMode, startOffset, endOffset) {
    for (let offset = startOffset; offset < endOffset; offset += 4) {
      const alpha = accumulated[offset + 3];
      for (let channel = 0; channel < 3; channel += 1) {
        output[offset + channel] = alphaMode === "straight" ? (alpha > 0 ? accumulated[offset + channel] / alpha : 0) : accumulated[offset + channel];
        if (!Number.isFinite(output[offset + channel])) throw new RangeError("Accumulated radiance exceeds Float32");
      }
      output[offset + 3] = alphaMode === "opaque" ? 1 : Math.min(1, Math.max(0, alpha));
    }
  }

  return Object.freeze({
    add(pixels, metadata, sampleIndex) {
      const color = start(pixels, metadata, sampleIndex);
      try { accumulateBlock(pixels, color, 0, pixels.length); accepted += 1; }
      catch (error) { failed = true; throw error; }
      finally { busy = false; }
    },
    async addAsync(pixels, metadata, sampleIndex, { signal, yieldControl }) {
      const color = start(pixels, metadata, sampleIndex);
      try {
        for (let offset = 0; offset < pixels.length; offset += 65536) {
          throwIfAborted(signal);
          accumulateBlock(pixels, color, offset, Math.min(offset + 65536, pixels.length));
          await yieldControl();
        }
        accepted += 1;
      } catch (error) { failed = true; throw error; }
      finally { busy = false; }
    },
    resolve(alphaMode) {
      const result = prepareResolve(alphaMode);
      resolveBlock(result.pixels, alphaMode, 0, result.pixels.length);
      return result;
    },
    async resolveAsync(alphaMode, { signal, yieldControl }) {
      const result = prepareResolve(alphaMode);
      for (let offset = 0; offset < result.pixels.length; offset += 65536) {
        throwIfAborted(signal);
        resolveBlock(result.pixels, alphaMode, offset, Math.min(offset + 65536, result.pixels.length));
        await yieldControl();
      }
      return result;
    },
    stats: () => ({ accepted, sampleCount, bytes: accumulated.byteLength, failed, busy })
  });
}
