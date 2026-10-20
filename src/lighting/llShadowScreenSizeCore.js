import { SA_RES_LADDER } from "./shadowAtlasCore.js";

export const SCREEN_SIZE_PHASE_ID = "LL-F12";


export const SHADOW_RESOLUTION_LADDER = SA_RES_LADDER;
export const MIN_SHADOW_RESOLUTION = SHADOW_RESOLUTION_LADDER[0];
export const MAX_SHADOW_RESOLUTION = SHADOW_RESOLUTION_LADDER[SHADOW_RESOLUTION_LADDER.length - 1];


export const SHADOW_TEXELS_PER_SCREEN_PIXEL = 1.27;


export const REFERENCE_VIEW = Object.freeze({
  verticalFovDeg: 45,
  widthPixels: 1920,
  heightPixels: 1080,
});

const MIN_VIEWPORT_PIXELS = 16;
const MIN_VERTICAL_FOV_DEG = 5;
const MAX_VERTICAL_FOV_DEG = 175;
const MIN_DISTANCE = 1e-4;
const MAX_SIN_ANGULAR_RADIUS = 0.9999;
const DEGREES_TO_RADIANS = Math.PI / 180;
const DEFAULT_FORWARD = Object.freeze([0, 0, -1]);

function asObject(value) {
  return value && typeof value === "object" ? value : {};
}

function finiteOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function positiveOr(value, fallback) {
  return Math.max(finiteOr(value, fallback === undefined ? 0 : fallback), 0);
}

function clampNumber(value, minimum, maximum, fallback) {
  return Math.min(Math.max(finiteOr(value, fallback), minimum), maximum);
}


export function asVector(value, fallback) {
  const base = Array.isArray(fallback) ? fallback : [0, 0, 0];
  if (Array.isArray(value)) {
    return [finiteOr(value[0], base[0]), finiteOr(value[1], base[1]), finiteOr(value[2], base[2])];
  }
  const source = asObject(value);
  if ("x" in source || "y" in source || "z" in source) {
    return [finiteOr(source.x, base[0]), finiteOr(source.y, base[1]), finiteOr(source.z, base[2])];
  }
  return base.slice();
}

export function distanceBetweenPoints(a, b) {
  const first = asVector(a);
  const second = asVector(b);
  return Math.hypot(second[0] - first[0], second[1] - first[1], second[2] - first[2]);
}

function normalizeVector(value, fallback) {
  const vector = asVector(value, fallback);
  const length = Math.hypot(vector[0], vector[1], vector[2]);
  if (!(length > MIN_DISTANCE)) return asVector(fallback, DEFAULT_FORWARD);
  return [vector[0] / length, vector[1] / length, vector[2] / length];
}


export function resolveView(view) {
  const source = asObject(view);
  const widthPixels = Math.max(finiteOr(source.widthPixels, REFERENCE_VIEW.widthPixels), MIN_VIEWPORT_PIXELS);
  const heightPixels = Math.max(finiteOr(source.heightPixels, REFERENCE_VIEW.heightPixels), MIN_VIEWPORT_PIXELS);
  const verticalFovDeg = clampNumber(
    source.verticalFovDeg,
    MIN_VERTICAL_FOV_DEG,
    MAX_VERTICAL_FOV_DEG,
    REFERENCE_VIEW.verticalFovDeg
  );
  return Object.freeze({
    widthPixels,
    heightPixels,
    verticalFovDeg,
    tanHalfVerticalFov: Math.tan((verticalFovDeg * DEGREES_TO_RADIANS) / 2),
  });
}


export function influenceRadiusOf(light) {
  return positiveOr(asObject(light).influenceRadius);
}


