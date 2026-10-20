import { readJSON, writeJSON } from "../utils/storage.js";
import { raiseWindow } from "./zorder.js";                                                  

const LAYOUT_KEY = "plugins.widgetlayout";
const WIDGET_MIN_W = 160;
const WIDGET_MIN_H = 120;
const WIDGET_MAX_W = 1400;
const WIDGET_MAX_H = 1000;
const DOCK_MIN_H = 100;
const DOCK_MAX_H = 700;
const LEFT_MIN_W = 140;
const LEFT_MAX_W = 600;

const UNDOCK_THRESHOLD = 14;
const ZONE_BAND = 56;
const SAVE_DELAY_MS = 150;

const widgets = new Set();
const pending = [];
let host = null;
let layoutCache = null;
let saveTimer = 0;

let focused = null;
let globalListeners = false;
let zoneEls = null;

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

export function normalizeDockState(v, dockable = true) {
  if (!dockable) return "Float";
  const s = typeof v === "string" ? v : "";
  if (s === "Left" || s === "Right" || s === "Bottom") return s;
  return "Float";
}

export function parseWidgetInfo(raw) {
  const o = raw && typeof raw === "object" ? raw : {};
  const minRaw = o.MinSize && typeof o.MinSize === "object" ? o.MinSize : {};
  const maxRaw = o.MaxSize && typeof o.MaxSize === "object" ? o.MaxSize : {};
  const flRaw = o.FloatingSize && typeof o.FloatingSize === "object" ? o.FloatingSize : {};
  const minW = clamp(Math.round(num(minRaw.x, WIDGET_MIN_W)), WIDGET_MIN_W, WIDGET_MAX_W);
  const minH = clamp(Math.round(num(minRaw.y, WIDGET_MIN_H)), WIDGET_MIN_H, WIDGET_MAX_H);
  const maxW = clamp(Math.round(num(maxRaw.x, WIDGET_MAX_W)), minW, WIDGET_MAX_W);
  const maxH = clamp(Math.round(num(maxRaw.y, WIDGET_MAX_H)), minH, WIDGET_MAX_H);
  return {
    initialDockState: normalizeDockState(o.InitialDockState === "Top" ? "Float" : o.InitialDockState),
    initialEnabled: o.InitialEnabled === undefined ? true : !!o.InitialEnabled,
    overrideRestore: !!o.InitialEnabledShouldOverrideRestore,
    minW,
    minH,
    maxW,
    maxH,
    floatW: clamp(Math.round(num(flRaw.x, 320)), minW, maxW),
    floatH: clamp(Math.round(num(flRaw.y, 260)), minH, maxH),
  };
}

export function sanitizeSavedState(raw, parsed) {
  if (!raw || typeof raw !== "object") return null;
  const out = {};
  if (raw.dock === "Left" || raw.dock === "Right" || raw.dock === "Bottom" || raw.dock === "Float") {
    out.dock = raw.dock;
  }
  if (typeof raw.enabled === "boolean") out.enabled = raw.enabled;
  if (Number.isFinite(Number(raw.x))) out.x = Math.round(Number(raw.x));
  if (Number.isFinite(Number(raw.y))) out.y = Math.round(Number(raw.y));
  if (Number.isFinite(Number(raw.w))) out.w = clamp(Math.round(Number(raw.w)), parsed.minW, parsed.maxW);
  if (Number.isFinite(Number(raw.h))) out.h = clamp(Math.round(Number(raw.h)), parsed.minH, parsed.maxH);
  if (Number.isFinite(Number(raw.dockH))) {
    out.dockH = clamp(Math.round(Number(raw.dockH)), DOCK_MIN_H, DOCK_MAX_H);
  }
  return Object.keys(out).length ? out : null;
}

export function resolveInitialState(parsed, saved) {
  const s = saved || {};
  const enabled = parsed.overrideRestore
    ? parsed.initialEnabled
    : typeof s.enabled === "boolean"
      ? s.enabled
      : parsed.initialEnabled;
  return {
    dock: s.dock || parsed.initialDockState,
    enabled,
    x: Number.isFinite(s.x) ? s.x : 120,
    y: Number.isFinite(s.y) ? s.y : 120,
    w: Number.isFinite(s.w) ? s.w : parsed.floatW,
    h: Number.isFinite(s.h) ? s.h : parsed.floatH,
    dockH: Number.isFinite(s.dockH) ? s.dockH : 220,
  };
}

