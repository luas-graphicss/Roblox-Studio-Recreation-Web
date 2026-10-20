import { REC709_LUMINANCE_WEIGHTS, relativeLuminance } from "../llFireflyClampCore.js";


export const MSM_LIGHT_RECORD_PHASE_ID = "MSM-F6";


export const MSM_LIGHT_TYPE = Object.freeze({ POINT: "point", SPOT: "spot" });


export const MSM_LIGHT_TYPES = Object.freeze([MSM_LIGHT_TYPE.POINT, MSM_LIGHT_TYPE.SPOT]);


export const MSM_LIGHT_TYPE_CODE = Object.freeze({
  [MSM_LIGHT_TYPE.POINT]: 0,
  [MSM_LIGHT_TYPE.SPOT]: 1,
});


export const MSM_LIGHT_FLAG = Object.freeze({
  CASTS_SHADOW: 1,
  HAS_COOKIE_OR_IES: 2,
  AREA_SHAPED: 4,
  STATIC: 8,
});


export const MSM_LIGHT_FLAG_BY_FIELD = Object.freeze({
  castsShadow: MSM_LIGHT_FLAG.CASTS_SHADOW,
  hasCookieOrIes: MSM_LIGHT_FLAG.HAS_COOKIE_OR_IES,
  areaShaped: MSM_LIGHT_FLAG.AREA_SHAPED,
  isStatic: MSM_LIGHT_FLAG.STATIC,
});


export const MSM_LIGHT_FLAG_MASK =
  MSM_LIGHT_FLAG.CASTS_SHADOW |
  MSM_LIGHT_FLAG.HAS_COOKIE_OR_IES |
  MSM_LIGHT_FLAG.AREA_SHAPED |
  MSM_LIGHT_FLAG.STATIC;


export const MSM_ATLAS_SLOT_NONE = -1;


export const MSM_POINT_COS_OUTER = -1;
export const MSM_POINT_COS_INNER = -1;


export const MSM_SPOT_MAX_OUTER_ANGLE_DEGREES = 90;


export const MSM_MINIMUM_LIGHT_LUMINANCE = 1e-6;


export const MSM_MINIMUM_LIGHT_RANGE = 1e-4;


export const MSM_LIGHT_REJECTION = Object.freeze({
  MISSING_INPUT: "missingInput",
  MISSING_KEY: "missingLightKey",
  UNKNOWN_TYPE: "unknownLightType",
  INVALID_POSITION: "invalidPosition",
  INVALID_RANGE: "invalidRange",
  INVALID_COLOR: "invalidColor",
  INVALID_INTENSITY: "invalidIntensity",
  BELOW_LUMINANCE_FLOOR: "belowLuminanceFloor",
  INVALID_DIRECTION: "invalidDirection",
  INVALID_CONE: "invalidCone",
});


export const MSM_LIGHT_RECORD_TEXEL_ORDER = Object.freeze([
  Object.freeze({ texel: 0, fields: Object.freeze(["positionX", "positionY", "positionZ", "range"]) }),
  Object.freeze({ texel: 1, fields: Object.freeze(["chromaticityRed", "chromaticityGreen", "chromaticityBlue", "luminance"]) }),
  Object.freeze({ texel: 2, fields: Object.freeze(["directionX", "directionY", "directionZ", "cosOuter"]) }),
  Object.freeze({ texel: 3, fields: Object.freeze(["cosInner", "atlasSlot", "typeCode", "flags"]) }),
]);

const RADIANS_PER_DEGREE = Math.PI / 180;
const DEGREES_PER_RADIAN = 180 / Math.PI;

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}

function firstFiniteNumber(candidates, fallback) {
  for (let index = 0; candidates.length > index; index += 1) {
    if (isFiniteNumber(candidates[index])) return candidates[index];
  }
  return fallback;
}

function acceptedRecord(record) {
  return Object.freeze({ ok: true, record, rejection: null, reason: "" });
}

function rejectedRecord(rejection, reason) {
  return Object.freeze({ ok: false, record: null, rejection, reason });
}


