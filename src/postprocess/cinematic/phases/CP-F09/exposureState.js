import { adaptExposureEv } from "./adaptExposureEv.js";
import { evaluateCompensationCurve } from "./compensationCurve.js";
import { exposureEvFromMultiplier, exposureMultiplierFromEv, physicalCameraEv100 } from "./physicalExposure.js";
import { clampExposureValue, requireExposureNumber } from "./exposureValidation.js";

export function resolveExposureTarget(settings, meteredEv100, camera) {
  let mode = settings.mode;
  let sourceEv100;
  if (settings.editorEv100 !== null) {
    mode = "editor";
    sourceEv100 = settings.editorEv100;
  } else if (settings.mode === "manual") {
    sourceEv100 = settings.manualEv100 ?? physicalCameraEv100(camera);
  } else {
    sourceEv100 = requireExposureNumber(meteredEv100, "metered EV100", -64, 64);
  }
  const compensationStops = settings.compensationStops + evaluateCompensationCurve(settings.compensationCurve, sourceEv100);
  const constrainedEv100 = mode === "auto" ? clampExposureValue(sourceEv100, settings.minEv100, settings.maxEv100) : sourceEv100;
  return Object.freeze({ mode, sourceEv100, targetEv100: constrainedEv100 - compensationStops, compensationStops });
}

export function stepExposureState({ settings, previous = null, meteredEv100, camera, deltaSeconds, preExposure = 1 }) {
  requireExposureNumber(deltaSeconds, "deltaSeconds", 0);
  const target = resolveExposureTarget(settings, meteredEv100, camera);
  const previousActual = previous ? exposureEvFromMultiplier(previous.exposureMultiplier, settings.exposureScale) : target.targetEv100;
  let actualEv100 = previousActual;
  if (!previous && settings.frozen) actualEv100 = exposureEvFromMultiplier(preExposure, settings.exposureScale);
  else if (!settings.frozen && (!previous || target.mode !== "auto")) actualEv100 = target.targetEv100;
  else if (!settings.frozen) actualEv100 = adaptExposureEv({ ...settings, actualEv100: previousActual, targetEv100: target.targetEv100, deltaSeconds });
  const exposureMultiplier = settings.frozen && previous ? previous.exposureMultiplier : exposureMultiplierFromEv(actualEv100, settings.exposureScale);
  return Object.freeze({ ...target, actualEv100, exposureMultiplier, nextPreExposure: exposureMultiplier });
}