export function zoneFromPoint(x, y, rects) {
  const hit = (r) => !!r && x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h;
  if (hit(rects && rects.bottom)) return "Bottom";
  if (hit(rects && rects.left)) return "Left";
  if (hit(rects && rects.right)) return "Right";
  return null;
}

function layoutStore() {
  if (!layoutCache) {
    const raw = readJSON(LAYOUT_KEY);
    layoutCache = raw && typeof raw === "object" && !Array.isArray(raw) ? raw : {};
    if (!layoutCache.plugins || typeof layoutCache.plugins !== "object" || Array.isArray(layoutCache.plugins)) {
      layoutCache.plugins = {};
    }
  }
  return layoutCache;
}

function scheduleSave() {
  if (saveTimer) return;
  saveTimer = setTimeout(() => {
    saveTimer = 0;
    writeJSON(LAYOUT_KEY, layoutStore());
  }, SAVE_DELAY_MS);
}

function savedFor(pluginId, widgetId) {
  const p = layoutStore().plugins[pluginId];
  return p && typeof p === "object" ? p[widgetId] : null;
}

function persistWidget(w) {
  const st = layoutStore();
  if (!st.plugins[w.pluginId]) st.plugins[w.pluginId] = {};
  st.plugins[w.pluginId][w.widgetId] = {
    dock: w.state.dock,
    enabled: w.state.enabled,
    x: w.state.x,
    y: w.state.y,
    w: w.state.w,
    h: w.state.h,
    dockH: w.state.dockH,
  };
  scheduleSave();
}

export function clearPluginWidgetLayout(pluginId) {
  const st = layoutStore();
  if (st.plugins[pluginId]) {
    delete st.plugins[pluginId];
    scheduleSave();
  }
}

export function countDockWidgets() {
  return widgets.size;
}

function safe(fn) {
  if (typeof fn !== "function") return;
  try {
    fn();
  } catch (_) {

  }
}

export function initDockWidgetHost(refs) {
  if (host || !refs || !refs.main || !refs.ws || typeof document === "undefined") return;
  const leftPanel = document.createElement("div");
  leftPanel.className = "rsw-leftpanel";
  leftPanel.style.display = "none";
  const leftSplitter = document.createElement("div");
  leftSplitter.className = "rsw-dsplit rsw-dsplit--col";
  leftSplitter.style.display = "none";
  refs.main.insertBefore(leftPanel, refs.main.firstChild);
  refs.main.insertBefore(leftSplitter, leftPanel.nextSibling);
  host = {
    ws: refs.ws,
    main: refs.main,
    rightPanel: refs.rightPanel,
    leftPanel,
    leftSplitter,
  };
  attachLeftSplitter(leftSplitter);
  ensureGlobalListeners();
  for (const w of pending.splice(0)) mountWidget(w);
}

function ensureGlobalListeners() {
  if (globalListeners || typeof document === "undefined") return;
  globalListeners = true;
  document.addEventListener(
    "pointerdown",
    (e) => {
      if (focused && (!focused.root || !focused.root.contains(e.target))) blurFocused();
    },
    true,
  );
  window.addEventListener("resize", () => {
    for (const w of widgets) {
      if (!w.destroyed && w.state.dock === "Float") applyFloatFrame(w);
    }
  });
}

function blurFocused() {
  const prev = focused;
  if (!prev) return;
  focused = null;
  if (!prev.destroyed && prev.root) prev.root.classList.remove("is-focused");
  if (!prev.destroyed) safe(prev.onLostFocus);
}

function focusWidget(w) {
  if (focused === w || w.destroyed) return;
  blurFocused();
  focused = w;
  w.root.classList.add("is-focused");
  if (w.state.dock === "Float") bringToFront(w);
  safe(w.onFocus);
}


function bringToFront(w) {
  raiseWindow(w.root);
}

