export const LIGHT_FADE_PHASE_ID = "LL-F21";


export const LIGHT_FADE_FLAG_ID = "LocalLightFade";
export const LIGHT_FADE_FLAG_DEFAULTS = Object.freeze({ fraco: false, medio: false, forte: false });


export const BASELINE_FREEZE_FLAG_ID = "LlBaseline";


export const MAX_DRAW_DISTANCE_PROP = "MaxDrawDistance";
export const FADE_RANGE_PROP = "FadeRange";

export const LIGHT_FADE_MODE = Object.freeze({


  LEGACY: "legacy",

  FADE: "fade",
});


export const MINIMUM_FADE_BAND_RATIO = 0.1;
export const MINIMUM_FADE_BAND_STUDS = 1;


export const MAX_FADE_STEP_PER_PLAN = 0.08;


export const SHADOW_FADE_OUT_THRESHOLD = 0.3;
export const SHADOW_FADE_IN_THRESHOLD = 0.45;


export const PLANS_BEFORE_HIDING_FADED_LIGHT = 12;


export const CULL_RADIUS_PIXELS_BY_TIER = Object.freeze({ fraco: 12, medio: 6, forte: 3 });
export const CULL_REVIVE_MARGIN = 1.35;


export const ACTIVE_LIGHT_BUDGET_BY_TIER = Object.freeze({ fraco: 8, medio: 32, forte: 96 });


export const SHADOW_LIGHT_BUDGET_BY_TIER = Object.freeze({ fraco: 2, medio: 8, forte: 24 });


export const SHADOW_SLOT_CHALLENGER_MARGIN = 1.25;


export const SHADOW_ROTATION_PLANS_PER_TURN = 90;

export const DEFAULT_TIER = "medio";

export const LIGHT_FADE_REFUSAL = Object.freeze({
  lightDisabled: "light-disabled",
  beyondMaxDrawDistance: "beyond-max-draw-distance",
  belowScreenSize: "below-screen-size",
  behindCamera: "behind-camera",
  outOfActiveBudget: "out-of-active-budget",
  shadowsDisabled: "shadows-disabled",
  fadedBelowShadowThreshold: "faded-below-shadow-threshold",
  outOfShadowBudget: "out-of-shadow-budget",
  waitingShadowRotation: "waiting-shadow-rotation",
});

function tierNumber(table, tier) {
  const value = table[String(tier)];
  return Number.isFinite(value) ? value : table[DEFAULT_TIER];
}

export function activeLightBudgetForTier(tier) {
  return tierNumber(ACTIVE_LIGHT_BUDGET_BY_TIER, tier);
}

export function shadowLightBudgetForTier(tier) {
  return tierNumber(SHADOW_LIGHT_BUDGET_BY_TIER, tier);
}

export function cullRadiusPixelsForTier(tier) {
  return tierNumber(CULL_RADIUS_PIXELS_BY_TIER, tier);
}
