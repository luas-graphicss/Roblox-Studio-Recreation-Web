import { resolveView } from "./llShadowScreenSizeCore.js";
import {
  DEFAULT_TIER,
  LIGHT_FADE_MODE,
  LIGHT_FADE_PHASE_ID,
  LIGHT_FADE_REFUSAL,
  MAX_FADE_STEP_PER_PLAN,
  PLANS_BEFORE_HIDING_FADED_LIGHT,
  activeLightBudgetForTier,
  cullRadiusPixelsForTier,
  shadowLightBudgetForTier,
} from "./llLightFadeContract.js";
import { FADE_FULLY_FADED, FADE_FULLY_LIT, distanceFadeFactor, fadedIntensity, shadowFadeVerdict } from "./llLightFadeCore.js";
import { SCREEN_CULL_REASON, measureLightFootprint, screenCullVerdict } from "./llLightScreenCullCore.js";
import { rankLocalLights } from "./llLocalLightPriorityCore.js";
import { planActiveLightBudget, planShadowBudget } from "./llLightBudgetCore.js";
import { stepTowardsFade } from "./llFadeSlewCore.js";

export const PLAN_PHASE_ID = LIGHT_FADE_PHASE_ID;

const MIN_FADE_STEP = 1e-6;

function asObject(value) {
  return value && typeof value === "object" ? value : {};
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function finiteOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function wholeNumberOr(value, fallback) {
  return Math.max(Math.floor(finiteOr(value, fallback)), 0);
}

function readMap(map, key, fallback) {
  if (map && typeof map.get === "function") {
    const stored = map.get(key);
    return stored === undefined ? fallback : stored;
  }
  const plain = asObject(map);
  return plain[key] === undefined ? fallback : plain[key];
}



export function createLightFadeState() {
  return {
    fades: new Map(),
    visibleKeys: new Map(),
    lastVisiblePlans: new Map(),
    fadedPlans: new Map(),
    shadowKeys: [],
  };
}

function describeLight(rawLight, order) {
  const source = asObject(rawLight);
  const name = source.name === undefined ? String(order) : String(source.name);
  return {
    key: String(source.key === undefined ? name : source.key),
    name,
    kind: source.kind === undefined ? "PointLight" : String(source.kind),
    worldPosition: source.worldPosition,
    influenceRadius: Math.max(finiteOr(source.influenceRadius, 0), 0),
    intensity: Math.max(finiteOr(source.intensity, 0), 0),
    enabled: source.enabled !== false,
    shadowsRequested: source.shadowsRequested === true,
    maxDrawDistance: Math.max(finiteOr(source.maxDrawDistance, 0), 0),
    fadeRange: Math.max(finiteOr(source.fadeRange, 0), 0),
  };
}

function cullRefusalFor(reason) {
  return reason === SCREEN_CULL_REASON.BEHIND_CAMERA
    ? LIGHT_FADE_REFUSAL.behindCamera
    : LIGHT_FADE_REFUSAL.belowScreenSize;
}

function summarize(entries, context) {
  let active = 0;
  let culled = 0;
  let shadowed = 0;
  let hidden = 0;
  let fading = 0;
  let largestFadeStep = 0;
  const byRefusal = {};
  entries.forEach((entry) => {
    if (entry.active) active += 1;
    if (entry.culled) culled += 1;
    if (entry.castsShadow) shadowed += 1;
    if (entry.hidden) hidden += 1;
    if (entry.fade !== FADE_FULLY_LIT) fading += 1;
    largestFadeStep = Math.max(largestFadeStep, entry.fadeStep);
    if (entry.refusal) byRefusal[entry.refusal] = (byRefusal[entry.refusal] || 0) + 1;
    if (entry.shadowRefusal) byRefusal[entry.shadowRefusal] = (byRefusal[entry.shadowRefusal] || 0) + 1;
  });
  return Object.freeze({
    phase: LIGHT_FADE_PHASE_ID,
    mode: context.mode,
    tier: context.tier,
    planIndex: context.planIndex,
    lights: entries.length,
    active,
    culled,
    shadowed,
    hidden,
    fading,
    maxFadeStep: largestFadeStep,
    maxFadeStepAllowed: context.maxFadeStep,
    activeBudget: context.activeBudget,
    shadowBudget: context.shadowBudget,
    cullRadiusPixels: context.cullRadiusPixels,
    withinActiveBudget: context.activeBudget >= active,
    withinShadowBudget: context.shadowBudget >= shadowed,
    withinFadeStepLimit: context.maxFadeStep + MIN_FADE_STEP >= largestFadeStep,
    byRefusal: Object.freeze(byRefusal),
  });
}


export function planLocalLightFade(input) {
  const request = asObject(input);
  const tier = request.tier === undefined ? DEFAULT_TIER : String(request.tier);
  const mode = request.mode === LIGHT_FADE_MODE.LEGACY ? LIGHT_FADE_MODE.LEGACY : LIGHT_FADE_MODE.FADE;
  const legacy = mode === LIGHT_FADE_MODE.LEGACY;
  const view = resolveView(request.view);
  const camera = asObject(request.camera);
  const planIndex = wholeNumberOr(request.planIndex, 0);
  const state = asObject(request.previousState);
  const lights = asArray(request.lights).map(describeLight);
  const activeBudget = legacy ? lights.length : wholeNumberOr(request.activeLightBudget, activeLightBudgetForTier(tier));
  const shadowBudget = legacy ? lights.length : wholeNumberOr(request.shadowLightBudget, shadowLightBudgetForTier(tier));
  const cullRadiusPixels = Math.max(finiteOr(request.cullRadiusPixels, cullRadiusPixelsForTier(tier)), 0);
  const maxFadeStep = legacy ? 1 : Math.max(finiteOr(request.maxFadeStep, MAX_FADE_STEP_PER_PLAN), MIN_FADE_STEP);
  const shadowRotationEnabled = request.shadowRotation === true;
  const previousShadowKeys = asArray(state.shadowKeys).map(String);
  const previousShadowKeySet = new Set(previousShadowKeys);


  const measured = lights.map((light) => {
    const footprint = measureLightFootprint({
      light: { worldPosition: light.worldPosition, influenceRadius: light.influenceRadius },
      view,
      camera,
    });
    const wasVisible = readMap(state.visibleKeys, light.key, true) !== false;
    const cull = legacy
      ? { culled: false, reason: null, radiusPixels: footprint.radiusPixels, thresholdPixels: 0 }
      : screenCullVerdict({ footprint, wasVisible, cullRadiusPixels });
    const distanceFade = legacy
      ? FADE_FULLY_LIT
      : distanceFadeFactor({
          distance: footprint.distance,
          maxDrawDistance: light.maxDrawDistance,
          fadeRange: light.fadeRange,
        });

    let targetFade = FADE_FULLY_LIT;
    let refusal = null;
    if (!legacy) {
      if (!light.enabled) {
        targetFade = FADE_FULLY_FADED;
        refusal = LIGHT_FADE_REFUSAL.lightDisabled;
      } else if (cull.culled) {
        targetFade = FADE_FULLY_FADED;
        refusal = cullRefusalFor(cull.reason);
      } else if (distanceFade === FADE_FULLY_FADED) {
        targetFade = FADE_FULLY_FADED;
        refusal = LIGHT_FADE_REFUSAL.beyondMaxDrawDistance;
      } else {
        targetFade = distanceFade;
      }
    }
    return { light, footprint, cull, distanceFade, targetFade, refusal };
  });


  const ranked = rankLocalLights({
    planIndex,
    candidates: measured.map((item) => ({
      key: item.light.key,
      coverage: item.footprint.coverage,
      intensity: item.light.intensity,
      fadeFactor: item.targetFade,
      lastVisiblePlanIndex: readMap(state.lastVisiblePlans, item.light.key, planIndex),
    })),
  });
  const rankedByKey = new Map();
  ranked.forEach((item) => rankedByKey.set(item.key, item));


  const activePlan = planActiveLightBudget({ ranked, activeBudget });
  const activeKeySet = new Set(activePlan.activeKeys);


  const smoothed = measured.map((item) => {
    const key = item.light.key;
    const rankedItem = rankedByKey.get(key);
    const overActiveBudget = !legacy && !activeKeySet.has(key);
    const targetFade = overActiveBudget ? FADE_FULLY_FADED : item.targetFade;
    const refusal = overActiveBudget && item.refusal === null ? LIGHT_FADE_REFUSAL.outOfActiveBudget : item.refusal;
    const slew = stepTowardsFade({
      previousFade: readMap(state.fades, key, null),
      targetFade,
      maxStep: maxFadeStep,
    });
    const wasCastingShadow = previousShadowKeySet.has(key);
    const shadowVerdict = shadowFadeVerdict({ fadeFactor: slew.fade, wasCastingShadow });

    let shadowCandidate = false;
    let shadowRefusal = null;
    if (legacy) {
      shadowCandidate = item.light.shadowsRequested;
    } else if (!item.light.shadowsRequested) {
      shadowRefusal = LIGHT_FADE_REFUSAL.shadowsDisabled;
    } else if (!shadowVerdict.castsShadow) {
      shadowRefusal = LIGHT_FADE_REFUSAL.fadedBelowShadowThreshold;
    } else {
      shadowCandidate = true;
    }

    const previousFadedPlans = wholeNumberOr(readMap(state.fadedPlans, key, 0), 0);
    const fadedPlans = slew.fade === FADE_FULLY_FADED ? previousFadedPlans + 1 : 0;

    return {
      key,
      light: item.light,
      footprint: item.footprint,
      cull: item.cull,
      distanceFade: item.distanceFade,
      targetFade,
      refusal,
      slew,
      shadowCandidate,
      shadowRefusal,
      shadowThreshold: shadowVerdict.threshold,
      fadedPlans,
      hidden: !legacy && fadedPlans >= PLANS_BEFORE_HIDING_FADED_LIGHT,
      active: legacy || activeKeySet.has(key),
      rank: rankedItem === undefined ? measured.length : rankedItem.rank,
      priority: rankedItem === undefined ? 0 : rankedItem.priority,
      coverage: rankedItem === undefined ? item.footprint.coverage : rankedItem.coverage,
      intensityWeight: rankedItem === undefined ? 1 : rankedItem.intensityWeight,
      recency: rankedItem === undefined ? 1 : rankedItem.recency,
    };
  });


  const shadowCandidates = smoothed
    .filter((item) => item.shadowCandidate && item.active)
    .sort((a, b) => a.rank - b.rank)
    .map((item) => ({ key: item.key, priority: item.priority }));
  const shadowPlan = planShadowBudget({
    candidates: shadowCandidates,
    shadowBudget,
    previousShadowKeys,
    planIndex,
    rotationEnabled: shadowRotationEnabled,
  });
  const shadowKeySet = new Set(shadowPlan.shadowKeys);
  const shadowRefusalByKey = new Map();
  shadowPlan.refusals.forEach((item) => shadowRefusalByKey.set(item.key, item.refusal));


  const entries = smoothed
    .map((item) => {
      const castsShadow = shadowKeySet.has(item.key);
      const budgetShadowRefusal = shadowRefusalByKey.get(item.key);
      const shadowRefusal = castsShadow
        ? null
        : item.shadowRefusal === null
          ? budgetShadowRefusal === undefined
            ? null
            : budgetShadowRefusal
          : item.shadowRefusal;
      return Object.freeze({
        key: item.key,
        name: item.light.name,
        kind: item.light.kind,
        rank: item.rank,
        priority: item.priority,
        coverage: item.coverage,
        intensityWeight: item.intensityWeight,
        recency: item.recency,
        distance: item.footprint.distance,
        radiusPixels: item.footprint.radiusPixels,
        thresholdPixels: item.cull.thresholdPixels,
        cameraInside: item.footprint.cameraInside === true,
        behindCamera: item.footprint.behindCamera === true,
        distanceFade: item.distanceFade,
        targetFade: item.targetFade,
        fade: item.slew.fade,
        fadeStep: item.slew.step,
        fadeDirection: item.slew.direction,
        reachedTargetFade: item.slew.reachedTarget,
        culled: item.cull.culled === true,
        cullReason: item.cull.reason === undefined ? null : item.cull.reason,
        active: item.active,
        castsShadow,
        shadowThreshold: item.shadowThreshold,
        shadowsRequested: item.light.shadowsRequested,
        hidden: item.hidden,
        fadedPlans: item.fadedPlans,
        intensity: item.light.intensity,
        fadedIntensity: fadedIntensity(item.light.intensity, item.slew.fade),
        refusal: item.refusal,
        shadowRefusal,
      });
    })
    .sort((a, b) => a.rank - b.rank);

  const nextState = {
    fades: new Map(entries.map((entry) => [entry.key, entry.fade])),
    visibleKeys: new Map(entries.map((entry) => [entry.key, !entry.culled])),
    lastVisiblePlans: new Map(
      entries.map((entry) => [
        entry.key,
        entry.culled ? wholeNumberOr(readMap(state.lastVisiblePlans, entry.key, planIndex), planIndex) : planIndex,
      ])
    ),
    fadedPlans: new Map(entries.map((entry) => [entry.key, entry.fadedPlans])),
    shadowKeys: entries.filter((entry) => entry.castsShadow).map((entry) => entry.key),
  };

  return Object.freeze({
    phase: LIGHT_FADE_PHASE_ID,
    mode,
    tier,
    planIndex,
    view,
    entries: Object.freeze(entries),
    summary: summarize(entries, { mode, tier, planIndex, maxFadeStep, activeBudget, shadowBudget, cullRadiusPixels }),
    activePlan,
    shadowPlan,
    nextState,
  });
}


export function nextLightFadeState(plan) {
  const source = asObject(plan);
  return source.nextState === undefined ? createLightFadeState() : source.nextState;
}
