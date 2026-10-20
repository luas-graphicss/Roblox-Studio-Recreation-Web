export const BARN_DOOR_FULLY_OPEN_DEGREES = 90;
export const BARN_DOOR_SOFT_EDGE = 0.25;


export const BARN_DOOR_OPEN_SLOPE = 1e6;


export const RECT_EXTRAS_MAX_PROMOTED = 4;

export const LTC_RECT_BUDGET_BY_TIER = Object.freeze({
  fraco: 0,
  medio: 1,
  forte: RECT_EXTRAS_MAX_PROMOTED,
});


export const PROMOTABLE_RECT_TYPES = Object.freeze(["RectLight", "SurfaceLight"]);

export const RECT_PROMOTION_REASON = Object.freeze({
  PROMOTED: "promoted",
  PHASE_OFF: "phase-off",
  BUDGET_FULL: "budget-full",
  TYPE_NOT_RECT: "type-not-rect",
  DEGENERATE_SIZE: "degenerate-size",
  DISABLED: "disabled",
});

export const SURFACE_LIGHT_FACE_NORMALS = Object.freeze({
  Front: Object.freeze([0, 0, 1]),
  Back: Object.freeze([0, 0, -1]),
  Top: Object.freeze([0, 1, 0]),
  Bottom: Object.freeze([0, -1, 0]),
  Left: Object.freeze([-1, 0, 0]),
  Right: Object.freeze([1, 0, 0]),
});


export const BARN_DOOR_TIP_SLOPE_TABLE = Object.freeze([
  Object.freeze({ angleDegrees: 0, halfExtent: 1.2, length: 3, tipSlope: 0.4 }),
  Object.freeze({ angleDegrees: 45, halfExtent: 1.2, length: 3, tipSlope: 1.5656854249492381 }),
  Object.freeze({ angleDegrees: 60, halfExtent: 1.2, length: 3, tipSlope: 2.5320508075688776 }),
  Object.freeze({ angleDegrees: 90, halfExtent: 1.2, length: 3, tipSlope: BARN_DOOR_OPEN_SLOPE }),
  Object.freeze({ angleDegrees: 30, halfExtent: 1.2, length: 0, tipSlope: BARN_DOOR_OPEN_SLOPE }),
]);

function clamp(value, min, max) {
  const number = Number(value);
  if (!Number.isFinite(number)) return min;
  return Math.min(Math.max(number, min), max);
}

function clamp01(value) {
  return clamp(value, 0, 1);
}

function smoothstep01(value) {
  const t = clamp01(value);
  return t * t * (3 - 2 * t);
}

function subtractVectors(a, b) {
  return [Number(a[0]) - Number(b[0]), Number(a[1]) - Number(b[1]), Number(a[2]) - Number(b[2])];
}

function dotVectors(a, b) {
  return Number(a[0]) * Number(b[0]) + Number(a[1]) * Number(b[1]) + Number(a[2]) * Number(b[2]);
}

function crossVectors(a, b) {
  return [
    Number(a[1]) * Number(b[2]) - Number(a[2]) * Number(b[1]),
    Number(a[2]) * Number(b[0]) - Number(a[0]) * Number(b[2]),
    Number(a[0]) * Number(b[1]) - Number(a[1]) * Number(b[0]),
  ];
}

function normalizeVector(v) {
  const length = Math.sqrt(dotVectors(v, v));
  if (!(length > 0)) return [0, 0, 0];
  return [Number(v[0]) / length, Number(v[1]) / length, Number(v[2]) / length];
}

function barnDoorTiltRadians(barnDoorAngleDegrees) {
  const angle = clamp(barnDoorAngleDegrees, 0, BARN_DOOR_FULLY_OPEN_DEGREES);
  return ((BARN_DOOR_FULLY_OPEN_DEGREES - angle) * Math.PI) / 180;
}


export function isBarnDoorNeutral(barnDoorAngleDegrees, barnDoorLength) {
  const angle = Number(barnDoorAngleDegrees);
  const length = Number(barnDoorLength);
  if (!Number.isFinite(angle) || !Number.isFinite(length)) return true;
  return length <= 0 || angle >= BARN_DOOR_FULLY_OPEN_DEGREES;
}

