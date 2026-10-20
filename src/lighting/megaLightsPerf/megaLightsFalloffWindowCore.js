export const FALLOFF_WINDOW_EXPONENT = 4;


export function legacyFalloffWindow(distanceSquared, range) {
  if (!(range > 0)) return 0;
  const normalizedDistance = Math.sqrt(distanceSquared) / range;
  const window =
    1 - normalizedDistance * normalizedDistance * normalizedDistance * normalizedDistance;
  return Math.min(Math.max(window, 0), 1);
}


export function sqrtFreeFalloffWindow(distanceSquared, range) {
  if (!(range > 0)) return 0;
  const rangeSquared = range * range;
  const normalizedDistanceSquared = distanceSquared / rangeSquared;
  const window = 1 - normalizedDistanceSquared * normalizedDistanceSquared;
  return Math.min(Math.max(window, 0), 1);
}


export function maxFalloffWindowDeviation(range, sampleCount) {
  const samples = Math.max(2, sampleCount | 0);
  const rangeSquared = range * range;
  let worstDeviation = 0;
  for (let i = samples; i >= 0; i--) {
    const distanceSquared = (rangeSquared * i) / samples;
    const deviation = Math.abs(
      legacyFalloffWindow(distanceSquared, range) - sqrtFreeFalloffWindow(distanceSquared, range)
    );
    if (deviation > worstDeviation) worstDeviation = deviation;
  }
  return worstDeviation;
}
