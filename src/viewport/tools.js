import { store } from "../core/state.js";

export const TOOLS = Object.freeze(["select", "move", "rotate", "scale", "transform"]);

export const TRANSFORM_TOOLS = Object.freeze(["move", "rotate", "scale", "transform"]);


export const KEY_TO_TOOL = Object.freeze({
  q: "select",
  w: "move",
  e: "rotate",
  r: "scale",
});

function isValid(tool) {
  return TOOLS.indexOf(tool) !== -1;
}

function isTyping(node) {
  if (!node) return false;
  const tag = (node.tagName || "").toLowerCase();
  return tag === "input" || tag === "textarea" || tag === "select" || node.isContentEditable === true;
}

export const tools = {
  get() {
    const t = store.get("activeTool");
    return isValid(t) ? t : "select";
  },
  set(tool) {
    if (!isValid(tool)) return false;
    store.set("activeTool", tool);
    return true;
  },
  isTransform(tool) {
    return TRANSFORM_TOOLS.indexOf(tool) !== -1;
  },
};


export function wireToolShortcuts(target) {
  const el = target || (typeof document !== "undefined" ? document : null);
  if (!el || typeof el.addEventListener !== "function") return () => {};
  const onKey = (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (isTyping(e.target)) return;
    const tool = KEY_TO_TOOL[(e.key || "").toLowerCase()];
    if (!tool) return;
    e.preventDefault();
    tools.set(tool);
  };
  el.addEventListener("keydown", onKey);
  return () => el.removeEventListener("keydown", onKey);
}
