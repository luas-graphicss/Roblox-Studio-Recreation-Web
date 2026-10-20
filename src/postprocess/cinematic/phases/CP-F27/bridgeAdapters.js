import { BRIDGE_FEATURES, BRIDGE_OWNER } from "./bridgeContract.js";
import { requireKeys, requireName } from "./bridgeValidation.js";

const registries = new WeakSet();

export function createBridgeAdapters(definitions = []) {
  if (!Array.isArray(definitions)) throw new TypeError("CP-F27 adapters must be an array");
  const adapters = new Map();
  for (const definition of definitions) {
    requireKeys(definition, ["feature", "owner", "modes", "applyControls"], "adapter");
    if (!BRIDGE_FEATURES.includes(definition.feature) || adapters.has(definition.feature)) throw new TypeError(`CP-F27 invalid or duplicate adapter: ${definition.feature}`);
    const owner = requireName(definition.owner, "adapter owner");
    if (owner === BRIDGE_OWNER) throw new Error("CP-F27 cannot own a lighting implementation");
    if (!Array.isArray(definition.modes) || !definition.modes.length || new Set(definition.modes).size !== definition.modes.length) throw new TypeError("CP-F27 adapter requires unique supported modes");
    const modes = Object.freeze(definition.modes.map((mode) => requireName(mode, "adapter mode")));
    if (definition.applyControls !== undefined && typeof definition.applyControls !== "function") throw new TypeError("CP-F27 applyControls must be a function");
    adapters.set(definition.feature, Object.freeze({ feature: definition.feature, owner, modes, applyControls: definition.applyControls }));
  }
  const registry = Object.freeze({ get: (feature) => adapters.get(feature), describe: () => [...adapters.values()].map(({ feature, owner, modes }) => ({ feature, owner, modes })) });
  registries.add(registry);
  return registry;
}

export function requireBridgeAdapters(registry) {
  if (!registries.has(registry)) throw new TypeError("CP-F27 requires a validated adapter registry");
  return registry;
}

export function requireFeatureAdapter(registry, feature, mode, owner) {
  const adapter = requireBridgeAdapters(registry).get(feature);
  if (!adapter) throw new Error(`CP-F27 BLOCKED_PROVIDER: ${feature}`);
  if (adapter.owner !== owner) throw new Error(`CP-F27 owner mismatch for ${feature}`);
  if (!adapter.modes.includes(mode)) throw new Error(`CP-F27 BLOCKED_MODE: ${feature}/${mode}; no substitute is permitted`);
  return adapter;
}
