import { encodeExrFrame } from "./exrEncoder.js";
import { encodePngFrame } from "./pngEncoder.js";
import { encodeFloatFrame } from "./floatFrameEncoder.js";

export function encodeCaptureFrame(input) {
  const encoders = { exr: encodeExrFrame, png: encodePngFrame, float32: encodeFloatFrame };
  const encode = encoders[input.format];
  if (!encode) throw new Error("Unsupported capture encoder");
  const bytes = encode(input);
  return { bytes, extension: input.format === "float32" ? "rgba32f" : input.format, mimeType: input.format === "png" ? "image/png" : input.format === "exr" ? "image/x-exr" : "application/octet-stream", encoder: `CP-F29.${input.format}.v1`, orientation: input.format === "float32" ? "bottom-left" : "top-left" };
}
