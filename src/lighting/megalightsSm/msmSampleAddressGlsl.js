import { MSM_BLUE_NOISE_TILE_SIZE } from './msmBlueNoiseDescriptorCore.js';
import { toGlslFloatLiteral } from './msmNormalFromDepthGlsl.js';

export const MSM_SAMPLE_ADDRESS_UNIFORMS = Object.freeze([
  { name: 'uMsmFrameIndex', glslType: 'float' },
  { name: 'uMsmSampleDivisor', glslType: 'float' },
  { name: 'uMsmFullResolution', glslType: 'vec2' },
  { name: 'tMsmBlueNoise', glslType: 'sampler2D' },
  { name: 'uMsmBlueNoiseTexel', glslType: 'vec2' },
]);

export function buildMsmSampleAddressGlsl() {
  return `
vec2 msmRuntimeSampleUv(vec2 reducedUv) {
  float divisor = max(1.0, uMsmSampleDivisor);
  vec2 reducedSize = ceil(uMsmFullResolution / divisor);
  vec2 block = clamp(floor(reducedUv * reducedSize), vec2(0.0), reducedSize - 1.0);
  vec2 phaseUv = (mod(block, vec2(${toGlslFloatLiteral(MSM_BLUE_NOISE_TILE_SIZE)})) + 0.5) * uMsmBlueNoiseTexel;
  float phaseNoise = (texture2D(tMsmBlueNoise, phaseUv).r * 255.0 + 0.5) / 256.0;
  float phase = floor(phaseNoise * divisor * divisor);
  float slot = mod(uMsmFrameIndex + phase, divisor * divisor);
  vec2 offset = vec2(0.0);
  float coordinateBit = divisor * 0.5;
  for (int bit = 0; bit < 8; bit++) {
    if (coordinateBit < 1.0) break;
    float pair = mod(slot, 4.0);
    float y = mod(pair, 2.0);
    float diagonal = floor(pair * 0.5);
    offset += vec2(mod(diagonal + y, 2.0), y) * coordinateBit;
    slot = floor(slot * 0.25);
    coordinateBit *= 0.5;
  }
  vec2 fullPixel = min(block * divisor + offset, uMsmFullResolution - 1.0);
  return (fullPixel + 0.5) / uMsmFullResolution;
}
vec3 msmSamplePositionFromDepth(vec2 reducedUv, float positiveDepth) {
  vec2 sampleUv = msmRuntimeSampleUv(reducedUv);
  return vec3((sampleUv * 2.0 - 1.0) * uMsmInverseProjection * positiveDepth, -positiveDepth);
}
`;
}