function applyFloatFrame(w) {
  const vw = window.innerWidth || 1280;
  const vh = window.innerHeight || 720;
  w.state.w = clamp(w.state.w, w.parsed.minW, Math.min(w.parsed.maxW, vw));
  w.state.h = clamp(w.state.h, w.parsed.minH, Math.min(w.parsed.maxH, vh));
  w.state.x = clamp(w.state.x, 8 - w.state.w + 60, vw - 60);
  w.state.y = clamp(w.state.y, 0, vh - 40);
  w.root.style.left = w.state.x + "px";
  w.root.style.top = w.state.y + "px";
  w.root.style.width = w.state.w + "px";
  w.root.style.height = w.state.h + "px";
}

function applyLeftPanel() {
  if (!host) return;
  const any = [...widgets].some((w) => !w.destroyed && w.state.dock === "Left" && w.state.enabled);
  host.leftPanel.style.display = any ? "flex" : "none";
  host.leftSplitter.style.display = any ? "" : "none";
  const width = clamp(num(layoutStore().leftWidth, 240), LEFT_MIN_W, LEFT_MAX_W);
  host.leftPanel.style.flex = `0 0 ${width}px`;
}

function detachFromDom(w) {
  if (w.splitter && w.splitter.parentNode) w.splitter.parentNode.removeChild(w.splitter);
  w.splitter = null;
  if (w.root.parentNode) w.root.parentNode.removeChild(w.root);
}

function makeRowSplitter(w) {
  const sp = document.createElement("div");
  sp.className = "rsw-dsplit rsw-dsplit--row";
  sp.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || w.destroyed) return;
    e.preventDefault();
    const startY = e.clientY;
    const startH = w.state.dockH;
    let raf = 0;
    let lastY = startY;
    const move = (ev) => {
      lastY = ev.clientY;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        w.state.dockH = clamp(startH + (startY - lastY), DOCK_MIN_H, DOCK_MAX_H);
        w.root.style.flex = `0 0 ${w.state.dockH}px`;
      });
    };
    const up = () => {
      sp.removeEventListener("pointermove", move);
      sp.removeEventListener("pointerup", up);
      sp.removeEventListener("pointercancel", up);
      if (raf) cancelAnimationFrame(raf);
      persistWidget(w);
    };
    try {
      sp.setPointerCapture(e.pointerId);
    } catch (_) {

    }
    sp.addEventListener("pointermove", move);
    sp.addEventListener("pointerup", up, { once: true });
    sp.addEventListener("pointercancel", up, { once: true });
  });
  return sp;
}

function attachLeftSplitter(sp) {
  sp.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || !host) return;
    e.preventDefault();
    const startX = e.clientX;
    const startW = clamp(num(layoutStore().leftWidth, 240), LEFT_MIN_W, LEFT_MAX_W);
    let raf = 0;
    let lastX = startX;
    const move = (ev) => {
      lastX = ev.clientX;
      if (raf) return;
      raf = requestAnimationFrame(() => {
        raf = 0;
        layoutStore().leftWidth = clamp(startW + (lastX - startX), LEFT_MIN_W, LEFT_MAX_W);
        applyLeftPanel();
      });
    };
    const up = () => {
      sp.removeEventListener("pointermove", move);
      sp.removeEventListener("pointerup", up);
      sp.removeEventListener("pointercancel", up);
      if (raf) cancelAnimationFrame(raf);
      scheduleSave();
    };
    try {
      sp.setPointerCapture(e.pointerId);
    } catch (_) {

    }
    sp.addEventListener("pointermove", move);
    sp.addEventListener("pointerup", up, { once: true });
    sp.addEventListener("pointercancel", up, { once: true });
  });
}

function computeZoneRects() {
  const m = host.main.getBoundingClientRect();
  const wsr = host.ws.getBoundingClientRect();
  return {
    left: { x: m.left, y: m.top, w: ZONE_BAND, h: m.height },
    right: { x: m.right - ZONE_BAND, y: m.top, w: ZONE_BAND, h: m.height },
    bottom: { x: wsr.left, y: wsr.bottom - ZONE_BAND, w: wsr.width, h: ZONE_BAND },
  };
}

