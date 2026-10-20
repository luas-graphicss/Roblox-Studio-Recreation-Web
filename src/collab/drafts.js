import { bus } from "../core/eventBus.js";
import { logger } from "../core/logger.js";
import { store } from "../core/state.js";
import { commands } from "../core/commands.js";
import { readJSON, writeJSON } from "../utils/storage.js";
import { Events } from "../datamodel/instance.js";
import { NotificationService } from "../services/notifications.js";
import * as teamCreate from "./teamCreate.js";
import { currentProjectKey } from "./versionHistory.js";

const LEGACY_STORE_KEY = "drafts.pending";                                       
const STORE_PREFIX = "drafts.pending:";
export const DRAFT_TEXT_MAX = 512 * 1024;
const SCRIPT_CLASSES = new Set(["Script", "LocalScript", "ModuleScript"]);

let _inited = false;
let _drafts = new Map();
let _applyingCommit = false;
const _oversizeWarned = new Set();
const _dupPathWarned = new Set();                                                  
let _loadedKey = null;                                                     
let _projectSwitched = false;                                                  

export function pathOf(inst) {
  const segs = [];
  let cur = inst;
  let guard = 0;
  while (cur && cur.className !== "DataModel" && guard < 32) {
    segs.unshift(cur.name);
    cur = typeof cur.getParent === "function" ? cur.getParent() : cur.parent || null;
    guard++;
  }
  return segs.join(".");
}

export function isScriptInstance(inst) {
  return !!inst && SCRIPT_CLASSES.has(inst.className);
}

export function sanitizeDrafts(raw) {
  const out = [];
  if (!Array.isArray(raw)) return out;
  const seen = new Set();
  for (const d of raw) {
    if (!d || typeof d !== "object") continue;
    const path = String(d.path || "").slice(0, 400);
    if (!path || seen.has(path)) continue;
    if (typeof d.draftText !== "string" || typeof d.baseText !== "string") continue;
    if (d.draftText.length > DRAFT_TEXT_MAX || d.baseText.length > DRAFT_TEXT_MAX) continue;
    seen.add(path);
    out.push({
      path,
      name: String(d.name || path.split(".").pop() || "Script").slice(0, 80),
      author: String(d.author || "Owner").slice(0, 80),
      baseText: d.baseText,
      draftText: d.draftText,
      updatedAt: Number(d.updatedAt) || Date.now(),
      conflicted: d.conflicted === true,


      instId: typeof d.instId === "number" || typeof d.instId === "string" ? d.instId : null,
    });
    if (out.length >= 100) break;
  }
  return out;
}

function storeKey(projectKey) {
  return STORE_PREFIX + String(projectKey == null ? "session:local" : projectKey);
}

function currentKey() {
  try {
    return String(currentProjectKey() || "session:local");
  } catch (_) {
    return "session:local";                                                  
  }
}

function loadFromStorage(key) {
  _drafts = new Map();
  for (const d of sanitizeDrafts(readJSON(storeKey(key)))) _drafts.set(d.path, d);
  _oversizeWarned.clear();
  _dupPathWarned.clear();
  _loadedKey = key;
}


function ensureLoadedForKey() {
  if (!_inited) return;
  const key = currentKey();
  if (key === _loadedKey && !_projectSwitched) return;
  const migrate = !_projectSwitched && _loadedKey != null && key !== _loadedKey && _drafts.size > 0;
  _projectSwitched = false;
  if (migrate) {
    const oldKey = _loadedKey;
    _loadedKey = key;


    let merged = false;
    for (const d of sanitizeDrafts(readJSON(storeKey(key)))) {
      if (!_drafts.has(d.path)) {
        _drafts.set(d.path, d);
        merged = true;
      }
    }
    persist();
    writeJSON(storeKey(oldKey), []);
    if (merged) emitChanged();
    return;
  }
  loadFromStorage(key);
  emitChanged();
}

function persist() {
  writeJSON(storeKey(_loadedKey), Array.from(_drafts.values()));
}

function emitChanged() {
  bus.emit("drafts:changed", { count: _drafts.size });
}

export function isEnabled() {
  return teamCreate.isEnabled();
}

export function shouldIntercept(inst) {
  return isEnabled() && isScriptInstance(inst);
}

export function list() {
  ensureLoadedForKey();
  return Array.from(_drafts.values()).sort((a, b) => b.updatedAt - a.updatedAt);
}

export function get(path) {
  ensureLoadedForKey();
  return _drafts.get(String(path)) || null;
}

export function hasDraft(path) {
  ensureLoadedForKey();
  return _drafts.has(String(path));
}

export function count() {
  ensureLoadedForKey();
  return _drafts.size;
}

