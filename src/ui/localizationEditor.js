import { bus } from "../core/eventBus.js";
import { store } from "../core/state.js";
import { logger } from "../core/logger.js";
import { commands } from "../core/commands.js";
import { Events, createInstance } from "../datamodel/index.js";
import { openConfirm, openInfo, openModal, makeButton } from "./modal.js";
import { openContextMenu } from "./contextMenu.js";
import { createIcon } from "./icons.js";
import {
  COMMON_LOCALES,
  LOC_LIMITS,
  captureStrings,
  csvSerialize,
  csvToContents,
  entryId,
  findLocalizationTables,
  instancePath,
  localeName,
  localesOf,
  normalizeEntry,
  parseContents,
  primaryLocalizationTable,
  sanitizeLocaleId,
  serializeContents,
} from "../datamodel/localization.js";

const ROW_H = 26;
const RENDER_BUFFER = 6;
const BASE_COLUMNS = [
  { id: "Key", label: "Key" },
  { id: "Source", label: "Source" },
  { id: "Context", label: "Context" },
];

let win = null;
let visible = false;
let tableInst = null;
let data = { locales: [], entries: [] };
let locales = [];
let viewRows = [];
let selection = new Set();
let anchorIndex = -1;
let sortCol = "Source";
let sortDir = 1;
let searchText = "";
let initialized = false;

let tableBtn = null;
let sourceLocaleEl = null;
let searchEl = null;
let headRowEl = null;
let scrollerEl = null;
let sizerEl = null;
let rowsLayerEl = null;
let statusEl = null;
let emptyEl = null;
let bodyWrapEl = null;
let renderQueued = false;
let activeEdit = null;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function dataModel() {
  return typeof store.getDataModel === "function" ? store.getDataModel() : null;
}

function isAlive(inst) {
  return !!(inst && typeof inst.isDestroyed === "function" && !inst.isDestroyed());
}

function notify(title, message) {
  openInfo({ title, content: message });
}

function gridTemplate() {
  return `140px minmax(200px, 1.4fr) 200px${" minmax(140px, 1fr)".repeat(locales.length)}`;
}

function columnList() {
  return BASE_COLUMNS.concat(locales.map((id) => ({ id, label: id, locale: true })));
}

function cellValue(entry, col) {
  if (col === "Key") return entry.Key;
  if (col === "Source") return entry.Source;
  if (col === "Context") return entry.Context;
  return entry.Values[col] || "";
}

function applyMutation(name, mutator) {
  if (!isAlive(tableInst)) return false;
  const inst = tableInst;
  const before = String(inst.getProperty("Contents") || "");
  const next = mutator(parseContents(before));
  if (!next) return false;
  if (next.entries.length > LOC_LIMITS.maxEntries) {
    notify("Limite atingido", `M\u00e1ximo de ${LOC_LIMITS.maxEntries} entries por tabela.`);
    return false;
  }
  if (localesOf(next).length > LOC_LIMITS.maxLocales) {
    notify("Limite atingido", `M\u00e1ximo de ${LOC_LIMITS.maxLocales} locales por tabela.`);
    return false;
  }
  const after = serializeContents(next);
  if (after === before) return false;
  commands.execute({
    name,
    do() { inst.setProperty("Contents", after); },
    undo() { inst.setProperty("Contents", before); },
  });
  return true;
}

function pickTable(preferred) {
  const dm = dataModel();
  if (preferred && isAlive(preferred) && preferred.className === "LocalizationTable") return preferred;
  if (isAlive(tableInst)) {
    const all = findLocalizationTables(dm);
    if (all.includes(tableInst)) return tableInst;
  }
  return primaryLocalizationTable(dm);
}

function setTable(inst) {
  tableInst = inst && isAlive(inst) ? inst : null;
  selection = new Set();
  anchorIndex = -1;
  reload();
}

function reload() {
  if (!win) return;
  if (!isAlive(tableInst)) tableInst = null;
  data = tableInst ? parseContents(tableInst.getProperty("Contents")) : { locales: [], entries: [] };
  locales = tableInst ? localesOf(data) : [];
  const ids = new Set(data.entries.map(entryId));
  selection = new Set([...selection].filter((id) => ids.has(id)));
  rebuildHeaderRow();
  rebuildView();
  updateChrome();
}

