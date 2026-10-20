export function isEvidenceRecord(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function isEvidenceText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

export function isEvidenceCount(value, minimum = 0) {
  return Number.isSafeInteger(value) && value >= minimum;
}

export function isDenseEvidenceArray(value, minimum = 0) {
  if (!Array.isArray(value) || value.length < minimum) return false;
  for (let index = 0; index < value.length; index++) {
    if (!Object.hasOwn(value, index)) return false;
  }
  return true;
}

export function hasEvidenceStamp(value) {
  return (
    isEvidenceRecord(value) &&
    isEvidenceCount(value.frameId) &&
    isEvidenceCount(value.generation) &&
    isEvidenceText(value.viewId)
  );
}

export function matchesEvidenceStamp(resource, execution) {
  return (
    hasEvidenceStamp(resource) &&
    resource.frameId === execution.frameId &&
    resource.viewId === execution.viewId &&
    resource.generation === execution.generation
  );
}

export function hasPixelMeasurement(value) {
  if (!isEvidenceRecord(value)) return false;
  const { width, height, channels, pixelCount, sampleCount } = value;
  return (
    value.finite === true &&
    isEvidenceCount(width, 1) &&
    isEvidenceCount(height, 1) &&
    [1, 2, 4].includes(channels) &&
    isEvidenceCount(pixelCount, 1) &&
    pixelCount === width * height &&
    isEvidenceCount(sampleCount, 1) &&
    sampleCount === pixelCount * channels &&
    isEvidenceText(value.domain) &&
    [value.minimum, value.maximum, value.mean].every(Number.isFinite) &&
    value.minimum <= value.mean &&
    value.mean <= value.maximum &&
    isEvidenceCount(value.nonzeroSamples) &&
    value.nonzeroSamples <= sampleCount &&
    typeof value.fingerprint === "string" &&
    /^[a-f0-9]{8}$/i.test(value.fingerprint) &&
    value.fingerprintAlgorithm === "fnv1a32-debug-only"
  );
}
