export const SUN_SHADOW_MIN_HALF = 180;
export const SUN_SHADOW_MAX_HALF = 640;
const WORLD_CAP = 60000;
const MARGIN = 1.04;
const HALF_STEP = 32;

function fin(v, d) {
  return Number.isFinite(v) ? v : d;
}

function boundsValid(b) {
  if (!b || !b.min || !b.max) return false;
  for (let i = 0; i < 3; i++) {
    const mn = b.min[i];
    const mx = b.max[i];
    if (!Number.isFinite(mn) || !Number.isFinite(mx)) return false;
    if (mx < mn) return false;
    if (Math.abs(mn) > WORLD_CAP || Math.abs(mx) > WORLD_CAP) return false;
  }
  return true;
}


export function fitSunShadowWindow({ bounds, focus, mapSize, biasScale, biasCap, texelTarget } = {}) {
  const f = [
    fin(focus && focus[0], 0),
    fin(focus && focus[1], 0),
    fin(focus && focus[2], 0),
  ];
  const px = Math.max(64, Math.min(8192, fin(mapSize, 2048)));
  let center = f;
  let half = SUN_SHADOW_MIN_HALF;
  let follows = true;
  if (boundsValid(bounds)) {
    const cx = (bounds.min[0] + bounds.max[0]) / 2;
    const cy = (bounds.min[1] + bounds.max[1]) / 2;
    const cz = (bounds.min[2] + bounds.max[2]) / 2;
    const hx = (bounds.max[0] - bounds.min[0]) / 2;
    const hy = (bounds.max[1] - bounds.min[1]) / 2;
    const hz = (bounds.max[2] - bounds.min[2]) / 2;
    const need = Math.max(hx, hy, hz) * MARGIN;
    if (need <= SUN_SHADOW_MAX_HALF) {


      center = [cx, cy, cz];
      half = Math.max(SUN_SHADOW_MIN_HALF, Math.ceil(need / HALF_STEP) * HALF_STEP);
      follows = false;
    } else {


      half = SUN_SHADOW_MAX_HALF;
      center = [
        Math.min(Math.max(f[0], bounds.min[0]), bounds.max[0]),
        Math.min(Math.max(f[1], bounds.min[1]), bounds.max[1]),
        Math.min(Math.max(f[2], bounds.min[2]), bounds.max[2]),
      ];
    }
  }


  const tt = fin(texelTarget, 0);
  if (tt > 0 && boundsValid(bounds)) {
    const tightHalf = Math.max(SUN_SHADOW_MIN_HALF, (tt * px) / 2);
    if (tightHalf < half) {
      half = tightHalf;
      follows = true;
      center = [
        Math.min(Math.max(f[0], bounds.min[0]), bounds.max[0]),
        Math.min(Math.max(f[1], bounds.min[1]), bounds.max[1]),
        Math.min(Math.max(f[2], bounds.min[2]), bounds.max[2]),
      ];
    }
  }


  const texel = (half * 2) / px;
  const bs = Math.min(1, Math.max(0.1, fin(biasScale, 0.6)));
  const sharp = bs <= 0.4;


  const cap7raw = fin(biasCap, NaN);
  const cap7 = Number.isFinite(cap7raw) && cap7raw > 0 ? Math.min(2, Math.max(0.02, cap7raw)) : NaN;
  const normalBias = Number.isFinite(cap7)
    ? Math.max(0.02, Math.min(cap7, texel * bs))
    : Math.max(sharp ? 0.02 : 0.05, Math.min(sharp ? 0.6 : 2, texel * bs));
  return { center, half, normalBias, follows };
}
