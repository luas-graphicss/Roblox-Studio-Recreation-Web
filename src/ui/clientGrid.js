import { bus } from "../core/eventBus.js";
import { logger } from "../core/logger.js";
import { multiClient } from "../runtime/multiClient.js";
import { emulation } from "../runtime/emulation.js";
import { getNetworkSettings } from "../runtime/network.js";
import { engine } from "../runtime/engine.js";

const STATUS_LABEL = { connected: "Connected", loading: "Loading", disconnected: "Disconnected" };
const FORWARDED = ["mousedown", "mouseup", "mousemove", "wheel", "contextmenu", "dblclick"];

let host = null;
let grid = null;
let srcCanvas = null;
const tiles = new Map();

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function mainCanvas() {
  if (!srcCanvas || !srcCanvas.isConnected) {
    srcCanvas = document.querySelector(".rsw-viewport__canvas");
  }
  return srcCanvas;
}

function layoutCount(n) {
  if (n <= 1) return 1;
  if (n === 2) return 2;
  if (n <= 4) return 4;
  return 8;
}

function latencyLabel() {
  const s = getNetworkSettings();
  return s.latencyMs > 0 ? s.latencyMs + "ms" : "0ms";
}

function emulatedPoint(e, stage) {
  const rect = stage.getBoundingClientRect();
  const res = emulation.getResolution();
  const x = Math.round(((e.clientX - rect.left) / Math.max(1, rect.width)) * res.w);
  const y = Math.round(((e.clientY - rect.top) / Math.max(1, rect.height)) * res.h);
  return { x: Math.max(0, Math.min(res.w, x)), y: Math.max(0, Math.min(res.h, y)) };
}


function forwardMouse(e, tileCanvas) {
  const src = mainCanvas();
  if (!src) return;
  try {
    const sr = src.getBoundingClientRect();
    const tr = tileCanvas && tileCanvas.getBoundingClientRect ? tileCanvas.getBoundingClientRect() : null;
    const nx = tr && tr.width > 0 ? Math.max(0, Math.min(1, (e.clientX - tr.left) / tr.width)) : 0.5;
    const ny = tr && tr.height > 0 ? Math.max(0, Math.min(1, (e.clientY - tr.top) / tr.height)) : 0.5;
    const init = {
      bubbles: true,
      cancelable: true,
      view: e.view || window,
      detail: e.detail,
      screenX: e.screenX,
      screenY: e.screenY,
      clientX: sr.left + nx * sr.width,
      clientY: sr.top + ny * sr.height,
      button: e.button,
      buttons: e.buttons,
      ctrlKey: e.ctrlKey,
      shiftKey: e.shiftKey,
      altKey: e.altKey,
      metaKey: e.metaKey,
    };
    let ev;
    if (e.type === "wheel") {
      init.deltaX = e.deltaX;
      init.deltaY = e.deltaY;
      init.deltaZ = e.deltaZ;
      init.deltaMode = e.deltaMode;
      ev = new WheelEvent(e.type, init);
    } else {
      ev = new MouseEvent(e.type, init);
    }
    src.dispatchEvent(ev);
  } catch (_) {            }
}

