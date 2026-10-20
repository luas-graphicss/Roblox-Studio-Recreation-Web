import { createWidgetWindow } from "../plugins/pluginWidgets.js";
import { bus } from "../core/eventBus.js";
import { selection } from "../core/selection.js";
import { collection } from "../datamodel/index.js";
import { commands } from "../core/commands.js";
import { openPrompt, openConfirm } from "./modal.js";
import { createIcon } from "./icons.js";

const TAG_MAX_LENGTH = 200;
const LIST_LIMIT = 500;


const PALETTE = [
  "#4aa3ff", "#ff7a59", "#46c66d", "#c177ff",
  "#ffcf3f", "#ff5d8f", "#23c9c0", "#9aa6b2",
];


const tagColors = new Map();                     
const knownTags = new Set();                                                  
let colorCursor = 0;
let selectedTag = null;

let handle = null;
let listEl = null;
let detailEl = null;
let refreshPending = false;
const unsubs = [];

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function colorForTag(tag) {
  let c = tagColors.get(tag);
  if (!c) {
    c = PALETTE[colorCursor % PALETTE.length];
    colorCursor += 1;
    tagColors.set(tag, c);
  }
  return c;
}


function allTags() {
  const set = new Set(knownTags);
  for (const t of collection.getAllTags()) set.add(t);
  return [...set].sort((a, b) => a.localeCompare(b));
}

function instancesWithTag(tag) {
  const res = collection.getTagged(tag);
  return res && Array.isArray(res.instances) ? res.instances : [];
}


function applyTagToTargets(targets, tag, add) {
  const valid = targets.filter((t) => t && typeof t.addTag === "function");
  if (!valid.length) return;
  const before = valid.map((t) => ({ t, had: t.hasTag(tag) }));
  commands.execute({
    name: add ? "Add Tag" : "Remove Tag",
    do() {
      for (const t of valid) {
        if (add) t.addTag(tag);
        else t.removeTag(tag);
      }
    },
    undo() {
      for (const b of before) {
        if (b.had) b.t.addTag(tag);
        else b.t.removeTag(tag);
      }
    },
  });
}

function renameTagCommand(oldTag, newTag) {
  const targets = instancesWithTag(oldTag);
  commands.execute({
    name: "Rename Tag",
    do() {
      for (const t of targets) {
        t.removeTag(oldTag);
        t.addTag(newTag);
      }
    },
    undo() {
      for (const t of targets) {
        t.removeTag(newTag);
        t.addTag(oldTag);
      }
    },
  });

  if (tagColors.has(oldTag)) {
    tagColors.set(newTag, tagColors.get(oldTag));
    tagColors.delete(oldTag);
  }
  knownTags.delete(oldTag);
  knownTags.add(newTag);
  if (selectedTag === oldTag) selectedTag = newTag;
}

function deleteTagCommand(tag) {
  const targets = instancesWithTag(tag);
  const had = targets.slice();
  commands.execute({
    name: "Delete Tag",
    do() {
      for (const t of had) t.removeTag(tag);
    },
    undo() {
      for (const t of had) t.addTag(tag);
    },
  });
  knownTags.delete(tag);
  tagColors.delete(tag);
  if (selectedTag === tag) selectTag(null);
}


function emitHighlight() {
  if (!selectedTag) {
    bus.emit("tageditor:clearHighlight", {});
    return;
  }
  const ids = instancesWithTag(selectedTag).map((i) => i.id);
  bus.emit("tageditor:highlight", { ids, color: colorForTag(selectedTag) });
}

function selectTag(tag) {
  selectedTag = tag;
  emitHighlight();
  render();
}


function render() {
  if (!handle || handle.isClosed()) return;
  renderList();
  renderDetail();
}

