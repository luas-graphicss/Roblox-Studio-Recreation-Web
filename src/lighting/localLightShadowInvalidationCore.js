export const LOCAL_SHADOW_INVALIDATION_PHASE_ID = "LL-OPT1";

export const LOCAL_SHADOW_REDRAW_REASON = Object.freeze({
  MISSING_MAP: "missing-map",
  FIRST_SIGHT: "first-sight",
  LIGHT_CONFIG: "light-config",
  MOVED_CASTER: "moved-caster",
  LINGER: "linger",
  HEAL: "heal",
});


export const DEFAULT_REACH_SAFETY_FACTOR = 1.05;
export const DEFAULT_REACH_SAFETY_MARGIN = 0.25;


export const DEFAULT_CASTER_LINGER_PULSES = 1;

const CONFIG_KEY_PRECISION = 10000;

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

function positiveOr(value, fallback) {
  const parsed = finiteOr(value, fallback === undefined ? 0 : fallback);
  return parsed >= 0 ? parsed : 0;
}

function wholeNumberOr(value, fallback) {
  const parsed = Math.floor(finiteOr(value, fallback));
  return parsed >= 0 ? parsed : 0;
}

function quantizedForKey(value) {
  return (Math.round(finiteOr(value, 0) * CONFIG_KEY_PRECISION) / CONFIG_KEY_PRECISION).toFixed(4);
}


export function localLightShadowConfigKey(light) {
  const source = asObject(light);
  const position = asArray(source.position);
  const direction = asArray(source.direction);
  return [
    source.kind === "spot" ? "spot" : "point",
    quantizedForKey(position[0]),
    quantizedForKey(position[1]),
    quantizedForKey(position[2]),
    quantizedForKey(direction[0]),
    quantizedForKey(direction[1]),
    quantizedForKey(direction[2]),
    quantizedForKey(source.coneHalfAngleRad),
    quantizedForKey(source.range),
    quantizedForKey(source.near),
    quantizedForKey(source.far),
    String(wholeNumberOr(source.mapSize, 0)),
  ].join("|");
}


export function lightReachRadius(light, options) {
  const source = asObject(light);
  const settings = asObject(options);
  const safetyFactor = Math.max(finiteOr(settings.reachSafetyFactor, DEFAULT_REACH_SAFETY_FACTOR), 1);
  const safetyMargin = positiveOr(
    settings.reachSafetyMargin === undefined ? DEFAULT_REACH_SAFETY_MARGIN : settings.reachSafetyMargin
  );
  const range = positiveOr(source.range);
  const far = positiveOr(source.far);
  const reach = far >= range ? far : range;
  return reach * safetyFactor + safetyMargin;
}


export function worldBoxTouchesSphere(worldBox, center, radius) {
  const box = asObject(worldBox);
  const minimum = asArray(box.min);
  const maximum = asArray(box.max);
  const sphereCenter = asArray(center);
  if (!(minimum.length >= 3) || !(maximum.length >= 3) || !(sphereCenter.length >= 3)) return true;
  let squaredDistance = 0;
  for (let axis = 0; 3 > axis; axis += 1) {
    const axisCenter = finiteOr(sphereCenter[axis], NaN);
    const axisMinimum = finiteOr(minimum[axis], NaN);
    const axisMaximum = finiteOr(maximum[axis], NaN);
    if (!Number.isFinite(axisCenter) || !Number.isFinite(axisMinimum) || !Number.isFinite(axisMaximum)) return true;
    if (axisMinimum > axisCenter) {
      const gap = axisMinimum - axisCenter;
      squaredDistance += gap * gap;
    } else if (axisCenter > axisMaximum) {
      const gap = axisCenter - axisMaximum;
      squaredDistance += gap * gap;
    }
  }
  const reach = positiveOr(radius);
  return reach * reach >= squaredDistance;
}


