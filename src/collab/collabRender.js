import { bus } from "../core/eventBus.js";
import { store } from "../core/state.js";
import { settings } from "../config/settings.js";
import { setStatus } from "../core/project.js";
import { getProjection } from "../viewport/projection.js";
import * as teamCreate from "./teamCreate.js";

const UPDATE_MS = 250;

let _inited = false;
let _viewport = null;
let _layer = null;
let _timer = null;
const _cursorEls = new Map();
const _selEls = new Map();
let _markedRows = [];

function ensureLayer() {
  const proj = getProjection();
  if (!proj || !proj.container) return null;
  if (_layer && _layer.parentNode === proj.container) return _layer;
  if (_layer && _layer.parentNode) _layer.parentNode.removeChild(_layer);
  _layer = document.createElement("div");
  _layer.className = "rsw-collab-layer";
  proj.container.appendChild(_layer);
  return _layer;
}

function clearLayer() {
  for (const el of _cursorEls.values()) el.remove();
  for (const el of _selEls.values()) el.remove();
  _cursorEls.clear();
  _selEls.clear();
  if (_layer && _layer.parentNode) _layer.parentNode.removeChild(_layer);
  _layer = null;
}

function clearExplorerMarks() {
  for (const row of _markedRows) {
    row.classList.remove("rsw-collab-rowmark");
    row.style.removeProperty("--rsw-collab-color");
    row.removeAttribute("data-collab-name");
  }
  _markedRows = [];
}

function cursorEl(c) {
  let el = _cursorEls.get(c.id);
  if (!el) {
    el = document.createElement("div");
    el.className = "rsw-collab-cursor";
    const arrow = document.createElement("span");
    arrow.className = "rsw-collab-cursor__arrow";
    arrow.textContent = "\u27a4";
    const tag = document.createElement("span");
    tag.className = "rsw-collab-cursor__tag";
    el.append(arrow, tag);
    _cursorEls.set(c.id, el);
  }
  return el;
}

function selEl(key) {
  let el = _selEls.get(key);
  if (!el) {
    el = document.createElement("div");
    el.className = "rsw-collab-selbox";
    const tag = document.createElement("span");
    tag.className = "rsw-collab-selbox__tag";
    el.appendChild(tag);
    _selEls.set(key, el);
  }
  return el;
}









export function findInstance(id) {
  const dm = store.getDataModel ? store.getDataModel() : null;
  if (!dm) return null;
  const stack = [{ inst: dm, depth: 0 }];
  let budget = 20000;
  while (stack.length) {
    const { inst, depth } = stack.pop();
    if (depth > 128) continue;
    for (const ch of inst.getChildren()) {
      if (ch.id === id) return ch;
      if (--budget <= 0) return null;
      stack.push({ inst: ch, depth: depth + 1 });
    }
  }
  return null;
}

function updateOverlay() {
  if (!teamCreate.isEnabled()) return;
  const proj = getProjection();
  const layer = ensureLayer();
  if (!proj || !layer) return;

  const cursors = teamCreate.getCursors();
  const seen = new Set();
  for (const c of cursors) {
    const p = proj.project(c.x, c.y, c.z);
    const el = cursorEl(c);
    if (!p || !p.visible) {
      el.style.display = "none";
      seen.add(c.id);
      continue;
    }
    seen.add(c.id);
    if (el.parentNode !== layer) layer.appendChild(el);
    el.style.display = "";
    el.style.transform = "translate(" + Math.round(p.x) + "px, " + Math.round(p.y) + "px)";
    el.style.setProperty("--rsw-collab-color", c.color);
    const tag = el.querySelector(".rsw-collab-cursor__tag");
    if (tag && tag.textContent !== c.name) tag.textContent = c.name;
  }
  for (const [id, el] of _cursorEls) {
    if (!seen.has(id)) {
      el.remove();
      _cursorEls.delete(id);
    }
  }

  const sels = teamCreate.getCollabSelections();
  const seenSel = new Set();
  clearExplorerMarks();
  for (const s of sels) {
    for (const instId of s.instIds) {
      const key = s.id + ":" + instId;
      seenSel.add(key);
      const inst = findInstance(instId);
      const el = selEl(key);
      let placed = false;
      if (inst && !inst.isDestroyed() && inst.hasProperty("Position")) {
        const pos = inst.getProperty("Position");
        const p = pos ? proj.project(pos.x, pos.y, pos.z) : null;
        if (p && p.visible) {
          const size = Math.max(26, Math.min(120, 900 / Math.max(1, p.dist)));
          if (el.parentNode !== layer) layer.appendChild(el);
          el.style.display = "";
          el.style.width = size + "px";
          el.style.height = size + "px";
          el.style.transform =
            "translate(" + Math.round(p.x - size / 2) + "px, " + Math.round(p.y - size / 2) + "px)";
          el.style.setProperty("--rsw-collab-color", s.color);
          const tag = el.querySelector(".rsw-collab-selbox__tag");
          if (tag && tag.textContent !== s.name) tag.textContent = s.name;
          placed = true;
        }
      }
      if (!placed) el.style.display = "none";


      const row = document.querySelector('.rsw-explorer [data-id="' + instId + '"]');
      if (row) {
        row.classList.add("rsw-collab-rowmark");
        row.style.setProperty("--rsw-collab-color", s.color);
        row.setAttribute("data-collab-name", s.name);
        _markedRows.push(row);
      }
    }
  }
  for (const [key, el] of _selEls) {
    if (!seenSel.has(key)) {
      el.remove();
      _selEls.delete(key);
    }
  }

  const followId = teamCreate.getFollow();
  if (followId && _viewport && _viewport.rig) {
    const pose = teamCreate.getCameraPose(followId);
    if (pose) {
      try {
        _viewport.rig.setPose(pose.position, pose.direction, pose.radius);
        if (typeof _viewport.refresh === "function") _viewport.refresh();
      } catch (_) {}
    }
  }
}

function startTimer() {
  if (_timer || typeof document === "undefined") return;
  _timer = setInterval(updateOverlay, UPDATE_MS);
}

function stopTimer() {
  if (_timer) {
    clearInterval(_timer);
    _timer = null;
  }
  clearLayer();
  clearExplorerMarks();
}

export function initCollabRender(opts) {
  if (_inited) return;
  _inited = true;
  _viewport = opts && opts.viewport ? opts.viewport : null;

  bus.on("collab:enabledChanged", (p) => {
    if (p && p.enabled) startTimer();
    else stopTimer();
  });

  bus.on("collab:activity", (rec) => {
    if (!rec || settings.get("tcNotifications") === false) return;
    if (rec.actorId === teamCreate.OWNER_ID) return;


    const msg = String(rec.message || "");
    const prefix = String(rec.actorName || "") + " ";
    const body = rec.actorName && msg.startsWith(prefix) ? msg.slice(prefix.length) : msg;
    const when = typeof rec.at === "number" ? " \u00e0s " + teamCreate.formatActivityTime(rec.at) : "";
    setStatus(rec.actorName + ": " + body + when);
  });

  bus.on("collab:changed", () => {
    if (!teamCreate.isEnabled()) return;
    if (settings.get("tcAutoFollow") === true && !teamCreate.getFollow()) {
      const online = teamCreate.listCollaborators().find((c) => !c.owner && c.online);
      if (online) teamCreate.setFollow(online.id);
    }
  });

  bus.on("project:loaded", () => {
    clearLayer();
    clearExplorerMarks();
  });

  if (teamCreate.isEnabled()) startTimer();
}
