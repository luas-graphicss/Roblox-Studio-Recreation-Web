import { createColorTransportPlan } from "./colorTransportPlan.js";
import { resolveHdrFormatPolicy } from "./hdrFormatPolicy.js";
import { preExposureRatio, requirePreExposure } from "./preExposure.js";

const allowedSettings = new Set(["sourceSpace", "workingSpace", "sourceTransfer", "samplerDecoded", "sourcePreExposure", "negativePolicy", "format", "fallback"]);

export function createColorState(frame, settings, capabilities, previousState = null) {
  if (!frame) throw new TypeError("A frame is required");
  const configuration = settings === undefined || settings === null ? {} : settings;
  if (typeof configuration !== "object" || Array.isArray(configuration)) throw new TypeError("CP-F04 settings must be an object or AUTO/null");
  for (const key of Object.keys(configuration)) if (!allowedSettings.has(key)) throw new TypeError(`Unknown CP-F04 setting: ${key}`);
  const currentPreExposure = requirePreExposure(frame.preExposure);
  const previousPreExposure = requirePreExposure(frame.previousPreExposure, "previousPreExposure");
  const formatPolicy = resolveHdrFormatPolicy(capabilities, { format: configuration.format ?? "rgba16f", fallback: configuration.fallback ?? "blocked", referenceMode: frame.referenceMode === true });
  const plan = createColorTransportPlan({ ...configuration, sourcePreExposure: configuration.sourcePreExposure ?? currentPreExposure, destinationPreExposure: currentPreExposure, formatPolicy });
  const workingSignature = JSON.stringify([plan.destination.signature, plan.negativePolicy, formatPolicy.format]);
  let invalidationReason = null;
  if (frame.cameraCut) invalidationReason = "camera-cut";
  else if (!previousState) invalidationReason = "missing-or-stale-history";
  else if (previousState.workingSignature !== workingSignature) invalidationReason = "working-space-or-policy-change";
  else if (previousState.currentPreExposure !== previousPreExposure) invalidationReason = "previous-pre-exposure-mismatch";
  return Object.freeze({ phase: "CP-F04", frameId: frame.frameId, viewId: frame.viewId, generation: frame.generation, plan, workingSignature, currentPreExposure, previousPreExposure, historyToCurrentScale: preExposureRatio(previousPreExposure, currentPreExposure), meteringScale: preExposureRatio(currentPreExposure, 1), emissiveScale: currentPreExposure, historyValid: invalidationReason === null, invalidationReason, negativePolicy: plan.negativePolicy, precision: formatPolicy.precision, referenceCertified: false });
}
