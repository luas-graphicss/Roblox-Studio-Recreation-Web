import { finiteNumber } from "./convolutionSettings.js";

export function normalizeHdrKernel(kernel, normalization = "luminance") {
  if (!kernel || !Number.isInteger(kernel.width) || !Number.isInteger(kernel.height) || kernel.width < 1 || kernel.height < 1 || kernel.width > 257 || kernel.height > 257) throw new TypeError("Kernel dimensions must be integers from 1 to 257");
  if (kernel.encoding !== "scene-linear-rec709" || kernel.origin !== "bottom-left") throw new TypeError("Kernel requires scene-linear-rec709 and bottom-left origin");
  if (!kernel.provenance || !["original", "authorized"].includes(kernel.provenance.kind) || !kernel.provenance.author || !kernel.provenance.license || !kernel.provenance.source) throw new TypeError("Kernel requires original or authorized provenance, author, license and source");
  if (!Array.isArray(kernel.data) && !(kernel.data instanceof Float32Array) && !(kernel.data instanceof Float64Array)) throw new TypeError("Kernel data must contain RGB numbers");
  if (kernel.data.length !== kernel.width * kernel.height * 3) throw new TypeError("Kernel RGB length does not match dimensions");
  if (!["luminance", "per-channel", "none"].includes(normalization)) throw new TypeError("Unknown kernel normalization");
  const energy = [0, 0, 0];
  const data = Array.from(kernel.data, (value, index) => {
    finiteNumber(value, "Kernel sample", 0, 65504);
    energy[index % 3] += value;
    return value;
  });
  const luminance = energy[0] * 0.2126 + energy[1] * 0.7152 + energy[2] * 0.0722;
  if (!(luminance > 0)) throw new TypeError("A black kernel has no convolution energy");
  if (normalization === "per-channel" && energy.some((value) => value === 0)) throw new TypeError("Per-channel normalization requires nonzero energy in every channel");
  for (let index = 0; index < data.length; index += 1) data[index] /= normalization === "luminance" ? luminance : normalization === "per-channel" ? energy[index % 3] : 1;
  return Object.freeze({ width: kernel.width, height: kernel.height, data: Object.freeze(data), originalEnergy: Object.freeze(energy), normalization, provenance: Object.freeze({ ...kernel.provenance }) });
}
