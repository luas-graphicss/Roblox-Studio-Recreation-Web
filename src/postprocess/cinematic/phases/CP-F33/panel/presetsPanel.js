export function renderPresetsPanel(context) {
  const { elements, session, run } = context; const document = session.snapshot().document;
  const panel = elements.section("Shot presets", "A preset captures every authored section, including schema, material definitions, assets and curves. The preset catalog itself is not replaced.");
  const label = elements.element("label", "Preset name", { for: "cp33-preset-name" });
  const input = elements.element("input", undefined, { id: "cp33-preset-name", type: "text", placeholder: "My next shot", maxlength: 120 });
  const save = elements.button("Save current state", () => {
    const name = input.value.trim(); if (!name) throw new TypeError("Give the preset a name");
    let suffix = 1; while (session.snapshot().document.presets.some(preset => preset.id === `Shot${suffix}`)) suffix++;
    session.savePreset({ id: `Shot${suffix}`, name });
  }, { id: "cp33-save-preset", className: "cp33-primary" });
  panel.append(label, input, save);
  if (!document.presets.length) panel.append(elements.element("p", "No presets saved. Capture a shot to start your library.", { className: "cp33-empty" }));
  for (const preset of document.presets) {
    const card = elements.element("article", undefined, { className: "cp33-preset" });
    card.append(elements.element("strong", preset.name), elements.element("span", `${preset.state.materials.length} materials · ${preset.state.settings.volumes.length} volumes`, { className: "cp33-description" }));
    const actions = elements.element("div", undefined, { className: "cp33-actions" });
    actions.append(elements.button("Apply", () => session.applyPreset(preset.id), { "aria-label": `Apply ${preset.name}` }), elements.button("Remove", () => session.removePreset(preset.id), { "aria-label": `Remove ${preset.name}`, className: "cp33-danger" }));
    card.append(actions); panel.append(card);
  }
  return panel;
}
