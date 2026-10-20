import { NotificationService } from "../services/notifications.js";
import { bus } from "../core/eventBus.js";
import { createIcon } from "./icons.js";

const TOAST_LIMIT = 3;


const QUEUE_LIMIT = 12;
const TYPE_ICONS = { info: "info", success: "check", warning: "warning", error: "close" };

let _inited = false;
let _host = null;
let _dropdown = null;
let _listEl = null;
let _anchor = null;
let _refreshTimer = 0;
let _toastSeq = 0;                                                                     
const _badges = [];
const _pool = [];
const _active = [];
const _queue = [];

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function relTime(ts) {
  const s = Math.max(0, Math.floor((Date.now() - ts) / 1000));
  if (s < 10) return "just now";
  if (s < 60) return s + "s ago";
  const m = Math.floor(s / 60);
  if (m < 60) return m + " min ago";
  const h = Math.floor(m / 60);
  if (h < 24) return h + "h ago";
  return Math.floor(h / 24) + "d ago";
}




export function registerNotificationBadge(node) {
  if (!node || _badges.includes(node)) return;
  _badges.push(node);
  updateBadges();
}

function updateBadges() {
  const n = NotificationService.unreadCount();
  const label = n > 99 ? "99+" : String(n);
  for (let i = _badges.length - 1; i >= 0; i--) {
    const b = _badges[i];


    if (b.isConnected) b._rswSeen = true;
    else if (b._rswSeen) {
      _badges.splice(i, 1);
      continue;
    }
    b.textContent = label;
    b.classList.toggle("is-hidden", n === 0);
  }
}


function ensureHost() {
  if (!_host) {
    _host = el("div", "rsw-toasthost");
    _host.setAttribute("role", "status");
    _host.setAttribute("aria-live", "polite");
    document.body.appendChild(_host);
  }
  return _host;
}

function obtainToast() {
  const pooled = _pool.pop();
  if (pooled) return pooled;
  const root = el("div", "rsw-toast");
  const icon = el("span", "rsw-toast__icon");
  const msg = el("div", "rsw-toast__msg");
  const action = el("button", "rsw-toast__action");
  action.type = "button";
  const close = el("button", "rsw-toast__close");
  close.appendChild(createIcon("close", 12));
  close.type = "button";
  close.title = "Dismiss";
  const bar = el("div", "rsw-toast__bar");
  const fill = el("div", "rsw-toast__barfill");
  bar.appendChild(fill);
  const main = el("div", "rsw-toast__main");
  main.append(msg, action);
  root.append(icon, main, close, bar);
  return { root, icon, msg, action, close, bar, fill, timer: null, itemId: null, session: 0, released: false };
}

function releaseToast(t) {


  if (t.released) return;
  t.released = true;
  t.itemId = null;
  if (t.timer) {
    clearInterval(t.timer);
    t.timer = null;
  }
  const i = _active.indexOf(t);
  if (i >= 0) _active.splice(i, 1);
  if (t.root.parentNode) t.root.parentNode.removeChild(t.root);
  if (_pool.length < TOAST_LIMIT) _pool.push(t);
  const next = _queue.shift();
  if (next) showToast(next);
}

function showToast(item) {
  if (_active.length >= TOAST_LIMIT) {
    _queue.push(item);

    while (_queue.length > QUEUE_LIMIT) _queue.shift();
    return;
  }
  const t = obtainToast();
  t.released = false;
  const session = ++_toastSeq;
  t.session = session;
  t.itemId = item.id;
  t.root.className = "rsw-toast rsw-toast--" + item.type;
  t.icon.replaceChildren(createIcon(TYPE_ICONS[item.type] || "info", 14));
  t.msg.textContent = item.message;
  if (item.actionLabel && NotificationService.hasAction(item.id)) {
    t.action.textContent = item.actionLabel;
    t.action.style.display = "";
    t.action.onclick = () => {
      if (t.session !== session) return;                                      
      NotificationService.runAction(item.id);
      releaseToast(t);
    };
  } else {
    t.action.textContent = "";
    t.action.style.display = "none";
    t.action.onclick = null;
  }
  t.close.onclick = () => {
    if (t.session !== session) return;                                      
    releaseToast(t);
  };

  const durMs = item.duration > 0 ? item.duration * 1000 : 0;
  let remaining = durMs;
  let paused = false;
  let last = Date.now();
  t.root.onmouseenter = () => {
    paused = true;
  };
  t.root.onmouseleave = () => {
    paused = false;
    last = Date.now();
  };
  if (t.timer) clearInterval(t.timer);
  if (durMs > 0) {
    t.bar.style.display = "";
    t.fill.style.width = "100%";
    last = Date.now();
    t.timer = setInterval(() => {
      const now = Date.now();
      if (!paused) remaining -= now - last;
      last = now;
      const pct = Math.max(0, Math.min(100, (remaining / durMs) * 100));
      t.fill.style.width = pct + "%";
      if (remaining <= 0 && t.session === session) releaseToast(t);
    }, 100);
  } else if (item.progress != null) {


    t.bar.style.display = "";
    t.fill.style.width = Math.round(Math.max(0, Math.min(1, item.progress)) * 100) + "%";
  } else {
    t.bar.style.display = "none";
  }
  _active.push(t);
  ensureHost().appendChild(t.root);
}


