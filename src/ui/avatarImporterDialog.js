import { createIcon } from "./icons.js";
import { logger } from "../core/logger.js";
import { store } from "../core/state.js";
import { getService } from "../datamodel/index.js";
import { Enums } from "../datamodel/types.js";
import {
  importAccessory,
  importLayeredClothing,
  importBodyMesh,
  validateAvatarAsset,
  previewOnRig,
} from "../avatar/avatarImport.js";
import {
  ATTACHMENT_BY_ACCESSORY_TYPE,
  LAYERED_TYPES,
  R15_ATTACHMENTS,
  accessorySummary,
  avatarDebugState,
  ensureCharacterAttachments,
  ensureWrapTargets,
  equippedAccessories,
  updateCharacterAccessories,
} from "../avatar/accessoryRuntime.js";
import { fitToCharacter, removeAllAccessories, getSelectedCharacter } from "../avatar/avatarOps.js";

let activeImporter = null;
let activeDebug = null;
let lastImported = null;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function findAnyCharacter() {
  const sel = getSelectedCharacter();
  if (sel) return sel;
  const dm = store.getDataModel ? store.getDataModel() : null;
  const ws = dm ? getService(dm, "Workspace") : null;
  if (!ws) return null;
  const stack = ws.getChildren().slice();
  let guard = 0;
  while (stack.length > 0 && guard < 4000) {
    guard += 1;
    const n = stack.pop();
    if (!n || typeof n.getChildren !== "function") continue;
    if (n.className === "Model" && n.getChildren().some((c) => c.className === "Humanoid")) return n;
    for (const k of n.getChildren()) stack.push(k);
  }
  return null;
}

function buildSelect(labelText, options, initial) {
  const row = el("label", "rsw-avatar-field");
  row.appendChild(el("span", "rsw-avatar-field__label", labelText));
  const sel = el("select", "rsw-avatar-field__input");
  for (const opt of options) {
    const o = el("option", null, opt);
    o.value = opt;
    sel.appendChild(o);
  }
  if (initial && options.includes(initial)) sel.value = initial;
  row.appendChild(sel);
  return { row, sel };
}

function buildInput(labelText, value, type) {
  const row = el("label", "rsw-avatar-field");
  row.appendChild(el("span", "rsw-avatar-field__label", labelText));
  const input = el("input", "rsw-avatar-field__input");
  input.type = type || "text";
  input.autocomplete = "off";
  input.value = value != null ? String(value) : "";
  row.appendChild(input);
  return { row, input };
}

function renderChecklist(host, checklist) {
  host.textContent = "";
  if (!checklist || checklist.length === 0) return;
  const list = el("div", "rsw-avatar-checklist");
  for (const item of checklist) {
    const row = el("div", `rsw-avatar-checklist__item rsw-avatar-checklist__item--${item.status}`);
    const mark = item.status === "ok" ? "\u2713" : item.status === "warning" ? "\u26a0" : "\u2715";
    row.appendChild(el("span", "rsw-avatar-checklist__mark", mark));
    row.appendChild(el("span", "rsw-avatar-checklist__label", item.label));
    list.appendChild(row);
  }
  host.appendChild(list);
}

export function isImporterOpen() {
  return !!activeImporter;
}

export function closeAvatarImporter() {
  if (activeImporter) {
    activeImporter.dispose();
    activeImporter = null;
  }
}

