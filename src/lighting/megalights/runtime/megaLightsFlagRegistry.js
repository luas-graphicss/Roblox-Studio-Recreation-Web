export const TIER_NAMES = Object.freeze(["fraco", "medio", "forte"]);


const ALL_TIERS_OFF = Object.freeze({ fraco: false, medio: false, forte: false });


const definedFlags = new Map();


const manualOverrides = new Map();
const scopedOverrides = [];


let resolveExternalOverride = () => null;

export function setOverrideProvider(provider) {
  resolveExternalOverride = typeof provider === "function" ? provider : () => null;
}


function knownTierOrNull(tierName) {
  return TIER_NAMES.indexOf(tierName) >= 0 ? tierName : null;
}

function normalizeOverride(value) {
  if (value === true || value === false) return value;
  return null;
}


export function resolveIgnitionFlag(rawOverride, tierDefault) {
  const override = normalizeOverride(rawOverride);
  if (override === true) return { on: true, mode: "forced" };
  if (override === false) return { on: false, mode: "vetoed" };
  return tierDefault ? { on: true, mode: "auto-on" } : { on: false, mode: "auto-off" };
}


export function registerFlag(definition) {
  if (!definition || !definition.id) throw new Error("registerFlag: needs { id }");
  const id = String(definition.id);
  const alreadyDefined = definedFlags.get(id);
  if (alreadyDefined) return alreadyDefined;

  const flag = {
    id,
    phase: definition.phase || "?",
    description: definition.description || "",
    defaultsByTier: Object.freeze(Object.assign({}, ALL_TIERS_OFF, definition.defaultsByTier || {})),
  };
  definedFlags.set(id, flag);
  return flag;
}

export function definedFlagIds() {
  return Array.from(definedFlags.keys()).sort();
}

export function overrideOf(flagId) {
  for (let index = scopedOverrides.length - 1; index >= 0; index -= 1) {
    if (scopedOverrides[index].has(flagId)) return scopedOverrides[index].get(flagId);
  }
  if (manualOverrides.has(flagId)) return manualOverrides.get(flagId);
  return normalizeOverride(resolveExternalOverride(flagId));
}


export function setFlag(flagId, override) {
  const normalized = normalizeOverride(override);
  if (normalized === null) manualOverrides.delete(flagId);
  else manualOverrides.set(flagId, normalized);
  return flagState(flagId);
}

export function clearFlags() {
  manualOverrides.clear();
}

export function flagState(flagId, tierName) {
  const tier = knownTierOrNull(tierName);
  const flag = definedFlags.get(flagId);
  const tierDefault = flag && tier ? !!flag.defaultsByTier[tier] : false;
  const decision = resolveIgnitionFlag(overrideOf(flagId), tierDefault);
  return {
    id: flagId,
    phase: flag ? flag.phase : "?",
    description: flag ? flag.description : "",
    known: !!flag,
    tier,
    tierDefault,


    defaultsByTier: flag ? flag.defaultsByTier : ALL_TIERS_OFF,
    override: overrideOf(flagId),
    on: decision.on,
    mode: decision.mode,
  };
}


export function isFlagActive(flagId, tierName) {
  return flagState(flagId, tierName).on;
}

export function listFlags(tierName) {
  return definedFlagIds().map((flagId) => flagState(flagId, tierName));
}


registerFlag({
  id: "MegaLightsBaseline",
  phase: "base",
  description: "legacy lighting path, the reference image every gate compares against",
  defaultsByTier: { fraco: true, medio: false, forte: false },
});

registerFlag({
  id: "MegaLightsEnabled",
  phase: "base",
  description: "master switch of the MegaLights pipeline",
  defaultsByTier: { fraco: false, medio: true, forte: true },
});

export function createScopedFlagOverrides() {
  const values = new Map();
  let disposed = false;
  scopedOverrides.push(values);
  return {
    set(flagId, value) {
      if (disposed) throw new Error("The flag scope is disposed");
      if (!definedFlags.has(flagId)) throw new Error("Unknown MegaLights flag: " + flagId);
      if (value !== null && value !== true && value !== false) throw new Error("Expected AUTO, ON or OFF");
      values.set(flagId, value);
    },
    remove(flagId) { return values.delete(flagId); },
    clear() { values.clear(); },
    entries() { return Array.from(values, ([id, value]) => ({ id, value })); },
    dispose() {
      if (disposed) return;
      disposed = true;
      values.clear();
      scopedOverrides.splice(scopedOverrides.indexOf(values), 1);
    },
  };
}