function renderList() {
  if (!listEl) return;
  const tags = allTags();
  listEl.replaceChildren();
  if (!tags.length) {
    listEl.appendChild(el("div", "rsw-tageditor__empty", "Nenhuma tag ainda. Use \u201c+ New Tag\u201d."));
    return;
  }
  for (const tag of tags.slice(0, LIST_LIMIT)) {
    const row = el("div", "rsw-tageditor__row");
    if (tag === selectedTag) row.classList.add("is-selected");
    const dot = el("span", "rsw-tageditor__dot");
    dot.style.background = colorForTag(tag);
    const name = el("span", "rsw-tageditor__name", tag);
    const count = el("span", "rsw-tageditor__count", String(collection.getTagCount(tag) || 0));
    const main = el("button", "rsw-tageditor__rowmain");
    main.type = "button";
    main.append(dot, name, count);
    main.addEventListener("click", () => selectTag(tag === selectedTag ? null : tag));

    const ren = el("button", "rsw-tageditor__icon");
    ren.appendChild(createIcon("pencil", 13));
    ren.type = "button";
    ren.title = "Renomear tag";
    ren.addEventListener("click", (e) => { e.stopPropagation(); onRename(tag); });
    const del = el("button", "rsw-tageditor__icon");
    del.appendChild(createIcon("trash", 13));
    del.type = "button";
    del.title = "Deletar tag";
    del.addEventListener("click", (e) => { e.stopPropagation(); onDelete(tag); });

    row.append(main, ren, del);
    listEl.appendChild(row);
  }
}

function renderDetail() {
  if (!detailEl) return;
  detailEl.replaceChildren();
  if (!selectedTag) {
    detailEl.appendChild(el("div", "rsw-tageditor__hint", "Selecione uma tag para ver e editar suas instancias."));
    return;
  }
  const sel = selection.get().filter((i) => i && typeof i.addTag === "function");
  const title = el("div", "rsw-tageditor__detailtitle", "Tag: " + selectedTag);
  detailEl.appendChild(title);


  const applyRow = el("label", "rsw-tageditor__apply");
  const cb = document.createElement("input");
  cb.type = "checkbox";
  const allHave = sel.length > 0 && sel.every((i) => i.hasTag(selectedTag));
  cb.checked = allHave;
  cb.disabled = sel.length === 0;
  cb.addEventListener("change", () => {
    applyTagToTargets(sel, selectedTag, cb.checked);
  });
  const lbl = el("span", null, sel.length
    ? `Aplicar a selecao (${sel.length})`
    : "Selecione instancias para aplicar");
  applyRow.append(cb, lbl);
  detailEl.appendChild(applyRow);


  const insts = instancesWithTag(selectedTag);
  const head = el("div", "rsw-tageditor__listhead", `Instancias marcadas (${insts.length})`);
  detailEl.appendChild(head);
  const box = el("div", "rsw-tageditor__insts");
  if (!insts.length) {
    box.appendChild(el("div", "rsw-tageditor__hint", "Nenhuma instancia com esta tag."));
  } else {
    for (const inst of insts.slice(0, LIST_LIMIT)) {
      const b = el("button", "rsw-tageditor__inst");
      b.type = "button";
      b.textContent = (inst.name || inst.className || "Instance") + "  (" + inst.className + ")";
      b.addEventListener("click", () => {
        if (typeof selection.selectSingle === "function") selection.selectSingle(inst);
        else selection.set([inst]);
      });
      box.appendChild(b);
    }
  }
  detailEl.appendChild(box);
}


function onNewTag() {
  openPrompt({
    title: "Nova Tag",
    label: "Nome da tag",
    placeholder: "Ex.: Enemy",
    maxLength: TAG_MAX_LENGTH,
    okLabel: "Criar",
    sanitize: (v) => String(v || "").trim(),
    validate: (v) => {
      if (!v) return "O nome nao pode ser vazio.";
      if (v.length > TAG_MAX_LENGTH) return `Maximo de ${TAG_MAX_LENGTH} caracteres.`;
      return null;
    },
  }).then((name) => {
    if (!name) return;
    knownTags.add(name);
    const sel = selection.get().filter((i) => i && typeof i.addTag === "function");
    if (sel.length) applyTagToTargets(sel, name, true);
    selectTag(name);
  });
}

