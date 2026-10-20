import { grainLatticeSample, hashGrainWord } from "./grainHash.js";

function wrap(value, size) { return ((value % size) + size) % size; }

export function sampleGrainField(pixelX, pixelY, texelSize, sequenceSeed, texture = null) {
  const horizontal = pixelX / texelSize - 0.5;
  const vertical = pixelY / texelSize - 0.5;
  const column = Math.floor(horizontal);
  const row = Math.floor(vertical);
  const horizontalFraction = horizontal - column;
  const verticalFraction = vertical - row;
  const weights = [(1 - horizontalFraction) * (1 - verticalFraction), horizontalFraction * (1 - verticalFraction), (1 - horizontalFraction) * verticalFraction, horizontalFraction * verticalFraction];
  const offsets = [[0, 0], [1, 0], [0, 1], [1, 1]];
  const textureOffsetX = texture ? hashGrainWord(sequenceSeed ^ 0x5bd1e995) % texture.width : 0;
  const textureOffsetY = texture ? hashGrainWord(sequenceSeed ^ 0x27d4eb2d) % texture.height : 0;
  const textureSign = (sequenceSeed & 1) === 0 ? 1 : -1;
  let total = 0;
  for (let index = 0; index < 4; index += 1) {
    const sampleX = column + offsets[index][0];
    const sampleY = row + offsets[index][1];
    const sample = texture ? textureSign * texture.samples[wrap(sampleY + textureOffsetY, texture.height) * texture.width + wrap(sampleX + textureOffsetX, texture.width)] : grainLatticeSample(sampleX, sampleY, sequenceSeed);
    total += weights[index] * sample;
  }
  const normalization = texture ? 1 : Math.sqrt(weights.reduce((sum, weight) => sum + weight * weight, 0));
  return total / normalization;
}