export function readMsmLightKey(source) {
  if (typeof source === "string") return source !== "" ? source : null;
  if (isFiniteNumber(source)) return String(source);
  if (!source || typeof source !== "object") return null;
  const candidates = [source.lightKey, source.id, source.uuid];
  for (let index = 0; candidates.length > index; index += 1) {
    const candidate = candidates[index];
    if (typeof candidate === "string" && candidate !== "") return candidate;
    if (isFiniteNumber(candidate)) return String(candidate);
  }
  return null;
}

function readLightType(source) {
  const raw = typeof source.type === "string" ? source.type.trim().toLowerCase() : "";
  if (raw === MSM_LIGHT_TYPE.POINT) return MSM_LIGHT_TYPE.POINT;
  if (raw === MSM_LIGHT_TYPE.SPOT) return MSM_LIGHT_TYPE.SPOT;
  return null;
}

function readVector(source, objectField, axisPrefix) {
  const holder = source[objectField];
  if (holder && typeof holder === "object") {
    if (isFiniteNumber(holder.x) && isFiniteNumber(holder.y) && isFiniteNumber(holder.z)) {
      return { x: holder.x, y: holder.y, z: holder.z };
    }
    return null;
  }
  const x = source[axisPrefix + "X"];
  const y = source[axisPrefix + "Y"];
  const z = source[axisPrefix + "Z"];
  if (isFiniteNumber(x) && isFiniteNumber(y) && isFiniteNumber(z)) return { x, y, z };
  return null;
}

function readColorChannels(source) {
  const color = source.color;
  if (Array.isArray(color)) {
    const red = color[0];
    const green = color[1];
    const blue = color[2];
    if (isFiniteNumber(red) && isFiniteNumber(green) && isFiniteNumber(blue)) return { red, green, blue };
    return null;
  }
  if (color && typeof color === "object") {
    const red = firstFiniteNumber([color.red, color.r], Number.NaN);
    const green = firstFiniteNumber([color.green, color.g], Number.NaN);
    const blue = firstFiniteNumber([color.blue, color.b], Number.NaN);
    if (isFiniteNumber(red) && isFiniteNumber(green) && isFiniteNumber(blue)) return { red, green, blue };
    return null;
  }
  return null;
}

function readOuterAngleDegrees(source) {
  const degrees = firstFiniteNumber([source.outerAngleDegrees], Number.NaN);
  if (isFiniteNumber(degrees)) return degrees;
  const radians = firstFiniteNumber([source.outerAngleRadians, source.angle], Number.NaN);
  if (isFiniteNumber(radians)) return radians * DEGREES_PER_RADIAN;
  return Number.NaN;
}

function readInnerAngleDegrees(source, outerAngleDegrees) {
  const degrees = firstFiniteNumber([source.innerAngleDegrees], Number.NaN);
  if (isFiniteNumber(degrees)) return degrees;
  const radians = firstFiniteNumber([source.innerAngleRadians], Number.NaN);
  if (isFiniteNumber(radians)) return radians * DEGREES_PER_RADIAN;
  const penumbra = Math.min(Math.max(firstFiniteNumber([source.penumbra], 0), 0), 1);
  return outerAngleDegrees * (1 - penumbra);
}

function readAtlasSlot(source) {
  const slot = Math.trunc(firstFiniteNumber([source.atlasSlot], MSM_ATLAS_SLOT_NONE));
  return slot >= 0 ? slot : MSM_ATLAS_SLOT_NONE;
}

function unitVectorOrNull(vector) {
  const length = Math.sqrt(vector.x * vector.x + vector.y * vector.y + vector.z * vector.z);
  if (!(length > 0)) return null;
  return { x: vector.x / length, y: vector.y / length, z: vector.z / length };
}


export function msmLightFlagsFrom(descriptor) {
  const source = descriptor && typeof descriptor === "object" ? descriptor : {};
  const fields = Object.keys(MSM_LIGHT_FLAG_BY_FIELD);
  let flags = 0;
  for (let index = 0; fields.length > index; index += 1) {
    const field = fields[index];
    if (source[field] === true) flags |= MSM_LIGHT_FLAG_BY_FIELD[field];
  }
  return flags;
}


export function msmLightHasFlag(flags, flag) {
  if (!isFiniteNumber(flags) || !isFiniteNumber(flag) || !(flag > 0)) return false;
  return (flags & flag) === flag;
}


