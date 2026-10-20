export const WEAK_IGNITION_PROPS = Object.freeze([
  "FeatureBudget",
  "CsmRodizio",
  "HalfResSunShadows",
  "AmbientOcclusionLite",
]);


export function isExplicit(value) {
  return value === true || value === false;
}


export function weakAutoOn(ctx) {
  const c = ctx && typeof ctx === "object" ? ctx : {};
  return c.weak === true && c.tech === "Future" && c.globalShadows === true;
}


export function resolveIgnitionFlag(value, ctx) {
  if (value === true) return true;
  if (value === false) return false;
  return weakAutoOn(ctx);
}
