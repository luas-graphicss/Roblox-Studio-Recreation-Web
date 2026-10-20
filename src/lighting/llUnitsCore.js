import {
  lightLumens,
  localLightCandela,
  lumensToCandela,
  candelaToLumens,
  luxFromEv100,
  ev100FromLux,
} from "./photometryCore.js";

export const INTENSITY_UNITS = Object.freeze({
  UNITLESS: "unitless",
  LUMENS: "lumens",
  CANDELA: "candela",
  EV: "ev",
});

export const INTENSITY_UNITS_LIST = Object.freeze([
  INTENSITY_UNITS.UNITLESS,
  INTENSITY_UNITS.LUMENS,
  INTENSITY_UNITS.CANDELA,
  INTENSITY_UNITS.EV,
]);

export const DEFAULT_INTENSITY_UNITS = INTENSITY_UNITS.UNITLESS;


export const INTENSITY_SOURCES = Object.freeze({
  IES_BRIGHTNESS: "iesBrightness",
  INTENSITY_VALUE: "intensityValue",
  LIGHT_PRESET: "lightPreset",
  LEGACY_BRIGHTNESS: "legacyBrightness",
});


export const EV100_REFERENCE_DISTANCE_M = 1;


export const INTENSITY_LIMITS = Object.freeze({
  lumens: Object.freeze({ min: 0, max: 1e6, fallback: 0 }),
  candela: Object.freeze({ min: 0, max: 1e6, fallback: 0 }),
  ev: Object.freeze({ min: -20, max: 30, fallback: 0 }),
});

const SPHERICAL_LIGHT_KIND = "PointLight";
const SPHERE_HALF_ANGLE_DEG = 180;
const CONE_ANGLE_MIN_DEG = 1;
const CONE_ANGLE_MAX_DEG = 179;
const CONE_ANGLE_DEFAULT_DEG = 90;
const CONE_HALF_ANGLE_MIN_DEG = 0.5;

function asObject(value) {
  return value && typeof value === "object" ? value : {};
}

function finiteOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampFinite(value, min, max, fallback) {
  const parsed = finiteOr(value, fallback);
  return parsed < min ? min : parsed > max ? max : parsed;
}

function positiveOrZero(value) {
  return Math.max(finiteOr(value, 0), 0);
}

export function resolveIntensityUnits(rawUnits) {
  const units = typeof rawUnits === "string" ? rawUnits.trim().toLowerCase() : "";
  return INTENSITY_UNITS_LIST.indexOf(units) === -1 ? DEFAULT_INTENSITY_UNITS : units;
}

export function isAbsoluteIntensityUnit(rawUnits) {
  return resolveIntensityUnits(rawUnits) !== INTENSITY_UNITS.UNITLESS;
}


export function apertureHalfAngleDeg(light) {
  const source = asObject(light);
  if (source.kind === SPHERICAL_LIGHT_KIND) return SPHERE_HALF_ANGLE_DEG;
  const angleDeg = clampFinite(source.angleDeg, CONE_ANGLE_MIN_DEG, CONE_ANGLE_MAX_DEG, CONE_ANGLE_DEFAULT_DEG);
  return Math.max(angleDeg / 2, CONE_HALF_ANGLE_MIN_DEG);
}


export function apertureSteradians(light) {
  return candelaToLumens(1, apertureHalfAngleDeg(light));
}

export function candelaFromLumens(input) {
  const request = asObject(input);
  return lumensToCandela(request.lumens, apertureHalfAngleDeg(request));
}

export function lumensFromCandela(input) {
  const request = asObject(input);
  return candelaToLumens(request.candela, apertureHalfAngleDeg(request));
}


export function candelaFromEv100(ev100) {
  return luxFromEv100(ev100);
}

export function ev100FromCandela(candela) {
  return ev100FromLux(candela);
}

export function clampIntensityValue(value, rawUnits) {
  const limits = INTENSITY_LIMITS[resolveIntensityUnits(rawUnits)];
  if (!limits) return positiveOrZero(value);
  return clampFinite(value, limits.min, limits.max, limits.fallback);
}


export function candelaForAbsoluteIntensity(input) {
  const request = asObject(input);
  const units = resolveIntensityUnits(request.units);
  if (units === INTENSITY_UNITS.UNITLESS) return null;
  const value = clampIntensityValue(request.value, units);
  if (units === INTENSITY_UNITS.CANDELA) return value;
  if (units === INTENSITY_UNITS.EV) return candelaFromEv100(value);
  return candelaFromLumens({ lumens: value, kind: request.kind, angleDeg: request.angleDeg });
}


export function legacyLocalLightCandela(input) {
  const request = asObject(input);
  const presetLumens = positiveOrZero(request.presetLumens);
  const lumens = presetLumens > 0 ? presetLumens : lightLumens(finiteOr(request.brightness, 1));
  return localLightCandela({ kind: request.kind, lumens, angleDeg: request.angleDeg });
}


export function resolveLocalLightIntensity(input) {
  const request = asObject(input);
  const kind = request.kind;
  const angleDeg = request.angleDeg;
  const units = resolveIntensityUnits(request.intensityUnits);
  const iesBrightness = asObject(request.iesBrightness);
  const presetLumens = positiveOrZero(request.presetLumens);
  const absoluteCandela = candelaForAbsoluteIntensity({
    units,
    value: request.intensity,
    kind,
    angleDeg,
  });

  let candela;
  let source;
  if (iesBrightness.enabled === true) {
    candela = positiveOrZero(iesBrightness.candela);
    source = INTENSITY_SOURCES.IES_BRIGHTNESS;
  } else if (absoluteCandela !== null) {
    candela = absoluteCandela;
    source = INTENSITY_SOURCES.INTENSITY_VALUE;
  } else {
    candela = legacyLocalLightCandela({ brightness: request.brightness, presetLumens, kind, angleDeg });
    source = presetLumens > 0 ? INTENSITY_SOURCES.LIGHT_PRESET : INTENSITY_SOURCES.LEGACY_BRIGHTNESS;
  }

  return Object.freeze({
    units,
    source,
    candela,
    lumens: lumensFromCandela({ candela, kind, angleDeg }),
    ev100: ev100FromCandela(candela),
    halfAngleDeg: apertureHalfAngleDeg({ kind, angleDeg }),
    apertureSr: apertureSteradians({ kind, angleDeg }),
  });
}
