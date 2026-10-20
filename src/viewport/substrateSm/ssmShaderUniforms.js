export function createSubstrateSmReadOnlyUniforms(uniforms) {
  const proxies = new WeakMap();
  const originals = new WeakMap();
  const numericSnapshots = [];

  function readOnly(value) {
    if (value === null || typeof value !== 'object') return value;
    if (proxies.has(value)) return proxies.get(value);
    if (ArrayBuffer.isView(value)) {
      if (value instanceof DataView || value.byteLength > 1048576) throw new TypeError('SSM_TRANSFORM_UNIFORM_INSPECTION_LIMIT');
      const snapshot = value.slice();
      proxies.set(value, snapshot);
      numericSnapshots.push({ original: value, snapshot });
      return snapshot;
    }
    const proxy = new Proxy(Object.create(null), {
      get(target, key) {
        const entry = value[key];
        if (typeof entry === 'function') throw new TypeError('SSM_TRANSFORM_UNIFORM_METHOD_FORBIDDEN');
        return readOnly(entry);
      },
      has(target, key) { return key in value; },
      ownKeys() { return Reflect.ownKeys(value); },
      getOwnPropertyDescriptor(target, key) {
        if (!Object.hasOwn(value, key)) return undefined;
        return { value: readOnly(value[key]), enumerable: true, configurable: true, writable: false };
      },
      set() { throw new TypeError('SSM_TRANSFORM_UNIFORM_MUTATION'); },
      deleteProperty() { throw new TypeError('SSM_TRANSFORM_UNIFORM_MUTATION'); },
      defineProperty() { throw new TypeError('SSM_TRANSFORM_UNIFORM_MUTATION'); },
      setPrototypeOf() { throw new TypeError('SSM_TRANSFORM_UNIFORM_MUTATION'); },
      preventExtensions() { throw new TypeError('SSM_TRANSFORM_UNIFORM_MUTATION'); },
    });
    proxies.set(value, proxy);
    originals.set(proxy, value);
    return proxy;
  }

  const view = Object.freeze(Object.fromEntries(Object.entries(uniforms).map(([name, holder]) => [name, readOnly(holder)])));

  function resolve(next) {
    if (!next || typeof next !== 'object' || Array.isArray(next)) throw new TypeError('SSM_TRANSFORM_UNIFORMS_REQUIRED');
    const result = {};
    for (const [name, holder] of Object.entries(next)) {
      const original = originals.get(holder) ?? holder;
      if (Object.hasOwn(uniforms, name) && original !== uniforms[name]) {
        throw new TypeError(`SSM_TRANSFORM_HOLDER_REPLACED:${name}`);
      }
      if (!original || typeof original !== 'object' || !Object.hasOwn(original, 'value')) {
        throw new TypeError(`SSM_TRANSFORM_HOLDER_REQUIRED:${name}`);
      }
      Object.defineProperty(result, name, { value: original, enumerable: true, writable: true, configurable: true });
    }
    for (const { original, snapshot } of numericSnapshots) {
      if (snapshot.length !== original.length || snapshot.some((value, index) => value !== original[index])) {
        throw new TypeError('SSM_TRANSFORM_UNIFORM_MUTATION');
      }
    }
    for (const name of Object.keys(uniforms)) {
      if (!Object.hasOwn(result, name)) throw new TypeError(`SSM_TRANSFORM_HOLDER_REMOVED:${name}`);
    }
    return result;
  }

  return { view, resolve };
}