export function createLocalLightShadowInvalidator(options) {
  const settings = asObject(options);
  const reachSafetyFactor = Math.max(finiteOr(settings.reachSafetyFactor, DEFAULT_REACH_SAFETY_FACTOR), 1);
  const reachSafetyMargin = positiveOr(
    settings.reachSafetyMargin === undefined ? DEFAULT_REACH_SAFETY_MARGIN : settings.reachSafetyMargin
  );
  const casterLingerPulses = wholeNumberOr(settings.casterLingerPulses, DEFAULT_CASTER_LINGER_PULSES);
  const reachOptions = { reachSafetyFactor, reachSafetyMargin };


  const stateByKey = new Map();


  const redrawKeys = [];
  const reasonByKey = new Map();
  const seenKeys = new Set();
  const plan = {
    pulse: 0,
    healed: false,
    lightCount: 0,
    dirtyBoxCount: 0,
    redrawKeys,
    reasonByKey,
    redrawCount: 0,
    keptCount: 0,
    reductionRatio: 1,
  };

  const totals = { pulses: 0, redraws: 0, baseline: 0, heals: 0 };
  let pulseCount = 0;
  let healRequested = true;

  function requestHeal() {
    healRequested = true;
    return true;
  }

  function reachRadiusOf(light) {
    return lightReachRadius(light, reachOptions);
  }

  function anyDirtyBoxTouches(light, dirtyBoxes) {
    if (!(dirtyBoxes.length > 0)) return false;
    const center = asArray(asObject(light).position);
    const radius = reachRadiusOf(light);
    for (let index = 0; dirtyBoxes.length > index; index += 1) {
      if (worldBoxTouchesSphere(dirtyBoxes[index], center, radius)) return true;
    }
    return false;
  }

  function reasonForLight(light, key, healed, dirtyBoxes) {
    const state = stateByKey.get(key);
    const configKey = localLightShadowConfigKey(light);
    const known = state !== undefined;
    const previousConfigKey = known ? state.configKey : "";
    const lingerPulses = known ? state.lingerPulses : 0;

    if (light.hasMap !== true) return { reason: LOCAL_SHADOW_REDRAW_REASON.MISSING_MAP, configKey };
    if (!known) return { reason: LOCAL_SHADOW_REDRAW_REASON.FIRST_SIGHT, configKey };
    if (healed) return { reason: LOCAL_SHADOW_REDRAW_REASON.HEAL, configKey };
    if (previousConfigKey !== configKey) return { reason: LOCAL_SHADOW_REDRAW_REASON.LIGHT_CONFIG, configKey };
    if (anyDirtyBoxTouches(light, dirtyBoxes)) return { reason: LOCAL_SHADOW_REDRAW_REASON.MOVED_CASTER, configKey };
    if (lingerPulses > 0) return { reason: LOCAL_SHADOW_REDRAW_REASON.LINGER, configKey };
    return { reason: "", configKey };
  }

  function lingerPulsesFor(reason) {
    if (reason === LOCAL_SHADOW_REDRAW_REASON.MOVED_CASTER) return casterLingerPulses;
    if (reason === LOCAL_SHADOW_REDRAW_REASON.LINGER) return 0;
    return 0;
  }


  function planFrame(input) {
    const request = asObject(input);
    const lights = asArray(request.lights);
    const dirtyBoxes = asArray(request.dirtyBoxes);
    const healed = request.invalidateAll === true || healRequested;

    pulseCount += 1;
    totals.pulses += 1;
    if (healed) totals.heals += 1;
    healRequested = false;

    redrawKeys.length = 0;
    reasonByKey.clear();
    seenKeys.clear();

    for (let index = 0; lights.length > index; index += 1) {
      const light = asObject(lights[index]);
      const key = String(light.key === undefined ? index : light.key);
      if (seenKeys.has(key)) continue;                                      
      seenKeys.add(key);
      const verdict = reasonForLight(light, key, healed, dirtyBoxes);
      if (verdict.reason) {
        redrawKeys.push(key);
        reasonByKey.set(key, verdict.reason);
      }
      stateByKey.set(key, {
        configKey: verdict.configKey,
        lingerPulses: lingerPulsesFor(verdict.reason),
      });
    }


    stateByKey.forEach((_state, key) => {
      if (!seenKeys.has(key)) stateByKey.delete(key);
    });

    plan.pulse = pulseCount;
    plan.healed = healed;
    plan.lightCount = seenKeys.size;
    plan.dirtyBoxCount = dirtyBoxes.length;
    plan.redrawCount = redrawKeys.length;
    plan.keptCount = seenKeys.size - redrawKeys.length;

    plan.reductionRatio = seenKeys.size > 0 ? plan.keptCount / seenKeys.size : 1;
    totals.redraws += plan.redrawCount;
    totals.baseline += plan.lightCount;
    return plan;
  }

  function stats() {
    return {
      phase: LOCAL_SHADOW_INVALIDATION_PHASE_ID,
      pulses: totals.pulses,
      trackedLights: stateByKey.size,
      redraws: totals.redraws,
      baseline: totals.baseline,
      reductionRatio: totals.baseline > 0 ? 1 - totals.redraws / totals.baseline : 0,
      heals: totals.heals,
      casterLingerPulses,
      reachSafetyFactor,
      reachSafetyMargin,
    };
  }

  function forget(key) {
    return stateByKey.delete(String(key));
  }

  function reset() {
    stateByKey.clear();
    redrawKeys.length = 0;
    reasonByKey.clear();
    seenKeys.clear();
    pulseCount = 0;
    healRequested = true;
    totals.pulses = 0;
    totals.redraws = 0;
    totals.baseline = 0;
    totals.heals = 0;
    return true;
  }

  return {
    planFrame,
    requestHeal,
    forget,
    reset,
    stats,
    trackedLightCount: () => stateByKey.size,
    lastPlan: () => plan,
  };
}
