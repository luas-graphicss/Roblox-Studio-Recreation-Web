import { bus } from "../core/eventBus.js";
import { logger } from "../core/logger.js";
import { store } from "../core/state.js";
import { commands } from "../core/commands.js";
import { selection } from "../core/selection.js";
import { settings } from "../config/settings.js";
import { readJSON, writeJSON } from "../utils/storage.js";
import { getService, createInstance } from "../datamodel/index.js";
import { Events } from "../datamodel/instance.js";
import { makeVector3 } from "../datamodel/types.js";
import { NotificationService } from "../services/notifications.js";            

const STATE_KEY = "teamcreate.state";
export const MAX_COLLABORATORS = 8;
export const NAME_MAX = 24;
const ACTIVITY_MAX = 400;
const LOCK_TTL_MS = 6000;
const SELECTION_TTL_MS = 10000;
const SCRIPT_LOCK_MIN_MS = 30000;
const SCRIPT_LOCK_MAX_MS = 90000;
const BOT_MIN_MS = 20000;
const BOT_MAX_MS = 60000;
const TICK_MS = 1200;
const IDLE_AFTER_MS = 90000;
const EDITING_WINDOW_MS = 8000;
const PROP_LOG_THROTTLE_MS = 2000;
const CURSOR_MAX_DRIFT = 45;                                                            
const RATE_WINDOW_MS = 1000;
const RATE_MAX = 8;
const MAX_WORKSPACE_PARTS = 500;
const SAFE_BOT_CLASSES = new Set(["Part", "WedgePart", "SpawnLocation"]);
const SCRIPT_CLASSES = new Set(["Script", "LocalScript", "ModuleScript"]);

export const OWNER_ID = "owner";

export const COLLAB_COLORS = Object.freeze([
  { hex: "#e5484d", name: "vermelho" },
  { hex: "#f76b15", name: "laranja" },
  { hex: "#ffb224", name: "amarelo" },
  { hex: "#30a46c", name: "verde" },
  { hex: "#0091ff", name: "azul" },
  { hex: "#8e4ec6", name: "roxo" },
  { hex: "#e93d82", name: "rosa" },
  { hex: "#12a594", name: "turquesa" },
]);

