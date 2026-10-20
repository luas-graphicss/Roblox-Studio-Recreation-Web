import { isMsmTechnology } from "./msmTechnologyGate.js";
import { isMsmAllowedByExclusion } from "./msmExclusionCore.js";
import { isMsmTier } from "./msmTierPolicy.js";
import { isMsmFlagActiveFor } from "./msmFlagResolver.js";
import { msmTierFitsPixelBudget } from "./msmReducedPixelBudgetCore.js";
import {
  MSM_WAKE_CACHE_MISS,
  readMsmWakeAnswerCache,
  storeMsmWakeAnswer,
} from "./msmWakeAnswerCache.js";


const NO_SIGNALS = Object.freeze({});


export const MSM_WAKE_SIGNAL_ORDER = Object.freeze([
  "technology",
  "megaLightsWanted",
  "tier",
  "flag",
  "weakGpu",
  "viewport",
]);

function readSignals(input) {
  return input && typeof input === "object" ? input : NO_SIGNALS;
}

function readViewport(signals) {
  const viewport = signals.viewport;
  return viewport && typeof viewport === "object" ? viewport : null;
}


export function resolveMsmWakeAnswerWithoutCache(signalsInput) {
  const signals = readSignals(signalsInput);


  if (isMsmTechnology(signals.technology) !== true) return false;

  if (isMsmAllowedByExclusion(signals) !== true) return false;

  if (isMsmTier(signals.tier) !== true) return false;

  if (isMsmFlagActiveFor(signals.flag, signals.weakGpu) !== true) return false;


  const viewport = readViewport(signals);
  if (viewport === null) return true;
  return msmTierFitsPixelBudget({
    tier: signals.tier,
    width: viewport.width,
    height: viewport.height,
  }) === true;
}


export function isMsmAwakeNow(signalsInput) {
  const signals = readSignals(signalsInput);
  const viewport = readViewport(signals);
  const hasViewport = viewport !== null;
  const viewportWidth = hasViewport ? viewport.width : 0;
  const viewportHeight = hasViewport ? viewport.height : 0;

  const remembered = readMsmWakeAnswerCache(
    signals.technology,
    signals.megaLightsWanted,
    signals.tier,
    signals.flag,
    signals.weakGpu,
    hasViewport,
    viewportWidth,
    viewportHeight,
  );
  if (remembered !== MSM_WAKE_CACHE_MISS) return remembered;

  return storeMsmWakeAnswer(
    signals.technology,
    signals.megaLightsWanted,
    signals.tier,
    signals.flag,
    signals.weakGpu,
    hasViewport,
    viewportWidth,
    viewportHeight,
    resolveMsmWakeAnswerWithoutCache(signals),
  );
}
