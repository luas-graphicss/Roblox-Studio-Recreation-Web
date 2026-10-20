export function getPreExposureScale(previousPreExposure, currentPreExposure) {
  for (const value of [previousPreExposure, currentPreExposure]) {
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new TypeError("Pre-exposure must be finite and positive");
  }
  const scale = currentPreExposure / previousPreExposure;
  if (!Number.isFinite(scale) || scale <= 0 || !Number.isFinite(Math.fround(scale)) || Math.fround(scale) === 0) throw new RangeError("Pre-exposure ratio is not representable by the GPU");
  return scale;
}