function rebuildView() {
  const term = searchText.trim().toLowerCase();
  let rows = data.entries;
  if (term) {
    rows = rows.filter((e) => {
      if (e.Key.toLowerCase().includes(term)) return true;
      if (e.Source.toLowerCase().includes(term)) return true;
      if (e.Context.toLowerCase().includes(term)) return true;
      if (e.Example.toLowerCase().includes(term)) return true;
      for (const id of Object.keys(e.Values)) {
        if (e.Values[id].toLowerCase().includes(term)) return true;
      }
      return false;
    });
  }
  viewRows = rows.slice().sort((a, b) => {
    const va = cellValue(a, sortCol).toLowerCase();
    const vb = cellValue(b, sortCol).toLowerCase();
    const cmp = va.localeCompare(vb) || cellValue(a, "Source").localeCompare(cellValue(b, "Source"));
    return cmp * sortDir;
  });
  if (sizerEl) sizerEl.style.height = `${viewRows.length * ROW_H}px`;
  scheduleRender();
}

function scheduleRender() {
  if (renderQueued) return;
  renderQueued = true;
  requestAnimationFrame(() => {
    renderQueued = false;
    renderVisibleRows();
  });
}

function renderVisibleRows() {
  if (!rowsLayerEl || !scrollerEl) return;
  if (activeEdit) return;
  rowsLayerEl.textContent = "";
  if (!viewRows.length) return;
  const height = scrollerEl.clientHeight || 300;
  const first = Math.max(0, Math.floor(scrollerEl.scrollTop / ROW_H) - RENDER_BUFFER);
  const last = Math.min(viewRows.length, first + Math.ceil(height / ROW_H) + RENDER_BUFFER * 2);
  const template = gridTemplate();
  const cols = columnList();
  for (let i = first; i < last; i++) {
    const entry = viewRows[i];
    const id = entryId(entry);
    const row = el("div", "rsw-loc__row");
    row.style.top = `${i * ROW_H}px`;
    row.style.gridTemplateColumns = template;
    if (selection.has(id)) row.classList.add("is-selected");
    row.addEventListener("mousedown", (e) => {
      if (e.button !== 0) return;
      handleRowSelect(i, id, e);
    });
    for (const col of cols) {
      const value = cellValue(entry, col.id);
      const cell = el("div", "rsw-loc__cell", value);
      if (col.locale && !value) cell.classList.add("is-empty");
      cell.title = value;
      cell.addEventListener("dblclick", (e) => {
        e.preventDefault();
        e.stopPropagation();
        startCellEdit(cell, entry, col);
      });
      row.appendChild(cell);
    }
    rowsLayerEl.appendChild(row);
  }
}

function handleRowSelect(index, id, event) {
  if (event.shiftKey && anchorIndex >= 0) {
    const from = Math.min(anchorIndex, index);
    const to = Math.max(anchorIndex, index);
    if (!event.ctrlKey && !event.metaKey) selection = new Set();
    for (let i = from; i <= to; i++) {
      const rowEntry = viewRows[i];
      if (rowEntry) selection.add(entryId(rowEntry));
    }
  } else if (event.ctrlKey || event.metaKey) {
    if (selection.has(id)) selection.delete(id);
    else selection.add(id);
    anchorIndex = index;
  } else {
    selection = new Set([id]);
    anchorIndex = index;
  }
  updateChrome();
  scheduleRender();
}

function startCellEdit(cell, entry, col) {
  if (!isAlive(tableInst)) return;
  const initial = cellValue(entry, col.id);
  const input = el("input", "rsw-loc__cell-editor");
  input.type = "text";
  input.value = initial;
  input.spellcheck = false;
  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    activeEdit = null;
    if (input.parentNode) input.parentNode.removeChild(input);
    scheduleRender();
    if (!commit) return;
    const value = input.value;
    if (value === initial) return;
    commitCellEdit(entry, col, value);
  };
  activeEdit = finish;
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); finish(true); }
    else if (e.key === "Escape") { e.preventDefault(); finish(false); }
    e.stopPropagation();
  });
  input.addEventListener("blur", () => finish(true));
  input.addEventListener("mousedown", (e) => e.stopPropagation());
  input.addEventListener("dblclick", (e) => e.stopPropagation());
  cell.appendChild(input);
  input.focus();
  input.select();
}

