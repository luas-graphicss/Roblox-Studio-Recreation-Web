import { bus } from "../core/eventBus.js";
import { logger } from "../core/logger.js";
import { openConfirm, openPrompt, openInfo } from "./modal.js";
import * as DS from "../runtime/dataServices.js";

const PAGE_SIZE = 50;

let win = null;
let visible = false;


let stores = [];                     
let selStore = null;                   
let keys = [];                                     
let keyPrefix = "";
let page = 0;
let selKey = null;          
let editMode = false;
let showInternal = false;
let internalToggleEl = null;


function isInternalStore(name) {
  return String(name || "").startsWith("_");
}


let storesListEl = null;
let keysListEl = null;
let keysSearchEl = null;
let pagerLabelEl = null;
let valueWrapEl = null;
let editToggleEl = null;
let newKeyBtnEl = null;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}


async function doubleConfirm(title, message) {
  const first = await openConfirm({
    title,
    message,
    buttons: [
      { label: "Cancelar", value: false, kind: "ghost" },
      { label: "Continuar", value: true, kind: "danger" },
    ],
  });
  if (!first) return false;
  const second = await openConfirm({
    title: title + " \u2014 confirmar",
    message: "Esta a\u00e7\u00e3o n\u00e3o pode ser desfeita. Confirmar definitivamente?",
    buttons: [
      { label: "Cancelar", value: false, kind: "ghost" },
      { label: "Sim, confirmar", value: true, kind: "danger" },
    ],
  });
  return !!second;
}

function prettyJson(value) {
  try { return JSON.stringify(value, null, 2); } catch (_) { return String(value); }
}


async function refreshStores() {
  try { stores = await DS.dsListStores(); }
  catch (e) { stores = []; logger.warn("DataStore Viewer: " + (e && e.message)); }
  if (!showInternal) stores = stores.filter((s) => !isInternalStore(s.name));
  renderStores();
}

function renderStores() {
  if (!storesListEl) return;
  storesListEl.textContent = "";
  if (!stores.length) {
    storesListEl.appendChild(el("div", "rsw-dsv__empty", "Nenhum DataStore. Rode um Playtest que use SetAsync."));
    return;
  }
  for (const s of stores) {
    const item = el("div", "rsw-dsv__store", s.name);
    const scope = el("span", "rsw-dsv__store-scope", s.scope);
    item.appendChild(scope);
    if (selStore && selStore.name === s.name && selStore.scope === s.scope) {
      item.classList.add("rsw-dsv__store--selected");
    }
    item.addEventListener("click", () => selectStore(s));
    storesListEl.appendChild(item);
  }
}

async function selectStore(s) {
  selStore = { name: s.name, scope: s.scope };
  selKey = null;
  keyPrefix = "";
  page = 0;
  if (keysSearchEl) keysSearchEl.value = "";
  renderStores();
  await reloadKeys();
  renderValue(null);
}


async function reloadKeys() {
  if (!selStore) { keys = []; renderKeys(); return; }
  try { keys = await DS.dsListKeys(selStore.name, selStore.scope, keyPrefix); }
  catch (e) { keys = []; logger.warn("DataStore Viewer: " + (e && e.message)); }
  if (page * PAGE_SIZE >= keys.length) page = 0;
  renderKeys();
}

function renderKeys() {
  if (!keysListEl) return;
  keysListEl.textContent = "";
  if (newKeyBtnEl) newKeyBtnEl.hidden = !(editMode && selStore && !isInternalStore(selStore.name));
  if (!selStore) {
    keysListEl.appendChild(el("div", "rsw-dsv__empty", "Selecione um DataStore."));
    updatePager();
    return;
  }
  if (!keys.length) {
    keysListEl.appendChild(el("div", "rsw-dsv__empty", "Nenhuma chave."));
    updatePager();
    return;
  }
  const start = page * PAGE_SIZE;
  const slice = keys.slice(start, start + PAGE_SIZE);
  for (const k of slice) {
    const item = el("div", "rsw-dsv__key", k);
    if (selKey === k) item.classList.add("rsw-dsv__key--selected");
    item.addEventListener("click", () => selectKey(k));
    keysListEl.appendChild(item);
  }
  updatePager();
}

