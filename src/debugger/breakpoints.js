import { bus } from "../core/eventBus.js";
import { logger } from "../core/logger.js";
import { readJSON, writeJSON } from "../utils/storage.js";
import { parse } from "../runtime/lua/parser.js";

const STORAGE_KEY = "breakpoints";
export const MAX_PER_SCRIPT = 100;
export const MAX_TOTAL = 1000;
const MAX_CONDITION_LEN = 300;
const MAX_LOG_LEN = 300;

let nextBpId = 1;


const byPath = new Map();

const idCache = new Map();

function sanitizeExpr(text, max) {
  if (typeof text !== "string") return "";


  return text.replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").slice(0, max);
}

function scriptName(path) {
  const i = path.lastIndexOf(".");
  return i >= 0 ? path.slice(i + 1) : path;
}


export function instancePath(inst) {
  const parts = [];
  let cur = inst;
  let guard = 0;
  while (cur && guard++ < 64) {
    if (cur.className === "DataModel") break;
    parts.unshift(cur.name || cur.className || "?");
    cur = typeof cur.getParent === "function" ? cur.getParent() : null;
  }
  return parts.join(".");
}

function totalCount() {
  let n = 0;
  for (const rec of byPath.values()) n += rec.lines.size;
  return n;
}

function persist() {
  const out = {};
  for (const rec of byPath.values()) {
    if (!rec.lines.size) continue;
    out[rec.path] = [...rec.lines.values()].map((bp) => ({
      line: bp.line,
      enabled: !!bp.enabled,
      condition: bp.condition || "",
      logMessage: bp.logMessage || "",
    }));
  }
  writeJSON(STORAGE_KEY, out);
}

function changed() {
  idCache.clear();
  persist();
  bus.emit("debugger:breakpointsChanged", {});
}

function loadPersisted() {
  const data = readJSON(STORAGE_KEY, null);
  if (!data || typeof data !== "object") return;
  let total = 0;
  for (const path of Object.keys(data)) {
    const arr = data[path];
    if (!Array.isArray(arr) || typeof path !== "string" || !path) continue;
    const rec = { path, name: scriptName(path), lines: new Map() };
    for (const raw of arr) {


      if (!raw || typeof raw.line !== "number" || !Number.isFinite(raw.line)) continue;
      const line = Math.max(1, Math.floor(raw.line));
      if (rec.lines.has(line)) continue;
      if (rec.lines.size >= MAX_PER_SCRIPT || total >= MAX_TOTAL) break;
      rec.lines.set(line, {
        id: nextBpId++,
        path,
        line,
        enabled: raw.enabled !== false,
        condition: sanitizeExpr(raw.condition, MAX_CONDITION_LEN),
        logMessage: sanitizeExpr(raw.logMessage, MAX_LOG_LEN),
        valid: true,
        _condWarned: false,
      });
      total++;
    }
    if (rec.lines.size) byPath.set(path, rec);
  }
}
loadPersisted();

function recordFor(path, create) {
  let rec = byPath.get(path);
  if (!rec && create) {
    rec = { path, name: scriptName(path), lines: new Map() };
    byPath.set(path, rec);
  }
  return rec || null;
}


function collectLines(body, set) {
  if (!Array.isArray(body)) return;
  for (const st of body) {
    if (!st || typeof st !== "object") continue;
    if (typeof st.line === "number" && st.line > 0) set.add(st.line);
    switch (st.type) {
      case "If":
        for (const cl of st.clauses || []) {


          collectFnBodies([cl.cond], set);
          collectLines(cl.body, set);
        }
        collectLines(st.elseBody, set);
        break;
      case "While":
      case "Repeat":
        collectFnBodies([st.cond], set);
        collectLines(st.body, set);
        break;
      case "NumericFor":
        collectFnBodies([st.start, st.limit, st.step], set);
        collectLines(st.body, set);
        break;
      case "GenericFor":
        collectFnBodies(st.exprs, set);
        collectLines(st.body, set);
        break;
      case "Do":
        collectLines(st.body, set);
        break;
      case "LocalFunction":
        if (st.fn) collectLines(st.fn.body, set);
        break;
      case "Local":
        collectFnBodies(st.inits, set);
        break;
      case "Assign":
        collectFnBodies(st.values, set);


        collectFnBodies(st.targets, set);
        break;
      case "CompoundAssign":
        collectFnBodies([st.value, st.target], set);
        break;
      case "ExprStatement":
        collectFnBodies([st.expr], set);
        break;
      case "Return":
        collectFnBodies(st.args, set);
        break;
      default:
        break;
    }
  }
}

