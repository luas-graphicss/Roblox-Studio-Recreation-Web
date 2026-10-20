import { createAuthoredField } from "./authoredField.js";

export function renderVolumesPanel(context) {
  const { elements, session, run } = context; const document = session.snapshot().document;
  const panel = elements.section("Spatial volumes", "Priority is ascending with an id tie-break. Blend weight, bounds and camera position feed the real CP-F02 resolver.");
  panel.append(elements.button("Add volume", () => session.edit(draft => {
    let suffix = 1; while (draft.settings.volumes.some(volume => volume.id === `Volume${suffix}`)) suffix++;
    draft.settings.volumes.push({ id: `Volume${suffix}`, enabled: true, priority: 0, blendWeight: 1, blendRadius: 1, unbound: true, overrides: {} });
  }), { id: "cp33-add-volume" }));
  if (!document.settings.volumes.length) panel.append(elements.element("p", "No volumes yet. Add one to author a local blend.", { className: "cp33-empty" }));
  for (const [index, volume] of document.settings.volumes.entries()) {
    const card = elements.section(volume.id); card.classList.add("cp33-volume");
    card.append(elements.button("Remove volume", () => session.edit(draft => { draft.settings.volumes.splice(index, 1); }), { "aria-label": `Remove ${volume.id}`, className: "cp33-danger" }));
    for (const [name, defaultValue, minimum, maximum] of [["enabled", true], ["blendWeight", 1, 0, 1], ["priority", 0, -100, 100], ["blendRadius", 0, 0, 100]]) card.append(createAuthoredField(elements, run, { id: `cp33-volume-${volume.id}-${name}`, label: name, value: volume[name], defaultValue, minimum, maximum,
      onChange(value) { session.edit(draft => { if (value === undefined) delete draft.settings.volumes[index][name]; else draft.settings.volumes[index][name] = value; }); }
    }));
    card.append(elements.select("Volume shape", ["unbound", "sphere", "box"], volume.unbound ? "unbound" : volume.bounds?.type ?? "sphere", value => session.edit(draft => {
      const target = draft.settings.volumes[index]; target.unbound = value === "unbound";
      if (value === "unbound") delete target.bounds; else target.bounds = value === "sphere" ? { type: "sphere", center: [0, 0, 0], radius: 5 } : { type: "box", center: [0, 0, 0], halfExtents: [5, 5, 5] };
    }), `cp33-volume-${volume.id}-shape`));
    if (volume.bounds) {
      for (const name of ["center", volume.bounds.type === "sphere" ? "radius" : "halfExtents"]) card.append(createAuthoredField(elements, run, { id: `cp33-volume-${volume.id}-${name}`, label: name, value: volume.bounds[name], defaultValue: volume.bounds[name],
        onChange(value) { if (value === undefined) throw new Error("A bounded volume requires geometry"); session.edit(draft => { draft.settings.volumes[index].bounds[name] = value; }); }
      }));
    }
    for (const property of document.settingsSchema.properties) card.append(createAuthoredField(elements, run, { id: `cp33-volume-${volume.id}-${property.name}`, label: property.name, value: volume.overrides[property.name]?.value, defaultValue: property.defaultValue, minimum: property.minimum, maximum: property.maximum, choices: property.options, enabled: volume.overrides[property.name]?.enabled,
      onChange(value) { session.edit(draft => { if (value === undefined) delete draft.settings.volumes[index].overrides[property.name]; else draft.settings.volumes[index].overrides[property.name] = { ...draft.settings.volumes[index].overrides[property.name], value }; }); },
      onEnabled(enabled) { session.edit(draft => { draft.settings.volumes[index].overrides[property.name] = { value: property.defaultValue, ...draft.settings.volumes[index].overrides[property.name], enabled }; }); }
    }));
    panel.append(card);
  }
  return panel;
}
