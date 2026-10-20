export const FORWARD_LIGHT_BUDGET_BY_TIER = Object.freeze({
  fraco: 4,
  medio: 8,
  forte: 12,
});
export const DEFAULT_FORWARD_LIGHT_BUDGET = FORWARD_LIGHT_BUDGET_BY_TIER.medio;

export const SPLIT_REASON = Object.freeze({
  clustered: "clustered",
  shadowCaster: "forward: shadow caster",
  forwardBudget: "forward: inside the budget",
  clusterFull: "forward: cluster is full",
});

export function forwardLightBudgetForTier(tier) {
  const budget = FORWARD_LIGHT_BUDGET_BY_TIER[tier];
  return Number.isFinite(budget) ? budget : DEFAULT_FORWARD_LIGHT_BUDGET;
}


export function clusterLightPriority(options) {
  const settings = options || {};
  const intensity = Number(settings.intensity) || 0;
  const range = Number(settings.range) || 0;
  return intensity * range;
}


export function planClusterSplit(options) {
  const settings = options || {};
  const lights = Array.isArray(settings.lights) ? settings.lights : [];
  const budget = Math.max(0, Number.isFinite(settings.forwardBudget) ? Math.floor(settings.forwardBudget) : DEFAULT_FORWARD_LIGHT_BUDGET);
  const capacity = Math.max(0, Number.isFinite(settings.clusterCapacity) ? Math.floor(settings.clusterCapacity) : lights.length);

  const ordered = lights.slice().sort(compareByForwardPriority);
  const forwardKeys = [];
  const clusteredKeys = [];
  const reasonByKey = {};

  ordered.forEach((light) => {
    if (light.castShadow) {
      forwardKeys.push(light.key);
      reasonByKey[light.key] = SPLIT_REASON.shadowCaster;
      return;
    }
    if (forwardKeys.length < budget) {
      forwardKeys.push(light.key);
      reasonByKey[light.key] = SPLIT_REASON.forwardBudget;
      return;
    }
    if (clusteredKeys.length >= capacity) {
      forwardKeys.push(light.key);
      reasonByKey[light.key] = SPLIT_REASON.clusterFull;
      return;
    }
    clusteredKeys.push(light.key);
    reasonByKey[light.key] = SPLIT_REASON.clustered;
  });

  return {
    forwardKeys,
    clusteredKeys,
    reasonByKey,
    budget,
    capacity,
    total: lights.length,
  };
}


function compareByForwardPriority(first, second) {
  const firstCastsShadow = first.castShadow ? 1 : 0;
  const secondCastsShadow = second.castShadow ? 1 : 0;
  if (firstCastsShadow !== secondCastsShadow) return secondCastsShadow - firstCastsShadow;
  const firstPriority = Number(first.priority) || 0;
  const secondPriority = Number(second.priority) || 0;
  if (firstPriority !== secondPriority) return secondPriority - firstPriority;
  return String(first.key).localeCompare(String(second.key));
}
