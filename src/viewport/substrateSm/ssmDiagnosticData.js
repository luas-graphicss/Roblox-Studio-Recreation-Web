export function copySubstrateSmDiagnosticData(value) {
  const ancestors = new WeakSet();
  let remaining = 2048;
  let remainingText = 32768;
  function copy(input, depth) {
    if (--remaining < 0 || depth > 8) return '[limit]';
    if (input == null) return null;
    if (typeof input === 'string') {
      const length = Math.min(input.length, 4096, remainingText);
      remainingText -= length;
      return length < input.length ? input.slice(0, length) + '[truncated]' : input;
    }
    if (typeof input === 'boolean') return input;
    if (typeof input === 'number') return Number.isFinite(input) ? input : '[non-finite]';
    if (typeof input !== 'object') return '[unavailable]';
    if (ancestors.has(input)) return '[circular]';
    const prototype = Object.getPrototypeOf(input);
    if (!Array.isArray(input) && prototype !== Object.prototype && prototype !== null) return '[non-data]';
    ancestors.add(input);
    const result = Array.isArray(input) ? [] : {};
    const keys = Array.isArray(input) ? Array.from({ length: Math.min(input.length, 128) }, (_, index) => String(index)) : Object.keys(input);
    for (const key of keys.slice(0, 128)) {
      const descriptor = Object.getOwnPropertyDescriptor(input, key);
      const item = descriptor && Object.hasOwn(descriptor, 'value') ? copy(descriptor.value, depth + 1) : '[accessor]';
      Object.defineProperty(result, key, { value: item, enumerable: true, writable: true, configurable: true });
    }
    if (Array.isArray(input) && input.length > 128) result.push('[truncated]');
    else if (keys.length > 128) Object.defineProperty(result, 'truncated', { value: true, enumerable: true });
    ancestors.delete(input);
    return Object.freeze(result);
  }
  return copy(value, 0);
}

export function readSubstrateSmDiagnosticSource(reader) {
  if (typeof reader !== 'function') return Object.freeze({ available: false, reason: 'SSM_QA_SOURCE_UNAVAILABLE', value: null });
  try {
    const value = reader();
    if (value instanceof Promise) {
      value.catch(() => {});
      throw new Error('SSM_QA_SYNCHRONOUS_SOURCE_REQUIRED');
    }
    return Object.freeze({ available: true, reason: null, value: copySubstrateSmDiagnosticData(value) });
  } catch (error) {
    return Object.freeze({ available: false, reason: String(error?.message ?? error).slice(0, 512), value: null });
  }
}

export function readSubstrateSmProgramDescriptor(key) {
  const prefix = 'ssm/program/v1:';
  if (key?.kind !== 'program' || typeof key.signature !== 'string'
    || !key.signature.startsWith(prefix) || key.signature.length > 8192) return null;
  try {
    const value = JSON.parse(key.signature.slice(prefix.length));
    return copySubstrateSmDiagnosticData({ family: value.family, hostBackend: value.hostBackend,
      patchGeneration: value.patchGeneration, contractVersion: value.contractVersion, recipeVersion: value.recipeVersion });
  } catch { return null; }
}

export function substrateSmBindingStamp(state) {
  return JSON.stringify([state?.reason ?? null, state?.disposed === true,
    state?.sourceRevision ?? null, state?.contextGeneration ?? null,
    state?.programKey?.signature ?? null, state?.uniformRevision ?? null, (state?.shaderCommitted ?? state?.applied) === true]);
}