function updatePager() {
  if (!pagerLabelEl) return;
  const total = keys.length;
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  pagerLabelEl.textContent = total ? `P\u00e1gina ${page + 1}/${pages} (${total} chaves)` : "\u2014";
}

async function selectKey(k) {
  selKey = k;
  renderKeys();
  let value = null;
  try { value = await DS.dsGet(selStore.name, selStore.scope, k); }
  catch (e) { logger.warn("DataStore Viewer: " + (e && e.message)); }
  renderValue(value);
}


function renderValue(value) {
  if (!valueWrapEl) return;
  valueWrapEl.textContent = "";
  if (!selKey) {
    valueWrapEl.appendChild(el("div", "rsw-dsv__empty", "Selecione uma chave."));
    return;
  }
  const title = el("div", "rsw-dsv__col-title", selKey);
  valueWrapEl.appendChild(title);

  const internal = !!(selStore && isInternalStore(selStore.name));
  if (internal && editMode) {
    valueWrapEl.appendChild(el("div", "rsw-dsv__note", "Store interno (Parte 59): somente leitura."));
  }
  if (editMode && !internal) {
    const ta = el("textarea", "rsw-dsv__editor");
    ta.value = prettyJson(value);
    ta.spellcheck = false;
    valueWrapEl.appendChild(ta);
    const errEl = el("div", "rsw-dsv__note");
    errEl.hidden = true;
    valueWrapEl.appendChild(errEl);
    const actions = el("div", "rsw-dsv__key-actions");
    const saveBtn = el("button", "rsw-dsv__btn", "Salvar");
    saveBtn.type = "button";
    saveBtn.addEventListener("click", () => saveValue(ta, errEl));
    const delBtn = el("button", "rsw-dsv__btn rsw-dsv__btn--danger", "Deletar chave");
    delBtn.type = "button";
    delBtn.addEventListener("click", () => deleteKey(selKey));
    actions.append(saveBtn, delBtn);
    valueWrapEl.appendChild(actions);
  } else {
    const pre = el("pre", "rsw-dsv__value", prettyJson(value));
    valueWrapEl.appendChild(pre);
  }
}

async function saveValue(ta, errEl) {
  let parsed;
  try {
    parsed = JSON.parse(ta.value);
  } catch (e) {
    errEl.hidden = false;
    errEl.textContent = "JSON inv\u00e1lido: " + (e && e.message);
    return;
  }
  const ok = await openConfirm({
    title: "Salvar valor",
    message: `Gravar o novo valor da chave "${selKey}"?`,
    buttons: [
      { label: "Cancelar", value: false, kind: "ghost" },
      { label: "Salvar", value: true, kind: "primary" },
    ],
  });
  if (!ok) return;
  try {
    await DS.dsSet(selStore.name, selStore.scope, selKey, parsed, null);
    DS.dsLog("info", `Chave "${selKey}" editada pelo DataStore Viewer.`, "DataStoreService");
    await reloadKeys();
    renderValue(parsed);
  } catch (e) {
    errEl.hidden = false;
    errEl.textContent = "Falha ao salvar: " + (e && e.message);
  }
}

async function deleteKey(k) {
  const ok = await doubleConfirm("Deletar chave", `Deletar a chave "${k}" de ${selStore.name}?`);
  if (!ok) return;
  try {
    await DS.dsRemove(selStore.name, selStore.scope, k);
    DS.dsLog("warn", `Chave "${k}" deletada pelo DataStore Viewer.`, "DataStoreService");
  } catch (e) { logger.warn("DataStore Viewer: " + (e && e.message)); }
  selKey = null;
  await reloadKeys();
  await refreshStores();
  renderValue(null);
}