export function openAvatarImporter() {
  if (activeImporter) {
    closeAvatarImporter();
    return;
  }
  const panel = el("aside", "rsw-avatar-panel rsw-avatar-panel--importer");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Avatar Importer");

  const header = el("div", "rsw-avatar-panel__header");
  const title = el("div", "rsw-avatar-panel__title");
  title.appendChild(createIcon("accessory", 16));
  title.appendChild(el("span", null, "Avatar Importer"));
  const closeBtn = el("button", "rsw-avatar-panel__close");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Fechar");
  closeBtn.appendChild(createIcon("close", 14));
  header.append(title, closeBtn);

  const bodyEl = el("div", "rsw-avatar-panel__body");
  const checklistHost = el("div", "rsw-avatar-panel__section");

  const rigidSection = el("div", "rsw-avatar-panel__section");
  rigidSection.appendChild(el("div", "rsw-avatar-panel__sectiontitle", "Import Accessory"));
  const rigidTypes = Enums.AccessoryType.filter((t) => !LAYERED_TYPES.includes(t));
  const nameField = buildInput("Nome", "MeuAcessorio");
  const typeField = buildSelect("AccessoryType", rigidTypes, "Hat");
  const attField = buildSelect("Attachment alvo", R15_ATTACHMENTS.map((a) => a.name), "HatAttachment");
  typeField.sel.addEventListener("change", () => {
    const target = ATTACHMENT_BY_ACCESSORY_TYPE[typeField.sel.value];
    if (target) attField.sel.value = target;
  });
  const importRigidBtn = el("button", "rsw-avatar-panel__apply", "Import");
  importRigidBtn.type = "button";
  importRigidBtn.addEventListener("click", () => {
    const res = importAccessory({
      name: nameField.input.value,
      accessoryType: typeField.sel.value,
      attachmentName: attField.sel.value,
      fileSize: 0,
    });
    renderChecklist(checklistHost, res.checklist);
    if (res.ok) lastImported = res.assetId;
  });
  rigidSection.append(nameField.row, typeField.row, attField.row, importRigidBtn);

  const layeredSection = el("div", "rsw-avatar-panel__section");
  layeredSection.appendChild(el("div", "rsw-avatar-panel__sectiontitle", "Import Layered Clothing"));
  const lcName = buildInput("Nome", "MinhaRoupa");
  const lcType = buildSelect("Tipo de roupa", LAYERED_TYPES.slice(), "Shirt");
  const lcOrder = buildInput("Order", 1, "number");
  const lcPuff = buildInput("Puffiness", 1, "number");
  lcPuff.input.step = "0.1";
  const importLayeredBtn = el("button", "rsw-avatar-panel__apply", "Import");
  importLayeredBtn.type = "button";
  importLayeredBtn.addEventListener("click", () => {
    const res = importLayeredClothing({
      name: lcName.input.value,
      accessoryType: lcType.sel.value,
      order: Number(lcOrder.input.value),
      puffiness: Number(lcPuff.input.value),
      fileSize: 0,
    });
    renderChecklist(checklistHost, res.checklist);
    if (res.ok) lastImported = res.assetId;
  });
  layeredSection.append(lcName.row, lcType.row, lcOrder.row, lcPuff.row, importLayeredBtn);

  const bodySection = el("div", "rsw-avatar-panel__section");
  bodySection.appendChild(el("div", "rsw-avatar-panel__sectiontitle", "Import Body Mesh"));
  const bmName = buildInput("Nome", "MeuCorpo");
  const importBodyBtn = el("button", "rsw-avatar-panel__apply", "Import Body Mesh");
  importBodyBtn.type = "button";
  importBodyBtn.addEventListener("click", () => {
    const res = importBodyMesh({ name: bmName.input.value, fileSize: 0 });
    renderChecklist(checklistHost, [
      res.ok
        ? { status: "ok", label: "Body mesh registrada no Asset Manager (Meshes)." }
        : { status: "error", label: "Falha ao importar body mesh." },
    ]);
  });
  bodySection.append(bmName.row, importBodyBtn);

  const actionsSection = el("div", "rsw-avatar-panel__section");
  actionsSection.appendChild(el("div", "rsw-avatar-panel__sectiontitle", "Valida\u00e7\u00e3o e Preview"));
  const validateBtn = el("button", "rsw-avatar-panel__apply", "Validate Avatar Asset");
  validateBtn.type = "button";
  validateBtn.addEventListener("click", () => {
    const char = findAnyCharacter();
    const selAcc = char ? equippedAccessories(char)[0] : null;
    if (!selAcc) {
      renderChecklist(checklistHost, [{ status: "warning", label: "Nenhum acess\u00f3rio equipado para validar." }]);
      return;
    }
    renderChecklist(checklistHost, validateAvatarAsset(selAcc, char));
  });
  const previewBtn = el("button", "rsw-avatar-panel__apply", "Preview on Rig");
  previewBtn.type = "button";
  previewBtn.addEventListener("click", () => {
    if (!lastImported) {
      renderChecklist(checklistHost, [{ status: "warning", label: "Importe um asset primeiro." }]);
      return;
    }
    const char = findAnyCharacter();
    if (!char) {
      renderChecklist(checklistHost, [{ status: "error", label: "Nenhum rig no Workspace. Use Build Rig (R15)." }]);
      return;
    }
    const acc = previewOnRig(lastImported, char);
    renderChecklist(checklistHost, acc
      ? [{ status: "ok", label: `Preview aplicado em "${char.name}".` }]
      : [{ status: "error", label: "Falha no preview." }]);
  });
  actionsSection.append(validateBtn, previewBtn);

  bodyEl.append(rigidSection, layeredSection, bodySection, actionsSection, checklistHost);
  panel.append(header, bodyEl);
  document.body.appendChild(panel);

  const onKey = (e) => {
    if (e.key === "Escape") closeAvatarImporter();
  };
  closeBtn.addEventListener("click", closeAvatarImporter);
  document.addEventListener("keydown", onKey, true);
  activeImporter = {
    dispose() {
      document.removeEventListener("keydown", onKey, true);
      if (panel.parentNode) panel.parentNode.removeChild(panel);
    },
  };
}

