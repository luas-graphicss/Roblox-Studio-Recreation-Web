import { ADAPTIVE_PROFILES, qualityProfile } from "./qualityProfiles.js";
import { finite, freeze, inherited, integer, MAXIMUM_BUDGET_BYTES, record } from "./qualityContract.js";

const defaults = freeze({ profile: "high", adaptive: false, minimumProfile: "low", budgetBytes: null,
  targetGpuMs: null, warmupSamples: 120, windowSamples: 30, pressureWindows: 3, recoveryWindows: 6,
  cooldownSamples: 120, downRatio: 1.15, upRatio: 0.7, maximumFrameGap: 8 });

export function resolveQualitySettings(input, parent = defaults) {
  const result = { ...parent };
  if (!inherited(input)) {
    record(input, "CP-F31 settings");
    for (const [key, value] of Object.entries(input)) {
      if (!Object.hasOwn(defaults, key)) throw new TypeError(`Unknown CP-F31 setting: ${key}`);
      if (!inherited(value)) result[key] = value;
    }
  }
  qualityProfile(result.profile);
  if (!ADAPTIVE_PROFILES.includes(result.minimumProfile)) throw new RangeError("Invalid minimumProfile");
  if (typeof result.adaptive !== "boolean") throw new TypeError("adaptive must be boolean");
  if (result.budgetBytes !== null) integer(result.budgetBytes, "budgetBytes", 1, MAXIMUM_BUDGET_BYTES);
  if (result.targetGpuMs !== null) finite(result.targetGpuMs, "targetGpuMs", 0.01, 1000);
  for (const name of ["warmupSamples", "cooldownSamples"]) integer(result[name], name, 0, 100000);
  for (const name of ["windowSamples", "pressureWindows", "recoveryWindows", "maximumFrameGap"]) integer(result[name], name, 1, 1000);
  finite(result.downRatio, "downRatio", 1.01, 4);
  finite(result.upRatio, "upRatio", 0.01, 0.99);
  if (result.adaptive && !ADAPTIVE_PROFILES.includes(result.profile))
    throw new RangeError("Diagnostic and cinematic profiles cannot run the realtime governor");
  if (result.adaptive && ADAPTIVE_PROFILES.indexOf(result.minimumProfile) > ADAPTIVE_PROFILES.indexOf(result.profile))
    throw new RangeError("minimumProfile exceeds the requested profile");
  return freeze(result);
}

export function readQualitySettings(store, viewId) {
  if (typeof store?.get !== "function") throw new TypeError("A settings store is required");
  return resolveQualitySettings(store.get(`CP-F31.${viewId}`), resolveQualitySettings(store.get("CP-F31")));
}