function commitCellEdit(entry, col, rawValue) {
  const id = entryId(entry);
  if (col.locale) {
    applyMutation("Edit Translation", (d) => {
      const target = d.entries.find((e) => entryId(e) === id);
      if (!target) return null;
      const updated = normalizeEntry({ ...target, Values: { ...target.Values, [col.id]: rawValue } });
      if (!updated) return null;
      if (!rawValue.trim()) delete updated.Values[col.id];
      return { locales: d.locales, entries: d.entries.map((e) => (e === target ? updated : e)) };
    });
    return;
  }
  applyMutation(`Edit ${col.id}`, (d) => {
    const target = d.entries.find((e) => entryId(e) === id);
    if (!target) return null;
    const updated = normalizeEntry({ ...target, [col.id]: rawValue });
    if (!updated) {
      notify("Valor inv\u00e1lido", "Source \u00e9 obrigat\u00f3rio e n\u00e3o pode ficar vazio.");
      return null;
    }
    const newId = entryId(updated);
    if (newId !== id && d.entries.some((e) => entryId(e) === newId)) {
      notify("Entry duplicada", "J\u00e1 existe uma entry com a mesma combina\u00e7\u00e3o de Key, Source e Context.");
      return null;
    }
    selection.delete(id);
    selection.add(newId);
    return { locales: d.locales, entries: d.entries.map((e) => (e === target ? updated : e)) };
  });
}

function captureFlow() {
  ensureTable(() => {
    const captured = captureStrings(dataModel());
    const existing = new Set(data.entries.map(entryId));
    const fresh = captured.filter((e) => !existing.has(entryId(e)));
    const already = captured.length - fresh.length;
    if (fresh.length) {
      applyMutation("Capture Strings", (d) => ({ locales: d.locales, entries: d.entries.concat(fresh) }));
    }
    notify("Capture Strings", `${fresh.length} new strings captured, ${already} already existed`);
  });
}

function addEntryDialog() {
  ensureTable(() => {
    const body = el("div", "rsw-loc__form");
    const inputs = {};
    const addField = (label, name, placeholder) => {
      const wrap = el("label", "rsw-loc__field");
      wrap.appendChild(el("span", "rsw-loc__field-label", label));
      const input = el("input", "rsw-loc__input");
      input.type = "text";
      input.placeholder = placeholder || "";
      input.spellcheck = false;
      wrap.appendChild(input);
      body.appendChild(wrap);
      inputs[name] = input;
    };
    addField("Key (opcional)", "key", "ex: MENU_PLAY");
    addField("Source (obrigat\u00f3rio)", "source", "Texto original");
    addField("Context (opcional)", "context", "ex: game.StarterGui.MainMenu.TitleLabel");
    addField("Example (opcional)", "example", "Dica para tradutores");
    const foot = el("div", "rsw-modal__btnrow");
    let handle = null;
    foot.appendChild(makeButton("Cancelar", "ghost", () => handle && handle.close()));
    foot.appendChild(makeButton("Adicionar", "primary", () => {
      const entry = normalizeEntry({
        Key: inputs.key.value,
        Source: inputs.source.value,
        Context: inputs.context.value,
        Example: inputs.example.value,
        Values: {},
      });
      if (!entry) {
        inputs.source.classList.add("is-invalid");
        inputs.source.focus();
        return;
      }
      const id = entryId(entry);
      if (data.entries.some((e) => entryId(e) === id)) {
        notify("Entry duplicada", "J\u00e1 existe uma entry com a mesma combina\u00e7\u00e3o de Key, Source e Context.");
        return;
      }
      const ok = applyMutation("Add Entry", (d) => ({ locales: d.locales, entries: d.entries.concat([entry]) }));
      if (ok && handle) handle.close();
    }));
    handle = openModal({ title: "Add Entry", body, footer: foot, width: 460 });
  });
}

