export function renderDocumentPanel(context) {
  const { elements, session, run, rebuild, state } = context;
  const panel = elements.section("Versioned document", "Full JSON editing preserves null, AUTO, zero, false and missing values. Invalid imports never replace the current valid state. Structural edits require an explicit rebuild.");
  const textarea = elements.element("textarea", undefined, { id: "cp33-document-json", "aria-label": "Authoring document JSON", spellcheck: "false", rows: 18 });
  textarea.value = state.jsonDraft ?? JSON.stringify(session.snapshot().document, null, 2);
  textarea.addEventListener("input", () => { state.jsonDraft = textarea.value; });
  const actions = elements.element("div", undefined, { className: "cp33-actions" });
  actions.append(elements.button("Apply JSON", () => { session.import(textarea.value); delete state.jsonDraft; }, { id: "cp33-apply-json", className: "cp33-primary" }));
  actions.append(elements.button("Reload current", () => { delete state.jsonDraft; textarea.value = JSON.stringify(session.snapshot().document, null, 2); }, { id: "cp33-reload-json" }));
  if (rebuild) actions.append(elements.button("Rebuild from JSON", () => rebuild(textarea.value), { id: "cp33-rebuild-json" }));
  panel.append(textarea, actions, elements.element("p", "Assets are references, not automatic downloads. Curves and flags need explicit host consumers. Legacy conversion creates an approval proposal; Classic remains unchanged.", { className: "cp33-description" }));
  return panel;
}
