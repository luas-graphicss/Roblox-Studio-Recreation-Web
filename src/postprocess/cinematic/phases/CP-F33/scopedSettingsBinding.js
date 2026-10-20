import { callSynchronousHost } from "./synchronousHost.js";

export function createScopedSettingsBinding(settings) {
  if (typeof settings?.get !== "function" || typeof settings?.set !== "function") throw new TypeError("CP-F33 requires a settings store with get and set");
  const bindings = new Map();
  let disposed = false;

  function read(key) {
    return callSynchronousHost(settings, "get", key);
  }

  function writeAcknowledged(key, value) {
    callSynchronousHost(settings, "set", key, value);
    if (!Object.is(read(key), value)) throw new Error(`CP-F33 settings write was not acknowledged: ${key}`);
  }

  function verify() {
    if (disposed) throw new Error("Settings binding is disposed");
    for (const [key, record] of bindings) if (!Object.is(read(key), record.current)) throw new Error(`CP-F33 settings ownership changed: ${key}`);
  }

  function restore(key) {
    const record = bindings.get(key);
    if (!record) return;
    try {
      if (Object.is(read(key), record.current)) writeAcknowledged(key, record.previous);
    } catch (error) {
      try {
        if (Object.is(read(key), record.previous)) bindings.delete(key);
      } catch (readError) {
        throw new AggregateError([error, readError], "Settings restoration and host readback failed");
      }
      throw error;
    }
    bindings.delete(key);
  }

  function write(key, value) {
    verify();
    const existing = bindings.get(key);
    const previous = read(key);
    const record = existing ?? { previous, current: previous };
    bindings.set(key, record);
    try {
      writeAcknowledged(key, value);
      record.current = value;
    } catch (error) {
      try {
        if (Object.is(read(key), value)) writeAcknowledged(key, previous);
        if (!existing) bindings.delete(key);
      } catch (rollbackError) {
        record.current = value;
        throw new AggregateError([error, rollbackError], "Settings write failed and host rollback reported errors");
      }
      throw error;
    }
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    const errors = [];
    for (const key of [...bindings.keys()]) {
      try { restore(key); }
      catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, "Settings cleanup reported host errors");
  }

  return Object.freeze({ verify, write, restore, dispose });
}
