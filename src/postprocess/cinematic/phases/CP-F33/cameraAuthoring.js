import { createRackFocusSequence } from "../CP-F03/focusSequence.js";
import { createWorldUnitAdapter } from "../CP-F03/worldUnits.js";
import { requireKeys, requireRecord, requireIdentifier, requireNumber, reject, validateDependency, translateAuto } from "./authoringData.js";

export const CAMERA_NUMBER_FIELDS = Object.freeze({
  sensorWidthMm: [0.1, 1000], sensorHeightMm: [0.1, 1000], focalLengthMm: [0.1, 10000], squeezeFactor: [1, 4], overscan: [1, 4],
  apertureFNumber: [0.1, 128], minApertureFNumber: [0.1, 128], bladeCount: [3, 32], bladeCurvature: [0, 1], bladeRotationDegrees: [-3600, 3600],
  shutterSeconds: [0, 3600], shutterAngleDegrees: [0, 360], captureFrameRate: [0.001, 100000], iso: [1, 10000000], focusDistanceMeters: [0, Number.MAX_VALUE], focusOffsetMeters: [-Number.MAX_VALUE, Number.MAX_VALUE]
});
export const CAMERA_CHOICE_FIELDS = Object.freeze({ gateFit: ["crop", "horizontal", "vertical"], shutterMode: ["seconds", "angle"], focusMode: ["manual", "tracking", "infinity", "rack"], focusInterpolation: ["linear", "smoothstep"] });

export function validateCameraSettings(input, path) {
  requireKeys(input, [...Object.keys(CAMERA_NUMBER_FIELDS), ...Object.keys(CAMERA_CHOICE_FIELDS), "enabled", "worldUnits", "trackingTargetWorld", "focusSequence", "cameraCutToken"], path);
  for (const [key, value] of Object.entries(input)) {
    if (value === null || value === "AUTO") continue;
    const location = `${path}.${key}`;
    if (Object.hasOwn(CAMERA_NUMBER_FIELDS, key)) {
      requireNumber(value, location, ...CAMERA_NUMBER_FIELDS[key]);
      if (key === "bladeCount" && !Number.isInteger(value)) reject("invalid-blade-count", location, "Blade count must be an integer");
    } else if (Object.hasOwn(CAMERA_CHOICE_FIELDS, key)) {
      if (!CAMERA_CHOICE_FIELDS[key].includes(value)) reject("invalid-camera-choice", location, "Unsupported camera choice");
    } else if (key === "enabled" && typeof value !== "boolean") reject("invalid-camera-flag", location, "Expected boolean, null or AUTO");
    else if (key === "worldUnits") {
      requireKeys(value, ["worldUnit", "metersPerStud"], location);
      validateDependency(location, () => createWorldUnitAdapter(value));
    } else if (key === "trackingTargetWorld" && (!Array.isArray(value) || value.length !== 3 || !value.every(Number.isFinite))) reject("invalid-camera-vector", location, "Expected three finite world coordinates");
    else if (key === "cameraCutToken" && !["string", "number"].includes(typeof value)) reject("invalid-cut-token", location, "Expected string, number, null or AUTO");
    else if (key === "focusSequence") {
      if (!Array.isArray(value) || value.length > 4096) reject("invalid-focus-sequence", location, "Expected at most 4096 focus keys");
      for (const [index, frame] of value.entries()) {
        requireKeys(frame, ["timeSeconds", "distanceMeters", "atInfinity"], `${location}.${index}`);
        if (Object.hasOwn(frame, "distanceMeters")) requireNumber(frame.distanceMeters, `${location}.${index}.distanceMeters`, Number.MIN_VALUE);
      }
      validateDependency(location, () => createRackFocusSequence(value, input.focusInterpolation == null || input.focusInterpolation === "AUTO" ? "smoothstep" : input.focusInterpolation));
    }
  }
  return input;
}
export function validateCameraAuthoring(input = {}) {
  requireKeys(input, ["global", "views"], "$.camera");
  const global = validateCameraSettings(input.global === undefined ? {} : input.global, "$.camera.global");
  const views = requireRecord(input.views === undefined ? {} : input.views, "$.camera.views");
  for (const [id, settings] of Object.entries(views)) { requireIdentifier(id, "$.camera.views"); validateCameraSettings(settings, `$.camera.views.${id}`); }
  for (const [id, settings] of [["global", global], ...Object.entries(views).map(([id, view]) => [id, { ...global, ...view }])]) {
    const resolved = translateAuto(settings);
    if (resolved.enabled !== false && resolved.focusMode === "rack" && !resolved.focusSequence) reject("missing-focus-sequence", `$.camera.${id}`, "Rack focus requires a sequence");
    if (resolved.enabled !== false && resolved.focusMode === "tracking" && !resolved.trackingTargetWorld) reject("missing-tracking-target", `$.camera.${id}`, "Tracking requires a host-world target");
  }
  return { global, views };
}
