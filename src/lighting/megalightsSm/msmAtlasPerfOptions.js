export const MSM_ATLAS_PERF_PHASE_ID = "MSM-O1";


export const MSM_ATLAS_PERF_OPTION_KEYS = Object.freeze([
  "persistentPageCache",
  "rotatedPageBudget",
]);


export const MSM_ATLAS_PERF_ALL_DISABLED = Object.freeze({
  persistentPageCache: false,
  rotatedPageBudget: false,
});


export const MSM_ATLAS_PERF_DEFAULTS = Object.freeze({
  persistentPageCache: true,
  rotatedPageBudget: false,
});


export function resolveMsmAtlasPerfOptions(options) {
  const requested = options && typeof options === "object" ? options : null;
  if (requested === null) return MSM_ATLAS_PERF_DEFAULTS;

  const resolved = {};
  MSM_ATLAS_PERF_OPTION_KEYS.forEach((optionKey) => {
    const value = requested[optionKey];
    resolved[optionKey] =
      value === undefined || value === null
        ? MSM_ATLAS_PERF_DEFAULTS[optionKey]
        : value === true;
  });
  return Object.freeze(resolved);
}


export function isAnyMsmAtlasPerfOptionEnabled(options) {
  const resolved = resolveMsmAtlasPerfOptions(options);
  return MSM_ATLAS_PERF_OPTION_KEYS.some((optionKey) => resolved[optionKey] === true);
}
