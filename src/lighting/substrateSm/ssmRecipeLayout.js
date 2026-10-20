import { SSM_RECIPE_LAYOUT, SSM_RECIPE_VERSION } from './ssmContract.js';

export const SSM_RECIPE_LAYOUT_VERSION = SSM_RECIPE_VERSION;
export const SSM_RECIPE_BYTE_LENGTH = SSM_RECIPE_LAYOUT.byteLength;
export const SSM_RECIPE_FLOAT_COUNT = SSM_RECIPE_LAYOUT.componentCount;
export const SSM_RECIPE_VECTOR_COUNT = SSM_RECIPE_LAYOUT.vectorCount;
export const SSM_RECIPE_FIELDS = Object.freeze(Object.fromEntries(SSM_RECIPE_LAYOUT.fields.map(field => [
  field.name,
  Object.freeze({
    offset: field.vector * SSM_RECIPE_LAYOUT.componentsPerVector + field.component,
    components: field.components,
  }),
])));

const SSM_RECIPE_FIELD_NAMES = Object.freeze(Object.keys(SSM_RECIPE_FIELDS));
const SSM_RECIPE_RESERVED_FIELDS = Object.freeze(['reserved', 'reservedVector']);

function requirePayloadStorage(payload) {
  if (!(payload instanceof Float32Array) || payload.length !== SSM_RECIPE_FLOAT_COUNT
    || payload.byteLength !== SSM_RECIPE_BYTE_LENGTH) {
    throw new TypeError('SSM recipe storage must be exactly 32 float32 values');
  }
}

function readDataProperty(object, name) {
  const property = Object.getOwnPropertyDescriptor(object, name);
  if (property && !Object.hasOwn(property, 'value')) throw new TypeError(`SSM ${name} cannot be a getter`);
  return property?.value;
}

function requireFiniteComponent(value, fieldName, reserved) {
  if (typeof value !== 'number' || !Number.isFinite(value) || !Number.isFinite(Math.fround(value))) {
    throw new TypeError(`SSM ${fieldName} requires finite float32 components`);
  }
  if (reserved && value !== 0) throw new RangeError(`SSM ${fieldName} must remain zero`);
  return value === 0 ? 0 : Math.fround(value);
}

export function validateSubstrateSmRecipePayload(payload) {
  requirePayloadStorage(payload);
  for (let index = 0; index < payload.length; index += 1) {
    if (!Number.isFinite(payload[index])) throw new TypeError('SSM recipe contains a nonfinite component');
  }
  for (const fieldName of SSM_RECIPE_RESERVED_FIELDS) {
    const field = SSM_RECIPE_FIELDS[fieldName];
    for (let component = 0; component < field.components; component += 1) {
      if (payload[field.offset + component] !== 0) throw new RangeError('SSM reserved payload must remain zero');
    }
  }
  return true;
}

export function writeSubstrateSmRecipePayload(parameters, target) {
  if (!parameters || typeof parameters !== 'object') throw new TypeError('SSM parameters must be resolved data');
  if (target !== undefined) requirePayloadStorage(target);
  const stagedPayload = new Float32Array(SSM_RECIPE_FLOAT_COUNT);
  for (const fieldName of SSM_RECIPE_FIELD_NAMES) {
    const field = SSM_RECIPE_FIELDS[fieldName];
    const reserved = SSM_RECIPE_RESERVED_FIELDS.includes(fieldName);
    const value = readDataProperty(parameters, fieldName);
    if (reserved && value === undefined) continue;
    if (field.components === 1) {
      stagedPayload[field.offset] = requireFiniteComponent(value, fieldName, reserved);
      continue;
    }
    if ((!Array.isArray(value) && !(value instanceof Float32Array)) || value.length !== field.components) {
      throw new TypeError(`SSM ${fieldName} requires ${field.components} components`);
    }
    for (let component = 0; component < field.components; component += 1) {
      stagedPayload[field.offset + component] = requireFiniteComponent(readDataProperty(value, String(component)), fieldName, reserved);
    }
  }
  if (target === undefined) return stagedPayload;
  target.set(stagedPayload);
  return target;
}

export function readSubstrateSmRecipePayload(payload) {
  validateSubstrateSmRecipePayload(payload);
  const parameters = {};
  for (const fieldName of SSM_RECIPE_FIELD_NAMES) {
    const field = SSM_RECIPE_FIELDS[fieldName];
    if (field.components === 1) {
      parameters[fieldName] = payload[field.offset];
    } else {
      parameters[fieldName] = Object.freeze(Array.from(payload.subarray(field.offset, field.offset + field.components)));
    }
  }
  return Object.freeze(parameters);
}
