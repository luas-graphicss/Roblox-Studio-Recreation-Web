export const MSM_WAKE_CACHE_MISS = null;


export const MSM_WAKE_CACHE_ARGUMENT_ORDER = Object.freeze([
  "technology",
  "megaLightsWanted",
  "tier",
  "flag",
  "weakGpu",
  "hasViewport",
  "viewportWidth",
  "viewportHeight",
]);

let cacheEnabled = true;
let slotIsFilled = false;
let slotAwake = false;
let slotTechnology;
let slotMegaLightsWanted;
let slotTier;
let slotFlag;
let slotWeakGpu;
let slotHasViewport;
let slotViewportWidth;
let slotViewportHeight;

let hitCount = 0;
let missCount = 0;
let storeCount = 0;
let invalidationCount = 0;

function slotHoldsTheseSignals(
  technology,
  megaLightsWanted,
  tier,
  flag,
  weakGpu,
  hasViewport,
  viewportWidth,
  viewportHeight,
) {
  return (
    slotTechnology === technology &&
    slotMegaLightsWanted === megaLightsWanted &&
    slotTier === tier &&
    slotFlag === flag &&
    slotWeakGpu === weakGpu &&
    slotHasViewport === hasViewport &&
    slotViewportWidth === viewportWidth &&
    slotViewportHeight === viewportHeight
  );
}


export function readMsmWakeAnswerCache(
  technology,
  megaLightsWanted,
  tier,
  flag,
  weakGpu,
  hasViewport,
  viewportWidth,
  viewportHeight,
) {
  if (cacheEnabled !== true || slotIsFilled !== true) {
    missCount += 1;
    return MSM_WAKE_CACHE_MISS;
  }
  if (
    !slotHoldsTheseSignals(
      technology,
      megaLightsWanted,
      tier,
      flag,
      weakGpu,
      hasViewport,
      viewportWidth,
      viewportHeight,
    )
  ) {
    missCount += 1;
    return MSM_WAKE_CACHE_MISS;
  }
  hitCount += 1;
  return slotAwake;
}


export function storeMsmWakeAnswer(
  technology,
  megaLightsWanted,
  tier,
  flag,
  weakGpu,
  hasViewport,
  viewportWidth,
  viewportHeight,
  awake,
) {
  const answer = awake === true;
  if (cacheEnabled !== true) return answer;
  slotTechnology = technology;
  slotMegaLightsWanted = megaLightsWanted;
  slotTier = tier;
  slotFlag = flag;
  slotWeakGpu = weakGpu;
  slotHasViewport = hasViewport;
  slotViewportWidth = viewportWidth;
  slotViewportHeight = viewportHeight;
  slotAwake = answer;
  slotIsFilled = true;
  storeCount += 1;
  return answer;
}


export function invalidateMsmWakeAnswerCache() {
  slotIsFilled = false;
  invalidationCount += 1;
  return true;
}


export function setMsmWakeAnswerCacheEnabled(enabled) {
  cacheEnabled = enabled !== false;
  if (cacheEnabled !== true) slotIsFilled = false;
  return cacheEnabled;
}


export function isMsmWakeAnswerCacheEnabled() {
  return cacheEnabled;
}


export function resetMsmWakeAnswerCacheCounters() {
  hitCount = 0;
  missCount = 0;
  storeCount = 0;
  invalidationCount = 0;
  return true;
}


export function readMsmWakeAnswerCacheReport() {
  return Object.freeze({
    enabled: cacheEnabled,
    filled: slotIsFilled,
    awake: slotIsFilled ? slotAwake : null,
    hitCount,
    missCount,
    storeCount,
    invalidationCount,
  });
}