function showZones(rects) {
  if (!rects) {
    if (zoneEls) {
      for (const elz of Object.values(zoneEls)) {
        if (elz.parentNode) elz.parentNode.removeChild(elz);
      }
      zoneEls = null;
    }
    return;
  }
  if (!zoneEls) {
    zoneEls = {};
    for (const key of ["left", "right", "bottom"]) {
      const z = document.createElement("div");
      z.className = "rsw-dockzone";
      zoneEls[key] = z;
    }
  }
  for (const key of ["left", "right", "bottom"]) {
    const z = zoneEls[key];
    const r = rects[key];
    z.style.left = r.x + "px";
    z.style.top = r.y + "px";
    z.style.width = r.w + "px";
    z.style.height = r.h + "px";
    if (!z.parentNode) document.body.appendChild(z);
  }
}

function highlightZone(zone) {
  if (!zoneEls) return;
  zoneEls.left.classList.toggle("is-active", zone === "Left");
  zoneEls.right.classList.toggle("is-active", zone === "Right");
  zoneEls.bottom.classList.toggle("is-active", zone === "Bottom");
}

function applyVisibility(w) {
  const show = w.state.enabled && !w.destroyed;
  w.root.style.display = show ? "" : "none";
  if (w.splitter) w.splitter.style.display = show ? "" : "none";
  w.body.dataset.visible = show ? "true" : "false";
  if (w.state.dock === "Left") applyLeftPanel();
}

function mountWidget(w) {
  if (w.destroyed) return;
  if (!host) {
    if (!pending.includes(w)) pending.push(w);
    return;
  }
  detachFromDom(w);
  w.root.classList.remove("rsw-dwidget--float", "rsw-dwidget--dock");
  w.root.style.left = "";
  w.root.style.top = "";
  w.root.style.width = "";
  w.root.style.height = "";
  w.root.style.flex = "";
  w.root.style.zIndex = "";
  if (w.state.dock === "Float") {
    w.root.classList.add("rsw-dwidget--float");
    document.body.appendChild(w.root);
    applyFloatFrame(w);
    bringToFront(w);
  } else if (w.state.dock === "Left") {
    w.root.classList.add("rsw-dwidget--dock");
    host.leftPanel.appendChild(w.root);
    w.root.style.flex = "1 1 0";
  } else if (w.state.dock === "Right") {
    w.root.classList.add("rsw-dwidget--dock");
    w.splitter = makeRowSplitter(w);
    host.rightPanel.appendChild(w.splitter);
    host.rightPanel.appendChild(w.root);
    w.root.style.flex = `0 0 ${w.state.dockH}px`;
  } else {
    w.root.classList.add("rsw-dwidget--dock");
    w.splitter = makeRowSplitter(w);
    host.ws.insertBefore(w.splitter, host.main.nextSibling);
    host.ws.insertBefore(w.root, w.splitter.nextSibling);
    w.root.style.flex = `0 0 ${w.state.dockH}px`;
  }
  applyVisibility(w);
  applyLeftPanel();
}

function startHeaderDrag(w, e) {
  if (w.destroyed || e.button !== 0) return;
  e.preventDefault();
  focusWidget(w);
  const startX = e.clientX;
  const startY = e.clientY;
  let dragging = w.state.dock === "Float";
  let offX = 0;
  let offY = 0;
  if (dragging) {
    const r = w.root.getBoundingClientRect();
    offX = startX - r.left;
    offY = startY - r.top;
  }
  let started = false;
  let rects = null;
  let zone = null;
  let raf = 0;
  let lastX = startX;
  let lastY = startY;
  const move = (ev) => {
    lastX = ev.clientX;
    lastY = ev.clientY;
    if (!dragging) {
      if (Math.abs(lastX - startX) + Math.abs(lastY - startY) < UNDOCK_THRESHOLD) return;
      dragging = true;
      w.state.dock = "Float";
      offX = clamp(Math.round(w.state.w / 2), 24, w.state.w - 24);
      offY = 14;


      w.state.x = Math.round(lastX - offX);
      w.state.y = Math.round(lastY - offY);
      mountWidget(w);
      try {
        w.header.setPointerCapture(ev.pointerId);
      } catch (_) {

      }
    }
    if (!started) {
      started = true;
      document.body.classList.add("rsw-dwidget-dragging");
      if (w.dockable && host) {
        rects = computeZoneRects();
        showZones(rects);
      }
    }
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      w.state.x = Math.round(lastX - offX);
      w.state.y = Math.round(lastY - offY);
      applyFloatFrame(w);
      if (rects) {
        const z = zoneFromPoint(lastX, lastY, rects);
        if (z !== zone) {
          zone = z;
          highlightZone(z);
        }
      }
    });
  };
  const up = () => {
    w.header.removeEventListener("pointermove", move);
    w.header.removeEventListener("pointerup", up);
    w.header.removeEventListener("pointercancel", up);
    if (raf) cancelAnimationFrame(raf);
    document.body.classList.remove("rsw-dwidget-dragging");
    showZones(null);
    if (dragging && zone && w.dockable) {
      w.state.dock = zone;
      mountWidget(w);
    }
    persistWidget(w);
  };
  try {
    w.header.setPointerCapture(e.pointerId);
  } catch (_) {

  }
  w.header.addEventListener("pointermove", move);
  w.header.addEventListener("pointerup", up, { once: true });
  w.header.addEventListener("pointercancel", up, { once: true });
}

