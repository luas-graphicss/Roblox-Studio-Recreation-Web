import { encodeSrgbChannel, decodeSrgbChannel } from "../CP-F04/transferFunctions.js";

export { encodeSrgbChannel, decodeSrgbChannel };

function finite(value) {
  if (typeof value !== "number" || !Number.isFinite(value)) throw new TypeError("CP-F28 transfer input must be finite");
  return value;
}

export function encodeRec709Channel(linear) {
  finite(linear);
  return Math.sign(linear) * (Math.abs(linear) < 0.018 ? 4.5 * Math.abs(linear) : 1.099 * Math.abs(linear) ** 0.45 - 0.099);
}

export function encodePqNits(nits) {
  finite(nits);
  if (nits < 0 || nits > 10000) throw new RangeError("ST2084 requires luminance in [0, 10000] nits");
  const normalized = (nits / 10000) ** (2610 / 16384);
  return ((3424 / 4096 + 2413 / 128 * normalized) / (1 + 2392 / 128 * normalized)) ** (2523 / 32);
}

export function decodePqNits(encoded) {
  finite(encoded);
  if (encoded < 0 || encoded > 1) throw new RangeError("ST2084 signal must be in [0, 1]");
  const value = encoded ** (32 / 2523);
  return 10000 * (Math.max(value - 3424 / 4096, 0) / (2413 / 128 - 2392 / 128 * value)) ** (16384 / 2610);
}

export function encodeOutputChannel(value, plan) {
  finite(value);
  if (plan.mode === "scrgb") return value * plan.paperWhiteNits / 80;
  if (plan.transfer === "pq") return encodePqNits(Math.min(10000, Math.max(0, value * plan.paperWhiteNits)));
  if (plan.transfer === "rec709") return encodeRec709Channel(value);
  if (plan.transfer === "srgb") return encodeSrgbChannel(value);
  return value;
}
