import { requireAuthoringSession } from "../authoringRegistry.js";
import { requireIdentifier } from "../authoringData.js";
import { AUTHORING_TEXT_LIMIT } from "../authoringContract.js";
import { createPanelElements } from "./panelElements.js";
import { renderSettingsPanel } from "./settingsPanel.js";
import { renderCameraPanel } from "./cameraPanel.js";
import { renderVolumesPanel } from "./volumesPanel.js";
import { renderPresetsPanel } from "./presetsPanel.js";
import { renderDocumentPanel } from "./documentPanel.js";

export function createAuthoringPanel({ container, session, persistence, connectedSettings = [], cameraViewIds = [], onExport, onRebuild } = {}) {
  if (!container?.ownerDocument || typeof container.replaceChildren !== "function") throw new TypeError("Provide an explicit DOM container");
  requireAuthoringSession(session);
  if (!Array.isArray(cameraViewIds)) throw new TypeError("Camera view ids must be an array");
  const viewIds = [...new Set(cameraViewIds.map(id => requireIdentifier(id, "$.cameraViewIds")))];
  const document = container.ownerDocument; const state = { activeTab: "Settings" }; let disposed = false; let messageRevision = 0; let running = false;
  const root = document.createElement("section"); root.className = "cp33-panel"; root.setAttribute("aria-label", "Post-process authoring");
  const status = document.createElement("p"); status.className = "cp33-status"; status.setAttribute("role", "status"); status.setAttribute("aria-live", "polite");
  async function run(operation) {
    if (disposed || running) return;
    running = true;
    const previousMessageRevision = messageRevision;
    const activeId = root.contains(document.activeElement) ? document.activeElement.id : undefined;
    const controls = [toolbar, tabs, content];
    root.setAttribute("aria-busy", "true");
    for (const control of controls) control.inert = true;
    try {
      await operation();
      if (!disposed && messageRevision === previousMessageRevision) {
        status.className = "cp33-status";
        status.textContent = `Session ready · revision ${session.snapshot().revision}`;
      }
    } catch (error) {
      if (!disposed) { status.className = "cp33-status cp33-error"; status.textContent = error.message; }
    } finally {
      running = false;
      root.setAttribute("aria-busy", "false");
      for (const control of controls) control.inert = false;
      if (!disposed && activeId) document.getElementById(activeId)?.focus({ preventScroll: true });
    }
  }
  const elements = createPanelElements(document, run); const toolbar = elements.element("div", undefined, { className: "cp33-toolbar" });
  const undo = elements.button("Undo", () => session.undo(), { id: "cp33-undo" }); const redo = elements.button("Redo", () => session.redo(), { id: "cp33-redo" });
  toolbar.append(undo, redo);
  if (persistence) toolbar.append(elements.button("Save", () => { persistence.save(session); }, { id: "cp33-save" }), elements.button("Load", () => { if (!persistence.load(session).loaded) throw new Error("No saved document yet. Save a shot first."); }, { id: "cp33-load" }));
  if (onExport) toolbar.append(elements.button("Export", () => onExport(session.export()), { id: "cp33-export" }));
  const file = elements.element("input", undefined, { type: "file", accept: ".json,application/json", id: "cp33-import-file", hidden: true });
  file.addEventListener("change", () => run(async () => {
    const selected = file.files?.[0]; if (!selected) return;
    const revision = session.snapshot().revision;
    try {
      if (selected.size > AUTHORING_TEXT_LIMIT) throw new RangeError("Import must be at most 1 MiB");
      const text = await selected.text();
      if (disposed) return;
      if (session.snapshot().revision !== revision) throw new Error("Session changed while reading the file; import again to confirm replacement");
      session.import(text);
    } finally { file.value = ""; }
  }));
  toolbar.append(elements.button("Import", () => file.click(), { id: "cp33-import" }), file);
  const tabs = elements.element("div", undefined, { className: "cp33-tabs", role: "tablist", "aria-label": "Authoring sections" });
  const content = elements.element("div", undefined, { className: "cp33-tab-content", role: "tabpanel", id: "cp33-active-panel" });
  const renderers = { Settings: renderSettingsPanel, Camera: renderCameraPanel, Volumes: renderVolumesPanel, Presets: renderPresetsPanel, Document: renderDocumentPanel };
  const tabButtons = new Map();
  function refresh() {
    if (disposed) return;
    const activeId = root.contains(document.activeElement) ? document.activeElement.id : undefined;
    for (const [name, tab] of tabButtons) { tab.setAttribute("aria-selected", String(state.activeTab === name)); tab.tabIndex = state.activeTab === name ? 0 : -1; }
    content.setAttribute("aria-labelledby", `cp33-tab-${state.activeTab}`);
    content.replaceChildren(renderers[state.activeTab]({ elements, session, run, state, refresh, connectedSettings, cameraViewIds: viewIds, rebuild: onRebuild }));
    undo.disabled = !session.snapshot().canUndo; redo.disabled = !session.snapshot().canRedo;
    if (activeId) document.getElementById(activeId)?.focus({ preventScroll: true });
  }
  for (const name of Object.keys(renderers)) {
    const tab = elements.button(name, () => { state.activeTab = name; refresh(); }, { id: `cp33-tab-${name}`, role: "tab", "aria-controls": "cp33-active-panel" });
    tab.addEventListener("keydown", event => {
      if (disposed || running || !["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
      event.preventDefault(); const names = [...tabButtons.keys()]; const index = names.indexOf(name);
      const next = event.key === "Home" ? 0 : event.key === "End" ? names.length - 1 : (index + (event.key === "ArrowRight" ? 1 : -1) + names.length) % names.length;
      state.activeTab = names[next]; refresh(); tabButtons.get(state.activeTab).focus();
    });
    tabButtons.set(name, tab); tabs.append(tab);
  }
  root.append(toolbar, tabs, status, content); container.replaceChildren(root);
  status.textContent = "Ready · edits stay in this authoring session";
  const unsubscribe = session.subscribe(refresh); refresh();
  return Object.freeze({ refresh, showError(message) { messageRevision++; status.className = "cp33-status cp33-error"; status.textContent = message; }, dispose() { if (disposed) return; disposed = true; unsubscribe(); root.remove(); } });
}
