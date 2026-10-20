import { requireLocalExposureNumber, sampleContrastCurve } from "./localExposureSettings.js";

export function normalizeLocalExposureBindings(options = {}) {
  const defaults = { colorResource: "$color", velocityResource: "sceneVelocity", exposureResource: null, meteringResource: null, maxViews: 2 };
  for (const name of Object.keys(options)) if (!Object.hasOwn(defaults, name)) throw new TypeError(`Unknown CP-F10 binding: ${name}`);
  const bindings = { ...defaults, ...options };
  for (const name of ["colorResource", "velocityResource", "exposureResource", "meteringResource"]) {
    const value = bindings[name];
    if (value === null && (name === "exposureResource" || name === "meteringResource")) continue;
    if (typeof value !== "string" || value.length === 0 || value.startsWith("CP-F10.") || (value === "$color" && name !== "colorResource")) throw new TypeError(`Invalid CP-F10 ${name}`);
  }
  if (!Number.isInteger(bindings.maxViews) || bindings.maxViews < 1 || bindings.maxViews > 8) throw new TypeError("CP-F10 maxViews must be 1..8");
  return Object.freeze(bindings);
}

export function resolveLocalExposurePreExposure(source) {
  return requireLocalExposureNumber(source.preExposure === undefined ? 1 : source.preExposure, "source preExposure", 2 ** -24, 2 ** 24);
}

export function validateLocalExposureTextures(color, velocity, frame, capabilities) {
  if (!color?.texture || color.format !== "rgba16f" || color.encoding !== "scene-linear-rec709" || color.origin !== "bottom-left") throw new TypeError("CP-F10 requires bottom-left scene-linear Rec.709 RGBA16F color before glare");
  if (!velocity?.texture || velocity.encoding !== "uv-current-minus-previous" || velocity.format !== "rgba16f" || velocity.origin !== "bottom-left") throw new TypeError("CP-F10 requires RGBA16F unjittered UV velocity with alpha validity");
  for (const resource of [color, velocity]) {
    if (resource.width !== color.width || resource.height !== color.height) throw new Error("CP-F10 color and velocity extents must match explicitly");
    if (!Number.isInteger(resource.width) || !Number.isInteger(resource.height) || resource.width < 1 || resource.height < 1 || resource.width > capabilities.maxTextureSize || resource.height > capabilities.maxTextureSize) throw new Error("CP-F10 input extent exceeds device capabilities");
  }
  resolveLocalExposurePreExposure(color);
  if (color.transfer !== undefined && color.transfer !== "linear") throw new TypeError("CP-F10 requires linear source transfer");
  requireLocalExposureNumber(frame.preExposure, "preExposure", 2 ** -24, 2 ** 24);
  for (const jitter of [frame.jitterPixels, frame.previousJitterPixels]) {
    if (!Array.isArray(jitter) || jitter.length !== 2 || !jitter.every(Number.isFinite)) throw new TypeError("CP-F10 requires explicit finite two-component jitter");
  }
}

export function resolveLocalExposureControls(settings, exposure, metering) {
  let exposureOffsetStops = settings.exposureOffsetStops;
  let middleGray = settings.middleGray;
  if (exposure !== null) {
    exposureOffsetStops = requireLocalExposureNumber(exposure?.value?.exposureOffsetStops, "bound exposureOffsetStops", -24, 24);
    if (exposure.value.middleGray !== undefined) middleGray = requireLocalExposureNumber(exposure.value.middleGray, "bound middleGray", 0.0001, 1);
  }
  const hasCurves = Boolean(settings.highlightContrastCurve || settings.shadowContrastCurve);
  const meteredStops = metering === null ? null : requireLocalExposureNumber(metering?.value?.sceneLogLuminanceStops, "bound sceneLogLuminanceStops", -40, 40);
  if (hasCurves && meteredStops === null) throw new Error("CP-F10 contrast curves require a declared metering resource; manual settings cannot fake metering");
  return Object.freeze({ ...settings, exposureOffsetStops, middleGray,
    highlightContrast: sampleContrastCurve(settings.highlightContrastCurve, meteredStops, settings.highlightContrast),
    shadowContrast: sampleContrastCurve(settings.shadowContrastCurve, meteredStops, settings.shadowContrast)
  });
}
