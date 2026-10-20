import { MAX_INJECTED_LIGHTS, clampIndirectIntensity } from "./llGiLocalContract.js";


export const INJECTION_REFUSAL = Object.freeze({
  DISABLED: "disabled",
  NO_INDIRECT: "no-indirect",
  NO_POWER: "no-power",
  OVER_BUDGET: "over-budget",
});

export const FULL_SPHERE_STERADIANS = 4 * Math.PI;


export function apertureSolidAngle(light) {
  const cone = light && light.cone;
  if (!cone) return FULL_SPHERE_STERADIANS;
  const cosOuter = Number(cone.cosOuter);
  if (!Number.isFinite(cosOuter)) return FULL_SPHERE_STERADIANS;
  const clamped = Math.min(Math.max(cosOuter, -1), 1);
  return Math.max(2 * Math.PI * (1 - clamped), 0);
}


export function indirectScaleOf(light) {
  return clampIndirectIntensity(light ? light.indirectIntensity : undefined);
}


export function indirectPowerOf(light) {
  if (!light || light.enabled === false) return 0;
  const candela = Math.max(Number(light.candela) || 0, 0);
  if (!(candela > 0)) return 0;
  return candela * apertureSolidAngle(light) * indirectScaleOf(light);
}

function refusalFor(light) {
  if (!light || light.enabled === false) return INJECTION_REFUSAL.DISABLED;


  if (!(indirectScaleOf(light) > 0)) return INJECTION_REFUSAL.NO_INDIRECT;
  if (!(Math.max(Number(light.candela) || 0, 0) > 0)) return INJECTION_REFUSAL.NO_POWER;
  if (!(Math.max(Number(light.range) || 0, 0) > 0)) return INJECTION_REFUSAL.NO_POWER;
  return null;
}

function compareByIndirectPower(left, right) {
  if (right.indirectPower !== left.indirectPower) return right.indirectPower - left.indirectPower;


  return String(left.key).localeCompare(String(right.key));
}







export function selectInjectingLights(options) {
  const input = options || {};
  const lights = Array.isArray(input.lights) ? input.lights : [];
  const requestedBudget = Number(input.maxInjectedLights);
  const budget = Number.isFinite(requestedBudget)
    ? Math.min(Math.max(Math.floor(requestedBudget), 0), MAX_INJECTED_LIGHTS)
    : MAX_INJECTED_LIGHTS;

  const candidates = [];
  const refused = [];
  for (let index = 0; index !== lights.length; index += 1) {
    const light = lights[index];
    const key = light && light.key !== undefined ? String(light.key) : "light-" + index;
    const reason = refusalFor(light);
    if (reason) {
      refused.push({ key: key, reason: reason, indirectPower: 0 });
      continue;
    }
    candidates.push({
      key: key,
      kind: light.kind === "spot" ? "spot" : "point",
      light: light,
      indirectScale: indirectScaleOf(light),
      indirectPower: indirectPowerOf(light),
    });
  }

  candidates.sort(compareByIndirectPower);

  const injected = [];
  let injectedPower = 0;
  let refusedPower = 0;
  for (let index = 0; index !== candidates.length; index += 1) {
    const candidate = candidates[index];
    if (injected.length >= budget) {
      refused.push({ key: candidate.key, reason: INJECTION_REFUSAL.OVER_BUDGET, indirectPower: candidate.indirectPower });
      refusedPower += candidate.indirectPower;
      continue;
    }
    candidate.rank = injected.length;
    injected.push(candidate);
    injectedPower += candidate.indirectPower;
  }

  return {
    injected: injected,
    refused: refused,
    injectedPower: injectedPower,
    refusedPower: refusedPower,
    budget: budget,
    candidates: candidates.length,
  };
}


export function summarizeSelection(selection) {
  const byReason = {};
  selection.refused.forEach((item) => {
    byReason[item.reason] = (byReason[item.reason] || 0) + 1;
  });
  return {
    injected: selection.injected.length,
    refused: selection.refused.length,
    budget: selection.budget,
    byReason: byReason,
    injectedPower: selection.injectedPower,
    refusedPower: selection.refusedPower,
  };
}