function closeDropdown() {
  if (!_dropdown) return;
  if (_dropdown.parentNode) _dropdown.parentNode.removeChild(_dropdown);
  _dropdown = null;
  _listEl = null;
  _anchor = null;
  if (_refreshTimer) {
    clearInterval(_refreshTimer);
    _refreshTimer = 0;
  }
  document.removeEventListener("mousedown", onDocDown, true);
  document.removeEventListener("keydown", onDocKey, true);
}

function onDocDown(e) {
  if (!_dropdown || _dropdown.contains(e.target)) return;
  if (_anchor && _anchor.contains(e.target)) return;
  closeDropdown();
}

function onDocKey(e) {
  if (e.key === "Escape") {
    e.stopPropagation();
    closeDropdown();
  }
}

function renderList() {
  if (!_listEl) return;
  const items = NotificationService.list();
  _listEl.replaceChildren();
  if (!items.length) {
    _listEl.appendChild(el("div", "rsw-notif__empty", "No notifications"));
    return;
  }
  for (const item of items) {
    const row = el("div", "rsw-notif__item rsw-notif__item--" + item.type + (item.read ? "" : " is-unread"));
    const icon = el("span", "rsw-notif__icon");
    icon.appendChild(createIcon(TYPE_ICONS[item.type] || "info", 14));
    const body = el("div", "rsw-notif__body");
    body.appendChild(el("div", "rsw-notif__msg", item.message));
    const meta = el("div", "rsw-notif__meta", relTime(item.time));
    if (item.actionLabel && NotificationService.hasAction(item.id)) {
      const act = el("span", "rsw-notif__actionhint", item.actionLabel);
      meta.appendChild(act);
    }
    body.appendChild(meta);
    const dis = el("button", "rsw-notif__dismiss");
    dis.appendChild(createIcon("close", 12));
    dis.type = "button";
    dis.title = "Dismiss";
    dis.addEventListener("click", (e) => {
      e.stopPropagation();
      NotificationService.dismiss(item.id);
    });
    row.append(icon, body, dis);
    row.addEventListener("click", () => {
      if (NotificationService.hasAction(item.id)) {
        NotificationService.runAction(item.id);
        closeDropdown();
      } else {
        NotificationService.markRead(item.id);
      }
    });
    _listEl.appendChild(row);
  }
}

export function toggleNotificationCenter(anchor) {
  if (_dropdown) {
    const sameAnchor = _anchor === anchor;
    closeDropdown();
    if (sameAnchor) return;
  }
  const dd = el("div", "rsw-notif");
  dd.setAttribute("role", "dialog");
  dd.setAttribute("aria-label", "Notifications");
  const head = el("div", "rsw-notif__head");
  head.appendChild(el("span", "rsw-notif__title", "Notifications"));
  const markBtn = el("button", "rsw-notif__headbtn", "Mark All as Read");
  markBtn.type = "button";
  markBtn.addEventListener("click", () => NotificationService.markAllRead());
  const clearBtn = el("button", "rsw-notif__headbtn", "Clear All");
  clearBtn.type = "button";
  clearBtn.addEventListener("click", () => NotificationService.clearAll());
  head.append(markBtn, clearBtn);
  const list = el("div", "rsw-notif__list");
  dd.append(head, list);

  const r = anchor && anchor.getBoundingClientRect ? anchor.getBoundingClientRect() : { bottom: 40, right: window.innerWidth - 8 };
  dd.style.top = Math.round(r.bottom + 6) + "px";
  dd.style.right = Math.max(8, Math.round(window.innerWidth - r.right)) + "px";
  document.body.appendChild(dd);
  _dropdown = dd;
  _listEl = list;
  _anchor = anchor && anchor.getBoundingClientRect ? anchor : null;
  renderList();
  _refreshTimer = window.setInterval(renderList, 30000);
  document.addEventListener("mousedown", onDocDown, true);
  document.addEventListener("keydown", onDocKey, true);
}

export function initNotificationCenter() {
  if (_inited) return;
  _inited = true;
  bus.on("notif:added", (p) => {
    if (p && p.item && !p.item.silent) showToast(p.item);
  });


  bus.on("notif:updated", (p) => {
    if (!p || !p.item) return;
    for (const q of _queue) {
      if (q.id === p.item.id) {
        q.message = p.item.message;
        q.progress = p.item.progress;
      }
    }
    for (const t of _active) {
      if (t.itemId !== p.item.id) continue;
      t.msg.textContent = p.item.message;
      if (p.item.progress != null && !t.timer) {
        t.bar.style.display = "";
        t.fill.style.width = Math.round(Math.max(0, Math.min(1, p.item.progress)) * 100) + "%";
      }
    }
    if (_dropdown) renderList();
  });
  bus.on("notif:changed", () => {
    updateBadges();
    if (_dropdown) renderList();
  });


  bus.on("notif:removed", (p) => {
    if (!p || !Array.isArray(p.ids) || !p.ids.length) return;
    const removed = new Set(p.ids);


    for (let i = _queue.length - 1; i >= 0; i--) {
      if (removed.has(_queue[i].id)) _queue.splice(i, 1);
    }
    for (const t of [..._active]) {
      if (t.itemId && removed.has(t.itemId)) releaseToast(t);
    }
  });

  function _onResize() { closeDropdown(); }
  window.addEventListener("resize", _onResize);
}
