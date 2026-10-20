export function hashGrainWord(word) {
  let value = word >>> 0;
  value = Math.imul(value ^ (value >>> 16), 0x7feb352d);
  value = Math.imul(value ^ (value >>> 15), 0x846ca68b);
  return (value ^ (value >>> 16)) >>> 0;
}

export function hashGrainView(viewId) {
  let hash = 2166136261;
  for (let index = 0; index < viewId.length; index += 1) hash = Math.imul(hash ^ viewId.charCodeAt(index), 16777619);
  return hashGrainWord(hash);
}

export function grainSequenceSeed(seed, viewId, sequenceIndex) {
  return hashGrainWord(seed ^ hashGrainView(viewId) ^ hashGrainWord(sequenceIndex >>> 0));
}

export function grainLatticeSample(column, row, sequenceSeed) {
  const coordinate = (Math.imul(column, 0x9e3779b1) ^ Math.imul(row, 0x85ebca77) ^ sequenceSeed) >>> 0;
  let sum = 0;
  for (const salt of [0x68bc21eb, 0x02e5be93, 0x967a889b]) sum += (((hashGrainWord(coordinate ^ salt) >>> 8) + 0.5) / 16777216) * 2 - 1;
  return sum;
}
