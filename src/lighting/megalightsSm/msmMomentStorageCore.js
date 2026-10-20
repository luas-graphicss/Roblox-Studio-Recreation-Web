export function encodeMsmMoment(value) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError('Moment must be finite and non-negative');
  return Math.log2(1 + value);
}
export function decodeMsmMoment(value) {
  return Math.max(0, Math.pow(2, value) - 1);
}
export function buildMsmMomentStorageGlsl() {
  return `
vec2 msmEncodeMoments(vec2 moments) { return log2(vec2(1.0) + max(moments, vec2(0.0))); }
vec2 msmDecodeMoments(vec2 stored) { return max(exp2(stored) - vec2(1.0), vec2(0.0)); }
`;
}
