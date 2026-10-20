export function createSubstrateFeatureFlags(readOverrides = () => ({})) {
  const definitions = new Map();
  const overrides = new Map();
  function flagState(id, tier) {
    const definition = definitions.get(id);
    const external = readOverrides() || {};
    const local = overrides.get(id);
    const value = local === false ? false : Object.hasOwn(external, id) && external[id] != null ? external[id] : local;
    const knownTier = ['fraco', 'medio', 'forte'].includes(tier);
    const enabled = !!definition && knownTier && (value === false ? false : value === true ? true : definition.defaultsByTier?.[tier] === true);
    return { id, known: !!definition, on: enabled, override: value ?? null, owner: definition?.owner, mode: value === true ? 'forced' : value === false ? 'vetoed' : 'auto' };
  }
  const api = {
    registerFlag(definition) { if (!definitions.has(definition.id)) definitions.set(definition.id, definition); return definitions.get(definition.id); },
    flagState,
    isFlagActive: (id, tier) => flagState(id, tier).on,
    setFlag(id, value) { if (!definitions.has(id)) return null; if (value == null) overrides.delete(id); else if (typeof value === 'boolean') overrides.set(id, value); else return null; return id; },
    listFlags: tier => [...definitions.keys()].sort().map(id => flagState(id, tier)),
  };
  api.registerFlag({ id: 'SubstrateEnabled', owner: 'engine', defaultsByTier: { fraco: false, medio: true, forte: true } });
  return api;
}
