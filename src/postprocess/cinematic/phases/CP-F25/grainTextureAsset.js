import { FILM_GRAIN_MAX_TEXTURE_EDGE, FILM_GRAIN_MAX_STANDARDIZED_PEAK } from "./grainContract.js";
import { hashGrainWord } from "./grainHash.js";

export function prepareGrainTexture(asset) {
  if (!asset || typeof asset !== "object") throw new TypeError("CP-F25 texture asset is required");
  const { width, height, data } = asset;
  for (const dimension of [width, height]) if (!Number.isInteger(dimension) || dimension < 2 || dimension > FILM_GRAIN_MAX_TEXTURE_EDGE) throw new TypeError(`CP-F25 texture dimensions must be 2..${FILM_GRAIN_MAX_TEXTURE_EDGE}`);
  if (asset.encoding !== "linear-grain-mask" || asset.origin !== "bottom-left") throw new TypeError("CP-F25 texture requires linear-grain-mask encoding and bottom-left origin");
  if (!["synthetic", "authored", "reference"].includes(asset.provenance)) throw new TypeError("CP-F25 texture provenance is required");
  if (asset.provenance !== "synthetic" && (typeof asset.license !== "string" || !asset.license.trim())) throw new TypeError("CP-F25 authored/reference textures require an explicit license");
  if ((!Array.isArray(data) && !ArrayBuffer.isView(data)) || data.length !== width * height) throw new TypeError("CP-F25 texture requires one numeric channel per texel");
  let mean = 0;
  for (const sample of data) {
    if (typeof sample !== "number" || !Number.isFinite(sample) || sample < 0 || sample > 1) throw new TypeError("CP-F25 mask samples must be finite in [0, 1]");
    mean += sample / data.length;
  }
  let variance = 0;
  for (const sample of data) variance += (sample - mean) ** 2 / data.length;
  if (variance < 1e-12) throw new RangeError("CP-F25 texture must contain nonconstant grain");
  const standardDeviation = Math.sqrt(variance);
  const samples = Float32Array.from(data, (sample) => (sample - mean) / standardDeviation);
  let peak = 0;
  let fingerprint = 2166136261;
  for (const byte of new Uint8Array(samples.buffer)) fingerprint = Math.imul(fingerprint ^ byte, 16777619);
  for (const sample of samples) peak = Math.max(peak, Math.abs(sample));
  if (peak > FILM_GRAIN_MAX_STANDARDIZED_PEAK) throw new RangeError("CP-F25 texture has excessive standardized outliers");
  return Object.freeze({ width, height, samples, mean, standardDeviation, peak, fingerprint: hashGrainWord(fingerprint).toString(16).padStart(8, "0"), provenance: asset.provenance, license: asset.license ?? "synthetic fixture", bytes: samples.byteLength });
}