function startResize(w, e) {
  if (w.destroyed || w.state.dock !== "Float" || e.button !== 0) return;
  e.preventDefault();
  e.stopPropagation();
  const startX = e.clientX;
  const startY = e.clientY;
  const startW = w.state.w;
  const startH = w.state.h;
  let raf = 0;
  let lastX = startX;
  let lastY = startY;
  const move = (ev) => {
    lastX = ev.clientX;
    lastY = ev.clientY;
    if (raf) return;
    raf = requestAnimationFrame(() => {
      raf = 0;
      w.state.w = clamp(startW + (lastX - startX), w.parsed.minW, w.parsed.maxW);
      w.state.h = clamp(startH + (lastY - startY), w.parsed.minH, w.parsed.maxH);
      applyFloatFrame(w);
    });
  };
  const up = () => {
    w.grip.removeEventListener("pointermove", move);
    w.grip.removeEventListener("pointerup", up);
    w.grip.removeEventListener("pointercancel", up);
    if (raf) cancelAnimationFrame(raf);
    persistWidget(w);
  };
  try {
    w.grip.setPointerCapture(e.pointerId);
  } catch (_) {

  }
  w.grip.addEventListener("pointermove", move);
  w.grip.addEventListener("pointerup", up, { once: true });
  w.grip.addEventListener("pointercancel", up, { once: true });
}

function userClose(w) {
  if (w.destroyed) return;
  w.state.enabled = false;
  applyVisibility(w);
  persistWidget(w);
  if (focused === w) blurFocused();
  safe(w.onClose);
}

function destroyWidget(w) {
  if (w.destroyed) return;
  w.destroyed = true;
  if (focused === w) focused = null;
  detachFromDom(w);
  widgets.delete(w);
  const i = pending.indexOf(w);
  if (i >= 0) pending.splice(i, 1);
  if (host) applyLeftPanel();
  safe(w.onClose);
  safe(w.onDestroy);
}

function buildDom(w) {
  const root = document.createElement("div");
  root.className = "rsw-dwidget";
  root.dataset.plugin = w.pluginId;
  root.dataset.widget = w.widgetId;
  const header = document.createElement("div");
  header.className = "rsw-dwidget__bar";
  const titleEl = document.createElement("span");
  titleEl.className = "rsw-dwidget__title";
  titleEl.textContent = w.title;
  const plug = document.createElement("span");
  plug.className = "rsw-dwidget__plug";
  plug.textContent = w.pluginName;
  const closeBtn = document.createElement("button");
  closeBtn.type = "button";
  closeBtn.className = "rsw-dwidget__btn";
  closeBtn.title = "Fechar";
  closeBtn.setAttribute("aria-label", "Fechar widget");
  closeBtn.textContent = "\u00d7";
  closeBtn.addEventListener("pointerdown", (e) => e.stopPropagation());
  closeBtn.addEventListener("click", () => userClose(w));
  header.append(titleEl, plug, closeBtn);
  const body = document.createElement("div");
  body.className = "rsw-dwidget__body";
  const grip = document.createElement("div");
  grip.className = "rsw-dwidget__resize";
  root.append(header, body, grip);
  header.addEventListener("pointerdown", (e) => {
    if (e.target === closeBtn) return;
    startHeaderDrag(w, e);
  });
  root.addEventListener("pointerdown", () => focusWidget(w));
  grip.addEventListener("pointerdown", (e) => startResize(w, e));
  w.root = root;
  w.header = header;
  w.titleEl = titleEl;
  w.body = body;
  w.grip = grip;
}

