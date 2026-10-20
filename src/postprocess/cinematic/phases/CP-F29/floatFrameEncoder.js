import { validateExportFrame } from "./validateExportFrame.js";

export function encodeFloatFrame(input) {
  validateExportFrame({ ...input, format: "float32" });
  const bytes = new Uint8Array(input.pixels.length * 4);
  const view = new DataView(bytes.buffer);
  input.pixels.forEach((value, index) => view.setFloat32(index * 4, value, true));
  return bytes;
}
