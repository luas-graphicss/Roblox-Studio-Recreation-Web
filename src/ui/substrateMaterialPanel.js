import { bus } from "../core/eventBus.js";
import {
  selectedSubstrateTargets,
  readSubstrateTargetSource,
  applySubstrateSource,
  readSubstrateRenderingSetting,
  setSubstrateRenderingSetting,
} from "../editor/substrateMaterialAuthoring.js";
import { parseSubstrateMaterial } from "../viewport/substrateAuthoringBridge.js";
import { createAuthoringSession } from "../lighting/substrate/sbAuthoringSession.js";
import { createAutoSlabGraph } from "../lighting/substrate/sbAuthoringGraphCore.js";
import { getSubstrateHostSurface } from "../lighting/substrate/runtime/substrateHostSurface.js";
import { specularProfileIds } from "../lighting/substrate/sbSpecularProfileCatalog.js";
import { createSubstrateFeaturePreview } from "./substrateFeaturePreview.js";
import { createSubstrateSmMaterialSection } from "./substrateSmMaterialSection.js";
import { createSubstrateSmEditorHost } from "../editor/substrateSmEditorHost.js";

let activePanel = null;
const unavailableParameters = new Set([
  "subsurfaceMeanFreePath",
  "subsurfacePhase",
]);
const element = (tag, text = "", className = "") => {
  const node = document.createElement(tag);
  node.textContent = text;
  node.className = className;
  return node;
};
const field = (parent, text, tag = "select") => {
  const label = element("label", text);
  const input = element(tag);
  input.setAttribute("aria-label", text);
  label.append(input);
  parent.append(label);
  return input;
};
function options(select, entries, selected) {
  select.replaceChildren(
    ...entries.map((entry) => {
      const option = element("option", entry.label);
      option.value = entry.value;
      option.disabled = entry.disabled === true;
      return option;
    }),
  );
  if (entries.some((entry) => entry.value === selected))
    select.value = selected;
}
function button(parent, text, action, className = "") {
  const control = element("button", text, className);
  control.type = "button";
  control.dataset.action = text.toLowerCase().replace(/\W+/g, "-");
  control.addEventListener("click", action);
  parent.append(control);
  return control;
}

