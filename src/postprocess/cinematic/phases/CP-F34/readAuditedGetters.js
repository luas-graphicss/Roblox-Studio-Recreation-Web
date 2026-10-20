import { AUDITED_GETTERS } from "./adapterContract.js";
import { callSynchronousMethod } from "./synchronousCallbacks.js";

export function readAuditedGetters(options) {
  const values = {};
  for (const name of AUDITED_GETTERS) {
    if (options[name] === undefined) continue;
    if (typeof options[name] !== "function") throw new TypeError(`${name} must be callable`);
    values[name] = callSynchronousMethod(options, name);
  }
  return Object.freeze(values);
}