function makeHandle(w) {
  const handle = {
    body: w.body,
    getTitle: () => w.title,
    setTitle: (t) => {
      w.title = String(t || "").slice(0, 64);
      w.titleEl.textContent = w.title;
    },
    isEnabled: () => w.state.enabled && !w.destroyed,
    setEnabled: (v) => {
      const on = !!v;
      if (w.destroyed || w.state.enabled === on) return;
      w.state.enabled = on;
      applyVisibility(w);
      persistWidget(w);
      if (!on && focused === w) blurFocused();
      if (on && w.state.dock === "Float") bringToFront(w);
    },
    getSize: () => {
      if (w.state.dock === "Float") return { width: w.state.w, height: w.state.h };
      const r = w.root.getBoundingClientRect();
      return { width: Math.round(r.width), height: Math.round(r.height) };
    },
    setSize: (width, height) => {
      if (w.destroyed) return;
      if (w.state.dock === "Float") {
        w.state.w = clamp(Math.round(num(width, w.state.w)), w.parsed.minW, w.parsed.maxW);
        w.state.h = clamp(Math.round(num(height, w.state.h)), w.parsed.minH, w.parsed.maxH);
        applyFloatFrame(w);
      } else if (w.state.dock !== "Left") {
        w.state.dockH = clamp(Math.round(num(height, w.state.dockH)), DOCK_MIN_H, DOCK_MAX_H);
        w.root.style.flex = `0 0 ${w.state.dockH}px`;
      }
      persistWidget(w);
    },
    getPosition: () => {
      if (w.state.dock === "Float") return { x: w.state.x, y: w.state.y };
      const r = w.root.getBoundingClientRect();
      return { x: Math.round(r.left), y: Math.round(r.top) };
    },
    setPosition: (x, y) => {
      if (w.destroyed || w.state.dock !== "Float") return;
      w.state.x = Math.round(num(x, w.state.x));
      w.state.y = Math.round(num(y, w.state.y));
      applyFloatFrame(w);
      persistWidget(w);
    },
    getDockState: () => w.state.dock,
    setDockState: (v) => {
      if (w.destroyed || !w.dockable) return;
      const d = normalizeDockState(v, w.dockable);
      if (d === w.state.dock) return;
      w.state.dock = d;
      mountWidget(w);
      persistWidget(w);
    },
    getZIndexBehavior: () => w.zBehavior,
    setZIndexBehavior: (v) => {
      if (v === "Sibling" || v === "Global") w.zBehavior = v;
    },
    bringToFront: () => {
      if (!w.destroyed && w.state.dock === "Float") bringToFront(w);
    },
    destroy: () => destroyWidget(w),
    close: () => destroyWidget(w),
    isDestroyed: () => w.destroyed,
  };
  return handle;
}

export function createDockWidget(spec) {
  if (!spec || typeof document === "undefined") return null;
  const parsed = parseWidgetInfo(spec.info);
  const saved = sanitizeSavedState(savedFor(spec.pluginId, spec.widgetId), parsed);
  const state = resolveInitialState(parsed, saved);
  const dockable = spec.dockable !== false;
  if (!dockable) state.dock = "Float";
  const w = {
    pluginId: String(spec.pluginId || ""),
    pluginName: String(spec.pluginName || ""),
    widgetId: String(spec.widgetId || ""),
    title: String(spec.title || spec.widgetId || "").slice(0, 64),
    dockable,
    parsed,
    state,
    zBehavior: "Sibling",
    onClose: spec.onClose,
    onFocus: spec.onFocus,
    onLostFocus: spec.onLostFocus,
    onDestroy: spec.onDestroy,
    destroyed: false,
    root: null,
    header: null,
    titleEl: null,
    body: null,
    grip: null,
    splitter: null,
  };
  buildDom(w);
  widgets.add(w);
  ensureGlobalListeners();
  mountWidget(w);
  persistWidget(w);
  return makeHandle(w);
}
