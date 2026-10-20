import { commands } from "../core/commands.js";
import { store } from "../core/state.js";
import { selection } from "../core/selection.js";
import { logger } from "../core/logger.js";
import { createInstance, getService, isClass, isServiceClass } from "../datamodel/index.js";

const FENCE_RE = /```([^\n`]*)\n([\s\S]*?)```/g;
const ACTION_TYPES = new Set(["createInstance", "setProperty", "insertScript", "deleteInstance"]);
const SCRIPT_TYPES = new Set(["Script", "LocalScript", "ModuleScript"]);
const MAX_SOURCE_CHARS = 20000;
const MAX_PROPERTIES = 24;

export function parseAssistantMessage(text) {
  const src = String(text || "");
  const segments = [];
  let last = 0;
  let match;
  FENCE_RE.lastIndex = 0;
  while ((match = FENCE_RE.exec(src)) !== null) {
    const before = src.slice(last, match.index);
    if (before.trim()) segments.push({ type: "text", text: before });
    const lang = String(match[1] || "").trim().toLowerCase().split(/\s+/)[0] || "";
    const body = match[2] || "";
    if (lang === "action") {
      let action = null;
      try {
        action = JSON.parse(body);
      } catch (_) {
        action = null;
      }


      const actionList = Array.isArray(action)
        ? action.filter((a) => a && typeof a === "object" && !Array.isArray(a))
        : action && typeof action === "object" ? [action] : [];
      if (actionList.length) {
        for (const item of actionList) segments.push({ type: "action", action: item, raw: body });
      } else {
        segments.push({ type: "code", lang: "json", code: body });
      }
    } else {
      segments.push({ type: "code", lang: lang || "luau", code: body });
    }
    last = match.index + match[0].length;
  }
  const tail = src.slice(last);
  if (tail.trim()) segments.push({ type: "text", text: tail });
  return segments;
}

function live(inst) {
  return !!(inst && inst.__isInstance === true && typeof inst.isDestroyed === "function" && !inst.isDestroyed());
}

function dataModel() {
  try {
    return store.getDataModel();
  } catch (_) {
    return null;
  }
}

function resolvePath(path) {
  const tokens = String(path || "").split(".").map((t) => t.trim()).filter(Boolean);

  if (tokens.length > 1 && tokens[0].toLowerCase() === "game") tokens.shift();
  if (!tokens.length) return null;
  const dm = dataModel();
  if (!dm) return null;
  let current = null;
  try {
    current = getService(dm, tokens[0]);
  } catch (_) {
    current = null;
  }
  if (!live(current) && typeof dm.findFirstChild === "function") {
    try {
      current = dm.findFirstChild(tokens[0]);
    } catch (_) {
      current = null;
    }
  }
  if (!live(current)) return null;
  for (let i = 1; i < tokens.length; i++) {
    if (typeof current.findFirstChild !== "function") return null;
    let next = null;
    try {
      next = current.findFirstChild(tokens[i]);
    } catch (_) {
      next = null;
    }
    if (!live(next)) return null;
    current = next;
  }
  return current;
}

function saneName(value, fallback) {
  const s = String(value || "").trim().slice(0, 100);
  return s || fallback;
}


function effectiveName(action, fallback) {
  const explicit = saneName(action && action.name, "");
  if (explicit) return explicit;
  const props = action && action.properties;
  const fromProps = props && typeof props === "object" && !Array.isArray(props) ? saneName(props.Name, "") : "";
  return fromProps || fallback;
}


function looseEquals(a, b) {
  if (a === b) return true;
  if (typeof a === "number" && typeof b === "number") {
    return Number.isFinite(a) && Number.isFinite(b) && Math.abs(a - b) < 1e-9;
  }
  if (!a || !b || typeof a !== "object" || typeof b !== "object") return false;
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!looseEquals(a[k], b[k])) return false;
  }
  return true;
}


function normalizePathKey(path) {
  const tokens = String(path || "").split(".").map((t) => t.trim()).filter(Boolean);
  if (tokens.length > 1 && tokens[0].toLowerCase() === "game") tokens.shift();
  return tokens.join(".");
}

function hasDeletedPrefix(key, deleted) {
  for (const d of deleted) {
    if (key === d || key.startsWith(d + ".")) return true;
  }
  return false;
}


function pathOkInBatch(path, ctx) {
  const key = normalizePathKey(path);
  if (!key) return false;
  if (ctx && ctx.deleted && ctx.deleted.size && hasDeletedPrefix(key, ctx.deleted)) return false;
  if (resolvePath(path)) return true;
  return !!(ctx && ctx.virtual && ctx.virtual.has(key));
}


function trackBatchEffects(action, ctx) {
  if (!ctx) return;
  const type = String(action.type || "");
  if (type === "createInstance" || type === "insertScript") {
    const parentKey = normalizePathKey(action.parentPath);
    if (!parentKey) return;
    const fallback = type === "insertScript" ? String(action.scriptType || "Script") : String(action.className || "Instance");
    const name = effectiveName(action, fallback);




    if (name.includes(".")) return;
    const key = parentKey + "." + name;
    ctx.virtual.add(key);
    ctx.deleted.delete(key);
  } else if (type === "deleteInstance") {
    const key = normalizePathKey(action.targetPath);
    if (!key) return;
    ctx.deleted.add(key);
    ctx.virtual.delete(key);
    for (const v of Array.from(ctx.virtual)) {
      if (v.startsWith(key + ".")) ctx.virtual.delete(v);
    }
  }
}

export function validateAction(action, batchCtx = null) {
  if (!action || typeof action !== "object" || Array.isArray(action)) return { ok: false, error: "Invalid action payload." };
  const type = String(action.type || "");
  if (!ACTION_TYPES.has(type)) return { ok: false, error: 'Unknown action type "' + type + '".' };
  if (type === "createInstance") {
    if (!action.className || typeof action.className !== "string") return { ok: false, error: "Missing className." };
    if (!isClass(action.className)) return { ok: false, error: 'Unknown class "' + action.className + '".' };
    if (isServiceClass(action.className)) return { ok: false, error: 'Services like "' + action.className + '" cannot be created.' };
    if (!pathOkInBatch(action.parentPath, batchCtx)) return { ok: false, error: 'Parent path "' + String(action.parentPath || "") + '" not found.' };
    if (action.properties && (typeof action.properties !== "object" || Array.isArray(action.properties))) return { ok: false, error: "Invalid properties map." };
    if (action.properties && Object.keys(action.properties).length > MAX_PROPERTIES) return { ok: false, error: "Too many properties in one action." };
    return { ok: true };
  }
  if (type === "setProperty") {
    if (!action.property || typeof action.property !== "string") return { ok: false, error: "Missing property name." };


    if (!("value" in action)) return { ok: false, error: 'Missing "value" for property "' + action.property + '".' };
    if (!pathOkInBatch(action.targetPath, batchCtx)) return { ok: false, error: 'Target path "' + String(action.targetPath || "") + '" not found.' };
    return { ok: true };
  }
  if (type === "insertScript") {
    const scriptType = String(action.scriptType || "Script");
    if (!SCRIPT_TYPES.has(scriptType)) return { ok: false, error: 'Invalid script type "' + scriptType + '".' };
    if (typeof action.source !== "string") return { ok: false, error: "Missing script source." };
    if (action.source.length > MAX_SOURCE_CHARS) return { ok: false, error: "Script source too large." };
    if (!pathOkInBatch(action.parentPath, batchCtx)) return { ok: false, error: 'Parent path "' + String(action.parentPath || "") + '" not found.' };


    if (action.properties && (typeof action.properties !== "object" || Array.isArray(action.properties))) return { ok: false, error: "Invalid properties map." };
    if (action.properties && Object.keys(action.properties).length > MAX_PROPERTIES) return { ok: false, error: "Too many properties in one action." };
    return { ok: true };
  }
  if (type === "deleteInstance") {
    if (!pathOkInBatch(action.targetPath, batchCtx)) return { ok: false, error: 'Target path "' + String(action.targetPath || "") + '" not found.' };


    const target = resolvePath(action.targetPath);
    if (target && isServiceClass(String(target.className || ""))) {
      return { ok: false, error: 'Services like "' + String(target.className) + '" cannot be deleted.' };
    }
    return { ok: true };
  }
  return { ok: false, error: "Unsupported action." };
}


export function validateActions(actions) {
  const list = Array.isArray(actions) ? actions : [actions];
  if (!list.length) return { ok: false, error: "No actions to validate.", index: -1 };
  const ctx = { virtual: new Set(), deleted: new Set() };
  for (let i = 0; i < list.length; i++) {
    const check = validateAction(list[i], ctx);
    if (!check.ok) {

      const prefix = list.length > 1 ? "Action " + (i + 1) + " of " + list.length + ": " : "";
      return { ok: false, error: prefix + check.error, index: i };
    }
    trackBatchEffects(list[i], ctx);
  }
  return { ok: true, error: null, index: -1 };
}

export function describeAction(action) {
  if (!action || typeof action !== "object") return "Invalid action";
  if (typeof action.description === "string" && action.description.trim()) return action.description.trim().slice(0, 160);
  const type = String(action.type || "");
  if (type === "createInstance") return "Create " + String(action.className || "?") + " in " + String(action.parentPath || "?");
  if (type === "setProperty") return "Set " + String(action.property || "?") + " on " + String(action.targetPath || "?");
  if (type === "insertScript") return "Insert " + String(action.scriptType || "Script") + " in " + String(action.parentPath || "?");
  if (type === "deleteInstance") return "Delete " + String(action.targetPath || "?");
  return "Action: " + type;
}


function jsonPreview(value) {
  const s = JSON.stringify(value === undefined ? null : value);
  return typeof s === "string" ? s : "null";
}

export function previewAction(action) {
  if (!action || typeof action !== "object") return "";
  const type = String(action.type || "");
  if (type === "createInstance") {


    const props = action.properties && typeof action.properties === "object" && !Array.isArray(action.properties) ? Object.entries(action.properties).filter(([k]) => k !== "Parent" && k !== "Name").map(([k, v]) => "  " + k + " = " + jsonPreview(v)).join("\n") : "";
    return [String(action.className || "?") + ' "' + effectiveName(action, String(action.className || "Instance")) + '"', "Parent: " + String(action.parentPath || "?"), props ? "Properties:\n" + props : ""].filter(Boolean).join("\n");
  }
  if (type === "setProperty") {
    return String(action.targetPath || "?") + "." + String(action.property || "?") + " = " + jsonPreview(action.value);
  }
  if (type === "insertScript") {
    const lines = String(action.source || "").split("\n");
    const excerpt = lines.slice(0, 8).join("\n") + (lines.length > 8 ? "\n..." : "");
    return [String(action.scriptType || "Script") + ' "' + effectiveName(action, String(action.scriptType || "Script")) + '"', "Parent: " + String(action.parentPath || "?"), "Source (" + lines.length + " lines):", excerpt].join("\n");
  }
  if (type === "deleteInstance") {
    return "Delete instance at " + String(action.targetPath || "?");
  }
  return JSON.stringify(action, null, 2);
}

export function isUnsafeAction(action) {
  if (!action || typeof action !== "object") return true;
  const type = String(action.type || "");
  if (type === "deleteInstance") return true;
  if (type === "setProperty" && String(action.property || "") === "Source") return true;
  return false;
}


function buildOp(action) {
  const type = String(action.type || "");
  if (type === "createInstance" || type === "insertScript") {
    const className = type === "insertScript" ? String(action.scriptType || "Script") : String(action.className || "");
    const op = {
      created: null,
      do() {
        const parent = resolvePath(action.parentPath);
        if (!live(parent)) return false;




        if (op.created && op.created.isDestroyed()) op.created = null;
        if (!op.created) {
          const inst = createInstance(className, {});
          if (!inst) return false;
          try {
            inst.setProperty("Name", effectiveName(action, className));
          } catch (_) {}
          if (type === "insertScript") {
            try {
              inst.setProperty("Source", String(action.source || ""));
            } catch (_) {}
          }
          if (action.properties && typeof action.properties === "object" && !Array.isArray(action.properties)) {
            for (const [prop, value] of Object.entries(action.properties)) {


              if (prop === "Parent") {
                logger.warn('AI action: ignoring "Parent" in properties (parenting comes from parentPath).', { source: "Assistant" });
                continue;
              }


              if (prop === "Name") continue;
              try {
                inst.setProperty(prop, value);
              } catch (e) {
                logger.warn('AI action: could not set property "' + prop + '": ' + (e && e.message), { source: "Assistant" });
              }
            }
          }
          if (SCRIPT_TYPES.has(className) && typeof inst.setAttribute === "function") {
            try {
              inst.setAttribute("GeneratedByAI", "boolean", true);
            } catch (_) {}
          }
          op.created = inst;
        }
        if (op.created.isDestroyed()) return false;
        return op.created.setParent(parent) !== false;
      },
      undo() {
        if (op.created && !op.created.isDestroyed()) op.created.setParent(null);
      },
      dispose() {




        try {
          const inst = op.created;
          const parented = inst && typeof inst.getParent === "function" ? inst.getParent() : null;
          if (inst && !inst.isDestroyed() && !parented && typeof inst.destroy === "function") {
            inst.destroy();
            op.created = null;
          }
        } catch (_) {}
      },
    };
    return op;
  }
  if (type === "setProperty") {
    const prop = String(action.property || "");
    const op = {
      created: null,
      target: null,
      captured: false,
      prev: undefined,
      do() {
        const target = resolvePath(action.targetPath);
        if (!live(target)) return false;
        if (!op.captured) {
          try {
            op.prev = target.getProperty(prop);
          } catch (_) {
            op.prev = undefined;
          }
          op.captured = true;
        }
        op.target = target;
        try {


          if (target.setProperty(prop, action.value) === true) return true;
          if (typeof target.hasProperty === "function" && !target.hasProperty(prop)) {
            logger.warn('AI action: property "' + prop + '" does not exist on ' + String(action.targetPath || "?") + ".", { source: "Assistant" });
            return false;
          }
          if (looseEquals(target.getProperty(prop), action.value)) return true;
          logger.warn('AI action: value for "' + prop + '" was rejected (read-only or invalid).', { source: "Assistant" });
          return false;
        } catch (e) {
          logger.warn('AI action: could not set "' + prop + '": ' + (e && e.message), { source: "Assistant" });
          return false;
        }
      },
      undo() {
        if (!live(op.target)) return;


        if (op.prev === undefined) return;
        try {
          op.target.setProperty(prop, op.prev);
        } catch (_) {}
      },
      dispose() {},
    };
    return op;
  }
  if (type === "deleteInstance") {
    const op = {
      created: null,
      target: null,
      prevParent: null,
      do() {
        const target = resolvePath(action.targetPath);
        if (!live(target)) return false;


        if (isServiceClass(String(target.className || ""))) return false;
        op.target = target;
        try {
          op.prevParent = typeof target.getParent === "function" ? target.getParent() : target.parent || null;
        } catch (_) {
          op.prevParent = null;
        }
        return target.setParent(null) !== false;
      },
      undo() {
        if (op.target && !op.target.isDestroyed() && live(op.prevParent)) op.target.setParent(op.prevParent);
      },
      dispose() {},
    };
    return op;
  }
  return null;
}

export function applyActions(actions, label) {
  const list = Array.isArray(actions) ? actions : [actions];


  const batch = validateActions(list);
  if (!batch.ok) return { ok: false, applied: 0, failed: list.length, error: batch.error };
  const ops = [];
  for (const action of list) {
    const op = buildOp(action);
    if (!op) return { ok: false, applied: 0, failed: list.length, error: "Could not prepare action: " + describeAction(action) };
    ops.push(op);
  }
  if (!ops.length) return { ok: false, applied: 0, failed: list.length, error: "No actions to apply." };
  const prevSel = selection.get();
  let applied = 0;
  let appliedOps = [];
  const ok = commands.execute({
    name: label || ("AI: " + (ops.length === 1 ? describeAction(list[0]) : ops.length + " actions")),
    do() {
      applied = 0;
      appliedOps = [];
      for (const op of ops) {
        let success = false;
        try {
          success = op.do() === true;
        } catch (e) {
          logger.warn("AI action failed: " + (e && e.message), { source: "Assistant" });
        }
        if (success) {
          applied++;
          appliedOps.push(op);
        }
      }


      for (const op of ops) {
        if (appliedOps.indexOf(op) === -1) {
          try {
            op.dispose();
          } catch (_) {}
        }
      }
      if (!applied) return false;
      const created = appliedOps.map((op) => op.created).filter(live);
      if (created.length) selection.set(created);
      return true;
    },
    undo() {


      for (let i = appliedOps.length - 1; i >= 0; i--) {
        try {
          appliedOps[i].undo();
        } catch (_) {}
      }
      selection.set((prevSel || []).filter(live));
    },
  });
  if (!ok) {
    for (const op of ops) {
      try {
        op.dispose();
      } catch (_) {}
    }
    return { ok: false, applied: 0, failed: list.length, error: "Actions could not be applied." };
  }


  const failed = list.length - applied;
  if (failed > 0) logger.warn("Assistant: " + failed + " of " + list.length + " action(s) did not apply (target changed after validation).", { source: "Assistant" });
  logger.info("Assistant applied " + applied + " action(s).", { source: "Assistant" });
  return { ok: true, applied, failed, error: null };
}