export function openSubstrateMaterialPanel() {
  if (activePanel) {
    activePanel.element.focus();
    return activePanel;
  }
  if (!document.getElementById("rsw-substrate-material-style")) {
    const stylesheet = document.createElement("link");
    stylesheet.id = "rsw-substrate-material-style";
    stylesheet.rel = "stylesheet";
    stylesheet.href = new URL(
      "./substrateMaterialPanel.css",
      import.meta.url,
    ).href;
    document.head.append(stylesheet);
  }
  const dialog = element("dialog", "", "rsw-substrate-material");
  dialog.setAttribute("aria-label", "Substrate materials");
  const header = element("header");
  header.append(element("h2", "Substrate materials"));
  button(header, "Close", () => dialog.close());
  dialog.append(header);
  const body = element("div", "", "sb-editor-body");
  dialog.append(body);
  button(header, "Show scene", (event) => {
    body.hidden = !body.hidden;
    event.currentTarget.textContent = body.hidden
      ? "Show controls"
      : "Show scene";
  });
  const selectionReadout = element("p", "", "sb-editor-note");
  body.append(selectionReadout);
  const status = element("div", "", "sb-editor-status");
  status.setAttribute("role", "status");
  body.append(status);
  const showStatus = (text, error = false) => {
    status.textContent = text;
    status.dataset.error = String(error);
  };
  const toolbar = element("div", "", "sb-editor-actions");
  body.append(toolbar);
  const grid = element("div", "", "sb-editor-grid");
  body.append(grid);
  const presetSelect = field(grid, "Preset");
  const nodeSelect = field(grid, "Graph node");
  const parameterSelect = field(grid, "Parameter");
  const valueInput = field(grid, "Value (JSON number or array)", "input");
  const profileSelect = field(grid, "Specular profile");
  const actions = element("div", "", "sb-editor-actions");
  body.append(actions);
  const sourceDetails = element("details");
  sourceDetails.append(element("summary", "Material JSON — import / export"));
  body.append(sourceDetails);
  sourceDetails.dataset.section = "material-json";
  const sourceInput = field(sourceDetails, "Serialized material", "textarea");
  sourceInput.spellcheck = false;
  const jsonActions = element("div", "", "sb-editor-actions");
  sourceDetails.append(jsonActions);
  const footer = element("div", "", "sb-editor-actions");
  body.append(footer);
  const gpu = element("section", "", "sb-editor-gpu");
  body.append(gpu);
  const renderingSelect = field(gpu, "Substrate rendering");
  options(
    renderingSelect,
    [
      { value: "auto", label: "AUTO — eligible Future renderer" },
      { value: "on", label: "ON — keep safety and hardware gates" },
      { value: "off", label: "OFF — native materials" },
    ],
    "auto",
  );
  const materialSelect = field(gpu, "GPU material");
  const debugSelect = field(gpu, "Pixel view");
  options(
    debugSelect,
    [
      { value: "off", label: "Rendered material" },
      { value: "materialCount", label: "Closure-count heatmap" },
      { value: "bytesPerPixel", label: "Material-byte heatmap" },
      { value: "closureInspector", label: "Closure inspector" },
    ],
    "off",
  );
  const gpuReadout = element("div", "", "sb-gpu-status");
  gpu.append(gpuReadout);
  const featurePreview = createSubstrateFeaturePreview(
    body,
    getSubstrateHostSurface,
  );
  const substrateSmSection = createSubstrateSmMaterialSection(body, createSubstrateSmEditorHost());
  const limitations = element("details");
  limitations.append(
    element("summary", "Known engine limitations"),
    element(
      "p",
      "Screen-space subsurface scattering and OIT, specialized BSDF closures, independent per-slab map atlases, DBuffer decals and per-layer SSR/probe routing are not connected in this engine path. Authored features unsupported by the active backend can be preserved as source, not claimed as rendered effects.",
      "sb-editor-note",
    ),
  );
  body.append(limitations);
  body.append(
    element(
      "p",
      "Saved graphs use the existing scene serializer and Undo/Redo. Future and Substrate SM have independent admission gates; a saved source is not proof that either backend rendered it.",
      "sb-editor-note",
    ),
  );
  let targets = [];
  let selectionKey = "";
  let dirty = false;
  let applying = false;
  let loadingSource = false;
  let selectedPath = "root";
  let selectedParameter = "roughness";
  let ownedDebug = null;
  let previousDebug = "off";
  const session = createAuthoringSession({
    onChange() {
      if (loadingSource) return;
      dirty = true;
      drawGraph();
      sourceInput.value = JSON.stringify(session.root(), null, 2);
      showStatus(
        "Draft changed. Apply to store its source on the selected scene objects.",
      );
    },
  });
  const signature = () =>
    selectedSubstrateTargets()
      .map((target) => target.id)
      .join("|");
  const resultMessage = (result) =>
    result.reason ||
    (result.refusals ?? result.problems ?? [])
      .map((item) => item.reason || String(item))
      .join("; ") ||
    "Operation refused.";
  function loadSourceTree(tree) {
    loadingSource = true;
    try {
      return session.loadTree(tree);
    } finally {
      loadingSource = false;
    }
  }
  function changeGraph(operation) {
    const result = operation();
    if (!result.ok) showStatus(resultMessage(result), true);
    else drawGraph();
  }
  function drawGraph() {
    const nodes = session.nodes();
    if (!nodes.some((node) => node.path === selectedPath))
      selectedPath = nodes[0]?.path || "root";
    options(
      presetSelect,
      [
        { value: "", label: "Choose a preset" },
        ...session.presets().map((id) => ({ value: id, label: id })),
      ],
      session.presetId() || "",
    );
    options(
      nodeSelect,
      nodes.map((node) => ({
        value: node.path,
        label: node.path + " · " + (node.operator || node.bsdf),
      })),
      selectedPath,
    );
    const node = nodes.find((entry) => entry.path === selectedPath);
    const names = node?.parameterNames || [];
    if (
      !names.includes(selectedParameter) ||
      unavailableParameters.has(selectedParameter)
    )
      selectedParameter =
        names.find((name) => !unavailableParameters.has(name)) || "";
    options(
      parameterSelect,
      names.map((name) => ({
        value: name,
        label:
          name +
          (unavailableParameters.has(name)
            ? " (not rendered)"
            : (node.autoParameterNames || []).includes(name)
              ? " (AUTO)"
              : ""),
        disabled: unavailableParameters.has(name),
      })),
      selectedParameter,
    );
    const pending = [session.root()];
    let value = null;
    let parameters = {};
    while (pending.length) {
      const candidate = pending.pop();
      if (candidate.path === selectedPath) {
        parameters = candidate.parameters || {};
        value = parameters[selectedParameter];
        break;
      }
      pending.push(...(candidate.children || []));
    }
    valueInput.value = value == null ? "null" : JSON.stringify(value);
    options(
      profileSelect,
      [
        { value: "null", label: "AUTO — neutral" },
        ...specularProfileIds().map((id, index) => ({
          value: String(index),
          label: id,
        })),
      ],
      parameters.specularProfileIndex == null
        ? "null"
        : String(parameters.specularProfileIndex),
    );
    profileSelect.disabled = !names.includes("specularProfileIndex");
  }
  function loadSelection() {
    targets = selectedSubstrateTargets();
    selectionKey = signature();
    dirty = false;
    const source = targets.length ? readSubstrateTargetSource(targets[0]) : "";
    const parsed = parseSubstrateMaterial(source);
    loadSourceTree(parsed.tree || createAutoSlabGraph());
    selectedPath = "root";
    drawGraph();
    sourceInput.value = source;
    if (parsed.error) sourceDetails.open = true;
    selectionReadout.textContent = targets.length
      ? targets.map((target) => target.name).join(", ") +
        " · " +
        targets.length +
        " selected"
      : "Select a Part, MeshPart or SurfaceAppearance in the editor.";
    applyButton.disabled = !targets.length;
    inheritButton.disabled = !targets.length;
    showStatus(
      parsed.error
        ? parsed.error + " Original source retained; fix the JSON or create a replacement draft before applying."
        : (source
          ? "Loaded the selected material. Edits remain a draft until Apply."
          : "No authored graph. AUTO draft is ready; the native material is unchanged."),
      !!parsed.error,
    );
    refreshGpu();
  }
  function apply(source) {
    if (signature() !== selectionKey) {
      showStatus(
        "Selection changed. Load the selection before applying.",
        true,
      );
      return;
    }
    applying = true;
    const result = applySubstrateSource(source, targets);
    applying = false;
    if (!result.ok) {
      showStatus(resultMessage(result), true);
      return;
    }
    loadSelection();
    showStatus(
      result.changed
        ? "Stored authored source on " +
            result.count +
            " object(s). Undo/Redo and scene saving preserve this graph."
        : "The selected objects already have this material.",
    );
  }
  button(toolbar, "Load selection", loadSelection);
  button(actions, "Set value", () => {
    try {
      changeGraph(() =>
        session.setParameter({
          path: selectedPath,
          parameterName: selectedParameter,
          value: JSON.parse(valueInput.value),
        }),
      );
    } catch {
      showStatus("Enter a JSON number, array, or null for AUTO.", true);
    }
  });
  button(actions, "AUTO", () =>
    changeGraph(() =>
      session.setParameter({
        path: selectedPath,
        parameterName: selectedParameter,
        value: null,
      }),
    ),
  );
  button(actions, "Add layer", () =>
    changeGraph(() => session.addLayer({ path: selectedPath })),
  );
  button(actions, "Add mix", () =>
    changeGraph(() => session.addMix({ path: selectedPath })),
  );
  button(actions, "Remove node", () =>
    changeGraph(() => session.removeAt({ path: selectedPath })),
  );
  button(jsonActions, "Load JSON into draft", () => {
    const parsed = parseSubstrateMaterial(sourceInput.value);
    if (parsed.error || !parsed.tree) {
      showStatus(parsed.error || "Provide a material graph.", true);
      return;
    }
    changeGraph(() => loadSourceTree(parsed.tree));
    dirty = true;
    showStatus("JSON loaded into the draft. Apply to update the scene.");
  });
  const applyButton = button(
    footer,
    "Apply to selection",
    () => apply(sourceInput.value),
    "sb-primary",
  );
  const inheritButton = button(footer, "Inherit scene material", () =>
    apply(""),
  );
  presetSelect.addEventListener("change", () => {
    if (presetSelect.value)
      changeGraph(() => session.loadPreset(presetSelect.value));
  });
  nodeSelect.addEventListener("change", () => {
    selectedPath = nodeSelect.value;
    drawGraph();
  });
  parameterSelect.addEventListener("change", () => {
    selectedParameter = parameterSelect.value;
    drawGraph();
  });
  profileSelect.addEventListener("change", () =>
    changeGraph(() =>
      session.setParameter({
        path: selectedPath,
        parameterName: "specularProfileIndex",
        value: JSON.parse(profileSelect.value),
      }),
    ),
  );
  sourceInput.addEventListener("input", () => {
    dirty = true;
  });
  renderingSelect.addEventListener("change", () => {
    const result = setSubstrateRenderingSetting(
      renderingSelect.value === "auto" ? null : renderingSelect.value === "on",
    );
    if (!result.ok) showStatus(resultMessage(result), true);
    refreshGpu();
  });
  materialSelect.addEventListener("change", () => {
    getSubstrateHostSurface()?.runtime.target(materialSelect.value);
    refreshGpu();
  });
  debugSelect.addEventListener("change", () => {
    const host = getSubstrateHostSurface();
    if (!host?.debugVisualization) {
      showStatus("Substrate is not active on the current renderer.", true);
      debugSelect.value = "off";
      return;
    }
    if (ownedDebug === null) previousDebug = host.debugVisualization.mode();
    const result = host.debugVisualization.setMode(debugSelect.value);
    if (result.accepted) ownedDebug = debugSelect.value;
    else showStatus(resultMessage(result), true);
    refreshGpu();
  });
  function refreshGpu() {
    featurePreview.refresh();
    const setting = readSubstrateRenderingSetting();
    renderingSelect.value =
      setting.value == null ? "auto" : setting.value ? "on" : "off";
    const host = getSubstrateHostSurface();
    const runtime = host?.runtime;
    const choices = runtime?.targets() || [];
    const current = runtime?.target();
    const nextKey = choices
      .map((choice) => choice.id + ":" + choice.label)
      .join("|");
    if (materialSelect.dataset.key !== nextKey) {
      options(
        materialSelect,
        choices.map((choice) => ({ value: choice.id, label: choice.label })),
        current,
      );
      materialSelect.dataset.key = nextKey;
    }
    materialSelect.value = current || "";
    materialSelect.disabled = !choices.length;
    debugSelect.disabled = !host?.debugVisualization;
    const entry = runtime
      ?.status()
      .find((candidate) => candidate.id === current);
    const visualization = host?.debugVisualization;
    if (visualization) debugSelect.value = visualization.mode();
    const inspector = visualization?.report();
    const rows =
      inspector?.inspector.rows.map(
        (row) =>
          "Slot " +
          row.slot +
          " · " +
          row.kind +
          " · weight " +
          row.weight.toFixed(3) +
          " · " +
          row.bytes +
          " B",
      ) || [];
    gpuReadout.textContent = entry
      ? (entry.enabled ? "GPU material active" : "Native fallback") +
        " · " +
        host.tier() +
        "\n" +
        entry.closures +
        " closures · " +
        entry.bytes +
        " stored bytes · " +
        entry.uploads +
        " uploads\n" +
        rows.join("\n") +
        (entry.problems.length ? "\n" + entry.problems.join("; ") : "")
      : "No active GPU material. Current technology: " +
        (setting.technology || "unavailable") +
        ". The draft can still be saved; unsupported paths stay native.";
  }
  const unsubscribeSelection = bus.on("selection:changed", () => {
    if (dirty) {
      applyButton.disabled = true;
      inheritButton.disabled = true;
      showStatus(
        "Selection changed. Load the new selection before applying.",
        true,
      );
    } else loadSelection();
  });
  const unsubscribeHistory = bus.on("history:changed", () => {
    if (!applying && !dirty) loadSelection();
  });
  const timer = setInterval(refreshGpu, 500);
  const dispose = () => {
    clearInterval(timer);
    unsubscribeSelection();
    unsubscribeHistory();
    substrateSmSection.dispose();
    const visualization = getSubstrateHostSurface()?.debugVisualization;
    if (ownedDebug !== null && visualization?.mode() === ownedDebug)
      visualization.setMode(previousDebug);
    dialog.remove();
    activePanel = null;
  };
  dialog.addEventListener("close", dispose, { once: true });
  dialog.addEventListener("keydown", (event) => {
    event.stopPropagation();
    if (event.key === "Escape") dialog.close();
  });
  dialog.addEventListener("pointerdown", (event) => event.stopPropagation());
  document.body.append(dialog);
  activePanel = { element: dialog, dispose: () => dialog.close() };
  loadSelection();
  dialog.show();
  return activePanel;
}
