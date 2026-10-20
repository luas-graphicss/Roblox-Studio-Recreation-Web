import { createAuthoredField } from "./authoredField.js";

export function renderSettingsPanel(context) {
  const { elements, session, run, connectedSettings } = context; const document = session.snapshot().document;
  const content = elements.section("Global settings", "Values are resolved by CP-F02. Only explicitly connected consumers affect the rendered image.");
  const orderedProperties = [...document.settingsSchema.properties].sort((left, right) => Number(connectedSettings.includes(right.name)) - Number(connectedSettings.includes(left.name)));
  for (const property of orderedProperties) {
    const entry = document.settings.global.overrides[property.name];
    content.append(createAuthoredField(elements, run, {
      id: `cp33-setting-${property.name}`, label: property.name, value: entry?.value, defaultValue: property.defaultValue, minimum: property.minimum, maximum: property.maximum, step: property.kind === "integer" ? 1 : "any", choices: property.options, enabled: entry?.enabled,
      onChange(value) { session.edit(draft => { if (value === undefined) delete draft.settings.global.overrides[property.name]; else draft.settings.global.overrides[property.name] = { ...draft.settings.global.overrides[property.name], value }; }); },
      onEnabled(enabled) { session.edit(draft => { draft.settings.global.overrides[property.name] = { value: entry?.value ?? property.defaultValue, ...entry, enabled }; }); },
      description: connectedSettings.includes(property.name) ? "Connected to the diagnostic renderer" : "Resolved authoring data; no consumer registered in this workbench"
    }));
  }
  const materials = elements.section("Material controls", "CP-F26 keeps full shader descriptors separate from live parameters.");
  for (const material of document.materials) {
    if (material.location === "replacingTonemapper") { materials.append(elements.element("p", `${material.id}: fixed replacement owner. Reinstall to change its structure.`, { className: "cp33-description" })); continue; }
    for (const [name, parameter] of Object.entries(material.parameters)) materials.append(createAuthoredField(elements, run, {
      id: `cp33-material-${material.id}-${name}`, label: `${material.id} · ${name}`, value: document.materialControls[material.id]?.parameters?.[name], defaultValue: parameter.value, minimum: parameter.type === "float" ? 0 : undefined, maximum: parameter.type === "float" ? 8 : undefined,
      onChange(value) { session.edit(draft => { const controls = draft.materialControls[material.id] ??= {}; controls.parameters ??= {}; if (value === undefined) delete controls.parameters[name]; else controls.parameters[name] = value; }); }
    }));
  }
  const lighting = elements.section("Host lighting", "An explicit host binding owns this light; no legacy Lighting fields are inferred.");
  for (const [name, entry] of Object.entries(document.lighting)) lighting.append(createAuthoredField(elements, run, { id: `cp33-light-${name}`, label: name, value: entry.value, defaultValue: 2.5, minimum: 0, maximum: 8, enabled: entry.enabled,
    onChange(value) { session.edit(draft => { if (value === undefined) delete draft.lighting[name]; else draft.lighting[name].value = value; }); },
    onEnabled(enabled) { session.edit(draft => { draft.lighting[name].enabled = enabled; }); }
  }));
  const output = elements.section("Display output", "CP-F28 validates the requested output. The workbench presents verified sRGB only; HDR requests can fall back to sRGB.");
  for (const [name, defaultValue, choices] of [["outputMode", "srgb", ["srgb", "rec709", "display-p3", "hdr-pq", "scrgb"]], ["dither", "none", ["none", "bayer8"]], ["ditherSeed", 0, undefined]]) output.append(createAuthoredField(elements, run, { id: `cp33-output-${name}`, label: name, value: document.output[name], defaultValue, choices,
    onChange(value) { session.edit(draft => { if (value === undefined) delete draft.output[name]; else draft.output[name] = value; }); }
  }));
  const fragment = elements.element("div"); fragment.append(content, materials, lighting, output); return fragment;
}
