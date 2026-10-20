import { freeze, MEBIBYTE } from "./qualityContract.js";

export const QUALITY_PROFILES = freeze([
  { id: "diagnostic", screenPercentage: 100, budgetBytes: 64 * MEBIBYTE, targetGpuMs: 4,
    bloomBands: 1, bloomEnabled: false, convolutionEnabled: false, convolutionOperations: 1048576,
    dofEnabled: false, dofRadius: 0, dofVisits: 1000000, dofWorkingScale: 4, historySamples: 1,
    temporalEnabled: false, historyWeight: 0, historyFilter: "bilinear", motionEnabled: false, motionSamples: 4,
    reason: "Native-resolution diagnosis without optional optical or temporal effects" },
  { id: "low", screenPercentage: 200 / 3, budgetBytes: 64 * MEBIBYTE, targetGpuMs: 2.5,
    bloomBands: 2, bloomEnabled: true, convolutionEnabled: false, convolutionOperations: 16777216,
    dofEnabled: false, dofRadius: 4, dofVisits: 25000000, dofWorkingScale: 4, historySamples: 8,
    temporalEnabled: true, historyWeight: 0.8, historyFilter: "bilinear", motionEnabled: true, motionSamples: 8,
    reason: "Bound bandwidth and sampling for a low-cost realtime path" },
  { id: "medium", screenPercentage: 75, budgetBytes: 128 * MEBIBYTE, targetGpuMs: 3,
    bloomBands: 4, bloomEnabled: true, convolutionEnabled: false, convolutionOperations: 67108864,
    dofEnabled: true, dofRadius: 8, dofVisits: 100000000, dofWorkingScale: 2, historySamples: 32,
    temporalEnabled: true, historyWeight: 0.85, historyFilter: "bilinear", motionEnabled: true, motionSamples: 16,
    reason: "Balance reconstruction detail against intermediate storage and tap count" },
  { id: "high", screenPercentage: 100, budgetBytes: 256 * MEBIBYTE, targetGpuMs: 4,
    bloomBands: 6, bloomEnabled: true, convolutionEnabled: false, convolutionOperations: 268435456,
    dofEnabled: true, dofRadius: 16, dofVisits: 1000000000, dofWorkingScale: 2, historySamples: 64,
    temporalEnabled: true, historyWeight: 0.9, historyFilter: "catmull-rom", motionEnabled: true, motionSamples: 24,
    reason: "Native rendering with broad standard bloom and stable temporal history" },
  { id: "cinematic", screenPercentage: 100, budgetBytes: 1024 * MEBIBYTE, targetGpuMs: null,
    bloomBands: 6, bloomEnabled: true, convolutionEnabled: true, convolutionOperations: 1073741824,
    dofEnabled: true, dofRadius: 24, dofVisits: 2000000000, dofWorkingScale: 1, historySamples: 128,
    temporalEnabled: true, historyWeight: 0.95, historyFilter: "catmull-rom", motionEnabled: true, motionSamples: 48,
    reason: "Offline-quality ceilings; no realtime performance promise or reference certificate" }
]);

export const ADAPTIVE_PROFILES = Object.freeze(["low", "medium", "high"]);

export function qualityProfile(id) {
  const profile = QUALITY_PROFILES.find((entry) => entry.id === id);
  if (!profile) throw new RangeError(`Unknown quality profile: ${id}`);
  return profile;
}
