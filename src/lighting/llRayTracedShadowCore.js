import {
  RAY_TRACED_DEPTH_BIAS_STUDS,
  RAY_TRACED_PARITY_TOLERANCE,
  RAY_TRACED_REFUSALS,
  RAY_TRACED_SHADOW_MAX_LIGHTS,
  RAY_TRACED_SHADOW_PROP,
  RAY_TRACED_SHADOW_REQUIRED_TIER,
} from "./llTransmissionContract.js";
import {
  add3,
  cross3,
  dot3,
  length3,
  nearestBoxHitAlongRay,
  normalize3,
  scale3,
  segmentCrossesBox,
  subtract3,
} from "./llRaySlabCore.js";

export const DEFAULT_PAGE_RESOLUTION = 512;
export const DEFAULT_PAGE_HALF_ANGLE_RAD = 0.7;


export const POLE_THRESHOLD = 0.99;

export function resolveRayTracedShadowPolicy(options) {
  const settings = options || {};
  const tier = settings.tier || "medio";
  const maxLights = Number.isFinite(settings.maxLights) ? settings.maxLights : RAY_TRACED_SHADOW_MAX_LIGHTS;
  const requiredTier = settings.requiredTier || RAY_TRACED_SHADOW_REQUIRED_TIER;
  const lights = Array.isArray(settings.lights) ? settings.lights : [];
  const decisions = [];
  let usedSlots = 0;

  let globalRefusal = null;
  if (settings.baselineFrozen === true) globalRefusal = RAY_TRACED_REFUSALS.baselineFrozen;
  else if (tier !== requiredTier) globalRefusal = RAY_TRACED_REFUSALS.tierNotHigh;
  else if (settings.flagOn !== true) globalRefusal = RAY_TRACED_REFUSALS.flagOff;

  lights.forEach((light) => {
    const name = (light && light.nome) || (light && light.name) || "?";
    const props = (light && light.props) || {};
    const wants = props[RAY_TRACED_SHADOW_PROP] === true;
    if (globalRefusal) {
      decisions.push({ name, mode: "atlas", refusal: globalRefusal, wants });
      return;
    }
    if (!wants) {
      decisions.push({ name, mode: "atlas", refusal: RAY_TRACED_REFUSALS.propOff, wants });
      return;
    }
    if (usedSlots >= maxLights) {
      decisions.push({ name, mode: "atlas", refusal: RAY_TRACED_REFUSALS.overBudget, wants });
      return;
    }
    usedSlots += 1;
    decisions.push({ name, mode: "ray", refusal: null, wants });
  });

  return {
    tier,
    requiredTier,
    maxLights,
    enabled: !globalRefusal,
    globalRefusal,
    usedSlots,
    decisions,
    rayTracedLights: decisions.filter((entry) => entry.mode === "ray").map((entry) => entry.name),
  };
}


export function traceSegmentOcclusion(options) {
  const settings = options || {};
  const origin = settings.origin || [0, 0, 0];
  const target = settings.target || [0, 0, 0];
  const boxes = Array.isArray(settings.boxes) ? settings.boxes : [];
  for (let index = 0; index < boxes.length; index++) {
    const box = boxes[index];
    if (!box || index === settings.ignoreIndex) continue;
    if (segmentCrossesBox(origin, target, box)) return { blocked: true, boxIndex: index };
  }
  return { blocked: false, boxIndex: -1 };
}

export function buildLightBasis(direction) {
  const forward = normalize3(direction && length3(direction) > 0 ? direction : [0, -1, 0]);
  const upGuess = Math.abs(forward[1]) > POLE_THRESHOLD ? [0, 0, 1] : [0, 1, 0];
  const right = normalize3(cross3(upGuess, forward));
  const up = cross3(forward, right);
  return { forward, right, up };
}


export function projectToPage(basis, origin, point) {
  const offset = subtract3(point, origin);
  return {
    u: dot3(offset, basis.right),
    v: dot3(offset, basis.up),
    z: dot3(offset, basis.forward),
  };
}


