export const QA_OWNER = "CP-F35";
export const QA_SETTINGS_KEY = "CP-F35.audit";
export const QA_RESOURCE = "CP-F35.frameAudit";
export const QA_SCHEMA_VERSION = "1.0.0";

export function resolveAuditSettings(input) {
  if (input === undefined || input === null) input = {};
  if (typeof input !== "object" || Array.isArray(input))
    throw new TypeError("Audit settings must be an object");
  const allowed = new Set(["capturePixels", "strict", "resourceNames"]);
  for (const name of Object.keys(input))
    if (!allowed.has(name))
      throw new TypeError(`Unknown audit setting: ${name}`);
  for (const name of ["capturePixels", "strict"])
    if (input[name] !== undefined && typeof input[name] !== "boolean")
      throw new TypeError(`${name} must be boolean`);
  const resourceNames = input.resourceNames ?? [];
  if (
    !Array.isArray(resourceNames) ||
    resourceNames.length > 64 ||
    resourceNames.some(
      (name) =>
        typeof name !== "string" ||
        !name.trim() ||
        name === "$color" ||
        name.startsWith(`${QA_OWNER}.`),
    )
  )
    throw new TypeError(
      "Audit resource names must be explicit upstream bindings",
    );
  if (new Set(resourceNames).size !== resourceNames.length)
    throw new TypeError("Duplicate audit resource binding");
  return Object.freeze({
    capturePixels: input.capturePixels ?? false,
    strict: input.strict ?? false,
    resourceNames: Object.freeze([...resourceNames]),
  });
}