export function isAvatarDebugOpen() {
  return !!activeDebug;
}

export function closeAvatarDebugPanel() {
  if (activeDebug) {
    activeDebug.dispose();
    activeDebug = null;
  }
}

export function openAvatarDebugPanel() {
  if (activeDebug) {
    closeAvatarDebugPanel();
    return;
  }
  const panel = el("aside", "rsw-avatar-panel rsw-avatar-panel--debug");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Avatar Debug");

  const header = el("div", "rsw-avatar-panel__header");
  const title = el("div", "rsw-avatar-panel__title");
  title.appendChild(createIcon("wraptarget", 16));
  title.appendChild(el("span", null, "Avatar Debug"));
  const closeBtn = el("button", "rsw-avatar-panel__close");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Fechar");
  closeBtn.appendChild(createIcon("close", 14));
  header.append(title, closeBtn);

  const bodyEl = el("div", "rsw-avatar-panel__body");

  const listSection = el("div", "rsw-avatar-panel__section");
  listSection.appendChild(el("div", "rsw-avatar-panel__sectiontitle", "Acess\u00f3rios equipados"));
  const listHost = el("div", "rsw-avatar-debug__list");
  listSection.appendChild(listHost);

  function refreshList() {
    listHost.textContent = "";
    const char = findAnyCharacter();
    if (!char) {
      listHost.appendChild(el("div", "rsw-avatar-panel__warn", "Nenhum personagem no Workspace."));
      return;
    }
    const rows = accessorySummary(char);
    if (rows.length === 0) {
      listHost.appendChild(el("div", "rsw-avatar-panel__warn", "Nenhum acess\u00f3rio equipado."));
      return;
    }
    for (const r of rows) {
      const line = r.layered
        ? `${r.name} \u2014 ${r.type} (layered, Order ${r.order})`
        : `${r.name} \u2014 ${r.type} (r\u00edgido)`;
      listHost.appendChild(el("div", "rsw-avatar-debug__item", line));
    }
  }

  const togglesSection = el("div", "rsw-avatar-panel__section");
  togglesSection.appendChild(el("div", "rsw-avatar-panel__sectiontitle", "Visualiza\u00e7\u00e3o"));
  const toggles = [
    ["Show Cages", "showCages"],
    ["Show Attachment Points", "showAttachments"],
    ["Show Clothing Bounds", "showClothingBounds"],
  ];
  for (const [label, key] of toggles) {
    const row = el("label", "rsw-avatar-field");
    const chk = el("input");
    chk.type = "checkbox";
    chk.checked = !!avatarDebugState[key];
    chk.addEventListener("change", () => {
      avatarDebugState[key] = chk.checked;
    });
    row.append(chk, el("span", "rsw-avatar-field__label", label));
    togglesSection.appendChild(row);
  }

  const buttonsSection = el("div", "rsw-avatar-panel__section");
  buttonsSection.appendChild(el("div", "rsw-avatar-panel__sectiontitle", "A\u00e7\u00f5es"));
  const rebuildBtn = el("button", "rsw-avatar-panel__apply", "Rebuild Wrap");
  rebuildBtn.type = "button";
  rebuildBtn.addEventListener("click", () => {
    const char = findAnyCharacter();
    if (!char) return;
    ensureCharacterAttachments(char);
    ensureWrapTargets(char);
    updateCharacterAccessories(char);
    refreshList();
    logger.info("Avatar Debug: wrap reconstru\u00eddo.");
  });
  const removeBtn = el("button", "rsw-avatar-panel__apply", "Remove All Accessories");
  removeBtn.type = "button";
  removeBtn.addEventListener("click", () => {
    removeAllAccessories();
    refreshList();
  });
  const fitBtn = el("button", "rsw-avatar-panel__apply", "Fit Accessories");
  fitBtn.type = "button";
  fitBtn.addEventListener("click", () => {
    const char = findAnyCharacter();
    if (char) updateCharacterAccessories(char);
    fitToCharacter();
    refreshList();
  });
  buttonsSection.append(rebuildBtn, removeBtn, fitBtn);

  bodyEl.append(listSection, togglesSection, buttonsSection);
  panel.append(header, bodyEl);
  document.body.appendChild(panel);

  const timer = setInterval(refreshList, 1200);
  refreshList();

  const onKey = (e) => {
    if (e.key === "Escape") closeAvatarDebugPanel();
  };
  closeBtn.addEventListener("click", closeAvatarDebugPanel);
  document.addEventListener("keydown", onKey, true);
  activeDebug = {
    dispose() {
      clearInterval(timer);
      document.removeEventListener("keydown", onKey, true);
      if (panel.parentNode) panel.parentNode.removeChild(panel);
    },
  };
}