export function captureDraft(inst, newText) {
  if (!isScriptInstance(inst)) return null;
  ensureLoadedForKey();
  const text = String(newText == null ? "" : newText);
  const path = pathOf(inst);
  if (!path) return null;


  const pathOwner = resolveInstance(path);
  if (pathOwner && pathOwner !== inst) {
    if (!_dupPathWarned.has(path)) {
      _dupPathWarned.add(path);
      logger.warn('Drafts: h\u00e1 outro script no caminho "' + path + '" (nomes duplicados) \u2014 as edi\u00e7\u00f5es deste script N\u00c3O viram rascunho at\u00e9 voc\u00ea renome\u00e1-lo.', { source: "Studio" });
      NotificationService.notify("warning", '"' + inst.name + '": h\u00e1 outro script com esse nome no mesmo pai \u2014 rascunho desativado; renomeie o script');
    }
    return null;
  }
  _dupPathWarned.delete(path);
  if (text.length > DRAFT_TEXT_MAX) {


    if (!_oversizeWarned.has(path)) {
      _oversizeWarned.add(path);
      logger.warn('Drafts: "' + inst.name + '" excede 512 KB \u2014 as edi\u00e7\u00f5es N\u00c3O est\u00e3o sendo salvas como rascunho.', { source: "Studio" });
      NotificationService.notify("warning", '"' + inst.name + '": draft muito grande \u2014 edi\u00e7\u00f5es n\u00e3o est\u00e3o sendo salvas');
    }
    return null;
  }
  _oversizeWarned.delete(path);
  let d = _drafts.get(path);
  if (!d) {
    let base = "";
    try {
      base = String(inst.getProperty("Source") || "");
    } catch (_) {}
    d = {
      path,
      name: inst.name,
      author: "Owner",
      baseText: base,
      draftText: text,
      updatedAt: Date.now(),
      conflicted: false,
      instId: inst.id,
    };
    _drafts.set(path, d);
  } else {
    d.name = inst.name;
    d.draftText = text;
    d.updatedAt = Date.now();
    d.instId = inst.id;                                                 
  }


  if (d.draftText === d.baseText) {
    _drafts.delete(path);
  }
  persist();
  emitChanged();
  return d;
}


function resolveNode(path) {
  const dm = store.getDataModel ? store.getDataModel() : null;
  if (!dm) return null;
  const segs = String(path || "").split(".");
  if (!segs.length) return null;
  let cur = dm;
  for (const seg of segs) {
    if (!cur) return null;
    cur = cur.getChildren().find((c) => c.name === seg) || null;
  }
  return cur;
}

export function resolveInstance(path) {
  const cur = resolveNode(path);
  return cur && isScriptInstance(cur) ? cur : null;
}

export function commit(path) {
  ensureLoadedForKey();
  const d = _drafts.get(String(path));
  if (!d) return false;
  const inst = resolveInstance(d.path);
  if (!inst) {


    logger.warn('Drafts: script "' + d.path + '" n\u00e3o encontrado no projeto. Use Revert para descartar.');
    NotificationService.notify("warning", 'Commit de "' + d.name + '" falhou: o script n\u00e3o existe mais. Use Revert para descartar o rascunho.');
    return false;
  }
  let oldSource = "";
  try {
    oldSource = String(inst.getProperty("Source") || "");
  } catch (_) {}
  const nextSource = d.draftText;
  _applyingCommit = true;
  let ok = false;
  try {
    ok = commands.execute({
      name: "Commit draft: " + d.name,
      do: () => {
        if (!inst.isDestroyed()) inst.setProperty("Source", nextSource);
      },
      undo: () => {
        if (!inst.isDestroyed()) inst.setProperty("Source", oldSource);
      },
    });
  } finally {
    _applyingCommit = false;
  }
  if (!ok) {


    NotificationService.notify("warning", 'Commit de "' + d.name + '" falhou \u2014 veja o Output para detalhes.');
    return false;
  }
  _drafts.delete(d.path);
  persist();
  emitChanged();
  if (teamCreate.isEnabled()) {
    teamCreate.logActivity({
      actorId: teamCreate.OWNER_ID,
      type: "commit",
      message: teamCreate.describeAction("commit", "Owner", d.name),
    });
  }
  return true;
}

export function revert(path) {
  ensureLoadedForKey();
  const d = _drafts.get(String(path));
  if (!d) return false;
  _drafts.delete(d.path);
  persist();
  emitChanged();


  let inst = null;
  try {
    inst = resolveInstance(d.path);
  } catch (_) {}
  bus.emit("drafts:reverted", { path: d.path, name: d.name, instId: inst ? inst.id : null });
  if (teamCreate.isEnabled()) {
    teamCreate.logActivity({
      actorId: teamCreate.OWNER_ID,
      type: "revert",
      message: teamCreate.describeAction("revert", "Owner", d.name),
    });
  }
  return d;
}

