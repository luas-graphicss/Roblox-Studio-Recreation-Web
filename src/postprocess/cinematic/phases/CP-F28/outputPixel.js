import { requireFiniteVector } from "../CP-F04/colorMatrix.js";
import { decodeSrgbChannel, encodeOutputChannel } from "./outputTransfer.js";
import { transformOutputLinear } from "./outputColorMath.js";
import { outputDitherOffset } from "./outputDither.js";

export function decodeOutputPixel(pixel, sourceInfo) {
  const input = requireFiniteVector(pixel, 4, "CP-F28 pixel");
  const alpha = sourceInfo.alphaMode === "opaque" ? 1 : input[3];
  if (input[3] < 0 || input[3] > 1) throw new RangeError("CP-F28 alpha must be in [0, 1]");
  let color = input.slice(0, 3);
  if (sourceInfo.alphaMode === "premultiplied") color = alpha > 0 ? color.map((value) => value / alpha) : [0, 0, 0];
  if (sourceInfo.transfer === "srgb") color = color.map(decodeSrgbChannel);
  if (color.some(value => !Number.isFinite(value) || Math.abs(value) > 65504)) throw new RangeError("CP-F28 decoded input exceeds finite half-float representation");
  return [...color, alpha];
}

export function transformOutputPixel(pixel, sourceInfo, plan, transform, { enabled = true, x = 0, y = 0 } = {}) {
  const input = requireFiniteVector(pixel, 4, "CP-F28 pixel");
  if (input[3] < 0 || input[3] > 1) throw new RangeError("CP-F28 alpha must be in [0, 1]");
  if (input.some((value) => Math.abs(value) > 65504)) throw new RangeError("CP-F28 input exceeds finite half-float representation");
  const decoded = decodeOutputPixel(input, sourceInfo);
  if (!enabled || sourceInfo.inheritedOetf) return sourceInfo.alphaMode === "opaque" ? [...input.slice(0, 3), 1] : input;
  let color = transformOutputLinear(decoded.slice(0, 3), transform, plan).map((value) => encodeOutputChannel(value, plan));
  if (plan.dither === "bayer8") color = color.map((value) => value <= 0 || value >= 1 ? Math.max(0, Math.min(1, value)) : Math.max(0, Math.min(1, value + outputDitherOffset(x, y, plan.ditherSeed))));
  if (sourceInfo.alphaMode === "premultiplied") color = color.map((value) => value * decoded[3]);
  if (color.some((value) => !Number.isFinite(value) || Math.abs(value) > 65504)) throw new RangeError("CP-F28 output exceeds finite half-float representation");
  return [...color, decoded[3]];
}