async function createKey() {
  if (!selStore) return;
  const name = await openPrompt({
    title: "Nova chave",
    label: "Nome da chave (at\u00e9 50 caracteres):",
    okLabel: "Criar",
    maxLength: 50,
    validate: (v) => (!v || !v.trim() ? "Informe um nome de chave." : null),
  });
  if (!name) return;
  const key = name.trim();
  try {
    await DS.dsSet(selStore.name, selStore.scope, key, "", null);
    DS.dsLog("info", `Chave "${key}" criada pelo DataStore Viewer.`, "DataStoreService");
  } catch (e) {
    openInfo({ title: "Erro", content: "N\u00e3o foi poss\u00edvel criar a chave: " + (e && e.message) });
    return;
  }
  await reloadKeys();
  await refreshStores();
  await selectKey(key);
}

async function clearAllData() {
  const ok = await doubleConfirm(
    "Clear All Data",
    "Isto apaga TODOS os DataStores deste projeto (somente deste projeto).",
  );
  if (!ok) return;
  try {
    await DS.dsClearAll();
    DS.dsLog("warn", "Todos os dados de DataStore do projeto foram apagados (DataStore Viewer).", "DataStoreService");
  } catch (e) { logger.warn("DataStore Viewer: " + (e && e.message)); }
  selStore = null;
  selKey = null;
  keys = [];
  await refreshStores();
  renderKeys();
  renderValue(null);
}

function setEditMode(on) {
  editMode = !!on;
  if (editToggleEl) {
    editToggleEl.classList.toggle("rsw-dsv__btn--active", editMode);
    editToggleEl.textContent = editMode ? "Edi\u00e7\u00e3o: ON" : "Edi\u00e7\u00e3o: OFF";
  }
  renderKeys();

  if (selKey && selStore) selectKey(selKey);
  else renderValue(null);
}


