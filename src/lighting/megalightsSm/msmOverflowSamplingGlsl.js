import { MSM_OVERFLOW_MAX_ANCHORS, MSM_OVERFLOW_RANDOM_WORD_COUNT } from './msmOverflowSamplingCore.js';
import { MSM_BLUE_NOISE_TILE_SIZE } from './msmBlueNoiseDescriptorCore.js';
export const MSM_OVERFLOW_UNIFORMS = Object.freeze([
  { name: 'uMsmRecordSlotCount', glslType: 'float' },
  { name: 'uMsmOverflowAnchorCount', glslType: 'float' },
  { name: 'uMsmOverflowAnchors', glslType: 'vec4' },
]);
export function buildMsmOverflowSamplingGlsl() {
  return `
float msmOverflowAnchorAt(int index) {
  if (index == 0) return uMsmOverflowAnchors.x;
  if (index == 1) return uMsmOverflowAnchors.y;
  if (index == 2) return uMsmOverflowAnchors.z;
  return uMsmOverflowAnchors.w;
}
float msmOverflowRemainingCount() { return uMsmRecordSlotCount - uMsmOverflowAnchorCount; }
float msmOverflowRemainingSamples() {
  return min(float(uMsmCandidateCount), uMsmRecordSlotCount) - uMsmOverflowAnchorCount;
}
float msmOverflowPageOffset() {
  vec2 pixel = mod(floor(gl_FragCoord.xy) + vec2(31.0, 47.0), vec2(${MSM_BLUE_NOISE_TILE_SIZE}.0));
  vec2 bytes = floor(texture2D(tMsmBlueNoise, (pixel + 0.5) * uMsmBlueNoiseTexel).rg * 255.0 + 0.5);
  float word = bytes.x * 256.0 + bytes.y;
  float count = max(msmOverflowRemainingCount(), 1.0);
  return mod(floor(word * count / ${MSM_OVERFLOW_RANDOM_WORD_COUNT}.0)
    + uMsmFrameIndex * msmOverflowRemainingSamples(), count);
}
float msmOverflowLightIndexAt(float pageOffset, int candidateSlot) {
  if (float(candidateSlot) >= min(float(uMsmCandidateCount), uMsmRecordSlotCount)) return -1.0;
  if (float(candidateSlot) < uMsmOverflowAnchorCount) return msmOverflowAnchorAt(candidateSlot);
  float index = mod(pageOffset + float(candidateSlot) - uMsmOverflowAnchorCount, max(msmOverflowRemainingCount(), 1.0));
  for (int anchor = 0; anchor < ${MSM_OVERFLOW_MAX_ANCHORS}; anchor++) {
    if (float(anchor) < uMsmOverflowAnchorCount && index >= msmOverflowAnchorAt(anchor)) index += 1.0;
  }
  return index;
}
float msmOverflowInclusionPdf(float lightIndex) {
  float ordinal = lightIndex;
  for (int anchor = 0; anchor < ${MSM_OVERFLOW_MAX_ANCHORS}; anchor++) {
    if (float(anchor) < uMsmOverflowAnchorCount) {
      if (lightIndex == msmOverflowAnchorAt(anchor)) return 1.0;
      if (lightIndex > msmOverflowAnchorAt(anchor)) ordinal -= 1.0;
    }
  }
  float count = max(msmOverflowRemainingCount(), 1.0);
  float end = mod(ordinal - uMsmFrameIndex * msmOverflowRemainingSamples(), count);
  float begin = end - msmOverflowRemainingSamples() + 1.0;
  float words = begin >= 0.0
    ? ceil((end + 1.0) * ${MSM_OVERFLOW_RANDOM_WORD_COUNT}.0 / count) - ceil(begin * ${MSM_OVERFLOW_RANDOM_WORD_COUNT}.0 / count)
    : ${MSM_OVERFLOW_RANDOM_WORD_COUNT}.0 - ceil((begin + count) * ${MSM_OVERFLOW_RANDOM_WORD_COUNT}.0 / count)
      + ceil((end + 1.0) * ${MSM_OVERFLOW_RANDOM_WORD_COUNT}.0 / count);
  return words / ${MSM_OVERFLOW_RANDOM_WORD_COUNT}.0;
}`;
}
