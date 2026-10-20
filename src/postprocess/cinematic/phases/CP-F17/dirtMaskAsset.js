import { MAX_MASK_PIXELS } from "./dirtMaskContract.js";

const storage = new WeakMap();

function decodeSrgb(value) {
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

export function createDirtMaskAsset({ id, width, height, data, encoding, origin, provenance, source = null }) {
  if (typeof id !== "string" || !id.trim()) throw new TypeError("Dirt mask requires a nonempty asset id");
  if (!Number.isInteger(width) || !Number.isInteger(height) || width < 1 || height < 1 || width * height > MAX_MASK_PIXELS) throw new RangeError("Dirt mask dimensions exceed the explicit pixel budget");
  if (!["srgb", "linear"].includes(encoding)) throw new TypeError("Dirt mask encoding must explicitly be srgb or linear");
  if (!["top-left", "bottom-left"].includes(origin)) throw new TypeError("Dirt mask origin must be explicit");
  if (!["synthetic", "authored"].includes(provenance)) throw new TypeError("Dirt mask provenance must be synthetic or authored");
  if (!(data instanceof Uint8Array || data instanceof Uint8ClampedArray || data instanceof Float32Array)) throw new TypeError("Dirt mask requires RGBA bytes or Float32Array");
  if (data.length !== width * height * 4) throw new RangeError("Dirt mask RGBA length must match its dimensions");
  const byteEncoded = !(data instanceof Float32Array);
  const pixels = new Float32Array(data.length);
  for (let row = 0; row < height; row += 1) {
    const sourceRow = origin === "top-left" ? height - 1 - row : row;
    for (let column = 0; column < width; column += 1) {
      const inputOffset = (sourceRow * width + column) * 4;
      const outputOffset = (row * width + column) * 4;
      const alpha = data[inputOffset + 3] / (byteEncoded ? 255 : 1);
      if (!Number.isFinite(alpha) || alpha < 0 || alpha > 1) throw new RangeError("Dirt mask alpha must be finite in [0, 1]");
      for (let channel = 0; channel < 3; channel += 1) {
        const value = data[inputOffset + channel] / (byteEncoded ? 255 : 1);
        if (!Number.isFinite(value) || value < 0 || value > 1) throw new RangeError("Dirt mask channels must be finite in [0, 1]");
        pixels[outputOffset + channel] = (encoding === "srgb" ? decodeSrgb(value) : value) * alpha;
      }
      pixels[outputOffset + 3] = alpha;
    }
  }
  const asset = Object.freeze({
    id, width, height, encoding: "linear-premultiplied-rgba", origin: "bottom-left", inputEncoding: encoding,
    provenance, source, cpuBytes: pixels.byteLength,
    isAlive: () => storage.has(asset),
    dispose: () => storage.delete(asset)
  });
  storage.set(asset, pixels);
  return asset;
}

export function assertDirtMaskAsset(asset) {
  if (!asset || !storage.has(asset)) throw new TypeError("CP-F17 requires a live asset created by createDirtMaskAsset or loadDirtMaskImage");
  return asset;
}

export function copyDirtMaskPixels(asset) {
  assertDirtMaskAsset(asset);
  return storage.get(asset).slice();
}
