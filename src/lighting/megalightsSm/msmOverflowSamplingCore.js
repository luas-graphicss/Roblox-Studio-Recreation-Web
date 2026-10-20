export const MSM_OVERFLOW_MAX_ANCHORS = 4;
export const MSM_OVERFLOW_RANDOM_WORD_COUNT = 65536;
export function planMsmOverflowAnchors(records, candidateLimit, freshIndex = -1) {
  const anchorLimit = Math.min(MSM_OVERFLOW_MAX_ANCHORS, Math.floor(candidateLimit / 2));
  const ranked = [];
  for (let index = 0; index < records.length; index += 1) {
    if (!records[index]) continue;
    const energy = records[index].luminance;
    let insertAt = ranked.findIndex(entry => energy > entry.energy);
    if (insertAt < 0) insertAt = ranked.length;
    if (insertAt < anchorLimit) ranked.splice(insertAt, 0, { index, energy });
    if (ranked.length > anchorLimit) ranked.pop();
  }
  if (freshIndex >= 0 && records[freshIndex] && !ranked.some(entry => entry.index === freshIndex)) {
    if (ranked.length >= anchorLimit) ranked.pop();
    ranked.push({ index: freshIndex, energy: records[freshIndex].luminance });
  }
  return { recordSlotCount: records.length, anchors: ranked.map(entry => entry.index).sort((left, right) => left - right) };
}
const modulo = (value, divisor) => ((value % divisor) + divisor) % divisor;
export function msmOverflowLightIndex({ candidateSlot, candidateLimit, recordSlotCount, anchors, frame, randomWord }) {
  const sampleCount = Math.min(candidateLimit, recordSlotCount);
  if (candidateSlot < 0 || candidateSlot >= sampleCount) return -1;
  if (candidateSlot < anchors.length) return anchors[candidateSlot];
  const remainingCount = recordSlotCount - anchors.length;
  const remainingSamples = sampleCount - anchors.length;
  let index = modulo(Math.floor(randomWord * remainingCount / MSM_OVERFLOW_RANDOM_WORD_COUNT)
    + frame * remainingSamples + candidateSlot - anchors.length, remainingCount);
  for (const anchor of anchors) if (index >= anchor) index += 1;
  return index;
}
export function msmOverflowInclusionProbability({ lightIndex, candidateLimit, recordSlotCount, anchors, frame }) {
  if (anchors.includes(lightIndex)) return 1;
  const remainingCount = recordSlotCount - anchors.length;
  const remainingSamples = Math.min(candidateLimit, recordSlotCount) - anchors.length;
  if (!(remainingSamples > 0) || lightIndex < 0 || lightIndex >= recordSlotCount) return 0;
  const ordinal = lightIndex - anchors.filter(anchor => anchor < lightIndex).length;
  const end = modulo(ordinal - frame * remainingSamples, remainingCount);
  const begin = end - remainingSamples + 1;
  const cumulative = boundary => Math.ceil(boundary * MSM_OVERFLOW_RANDOM_WORD_COUNT / remainingCount);
  const words = begin >= 0 ? cumulative(end + 1) - cumulative(begin)
    : MSM_OVERFLOW_RANDOM_WORD_COUNT - cumulative(begin + remainingCount) + cumulative(end + 1);
  return words / MSM_OVERFLOW_RANDOM_WORD_COUNT;
}