function onRename(tag) {
  openPrompt({
    title: "Renomear Tag",
    label: `Novo nome para \u201c${tag}\u201d`,
    value: tag,
    maxLength: TAG_MAX_LENGTH,
    okLabel: "Renomear",
    sanitize: (v) => String(v || "").trim(),
    validate: (v) => {
      if (!v) return "O nome nao pode ser vazio.";
      if (v.length > TAG_MAX_LENGTH) return `Maximo de ${TAG_MAX_LENGTH} caracteres.`;
      if (v !== tag && allTags().includes(v)) return "Ja existe uma tag com esse nome.";
      return null;
    },
  }).then((name) => {
    if (!name || name === tag) return;
    renameTagCommand(tag, name);
    emitHighlight();
    render();
  });
}

function onDelete(tag) {
  const n = collection.getTagCount(tag) || 0;
  openConfirm({
    title: "Deletar Tag",
    message: n
      ? `Remover a tag \u201c${tag}\u201d de ${n} instancia(s)? Isso pode ser desfeito.`
      : `Remover a tag \u201c${tag}\u201d?`,
    buttons: [
      { label: "Cancelar", value: false, kind: "ghost" },
      { label: "Deletar", value: true, kind: "danger" },
    ],
  }).then((ok) => {
    if (!ok) return;
    deleteTagCommand(tag);
    render();
  });
}

function cleanup() {
  bus.emit("tageditor:clearHighlight", {});
  for (const off of unsubs.splice(0)) { try { off(); } catch (_) {            } }
  listEl = null;
  detailEl = null;
}

function scheduleRefresh() {
  if (refreshPending) return;
  refreshPending = true;
  const raf = typeof requestAnimationFrame === "function" ? requestAnimationFrame : (fn) => setTimeout(fn, 16);
  raf(() => {
    refreshPending = false;
    emitHighlight();
    render();
  });
}


export function openTagEditor() {
  if (handle && !handle.isClosed()) {
    handle.setVisible(true);
    handle.bringToFront();
    render();
    return handle;
  }
  handle = createWidgetWindow({
    title: "Tag Editor",
    pluginName: "CollectionService",
    width: 320,
    height: 420,
    onClose: cleanup,
  });
  const root = el("div", "rsw-tageditor");
  const toolbar = el("div", "rsw-tageditor__toolbar");
  const addBtn = el("button", "rsw-tageditor__new", "+ New Tag");
  addBtn.type = "button";
  addBtn.addEventListener("click", onNewTag);
  toolbar.appendChild(addBtn);
  listEl = el("div", "rsw-tageditor__list");
  detailEl = el("div", "rsw-tageditor__detail");
  root.append(toolbar, listEl, detailEl);
  handle.body.appendChild(root);


  unsubs.push(bus.on("collection:added", scheduleRefresh));
  unsubs.push(bus.on("collection:removed", scheduleRefresh));
  unsubs.push(bus.on("selection:changed", scheduleRefresh));
  unsubs.push(bus.on("datamodel:loaded", scheduleRefresh));

  render();
  return handle;
}

export function isTagEditorOpen() {
  return !!(handle && !handle.isClosed() && handle.isVisible && handle.isVisible());
}

export function toggleTagEditor() {
  if (isTagEditorOpen()) {
    handle.setVisible(false);
    bus.emit("tageditor:clearHighlight", {});
  } else {
    openTagEditor();
  }
}


export function openTagEditorFor(inst) {
  openTagEditor();
  if (inst && typeof inst.getTags === "function") {
    const tags = inst.getTags();
    if (tags.length) selectTag(tags[0]);
    else render();
  }
}
