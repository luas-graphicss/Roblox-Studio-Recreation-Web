import { createSettingsSchema, DEFAULT_SETTINGS_SCHEMA, createSettingsDocument } from "../CP-F02/index.js";
import { createPostProcessMaterialSession } from "../CP-F26/index.js";
import { OUTPUT_DEFAULTS, resolveOutputSettings } from "../CP-F28/outputSettings.js";
import { AUTHORING_API_VERSION, AUTHORING_DOCUMENT_VERSION, AUTHORING_SECTIONS } from "./authoringContract.js";
import { copyAuthoringData, freezeAuthoringData, canonicalJson, requireKeys, requireRecord, requireIdentifier, reject, validateDependency, translateAuto } from "./authoringData.js";
import { validateCameraAuthoring } from "./cameraAuthoring.js";
import { validateAssets, validateCurves } from "./authoringAssets.js";
import { exceedsAuthoringTextBudget } from "./authoringText.js";

export function schemaDefinition(schema = DEFAULT_SETTINGS_SCHEMA) { return { id: schema.id, version: schema.version, properties: schema.properties }; }
function validateState(input) {
  const definition = input.settingsSchema === undefined ? schemaDefinition() : input.settingsSchema;
  const schema = validateDependency("$.settingsSchema", () => createSettingsSchema(definition));
  const settings = validateDependency("$.settings", () => createSettingsDocument(schema, input.settings));
  const camera = validateCameraAuthoring(input.camera);
  const materials = input.materials === undefined ? [] : input.materials;
  const materialSession = validateDependency("$.materials", () => createPostProcessMaterialSession(materials));
  if (materialSession.plan.rejected.length) {
    const first = materialSession.plan.rejected[0];
    reject("invalid-material", `$.materials.${first.index}`, first.message);
  }
  for (const material of materialSession.plan.materials) if (material.volumeWeight?.resource === "CP-F02.resolvedSettings") {
    const property = schema.get(material.volumeWeight.property);
    if (!property || property.kind !== "number" || !Number.isFinite(property.minimum) || !Number.isFinite(property.maximum) || property.minimum < 0 || property.maximum > 1) reject("invalid-material-weight", `$.materials.${material.id}`, "Resolved material weights require a number schema property in [0, 1]");
  }
  const materialControls = requireRecord(input.materialControls === undefined ? {} : input.materialControls, "$.materialControls");
  for (const [id, controls] of Object.entries(materialControls)) {
    requireKeys(controls, ["enabled", "weight", "parameters"], `$.materialControls.${id}`);
    validateDependency(`$.materialControls.${id}`, () => materialSession.update(id, controls));
  }
  const output = requireKeys(input.output === undefined ? {} : input.output, Object.keys(OUTPUT_DEFAULTS), "$.output");
  validateDependency("$.output", () => resolveOutputSettings(translateAuto(output)));
  const lighting = requireRecord(input.lighting === undefined ? {} : input.lighting, "$.lighting");
  for (const [name, entry] of Object.entries(lighting)) {
    requireIdentifier(name, "$.lighting"); requireKeys(entry, ["enabled", "value"], `$.lighting.${name}`);
    if (!Object.hasOwn(entry, "value") || entry.enabled !== undefined && typeof entry.enabled !== "boolean") reject("invalid-lighting-override", `$.lighting.${name}`, "Lighting requires value and an optional boolean enabled flag");
  }
  const flags = requireRecord(input.flags === undefined ? {} : input.flags, "$.flags");
  for (const [name, value] of Object.entries(flags)) {
    requireIdentifier(name, "$.flags");
    if (typeof value !== "boolean") reject("invalid-flag", `$.flags.${name}`, "Expected a boolean flag");
  }
  return { settingsSchema: schemaDefinition(schema), settings, camera, materials, materialControls, output, lighting, assets: validateAssets(input.assets), curves: validateCurves(input.curves), flags };
}
export function createPostProcessDocument(authored = {}) {
  const input = copyAuthoringData(authored);
  requireKeys(input, ["version", "apiVersion", ...AUTHORING_SECTIONS, "presets", "extensions"], "$");
  if (input.version !== undefined && input.version !== AUTHORING_DOCUMENT_VERSION) reject("unsupported-version", "$.version", "Explicit migration is required");
  if (input.apiVersion !== undefined && input.apiVersion !== AUTHORING_API_VERSION) reject("unsupported-api", "$.apiVersion", "Unsupported API version");
  const state = validateState(input);
  const presets = input.presets === undefined ? [] : input.presets;
  if (!Array.isArray(presets) || presets.length > 128) reject("invalid-presets", "$.presets", "Expected at most 128 presets");
  const identifiers = new Set();
  const validatedPresets = presets.map((preset, index) => {
    requireKeys(preset, ["id", "name", "state"], `$.presets.${index}`);
    const id = requireIdentifier(preset.id, `$.presets.${index}.id`);
    if (identifiers.has(id)) reject("duplicate-preset", `$.presets.${index}.id`, "Preset ids must be unique");
    identifiers.add(id);
    if (typeof preset.name !== "string" || !preset.name.trim() || preset.name.length > 120) reject("invalid-preset-name", `$.presets.${index}`, "Expected a short nonempty name");
    requireKeys(preset.state, AUTHORING_SECTIONS, `$.presets.${index}.state`);
    return { id, name: preset.name, state: validateState(preset.state) };
  });
  const result = { version: AUTHORING_DOCUMENT_VERSION, apiVersion: AUTHORING_API_VERSION, ...state, presets: validatedPresets, extensions: requireRecord(input.extensions === undefined ? {} : input.extensions, "$.extensions") };
  if (exceedsAuthoringTextBudget(canonicalJson(result))) reject("document-limit", "$", "Document exceeds the persistence budget");
  return freezeAuthoringData(result);
}
export function capturePresetState(document) { return Object.fromEntries(AUTHORING_SECTIONS.map(section => [section, document[section]])); }
