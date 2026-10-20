export const MGL_RANDOM_SPECTRUM = Object.freeze({
  blueNoise: "blueNoise",
  stratified: "stratified",
  white: "white",
  hash: "hash",
});


export const ACCEPTED_RANDOM_SPECTRUMS = Object.freeze([
  MGL_RANDOM_SPECTRUM.blueNoise,
  MGL_RANDOM_SPECTRUM.stratified,
]);


export const SAMPLE_DIMENSION = Object.freeze({
  hiddenBudgetRounding: 0,
  lightSelection: 1,
  sourcePointU: 2,
  sourcePointV: 3,
});

export const MINIMUM_UNIT_RANDOM_VALUE = 1e-9;
const RADICAL_INVERSE_BASES = Object.freeze([2, 3, 5, 7]);
const FNV_OFFSET_BASIS = 2166136261;
const FNV_PRIME = 16777619;
const UNSIGNED_32_BIT_SCALE = 4294967296;

function radicalInverse(index, base) {
  let digitScale = 1 / base;
  let inverted = 0;
  let remaining = Math.max(0, Math.floor(index));
  while (remaining > 0) {
    inverted += (remaining % base) * digitScale;
    remaining = Math.floor(remaining / base);
    digitScale /= base;
  }
  return inverted;
}

function hashedRotation(values) {
  let hash = FNV_OFFSET_BASIS;
  for (let index = 0; index < values.length; index += 1) {
    const asInteger = Math.floor(Number(values[index]) || 0) | 0;
    hash = Math.imul(hash ^ asInteger, FNV_PRIME);
  }
  return (hash >>> 0) / UNSIGNED_32_BIT_SCALE;
}

function fractionalPart(value) {
  return value - Math.floor(value);
}

function toOpenUnitRange(value) {
  if (!Number.isFinite(value) || value <= 0) return MINIMUM_UNIT_RANDOM_VALUE;
  if (value >= 1) return 1 - MINIMUM_UNIT_RANDOM_VALUE;
  return value;
}


export function isAcceptedRandomSource(randomSource) {
  if (!randomSource || typeof randomSource.unitRandom !== "function") return false;
  return ACCEPTED_RANDOM_SPECTRUMS.indexOf(randomSource.spectrum) >= 0;
}

export function describeRandomSource(randomSource) {
  if (!randomSource) return { present: false, spectrum: null, accepted: false, pendingBlueNoise: true };
  return {
    present: true,
    spectrum: randomSource.spectrum || null,
    accepted: isAcceptedRandomSource(randomSource),
    pendingBlueNoise: randomSource.spectrum !== MGL_RANDOM_SPECTRUM.blueNoise,
    name: randomSource.name || null,
  };
}


export function createStratifiedRandomSource(options) {
  const settings = options && typeof options === "object" ? options : {};
  const seed = Math.floor(Number(settings.seed) || 0) | 0;
  const name = settings.name || "ML-F11 interim stratified source";

  function unitRandom(context) {
    const request = context || {};
    const dimensionIndex = Math.max(0, Math.floor(Number(request.dimensionIndex) || 0));
    const base = RADICAL_INVERSE_BASES[dimensionIndex % RADICAL_INVERSE_BASES.length];
    const frameIndex = Math.max(0, Math.floor(Number(request.frameIndex) || 0));
    const sequenceValue = radicalInverse(frameIndex + 1, base);
    const rotation = hashedRotation([
      Math.floor(Number(request.pixelX) || 0),
      Math.floor(Number(request.pixelY) || 0),
      Math.floor(Number(request.slotIndex) || 0),
      Math.floor(Number(request.candidateIndex) || 0),
      dimensionIndex,
      seed,
    ]);
    return toOpenUnitRange(fractionalPart(sequenceValue + rotation));
  }

  return {
    name,
    spectrum: MGL_RANDOM_SPECTRUM.stratified,

    pendingBlueNoise: true,
    unitRandom,
    describe() {
      return {
        name,
        spectrum: MGL_RANDOM_SPECTRUM.stratified,
        pendingBlueNoise: true,
        bases: RADICAL_INVERSE_BASES,
        seed,
      };
    },
  };
}
