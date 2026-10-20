import { LL_TIER_IDS, DEFAULT_LL_TIER, isLocalLightTier } from "./llTierResolver.js";

export const LL_FLAG_TOKEN = Object.freeze({
  AUTO: "auto",
  ON: "on",
  OFF: "off",
});

export const LL_FLAG_TOKENS = Object.freeze([LL_FLAG_TOKEN.AUTO, LL_FLAG_TOKEN.ON, LL_FLAG_TOKEN.OFF]);

const ON_ALIASES = Object.freeze(["on", "true", "1", "yes", "ligado"]);
const OFF_ALIASES = Object.freeze(["off", "false", "0", "no", "desligado"]);


const registrations = new Map();


const overrides = new Map();


const unknownFlagRequests = new Set();


let flagRegistryRevision = 0;


const activeFlagMemo = new Map();

function invalidateActiveFlagMemo() {
  flagRegistryRevision += 1;
  activeFlagMemo.clear();
}


export function normalizeLocalLightFlagToken(value) {
  if (value === true) return LL_FLAG_TOKEN.ON;
  if (value === false) return LL_FLAG_TOKEN.OFF;
  if (typeof value === "string") {
    const text = value.trim().toLowerCase();
    if (ON_ALIASES.indexOf(text) !== -1) return LL_FLAG_TOKEN.ON;
    if (OFF_ALIASES.indexOf(text) !== -1) return LL_FLAG_TOKEN.OFF;
  }

  return LL_FLAG_TOKEN.AUTO;
}

function validateDefaultsByTier(flagId, defaultsByTier) {
  const source = defaultsByTier && typeof defaultsByTier === "object" ? defaultsByTier : null;
  if (!source) {
    throw new Error("local-light flag \"" + flagId + "\": defaultsByTier is required");
  }
  const normalized = {};
  for (const tier of LL_TIER_IDS) {
    const value = source[tier];
    if (value !== true && value !== false) {
      throw new Error(
        "local-light flag \"" + flagId + "\": defaultsByTier." + tier + " must be true or false (got " + String(value) + ")",
      );
    }
    normalized[tier] = value;
  }
  return Object.freeze(normalized);
}

function sameDefaults(a, b) {
  for (const tier of LL_TIER_IDS) {
    if (a[tier] !== b[tier]) return false;
  }
  return true;
}


export function registerLocalLightFlag(definition) {
  const source = definition && typeof definition === "object" ? definition : {};
  const id = typeof source.id === "string" ? source.id.trim() : "";
  if (!id) throw new Error("local-light flag: id is required");

  const phase = typeof source.phase === "string" ? source.phase.trim() : "";
  if (!phase) throw new Error("local-light flag \"" + id + "\": phase is required");

  const defaultsByTier = validateDefaultsByTier(id, source.defaultsByTier);
  const existing = registrations.get(id);

  if (existing) {


    if (existing.phase === phase && sameDefaults(existing.defaultsByTier, defaultsByTier)) return existing;
    throw new Error(
      "local-light flag \"" + id + "\" is already registered by " + existing.phase + " with different defaults",
    );
  }

  const registration = Object.freeze({
    id,
    phase,
    description: typeof source.description === "string" ? source.description : "",
    defaultsByTier,
  });
  registrations.set(id, registration);
  unknownFlagRequests.delete(id);
  invalidateActiveFlagMemo();
  return registration;
}

export function getLocalLightFlag(flagId) {
  return registrations.get(flagId) || null;
}

export function listLocalLightFlags() {
  return Array.from(registrations.values());
}


export function setLocalLightFlagOverride(flagId, value) {
  const token = normalizeLocalLightFlagToken(value);
  if (token === LL_FLAG_TOKEN.AUTO) overrides.delete(flagId);
  else overrides.set(flagId, token);
  invalidateActiveFlagMemo();
  return token;
}

export function getLocalLightFlagOverride(flagId) {
  return overrides.get(flagId) || LL_FLAG_TOKEN.AUTO;
}

export function clearLocalLightFlagOverrides() {
  overrides.clear();
  invalidateActiveFlagMemo();
}


export function resolveLocalLightFlag(flagId, context) {
  const settings = context && typeof context === "object" ? context : {};
  const tier = isLocalLightTier(settings.tier) ? settings.tier : DEFAULT_LL_TIER;
  const registration = registrations.get(flagId);

  if (!registration) {
    unknownFlagRequests.add(flagId);
    return {
      id: flagId,
      phase: "",
      tier,
      token: LL_FLAG_TOKEN.OFF,
      active: false,
      tierDefault: null,
      source: "unknown-flag",
    };
  }


  const token = "override" in settings
    ? normalizeLocalLightFlagToken(settings.override)
    : getLocalLightFlagOverride(flagId);

  const tierDefault = registration.defaultsByTier[tier];
  if (token === LL_FLAG_TOKEN.ON) {
    return { id: flagId, phase: registration.phase, tier, token, active: true, tierDefault, source: "override" };
  }
  if (token === LL_FLAG_TOKEN.OFF) {
    return { id: flagId, phase: registration.phase, tier, token, active: false, tierDefault, source: "override" };
  }
  return {
    id: flagId,
    phase: registration.phase,
    tier,
    token: LL_FLAG_TOKEN.AUTO,
    active: tierDefault,
    tierDefault,
    source: "tier-default",
  };
}

















export function isLocalLightFlagActive(flagId, tier, override) {
  if (arguments.length > 2) {
    return resolveLocalLightFlag(flagId, { tier, override }).active === true;
  }
  const memoKey = flagRegistryRevision + "\u0000" + flagId + "\u0000" + tier;
  const memoized = activeFlagMemo.get(memoKey);
  if (memoized !== undefined) return memoized;
  const active = resolveLocalLightFlag(flagId, { tier }).active === true;
  activeFlagMemo.set(memoKey, active);
  return active;
}


export function getUnknownFlagRequests() {
  return Array.from(unknownFlagRequests);
}


export function resetLocalLightFlagRegistry() {
  registrations.clear();
  overrides.clear();
  unknownFlagRequests.clear();
  invalidateActiveFlagMemo();
}