function removeSelectedFlow() {
  if (!selection.size) {
    notify("Remove Selected", "Selecione ao menos uma linha da tabela.");
    return;
  }
  const count = selection.size;
  openConfirm({
    title: "Remove Selected",
    message: `Remover ${count} ${count === 1 ? "entry" : "entries"} da tabela?`,
    buttons: [
      { label: "Cancelar", value: false, kind: "ghost" },
      { label: "Remover", value: true, kind: "primary" },
    ],
  }).then((ok) => {
    if (ok !== true) return;
    const ids = new Set(selection);
    applyMutation("Remove Entries", (d) => ({
      locales: d.locales,
      entries: d.entries.filter((e) => !ids.has(entryId(e))),
    }));
  });
}

function addLocaleDialog() {
  ensureTable(() => {
    const body = el("div", "rsw-loc__form");
    const suggestions = COMMON_LOCALES.filter((l) => !locales.includes(l.id));
    const selectWrap = el("label", "rsw-loc__field");
    selectWrap.appendChild(el("span", "rsw-loc__field-label", "Locales comuns"));
    const select = el("select", "rsw-loc__input");
    const optCustom = el("option", null, "Personalizado\u2026");
    optCustom.value = "";
    select.appendChild(optCustom);
    for (const l of suggestions) {
      const opt = el("option", null, `${l.id} \u2014 ${l.name}`);
      opt.value = l.id;
      select.appendChild(opt);
    }
    selectWrap.appendChild(select);
    body.appendChild(selectWrap);
    const idWrap = el("label", "rsw-loc__field");
    idWrap.appendChild(el("span", "rsw-loc__field-label", "Locale ID"));
    const idInput = el("input", "rsw-loc__input");
    idInput.type = "text";
    idInput.placeholder = 'ex: "pt-br"';
    idInput.spellcheck = false;
    idWrap.appendChild(idInput);
    body.appendChild(idWrap);
    const nameWrap = el("label", "rsw-loc__field");
    nameWrap.appendChild(el("span", "rsw-loc__field-label", "Nome do idioma"));
    const nameInput = el("input", "rsw-loc__input");
    nameInput.type = "text";
    nameInput.placeholder = 'ex: "Portugu\u00eas (Brasil)"';
    nameWrap.appendChild(nameInput);
    body.appendChild(nameWrap);
    select.addEventListener("change", () => {
      if (!select.value) return;
      idInput.value = select.value;
      nameInput.value = localeName(select.value);
    });
    if (suggestions.length) {
      select.selectedIndex = 1;
      idInput.value = suggestions[0].id;
      nameInput.value = suggestions[0].name;
    }
    const foot = el("div", "rsw-modal__btnrow");
    let handle = null;
    foot.appendChild(makeButton("Cancelar", "ghost", () => handle && handle.close()));
    foot.appendChild(makeButton("Adicionar", "primary", () => {
      const id = sanitizeLocaleId(idInput.value);
      if (!id) {
        idInput.classList.add("is-invalid");
        idInput.focus();
        return;
      }
      if (locales.includes(id)) {
        notify("Locale existente", `O locale "${id}" j\u00e1 est\u00e1 na tabela.`);
        return;
      }
      const name = nameInput.value.trim().slice(0, 80) || localeName(id);
      const ok = applyMutation("Add Locale", (d) => ({
        locales: d.locales.concat([{ id, name }]),
        entries: d.entries,
      }));
      if (ok && handle) handle.close();
    }));
    handle = openModal({ title: "Add Locale", body, footer: foot, width: 420 });
  });
}

function removeLocaleFlow(button) {
  if (!locales.length) {
    notify("Remove Locale", "A tabela n\u00e3o possui locales para remover.");
    return;
  }
  const rect = button.getBoundingClientRect();
  openContextMenu({
    x: Math.round(rect.left),
    y: Math.round(rect.bottom + 2),
    items: locales.map((id) => ({
      label: `${id} \u2014 ${localeName(id)}`,
      onSelect: () => {
        openConfirm({
          title: "Remove Locale",
          message: `Remover o locale "${id}" e todas as suas tradu\u00e7\u00f5es?`,
          buttons: [
            { label: "Cancelar", value: false, kind: "ghost" },
            { label: "Remover", value: true, kind: "primary" },
          ],
        }).then((ok) => {
          if (ok !== true) return;
          applyMutation("Remove Locale", (d) => ({
            locales: d.locales.filter((l) => l.id !== id),
            entries: d.entries.map((e) => {
              if (!(id in e.Values)) return e;
              const values = { ...e.Values };
              delete values[id];
              return { ...e, Values: values };
            }),
          }));
        });
      },
    })),
  });
}

