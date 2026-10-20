const callbackNames = new Set(['onBeforeCompile', 'customProgramCacheKey']);

function refuseMutation() {
  return false;
}

export function createSubstrateSmHostMaterialView({ material, binding } = {}) {
  if (!material || typeof material !== 'object' || Array.isArray(material)
    || typeof binding?.getState !== 'function' || typeof binding?.getHostCallbacks !== 'function') {
    throw new TypeError('SSM_HOST_MATERIAL_VIEW_REQUIRED');
  }
  return new Proxy(material, {
    get(target, name) {
      if (callbackNames.has(name)) {
        const state = binding.getState();
        const attached = state.programKey != null && !state.disposed
          && state.reason !== 'SSM_BINDING_HOST_STRIPPED';
        if (attached) return binding.getHostCallbacks()[name];
      }
      return Reflect.get(target, name, target);
    },
    set: refuseMutation,
    defineProperty: refuseMutation,
    deleteProperty: refuseMutation,
    setPrototypeOf: refuseMutation,
    preventExtensions: refuseMutation,
  });
}