function collectFnBodies(exprs, set) {
  if (!Array.isArray(exprs)) return;
  for (const e of exprs) collectExprFns(e, set, 0);
}

function collectExprFns(node, set, depth) {
  if (!node || typeof node !== "object" || depth > 40) return;
  if (node.type === "Function") {
    collectLines(node.body, set);
    return;
  }
  for (const key of ["expr", "left", "right", "obj", "key", "func"]) {
    if (node[key]) collectExprFns(node[key], set, depth + 1);
  }
  if (Array.isArray(node.args)) for (const a of node.args) collectExprFns(a, set, depth + 1);
  if (Array.isArray(node.fields)) {
    for (const f of node.fields) {
      if (f && f.value) collectExprFns(f.value, set, depth + 1);
      if (f && f.key) collectExprFns(f.key, set, depth + 1);
    }
  }
}


export function computeExecutableLines(source) {
  try {
    const ast = parse(String(source != null ? source : ""));
    const set = new Set();
    collectLines(ast.body, set);
    return set;
  } catch (e) {
    return null;                                             
  }
}


export function snapLine(source, line) {
  const lines = computeExecutableLines(source);
  if (!lines) return { line, valid: true };                               
  if (lines.has(line)) return { line, valid: true };
  let best = Infinity;
  for (const l of lines) {
    if (l >= line && l < best) best = l;
  }
  if (best !== Infinity) return { line: best, valid: true };
  return { line, valid: false };
}


export function revalidate(path, source) {
  const rec = byPath.get(path);
  if (!rec || !rec.lines.size) return;
  const lines = computeExecutableLines(source);
  let dirty = false;
  for (const bp of rec.lines.values()) {
    const valid = lines ? lines.has(bp.line) : true;
    if (bp.valid !== valid) {
      bp.valid = valid;
      dirty = true;
    }
  }
  if (dirty) changed();
}




export function getBreakpoint(path, line) {
  const rec = byPath.get(path);
  return rec ? rec.lines.get(line) || null : null;
}

export function listForPath(path) {
  const rec = byPath.get(path);
  return rec ? [...rec.lines.values()].sort((a, b) => a.line - b.line) : [];
}

export function listAll() {
  const out = [];
  for (const rec of byPath.values()) {
    for (const bp of rec.lines.values()) out.push(bp);
  }
  out.sort((a, b) => (a.path === b.path ? a.line - b.line : a.path < b.path ? -1 : 1));
  return out;
}

export function addBreakpoint(path, line, props) {


  if (!path || typeof line !== "number" || !Number.isFinite(line)) return null;
  line = Math.floor(line);
  if (line < 1) return null;
  const rec = recordFor(path, true);
  if (rec.lines.has(line)) return rec.lines.get(line);
  if (rec.lines.size >= MAX_PER_SCRIPT) {
    logger.warn(`Limite de ${MAX_PER_SCRIPT} breakpoints por script atingido (${rec.name}).`, { source: "Debugger" });
    return null;
  }
  if (totalCount() >= MAX_TOTAL) {
    logger.warn(`Limite total de ${MAX_TOTAL} breakpoints atingido.`, { source: "Debugger" });


    if (!rec.lines.size) byPath.delete(path);
    return null;
  }
  const bp = {
    id: nextBpId++,
    path,
    line,
    enabled: true,
    condition: "",
    logMessage: "",
    valid: true,
    _condWarned: false,
  };
  if (props && typeof props === "object") {
    if (props.condition != null) bp.condition = sanitizeExpr(props.condition, MAX_CONDITION_LEN);
    if (props.logMessage != null) bp.logMessage = sanitizeExpr(props.logMessage, MAX_LOG_LEN);
    if (props.enabled === false) bp.enabled = false;
    if (props.valid === false) bp.valid = false;
  }
  rec.lines.set(line, bp);
  changed();
  return bp;
}