export function describeMsmLightFlags(flags) {
  const fields = Object.keys(MSM_LIGHT_FLAG_BY_FIELD).filter(function keepRaisedBit(field) {
    return msmLightHasFlag(flags, MSM_LIGHT_FLAG_BY_FIELD[field]);
  });
  return fields.length > 0 ? fields.join("+") : "none";
}




















export function normalizeMsmLightRecord(rawLight) {
  const source = rawLight && typeof rawLight === "object" ? rawLight : null;
  if (!source) {
    return rejectedRecord(MSM_LIGHT_REJECTION.MISSING_INPUT, "luz ausente: nada para normalizar");
  }

  const lightKey = readMsmLightKey(source);
  if (lightKey === null) {
    return rejectedRecord(MSM_LIGHT_REJECTION.MISSING_KEY, "luz sem lightKey/id/uuid: o MSM nao inventa identidade");
  }

  const type = readLightType(source);
  if (type === null) {
    return rejectedRecord(MSM_LIGHT_REJECTION.UNKNOWN_TYPE, "tipo fora de point/spot: " + String(source.type));
  }

  const position = readVector(source, "position", "position");
  if (position === null) {
    return rejectedRecord(MSM_LIGHT_REJECTION.INVALID_POSITION, "posicao precisa de x, y e z finitos");
  }

  const range = firstFiniteNumber([source.range, source.distance], Number.NaN);
  if (!isFiniteNumber(range) || !(range >= MSM_MINIMUM_LIGHT_RANGE)) {
    return rejectedRecord(MSM_LIGHT_REJECTION.INVALID_RANGE, "alcance precisa ser finito e maior que " + MSM_MINIMUM_LIGHT_RANGE + ": " + String(range));
  }

  const color = readColorChannels(source);
  if (color === null) {
    return rejectedRecord(MSM_LIGHT_REJECTION.INVALID_COLOR, "cor precisa de tres canais finitos");
  }
  if (!(color.red >= 0) || !(color.green >= 0) || !(color.blue >= 0)) {
    return rejectedRecord(MSM_LIGHT_REJECTION.INVALID_COLOR, "canal de cor negativo e bug de quem chamou, nao e clampado aqui");
  }

  const intensity = firstFiniteNumber([source.intensity], 1);
  if (!isFiniteNumber(intensity) || !(intensity >= 0)) {
    return rejectedRecord(MSM_LIGHT_REJECTION.INVALID_INTENSITY, "intensidade precisa ser finita e nao negativa: " + String(source.intensity));
  }

  const scaledColor = {
    red: color.red * intensity,
    green: color.green * intensity,
    blue: color.blue * intensity,
  };
  const luminance = relativeLuminance(scaledColor);
  if (!(luminance >= MSM_MINIMUM_LIGHT_LUMINANCE)) {
    return rejectedRecord(MSM_LIGHT_REJECTION.BELOW_LUMINANCE_FLOOR, "luminancia " + luminance + " abaixo do piso " + MSM_MINIMUM_LIGHT_LUMINANCE + ": luz sem energia nao entra no MSM");
  }

  let direction = { x: 0, y: 0, z: 0 };
  let cosOuter = MSM_POINT_COS_OUTER;
  let cosInner = MSM_POINT_COS_INNER;

  if (type === MSM_LIGHT_TYPE.SPOT) {
    const rawDirection = readVector(source, "direction", "direction");
    if (rawDirection === null) {
      return rejectedRecord(MSM_LIGHT_REJECTION.INVALID_DIRECTION, "spot precisa de direction com x, y e z finitos");
    }
    const unitDirection = unitVectorOrNull(rawDirection);
    if (unitDirection === null) {
      return rejectedRecord(MSM_LIGHT_REJECTION.INVALID_DIRECTION, "direction de comprimento zero nao aponta para lugar nenhum");
    }
    const outerAngleDegrees = readOuterAngleDegrees(source);
    if (!isFiniteNumber(outerAngleDegrees) || !(outerAngleDegrees > 0) || outerAngleDegrees > MSM_SPOT_MAX_OUTER_ANGLE_DEGREES) {
      return rejectedRecord(MSM_LIGHT_REJECTION.INVALID_CONE, "meio-angulo externo fora de (0, " + MSM_SPOT_MAX_OUTER_ANGLE_DEGREES + "] graus: " + String(outerAngleDegrees));
    }
    const innerAngleDegrees = Math.min(Math.max(readInnerAngleDegrees(source, outerAngleDegrees), 0), outerAngleDegrees);
    direction = unitDirection;
    cosOuter = Math.cos(outerAngleDegrees * RADIANS_PER_DEGREE);
    cosInner = Math.cos(innerAngleDegrees * RADIANS_PER_DEGREE);
  }

  const flags = msmLightFlagsFrom(source);

  const record = Object.freeze({
    lightKey,
    type,
    typeCode: MSM_LIGHT_TYPE_CODE[type],
    positionX: position.x,
    positionY: position.y,
    positionZ: position.z,
    range,
    luminance,
    chromaticityRed: scaledColor.red / luminance,
    chromaticityGreen: scaledColor.green / luminance,
    chromaticityBlue: scaledColor.blue / luminance,
    directionX: direction.x,
    directionY: direction.y,
    directionZ: direction.z,
    cosOuter,
    cosInner,
    atlasSlot: readAtlasSlot(source),
    flags,
    castsShadow: msmLightHasFlag(flags, MSM_LIGHT_FLAG.CASTS_SHADOW),
    hasCookieOrIes: msmLightHasFlag(flags, MSM_LIGHT_FLAG.HAS_COOKIE_OR_IES),
    areaShaped: msmLightHasFlag(flags, MSM_LIGHT_FLAG.AREA_SHAPED),
    isStatic: msmLightHasFlag(flags, MSM_LIGHT_FLAG.STATIC),
  });

  return acceptedRecord(record);
}


