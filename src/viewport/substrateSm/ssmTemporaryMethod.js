export function replaceSubstrateSmDiagnosticMethod(target, name, createWrapper) {
  const descriptor = Object.getOwnPropertyDescriptor(target, name);
  const original = target[name];
  if (typeof original !== 'function' || (descriptor && !Object.hasOwn(descriptor, 'value'))) {
    throw new Error('SSM_QA_METHOD_UNAVAILABLE:' + name);
  }
  const wrapper = createWrapper(original);
  Object.defineProperty(target, name, descriptor ? { ...descriptor, value: wrapper }
    : { value: wrapper, writable: true, configurable: true, enumerable: false });
  let restored = false;
  return () => {
    if (restored) return true;
    if (target[name] !== wrapper) return false;
    if (descriptor) Object.defineProperty(target, name, descriptor);
    else delete target[name];
    restored = true;
    return true;
  };
}
