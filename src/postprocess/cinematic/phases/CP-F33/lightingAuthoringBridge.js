import { requireIdentifier, requireRecord, copyAuthoringData, canonicalJson, reject } from "./authoringData.js";
import { callSynchronousHost } from "./synchronousHost.js";

export function createLightingAuthoringBridge(bindings) {
  requireRecord(bindings, "$.lightingBindings");
  const owned = new Map();
  for (const [name, binding] of Object.entries(bindings)) {
    requireIdentifier(name, "$.lightingBindings");
    if (![binding?.read, binding?.write, binding?.validate].every(value => typeof value === "function")) throw new TypeError("Lighting bindings require explicit read, write and validate functions");
  }
  function read(name) { return copyAuthoringData(callSynchronousHost(bindings[name], "read")); }
  function writeAcknowledged(name, value) {
    callSynchronousHost(bindings[name], "write", copyAuthoringData(value));
    if (canonicalJson(read(name)) !== canonicalJson(value)) throw new Error(`Lighting write was not acknowledged: ${name}`);
  }
  function ownsSignature(record, signature) {
    return signature === record.currentSignature || record.recoverySignatures?.includes(signature) === true;
  }
  function validate(lighting) {
    for (const [name, entry] of Object.entries(lighting)) {
      if (!Object.hasOwn(bindings, name)) reject("missing-lighting-binding", `$.lighting.${name}`, "No explicit host binding is registered");
      if (entry.value !== null && entry.value !== "AUTO" && callSynchronousHost(bindings[name], "validate", copyAuthoringData(entry.value)) === false) reject("invalid-lighting-value", `$.lighting.${name}`, "The host rejected this lighting value");
    }
  }
  function apply(lighting) {
    validate(lighting);
    const operations = []; const nextOwned = new Map();
    for (const name of new Set([...owned.keys(), ...Object.keys(lighting)])) {
      const entry = lighting[name]; const current = read(name); const signature = canonicalJson(current); const previous = owned.get(name);
      const active = entry && entry.enabled !== false && entry.value !== null && entry.value !== "AUTO";
      if (active) {
        if (previous && !ownsSignature(previous, signature)) throw new Error(`Lighting ownership changed: ${name}`);
        const nextSignature = canonicalJson(entry.value);
        nextOwned.set(name, { previous: previous ? previous.previous : current, currentSignature: nextSignature });
        if (signature !== nextSignature) operations.push({ name, previous: current, next: entry.value });
      } else if (previous && ownsSignature(previous, signature)) operations.push({ name, previous: current, next: previous.previous });
    }
    const applied = [];
    try {
      for (const operation of operations) {
        applied.push(operation);
        writeAcknowledged(operation.name, operation.next);
      }
    } catch (error) {
      const errors = [error];
      for (const operation of applied.reverse()) {
        try { writeAcknowledged(operation.name, operation.previous); }
        catch (rollbackError) {
          errors.push(rollbackError);
          const previousOwnership = owned.get(operation.name);
          owned.set(operation.name, {
            previous: previousOwnership ? previousOwnership.previous : operation.previous,
            currentSignature: canonicalJson(operation.next),
            recoverySignatures: [canonicalJson(operation.previous)]
          });
        }
      }
      if (errors.length > 1) throw new AggregateError(errors, "Lighting transaction failed and host rollback reported errors");
      throw error;
    }
    owned.clear(); for (const [name, record] of nextOwned) owned.set(name, record);
  }
  function release() {
    const errors = [];
    for (const [name, record] of owned) {
      try {
        if (ownsSignature(record, canonicalJson(read(name)))) writeAcknowledged(name, record.previous);
        owned.delete(name);
      } catch (error) { errors.push(error); }
    }
    if (errors.length) throw new AggregateError(errors, "Host lighting cleanup reported errors");
  }
  return Object.freeze({ validate, apply, release });
}
