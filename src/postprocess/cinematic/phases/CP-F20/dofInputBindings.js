import { DOF_INPUT_ENCODINGS } from "./dofTemporalContract.js";

export function resolveDofBindings(input) {
  if (input == null) return null;
  if (typeof input !== "object" || Array.isArray(input)) throw new TypeError("CP-F20 bindings require an explicit object");
  const allowed = [...Object.keys(DOF_INPUT_ENCODINGS), "translucencyAfterDof"];
  for (const key of Object.keys(input)) if (!allowed.includes(key)) throw new TypeError(`Unknown CP-F20 binding: ${key}`);
  const bindings = {};
  for (const key of Object.keys(DOF_INPUT_ENCODINGS)) {
    const value = input[key];
    if (typeof value !== "string" || !value.trim() || value === "$color" || value.startsWith("CP-F20.")) throw new TypeError(`CP-F20 requires a producer binding for ${key}`);
    bindings[key] = value;
  }
  if (input.translucencyAfterDof != null) {
    const value = input.translucencyAfterDof;
    if (typeof value !== "string" || !value.trim() || value === "$color" || value.startsWith("CP-F20.")) throw new TypeError("Invalid after-DoF translucency binding");
    bindings.translucencyAfterDof = value;
  }
  if (new Set(Object.values(bindings)).size !== Object.keys(bindings).length) throw new Error("CP-F20 inputs require distinct named semantics");
  return Object.freeze(bindings);
}

export function assertDofBindingsUnchanged(settings, expected) {
  const current = resolveDofBindings(settings.get("CP-F20.bindings"));
  if (JSON.stringify(current) !== JSON.stringify(expected)) throw new Error("CP-F20 bindings changed; reinstall the phase to update declared dependencies");
}