async function importCsvFlow() {
  if (!isAlive(tableInst)) {
    notify("Import CSV", "Crie ou selecione uma LocalizationTable primeiro.");
    return;
  }
  const input = document.createElement("input");
  input.type = "file";
  input.accept = ".csv,text/csv";
  input.addEventListener("change", async () => {
    const file = input.files && input.files[0];
    if (!file) return;
    let text = "";
    try {
      text = await file.text();
    } catch (err) {
      notify("Import CSV", "N\u00e3o foi poss\u00edvel ler o arquivo selecionado.");
      return;
    }
    const parsed = csvToContents(text);
    for (const w of parsed.warnings) logger.warn(`Localization CSV: ${w}`);
    if (!parsed.entries.length) {
      notify("Import CSV", "Nenhuma entry v\u00e1lida encontrada no CSV.");
      return;
    }
    const existingById = new Map(data.entries.map((e) => [entryId(e), e]));
    const added = [];
    const conflicts = [];
    for (const inc of parsed.entries) {
      const cur = existingById.get(entryId(inc));
      if (!cur) {
        added.push(inc);
        continue;
      }
      const changed =
        Object.keys(inc.Values).some((k) => inc.Values[k] !== (cur.Values[k] || "")) ||
        (inc.Example !== "" && inc.Example !== cur.Example);
      if (changed) conflicts.push(inc);
    }
    let overwriteAll = false;
    let updated = 0;
    let skipped = 0;
    const overwriteById = new Map();
    for (const inc of conflicts) {
      let decision = "over";
      if (!overwriteAll) {
        decision = await openConfirm({
          title: "Conflito de importa\u00e7\u00e3o",
          message: `A entry "${inc.Source.slice(0, 60)}" j\u00e1 existe com valores diferentes. O que fazer?`,
          buttons: [
            { label: "Pular", value: "skip", kind: "ghost" },
            { label: "Sobrescrever Todos", value: "overAll", kind: "default" },
            { label: "Sobrescrever", value: "over", kind: "primary" },
          ],
        });
        if (decision === "overAll") {
          overwriteAll = true;
          decision = "over";
        }
      }
      if (decision === "over") {
        overwriteById.set(entryId(inc), inc);
        updated++;
      } else {
        skipped++;
      }
    }
    if (added.length || overwriteById.size || parsed.locales.length) {
      applyMutation("Import CSV", (d) => {
        const merged = d.entries.map((e) => {
          const inc = overwriteById.get(entryId(e));
          if (!inc) return e;
          return {
            ...e,
            Example: inc.Example || e.Example,
            Values: { ...e.Values, ...inc.Values },
          };
        }).concat(added);
        const seen = new Set(d.locales.map((l) => l.id));
        const mergedLocales = d.locales.concat(parsed.locales.filter((l) => !seen.has(l.id)));
        return { locales: mergedLocales, entries: merged };
      });
    }
    notify("Import CSV", `${added.length} entries imported, ${updated} updated, ${skipped} skipped`);
  });
  input.click();
}

