import { createSettingsSchema } from "../CP-F02/index.js";
import { createPostProcessDocument, schemaDefinition } from "./authoringDocument.js";
import { exceedsAuthoringTextBudget } from "./authoringText.js";
import { copyAuthoringData, requireKeys, requireRecord, requireIdentifier, freezeAuthoringData, canonicalJson, validateDependency, reject } from "./authoringData.js";

function migrateSettings(state, aliases, policy, diagnostics, quarantined, prefix) {
  const definition = state.settingsSchema === undefined ? schemaDefinition() : state.settingsSchema;
  validateDependency(`${prefix}.settingsSchema`, () => createSettingsSchema(definition));
  const names = new Set(definition.properties.map(property => property.name));
  const settings = requireRecord(state.settings === undefined ? {} : state.settings, `${prefix}.settings`);
  if (settings.volumes !== undefined && !Array.isArray(settings.volumes)) reject("invalid-volume-list", `${prefix}.settings.volumes`, "Expected a volume array");
  if (settings.global !== undefined) requireRecord(settings.global, `${prefix}.settings.global`);
  if (settings.cameras !== undefined) {
    requireRecord(settings.cameras, `${prefix}.settings.cameras`);
    for (const [id, layer] of Object.entries(settings.cameras)) requireRecord(layer, `${prefix}.settings.cameras.${id}`);
  }
  for (const [index, volume] of (settings.volumes ?? []).entries()) requireRecord(volume, `${prefix}.settings.volumes.${index}`);
  const layers = [["defaults", settings.defaults], ["global.overrides", settings.global?.overrides], ...(settings.volumes ?? []).map((volume, index) => [`volumes.${index}.overrides`, volume.overrides]), ...Object.entries(settings.cameras ?? {}).map(([id, layer]) => [`cameras.${id}.overrides`, layer.overrides])];
  for (const [layer, entries] of layers) {
    if (entries === undefined) continue;
    const path = `${prefix}.settings.${layer}`;
    requireRecord(entries, path);
    for (const name of Object.keys(entries)) {
      const destination = Object.hasOwn(aliases, name) ? aliases[name] : name;
      if (destination !== name) {
        if (!names.has(destination) || Object.hasOwn(entries, destination)) reject("migration-conflict", `${path}.${name}`, "Alias destination is unknown or already authored");
        entries[destination] = entries[name]; delete entries[name];
        diagnostics.push({ code: "migrated-property", path: `${path}.${name}`, message: `Renamed to ${destination}` });
      } else if (!names.has(name) && policy === "quarantine") {
        quarantined.push({ path: `${path}.${name}`, value: entries[name] }); delete entries[name];
        diagnostics.push({ code: "quarantined-property", path: `${path}.${name}`, message: "Preserved as inactive extension data, never executed" });
      }
    }
  }
}
export function importPostProcessDocument(text, options = {}) {
  if (exceedsAuthoringTextBudget(text)) reject("invalid-import", "$", "Expected JSON within the import budget");
  const configuration = copyAuthoringData(options);
  requireKeys(configuration, ["propertyAliases", "unknownProperties", "settingsSchema"], "$.migration");
  const aliases = requireRecord(configuration.propertyAliases === undefined ? {} : configuration.propertyAliases, "$.migration.propertyAliases");
  for (const [source, destination] of Object.entries(aliases)) { requireIdentifier(source, "$.migration"); requireIdentifier(destination, "$.migration"); }
  const policy = configuration.unknownProperties === undefined ? "reject" : configuration.unknownProperties;
  if (!["reject", "quarantine"].includes(policy)) reject("invalid-migration-policy", "$", "Unknown property policy");
  let parsed;
  try { parsed = JSON.parse(text); } catch { reject("invalid-json", "$", "Invalid JSON document"); }
  const input = copyAuthoringData(parsed);
  requireRecord(input, "$");
  const diagnostics = [];
  const quarantined = [];
  if (input.version === 1) {
    if (Object.hasOwn(input, "cameraSettings") && Object.hasOwn(input, "camera") || Object.hasOwn(input, "outputSettings") && Object.hasOwn(input, "output")) reject("migration-conflict", "$", "Both current and legacy section names are present");
    if (Object.hasOwn(input, "cameraSettings")) { input.camera = { global: input.cameraSettings, views: {} }; delete input.cameraSettings; }
    if (Object.hasOwn(input, "outputSettings")) { input.output = input.outputSettings; delete input.outputSettings; }
    input.version = 2;
    diagnostics.push({ code: "migrated-version", path: "$.version", message: "Migrated v1 cameraSettings/outputSettings to v2 camera.global/output" });
  }
  if (input.presets !== undefined && !Array.isArray(input.presets)) reject("invalid-presets", "$.presets", "Expected a preset array");
  for (const [index, preset] of (input.presets ?? []).entries()) requireRecord(preset, `$.presets.${index}`);
  const states = [["$", input], ...(input.presets ?? []).map((preset, index) => [`$.presets.${index}.state`, preset.state])];
  for (const [prefix, state] of states) {
    requireRecord(state, prefix);
    if (Object.hasOwn(configuration, "settingsSchema")) {
      validateDependency("$.migration.settingsSchema", () => createSettingsSchema(configuration.settingsSchema));
      state.settingsSchema = configuration.settingsSchema;
      if (state.settings) { state.settings.schemaId = configuration.settingsSchema.id; state.settings.schemaVersion = configuration.settingsSchema.version; }
      diagnostics.push({ code: "migrated-schema", path: prefix, message: "Used the explicitly supplied replacement schema" });
    }
    migrateSettings(state, aliases, policy, diagnostics, quarantined, prefix);
  }
  if (quarantined.length) {
    if (input.extensions === undefined) input.extensions = {};
    requireRecord(input.extensions, "$.extensions");
    if (Object.hasOwn(input.extensions, "unmappedSettings") && !Array.isArray(input.extensions.unmappedSettings)) reject("migration-conflict", "$.extensions.unmappedSettings", "Expected a quarantine list");
    input.extensions.unmappedSettings = [...input.extensions.unmappedSettings ?? [], ...quarantined];
  }
  return freezeAuthoringData({ document: createPostProcessDocument(input), diagnostics });
}
export function exportPostProcessDocument(document) { return canonicalJson(createPostProcessDocument(document)); }
