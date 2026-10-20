import { dofSettingsSignature } from "./dofTemporalSettings.js";

export function snapshotDofCamera(camera) {
  if (!camera || typeof camera !== "object") throw new TypeError("CP-F20 requires physical camera metadata");
  const result = {};
  for (const key of ["focusDistanceMeters", "apertureFNumber", "focalLengthMm", "sensorWidthMm"]) {
    const value = camera[key];
    if (key === "focusDistanceMeters" && value === Infinity) { result[key] = value; continue; }
    if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) throw new TypeError(`Invalid CP-F20 camera ${key}`);
    result[key] = value;
  }
  for (const key of ["bladeCount", "squeezeFactor", "sensorHeightMm"]) result[key] = camera[key] ?? null;
  return Object.freeze(result);
}

export function resolveDofHistoryPolicy(previous, frame, settings, capture, temporalReasons = []) {
  const camera = snapshotDofCamera(frame.camera);
  const reasons = [...temporalReasons];
  if (!previous) reasons.push("first-frame-or-reset");
  if (!settings.enabled) reasons.push("disabled");
  if (settings.paused || frame.deltaSeconds === 0) reasons.push("pause");
  let cameraWeight = 1;
  if (previous) {
    if (previous.settingsSignature !== dofSettingsSignature(settings)) reasons.push("settings-change");
    if (previous.captureKey !== capture.key) reasons.push("capture-change");
    if (capture.sampleIndex != null && capture.sampleIndex !== previous.sampleIndex + 1) reasons.push("capture-discontinuity");
    if (previous.paused) reasons.push("resume");
    if (["focalLengthMm", "sensorWidthMm", "sensorHeightMm", "bladeCount", "squeezeFactor"].some((key) => previous.camera[key] !== camera[key])) reasons.push("lens-change");
    const focusChange = Math.abs(1 / camera.focusDistanceMeters - 1 / previous.camera.focusDistanceMeters);
    const apertureChange = Math.abs(2 * Math.log2(camera.apertureFNumber / previous.camera.apertureFNumber));
    cameraWeight = Math.max(0, 1 - Math.max(focusChange / settings.maximumFocusDeltaDiopters, apertureChange / settings.maximumApertureDeltaStops));
    if (cameraWeight === 0) reasons.push("focus-or-aperture-change");
  }
  const uniqueReasons = [...new Set(reasons)];
  return Object.freeze({ camera, cameraWeight, historyAllowed: uniqueReasons.length === 0, reasons: Object.freeze(uniqueReasons) });
}

export function createDofHistoryCheckpoint(session, colorSignature, colorPreExposure) {
  return Object.freeze({ camera: session.policy.camera, settingsSignature: dofSettingsSignature(session.settings), captureKey: session.capture.key, sampleIndex: session.capture.sampleIndex, paused: session.settings.paused || session.frame.deltaSeconds === 0, colorSignature, colorPreExposure });
}
