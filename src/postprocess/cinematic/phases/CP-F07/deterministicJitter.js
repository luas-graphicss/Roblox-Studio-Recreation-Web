import { validateSize } from "../../contracts/frameContract.js";
import { resolveTemporalControls } from "./temporalControls.js";

function radicalInverse(index, base) {
  let value = 0;
  let fraction = 1;
  while (index > 0) {
    fraction /= base;
    value += (index % base) * fraction;
    index = Math.floor(index / base);
  }
  return value;
}

function seedRotation(seed, salt) {
  if (seed === 0) return 0;
  let value = (seed ^ salt) >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return ((value ^ (value >>> 16)) >>> 0) / 0x100000000;
}

export function sampleTemporalJitter(frameIndex, options = {}) {
  if (!Number.isSafeInteger(frameIndex) || frameIndex < 0) throw new TypeError("frameIndex must be a nonnegative safe integer");
  const { seed, sequenceLength } = resolveTemporalControls(options);
  const sampleIndex = (frameIndex % sequenceLength) + 1;
  return Object.freeze([
    (radicalInverse(sampleIndex, 2) + seedRotation(seed, 0xa511e9b3)) % 1 - 0.5,
    (radicalInverse(sampleIndex, 3) + seedRotation(seed, 0x63d83595)) % 1 - 0.5
  ]);
}

export function createJitteredProjection(projection, jitterPixels, size) {
  validateSize(size, "jitter size");
  if (!projection || projection.length !== 16 || !Array.from(projection).every(Number.isFinite)) throw new TypeError("Projection requires 16 finite column-major entries");
  if (!jitterPixels || jitterPixels.length !== 2 || !Array.from(jitterPixels).every(Number.isFinite)) throw new TypeError("Jitter requires two finite pixel offsets");
  const result = Array.from(projection);
  const offsetX = 2 * jitterPixels[0] / size.width;
  const offsetY = 2 * jitterPixels[1] / size.height;
  for (let column = 0; column < 4; column += 1) {
    result[column * 4] += offsetX * projection[column * 4 + 3];
    result[column * 4 + 1] += offsetY * projection[column * 4 + 3];
  }
  return Object.freeze(result);
}
