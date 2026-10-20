import {
  PropTypes,
  Enums,
  makeColor,
  makeVector2,
  makeVector3,
  makeCFrame,
  makeUDim,
  makeUDim2,
  makeRect,
  makeNumberRange,
  makeColorSequence,
  makeNumberSequence,
  cloneValue,
  valuesEqual,
} from "./types.js";
import {
  isFiniteNumber,
  isString,
  isBoolean,
  isPlainObject,
} from "../utils/validate.js";


export const ATTRIBUTE_LIMITS = Object.freeze({
  maxAttributes: 50,
  maxNameLength: 100,
});


export const ATTRIBUTE_TYPES = Object.freeze([
  "string",
  "boolean",
  "number",
  "UDim",
  "UDim2",
  "BrickColor",
  "Color3",
  "Vector2",
  "Vector3",
  "CFrame",
  "NumberSequence",
  "ColorSequence",
  "NumberRange",
  "Rect",
  "Font",
]);

const ATTR_TYPE_SET = new Set(ATTRIBUTE_TYPES);


export const ATTRIBUTE_TYPE_LABELS = Object.freeze({
  string: "String",
  boolean: "Boolean",
  number: "Number",
  UDim: "UDim",
  UDim2: "UDim2",
  BrickColor: "BrickColor",
  Color3: "Color3",
  Vector2: "Vector2",
  Vector3: "Vector3",
  CFrame: "CFrame",
  NumberSequence: "NumberSequence",
  ColorSequence: "ColorSequence",
  NumberRange: "NumberRange",
  Rect: "Rect",
  Font: "Font",
});

export function isSupportedAttributeType(type) {
  return ATTR_TYPE_SET.has(type);
}






const ATTR_TO_PROP = Object.freeze({
  string: PropTypes.String,
  boolean: PropTypes.Boolean,
  number: PropTypes.Number,
  Color3: PropTypes.Color,
  Vector2: PropTypes.Vector2,
  Vector3: PropTypes.Vector3,
  CFrame: PropTypes.Vector3,
  UDim: PropTypes.UDim,
  UDim2: PropTypes.UDim2,
  Rect: PropTypes.Rect,
  NumberRange: PropTypes.NumberRange,
  NumberSequence: PropTypes.NumberSequence,
  ColorSequence: PropTypes.ColorSequence,
  BrickColor: PropTypes.String,
  Font: PropTypes.String,
});

export function attributeTypeToPropType(type) {
  return ATTR_TO_PROP[type] || PropTypes.String;
}


const NAME_RE = /^[A-Za-z0-9_]+$/;

export function validateAttributeName(name) {
  if (!isString(name) || name.length === 0) {
    return { ok: false, error: "O nome do atributo nao pode ser vazio." };
  }
  if (name.length > ATTRIBUTE_LIMITS.maxNameLength) {
    return {
      ok: false,
      error: `O nome do atributo excede ${ATTRIBUTE_LIMITS.maxNameLength} caracteres.`,
    };
  }
  if (!NAME_RE.test(name)) {
    return { ok: false, error: "Use apenas letras, numeros e underscore (_)." };
  }
  if (/^RBX/.test(name)) {
    return { ok: false, error: 'Nomes nao podem comecar com "RBX" (reservado).' };
  }
  return { ok: true };
}

const ok = (value) => ({ ok: true, value });
const err = (error) => ({ ok: false, error: error || "Valor invalido." });