export function removeBreakpoint(path, line) {
  const rec = byPath.get(path);
  if (!rec || !rec.lines.has(line)) return false;
  rec.lines.delete(line);
  if (!rec.lines.size) byPath.delete(path);
  changed();
  return true;
}

export function updateBreakpoint(path, line, props) {
  const bp = getBreakpoint(path, line);
  if (!bp || !props) return null;
  if (props.enabled != null) bp.enabled = !!props.enabled;
  if (props.condition !== undefined) {
    bp.condition = sanitizeExpr(props.condition, MAX_CONDITION_LEN);
    bp._condWarned = false;
  }
  if (props.logMessage !== undefined) bp.logMessage = sanitizeExpr(props.logMessage, MAX_LOG_LEN);
  if (props.valid != null) bp.valid = !!props.valid;
  changed();
  return bp;
}


export function moveBreakpoint(path, fromLine, toLine) {
  const rec = byPath.get(path);
  if (!rec) return false;


  if (!Number.isFinite(toLine)) return false;
  toLine = Math.floor(toLine);
  if (toLine < 1) return false;
  const bp = rec.lines.get(fromLine);
  if (!bp || fromLine === toLine) return false;
  rec.lines.delete(fromLine);
  if (rec.lines.has(toLine)) {

    changed();
    return true;
  }
  bp.line = toLine;
  rec.lines.set(toLine, bp);
  changed();
  return true;
}






export function moveBreakpoints(path, moves) {
  const rec = byPath.get(path);
  if (!rec || !Array.isArray(moves) || !moves.length) return false;
  const moving = [];
  for (const m of moves) {
    if (!m || typeof m.from !== "number" || typeof m.to !== "number") continue;
    const to = Math.floor(m.to);


    if (!Number.isFinite(to) || m.from === to || to < 1) continue;
    const bp = rec.lines.get(m.from);
    if (!bp) continue;
    rec.lines.delete(m.from);
    moving.push({ bp, to });
  }
  if (!moving.length) return false;
  for (const mv of moving) {
    if (rec.lines.has(mv.to)) continue;                                     
    mv.bp.line = mv.to;
    rec.lines.set(mv.to, mv.bp);
  }
  if (!rec.lines.size) byPath.delete(path);
  changed();
  return true;
}

export function removeAllForPath(path) {
  if (!byPath.has(path)) return;
  byPath.delete(path);
  changed();
}

export function removeAll() {
  if (!byPath.size) return;
  byPath.clear();
  changed();
}

export function setAllEnabled(enabled) {
  let dirty = false;
  for (const rec of byPath.values()) {
    for (const bp of rec.lines.values()) {
      if (bp.enabled !== enabled) {
        bp.enabled = enabled;
        dirty = true;
      }
    }
  }
  if (dirty) changed();
}

export function hasEnabledBreakpoints() {
  for (const rec of byPath.values()) {
    for (const bp of rec.lines.values()) {
      if (bp.enabled && bp.valid !== false) return true;
    }
  }
  return false;
}


export function recordForInstance(inst) {
  if (!inst || inst.id == null) return null;
  if (idCache.has(inst.id)) return idCache.get(inst.id);
  const path = instancePath(inst);
  const rec = byPath.get(path) || null;
  idCache.set(inst.id, rec);
  return rec;
}


export function lookupRuntime(inst, line) {
  const rec = recordForInstance(inst);
  if (!rec) return null;
  const bp = rec.lines.get(line);
  return bp && bp.enabled && bp.valid !== false ? bp : null;
}


export function removeForDeletedInstance(inst) {
  if (!inst) return;
  const path = instancePath(inst);
  let dirty = false;
  if (path && byPath.has(path)) {
    byPath.delete(path);
    dirty = true;
  }

  if (path) {
    const prefix = path + ".";
    for (const key of [...byPath.keys()]) {
      if (key.startsWith(prefix)) {
        byPath.delete(key);
        dirty = true;
      }
    }
  }
  if (dirty) changed();
}