export function measureLightScreenFootprint(input) {
  const request = asObject(input);
  const view = resolveView(request.view);
  const camera = asObject(request.camera);
  const light = asObject(request.light);
  const cameraPosition = asVector(camera.position);
  const cameraForward = normalizeVector(camera.forward, DEFAULT_FORWARD);
  const lightPosition = asVector(light.worldPosition);
  const influenceRadius = influenceRadiusOf(light);
  const distance = distanceBetweenPoints(cameraPosition, lightPosition);
  const forwardDistance =
    (lightPosition[0] - cameraPosition[0]) * cameraForward[0] +
    (lightPosition[1] - cameraPosition[1]) * cameraForward[1] +
    (lightPosition[2] - cameraPosition[2]) * cameraForward[2];


  const cameraInside = influenceRadius > 0 && influenceRadius >= distance;
  const behindCamera = !cameraInside && !(forwardDistance + influenceRadius > 0);

  let radiusPixels = 0;
  if (cameraInside) {
    radiusPixels = view.heightPixels;
  } else if (!behindCamera) {
    const sinAngularRadius = Math.min(influenceRadius / Math.max(distance, MIN_DISTANCE), MAX_SIN_ANGULAR_RADIUS);
    const cosAngularRadius = Math.sqrt(Math.max(1 - sinAngularRadius * sinAngularRadius, MIN_DISTANCE));
    const tanAngularRadius = sinAngularRadius / cosAngularRadius;
    radiusPixels = ((view.heightPixels / 2) * tanAngularRadius) / Math.max(view.tanHalfVerticalFov, MIN_DISTANCE);
  }

  const discAreaPixels = Math.PI * radiusPixels * radiusPixels;
  const viewportAreaPixels = view.widthPixels * view.heightPixels;
  return Object.freeze({
    distance,
    forwardDistance,
    influenceRadius,
    cameraInside,
    behindCamera,
    radiusPixels,
    diameterPixels: radiusPixels * 2,
    coverage: Math.min(discAreaPixels / viewportAreaPixels, 1),
    view,
  });
}


export function desiredShadowResolutionPixels(radiusPixels, texelsPerScreenPixel) {
  const texels = positiveOr(texelsPerScreenPixel, SHADOW_TEXELS_PER_SCREEN_PIXEL);
  return positiveOr(radiusPixels) * (texels > 0 ? texels : SHADOW_TEXELS_PER_SCREEN_PIXEL);
}


export function ladderStepForPixels(desiredPixels) {
  const pixels = positiveOr(desiredPixels);
  let chosen = MIN_SHADOW_RESOLUTION;
  SHADOW_RESOLUTION_LADDER.forEach((step) => {
    if (pixels >= step) chosen = step;
  });
  return chosen;
}

export function ladderIndexOf(resolution) {
  const index = SHADOW_RESOLUTION_LADDER.indexOf(Math.floor(finiteOr(resolution, 0)));
  return index;
}


export function nearestLadderStepAtMost(resolution) {
  return ladderStepForPixels(resolution);
}

export function clampResolutionToCeiling(resolution, ceilingResolution) {
  const ceiling = nearestLadderStepAtMost(
    ceilingResolution === undefined || ceilingResolution === null ? MAX_SHADOW_RESOLUTION : ceilingResolution
  );
  return Math.min(ladderStepForPixels(resolution), ceiling);
}


export function ladderStepsBetween(fromResolution, toResolution) {
  const fromIndex = ladderIndexOf(fromResolution);
  const toIndex = ladderIndexOf(toResolution);
  if (fromIndex >= 0 && toIndex >= 0) return Math.abs(toIndex - fromIndex);
  return 0;
}


export const CAMERA_INSIDE_DESIRED_PIXELS = MAX_SHADOW_RESOLUTION * 2;


export function resolutionForFootprint(footprint, options) {
  const settings = asObject(options);
  const measured = asObject(footprint);
  const projectedPixels = desiredShadowResolutionPixels(measured.radiusPixels, settings.texelsPerScreenPixel);
  const desiredPixels =
    measured.cameraInside === true ? Math.max(projectedPixels, CAMERA_INSIDE_DESIRED_PIXELS) : projectedPixels;
  return {
    desiredPixels,
    resolution: clampResolutionToCeiling(ladderStepForPixels(desiredPixels), settings.ceilingResolution),
    unclampedResolution: ladderStepForPixels(desiredPixels),
  };
}


export function resolutionByDistanceTable(input) {
  const request = asObject(input);
  const view = resolveView(request.view);
  const influenceRadius = positiveOr(request.influenceRadius, 16);
  const distances = Array.isArray(request.distances) ? request.distances : [];
  return distances.map((rawDistance) => {
    const distance = positiveOr(rawDistance);
    const footprint = measureLightScreenFootprint({
      view,
      camera: { position: [0, 0, 0], forward: DEFAULT_FORWARD },
      light: { worldPosition: [0, 0, -distance], influenceRadius },
    });
    const sized = resolutionForFootprint(footprint, {
      texelsPerScreenPixel: request.texelsPerScreenPixel,
      ceilingResolution: request.ceilingResolution,
    });
    return Object.freeze({
      distance,
      influenceRadius,
      radiusPixels: footprint.radiusPixels,
      coverage: footprint.coverage,
      desiredPixels: sized.desiredPixels,
      resolution: sized.resolution,
      cameraInside: footprint.cameraInside,
    });
  });
}
