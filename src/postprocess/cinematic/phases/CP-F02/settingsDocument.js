import { hasOwn, requireKeys, requireRecord, requireIdentifier, requireNumber, requireBoolean, freezeData, canonicalStringify } from "./settingsValidation.js";
import { requireSettingsSchema, validatePropertyValue } from "./settingsSchema.js";
import { validateVolumeBounds } from "./volumeGeometry.js";

export const SETTINGS_DOCUMENT_VERSION = 1;

function readOptional(input, output, name, validate) {
  if (hasOwn(input, name)) output[name] = validate(input[name], name);
}

function normalizeOverrides(schema, input) {
  requireRecord(input, "Overrides");
  const overrides = {};
  for (const name of Object.keys(input).sort()) {
    const property = schema.get(name);
    if (!property) throw new TypeError(`Unknown setting ${name}`);
    const entry = requireKeys(input[name], ["enabled", "value"], name);
    if (!hasOwn(entry, "value")) throw new TypeError(`${name} override requires a value`);
    const normalized = { value: entry.value === null || entry.value === "AUTO" ? entry.value : validatePropertyValue(property, entry.value) };
    readOptional(entry, normalized, "enabled", requireBoolean);
    overrides[name] = normalized;
  }
  return overrides;
}

function normalizeLayer(schema, input) {
  const layer = {};
  readOptional(input, layer, "enabled", requireBoolean);
  readOptional(input, layer, "blendWeight", (value, label) => requireNumber(value, label, 0, 1));
  layer.overrides = normalizeOverrides(schema, hasOwn(input, "overrides") ? input.overrides : {});
  return layer;
}

function normalizeVolume(schema, input) {
  requireKeys(input, ["id", "enabled", "blendWeight", "overrides", "priority", "blendRadius", "unbound", "bounds"], "Volume");
  const volume = { id: requireIdentifier(input.id, "Volume id"), ...normalizeLayer(schema, input) };
  readOptional(input, volume, "priority", requireNumber);
  readOptional(input, volume, "blendRadius", (value, label) => requireNumber(value, label, 0));
  readOptional(input, volume, "unbound", requireBoolean);
  if (hasOwn(input, "bounds")) volume.bounds = validateVolumeBounds(input.bounds);
  if (volume.unbound !== true && !volume.bounds) throw new TypeError(`Bound volume ${volume.id} requires bounds`);
  return volume;
}

export function createSettingsDocument(schema, input = {}) {
  requireSettingsSchema(schema);
  requireKeys(input, ["version", "schemaId", "schemaVersion", "defaults", "global", "volumes", "cameras"], "Settings document");
  if (hasOwn(input, "version") && input.version !== SETTINGS_DOCUMENT_VERSION) throw new TypeError("Unsupported settings document version; explicit migration is required");
  if (hasOwn(input, "schemaId") && input.schemaId !== schema.id || hasOwn(input, "schemaVersion") && input.schemaVersion !== schema.version) throw new TypeError("Settings schema identity/version mismatch");
  const defaults = normalizeOverrides(schema, hasOwn(input, "defaults") ? input.defaults : {});
  const globalInput = hasOwn(input, "global") ? input.global : {};
  requireKeys(globalInput, ["enabled", "blendWeight", "overrides"], "Global layer");
  const volumeInput = hasOwn(input, "volumes") ? input.volumes : [];
  if (!Array.isArray(volumeInput)) throw new TypeError("Volumes must be an array");
  const volumes = Array.from(volumeInput, (volume) => normalizeVolume(schema, volume));
  if (new Set(volumes.map((volume) => volume.id)).size !== volumes.length) throw new TypeError("Volume ids must be unique");
  const cameraInput = hasOwn(input, "cameras") ? input.cameras : {};
  requireRecord(cameraInput, "Cameras");
  const cameras = {};
  for (const viewId of Object.keys(cameraInput).sort()) {
    requireIdentifier(viewId, "Camera view id");
    requireKeys(cameraInput[viewId], ["enabled", "blendWeight", "overrides"], "Camera layer");
    cameras[viewId] = normalizeLayer(schema, cameraInput[viewId]);
  }
  return freezeData({ version: SETTINGS_DOCUMENT_VERSION, schemaId: schema.id, schemaVersion: schema.version, defaults, global: normalizeLayer(schema, globalInput), volumes, cameras });
}

export function serializeSettingsDocument(schema, document) {
  return canonicalStringify(createSettingsDocument(schema, document));
}

export function deserializeSettingsDocument(schema, text) {
  if (typeof text !== "string") throw new TypeError("Serialized settings must be text");
  return createSettingsDocument(schema, JSON.parse(text));
}

export function settingsDocumentSignatures(document) {
  const ordered = [...document.volumes].sort((left, right) => left.id < right.id ? -1 : left.id > right.id ? 1 : 0);
  return {
    spatial: canonicalStringify(ordered.map(({ id, enabled, blendWeight, priority, blendRadius, unbound, bounds }) => ({ id, enabled, blendWeight, priority, blendRadius, unbound, bounds }))),
    parameters: canonicalStringify({ defaults: document.defaults, global: document.global, cameras: document.cameras, volumes: ordered.map(({ id, overrides }) => ({ id, overrides })) })
  };
}
