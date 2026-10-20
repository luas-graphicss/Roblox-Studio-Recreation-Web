export const DEFAULT_MAX_SKIPPED_FRAMES = 60;

const FLOAT_BITS = new Float32Array(1);
const FLOAT_BITS_AS_INT = new Int32Array(FLOAT_BITS.buffer);
const FNV_OFFSET_BASIS = 2166136261 | 0;
const FNV_PRIME = 16777619;

function hashNumber(hash, value) {
  const finite = Number(value);
  FLOAT_BITS[0] = Number.isFinite(finite) ? finite : 0;
  return Math.imul(hash ^ FLOAT_BITS_AS_INT[0], FNV_PRIME);
}


function hashLight(hash, light) {
  if (!light) return hashNumber(hash, 0);
  let next = hashNumber(hash, light.x);
  next = hashNumber(next, light.y);
  next = hashNumber(next, light.z);
  next = hashNumber(next, light.range);
  next = hashNumber(next, light.intensity);
  next = hashNumber(next, light.r);
  next = hashNumber(next, light.g);
  return hashNumber(next, light.b);
}


export function computeMegaLightsUploadFingerprint(input) {
  const source = input || {};
  const lights = Array.isArray(source.lights) ? source.lights : [];
  let hash = hashNumber(FNV_OFFSET_BASIS, lights.length);
  for (let index = 0; index < lights.length; index++) {
    hash = hashLight(hash, lights[index]);
  }
  const viewElements = source.viewElements;
  if (viewElements) {
    for (let element = 0; element < viewElements.length; element++) {
      hash = hashNumber(hash, viewElements[element]);
    }
  }
  hash = hashNumber(hash, source.projM00);
  hash = hashNumber(hash, source.projM11);
  hash = hashNumber(hash, source.near);
  hash = hashNumber(hash, source.far);
  return hash | 0;
}

export function createMegaLightsUploadTracker(options) {
  const requestedWatchdog = Number(options && options.maxSkippedFrames);
  const maxSkippedFrames = Number.isFinite(requestedWatchdog) && requestedWatchdog >= 0
    ? Math.floor(requestedWatchdog)
    : DEFAULT_MAX_SKIPPED_FRAMES;

  let hasFingerprint = false;
  let fingerprint = 0;
  let skippedFrames = 0;
  let rebuildCount = 0;
  let skipCount = 0;

  return {

    shouldRebuild(input) {
      const nextFingerprint = computeMegaLightsUploadFingerprint(input);
      const changed = !hasFingerprint || nextFingerprint !== fingerprint;
      const watchdogDue = skippedFrames >= maxSkippedFrames;
      if (changed || watchdogDue) {
        hasFingerprint = true;
        fingerprint = nextFingerprint;
        skippedFrames = 0;
        rebuildCount++;
        return true;
      }
      skippedFrames++;
      skipCount++;
      return false;
    },

    invalidate() {
      hasFingerprint = false;
      skippedFrames = 0;
    },
    stats() {
      return {
        fingerprint,
        hasFingerprint,
        skippedFrames,
        rebuildCount,
        skipCount,
        maxSkippedFrames,
      };
    },
  };
}