function buildTile(session) {
  const root = el("div", "rsw-client");
  root.dataset.clientId = String(session.id);

  const header = el("div", "rsw-client__header");
  const title = el("span", "rsw-client__title", session.name);
  const status = el("span", "rsw-client__status");
  const dot = el("span", "rsw-client__dot");
  const statusText = el("span", null, STATUS_LABEL[session.status] || session.status);
  status.append(dot, statusText);
  const lat = el("span", "rsw-client__latency", latencyLabel());
  lat.title = "Latencia simulada ativa";
  const spacer = el("span", "rsw-client__spacer");
  const minBtn = el("button", "rsw-client__btn", session.minimized ? "\u25a1" : "\u2500");
  minBtn.type = "button";
  minBtn.title = session.minimized ? "Maximizar" : "Minimizar";
  const discBtn = el("button", "rsw-client__btn rsw-client__btn--disc", "\u2715");
  discBtn.type = "button";
  discBtn.title = "Disconnect";
  header.append(title, status, lat, spacer, minBtn, discBtn);

  const stage = el("div", "rsw-client__stage");
  const frame = el("div", "rsw-devframe rsw-devframe--" + emulation.getState().device);
  const res = emulation.getResolution();
  frame.style.aspectRatio = res.w + " / " + res.h;
  const canvas = el("canvas", "rsw-client__canvas");
  frame.appendChild(canvas);
  stage.appendChild(frame);

  if (session.status === "disconnected") {
    const over = el("div", "rsw-client__overlay");
    over.append(el("div", "rsw-client__overlaytitle", "Disconnected"), el("div", "rsw-client__overlaysub", "Este cliente foi desconectado do Server."));
    stage.appendChild(over);
    discBtn.disabled = true;
  }

  root.append(header, stage);
  root.classList.toggle("rsw-client--active", multiClient.getActiveId() === session.id && session.status !== "disconnected");
  root.classList.toggle("rsw-client--min", session.minimized === true);
  root.classList.toggle("rsw-client--disc", session.status === "disconnected");
  dot.dataset.status = session.status;

  root.addEventListener("mousedown", () => {
    if (session.status !== "disconnected") multiClient.setActive(session.id);
  });
  minBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    multiClient.setMinimized(session.id, !session.minimized);
  });
  discBtn.addEventListener("click", (e) => {
    e.stopPropagation();
    multiClient.disconnect(session.id);
  });

  stage.addEventListener("mousedown", (e) => {
    if (session.status === "disconnected") return;
    if (emulation.isTouchEnabled()) {
      e.preventDefault();
      const p = emulatedPoint(e, frame);
      bus.emit("emulation:touch", { type: "TouchStarted", x: p.x, y: p.y, clientId: session.id });
      logger.info("TouchStarted (" + p.x + ", " + p.y + ") \u2014 " + session.name, { source: "Emulation" });
    }
  });
  stage.addEventListener("mouseup", (e) => {
    if (session.status === "disconnected") return;
    if (emulation.isTouchEnabled()) {
      e.preventDefault();
      const p = emulatedPoint(e, frame);
      bus.emit("emulation:touch", { type: "TouchEnded", x: p.x, y: p.y, clientId: session.id });
      logger.info("TouchEnded (" + p.x + ", " + p.y + ") \u2014 " + session.name, { source: "Emulation" });
    }
  });
  for (const type of FORWARDED) {
    stage.addEventListener(type, (e) => {
      if (session.status === "disconnected") return;
      if (emulation.isTouchEnabled()) return;
      if (multiClient.getActiveId() !== session.id) return;
      forwardMouse(e, canvas);
    });
  }

  tiles.set(session.id, { session, root, canvas, ctx: canvas.getContext("2d"), stage, frame, lat, lastDraw: 0 });
  return root;
}

function rebuild() {
  if (!grid) return;
  tiles.clear();
  const sessions = multiClient.getSessions();
  const visible = sessions.length >= 2 || (sessions.length >= 1 && emulation.isFrameWanted());
  if (!visible) {
    grid.style.display = "none";
    grid.replaceChildren();
    return;
  }
  grid.style.display = "grid";
  grid.dataset.count = String(layoutCount(sessions.length));
  const frag = document.createDocumentFragment();
  for (const s of sessions) frag.appendChild(buildTile(s));
  grid.replaceChildren(frag);
}

function onFrame() {
  if (!grid || grid.style.display === "none") return;
  const src = mainCanvas();
  if (!src || !src.width) return;
  const now = performance.now();
  const activeId = multiClient.getActiveId();
  for (const t of tiles.values()) {
    if (t.session.status === "disconnected" || !t.ctx) continue;
    const interval = t.session.minimized ? 1000 : t.session.id === activeId ? 0 : 100;
    if (interval > 0 && now - t.lastDraw < interval) continue;
    const w = t.canvas.clientWidth | 0;
    const h = t.canvas.clientHeight | 0;
    if (!w || !h) continue;
    if (t.canvas.width !== w || t.canvas.height !== h) {
      t.canvas.width = w;
      t.canvas.height = h;
    }
    try {
      t.ctx.drawImage(src, 0, 0, w, h);
      t.lastDraw = now;
    } catch (_) {            }
  }
}

function refreshLatencyChips() {
  const label = latencyLabel();
  for (const t of tiles.values()) t.lat.textContent = label;
}

export function initClientGrid(opts) {
  host = opts && opts.host ? opts.host : null;
  if (!host || grid) return;
  if (typeof getComputedStyle === "function" && getComputedStyle(host).position === "static") {
    host.style.position = "relative";
  }
  grid = el("div", "rsw-clients");
  grid.style.display = "none";
  host.appendChild(grid);
  bus.on("multiclient:changed", rebuild);
  bus.on("emulation:changed", rebuild);
  bus.on("network:settingsChanged", refreshLatencyChips);
  bus.on("viewport:rendered", onFrame);
  rebuild();
}
