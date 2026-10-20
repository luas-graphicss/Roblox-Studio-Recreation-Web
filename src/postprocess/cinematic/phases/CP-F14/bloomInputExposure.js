export function readBloomPreExposure(source) {
  const value = source.preExposure === undefined ? 1 : source.preExposure;
  if (!Number.isFinite(value) || value < 2 ** -16 || value > 2 ** 16) throw new RangeError("CP-F14 source pre-exposure must be in [2^-16, 2^16]");
  return value;
}
