export function isPlainObject(v) {


  return typeof v === "object" && v !== null && !Array.isArray(v);
}

export function isBoolean(v) {
  return typeof v === "boolean";
}

export function isString(v) {
  return typeof v === "string";
}

export function isFiniteNumber(v) {
  return typeof v === "number" && Number.isFinite(v);
}

export function isOneOf(v, allowed) {

  return Array.isArray(allowed) && allowed.includes(v);
}

let warnedClampBounds = false;
let warnedClampFallback = false;


export function clampNumber(v, min, max, fallback) {
  let lo = typeof min === "number" && !Number.isNaN(min) ? min : -Infinity;
  let hi = typeof max === "number" && !Number.isNaN(max) ? max : Infinity;
  if (lo > hi) {
    if (!warnedClampBounds) {
      warnedClampBounds = true;
      try {
        console.warn("[utils/validate] clampNumber: min > max (", min, ">", max, ") — limites trocados.");
      } catch {

      }
    }
    const t = lo;
    lo = hi;
    hi = t;
  }
  const safeFallback = () => {
    if (isFiniteNumber(fallback)) return fallback;
    if (!warnedClampFallback) {
      warnedClampFallback = true;
      try {
        console.warn("[utils/validate] clampNumber: fallback não-finito/ausente (", fallback, ") — usando limite finito/0; corrija o chamador.");
      } catch {

      }
    }
    if (Number.isFinite(lo)) return lo;
    if (Number.isFinite(hi)) return hi;
    return 0;
  };
  if (!isFiniteNumber(v)) return safeFallback();
  const out = Math.min(hi, Math.max(lo, v));


  return Number.isFinite(out) ? out : safeFallback();
}