export function barnDoorTipSlope(halfExtent, barnDoorAngleDegrees, barnDoorLength) {
  if (isBarnDoorNeutral(barnDoorAngleDegrees, barnDoorLength)) return BARN_DOOR_OPEN_SLOPE;
  const extent = Math.max(Number(halfExtent) || 0, 0);
  const length = Math.max(Number(barnDoorLength), 0);
  const tilt = barnDoorTiltRadians(barnDoorAngleDegrees);
  const sinTilt = Math.sin(tilt);
  if (!(sinTilt > 0)) return BARN_DOOR_OPEN_SLOPE;
  const cotTilt = Math.cos(tilt) / sinTilt;
  return Math.min(cotTilt + extent / (length * sinTilt), BARN_DOOR_OPEN_SLOPE);
}


export function barnDoorTipSlopeReference(halfExtent, barnDoorAngleDegrees, barnDoorLength) {
  if (isBarnDoorNeutral(barnDoorAngleDegrees, barnDoorLength)) return BARN_DOOR_OPEN_SLOPE;
  const extent = Math.max(Number(halfExtent) || 0, 0);
  const length = Math.max(Number(barnDoorLength), 0);
  const tilt = barnDoorTiltRadians(barnDoorAngleDegrees);
  const tipLateral = extent + length * Math.cos(tilt);
  const tipNormal = length * Math.sin(tilt);
  if (!(tipNormal > 0)) return BARN_DOOR_OPEN_SLOPE;
  return Math.min(tipLateral / tipNormal, BARN_DOOR_OPEN_SLOPE);
}

export function barnDoorAxisAttenuation(lateralOffset, normalDistance, tipSlope, softEdge) {
  if (!(Number(tipSlope) < BARN_DOOR_OPEN_SLOPE)) return 1;
  const distance = Math.max(Number(normalDistance) || 0, 1e-4);
  const slope = Math.abs(Number(lateralOffset) || 0) / distance;
  const soft = clamp(softEdge === undefined ? BARN_DOOR_SOFT_EDGE : softEdge, 0, 0.95);
  const inner = Number(tipSlope) * (1 - soft);
  if (slope <= inner) return 1;
  if (slope >= Number(tipSlope)) return 0;
  return 1 - smoothstep01((slope - inner) / Math.max(Number(tipSlope) - inner, 1e-6));
}


export function barnDoorAttenuation(params) {
  const settings = params || {};
  const offset = settings.localOffset || { u: 0, v: 0, n: 1 };
  const acrossWidth = barnDoorAxisAttenuation(
    offset.u,
    offset.n,
    barnDoorTipSlope(settings.halfWidth, settings.barnDoorAngleDegrees, settings.barnDoorLength),
    settings.softEdge,
  );
  const acrossHeight = barnDoorAxisAttenuation(
    offset.v,
    offset.n,
    barnDoorTipSlope(settings.halfHeight, settings.barnDoorAngleDegrees, settings.barnDoorLength),
    settings.softEdge,
  );
  return acrossWidth * acrossHeight;
}


export function rectEmissionNormal(uAxis, vAxis) {
  const localForward = normalizeVector(crossVectors(uAxis || [1, 0, 0], vAxis || [0, 1, 0]));
  return [-localForward[0], -localForward[1], -localForward[2]];
}


export function projectPointToRectFrame(params) {
  const settings = params || {};
  const toPoint = subtractVectors(settings.point || [0, 0, 0], settings.center || [0, 0, 0]);
  const uAxis = settings.uAxis || [1, 0, 0];
  const vAxis = settings.vAxis || [0, 1, 0];
  return {
    u: dotVectors(toPoint, normalizeVector(uAxis)),
    v: dotVectors(toPoint, normalizeVector(vAxis)),
    n: dotVectors(toPoint, rectEmissionNormal(uAxis, vAxis)),
  };
}


export function shouldFlipRectBasis(normalDistance, twoSided) {
  return !!twoSided && Number(normalDistance) < 0;
}

export function rectFacingFactor(normalDistance, twoSided) {
  const distance = Number(normalDistance);
  if (!Number.isFinite(distance)) return 0;
  if (distance > 0) return 1;
  return twoSided && distance < 0 ? 1 : 0;
}

