import { requireFinite, validatePixels } from "./diagnosticValidation.js";

const clamp = (value) => Math.min(1, Math.max(0, value));
const encodeSrgb = (value) => value <= 0.0031308 ? 12.92 * value : 1.055 * value ** (1 / 2.4) - 0.055;

export function diagnosticFalseColor(value) {
  const position = clamp(value) * 4;
  const stops = [[0.035, 0.06, 0.12], [0.05, 0.35, 0.72], [0.05, 0.72, 0.65], [0.96, 0.76, 0.18], [0.92, 0.12, 0.12]];
  const lower = Math.min(3, Math.floor(position));
  const blend = position - lower;
  return stops[lower].map((component, index) => component + (stops[lower + 1][index] - component) * blend);
}

function pixelColor(snapshot, offset, falseColor) {
  const { pixels, metadata } = snapshot;
  const sample = [pixels[offset], pixels[offset + 1], pixels[offset + 2]];
  const range = metadata.range ?? [0, metadata.kind === "depth" ? 20 : metadata.kind === "coc" ? 16 : 1];
  if (falseColor) return diagnosticFalseColor((Math.max(...metadata.channels.filter((channel) => channel !== 3).map((channel) => pixels[offset + channel])) - range[0]) / (range[1] - range[0]));
  if (metadata.kind === "color" || metadata.kind === "bloom") return sample.map((value) => metadata.display === "already-srgb" ? clamp(value) : clamp(encodeSrgb(Math.max(0, value) / (1 + Math.max(0, value)))));
  if (metadata.kind === "normal") return sample.map((value) => value * 0.5 + 0.5);
  if (metadata.kind === "motion") {
    const output = metadata.frame.outputSize;
    return [0.5 + sample[0] * output.width / 16, 0.5 + sample[1] * output.height / 16, clamp(Math.hypot(sample[0] * output.width, sample[1] * output.height) / 16)];
  }
  if (metadata.kind === "coc") return sample[0] < 0 ? [clamp(-sample[0] / Math.max(1, Math.abs(range[0]))), 0.1, 0.15] : [0.08, 0.25, clamp(sample[0] / Math.max(1, range[1]))];
  if (metadata.kind === "rejection") return [clamp(sample[0]), clamp(1 - sample[0]) * 0.75, 0.12];
  if (metadata.kind === "gain") return diagnosticFalseColor((Math.log2(Math.max(0.000001, sample[0])) + 4) / 8);
  return diagnosticFalseColor((sample[0] - range[0]) / (range[1] - range[0]));
}

export function renderDiagnosticImage(candidate, { reference = null, mode = "buffer", wipe = 0.5, differenceScale = 1 } = {}) {
  if (!["buffer", "split", "wipe", "difference", "false-color"].includes(mode)) throw new TypeError("Unknown diagnostic display mode");
  requireFinite(wipe, "wipe", 0, 1);
  requireFinite(differenceScale, "differenceScale", Number.MIN_VALUE);
  const { width, height } = candidate.metadata;
  validatePixels(candidate.pixels, width, height);
  const comparison = ["split", "wipe", "difference"].includes(mode);
  if (comparison && (!reference || reference.metadata.width !== width || reference.metadata.height !== height || reference.metadata.domain !== candidate.metadata.domain)) throw new Error("Display comparison needs compatible captured buffers");
  if (comparison) validatePixels(reference.pixels, width, height);
  const bytes = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const sourceOffset = ((height - 1 - y) * width + x) * 4;
    const outputOffset = (y * width + x) * 4;
    let color;
    if (mode === "difference") {
      const error = Math.max(...candidate.metadata.channels.map((channel) => Math.abs(candidate.pixels[sourceOffset + channel] - reference.pixels[sourceOffset + channel])));
      color = error === 0 ? [0, 0, 0] : diagnosticFalseColor(error * differenceScale);
    } else {
      const useReference = comparison && x < width * (mode === "split" ? 0.5 : wipe);
      color = pixelColor(useReference ? reference : candidate, sourceOffset, mode === "false-color");
    }
    for (let channel = 0; channel < 3; channel += 1) bytes[outputOffset + channel] = clamp(color[channel]) * 255;
    bytes[outputOffset + 3] = 255;
  }
  return { bytes, width, height, colorSpace: "srgb", referenceImage: false, label: candidate.metadata.display === "diagnostic-components-no-gamut-conversion" ? "Component visualization only; no gamut conversion; not a reference image" : mode === "buffer" ? "Diagnostic display; raw capture is unchanged" : `Diagnostic ${mode}; not a reference image` };
}
