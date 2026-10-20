export function createSubstrateSmMaterialHooks(material) {
  const names = ['onBeforeCompile', 'customProgramCacheKey'];
  const originals = Object.fromEntries(names.map(name => [name, Object.getOwnPropertyDescriptor(material, name)]));
  const previousCompile = material.onBeforeCompile;
  const previousKey = material.customProgramCacheKey;
  if (typeof previousCompile !== 'function' || typeof previousKey !== 'function') {
    throw new TypeError('SSM_HOST_HOOKS_REQUIRED');
  }
  let installedCompile = null;
  let installedKey = null;

  function hostKey() {
    const descriptor = Object.getOwnPropertyDescriptor(material, 'onBeforeCompile');
    material.onBeforeCompile = previousCompile;
    try {
      const key = previousKey.call(material);
      if (typeof key !== 'string' || key.length > 16384) throw new TypeError('SSM_HOST_KEY_INVALID');
      return key;
    } finally {
      if (descriptor) Object.defineProperty(material, 'onBeforeCompile', descriptor);
      else delete material.onBeforeCompile;
    }
  }

  function install(compile, key) {
    installedCompile = compile;
    installedKey = key;
    material.onBeforeCompile = compile;
    material.customProgramCacheKey = key;
  }

  function attached() {
    return material.onBeforeCompile === installedCompile && material.customProgramCacheKey === installedKey;
  }

  function detached() {
    return material.onBeforeCompile === previousCompile && material.customProgramCacheKey === previousKey;
  }

  function restore(name, installed) {
    if (material[name] !== installed) return;
    if (originals[name]) Object.defineProperty(material, name, originals[name]);
    else delete material[name];
  }

  function detach() {
    restore('onBeforeCompile', installedCompile);
    restore('customProgramCacheKey', installedKey);
  }

  return Object.freeze({ previousCompile, previousKey, hostKey, install, attached, detached, detach });
}
