import { DEFAULT_OWNERSHIP, OWNERSHIP_ROLES } from "./adapterContract.js";
import { requireSettingsObject } from "./adapterValidation.js";

const allowedKeys = new Set(["enabled", "safeMode", "environment", "packageRevision", "renderScale", "settings", "ownership", "output"]);
const defaults = Object.freeze({
  enabled: null, safeMode: false, environment: "isolated", packageRevision: "CP-F34-api1",
  renderScale: 1, settings: Object.freeze({}), ownership: DEFAULT_OWNERSHIP,
  output: Object.freeze({ encoding: "display-srgb", transfer: "srgb", colorSpace: "rec709", exposureApplications: 1, toneMappingApplications: 1, outputTransferApplications: 1 })
});

export function validateOwnership(ownership) {
  if (!ownership || typeof ownership !== "object") throw new TypeError("Explicit ownership is required");
  if (Object.keys(ownership).length !== OWNERSHIP_ROLES.length) throw new TypeError("Unexpected ownership role");
  for (const role of OWNERSHIP_ROLES) {
    if (!["host", "package"].includes(ownership[role])) throw new TypeError(`Exactly one owner is required for ${role}`);
  }
  for (const role of ["sceneCapture", "lighting", "presentation"]) {
    if (ownership[role] !== "host") throw new Error(`${role} must remain host-owned`);
  }
  return Object.freeze({ ...ownership });
}

export function normalizeConfiguration(patch = {}, previous = defaults) {
  if (!patch || typeof patch !== "object" || Array.isArray(patch)) throw new TypeError("Configuration must be an object");
  for (const key of Object.keys(patch)) if (!allowedKeys.has(key)) throw new TypeError(`Unknown configuration: ${key}`);
  const next = { ...previous, ...patch };
  if (![true, false, null].includes(next.enabled)) throw new TypeError("enabled must be true, false or null");
  if (typeof next.safeMode !== "boolean") throw new TypeError("safeMode must be boolean");
  if (!["isolated", "engine"].includes(next.environment)) throw new TypeError("Invalid environment");
  if (typeof next.packageRevision !== "string" || !next.packageRevision.trim()) throw new TypeError("packageRevision is required");
  if (typeof next.renderScale !== "number" || !Number.isFinite(next.renderScale) || next.renderScale <= 0 || next.renderScale > 2) throw new TypeError("renderScale must be in (0, 2]");
  next.settings = requireSettingsObject(next.settings);
  next.ownership = validateOwnership(next.ownership);
  next.output = requireSettingsObject(next.output);
  for (const key of ["encoding", "transfer", "colorSpace"]) {
    if (typeof next.output[key] !== "string" || !next.output[key]) throw new TypeError(`Output ${key} is required`);
  }
  for (const key of ["exposureApplications", "toneMappingApplications", "outputTransferApplications"]) {
    if (next.output[key] !== 1) throw new TypeError(`Exactly one ${key} is required`);
  }
  return Object.freeze(next);
}
