import { inheritedValue, plainRecord } from "./cameraValidation.js";
import { resolveLensProjection } from "./lensProjection.js";
import { resolveAperture } from "./apertureModel.js";
import { resolveShutter } from "./shutterModel.js";
import { resolveFocus } from "./focusModel.js";
import { createWorldUnitAdapter } from "./worldUnits.js";

const CAMERA_SETTING_NAMES = new Set([
  "enabled", "worldUnits", "sensorWidthMm", "sensorHeightMm", "focalLengthMm", "squeezeFactor", "overscan", "gateFit",
  "apertureFNumber", "minApertureFNumber", "bladeCount", "bladeCurvature", "bladeRotationDegrees",
  "shutterMode", "shutterSeconds", "shutterAngleDegrees", "captureFrameRate", "iso",
  "focusMode", "focusDistanceMeters", "focusOffsetMeters", "trackingTargetWorld", "focusSequence", "focusInterpolation", "cameraCutToken"
]);

export function resolvePhysicalCameraState(configuration, baseline, frame, rackSequence = null) {
  plainRecord(configuration, "CP-F03.camera settings");
  for (const name of Object.keys(configuration)) if (!CAMERA_SETTING_NAMES.has(name)) throw new TypeError(`Unknown camera setting: ${name}`);
  const value = (name, fallback) => inheritedValue(configuration[name], fallback);
  const enabled = value("enabled", true);
  if (typeof enabled !== "boolean") throw new TypeError("Camera enabled must be boolean or null/AUTO");
  const units = createWorldUnitAdapter(value("worldUnits", baseline.worldUnits));
  const frameCamera = frame.camera ?? {};
  const lens = resolveLensProjection({
    sensorWidthMm: value("sensorWidthMm", baseline.sensorWidthMm),
    sensorHeightMm: value("sensorHeightMm", baseline.sensorHeightMm),
    focalLengthMm: value("focalLengthMm", baseline.focalLengthMm),
    squeezeFactor: value("squeezeFactor", 1),
    overscan: value("overscan", baseline.overscan),
    gateFit: value("gateFit", "vertical")
  }, frame.renderSize);
  const aperture = resolveAperture({
    apertureFNumber: value("apertureFNumber", frameCamera.apertureFNumber ?? 2.8),
    minApertureFNumber: value("minApertureFNumber", frameCamera.minApertureFNumber ?? 1.4),
    bladeCount: value("bladeCount", frameCamera.bladeCount ?? 7),
    bladeCurvature: value("bladeCurvature", 0),
    bladeRotationDegrees: value("bladeRotationDegrees", 0)
  }, lens.focalLengthMm);
  const shutter = resolveShutter({
    shutterMode: value("shutterMode", "seconds"),
    shutterSeconds: value("shutterSeconds", frameCamera.shutterSeconds ?? 1 / 120),
    shutterAngleDegrees: value("shutterAngleDegrees", frameCamera.shutterAngleDegrees ?? 180),
    captureFrameRate: value("captureFrameRate", 24),
    iso: value("iso", frameCamera.iso ?? 100)
  }, aperture.fNumber);
  const focusMode = value("focusMode", "manual");
  if (focusMode === "rack" && !rackSequence) throw new Error("Rack focus requires a validated focusSequence");
  const focus = resolveFocus({
    mode: focusMode,
    distanceMeters: value("focusDistanceMeters", frameCamera.focusDistanceMeters ?? 6),
    offsetMeters: value("focusOffsetMeters", 0),
    trackingTargetWorld: value("trackingTargetWorld", null),
    rackDiopters: rackSequence?.sample(frame.timeSeconds)
  }, { positionWorld: baseline.positionWorld, forwardWorld: baseline.forwardWorld, units, nearMeters: units.toMeters(baseline.nearWorld), focalLengthMm: lens.focalLengthMm });
  const cameraCutToken = value("cameraCutToken", null);
  if (cameraCutToken !== null && typeof cameraCutToken !== "string" && !(typeof cameraCutToken === "number" && Number.isFinite(cameraCutToken))) throw new TypeError("cameraCutToken must be a string, finite number or null");
  return Object.freeze({
    enabled,
    lens,
    aperture,
    focus,
    shutter,
    cameraCutToken,
    nearMeters: units.toMeters(baseline.nearWorld),
    farMeters: units.toMeters(baseline.farWorld),
    units: Object.freeze({ worldUnit: units.worldUnit, metersPerWorldUnit: units.metersPerWorldUnit, metersPerStud: units.metersPerStud ?? null }),
    source: "authored-physical-camera-model",
    referenceVerified: false
  });
}
