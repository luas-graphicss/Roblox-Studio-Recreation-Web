import { createBloomPyramidPlan } from "../CP-F14/bloomPyramidPlan.js";
import { validateSize } from "../../contracts/frameContract.js";
import { qualityProfile } from "./qualityProfiles.js";
import { createEffectiveSettings } from "./createEffectiveSettings.js";
import { configurationKey, finite, freeze, inherited, integer, MAXIMUM_BUDGET_BYTES } from "./qualityContract.js";
import { qualityOptions } from "./qualityOptions.js";

export function createQualityPlan({ settings, quality, profileId = quality.profile, capabilities, viewId,
  outputSize, globalBudgetBytes, pipelineRevision = "unversioned" }) {
  const profile = qualityProfile(profileId);
  validateSize(outputSize, "quality output");
  integer(globalBudgetBytes, "global budget", 1, MAXIMUM_BUDGET_BYTES);
  if (!capabilities.supported) throw new Error(`CP-F31 unsupported: ${capabilities.blockers.join("; ")}`);
  if (outputSize.width > capabilities.maxTextureSize || outputSize.height > capabilities.maxTextureSize)
    throw new RangeError("Output extent exceeds the verified texture limit");
  const temporal = settings.get("CP-F21");
  const enabled = inherited(temporal?.enabled) ? true : temporal.enabled;
  const temporalPermitted = enabled === true && profile.temporalEnabled && capabilities.temporal;
  const upscalePermitted = capabilities.upscaling === "explicit-host-spatial" || temporalPermitted;
  const authoredPercentage = temporal?.screenPercentage;
  if (!inherited(authoredPercentage)) finite(authoredPercentage, "screenPercentage", 25, 100);
  const requestedPercentage = Math.min(profile.screenPercentage, inherited(authoredPercentage) ? 100 : authoredPercentage);
  const screenPercentage = upscalePermitted && temporal?.mode !== "taa" ? requestedPercentage : 100;
  const renderSize = { width: Math.max(1, Math.round(outputSize.width * screenPercentage / 100)),
    height: Math.max(1, Math.round(outputSize.height * screenPercentage / 100)) };
  const budgetBytes = Math.min(quality.budgetBytes ?? profile.budgetBytes, profile.budgetBytes, globalBudgetBytes);
  const effective = createEffectiveSettings({ store: settings, profile, capabilities, viewId, screenPercentage, budgetBytes });
  const bloomPlan = capabilities.installedPhases.includes("CP-F14")
    ? createBloomPyramidPlan(renderSize.width, renderSize.height, effective.settings.get("CP-F14")) : null;
  const policy = {
    bloom: { enabled: effective.settings.get("CP-F14").enabled, bands: effective.settings.get("CP-F14").bands },
    convolution: { enabled: effective.settings.get("CP-F15").enabled, operations: effective.settings.get("CP-F15").maxSampleOperations },
    dof: { radius: effective.settings.get("CP-F19").maxRadiusPixels, enabled: effective.settings.get("CP-F19").enabled },
    dofHistory: { scale: effective.settings.get("CP-F20").workingScale, samples: effective.settings.get("CP-F20").maximumSamples, enabled: effective.settings.get("CP-F20").enabled },
    temporal: { enabled: effective.settings.get("CP-F21").enabled, filter: effective.settings.get("CP-F21").historyFilter, weight: effective.settings.get("CP-F21").historyWeight },
    motion: { enabled: effective.settings.get("CP-F22").enabled, samples: effective.settings.get("CP-F22").sampleCount }
  };
  const sourceRevision = settings.revision?.();
  integer(sourceRevision, "authored settings revision");
  const key = configurationKey({ version: "quality-budget-v1", profileId, renderSize, outputSize, budgetBytes,
    policy, capabilities, sourceRevision, pipelineRevision });
  return Object.freeze({ profileId, requestedProfileId: quality.profile, renderSize: freeze(renderSize), outputSize: freeze({ ...outputSize }),
    screenPercentage, budgetBytes, configurationKey: key, pipelineRevision, sourceRevision,
    effectiveSettings: effective.settings, policy: freeze(policy),
    options: qualityOptions({ ...profile, budgetBytes }, effective.settings, capabilities, renderSize, outputSize),
    estimatedBloomBytes: bloomPlan?.estimatedBytes ?? 0, estimatedBloomDraws: bloomPlan?.drawCount ?? 0,
    estimateCoverage: "real CP-F14 plan only; all other actual pool allocations remain hard-capped",
    adaptiveAvailable: capabilities.timerQuery && quality.adaptive,
    adaptiveReason: !quality.adaptive ? "manual" : capabilities.timerQuery ? "awaiting-qualified-gpu-samples" : "timer-query-unavailable",
    referenceStatus: "BLOCKED_REFERENCE" });
}
