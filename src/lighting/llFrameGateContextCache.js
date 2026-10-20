export const MAX_CACHED_GATE_CONTEXTS = 8;

function asReader(candidate, fallbackValue) {
  return typeof candidate === "function" ? candidate : () => fallbackValue;
}


export function createLocalLightGateContextCache(options) {
  const settings = options && typeof options === "object" ? options : {};
  const readWeakGpu = asReader(settings.readWeakGpu, false);
  const readEngineTier = asReader(settings.readEngineTier, "");
  if (typeof settings.resolveTier !== "function") {
    throw new TypeError("createLocalLightGateContextCache requires a resolveTier function");
  }
  const resolveTier = settings.resolveTier;

  const contextByTechnology = new Map();
  let cachedTier = "";
  let hasCachedTier = false;
  let cachedWeakGpu = false;
  let cachedEngineTier = null;
  let tierRebuildCount = 0;
  let contextRebuildCount = 0;


  function currentTier() {
    const weakGpu = readWeakGpu() === true;
    const engineTier = readEngineTier();
    if (hasCachedTier && weakGpu === cachedWeakGpu && engineTier === cachedEngineTier) {
      return cachedTier;
    }
    cachedWeakGpu = weakGpu;
    cachedEngineTier = engineTier;
    cachedTier = resolveTier({ weakGpu: weakGpu, tier: engineTier });
    hasCachedTier = true;
    tierRebuildCount += 1;


    contextByTechnology.clear();
    return cachedTier;
  }


  function contextForTechnology(technology) {
    const tier = currentTier();
    const cached = contextByTechnology.get(technology);
    if (cached) return cached;
    if (contextByTechnology.size >= MAX_CACHED_GATE_CONTEXTS) contextByTechnology.clear();
    const context = Object.freeze({ tier: tier, technology: technology });
    contextByTechnology.set(technology, context);
    contextRebuildCount += 1;
    return context;
  }


  function telemetry() {
    return {
      tier: currentTier(),
      tierRebuildCount: tierRebuildCount,
      contextRebuildCount: contextRebuildCount,
      cachedContextCount: contextByTechnology.size,
    };
  }

  return {
    tier: currentTier,
    contextFor: contextForTechnology,
    telemetry: telemetry,
  };
}
