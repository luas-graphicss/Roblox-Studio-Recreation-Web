import { validatePixels } from "./diagnosticValidation.js";

export function renderHistogramImage(snapshot, height = 160, binWidth = 8) {
  const { metadata, pixels } = snapshot;
  validatePixels(pixels, metadata.width, metadata.height);
  if (metadata.kind !== "histogram" || metadata.height !== 1 || metadata.width > 256 || !Number.isInteger(height) || height < 16 || height > 512 || !Number.isInteger(binWidth) || binWidth < 1 || binWidth > 16) throw new Error("Histogram requires a bounded single-row bin texture");
  const width = metadata.width * binWidth;
  const bytes = new Uint8ClampedArray(width * height * 4);
  let peak = 0;
  for (let index = 0; index < pixels.length; index += 4) {
    if (pixels[index] < 0) throw new Error("Histogram weights must be nonnegative");
    peak = Math.max(peak, pixels[index]);
  }
  for (let y = 0; y < height; y += 1) for (let x = 0; x < width; x += 1) {
    const bin = Math.floor(x / binWidth);
    const inside = peak > 0 && height - y <= pixels[bin * 4] / peak * (height - 8) && x % binWidth !== binWidth - 1;
    const offset = (y * width + x) * 4;
    bytes.set(inside ? [125, 216, 230, 255] : [8, 17, 23, 255], offset);
  }
  return { width, height, bytes, colorSpace: "srgb", referenceImage: false, label: `${metadata.width} bins · ${metadata.unit} · peak ${peak.toPrecision(4)} · normalized chart, not reference pixels` };
}
