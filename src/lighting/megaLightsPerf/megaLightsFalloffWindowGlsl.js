const LEGACY_RANGE_REJECT = [
  "      if (r <= 0.0 || d2 >= r*r) continue;",
];

const SQRT_FREE_RANGE_REJECT = [
  "      float rangeSq = r*r;",
  "      if (r <= 0.0 || d2 >= rangeSq) continue;",
];

const LEGACY_FALLOFF_WINDOW = [
  "      float dr = sqrt(d2)/r;",
  "      float win = clamp(1.0-dr*dr*dr*dr,0.0,1.0);",
];

const SQRT_FREE_FALLOFF_WINDOW = [
  "      float normalizedDistanceSq = d2/rangeSq;",
  "      float win = clamp(1.0-normalizedDistanceSq*normalizedDistanceSq,0.0,1.0);",
];


export function buildLightRangeRejectGlsl(options) {
  const sqrtFree = !!(options && options.sqrtFree);
  return (sqrtFree ? SQRT_FREE_RANGE_REJECT : LEGACY_RANGE_REJECT).slice();
}


export function buildFalloffWindowGlsl(options) {
  const sqrtFree = !!(options && options.sqrtFree);
  return (sqrtFree ? SQRT_FREE_FALLOFF_WINDOW : LEGACY_FALLOFF_WINDOW).slice();
}