export function rectArea(width, height) {
  return Math.max(Number(width) || 0, 0) * Math.max(Number(height) || 0, 0);
}


export function rectLightNits(luminousIntensityCandela, width, height) {
  const area = rectArea(width, height);
  if (!(area > 0)) return 0;
  return Math.max(Number(luminousIntensityCandela) || 0, 0) / area;
}

export function rectLightCandela(nits, width, height) {
  return Math.max(Number(nits) || 0, 0) * rectArea(width, height);
}

export function surfaceLightFaceNormal(face) {
  const normal = SURFACE_LIGHT_FACE_NORMALS[face];
  return normal ? normal.slice() : SURFACE_LIGHT_FACE_NORMALS.Front.slice();
}


export function rotationFromUnitVectors(from, to) {
  const a = normalizeVector(from);
  const b = normalizeVector(to);
  const real = 1 + dotVectors(a, b);
  if (real < 1e-6) {

    const axis = Math.abs(a[0]) > Math.abs(a[2]) ? [-a[1], a[0], 0] : [0, -a[2], a[1]];
    const orthogonal = normalizeVector(axis);
    return [orthogonal[0], orthogonal[1], orthogonal[2], 0];
  }
  const axis = crossVectors(a, b);
  const quaternion = [axis[0], axis[1], axis[2], real];
  const length = Math.sqrt(quaternion[0] ** 2 + quaternion[1] ** 2 + quaternion[2] ** 2 + quaternion[3] ** 2);
  return quaternion.map((component) => component / length);
}

export function surfaceLightFaceRotation(face) {
  return rotationFromUnitVectors(SURFACE_LIGHT_FACE_NORMALS.Front, surfaceLightFaceNormal(face));
}


export function rectPromotionPriority(light) {
  const candidate = light || {};
  return Math.max(Number(candidate.brightness) || 0, 0) * rectArea(candidate.width, candidate.height);
}

export function rectBudgetForTier(tier) {
  const budget = LTC_RECT_BUDGET_BY_TIER[tier];
  return budget === undefined ? 0 : budget;
}

export function isPromotableRectType(type) {
  return PROMOTABLE_RECT_TYPES.indexOf(type) >= 0;
}


export function resolveRectPromotionPlan(params) {
  const settings = params || {};
  const tier = settings.tier || "medio";
  const budget = rectBudgetForTier(tier);
  const phaseOn = !!settings.phaseFlagOn;
  const lights = Array.isArray(settings.lights) ? settings.lights : [];

  const decisions = lights.map((light, index) => ({
    index,
    name: light && light.name !== undefined ? light.name : String(index),
    type: light ? light.type : null,
    priority: rectPromotionPriority(light),
    promoted: false,
    reason: RECT_PROMOTION_REASON.TYPE_NOT_RECT,
  }));

  const candidates = decisions.filter((decision, index) => {
    const light = lights[index] || {};
    if (!isPromotableRectType(decision.type)) return false;


    if (light.enabled === false) {
      decision.reason = RECT_PROMOTION_REASON.DISABLED;
      return false;
    }
    if (!(rectArea(light.width, light.height) > 0)) {
      decision.reason = RECT_PROMOTION_REASON.DEGENERATE_SIZE;
      return false;
    }
    decision.reason = phaseOn ? RECT_PROMOTION_REASON.BUDGET_FULL : RECT_PROMOTION_REASON.PHASE_OFF;
    return true;
  });

  if (phaseOn && budget > 0) {
    candidates
      .slice()
      .sort((a, b) => b.priority - a.priority || a.index - b.index)
      .slice(0, budget)
      .forEach((decision) => {
        decision.promoted = true;
        decision.reason = RECT_PROMOTION_REASON.PROMOTED;
      });
  }

  const promoted = decisions.filter((decision) => decision.promoted);
  return {
    tier,
    budget,
    on: phaseOn,
    decisions,
    promotedNames: promoted.map((decision) => decision.name),
    promotedCount: promoted.length,
    candidateCount: candidates.length,
    fallbackNames: candidates.filter((decision) => !decision.promoted).map((decision) => decision.name),
  };
}
