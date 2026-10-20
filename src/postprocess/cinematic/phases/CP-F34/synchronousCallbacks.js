import { requireCallback, requireSynchronous } from "./adapterValidation.js";

export function requireSynchronousCallback(callback, name) {
  requireCallback(callback, name);
  const kind = Object.prototype.toString.call(callback);
  if (["[object AsyncFunction]", "[object GeneratorFunction]", "[object AsyncGeneratorFunction]"].includes(kind)) {
    throw new TypeError(`${name} must be a synchronous callback`);
  }
  return callback;
}

export function callSynchronousMethod(receiver, name, ...args) {
  const callback = requireSynchronousCallback(receiver?.[name], name);
  return requireSynchronous(Reflect.apply(callback, receiver, args), name);
}
