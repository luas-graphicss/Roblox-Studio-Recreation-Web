import { lightConfigKeyFor } from "./llShadowCacheCore.js";

export const LOCAL_SHADOW_REUSE_PHASE_ID = "LL-F25";


export const REFRESH_REASON = Object.freeze({
  FIRST_PULSE: "first-pulse",
  MISSING_MAP: "missing-map",
  LIGHT_CONFIG_CHANGED: "light-config-changed",
  CASTERS_CHANGED: "casters-changed",
  MAX_AGE_REACHED: "max-age-reached",
  HEAL: "heal",
});


export const REUSE_REASON = Object.freeze({
  IDENTICAL_MAP: "identical-map",
});


export const DEFAULT_MAX_PULSES_WITHOUT_REFRESH = 120;


export const CUBE_MAP_FACE_PASSES = 6;
export const SPOT_MAP_FACE_PASSES = 1;

export const SPOT_KIND = "spot";
export const POINT_KIND = "point";

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

function quantizedForKey(value) {
  return (Math.round(finiteOr(value, 0) * 10000) / 10000).toFixed(4);
}

export function normalizeLightKind(kind) {
  return String(kind) === SPOT_KIND ? SPOT_KIND : POINT_KIND;
}

export function facePassesForKind(kind) {
  return normalizeLightKind(kind) === SPOT_KIND ? SPOT_MAP_FACE_PASSES : CUBE_MAP_FACE_PASSES;
}


export function localShadowConfigKeyFor(light) {
  const source = asObject(light);
  return lightConfigKeyFor(source) + "|far:" + quantizedForKey(source.far);
}


