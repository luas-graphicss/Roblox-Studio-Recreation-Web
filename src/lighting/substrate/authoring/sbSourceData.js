import {
  SB_SOURCE_MAX_DATA_DEPTH,
  SB_SOURCE_MAX_DATA_VALUES,
  SB_SOURCE_MAX_TEXT_BYTES,
} from './sbSourceContract.js';

const forbiddenKeys = new Set(['__proto__', 'prototype', 'constructor']);
const knownRefusals = new WeakSet();

export function sourceRefusal(code, path, reason) {
  const refusal = { code, path, reason };
  knownRefusals.add(refusal);
  return refusal;
}

export function isSourceRefusal(value) {
  return value !== null && typeof value === 'object' && knownRefusals.has(value);
}

export function isSourceRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

export function copySourceData(input) {
  const ancestors = new Set();
  let valueCount = 0;
  let textBytes = 0;
  const encoder = new TextEncoder();

  function refuse(code, path, reason) {
    throw sourceRefusal(code, path, reason);
  }

  function countText(text, path) {
    if (text.length > SB_SOURCE_MAX_TEXT_BYTES) refuse('sourceTooLarge', path, 'Source exceeds the 64 KiB text budget');
    textBytes += encoder.encode(text).length;
    if (textBytes > SB_SOURCE_MAX_TEXT_BYTES) refuse('sourceTooLarge', path, 'Source exceeds the 64 KiB text budget');
  }

  function copy(value, path, depth) {
    valueCount += 1;
    if (valueCount > SB_SOURCE_MAX_DATA_VALUES || depth > SB_SOURCE_MAX_DATA_DEPTH) {
      refuse('sourceSafetyLimit', path, 'Source exceeds the bounded data traversal limit');
    }
    if (value === null || value === undefined || typeof value === 'boolean') return value;
    if (typeof value === 'string') {
      countText(value, path);
      return value;
    }
    if (typeof value === 'number') {
      if (!Number.isFinite(value)) refuse('nonFiniteSourceValue', path, 'Source numbers must be finite');
      return value;
    }
    if (typeof value !== 'object') refuse('invalidSourceValue', path, 'Source must contain data, not executable or opaque values');
    if (ancestors.has(value)) refuse('cycleDetected', path, 'Source contains an ancestor reference');
    if (!Array.isArray(value) && !isSourceRecord(value)) refuse('invalidSourceObject', path, 'Source objects must be plain records');
    const keys = Reflect.ownKeys(value);
    if (keys.length + valueCount > SB_SOURCE_MAX_DATA_VALUES) refuse('sourceSafetyLimit', path, 'Source object exceeds the traversal budget');
    const descriptors = Object.getOwnPropertyDescriptors(value);
    const copied = Array.isArray(value) ? [] : {};
    ancestors.add(value);
    if (Array.isArray(value)) {
      if (value.length > SB_SOURCE_MAX_DATA_VALUES) refuse('sourceSafetyLimit', path, 'Source array exceeds the traversal budget');
      for (let index = 0; index < value.length; index += 1) {
        if (!Object.hasOwn(descriptors, index)) refuse('sparseSourceArray', `${path}/${index}`, 'Sparse source arrays are not supported');
      }
    }
    for (const key of keys) {
      if (Array.isArray(value) && key === 'length') continue;
      if (typeof key !== 'string' || forbiddenKeys.has(key)) refuse('unsafeSourceKey', path, 'Source contains an unsupported property key');
      const descriptor = descriptors[key];
      if (!Object.hasOwn(descriptor, 'value') || !descriptor.enumerable) refuse('invalidSourceProperty', `${path}/${key}`, 'Source properties must be enumerable data values');
      if (Array.isArray(value) && !/^(0|[1-9][0-9]*)$/.test(key)) refuse('invalidSourceArray', `${path}/${key}`, 'Source arrays cannot contain named properties');
      countText(key, path);
      copied[key] = copy(descriptor.value, `${path}/${key}`, depth + 1);
    }
    ancestors.delete(value);
    return copied;
  }

  try {
    const value = copy(input, '$', 0);
    const serialized = JSON.stringify(value, (key, entry) => entry === undefined ? null : entry);
    if (serialized.length > SB_SOURCE_MAX_TEXT_BYTES || encoder.encode(serialized).length > SB_SOURCE_MAX_TEXT_BYTES) refuse('sourceTooLarge', '$', 'Source exceeds the 64 KiB serialized data budget');
    return { ok: true, value, refusals: [] };
  } catch (error) {
    const refusal = isSourceRefusal(error)
      ? error
      : sourceRefusal('unreadableSource', '$', 'Source is not inspectable as a bounded plain-data value');
    return { ok: false, value: null, refusals: [refusal] };
  }
}

export function freezeSourceData(value) {
  if (value === null || typeof value !== 'object' || Object.isFrozen(value)) return value;
  for (const child of Object.values(value)) freezeSourceData(child);
  return Object.freeze(value);
}

export function preserveSourceInput(input) {
  const copied = copySourceData(input);
  return Object.freeze({ input, originalText: typeof input === 'string' ? input : null, snapshotAvailable: copied.ok, snapshot: copied.ok ? freezeSourceData(copied.value) : undefined });
}