function exportCsvFlow() {
  if (!isAlive(tableInst)) {
    notify("Export CSV", "Crie ou selecione uma LocalizationTable primeiro.");
    return;
  }
  const csv = `\uFEFF${csvSerialize(data)}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `${(tableInst.name || "LocalizationTable").replace(/[^\w\- ]/g, "").trim() || "LocalizationTable"}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

function createTableFlow() {
  const dm = dataModel();
  const service = dm && dm.getChildren().find((c) => c.className === "LocalizationService");
  if (!service) {
    notify("Localization", "LocalizationService n\u00e3o encontrado no DataModel.");
    return;
  }
  const inst = createInstance("LocalizationTable", { name: "LocalizationTable" });
  if (!inst) return;
  commands.execute({
    name: "Create LocalizationTable",
    do() { inst.setParent(service); },
    undo() { inst.setParent(null); },
  });
  setTable(inst);
}

function ensureTable(fn) {
  if (isAlive(tableInst)) {
    fn();
    return;
  }
  const found = pickTable(null);
  if (found) {
    setTable(found);
    fn();
    return;
  }
  openConfirm({
    title: "Localization",
    message: "Nenhuma LocalizationTable existe no projeto. Criar uma agora dentro do LocalizationService?",
    buttons: [
      { label: "Cancelar", value: false, kind: "ghost" },
      { label: "Criar", value: true, kind: "primary" },
    ],
  }).then((ok) => {
    if (ok !== true) return;
    createTableFlow();
    if (isAlive(tableInst)) fn();
  });
}

function openTableMenu() {
  const tables = findLocalizationTables(dataModel());
  const rect = tableBtn.getBoundingClientRect();
  const items = tables.map((t) => ({
    label: `${selectionMark(t)}${instancePath(t)}`,
    onSelect: () => setTable(t),
  }));
  if (items.length) items.push({ type: "separator" });
  items.push({ label: "Nova LocalizationTable", icon: "create", onSelect: () => createTableFlow() });
  openContextMenu({ x: Math.round(rect.left), y: Math.round(rect.bottom + 2), items });
}

function selectionMark(t) {
  return t === tableInst ? "\u2713 " : "\u2007\u2007 ";
}

function rebuildHeaderRow() {
  if (!headRowEl) return;
  headRowEl.textContent = "";
  headRowEl.style.gridTemplateColumns = gridTemplate();
  for (const col of columnList()) {
    const cell = el("button", "rsw-loc__hcell");
    cell.type = "button";
    const label = col.locale ? `${col.label} \u2014 ${localeName(col.id)}` : col.label;
    cell.title = label;
    cell.appendChild(el("span", "rsw-loc__hlabel", col.label));
    if (sortCol === col.id) cell.appendChild(el("span", "rsw-loc__harrow", sortDir > 0 ? "\u25b2" : "\u25bc"));
    cell.addEventListener("click", () => {
      if (sortCol === col.id) sortDir = -sortDir;
      else { sortCol = col.id; sortDir = 1; }
      rebuildHeaderRow();
      rebuildView();
    });
    headRowEl.appendChild(cell);
  }
}

function updateChrome() {
  if (!win) return;
  const hasTable = isAlive(tableInst);
  if (tableBtn) {
    tableBtn.textContent = hasTable ? instancePath(tableInst) : "Nenhuma tabela";
    tableBtn.appendChild(el("span", "rsw-loc__caret", " \u25be"));
  }
  if (sourceLocaleEl) {
    sourceLocaleEl.textContent = hasTable
      ? `Source: ${sanitizeLocaleId(tableInst.getProperty("SourceLocaleId")) || "en-us"}`
      : "";
  }
  if (statusEl) {
    statusEl.textContent = hasTable
      ? `${data.entries.length} entries \u00b7 ${locales.length} locales \u00b7 ${selection.size} selecionada(s)`
      : "";
  }
  if (emptyEl && bodyWrapEl) {
    emptyEl.hidden = hasTable;
    bodyWrapEl.style.display = hasTable ? "" : "none";
  }
}

function buildWindow() {
  win = el("div", "rsw-loc");
  win.hidden = true;

  const header = el("div", "rsw-loc__header");
  header.appendChild(el("span", "rsw-loc__title", "Localization Editor"));
  tableBtn = el("button", "rsw-loc__table-btn");
  tableBtn.type = "button";
  tableBtn.addEventListener("click", openTableMenu);
  header.appendChild(tableBtn);
  sourceLocaleEl = el("span", "rsw-loc__source");
  header.appendChild(sourceLocaleEl);
  const closeBtn = el("button", "rsw-loc__close");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Fechar");
  closeBtn.appendChild(createIcon("close", 14));
  closeBtn.addEventListener("click", hide);
  header.appendChild(closeBtn);
  win.appendChild(header);

  const toolbar = el("div", "rsw-loc__toolbar");
  const addBtn = (label, onClick) => {
    const b = el("button", "rsw-loc__btn", label);
    b.type = "button";
    b.addEventListener("click", () => onClick(b));
    toolbar.appendChild(b);
    return b;
  };
  addBtn("Capture Strings", captureFlow);
  addBtn("Add Entry", addEntryDialog);
  addBtn("Remove Selected", removeSelectedFlow);
  addBtn("Import CSV", importCsvFlow);
  addBtn("Export CSV", exportCsvFlow);
  addBtn("Add Locale", addLocaleDialog);
  addBtn("Remove Locale", (b) => removeLocaleFlow(b));
  searchEl = el("input", "rsw-loc__search");
  searchEl.type = "text";
  searchEl.placeholder = "Buscar\u2026";
  searchEl.spellcheck = false;
  searchEl.addEventListener("input", () => {
    searchText = searchEl.value;
    rebuildView();
  });
  toolbar.appendChild(searchEl);
  win.appendChild(toolbar);

  bodyWrapEl = el("div", "rsw-loc__body");
  headRowEl = el("div", "rsw-loc__head");
  bodyWrapEl.appendChild(headRowEl);
  scrollerEl = el("div", "rsw-loc__scroller");
  sizerEl = el("div", "rsw-loc__sizer");
  rowsLayerEl = el("div", "rsw-loc__rows");
  sizerEl.appendChild(rowsLayerEl);
  scrollerEl.appendChild(sizerEl);
  scrollerEl.addEventListener("scroll", scheduleRender);
  bodyWrapEl.appendChild(scrollerEl);
  win.appendChild(bodyWrapEl);

  emptyEl = el("div", "rsw-loc__empty");
  emptyEl.appendChild(el("p", null, "Nenhuma LocalizationTable no projeto."));
  const createBtn = el("button", "rsw-loc__btn rsw-loc__btn--primary", "Criar LocalizationTable");
  createBtn.type = "button";
  createBtn.addEventListener("click", createTableFlow);
  emptyEl.appendChild(createBtn);
  emptyEl.hidden = true;
  win.appendChild(emptyEl);

  statusEl = el("div", "rsw-loc__status");
  win.appendChild(statusEl);

  let dragState = null;
  header.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target === closeBtn || e.target === tableBtn || closeBtn.contains(e.target)) return;
    const rect = win.getBoundingClientRect();
    dragState = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    header.setPointerCapture?.(e.pointerId);
  });
  header.addEventListener("pointermove", (e) => {
    if (!dragState) return;
    const maxX = Math.max(0, (globalThis.innerWidth || 1200) - 160);
    const maxY = Math.max(0, (globalThis.innerHeight || 800) - 80);
    win.style.left = `${Math.min(maxX, Math.max(0, e.clientX - dragState.dx))}px`;
    win.style.top = `${Math.min(maxY, Math.max(0, e.clientY - dragState.dy))}px`;
  });
  const endDrag = () => { dragState = null; };
  header.addEventListener("pointerup", endDrag);
  header.addEventListener("pointercancel", endDrag);

  document.body.appendChild(win);
}

