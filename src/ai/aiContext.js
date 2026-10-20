import { store } from "../core/state.js";
import { selection } from "../core/selection.js";
import { logger } from "../core/logger.js";
import { engine } from "../runtime/engine.js";
import { debuggerController } from "../debugger/controller.js";
import { getApiKey } from "./aiConfig.js";
import { redactCredentials } from "./secretRedactor.js";
import { getActiveScriptInfo } from "./editorBridge.js";

const MAX_SCRIPT_LINES = 120;
const MAX_SECTION_CHARS = 6000;


export function sanitizeContextText(text) {
  return redactCredentials(text, [getApiKey()]);
}

function live(inst) {
  return !!(inst && inst.__isInstance === true && typeof inst.isDestroyed === "function" && !inst.isDestroyed());
}

function childrenOf(inst) {
  try {
    if (inst && typeof inst.getChildren === "function") return inst.getChildren() || [];
  } catch (_) {}
  return [];
}

function fullNameOf(inst) {
  try {
    if (inst && typeof inst.getFullName === "function") {
      const full = inst.getFullName();
      if (full) return String(full);
    }
  } catch (_) {}


  try {
    let dm = null;
    try {
      dm = store.getDataModel();
    } catch (_) {
      dm = null;
    }
    const parts = [];
    let node = inst;
    let guard = 0;
    while (node && node !== dm && String(node.className || "") !== "DataModel" && guard < 64) {
      parts.unshift(node.name ? String(node.name) : "?");
      node = typeof node.getParent === "function" ? node.getParent() : null;
      guard += 1;
    }
    if (parts.length) return parts.join(".");
  } catch (_) {}
  return inst && inst.name ? String(inst.name) : "?";
}

function capText(text, max) {
  const s = String(text || "");
  return s.length > max ? s.slice(0, max) + "\n[truncated]" : s;
}

function selectionSummary() {
  const items = (selection.get() || []).filter(live).slice(0, 5);
  if (!items.length) return "";
  return items
    .map((inst) => {
      const kids = childrenOf(inst).length;
      return "- " + inst.className + ' "' + inst.name + '" (path: ' + fullNameOf(inst) + ", children: " + kids + ")";
    })
    .join("\n");
}

function dataModelSummary() {
  let dm = null;
  try {
    dm = store.getDataModel();
  } catch (_) {
    dm = null;
  }
  if (!dm) return "";
  const services = childrenOf(dm).filter(live);
  const lines = services.map((svc) => {
    const kids = childrenOf(svc).filter(live);
    const names = kids.slice(0, 8).map((k) => k.className + ' "' + k.name + '"');
    const extra = kids.length > 8 ? ", +" + (kids.length - 8) + " more" : "";
    return "- " + svc.name + " (" + kids.length + " children)" + (names.length ? ": " + names.join(", ") + extra : "");
  });
  return capText(lines.join("\n"), MAX_SECTION_CHARS);
}

const MAX_ERROR_CHARS = 300;


export function formatRecentErrors(entries) {
  const errors = (Array.isArray(entries) ? entries : []).filter((e) => e && e.level === "error").slice(-10);
  if (!errors.length) return "";
  const lines = errors.map((e) => {
    const source = String((e && e.source) || "Output").slice(0, 40);
    let msg = String((e && e.message) || "").replace(/\s+/g, " ").trim();
    if (msg.length > MAX_ERROR_CHARS) msg = msg.slice(0, MAX_ERROR_CHARS) + "…";
    return "- [" + source + "] " + msg;
  });
  return capText(lines.join("\n"), MAX_SECTION_CHARS);
}

function recentErrorsSummary() {
  let entries = [];
  try {
    entries = logger.getEntries() || [];
  } catch (_) {
    entries = [];
  }
  return formatRecentErrors(entries);
}

function playtestSummary() {
  let state = "Edit";
  try {
    state = engine.getPlaytestState();
  } catch (_) {}
  let paused = false;
  try {
    paused = typeof debuggerController.isPaused === "function" ? debuggerController.isPaused() === true : false;
  } catch (_) {}
  return "Playtest state: " + state + (paused ? "\nDebugger: paused at a breakpoint" : "");
}

function scriptSummary(info) {
  const source = String(info.source || "");
  const lines = source.split("\n");
  const cursorLine = Math.max(1, Math.min(lines.length, Number(info.cursorLine) || 1));
  const half = Math.floor(MAX_SCRIPT_LINES / 2);


  const start = Math.max(0, Math.min(cursorLine - 1 - half, lines.length - MAX_SCRIPT_LINES));
  const end = Math.min(lines.length, start + MAX_SCRIPT_LINES);
  const slice = lines.slice(start, end).join("\n");
  const head = [
    "Script: " + (info.name || "?") + " (" + (info.className || "Script") + ")",
    "Path: " + (info.path || "?"),
    "Cursor at line " + cursorLine,
    start > 0 || end < lines.length ? "Excerpt (lines " + (start + 1) + "-" + end + " of " + lines.length + "):" : "Full source:",
  ].join("\n");
  return head + "\n```luau\n" + capText(slice, MAX_SECTION_CHARS) + "\n```";
}

export function buildContext(opts = {}) {
  const sections = [];
  if (opts.includeSelection !== false) {
    const sel = selectionSummary();
    if (sel) sections.push({ id: "selection", title: "Current selection", text: sel });
  }
  if (opts.includeScript !== false) {
    const info = getActiveScriptInfo();
    if (info && info.source) sections.push({ id: "script", title: "Current script", text: scriptSummary(info) });
  }
  const dm = dataModelSummary();
  if (dm) sections.push({ id: "datamodel", title: "DataModel overview", text: dm });
  if (opts.includeErrors !== false) {
    const errs = recentErrorsSummary();
    if (errs) sections.push({ id: "errors", title: "Recent output errors", text: errs });
  }
  sections.push({ id: "playtest", title: "Session state", text: playtestSummary() });
  return sections;
}

export function contextToText(sections) {
  if (!Array.isArray(sections) || !sections.length) return "";
  const body = sections.map((s) => "## " + s.title + "\n" + s.text).join("\n\n");
  return sanitizeContextText("Project context (read only, provided by Roblox Studio Web):\n\n" + body);
}
