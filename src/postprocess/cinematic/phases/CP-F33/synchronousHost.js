export function callSynchronousHost(host, method, ...argumentsList) {
  const callback = host[method];
  if (typeof callback !== "function" || Object.prototype.toString.call(callback) === "[object AsyncFunction]") throw new TypeError(`Host ${method} must be synchronous`);
  const result = Reflect.apply(callback, host, argumentsList);
  if (result && typeof result.then === "function") {
    Promise.resolve(result).catch(() => {});
    throw new TypeError(`Host ${method} must be synchronous`);
  }
  return result;
}