function buildWindow() {
  win = el("div", "rsw-dsv");
  win.hidden = true;
  win.setAttribute("role", "dialog");
  win.setAttribute("aria-label", "DataStore Viewer");

  const header = el("div", "rsw-dsv__header");
  header.appendChild(el("span", "rsw-dsv__title", "DataStore Viewer"));
  const closeBtn = el("button", "rsw-dsv__close", "\u00d7");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Fechar DataStore Viewer");
  closeBtn.addEventListener("click", hide);
  header.appendChild(closeBtn);
  win.appendChild(header);


  const toolbar = el("div", "rsw-dsv__toolbar");
  const refreshBtn = el("button", "rsw-dsv__btn", "Atualizar");
  refreshBtn.type = "button";
  refreshBtn.addEventListener("click", async () => { await refreshStores(); if (selStore) await reloadKeys(); });
  editToggleEl = el("button", "rsw-dsv__btn", "Edi\u00e7\u00e3o: OFF");
  editToggleEl.type = "button";
  editToggleEl.addEventListener("click", () => setEditMode(!editMode));
  internalToggleEl = el("button", "rsw-dsv__btn", "Show Internal: OFF");
  internalToggleEl.type = "button";
  internalToggleEl.addEventListener("click", async () => {
    showInternal = !showInternal;
    internalToggleEl.textContent = showInternal ? "Show Internal: ON" : "Show Internal: OFF";
    internalToggleEl.classList.toggle("rsw-dsv__btn--active", showInternal);
    if (!showInternal && selStore && isInternalStore(selStore.name)) {
      selStore = null;
      selKey = null;
      keys = [];
      renderKeys();
      renderValue(null);
    }
    await refreshStores();
    if (selStore) await reloadKeys();
  });
  const clearBtn = el("button", "rsw-dsv__btn rsw-dsv__btn--danger", "Clear All Data");
  clearBtn.type = "button";
  clearBtn.addEventListener("click", clearAllData);
  toolbar.append(refreshBtn, editToggleEl, internalToggleEl, clearBtn);
  win.appendChild(toolbar);


  const body = el("div", "rsw-dsv__body");

  const colStores = el("div", "rsw-dsv__col rsw-dsv__col--stores");
  colStores.appendChild(el("div", "rsw-dsv__col-title", "DataStores"));
  storesListEl = el("div", "rsw-dsv__list");
  colStores.appendChild(storesListEl);
  body.appendChild(colStores);

  const colKeys = el("div", "rsw-dsv__col rsw-dsv__col--keys");
  colKeys.appendChild(el("div", "rsw-dsv__col-title", "Chaves"));
  keysSearchEl = el("input", "rsw-dsv__search");
  keysSearchEl.type = "text";
  keysSearchEl.placeholder = "Buscar por prefixo\u2026";
  keysSearchEl.spellcheck = false;
  keysSearchEl.addEventListener("input", () => {
    keyPrefix = keysSearchEl.value;
    page = 0;
    reloadKeys();
  });
  colKeys.appendChild(keysSearchEl);
  newKeyBtnEl = el("button", "rsw-dsv__btn rsw-dsv__btn--mini", "+ Nova chave");
  newKeyBtnEl.type = "button";
  newKeyBtnEl.hidden = true;
  newKeyBtnEl.addEventListener("click", createKey);
  colKeys.appendChild(newKeyBtnEl);
  keysListEl = el("div", "rsw-dsv__list");
  colKeys.appendChild(keysListEl);
  const pager = el("div", "rsw-dsv__pager");
  const prevBtn = el("button", "rsw-dsv__btn rsw-dsv__btn--mini", "\u2039");
  prevBtn.type = "button";
  prevBtn.addEventListener("click", () => { if (page > 0) { page--; renderKeys(); } });
  pagerLabelEl = el("span", "rsw-dsv__pager-label", "\u2014");
  const nextBtn = el("button", "rsw-dsv__btn rsw-dsv__btn--mini", "\u203a");
  nextBtn.type = "button";
  nextBtn.addEventListener("click", () => {
    if ((page + 1) * PAGE_SIZE < keys.length) { page++; renderKeys(); }
  });
  pager.append(prevBtn, pagerLabelEl, nextBtn);
  colKeys.appendChild(pager);
  body.appendChild(colKeys);

  const colValue = el("div", "rsw-dsv__col rsw-dsv__col--value");
  colValue.appendChild(el("div", "rsw-dsv__col-title", "Valor (JSON)"));
  valueWrapEl = el("div", "rsw-dsv__value-wrap");
  colValue.appendChild(valueWrapEl);
  body.appendChild(colValue);

  win.appendChild(body);


  let dragState = null;
  header.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target === closeBtn) return;
    const rect = win.getBoundingClientRect();
    dragState = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    header.setPointerCapture?.(e.pointerId);
  });
  header.addEventListener("pointermove", (e) => {
    if (!dragState) return;
    const maxX = Math.max(0, (globalThis.innerWidth || 1200) - 120);
    const maxY = Math.max(0, (globalThis.innerHeight || 800) - 60);
    win.style.left = Math.min(maxX, Math.max(0, e.clientX - dragState.dx)) + "px";
    win.style.top = Math.min(maxY, Math.max(0, e.clientY - dragState.dy)) + "px";
  });
  const endDrag = () => { dragState = null; };
  header.addEventListener("pointerup", endDrag);
  header.addEventListener("pointercancel", endDrag);

  document.body.appendChild(win);
}

async function show() {
  if (!win) buildWindow();
  if (visible) return;
  visible = true;
  win.hidden = false;
  if (!win.style.left) { win.style.left = "160px"; win.style.top = "110px"; }
  await refreshStores();
  if (selStore) await reloadKeys();
  bus.emit("datastoreviewer:visibilityChanged", { visible: true });
}

function hide() {
  if (!visible) return;
  visible = false;
  if (win) win.hidden = true;
  bus.emit("datastoreviewer:visibilityChanged", { visible: false });
}

export function isDataStoreViewerVisible() {
  return visible;
}

export function initDataStoreViewer() {
  bus.on("datastoreviewer:toggle", () => (visible ? hide() : show()));
  bus.on("datastoreviewer:show", show);
  bus.on("datastoreviewer:hide", hide);
  logger.info("DataStore Viewer inicializado.");
}