function show(preferred) {
  if (!win) buildWindow();
  tableInst = pickTable(preferred || null);
  if (!visible) {
    visible = true;
    win.hidden = false;
    if (!win.style.left) {
      win.style.left = "140px";
      win.style.top = "120px";
    }
    bus.emit("localizationeditor:visibilityChanged", { visible: true });
  }
  reload();
}

function hide() {
  if (!visible) return;
  visible = false;
  if (win) win.hidden = true;
  bus.emit("localizationeditor:visibilityChanged", { visible: false });
}

function onPropertyChanged(p) {
  if (!visible || !p || p.instance !== tableInst) return;
  if (p.property === "Contents" || p.property === "SourceLocaleId" || p.property === "Name") reload();
}

function onTreeChanged(p) {
  if (!visible || !p) return;
  const inst = p.child || p.instance;
  if (inst && inst.className === "LocalizationTable") {
    if (!isAlive(tableInst)) tableInst = pickTable(null);
    reload();
  }
}

export function isLocalizationEditorVisible() {
  return visible;
}

export function initLocalizationEditor() {
  if (initialized) return;
  initialized = true;
  bus.on("localizationeditor:toggle", () => (visible ? hide() : show(null)));
  bus.on("localizationeditor:open", (p) => show(p && p.table ? p.table : null));
  bus.on(Events.PropertyChanged, onPropertyChanged);
  bus.on(Events.ChildAdded, onTreeChanged);
  bus.on(Events.ChildRemoved, onTreeChanged);
  bus.on(Events.Destroying, onTreeChanged);
}
