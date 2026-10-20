import { store } from "../core/state.js";

import { deepCloneJsonValue } from "../core/deepCloneJsonValue.js";
import { bus } from "../core/eventBus.js";
import { logger } from "../core/logger.js";
import { readJSON, writeJSON } from "../utils/storage.js";
import { isToolboxVisible } from "./toolbox.js";
import { isAssetManagerVisible } from "./assetManager.js";

const STORAGE_KEY = "savedLayouts";
export const MAX_SAVED_LAYOUTS = 10;
export const MAX_LAYOUT_NAME = 50;
const ANIM_CLASS = "rsw-layout-anim";
const ANIM_MS = 320;

function isPlainObject(v) {
  return !!v && typeof v === "object" && !Array.isArray(v);
}


export function sanitizeLayoutName(name) {
  let s = String(name == null ? "" : name);

  s = s.replace(/[\u0000-\u001f\u007f]/g, "").replace(/[<>]/g, "").trim();
  if (s.length > MAX_LAYOUT_NAME) s = s.slice(0, MAX_LAYOUT_NAME);
  return s;
}


function isValidSavedEntry(e) {
  if (!isPlainObject(e)) return false;
  if (typeof e.name !== "string") return false;
  const name = sanitizeLayoutName(e.name);
  if (!name) return false;
  if (!isPlainObject(e.layout) || !isPlainObject(e.layout.panels)) return false;
  if (e.extras != null && !isPlainObject(e.extras)) return false;
  return true;
}

export function listSavedLayouts() {
  const raw = readJSON(STORAGE_KEY);
  if (!Array.isArray(raw)) return [];
  const out = [];
  for (const e of raw) {
    if (!isValidSavedEntry(e)) continue;                                          
    out.push({
      name: sanitizeLayoutName(e.name),
      layout: e.layout,
      extras: isPlainObject(e.extras) ? e.extras : {},
    });
    if (out.length >= MAX_SAVED_LAYOUTS) break;
  }
  return out;
}

export function hasSavedLayout(name) {
  const n = sanitizeLayoutName(name);
  return listSavedLayouts().some((e) => e.name === n);
}

function persist(list) {
  writeJSON(STORAGE_KEY, list.slice(0, MAX_SAVED_LAYOUTS));
  bus.emit("layouts:changed", { count: Math.min(list.length, MAX_SAVED_LAYOUTS) });
}


export function snapshotCurrentLayout() {
  const st = store.getState();
  return {
    layout: deepCloneJsonValue(st.layout),
    extras: {
      commandBar: !!st.commandBarVisible,
      toolbox: safeBool(isToolboxVisible),
      assetManager: safeBool(isAssetManagerVisible),
    },
  };
}

function safeBool(fn) {
  try { return !!fn(); } catch (_) { return false; }
}


export function saveCurrentLayout(name, { overwrite = false } = {}) {
  const n = sanitizeLayoutName(name);
  if (!n) return { ok: false, reason: "invalid-name" };
  const list = listSavedLayouts();
  const idx = list.findIndex((e) => e.name === n);
  if (idx >= 0 && !overwrite) return { ok: false, reason: "exists" };
  const entry = { name: n, ...snapshotCurrentLayout() };
  if (idx >= 0) {
    list[idx] = entry;
  } else {
    if (list.length >= MAX_SAVED_LAYOUTS) return { ok: false, reason: "full" };
    list.push(entry);
  }
  persist(list);
  logger.info(`Layout "${n}" salvo (${list.length}/${MAX_SAVED_LAYOUTS}).`);
  return { ok: true };
}

export function deleteSavedLayout(name) {
  const n = sanitizeLayoutName(name);
  const list = listSavedLayouts().filter((e) => e.name !== n);
  persist(list);
}


function applySnapshot(snap) {
  const wsEl = typeof document !== "undefined" ? document.querySelector(".rsw-workspace") : null;
  if (wsEl) {
    wsEl.classList.add(ANIM_CLASS);
    setTimeout(() => wsEl.classList.remove(ANIM_CLASS), ANIM_MS);
  }
  store.setLayout(snap.layout || {});
  const ex = isPlainObject(snap.extras) ? snap.extras : {};
  store.set("commandBarVisible", ex.commandBar === true);
  bus.emit(ex.toolbox === true ? "toolbox:show" : "toolbox:hide");
  bus.emit(ex.assetManager === true ? "assetmanager:show" : "assetmanager:hide");
}


export function restoreSavedLayout(name) {
  const n = sanitizeLayoutName(name);
  const entry = listSavedLayouts().find((e) => e.name === n);
  if (!entry) {
    logger.warn(`Layout "${n}" não encontrado.`);
    return false;
  }
  applySnapshot(entry);
  logger.info(`Layout "${n}" restaurado.`);
  return true;
}


export function defaultStudioLayoutSnapshot() {
  let sideH = 0;
  if (typeof document !== "undefined") {
    const right = document.querySelector(".rsw-rightpanel");
    if (right) sideH = right.clientHeight;
    if (!sideH) {
      const ws = document.querySelector(".rsw-workspace");
      if (ws) sideH = Math.max(0, ws.clientHeight - 180 - 6);
    }
  }
  if (!sideH) sideH = Math.max(300, ((globalThis.innerHeight || 800) - 240));
  const explorerHeight = Math.max(140, Math.round(sideH * 0.6));
  return {
    layout: {
      rightWidth: 260,
      explorerHeight,
      outputHeight: 180,
      analysisHeight: 160,
      debuggerHeight: 220,
      findHeight: 200,
      assistantWidth: 340,
      apiBrowserWidth: 420,            
      panels: { explorer: true, properties: true, output: true, analysis: false, debugger: false, find: false, assistant: false, apiBrowser: false },
    },
    extras: { commandBar: false, toolbox: false, assetManager: false },
  };
}


export function resetToDefaultLayout() {
  applySnapshot(defaultStudioLayoutSnapshot());
  bus.emit("taskscheduler:hide");
  logger.info("Layout resetado para o padrão do Studio.");
}
