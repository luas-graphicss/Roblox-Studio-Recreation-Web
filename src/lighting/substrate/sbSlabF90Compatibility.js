export function normalizeScalarF90(value) {
  if (Array.isArray(value) && value.length === 3 && value.every(channel => Number.isFinite(channel) && channel === value[0])) return value[0];
  return value;
}