export function quantizePageSample(options) {
  const settings = options || {};
  const basis = settings.basis;
  const origin = settings.origin;
  const point = settings.point;
  const pageResolution = Math.max(Number(settings.pageResolution) || DEFAULT_PAGE_RESOLUTION, 1);
  const halfAngleRad = Number.isFinite(settings.halfAngleRad) ? settings.halfAngleRad : DEFAULT_PAGE_HALF_ANGLE_RAD;
  const local = projectToPage(basis, origin, point);
  if (!(local.z > 0)) return null;
  const texel = (2 * Math.tan(halfAngleRad)) / pageResolution;
  const snappedU = (Math.floor(local.u / local.z / texel) + 0.5) * texel;
  const snappedV = (Math.floor(local.v / local.z / texel) + 0.5) * texel;
  const snappedPoint = add3(
    add3(origin, scale3(basis.forward, local.z)),
    add3(scale3(basis.right, snappedU * local.z), scale3(basis.up, snappedV * local.z)),
  );
  const offset = subtract3(snappedPoint, origin);
  return {
    direction: normalize3(offset),
    distance: length3(offset),
    point: snappedPoint,
    texel,
  };
}

export function compareRayTracedAgainstShadowMap(options) {
  const settings = options || {};
  const lightPosition = settings.lightPosition || [0, 0, 0];
  const basis = buildLightBasis(settings.lightDirection || [0, -1, 0]);
  const boxes = Array.isArray(settings.boxes) ? settings.boxes : [];
  const samples = Array.isArray(settings.samples) ? settings.samples : [];
  const depthBias = Number.isFinite(settings.depthBiasStuds) ? settings.depthBiasStuds : RAY_TRACED_DEPTH_BIAS_STUDS;
  const mismatches = [];
  let agreements = 0;
  let rayBlockedCount = 0;
  let mapBlockedCount = 0;
  let outsidePage = 0;

  samples.forEach((sample, index) => {
    const rayBlocked = traceSegmentOcclusion({ origin: lightPosition, target: sample, boxes }).blocked;
    const snapped = quantizePageSample({
      basis,
      origin: lightPosition,
      point: sample,
      pageResolution: settings.pageResolution,
      halfAngleRad: settings.halfAngleRad,
    });
    let mapBlocked = false;
    if (!snapped) outsidePage += 1;
    else {
      const hit = nearestBoxHitAlongRay(lightPosition, snapped.direction, boxes, snapped.distance - depthBias);
      mapBlocked = hit.hit;
    }
    if (rayBlocked) rayBlockedCount += 1;
    if (mapBlocked) mapBlockedCount += 1;
    if (rayBlocked === mapBlocked) agreements += 1;
    else mismatches.push({ index, sample, rayBlocked, mapBlocked });
  });

  const sampleCount = samples.length;
  return {
    sampleCount,
    agreements,
    agreementRatio: sampleCount > 0 ? agreements / sampleCount : 1,
    rayBlockedCount,
    mapBlockedCount,
    outsidePage,
    mismatches,
  };
}

export function rayTracedParityVerdict(options) {
  const settings = options || {};
  const tolerance = Number.isFinite(settings.tolerance) ? settings.tolerance : RAY_TRACED_PARITY_TOLERANCE;
  const agreementRatio = Number.isFinite(settings.agreementRatio) ? settings.agreementRatio : 0;
  return {
    ok: agreementRatio >= 1 - tolerance,
    tolerance,
    agreementRatio,
    gap: Math.max(1 - tolerance - agreementRatio, 0),
  };
}


export function buildFloorSampleGrid(options) {
  const settings = options || {};
  const center = settings.center || [0, 0, 0];
  const extent = Number.isFinite(settings.extent) ? settings.extent : 3;
  const steps = Math.max(Math.floor(Number(settings.steps) || 9), 2);
  const height = Number.isFinite(settings.height) ? settings.height : 0.05;
  const samples = [];
  for (let ix = 0; ix < steps; ix++) {
    for (let iz = 0; iz < steps; iz++) {
      const u = steps === 1 ? 0 : (ix / (steps - 1)) * 2 - 1;
      const v = steps === 1 ? 0 : (iz / (steps - 1)) * 2 - 1;
      samples.push([center[0] + u * extent, height, center[2] + v * extent]);
    }
  }
  return samples;
}