export function sanitizeCollabName(raw) {
  let s = String(raw == null ? "" : raw);
  s = s.replace(/<[^>]*>/g, " ").replace(/[<>]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  if (!s) s = "Colaborador";
  return s.slice(0, NAME_MAX);
}

export function pickColor(usedHexes) {
  const used = new Set(usedHexes || []);
  for (const c of COLLAB_COLORS) {
    if (!used.has(c.hex)) return c.hex;
  }
  return COLLAB_COLORS[used.size % COLLAB_COLORS.length].hex;
}

export function colorNameFor(hex) {
  const h = String(hex || "").toLowerCase();
  for (const c of COLLAB_COLORS) {
    if (c.hex === h) return c.name;
  }
  return "colorida";
}

export function formatActivityTime(ts) {
  const d = new Date(Number(ts) || Date.now());
  const hh = String(d.getHours()).padStart(2, "0");
  const mm = String(d.getMinutes()).padStart(2, "0");
  return hh + ":" + mm;
}

export function describeAction(type, actor, target, detail) {
  const a = String(actor || "Algu\u00e9m");
  const t = String(target || "objeto");
  switch (type) {
    case "create":
      return a + " criou " + t + (detail ? " em " + detail : "");
    case "delete":
      return a + " deletou " + t;
    case "move":
      return a + " moveu " + t;
    case "color":
      return a + " mudou cor de " + t + (detail ? " para " + detail : "");
    case "property":
      return a + " alterou " + (detail ? detail + " de " : "") + t;
    case "connect":
      return a + " entrou na sess\u00e3o";
    case "disconnect":
      return a + " saiu da sess\u00e3o";
    case "scriptStart":
      return a + " come\u00e7ou a editar " + t;
    case "scriptStop":
      return a + " parou de editar " + t;
    case "scriptRelease":
      return a + " liberou " + t + " a pedido";
    case "commit":
      return a + " publicou draft de " + t;
    case "revert":
      return a + " descartou draft de " + t;
    case "session":
      return a + " " + (detail || "atualizou a sess\u00e3o");
    default:
      return a + " editou " + t;
  }
}

export function sanitizeState(raw) {
  const out = { enabled: false, collabs: [] };
  if (!raw || typeof raw !== "object") return out;
  out.enabled = raw.enabled === true;
  const list = Array.isArray(raw.collabs) ? raw.collabs : [];
  const seen = new Set();
  for (const c of list) {
    if (!c || typeof c !== "object") continue;
    const id = String(c.id || "").slice(0, 40);
    if (!id || id === OWNER_ID || seen.has(id)) continue;
    seen.add(id);
    out.collabs.push({
      id,
      name: sanitizeCollabName(c.name),
      color: /^#[0-9a-fA-F]{6}$/.test(String(c.color || "")) ? String(c.color).toLowerCase() : pickColor(out.collabs.map((x) => x.color)),
      online: c.online === true,
    });
    if (out.collabs.length >= MAX_COLLABORATORS) break;
  }
  return out;
}

export function chooseBotAction(rng, ctx) {
  const c = ctx && typeof ctx === "object" ? ctx : {};
  const r = typeof rng === "function" ? rng() : Math.random();
  const hasParts = (c.partCount || 0) > 0;
  const hasScripts = (c.scriptCount || 0) > 0 && !c.scriptLocked;
  const canCreate = (c.workspaceCount || 0) < MAX_WORKSPACE_PARTS;
  if (hasScripts && r < 0.15) return "script";
  if (hasParts && r < 0.45) return "move";
  if (hasParts && r < 0.75) return "color";
  if (canCreate && r < 0.9) return "create";
  if (hasParts) return "move";
  return canCreate ? "create" : "idle";
}

let _inited = false;
let _enabled = false;
let _collabs = [];
let _followId = null;
let _botActing = null;
let _actSeq = 0;
let _activity = [];
let _tickTimer = null;
let _runtimeGuard = () => false;
const _timers = new Map();
const _status = new Map();
const _locks = new Map();
const _scriptLocks = new Map();
const _selections = new Map();
const _cameras = new Map();
const _cursors = new Map();
const _propLogThrottle = new Map();
const _rateStamps = [];
const _warnedLocks = new Set();

function persist() {
  writeJSON(STATE_KEY, {
    enabled: _enabled,
    collabs: _collabs.map((c) => ({ id: c.id, name: c.name, color: c.color, online: c.online })),
  });
}

function ownerName() {
  return "Owner";
}

function ownerColor() {
  const v = settings.get ? settings.get("tcUserColor") : null;
  return /^#[0-9a-fA-F]{6}$/.test(String(v || "")) ? String(v).toLowerCase() : "#4c8bf5";
}

function collabById(id) {
  if (id === OWNER_ID) {
    return { id: OWNER_ID, name: ownerName(), color: ownerColor(), online: true, owner: true };
  }
  return _collabs.find((c) => c.id === id) || null;
}

function rateLimited() {
  const now = Date.now();
  while (_rateStamps.length && now - _rateStamps[0] > RATE_WINDOW_MS) _rateStamps.shift();
  if (_rateStamps.length >= RATE_MAX) return true;
  _rateStamps.push(now);
  return false;
}

export function logActivity(entry) {
  const e = entry && typeof entry === "object" ? entry : {};
  const actor = collabById(e.actorId || OWNER_ID) || { name: "?", color: "#888888" };
  const rec = {
    id: "act_" + (++_actSeq),
    at: Date.now(),
    actorId: e.actorId || OWNER_ID,
    actorName: e.actorName || actor.name,
    color: e.color || actor.color,
    type: String(e.type || "edit"),
    message: String(e.message || "").slice(0, 240),
  };
  _activity.unshift(rec);
  if (_activity.length > ACTIVITY_MAX) _activity.length = ACTIVITY_MAX;
  bus.emit("collab:activity", rec);
  return rec;
}

export function getActivity(filter) {
  const f = filter && typeof filter === "object" ? filter : {};
  let list = _activity.slice();
  if (f.actorId) list = list.filter((e) => e.actorId === f.actorId);
  if (f.type) list = list.filter((e) => e.type === f.type);
  return list;
}

export function isEnabled() {
  return _enabled;
}

export function setRuntimeGuard(fn) {
  if (typeof fn === "function") _runtimeGuard = fn;
}

export function listCollaborators() {
  const now = Date.now();
  const out = [
    {
      id: OWNER_ID,
      name: ownerName(),
      color: ownerColor(),
      online: true,
      owner: true,
      status: "Online",
      action: "Editando o projeto",
    },
  ];
  for (const c of _collabs) {
    const st = _status.get(c.id) || {};
    let status = "Offline";
    let action = "";
    if (c.online) {
      const last = st.lastEditAt || st.connectedAt || 0;
      if (st.lastEditAt && now - st.lastEditAt < EDITING_WINDOW_MS) {
        status = "Editing";
        action = st.action || "Editando";
      } else if (now - last > IDLE_AFTER_MS) {
        status = "Idle";
        action = "Inativo";
      } else {
        status = "Online";
        action = st.action || "Observando";
      }
    }
    out.push({ id: c.id, name: c.name, color: c.color, online: c.online, owner: false, status, action });
  }
  return out;
}

function emitRoster() {
  bus.emit("collab:changed", { collaborators: listCollaborators(), enabled: _enabled });
}

export function addCollaborator(rawName) {
  if (_collabs.length >= MAX_COLLABORATORS) {
    logger.warn("Team Create: limite de colaboradores atingido.");


    NotificationService.notify("warning", "Limite de " + MAX_COLLABORATORS + " colaboradores atingido");
    return null;
  }
  const name = sanitizeCollabName(rawName);
  const id = "c_" + Date.now().toString(36) + "_" + Math.random().toString(36).slice(2, 6);
  const collab = { id, name, color: pickColor(_collabs.map((c) => c.color)), online: false };
  _collabs.push(collab);
  persist();
  emitRoster();
  return { ...collab };
}

export function removeCollaborator(id) {
  const idx = _collabs.findIndex((c) => c.id === id);
  if (idx < 0) return false;
  setConnected(id, false);
  _collabs.splice(idx, 1);
  _status.delete(id);


  if (_followId === id) setFollow(null);
  persist();
  emitRoster();
  return true;
}


function ensurePresence(id) {
  if (!_cameras.has(id)) {
    _cameras.set(id, {
      angle: Math.random() * Math.PI * 2,
      radius: 30 + Math.random() * 30,
      height: 14 + Math.random() * 18,
      speed: 0.05 + Math.random() * 0.08,
      target: { x: (Math.random() - 0.5) * 30, y: 2, z: (Math.random() - 0.5) * 30 },
    });
  }
  if (!_cursors.has(id)) {
    _cursors.set(id, { x: (Math.random() - 0.5) * 30, y: 3, z: (Math.random() - 0.5) * 30 });
  }
}

export function setConnected(id, online) {
  const c = _collabs.find((x) => x.id === id);
  if (!c || c.online === !!online) return false;
  c.online = !!online;
  if (c.online) {
    _status.set(id, { connectedAt: Date.now(), lastEditAt: 0, action: "" });
    ensurePresence(id);
    if (_enabled) {
      logActivity({ actorId: id, type: "connect", message: describeAction("connect", c.name) });
      NotificationService.notify("info", c.name + " joined the session");            
      scheduleBot(id);
    }
  } else {
    stopBot(id);
    releaseAllFor(id);
    _cameras.delete(id);
    _cursors.delete(id);
    if (_followId === id) setFollow(null);
    if (_enabled) {
      logActivity({ actorId: id, type: "disconnect", message: describeAction("disconnect", c.name) });
      NotificationService.notify("info", c.name + " left the session");            
    }
  }
  persist();
  emitRoster();
  return true;
}

function releaseAllFor(id) {
  let locksChanged = false;
  for (const [key, l] of _locks) {
    if (l.collabId === id) {
      _locks.delete(key);


      _warnedLocks.delete(key);
      locksChanged = true;
    }
  }
  let scriptsChanged = false;
  for (const [key, l] of _scriptLocks) {
    if (l.collabId === id) {
      _scriptLocks.delete(key);
      scriptsChanged = true;
    }
  }
  if (_selections.delete(id)) bus.emit("collab:selectionChanged", {});
  if (locksChanged) bus.emit("collab:locksChanged", {});
  if (scriptsChanged) bus.emit("collab:scriptLocks", {});
}

export function setEnabled(on) {
  const next = !!on;
  if (_enabled === next) return _enabled;
  _enabled = next;
  if (_enabled) {
    logActivity({ actorId: OWNER_ID, type: "session", message: describeAction("session", ownerName(), null, "ativou o Team Create") });
    for (const c of _collabs) {
      if (c.online) {
        _status.set(c.id, { connectedAt: Date.now(), lastEditAt: 0, action: "" });
        ensurePresence(c.id);
        scheduleBot(c.id);
      }
    }
    startTick();
  } else {
    logActivity({ actorId: OWNER_ID, type: "session", message: describeAction("session", ownerName(), null, "desativou o Team Create") });
    for (const id of Array.from(_timers.keys())) stopBot(id);
    stopTick();
    _locks.clear();
    _scriptLocks.clear();
    _selections.clear();
    _warnedLocks.clear();
    setFollow(null);
    bus.emit("collab:locksChanged", {});
    bus.emit("collab:scriptLocks", {});
    bus.emit("collab:selectionChanged", {});
  }
  persist();
  bus.emit("collab:enabledChanged", { enabled: _enabled });
  emitRoster();
  return _enabled;
}

export function setFollow(id) {




  const c = id ? collabById(id) : null;
  const next = c && c.online === true && id !== OWNER_ID ? id : null;
  if (_followId === next) return _followId;
  _followId = next;
  bus.emit("collab:followChanged", { id: _followId });
  return _followId;
}

export function getFollow() {
  return _followId;
}

export function getCameraPose(id) {
  const cam = _cameras.get(id);
  if (!cam) return null;
  const px = cam.target.x + Math.sin(cam.angle) * cam.radius;
  const pz = cam.target.z + Math.cos(cam.angle) * cam.radius;
  const py = cam.target.y + cam.height;
  const dx = cam.target.x - px;
  const dy = cam.target.y - py;
  const dz = cam.target.z - pz;
  const len = Math.hypot(dx, dy, dz) || 1;
  return {
    position: { x: px, y: py, z: pz },
    direction: { x: dx / len, y: dy / len, z: dz / len },


    radius: len,
  };
}

export function getCursors() {
  const out = [];
  for (const c of _collabs) {
    if (!c.online) continue;
    const p = _cursors.get(c.id);
    if (p) out.push({ id: c.id, name: c.name, color: c.color, x: p.x, y: p.y, z: p.z });
  }
  return out;
}

export function getCollabSelections() {
  const now = Date.now();
  const out = [];
  for (const [id, sel] of _selections) {
    if (sel.until < now) continue;
    const c = collabById(id);
    if (!c || !c.online) continue;
    out.push({ id, name: c.name, color: c.color, instIds: sel.instIds.slice() });
  }
  return out;
}

export function lockInfoFor(instId) {
  const l = _locks.get(instId);
  if (!l || l.until < Date.now()) return null;
  const c = collabById(l.collabId);
  return c ? { collabId: l.collabId, name: c.name, color: c.color } : null;
}

export function scriptLockFor(instId) {
  const l = _scriptLocks.get(instId);
  if (!l || l.until < Date.now()) return null;
  const c = collabById(l.collabId);
  return c ? { collabId: l.collabId, name: c.name, color: c.color } : null;
}

export function requestScriptEdit(instId) {
  const l = _scriptLocks.get(instId);
  if (!l || l.until < Date.now()) return false;
  const c = collabById(l.collabId);
  setTimeout(() => {
    const cur = _scriptLocks.get(instId);


    if (cur !== l) return;
    _scriptLocks.delete(instId);
    if (c) {
      logActivity({ actorId: l.collabId, type: "scriptStop", message: describeAction("scriptRelease", c.name, l.scriptName || "script") });
    }
    bus.emit("collab:scriptLocks", {});
  }, 1500 + Math.random() * 2000);
  return true;
}

function markBotEditing(id, action) {
  const st = _status.get(id) || { connectedAt: Date.now() };
  st.lastEditAt = Date.now();
  st.action = action;
  _status.set(id, st);
}

function workspaceOf() {
  const dm = store.getDataModel ? store.getDataModel() : null;
  if (!dm) return null;
  try {
    return getService(dm, "Workspace");
  } catch (_) {
    return null;
  }
}

function collectCandidates(ws) {
  const parts = [];
  const scripts = [];
  let count = 0;
  const visit = (inst, depth) => {
    if (!inst || depth > 6 || count > 800) return;
    for (const ch of inst.getChildren()) {
      count++;
      const cls = ch.className;
      if (SAFE_BOT_CLASSES.has(cls)) parts.push(ch);
      if (SCRIPT_CLASSES.has(cls)) scripts.push(ch);
      visit(ch, depth + 1);
    }
  };
  visit(ws, 0);
  return { parts, scripts, count };
}

function userSelectedIds() {
  try {
    return new Set(selection.get().map((i) => i.id));
  } catch (_) {
    return new Set();
  }
}

function botPickPart(parts, botId) {
  const now = Date.now();
  const selected = userSelectedIds();
  const pool = parts.filter((p) => {
    if (!p || p.isDestroyed()) return false;
    if (selected.has(p.id)) return false;
    const l = _locks.get(p.id);
    if (l && l.until > now && l.collabId !== botId) return false;
    if (p.hasProperty("Locked") && p.getProperty("Locked") === true) return false;
    return true;
  });
  if (!pool.length) return null;
  return pool[Math.floor(Math.random() * pool.length)];
}

function acquireLock(instId, botId) {


  const prev = _locks.get(instId);
  if (!prev || prev.until < Date.now() || prev.collabId !== botId) {
    _warnedLocks.delete(instId);
  }
  _locks.set(instId, { collabId: botId, until: Date.now() + LOCK_TTL_MS });
  bus.emit("collab:locksChanged", {});
}

function setBotSelection(botId, instIds) {
  _selections.set(botId, { instIds, until: Date.now() + SELECTION_TTL_MS });
  bus.emit("collab:selectionChanged", {});
}

function moveCursorTo(botId, pos) {
  if (pos && Number.isFinite(pos.x)) {
    _cursors.set(botId, { x: pos.x, y: (pos.y || 0) + 2, z: pos.z });
  }
}

function botMovePart(bot, part) {
  const old = part.getProperty("Position");
  if (!old) return false;
  const next = makeVector3(
    old.x + (Math.random() - 0.5) * 8,
    Math.max(0.5, old.y + (Math.random() - 0.5) * 2),
    old.z + (Math.random() - 0.5) * 8,
  );
  const name = part.name;
  const ok = commands.execute({
    name: "TC: " + bot.name + " moveu " + name,
    do: () => {
      if (!part.isDestroyed()) part.setProperty("Position", next);
    },
    undo: () => {
      if (!part.isDestroyed()) part.setProperty("Position", old);
    },
  });
  if (ok) {
    logActivity({ actorId: bot.id, type: "move", message: describeAction("move", bot.name, name) });
    moveCursorTo(bot.id, next);
  }
  return ok;
}

function botColorPart(bot, part) {
  if (!part.hasProperty("Color")) return false;
  const old = part.getProperty("Color");
  const pick = COLLAB_COLORS[Math.floor(Math.random() * COLLAB_COLORS.length)];
  const hex = pick.hex;
  const next = {
    r: parseInt(hex.slice(1, 3), 16) / 255,
    g: parseInt(hex.slice(3, 5), 16) / 255,
    b: parseInt(hex.slice(5, 7), 16) / 255,
  };
  const name = part.name;
  const ok = commands.execute({
    name: "TC: " + bot.name + " coloriu " + name,
    do: () => {
      if (!part.isDestroyed()) part.setProperty("Color", next);
    },
    undo: () => {
      if (!part.isDestroyed() && old) part.setProperty("Color", old);
    },
  });
  if (ok) {
    logActivity({ actorId: bot.id, type: "color", message: describeAction("color", bot.name, name, pick.name) });
    moveCursorTo(bot.id, part.getProperty("Position"));
  }
  return ok;
}

function botCreatePart(bot, ws) {
  let created = null;
  const pos = makeVector3((Math.random() - 0.5) * 48, 3, (Math.random() - 0.5) * 48);
  const ok = commands.execute({
    name: "TC: " + bot.name + " criou Part",
    do: () => {
      if (!created || created.isDestroyed()) {
        created = createInstance("Part");
        if (!created) return;
        if (created.hasProperty("Position")) created.setProperty("Position", pos);
        if (created.hasProperty("Anchored")) created.setProperty("Anchored", true);
      }
      created.setParent(ws);
    },
    undo: () => {
      if (created && !created.isDestroyed()) created.setParent(null);
    },
  });
  if (ok && created) {
    acquireLock(created.id, bot.id);
    setBotSelection(bot.id, [created.id]);
    logActivity({ actorId: bot.id, type: "create", message: describeAction("create", bot.name, created.name, "Workspace") });
    moveCursorTo(bot.id, pos);
    return true;
  }
  return false;
}

function botEditScript(bot, scripts) {
  const now = Date.now();
  const pool = scripts.filter((s) => {
    const l = _scriptLocks.get(s.id);
    return !l || l.until < now;
  });
  if (!pool.length) return false;
  const script = pool[Math.floor(Math.random() * pool.length)];
  const dur = SCRIPT_LOCK_MIN_MS + Math.random() * (SCRIPT_LOCK_MAX_MS - SCRIPT_LOCK_MIN_MS);
  _scriptLocks.set(script.id, {
    collabId: bot.id,
    until: now + dur,
    scriptName: script.name,
  });
  logActivity({ actorId: bot.id, type: "scriptStart", message: describeAction("scriptStart", bot.name, script.name) });
  bus.emit("collab:scriptLocks", {});
  return true;
}

function runBotEdit(id) {
  const bot = _collabs.find((c) => c.id === id);
  if (!bot || !bot.online || !_enabled) return;
  if (_runtimeGuard()) return;
  const ws = workspaceOf();
  if (!ws) return;
  const { parts, scripts, count } = collectCandidates(ws);
  const action = chooseBotAction(Math.random, {
    partCount: parts.length,
    scriptCount: scripts.length,
    scriptLocked: Array.from(_scriptLocks.values()).some((l) => l.collabId === id && l.until > Date.now()),
    workspaceCount: count,
  });
  _botActing = bot;
  try {
    if (action === "move" || action === "color") {
      const part = botPickPart(parts, id);
      if (part) {
        acquireLock(part.id, id);
        setBotSelection(id, [part.id]);
        markBotEditing(id, (action === "move" ? "Movendo " : "Colorindo ") + part.name);
        if (action === "move") botMovePart(bot, part);
        else botColorPart(bot, part);
      }
    } else if (action === "create") {
      markBotEditing(id, "Criando objeto");
      botCreatePart(bot, ws);
    } else if (action === "script") {
      markBotEditing(id, "Editando script");
      botEditScript(bot, scripts);
    }
  } catch (e) {
    logger.warn("Team Create: bot falhou: " + (e && e.message));
  } finally {
    _botActing = null;
  }
  emitRoster();
}

function scheduleBot(id) {
  stopBot(id);
  if (typeof document === "undefined") return;
  const delay = BOT_MIN_MS + Math.random() * (BOT_MAX_MS - BOT_MIN_MS);
  const timer = setTimeout(() => {
    _timers.delete(id);
    runBotEdit(id);
    const c = _collabs.find((x) => x.id === id);
    if (_enabled && c && c.online) scheduleBot(id);
  }, delay);
  _timers.set(id, timer);
}

function stopBot(id) {
  const t = _timers.get(id);
  if (t) {
    clearTimeout(t);
    _timers.delete(id);
  }
}

function tick() {
  const now = Date.now();
  let locksChanged = false;
  for (const [key, l] of _locks) {
    if (l.until < now) {
      _locks.delete(key);
      _warnedLocks.delete(key);
      locksChanged = true;
    }
  }
  if (locksChanged) bus.emit("collab:locksChanged", {});
  let scriptsChanged = false;
  for (const [key, l] of _scriptLocks) {
    if (l.until < now) {
      const c = collabById(l.collabId);
      _scriptLocks.delete(key);
      scriptsChanged = true;
      if (c) {
        logActivity({ actorId: l.collabId, type: "scriptStop", message: describeAction("scriptStop", c.name, l.scriptName || "script") });
      }
    }
  }
  if (scriptsChanged) bus.emit("collab:scriptLocks", {});
  let selChanged = false;
  for (const [id, sel] of _selections) {
    if (sel.until < now) {
      _selections.delete(id);
      selChanged = true;
    }
  }
  if (selChanged) bus.emit("collab:selectionChanged", {});
  for (const c of _collabs) {
    if (!c.online) continue;
    const cam = _cameras.get(c.id);
    if (cam) cam.angle += cam.speed * (TICK_MS / 1000);
    const cur = _cursors.get(c.id);
    if (cur) {


      const anchor = cam && cam.target ? cam.target : { x: 0, z: 0 };
      cur.x += (Math.random() - 0.5) * 1.2 - (cur.x - anchor.x) * 0.02;
      cur.z += (Math.random() - 0.5) * 1.2 - (cur.z - anchor.z) * 0.02;
      const ddx = cur.x - anchor.x;
      const ddz = cur.z - anchor.z;
      const dist = Math.hypot(ddx, ddz);
      if (dist > CURSOR_MAX_DRIFT) {
        const k = CURSOR_MAX_DRIFT / dist;
        cur.x = anchor.x + ddx * k;
        cur.z = anchor.z + ddz * k;
      }
    }
  }
  bus.emit("collab:cursors", { cursors: getCursors() });
}

function startTick() {
  if (_tickTimer || typeof document === "undefined") return;
  _tickTimer = setInterval(tick, TICK_MS);
}

function stopTick() {
  if (_tickTimer) {
    clearInterval(_tickTimer);
    _tickTimer = null;
  }
}

function onUserPropertyChanged(p) {
  if (!_enabled || !p || !p.instance) return;
  if (_runtimeGuard()) return;
  const inst = p.instance;
  const actor = _botActing;
  if (!actor) {
    const lock = lockInfoFor(inst.id);
    if (lock && !_warnedLocks.has(inst.id)) {
      _warnedLocks.add(inst.id);
      logger.warn(
        'Team Create: conflito de edi\u00e7\u00e3o \u2014 "' + inst.name + '" est\u00e1 sendo editado por ' + lock.name + ". A edi\u00e7\u00e3o dele veio primeiro.",
        { source: "Studio" },
      );
    }
  }
  if (p.property === "Source") return;


  if (actor) return;
  const key = inst.id + ":" + p.property;
  const now = Date.now();
  const last = _propLogThrottle.get(key) || 0;
  if (now - last < PROP_LOG_THROTTLE_MS) return;
  _propLogThrottle.set(key, now);
  if (_propLogThrottle.size > 300) _propLogThrottle.clear();
  if (rateLimited()) return;
  logActivity({
    actorId: OWNER_ID,
    type: "property",
    message: describeAction("property", ownerName(), inst.name, p.property),
  });
}

function onChildAdded(p) {
  if (!_enabled || !p || !p.child || _botActing) return;
  if (_runtimeGuard()) return;
  if (rateLimited()) return;
  logActivity({
    actorId: OWNER_ID,
    type: "create",
    message: describeAction("create", ownerName(), p.child.name, p.parent ? p.parent.name : ""),
  });
}

function onDestroying(p) {
  if (!_enabled || !p || !p.instance || _botActing) return;
  if (_runtimeGuard()) return;
  if (rateLimited()) return;
  logActivity({
    actorId: OWNER_ID,
    type: "delete",
    message: describeAction("delete", ownerName(), p.instance.name),
  });
}

export function init() {
  if (_inited) return;
  _inited = true;
  const st = sanitizeState(readJSON(STATE_KEY));
  _collabs = st.collabs;
  _enabled = false;
  bus.on(Events.PropertyChanged, onUserPropertyChanged);
  bus.on(Events.ChildAdded, onChildAdded);
  bus.on(Events.Destroying, onDestroying);
  bus.on("project:loaded", () => {
    _locks.clear();
    _scriptLocks.clear();
    _selections.clear();
    _warnedLocks.clear();
    _propLogThrottle.clear();
    bus.emit("collab:locksChanged", {});
    bus.emit("collab:scriptLocks", {});
    bus.emit("collab:selectionChanged", {});
  });
  if (st.enabled) setEnabled(true);
}

export function disposeForTests() {
  for (const id of Array.from(_timers.keys())) stopBot(id);
  stopTick();
  _collabs = [];
  _activity = [];
  _locks.clear();
  _scriptLocks.clear();
  _selections.clear();
  _cameras.clear();
  _cursors.clear();
  _status.clear();
  _enabled = false;
  _followId = null;
  _inited = false;
}
