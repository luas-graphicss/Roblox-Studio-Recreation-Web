import { lightBasis } from "./csmCore.js";


export const SUN_VIEW_FIT_MIN_HALF = 24;


export const SUN_VIEW_FIT_COVERAGE_FLOOR = 96;


export const SUN_VIEW_FIT_HALF_STEP = 2;

export const SUN_VIEW_FIT_DEPTH_STEP = 16;

export const SUN_VIEW_FIT_MARGIN = 1.08;

export const SUN_VIEW_FIT_DISTANCE_STEP = 8;


export const SUN_VIEW_FIT_BIAS_TEXELS = 0.35;
export const SUN_VIEW_FIT_BIAS_FLOOR = 0.02;
export const SUN_VIEW_FIT_BIAS_CAP = 0.6;

export const DEFAULT_FIELD_OF_VIEW_Y_DEG = 70;
export const DEFAULT_ASPECT = 16 / 9;
export const MIN_MAP_SIZE = 64;
export const MAX_MAP_SIZE = 8192;

function toFiniteNumber(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function clampToRange(value, min, max) {
  return value < min ? min : value > max ? max : value;
}


function isUsablePoint(point) {
  if (!Array.isArray(point)) return false;
  for (let axis = 0; axis < 3; axis++) {
    if (!Number.isFinite(Number(point[axis]))) return false;
  }
  return true;
}

const UNUSABLE_FIT = Object.freeze({
  usable: false,
  center: Object.freeze([0, 0, 0]),
  half: 0,
  texel: 0,
  normalBias: SUN_VIEW_FIT_BIAS_FLOOR,
  signature: "",
  visibleRadius: 0,
  focusDistance: 0,
  reason: "camera view not usable -- the classic scene window stays in charge",
});


export function visibleRadiusAtFocus(options = {}) {
  const source = options && typeof options === "object" ? options : {};
  const focusDistance = Math.max(0, toFiniteNumber(source.distance, 0));
  const fieldOfViewYDeg = clampToRange(
    toFiniteNumber(source.fieldOfViewYDeg, DEFAULT_FIELD_OF_VIEW_Y_DEG),
    5,
    140,
  );
  const aspect = clampToRange(toFiniteNumber(source.aspect, DEFAULT_ASPECT), 0.1, 8);
  const halfHeight = focusDistance * Math.tan(((fieldOfViewYDeg * Math.PI) / 180) / 2);
  return Math.hypot(halfHeight, halfHeight * aspect) * SUN_VIEW_FIT_MARGIN;
}


export function sunViewFitDistanceQuantum(distance) {
  const value = Number(distance);
  if (!Number.isFinite(value)) return 0;
  return Math.round(Math.max(0, value) / SUN_VIEW_FIT_DISTANCE_STEP);
}


export function fitSunShadowToCameraView(options = {}) {
  const source = options && typeof options === "object" ? options : {};
  const cameraPosition = source.cameraPosition;
  const focusPoint = source.focusPoint;
  const maxHalf = toFiniteNumber(source.maxHalf, 0);
  if (!isUsablePoint(cameraPosition) || !isUsablePoint(focusPoint) || maxHalf <= 0) return UNUSABLE_FIT;
  const mapSize = clampToRange(toFiniteNumber(source.mapSize, 2048), MIN_MAP_SIZE, MAX_MAP_SIZE);
  const focusX = Number(focusPoint[0]);
  const focusY = Number(focusPoint[1]);
  const focusZ = Number(focusPoint[2]);
  const focusDistance = Math.hypot(
    focusX - Number(cameraPosition[0]),
    focusY - Number(cameraPosition[1]),
    focusZ - Number(cameraPosition[2]),
  );
  const visibleRadius = visibleRadiusAtFocus({
    distance: focusDistance,
    fieldOfViewYDeg: source.fieldOfViewYDeg,
    aspect: source.aspect,
  });


  const coverageFloor = Math.min(maxHalf, Math.max(SUN_VIEW_FIT_MIN_HALF, SUN_VIEW_FIT_COVERAGE_FLOOR));
  const wantedHalf = Math.max(coverageFloor, visibleRadius);
  let half = Math.ceil(wantedHalf / SUN_VIEW_FIT_HALF_STEP) * SUN_VIEW_FIT_HALF_STEP;
  if (half > maxHalf) half = maxHalf;
  const texel = (half * 2) / mapSize;
  if (!(texel > 0)) return UNUSABLE_FIT;


  const basis = lightBasis(source.lightDirection);
  const alongRight = focusX * basis.right[0] + focusY * basis.right[1] + focusZ * basis.right[2];
  const alongUp = focusX * basis.up[0] + focusY * basis.up[1] + focusZ * basis.up[2];
  const alongLight = focusX * basis.dir[0] + focusY * basis.dir[1] + focusZ * basis.dir[2];
  const rightSteps = Math.round(alongRight / texel);
  const upSteps = Math.round(alongUp / texel);
  const depthSteps = Math.round(alongLight / SUN_VIEW_FIT_DEPTH_STEP);
  const snappedRight = rightSteps * texel;
  const snappedUp = upSteps * texel;
  const snappedLight = depthSteps * SUN_VIEW_FIT_DEPTH_STEP;
  const center = Object.freeze([
    basis.right[0] * snappedRight + basis.up[0] * snappedUp + basis.dir[0] * snappedLight,
    basis.right[1] * snappedRight + basis.up[1] * snappedUp + basis.dir[1] * snappedLight,
    basis.right[2] * snappedRight + basis.up[2] * snappedUp + basis.dir[2] * snappedLight,
  ]);


  const normalBias = clampToRange(
    texel * SUN_VIEW_FIT_BIAS_TEXELS,
    SUN_VIEW_FIT_BIAS_FLOOR,
    SUN_VIEW_FIT_BIAS_CAP,
  );
  return Object.freeze({
    usable: true,
    center,
    half,
    texel,
    normalBias,
    signature: rightSteps + "|" + upSteps + "|" + depthSteps + "|" + half + "|" + mapSize,
    visibleRadius,
    focusDistance,
    reason: "window fitted to the camera view",
  });
}
