import { isMsmFlagActiveFor, normalizeMsmFlagToken } from "./msmFlagResolver.js";
import { isMsmTechnology } from "./msmTechnologyGate.js";
import { isMsmTier } from "./msmTierPolicy.js";

import { MSM_DEFAULT_STRENGTH, MSM_VIEW_OPTIONS, MSM_PHASE_OVERRIDE_NAMES } from './msmPublicApiCore.js';
export { MSM_DEFAULT_STRENGTH, MSM_VIEW_OPTIONS } from './msmPublicApiCore.js';
export const MSM_FORCED_PREVIEW_TIER = "medium";

export function resolveMsmStrength(value) {
  if (value === null || value === undefined || typeof value === "boolean") return MSM_DEFAULT_STRENGTH;
  if (typeof value === "string" && value.trim() === "") return MSM_DEFAULT_STRENGTH;
  const numeric = Number(value);
  return Number.isFinite(numeric) ? Math.min(1, Math.max(0, numeric)) : MSM_DEFAULT_STRENGTH;
}

export function resolveMsmViewportSettings(state, overrides = {}) {
  const source = state || {};
  const token = normalizeMsmFlagToken(overrides.flag ?? source.MegaLightsSM);
  const requestedTier = String(overrides.tier ?? source.msmTier ?? "").toLowerCase();


  const tier = isMsmTier(requestedTier) ? requestedTier : token === "on" ? MSM_FORCED_PREVIEW_TIER : "";
  const requestedView = overrides.view ?? source.MegaLightsSMView;
  const view = MSM_VIEW_OPTIONS.includes(requestedView) ? requestedView : "Composite";
  const settings = {
    awake: false,
    reason: "",
    mode: String(overrides.mode ?? source.MegaLightsSMMode ?? 'A').toUpperCase() === 'B' ? 'B' : 'A',
    phases: Object.fromEntries(MSM_PHASE_OVERRIDE_NAMES.map(name => [name, overrides[name] !== false])),
    token,
    tier,
    strength: resolveMsmStrength(overrides.strength ?? source.MegaLightsSMStrength),
    view,
    debugMode: MSM_VIEW_OPTIONS.indexOf(view),
  };
  const lights = settings.mode === 'B' ? source.msmAllLights || source.msmLights : source.msmLights;
  if (!token) settings.reason = "invalid-flag";
  else if (token === "off") settings.reason = "flag-off";
  else if (!source.technology || !isMsmTechnology(source.technology)) settings.reason = "unsupported-technology";
  else if (source.msmAllowed !== true) settings.reason = "shadows-disabled-or-safe-mode";
  else if (source.megaLightsWanted !== false) settings.reason = "megalights-owns-lighting";
  else if (!isMsmFlagActiveFor(token, source.weakGpu === true)) settings.reason = "auto-strong-gpu";
  else if (!tier) settings.reason = "unsupported-tier";
  else if (!Array.isArray(lights) || lights.length === 0) {
    settings.reason = source.msmCandidateCount > 0 ? "all-local-lights-resident" : "no-eligible-local-lights";
  } else {
    settings.awake = true;
    settings.reason = token === "on" ? "flag-on" : "auto-weak-gpu";
  }
  return settings;
}
