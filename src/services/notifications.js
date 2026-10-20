import { bus } from "../core/eventBus.js";
import { logger } from "../core/logger.js";

const MAX_ITEMS = 50;
const DEFAULT_DURATION = 5;
const TYPES = new Set(["info", "success", "warning", "error"]);

let _seq = 0;
const _items = [];

function sanitizeType(type) {
  const t = String(type || "").toLowerCase();
  return TYPES.has(t) ? t : "info";
}

function unreadCount() {
  let n = 0;
  for (const it of _items) if (!it.read) n += 1;
  return n;
}

function emitChanged() {
  bus.emit("notif:changed", { unread: unreadCount() });
}

function find(id) {
  return _items.find((it) => it.id === id) || null;
}


function toPublic(it) {
  return {
    id: it.id,
    type: it.type,
    message: it.message,
    time: it.time,
    read: it.read,
    actionLabel: it.actionLabel,
    duration: it.duration,
    silent: it.silent,
    progress: it.progress,
  };
}


function progressOf(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(1, n));
}

function notify(type, message, options) {
  const opts = options && typeof options === "object" ? options : {};
  const msg = String(message == null ? "" : message).slice(0, 400);
  if (!msg) return null;
  const dur = Number(opts.duration);
  const item = {
    id: "n" + Date.now().toString(36) + "_" + (++_seq),
    type: sanitizeType(type),
    message: msg,
    time: Date.now(),
    read: false,
    actionLabel: typeof opts.actionLabel === "string" ? opts.actionLabel.slice(0, 60) : "",
    actionCallback: typeof opts.actionCallback === "function" ? opts.actionCallback : null,
    duration: Number.isFinite(dur) && dur >= 0 ? dur : DEFAULT_DURATION,
    silent: !!opts.silent,
    progress: progressOf(opts.progress),                                    
  };
  _items.unshift(item);


  const droppedIds = [];
  while (_items.length > MAX_ITEMS) {
    const dropped = _items.pop();
    if (dropped) droppedIds.push(dropped.id);
  }
  bus.emit("notif:added", { item: toPublic(item) });
  if (droppedIds.length) bus.emit("notif:removed", { ids: droppedIds });
  emitChanged();
  return item.id;
}

function list() {
  return _items.map(toPublic);
}





function update(id, patch) {
  const it = find(id);
  if (!it) return false;
  const p = patch && typeof patch === "object" ? patch : {};
  if (typeof p.message === "string" && p.message) it.message = p.message.slice(0, 400);
  if ("progress" in p) it.progress = progressOf(p.progress);
  bus.emit("notif:updated", { item: toPublic(it) });
  return true;
}

function dismiss(id) {
  const i = _items.findIndex((it) => it.id === id);
  if (i < 0) return false;
  _items.splice(i, 1);
  bus.emit("notif:removed", { ids: [id] });
  emitChanged();
  return true;
}

function markRead(id) {
  const it = find(id);
  if (!it || it.read) return false;
  it.read = true;
  emitChanged();
  return true;
}

function markAllRead() {
  let changed = false;
  for (const it of _items) {
    if (!it.read) {
      it.read = true;
      changed = true;
    }
  }
  if (changed) emitChanged();
  return changed;
}

function clearAll() {
  if (!_items.length) return false;
  const ids = _items.map((it) => it.id);
  _items.length = 0;
  bus.emit("notif:removed", { ids });
  emitChanged();
  return true;
}



function runAction(id) {
  const it = find(id);
  if (!it) return false;
  if (!it.read) {
    it.read = true;
    emitChanged();
  }
  if (typeof it.actionCallback !== "function") return false;
  try {
    it.actionCallback();
    return true;
  } catch (e) {
    logger.warn("Notificação: ação falhou: " + ((e && e.message) || e), { source: "Studio" });
    return false;
  }
}

function hasAction(id) {
  const it = find(id);
  return !!(it && typeof it.actionCallback === "function");
}

export const NotificationService = {
  notify,
  update,       
  list,
  dismiss,
  markRead,
  markAllRead,
  clearAll,
  unreadCount,
  runAction,
  hasAction,
};