export function commitAll() {
  let done = 0;
  for (const d of list()) {
    if (commit(d.path)) done++;
  }
  return done;
}

export function revertAll() {
  let done = 0;
  for (const d of list()) {
    if (revert(d.path)) done++;
  }
  return done;
}

export function markConflicted(path) {
  ensureLoadedForKey();
  const d = _drafts.get(String(path));
  if (!d || d.conflicted) return false;
  d.conflicted = true;
  persist();
  emitChanged();
  logger.warn('Drafts: "' + d.name + '" foi alterado por outra pessoa. Resolva o draft com Commit (mant\u00e9m seu texto) ou Revert.', { source: "Studio" });
  return true;
}

function onSourceChanged(p) {
  if (_applyingCommit || !p || !p.instance) return;
  if (p.property !== "Source") return;
  const inst = p.instance;
  if (!isScriptInstance(inst)) return;
  ensureLoadedForKey();
  const path = pathOf(inst);
  const d = _drafts.get(path);
  if (!d) return;


  if (resolveInstance(path) !== inst) return;
  const live = String(p.value == null ? "" : p.value);
  if (live === d.baseText) return;
  if (live === d.draftText) {


    _drafts.delete(path);
    persist();
    emitChanged();
    logger.info('Drafts: rascunho de "' + d.name + '" resolvido automaticamente (texto ao vivo id\u00eantico ao rascunho).', { source: "Studio" });
    return;
  }
  d.baseText = live;
  if (!markConflicted(path)) {


    persist();
    emitChanged();
  }
}





function repathDrafts(oldPath, newPath, moverId) {
  if (!oldPath || !newPath || oldPath === newPath) return false;
  let changed = false;
  const prefix = oldPath + ".";





  const oldOccupied = resolveNode(oldPath) != null;
  const destNode = resolveNode(newPath);
  const destIsMover = destNode == null || moverId == null || destNode.id === moverId;
  for (const [key, d] of Array.from(_drafts)) {
    let next = null;
    if (key === oldPath) {
      if (oldOccupied && !(moverId != null && d.instId === moverId)) continue;
      if (!destIsMover) continue;
      next = newPath;
    } else if (key.startsWith(prefix)) {
      if (oldOccupied || !destIsMover) continue;
      next = newPath + "." + key.slice(prefix.length);
    }
    if (next == null || next === key || _drafts.has(next)) continue;
    _drafts.delete(key);
    d.path = next;
    d.name = String(next.split(".").pop() || d.name);
    _drafts.set(next, d);
    changed = true;
  }
  if (changed) {
    persist();
    emitChanged();
  }
  return changed;
}

function onNameChanged(p) {
  if (!p || !p.instance || p.property !== "Name") return;
  ensureLoadedForKey();
  if (!_drafts.size) return;
  const oldName = String(p.oldValue == null ? "" : p.oldValue);
  if (!oldName || oldName === p.instance.name) return;
  const newPath = pathOf(p.instance);
  if (!newPath) return;
  const segs = newPath.split(".");
  segs[segs.length - 1] = oldName;
  repathDrafts(segs.join("."), newPath, p.instance.id);
}

function onParentMoved(p) {
  if (!p || !p.instance || !p.oldParent || !p.newParent) return;
  ensureLoadedForKey();
  if (!_drafts.size) return;
  const newPath = pathOf(p.instance);
  if (!newPath) return;
  const oldParentPath = pathOf(p.oldParent);
  const oldPath = oldParentPath ? oldParentPath + "." + p.instance.name : String(p.instance.name);
  repathDrafts(oldPath, newPath, p.instance.id);
}

export function init() {
  if (_inited) return;
  _inited = true;
  loadFromStorage(currentKey());


  const legacy = sanitizeDrafts(readJSON(LEGACY_STORE_KEY));
  if (legacy.length) {
    if (!_drafts.size) {
      for (const d of legacy) _drafts.set(d.path, d);
      persist();
    }
    writeJSON(LEGACY_STORE_KEY, []);
  }
  bus.on(Events.PropertyChanged, onSourceChanged);
  bus.on(Events.PropertyChanged, onNameChanged);
  bus.on(Events.ParentChanged, onParentMoved);


  bus.on("project:loaded", () => {
    _projectSwitched = true;
    ensureLoadedForKey();
  });
}

export function disposeForTests() {
  _drafts = new Map();
  _inited = false;
  _applyingCommit = false;
  _oversizeWarned.clear();
  _dupPathWarned.clear();
  _loadedKey = null;
  _projectSwitched = false;
}
