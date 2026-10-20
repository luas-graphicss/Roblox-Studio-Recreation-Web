const SSM_PRESSURE_CUTS = Object.freeze(['exclusiveMaps', 'extension', 'Lite', 'legacy']);

export function createSubstrateSmGlobalBudgetAdapter({ initialLevel = 0 } = {}) {
  if (!Number.isSafeInteger(initialLevel) || initialLevel < 0 || initialLevel > SSM_PRESSURE_CUTS.length) {
    throw new RangeError('SSM_GLOBAL_BUDGET_LEVEL_INVALID');
  }
  let level = initialLevel;
  let latestGeneration = -1;
  let lastDecision = null;

  function applyHostDecision({ generation, governor, atFrameBoundary = false } = {}) {
    if (!Number.isSafeInteger(generation) || generation < 0)
      throw new RangeError('SSM_GLOBAL_BUDGET_GENERATION_REQUIRED');
    if (generation <= latestGeneration) return lastDecision;
    if (atFrameBoundary !== true) return null;
    if (
      !governor ||
      typeof governor !== 'object' ||
      typeof governor.active !== 'boolean' ||
      typeof governor.changed !== 'boolean' ||
      !['up', 'down', 'none'].includes(governor.direction) ||
      typeof governor.killSwitch !== 'boolean'
    )
      throw new TypeError('SSM_GLOBAL_BUDGET_HOST_DECISION_INVALID');
    latestGeneration = generation;
    const pressure =
      governor.active && (governor.killSwitch || (governor.changed && governor.direction === 'down'));
    const previousLevel = level;
    if (pressure)
      level = governor.killSwitch ? SSM_PRESSURE_CUTS.length : Math.min(SSM_PRESSURE_CUTS.length, level + 1);
    lastDecision = Object.freeze({
      generation,
      level,
      changed: level !== previousLevel,
      cut: level ? SSM_PRESSURE_CUTS[level - 1] : null,
      reason: pressure
        ? String(governor.reason || 'SSM_GLOBAL_BUDGET_PRESSURE').slice(0, 512)
        : 'SSM_GLOBAL_BUDGET_HOLD',
      hostConfig: governor.config,
      hostFeaturesChanged: false,
      automaticUpgrade: false,
      suspendWarmup: pressure,
    });
    return lastDecision;
  }

  function resetForExplicitRequest() {
    level = 0;
    lastDecision = null;
  }

  function getState() {
    return Object.freeze({ level, latestGeneration, lastDecision });
  }

  return Object.freeze({ applyHostDecision, resetForExplicitRequest, getState });
}
