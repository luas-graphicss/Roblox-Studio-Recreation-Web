import { requireExposureObject } from "./exposureValidation.js";
export { validateMeteringResource } from "./exposureMeteringResource.js";

export function resolveExposureBinding(authored) {
  if (authored === undefined || authored === null) return null;
  requireExposureObject(authored, "CP-F09.binding");
  const allowed = ["meteringResource", "applyToColor", "order"];
  for (const key of Object.keys(authored)) if (!allowed.includes(key)) throw new TypeError(`Unknown exposure binding: ${key}`);
  if (!("meteringResource" in authored)) throw new TypeError("Exposure binding requires an explicit meteringResource; use null for manual-only");
  const name = authored.meteringResource;
  if (name !== null && (typeof name !== "string" || !name.trim() || name.startsWith("CP-F09.") || name === "$color")) {
    throw new TypeError("Metering input must be a named upstream resource, not color or CP-F09 feedback");
  }
  const order = authored.order ?? 900;
  if (!Number.isInteger(order) || order < 0 || order >= Number.MAX_SAFE_INTEGER) throw new TypeError("Exposure pass order must be a non-negative safe integer");
  const applyToColor = authored.applyToColor ?? true;
  if (typeof applyToColor !== "boolean") throw new TypeError("applyToColor must be boolean");
  return Object.freeze({ meteringResource: name, applyToColor, order });
}
