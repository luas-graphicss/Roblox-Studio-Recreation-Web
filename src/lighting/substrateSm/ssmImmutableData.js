export function copySubstrateSmImmutableData(value) {
  const ancestors = new Set();

  function copy(current) {
    if (typeof current === 'function' || typeof current === 'symbol' || typeof current === 'bigint') {
      throw new TypeError('Owned compilation data must not contain executable or non-JSON values');
    }
    if (current === null || typeof current !== 'object') return current;
    if (ancestors.has(current)) throw new TypeError('Owned compilation data must not contain cycles');
    ancestors.add(current);
    let result;
    if (Array.isArray(current)) {
      result = current.map(copy);
    } else {
      const prototype = Object.getPrototypeOf(current);
      if (prototype !== Object.prototype && prototype !== null) {
        throw new TypeError('Owned compilation data must use plain objects and arrays');
      }
      result = {};
      for (const key of Object.keys(current).sort()) {
        Object.defineProperty(result, key, { value: copy(current[key]), enumerable: true });
      }
    }
    ancestors.delete(current);
    return Object.freeze(result);
  }

  return copy(value);
}
