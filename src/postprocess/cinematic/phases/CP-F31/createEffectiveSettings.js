import { DEFAULT_BLOOM_SETTINGS, resolveBloomSettings } from "../CP-F14/bloomSettings.js";
import { finite, inherited, integer, record } from "./qualityContract.js";

function authoredScope(store, key) {
  const source = store.get(key);
  return inherited(source) ? {} : { ...record(source, key) };
}

function capNumber(source, field, ceiling, minimum, maximum, whole = false) {
  const value = inherited(source[field]) ? ceiling : source[field];
  if (whole) integer(value, field, minimum, maximum);
  else finite(value, field, minimum, maximum);
  return Math.min(value, ceiling);
}

function enabled(source, fallback, permitted) {
  const value = inherited(source.enabled) ? fallback : source.enabled;
  if (typeof value !== "boolean") throw new TypeError("Effect enabled must be boolean or AUTO");
  return value && permitted;
}

export function createEffectiveSettings({ store, profile, capabilities, viewId, screenPercentage, budgetBytes }) {
  const scopes = new Map();
  const quarterBudget = Math.max(1, Math.floor(budgetBytes / 4));
  const bloomInput = authoredScope(store, "CP-F14");
  for (const key of ["enabled", "intensity", "threshold", "softKnee", "bands"])
    if (inherited(bloomInput[key])) delete bloomInput[key];
  const bloom = resolveBloomSettings(bloomInput);
  scopes.set("CP-F14", Object.freeze({ ...bloom,
    enabled: bloom.enabled && profile.bloomEnabled,
    bands: Object.freeze(bloom.bands.slice(0, profile.bloomBands)) }));
  const convolution = authoredScope(store, "CP-F15");
  scopes.set("CP-F15", Object.freeze({ ...convolution,
    enabled: enabled(convolution, false, profile.convolutionEnabled),
    maxTargetBytes: capNumber(convolution, "maxTargetBytes", quarterBudget, 1, 1073741824),
    maxSampleOperations: capNumber(convolution, "maxSampleOperations", profile.convolutionOperations, 1, 2147483647) }));
  const diaphragm = authoredScope(store, "CP-F19");
  scopes.set("CP-F19", Object.freeze({ ...diaphragm,
    enabled: enabled(diaphragm, false, profile.dofEnabled),
    maxRadiusPixels: capNumber(diaphragm, "maxRadiusPixels", profile.dofRadius, 0, 24),
    memoryBudgetBytes: capNumber(diaphragm, "memoryBudgetBytes", quarterBudget, 1, 1073741824, true),
    sampleVisitBudget: capNumber(diaphragm, "sampleVisitBudget", profile.dofVisits, 1, Number.MAX_SAFE_INTEGER, true) }));
  const dof = authoredScope(store, "CP-F20");
  const workingScale = inherited(dof.workingScale) ? profile.dofWorkingScale : dof.workingScale;
  if (![1, 2, 4].includes(workingScale)) throw new RangeError("Invalid DOF workingScale");
  scopes.set("CP-F20", Object.freeze({ ...dof,
    enabled: enabled(dof, true, profile.dofEnabled && capabilities.temporalDof),
    workingScale: Math.max(workingScale, profile.dofWorkingScale),
    maximumSamples: capNumber(dof, "maximumSamples", profile.historySamples, 1, 256, true),
    historyWeight: capNumber(dof, "historyWeight", profile.historyWeight, 0, 0.99) }));
  const temporal = authoredScope(store, "CP-F21");
  const historyFilter = inherited(temporal.historyFilter) ? profile.historyFilter : temporal.historyFilter;
  if (!["bilinear", "catmull-rom"].includes(historyFilter)) throw new RangeError("Invalid temporal historyFilter");
  scopes.set("CP-F21", Object.freeze({ ...temporal,
    enabled: enabled(temporal, true, profile.temporalEnabled && capabilities.temporal),
    screenPercentage,
    historyWeight: capNumber(temporal, "historyWeight", profile.historyWeight, 0, 0.98),
    historyFilter: profile.historyFilter === "bilinear" ? "bilinear" : historyFilter }));
  const globalMotion = authoredScope(store, "CP-F22");
  const viewMotion = authoredScope(store, `CP-F22.${viewId}`);
  const motion = { ...globalMotion };
  for (const [name, value] of Object.entries(viewMotion)) if (!inherited(value)) motion[name] = value;
  const motionPolicy = Object.freeze({ ...motion,
    enabled: enabled(motion, true, profile.motionEnabled && capabilities.motionBlur),
    sampleCount: capNumber(motion, "sampleCount", profile.motionSamples, 4, 64, true),
    maximumBytes: capNumber(motion, "maximumBytes", Math.max(1024, quarterBudget), 1024, 1073741824, true) });
  scopes.set("CP-F22", motionPolicy);
  scopes.set(`CP-F22.${viewId}`, motionPolicy);
  const settings = Object.freeze({
    get: (key) => scopes.has(key) ? scopes.get(key) : store.get(key),
    revision: () => store.revision?.(),
    snapshot: () => ({ ...store.snapshot?.(), ...Object.fromEntries(scopes) }),
    set() { throw new Error("Quality settings are read-only; update the authored store before a frame"); }
  });
  return Object.freeze({ settings, scopes, defaultBloomBands: DEFAULT_BLOOM_SETTINGS.bands.length });
}