export function createLocalShadowReuseGate(options) {
  const settings = asObject(options);
  const maxPulsesWithoutRefresh = Math.max(
    1,
    Math.floor(finiteOr(settings.maxPulsesWithoutRefresh, DEFAULT_MAX_PULSES_WITHOUT_REFRESH)),
  );


  const statesByKey = new Map();
  const totals = {
    pulses: 0,
    heals: 0,
    refreshedMaps: 0,
    reusedMaps: 0,
    mapBaseline: 0,
    refreshedFacePasses: 0,
    facePassBaseline: 0,
  };
  let pulseCount = 0;
  let lastPulse = null;


  function describeLight(rawLight, order) {
    const source = asObject(rawLight);
    if (source.key === undefined || source.key === null) return null;
    const kind = normalizeLightKind(source.kind);
    const configKey =
      source.configKey === undefined ? localShadowConfigKeyFor(source.config) : String(source.configKey);
    return {
      key: String(source.key),
      order,
      kind,
      hasMap: source.hasMap !== false,
      configKey,
      facePasses: facePassesForKind(kind),
    };
  }


  function refreshReasonFor(descriptor, casterRevision, healed) {
    if (healed) return REFRESH_REASON.HEAL;
    const state = statesByKey.get(descriptor.key);
    if (state === undefined) return REFRESH_REASON.FIRST_PULSE;
    if (!descriptor.hasMap) return REFRESH_REASON.MISSING_MAP;
    if (state.configKey !== descriptor.configKey) return REFRESH_REASON.LIGHT_CONFIG_CHANGED;
    if (state.casterRevision !== casterRevision) return REFRESH_REASON.CASTERS_CHANGED;
    if (state.pulsesSinceRefresh + 1 >= maxPulsesWithoutRefresh) return REFRESH_REASON.MAX_AGE_REACHED;
    return null;
  }

  function rememberVerdict(descriptor, casterRevision, refreshed) {
    const previous = statesByKey.get(descriptor.key);
    statesByKey.set(descriptor.key, {
      configKey: descriptor.configKey,
      casterRevision: refreshed || previous === undefined ? casterRevision : previous.casterRevision,
      pulsesSinceRefresh: refreshed || previous === undefined ? 0 : previous.pulsesSinceRefresh + 1,
    });
  }

  function forgetLightsOutsideOf(seenKeys) {
    const forgottenKeys = [];
    statesByKey.forEach((state, key) => {
      if (!seenKeys.has(key)) forgottenKeys.push(key);
    });
    forgottenKeys.forEach((key) => statesByKey.delete(key));
    return forgottenKeys;
  }


  function planPulse(input) {
    const request = asObject(input);
    pulseCount += 1;
    totals.pulses += 1;
    const casterRevision = Math.floor(finiteOr(request.casterRevision, 0));
    const healed = request.invalidateAll === true;
    if (healed) totals.heals += 1;

    const verdicts = [];
    const refreshKeys = [];
    const reuseKeys = [];
    const seenKeys = new Set();
    let refreshedFacePasses = 0;
    let facePassBaseline = 0;

    asArray(request.lights).forEach((rawLight, order) => {
      const descriptor = describeLight(rawLight, order);
      if (descriptor === null || seenKeys.has(descriptor.key)) return;
      seenKeys.add(descriptor.key);
      facePassBaseline += descriptor.facePasses;
      const refreshReason = refreshReasonFor(descriptor, casterRevision, healed);
      const refresh = refreshReason !== null;
      rememberVerdict(descriptor, casterRevision, refresh);
      if (refresh) {
        refreshKeys.push(descriptor.key);
        refreshedFacePasses += descriptor.facePasses;
      } else {
        reuseKeys.push(descriptor.key);
      }
      verdicts.push(
        Object.freeze({
          key: descriptor.key,
          kind: descriptor.kind,
          refresh,
          reason: refresh ? refreshReason : REUSE_REASON.IDENTICAL_MAP,
          facePasses: descriptor.facePasses,
          pulsesSinceRefresh: statesByKey.get(descriptor.key).pulsesSinceRefresh,
        }),
      );
    });

    const forgottenKeys = forgetLightsOutsideOf(seenKeys);
    const savedFacePasses = Math.max(0, facePassBaseline - refreshedFacePasses);

    totals.refreshedMaps += refreshKeys.length;
    totals.reusedMaps += reuseKeys.length;
    totals.mapBaseline += verdicts.length;
    totals.refreshedFacePasses += refreshedFacePasses;
    totals.facePassBaseline += facePassBaseline;

    lastPulse = Object.freeze({
      phase: LOCAL_SHADOW_REUSE_PHASE_ID,
      pulse: pulseCount,
      casterRevision,
      healed,
      reason: healed ? String(request.reason || REFRESH_REASON.HEAL) : null,
      lightCount: verdicts.length,
      verdicts: Object.freeze(verdicts),
      refreshKeys: Object.freeze(refreshKeys),
      reuseKeys: Object.freeze(reuseKeys),
      forgottenKeys: Object.freeze(forgottenKeys),
      refreshedMaps: refreshKeys.length,
      reusedMaps: reuseKeys.length,
      refreshedFacePasses,


      facePassBaseline,
      savedFacePasses,
      reductionRatio: facePassBaseline > 0 ? savedFacePasses / facePassBaseline : 0,
    });
    return lastPulse;
  }

  function stats() {
    return {
      phase: LOCAL_SHADOW_REUSE_PHASE_ID,
      pulses: totals.pulses,
      heals: totals.heals,
      trackedLights: statesByKey.size,
      refreshedMaps: totals.refreshedMaps,
      reusedMaps: totals.reusedMaps,
      mapBaseline: totals.mapBaseline,
      refreshedFacePasses: totals.refreshedFacePasses,
      facePassBaseline: totals.facePassBaseline,
      savedFacePasses: Math.max(0, totals.facePassBaseline - totals.refreshedFacePasses),
      facePassReductionRatio:
        totals.facePassBaseline > 0 ? 1 - totals.refreshedFacePasses / totals.facePassBaseline : 0,
      maxPulsesWithoutRefresh,
    };
  }

  function reset() {
    statesByKey.clear();
    pulseCount = 0;
    lastPulse = null;
    Object.keys(totals).forEach((field) => {
      totals[field] = 0;
    });
    return true;
  }

  return {
    phaseId: LOCAL_SHADOW_REUSE_PHASE_ID,
    maxPulsesWithoutRefresh,
    planPulse,
    stateOf: (key) => statesByKey.get(String(key)) || null,
    trackedLightKeys: () => Array.from(statesByKey.keys()),
    forget: (key) => statesByKey.delete(String(key)),
    lastPulse: () => lastPulse,
    stats,
    reset,
  };
}