export function normalizeMsmLightRecords(rawLights) {
  const list = Array.isArray(rawLights) ? rawLights : [];
  const records = [];
  const rejections = [];
  for (let index = 0; list.length > index; index += 1) {
    const outcome = normalizeMsmLightRecord(list[index]);
    if (outcome.ok) {
      records.push(outcome.record);
      continue;
    }
    rejections.push(Object.freeze({ inputIndex: index, rejection: outcome.rejection, reason: outcome.reason }));
  }
  return Object.freeze({
    records: Object.freeze(records),
    rejections: Object.freeze(rejections),
    acceptedCount: records.length,
    rejectedCount: rejections.length,
  });
}


export function msmLightScaledColorFrom(record) {
  if (!record || !isFiniteNumber(record.luminance)) return { red: 0, green: 0, blue: 0 };
  return {
    red: record.chromaticityRed * record.luminance,
    green: record.chromaticityGreen * record.luminance,
    blue: record.chromaticityBlue * record.luminance,
  };
}


export const MSM_LIGHT_LUMINANCE_WEIGHTS = REC709_LUMINANCE_WEIGHTS;


export function isUsableMsmLightRecord(record) {
  if (!record || typeof record !== "object") return false;
  if (typeof record.lightKey !== "string" || record.lightKey === "") return false;
  if (MSM_LIGHT_TYPES.indexOf(record.type) === -1) return false;
  for (let texel = 0; MSM_LIGHT_RECORD_TEXEL_ORDER.length > texel; texel += 1) {
    const fields = MSM_LIGHT_RECORD_TEXEL_ORDER[texel].fields;
    for (let field = 0; fields.length > field; field += 1) {
      if (!isFiniteNumber(record[fields[field]])) return false;
    }
  }
  if (!(record.range >= MSM_MINIMUM_LIGHT_RANGE)) return false;
  if (!(record.luminance >= MSM_MINIMUM_LIGHT_LUMINANCE)) return false;
  if (!(record.cosInner >= record.cosOuter)) return false;
  return true;
}


export function describeMsmLightRecord(record) {
  if (!record || typeof record !== "object") return "sem registro de luz";
  return [
    record.type + " " + record.lightKey,
    "range " + Number(record.range).toFixed(2),
    "lum " + Number(record.luminance).toFixed(3),
    "cone " + Number(record.cosOuter).toFixed(3) + ".." + Number(record.cosInner).toFixed(3),
    "atlas " + record.atlasSlot,
    "flags " + describeMsmLightFlags(record.flags),
  ].join(" | ");
}
