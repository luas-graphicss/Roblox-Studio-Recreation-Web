import { bus } from "./eventBus.js";

const areas = new Map();                                        
let focused = null;
let inited = false;

function isTypingTarget(node) {
  if (!node || node.nodeType !== 1) return false;
  const tag = (node.tagName || "").toLowerCase();
  if (tag === "input" || tag === "textarea" || tag === "select") return true;
  if (node.isContentEditable === true) return true;
  if (typeof node.closest === "function" && node.closest(".monaco-editor")) return true;
  return false;
}

export function registerFocusArea(name, el, opts) {
  if (typeof name !== "string" || !name || !el || areas.has(name)) return () => {};
  const o = opts || {};
  if (!el.hasAttribute("tabindex")) el.setAttribute("tabindex", "-1");
  if (o.label && !el.hasAttribute("aria-label")) el.setAttribute("aria-label", o.label);
  el.classList.add("rsw-area");
  const onDown = () => setFocusedArea(name, { silent: true });
  el.addEventListener("mousedown", onDown, true);
  areas.set(name, {
    el,
    label: o.label || name,
    order: typeof o.order === "number" ? o.order : 100,
    onDown,
  });
  return () => {
    el.removeEventListener("mousedown", onDown, true);
    el.classList.remove("rsw-area", "rsw-area--focused");
    areas.delete(name);
    if (focused === name) focused = null;
  };
}

export function setFocusedArea(name, opts) {
  const area = areas.get(name);
  if (!area) return false;
  if (focused && focused !== name) {
    const prev = areas.get(focused);
    if (prev) prev.el.classList.remove("rsw-area--focused");
  }
  const changed = focused !== name;
  focused = name;
  area.el.classList.add("rsw-area--focused");
  if (!opts || opts.silent !== true) {
    try { area.el.focus({ preventScroll: true }); } catch (_e) {            }
  }
  if (changed) bus.emit("focus:areaChanged", { area: name });
  return true;
}

export function getFocusedArea() {
  return focused;
}

function visibleAreas() {
  return [...areas.entries()]
    .filter(([, a]) => a.el.isConnected && a.el.offsetParent !== null)
    .sort((x, y) => x[1].order - y[1].order);
}

export function initFocusManager() {
  if (inited || typeof document === "undefined") return;
  inited = true;

  document.addEventListener(
    "keydown",
    (e) => {
      const key = typeof e.key === "string" ? e.key : "";
      if (key === "Tab" || key.startsWith("Arrow")) {
        document.body.classList.add("rsw-kbd-nav");
      }
      if (key !== "Tab") return;
      if (document.body.classList.contains("rsw-mode-start")) return;
      if (isTypingTarget(e.target)) return;
      const active = document.activeElement;
      const isAreaRoot = !!(active && active.classList && active.classList.contains("rsw-area"));

      if (active && active !== document.body && !isAreaRoot) return;
      const vis = visibleAreas();
      if (!vis.length) return;
      e.preventDefault();
      let idx = vis.findIndex(([n]) => n === focused);
      if (idx < 0) idx = e.shiftKey ? 0 : -1;
      const next = e.shiftKey ? (idx - 1 + vis.length) % vis.length : (idx + 1) % vis.length;
      setFocusedArea(vis[next][0]);
    },
    true,
  );

  document.addEventListener(
    "mousedown",
    () => {
      document.body.classList.remove("rsw-kbd-nav");
    },
    true,
  );
}