export function coerceAttributeValue(type, value) {
  switch (type) {
    case "string":
      return isString(value) ? ok(value) : err("Esperado um texto (string).");
    case "boolean":
      return isBoolean(value) ? ok(value) : err("Esperado um booleano.");
    case "number":
      return isFiniteNumber(value) ? ok(value) : err("Esperado um numero finito.");
    case "Color3":
      if (isPlainObject(value) && isFiniteNumber(value.r) && isFiniteNumber(value.g) && isFiniteNumber(value.b)) {
        return ok(makeColor(value.r, value.g, value.b));
      }
      return err("Esperado um Color3.");
    case "Vector2":
      if (isPlainObject(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y)) {
        return ok(makeVector2(value.x, value.y));
      }
      return err("Esperado um Vector2.");
    case "Vector3":
      if (isPlainObject(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.z)) {
        return ok(makeVector3(value.x, value.y, value.z));
      }
      return err("Esperado um Vector3.");
    case "CFrame":


      if (isPlainObject(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.z)) {
        return ok(makeCFrame(value.x, value.y, value.z, value.qx, value.qy, value.qz, value.qw));
      }
      return err("Esperado um CFrame.");
    case "UDim":
      if (isPlainObject(value) && isFiniteNumber(value.scale) && isFiniteNumber(value.offset)) {
        return ok(makeUDim(value.scale, value.offset));
      }
      return err("Esperado um UDim.");
    case "UDim2":
      if (
        isPlainObject(value) &&
        isFiniteNumber(value.xScale) && isFiniteNumber(value.xOffset) &&
        isFiniteNumber(value.yScale) && isFiniteNumber(value.yOffset)
      ) {
        return ok(makeUDim2(value.xScale, value.xOffset, value.yScale, value.yOffset));
      }
      return err("Esperado um UDim2.");
    case "Rect":
      if (
        isPlainObject(value) &&
        isFiniteNumber(value.minX) && isFiniteNumber(value.minY) &&
        isFiniteNumber(value.maxX) && isFiniteNumber(value.maxY)
      ) {
        return ok(makeRect(value.minX, value.minY, value.maxX, value.maxY));
      }
      return err("Esperado um Rect.");
    case "NumberRange":
      if (isPlainObject(value) && isFiniteNumber(value.min) && isFiniteNumber(value.max)) {
        return ok(makeNumberRange(value.min, value.max));
      }
      return err("Esperado um NumberRange.");
    case "NumberSequence":
      if (isPlainObject(value) && Array.isArray(value.keypoints)) {
        return ok(makeNumberSequence(value.keypoints));
      }
      return err("Esperado um NumberSequence.");
    case "ColorSequence":
      if (isPlainObject(value) && Array.isArray(value.keypoints)) {
        return ok(makeColorSequence(value.keypoints));
      }
      return err("Esperado um ColorSequence.");
    case "BrickColor":
      if (isString(value) && Enums.BrickColorName.includes(value)) return ok(value);
      return err("Esperado um nome de BrickColor valido.");
    case "Font":
      if (isString(value) && Enums.Font.includes(value)) return ok(value);
      return err("Esperado uma Font valida.");
    default:
      return err(`Tipo de atributo nao suportado: ${type}`);
  }
}


const ATTR_DATA_PROP = Object.freeze({ ...ATTR_TO_PROP, CFrame: PropTypes.CFrame });

function attributeDataPropType(type) {
  return ATTR_DATA_PROP[type] || PropTypes.String;
}

export function cloneAttributeValue(type, value) {
  return cloneValue(attributeDataPropType(type), value);
}

export function attributeValuesEqual(type, a, b) {
  return valuesEqual(attributeDataPropType(type), a, b);
}


export function defaultAttributeValue(type) {
  switch (type) {
    case "string": return "";
    case "boolean": return false;
    case "number": return 0;
    case "Color3": return makeColor(1, 1, 1);
    case "Vector2": return makeVector2(0, 0);
    case "Vector3": return makeVector3(0, 0, 0);
    case "CFrame": return makeCFrame(0, 0, 0);
    case "UDim": return makeUDim(0, 0);
    case "UDim2": return makeUDim2(0, 0, 0, 0);
    case "Rect": return makeRect(0, 0, 0, 0);
    case "NumberRange": return makeNumberRange(0, 0);
    case "NumberSequence":
      return makeNumberSequence([{ time: 0, value: 0 }, { time: 1, value: 0 }]);
    case "ColorSequence":
      return makeColorSequence([
        { time: 0, color: makeColor(1, 1, 1) },
        { time: 1, color: makeColor(1, 1, 1) },
      ]);
    case "BrickColor": return "Medium stone grey";
    case "Font": return "SourceSans";
    default: return null;
  }
}
