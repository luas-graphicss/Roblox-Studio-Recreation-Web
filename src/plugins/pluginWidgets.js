import { raiseWindow } from "./zorder.js";                                
const MIN_W = 160;
const MIN_H = 120;
const MAX_W = 1400;
const MAX_H = 1000;
const TITLE_MAX = 64;

let cascade = 0;
const openWindows = new Set();


let resizeWired = false;
function wireResizeReclamp() {
  if (resizeWired || typeof window === "undefined") return;
  resizeWired = true;
  window.addEventListener("resize", () => {
    for (const h of openWindows) {
      const p = h.getPosition();
      h.setPosition(p.x, p.y);                                           
    }
  });
}

function el(tag, cls) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}

function num(v, d) {
  return typeof v === "number" && Number.isFinite(v) ? v : d;
}

function clamp(v, lo, hi) {
  return Math.min(hi, Math.max(lo, v));
}

export function createWidgetWindow(opts = {}) {
  const o = opts && typeof opts === "object" ? opts : {};
  let title = String(o.title || "Plugin Widget").slice(0, TITLE_MAX);
  const pluginName = String(o.pluginName || "").slice(0, TITLE_MAX);
  let w = clamp(num(o.width, 260), MIN_W, MAX_W);
  let h = clamp(num(o.height, 220), MIN_H, MAX_H);
  cascade = (cascade + 1) % 8;
  let x = clamp(num(o.x, 120 + cascade * 28), 0, Math.max(0, window.innerWidth - 80));
  let y = clamp(num(o.y, 110 + cascade * 24), 40, Math.max(40, window.innerHeight - 60));

  const root = el("div", "rsw-pwidget");
  root.setAttribute("role", "dialog");
  root.setAttribute("aria-label", title);
  root.style.width = w + "px";
  root.style.height = h + "px";
  root.style.left = x + "px";
  root.style.top = y + "px";

  const barEl = el("div", "rsw-pwidget__bar");
  const titleEl = el("div", "rsw-pwidget__title");
  titleEl.textContent = title;              
  const subEl = el("span", "rsw-pwidget__plug");
  if (pluginName && pluginName !== title) subEl.textContent = pluginName;
  const minBtn = el("button", "rsw-pwidget__btn");
  minBtn.type = "button";
  minBtn.textContent = "\u2013";
  minBtn.setAttribute("aria-label", "Minimizar widget");
  const closeBtn = el("button", "rsw-pwidget__btn");
  closeBtn.type = "button";
  closeBtn.textContent = "\u2715";
  closeBtn.setAttribute("aria-label", "Fechar widget");
  barEl.append(titleEl, subEl, minBtn, closeBtn);

  const body = el("div", "rsw-pwidget__body");
  const grip = el("div", "rsw-pwidget__resize");
  grip.setAttribute("aria-hidden", "true");
  root.append(barEl, body, grip);

  let closed = false;
  let minimized = false;
  let visible = true;
  const handle = { root, body };


  function bringToFront() { raiseWindow(root); }
  root.addEventListener("pointerdown", bringToFront, true);


  let drag = null;
  barEl.addEventListener("pointerdown", (e) => {
    if (e.target === minBtn || e.target === closeBtn) return;
    drag = { px: e.clientX, py: e.clientY, ox: x, oy: y };
    try {
      barEl.setPointerCapture(e.pointerId);
    } catch (_) {

    }
    e.preventDefault();
  });
  barEl.addEventListener("pointermove", (e) => {
    if (!drag) return;
    x = clamp(drag.ox + (e.clientX - drag.px), -w + 60, Math.max(0, window.innerWidth - 60));
    y = clamp(drag.oy + (e.clientY - drag.py), 40, Math.max(40, window.innerHeight - 28));
    root.style.left = x + "px";
    root.style.top = y + "px";
  });
  const endDrag = () => {
    drag = null;
  };
  barEl.addEventListener("pointerup", endDrag);
  barEl.addEventListener("pointercancel", endDrag);


  let rs = null;
  grip.addEventListener("pointerdown", (e) => {
    rs = { px: e.clientX, py: e.clientY, ow: w, oh: h };
    try {
      grip.setPointerCapture(e.pointerId);
    } catch (_) {

    }
    e.preventDefault();
  });
  grip.addEventListener("pointermove", (e) => {
    if (!rs) return;
    w = clamp(rs.ow + (e.clientX - rs.px), MIN_W, MAX_W);
    h = clamp(rs.oh + (e.clientY - rs.py), MIN_H, MAX_H);
    root.style.width = w + "px";
    root.style.height = h + "px";
  });
  const endResize = () => {
    rs = null;
  };
  grip.addEventListener("pointerup", endResize);
  grip.addEventListener("pointercancel", endResize);

  function setMinimized(v) {
    minimized = !!v;
    root.classList.toggle("rsw-pwidget--min", minimized);
    minBtn.textContent = minimized ? "\u25a1" : "\u2013";
    minBtn.setAttribute("aria-label", minimized ? "Restaurar widget" : "Minimizar widget");
  }
  function setVisible(v) {
    visible = !!v;
    root.style.display = visible ? "" : "none";
  }
  function setTitle(t) {
    const next = String(t == null ? "" : t).slice(0, TITLE_MAX);
    if (!next) return;
    title = next;
    titleEl.textContent = title;
    root.setAttribute("aria-label", title);
  }
  function setSize(nw, nh) {
    w = clamp(num(nw, w), MIN_W, MAX_W);
    h = clamp(num(nh, h), MIN_H, MAX_H);
    root.style.width = w + "px";
    root.style.height = h + "px";
  }
  function setPosition(nx, ny) {
    x = clamp(num(nx, x), 0, Math.max(0, window.innerWidth - 60));
    y = clamp(num(ny, y), 40, Math.max(40, window.innerHeight - 28));
    root.style.left = x + "px";
    root.style.top = y + "px";
  }
  function close(reason) {
    if (closed) return;
    closed = true;
    openWindows.delete(handle);
    root.remove();                                         
    if (typeof o.onClose === "function") {
      try {
        o.onClose(reason || "close");
      } catch (_) {

      }
    }
  }

  minBtn.addEventListener("click", () => setMinimized(!minimized));
  closeBtn.addEventListener("click", () => close("user"));

  Object.assign(handle, {
    setTitle,
    getTitle: () => title,
    setVisible,
    isVisible: () => visible,
    setMinimized,
    setSize,
    getSize: () => ({ width: w, height: h }),
    setPosition,
    getPosition: () => ({ x, y }),
    bringToFront,
    close,
    isClosed: () => closed,
  });

  wireResizeReclamp();
  openWindows.add(handle);
  document.body.appendChild(root);
  bringToFront();
  return handle;
}

export function countOpenWidgets() {
  return openWindows.size;
}
