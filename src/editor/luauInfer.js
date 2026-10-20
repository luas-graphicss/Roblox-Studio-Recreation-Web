import {
  ANY, NIL, BOOLEAN, NUMBER, STRING,
  classType, datatypeType, functionType, unionType, tableType,
  parseTypeAnnotation, formatType as formatInternalType,
  isAssignable, unify, typeFromApiTypeName, typeOfApiMember as apiMemberType,
  narrowTruthy, narrowByTypeof, narrowByIsA, stripNil, isNilable,
} from "./luauTypes.js";
import {
  resolveClassName, membersOf, getDatatype, getDatatypeStatic,
  getDatatypeMember, getLibrary, getLibraryMember, getGlobal, enumItems,
} from "./apiDocs.js";

export const TYPE_DIAGNOSTIC_CODES = Object.freeze([
  "LUA017", "LUA018", "LUA019", "LUA020", "LUA021",
  "LUA022", "LUA023", "LUA024", "LUA025",
]);

export const INFER_MODES = Object.freeze(["strict", "nonstrict", "nocheck"]);


const MAX_FUEL = 2000000;
const MAX_SCAN = 3000;
const MAX_FIELDS = 32;
const MAX_REFS = 4000;


const MAX_NILSAFE = 2000;
const MAX_COND = 200;                                                                           


export function parseModeDirective(source) {
  const text = String(source == null ? "" : source);
  const n = text.length;
  let i = 0;
  let guard = 0;
  while (i < n && guard++ < 256) {
    while (i < n && (text[i] === " " || text[i] === "\t" || text[i] === "\r" || text[i] === "\n")) i++;
    if (i >= n || text[i] !== "-" || text[i + 1] !== "-") break;
    i += 2;
    if (text[i] === "[") {
      let lvl = 0;
      let p = i + 1;
      while (text[p] === "=") { lvl++; p++; }
      if (text[p] === "[") {
        const closer = "]" + "=".repeat(lvl) + "]";
        const at = text.indexOf(closer, p + 1);
        if (at < 0) break;
        i = at + closer.length;
        continue;
      }
    }
    let end = text.indexOf("\n", i);
    if (end < 0) end = n;
    const line = text.slice(i, end).trim();
    if (line === "!strict") return "strict";
    if (line === "!nonstrict") return "nonstrict";
    if (line === "!nocheck") return "nocheck";
    i = end;
  }
  return null;
}


export function parseModeHeader(source) {
  return parseModeDirective(source) || "nonstrict";
}


const PRIM_KINDS = { any: 1, unknown: 1, never: 1, nil: 1, boolean: 1, number: 1, string: 1, thread: 1, buffer: 1 };
const MARKER_KINDS = { "enum-root": 1, "datatype-static": 1, lib: 1, datamodel: 1, "instance-ctor": 1, "enum-item": 1 };

export function toContractType(t) {
  if (!t || typeof t !== "object" || typeof t.kind !== "string") return null;
  const k = t.kind;
  if (PRIM_KINDS[k]) return { kind: "primitive", name: k };
  if (k === "primitive") return { kind: "primitive", name: t.name || "any" };
  if (k === "class") return { kind: "class", className: t.className || "Instance" };
  if (k === "datatype") return { kind: "datatype", name: t.name || "userdata" };
  if (k === "enum") return { kind: "enum", name: t.name || "" };
  if (k === "enumItem") return { kind: "enum-item", name: t.enumName || "" };
  if (k === "array") return { kind: "array", element: toContractType(t.element) || { kind: "primitive", name: "any" } };
  if (k === "table") {
    const src = t.fields || null;
    const keys = src ? Object.keys(src) : [];
    if (!keys.length) return { kind: "table", fields: null };
    const fields = {};
    for (const key of keys.slice(0, 64)) {
      fields[key] = toContractType(src[key]) || { kind: "primitive", name: "any" };
    }
    return { kind: "table", fields };
  }
  if (k === "function") {
    const params = Array.isArray(t.params)
      ? t.params.map(function (p) {
          return { name: p && p.name != null ? p.name : null, type: toContractType(p && p.type) || { kind: "primitive", name: "any" }, optional: !!(p && p.optional) };
        })
      : [];
    let ret = null;
    if (Array.isArray(t.returns)) ret = t.returns.length ? toContractType(t.returns[0]) : null;
    else if (t.returns) ret = toContractType(t.returns);
    return { kind: "function", params, returns: ret, variadic: !!(t.varargs || t.variadic) };
  }
  if (k === "union") {
    const opts = (Array.isArray(t.options) ? t.options : []).map(toContractType).filter(Boolean);
    if (!opts.length) return { kind: "primitive", name: "any" };
    if (opts.length === 1) return opts[0];
    return { kind: "union", options: opts };
  }
  return t;
}


function isNilOpt(o) {
  return !!o && (o.kind === "nil" || (o.kind === "primitive" && o.name === "nil"));
}

export function formatType(t) {
  if (!t || typeof t !== "object") return "any";
  switch (t.kind) {
    case "primitive": return t.name || "any";
    case "class": return t.className || "Instance";
    case "datatype": return t.name || "userdata";
    case "array": return "{" + formatType(t.element) + "}";
    case "table": {
      const flds = t.fields;
      const ns = flds ? Object.keys(flds) : [];
      if (!ns.length) return "table";
      if (ns.length > 4) return "table";
      return "{" + ns.map(function (kk) { return kk + ": " + formatType(flds[kk]); }).join(", ") + "}";
    }
    case "function": {
      const ps = Array.isArray(t.params)
        ? t.params.map(function (p) { return formatType(p && p.type) + (p && p.optional ? "?" : ""); }).join(", ")
        : "";
      let r = "()";
      if (Array.isArray(t.returns)) r = t.returns.length ? formatType(t.returns[0]) : "()";
      else if (t.returns) r = formatType(t.returns);
      const va = (t.variadic || t.varargs) ? (ps ? ", ..." : "...") : "";
      return "(" + ps + va + ") -> " + r;
    }
    case "union": {
      const opts = Array.isArray(t.options) ? t.options : [];
      const nonNil = opts.filter(function (o) { return !isNilOpt(o); });
      if (nonNil.length === opts.length) return opts.map(formatType).join(" | ") || "any";
      if (nonNil.length === 1) return formatType(nonNil[0]) + "?";
      if (!nonNil.length) return "nil";
      return nonNil.map(formatType).join(" | ") + "?";
    }
    case "enum": return "Enum." + (t.name || "?");
    case "enumItem": case "enum-item": return (t.enumName || t.name) ? "Enum." + (t.enumName || t.name) : "EnumItem";
    case "enum-root": return "Enums";
    case "datatype-static": return t.name || "userdata";
    case "lib": return t.name || "table";
    case "datamodel": return "DataModel";
    case "instance-ctor": return "Instance";
    default: return formatInternalType(t);
  }
}


export function neutralTypeInfo(mode) {
  const m = INFER_MODES.indexOf(mode) >= 0 ? mode : "nonstrict";
  return {
    mode: m,
    issues: [],
    locals: [],
    aliases: {},
    moduleReturnType: null,
    nilSafeRefs: [],
    budgetExhausted: false,
    typeOfChain: function () { return null; },
    typeAtPosition: function () { return null; },
    formatType,
  };
}


export function typeOfApiMember(className, memberName) {
  try {
    const hit = apiMemberType(className, memberName);
    return hit ? toContractType(hit.type) : null;
  } catch (e) {
    return null;
  }
}


function severityFor(code, mode) {
  if (mode === "nocheck") return null;
  if (code === "LUA023") return "error";
  if (code === "LUA024") return mode === "strict" ? "warning" : null;
  return mode === "strict" ? "error" : "warning";
}

function widen(t) {
  if (!t || typeof t !== "object") return ANY;
  if (t.kind === "literal" || (t.kind === "string" && t.literal !== undefined)) return STRING;
  if (t.kind === "number" && t.literal !== undefined) return NUMBER;
  if (t.kind === "boolean" && t.literal !== undefined) return BOOLEAN;
  if (t.kind === "union" && Array.isArray(t.options)) {
    try { return unionType(t.options.map(widen)); } catch (e) { return ANY; }
  }
  return t;
}

function isMarker(t) { return !!t && MARKER_KINDS[t.kind] === 1; }
function isUnknown(t) { return !t || t.kind === "any" || t.kind === "unknown"; }

function litFromStringToken(tok) {
  if (!tok || tok.type !== "string") return null;
  const v = tok.value || "";
  if (v.length >= 2 && (v[0] === '"' || v[0] === "'") && v[v.length - 1] === v[0]) return v.slice(1, -1);
  return null;
}

function litFromArgsText(args) {
  if (typeof args !== "string") return null;
  const s = args.trim();
  if (s.length < 2) return null;
  const q = s[0];
  if ((q !== '"' && q !== "'") || s[s.length - 1] !== q) return null;
  return s.slice(1, -1);
}

function editDistLe2(a, b) {
  const la = a.length, lb = b.length;
  if (Math.abs(la - lb) > 2) return -1;
  const prev = Array.from({ length: lb + 1 }, function (_, j) { return j; });
  const cur = new Array(lb + 1);
  for (let i = 1; i <= la; i++) {
    cur[0] = i;
    let rowMin = cur[0];
    for (let j = 1; j <= lb; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      if (cur[j] < rowMin) rowMin = cur[j];
    }
    if (rowMin > 2) return -1;
    for (let j = 0; j <= lb; j++) prev[j] = cur[j];
  }
  return prev[lb] <= 2 ? prev[lb] : -1;
}

function nearestName(name, candidates) {
  let best = null, bestD = 3, count = 0;
  for (const c of candidates) {
    if (++count > 400 || !c || c === name) continue;
    const d = editDistLe2(name, c);
    if (d >= 0 && d < bestD) { bestD = d; best = c; if (d === 1) break; }
  }
  return best;
}


export function inferProgram(input) {
  const opts = input && typeof input === "object" ? input : {};
  const mode = INFER_MODES.indexOf(opts.mode) >= 0 ? opts.mode : parseModeHeader(opts.source || "");
  try {


    if (!Array.isArray(opts.tokens) || opts.tokens.length === 0) return neutralTypeInfo(mode);


    return inferProgramInner(opts, mode);
  } catch (e) {
    return neutralTypeInfo(mode);
  }
}


function inferProgramInner(opts, mode) {
  const tokens = opts.tokens;
  const len = tokens.length;
  const maxIssues = typeof opts.maxIssues === "number" && opts.maxIssues >= 0 ? opts.maxIssues : 200;
  const resolveRequire = typeof opts.resolveRequire === "function" ? opts.resolveRequire : null;


  const MARK_DATAMODEL = { kind: "datamodel" };
  const MARK_ENUM_ROOT = { kind: "enum-root" };
  const MARK_INSTANCE_CTR = { kind: "instance-ctor" };

  const issues = [];
  const aliases = Object.create(null);
  const allVars = [];
  const nilSafeKeys = new Set();
  let refsCount = 0;
  let moduleReturnType = null;


  let fuel = MAX_FUEL;
  let budgetExhausted = false;

  function tk(i) { return i >= 0 && i < len ? tokens[i] : null; }

  function addIssue(code, message, tok, endTok, fix) {
    const sev = severityFor(code, mode);
    if (!sev || !tok || issues.length >= maxIssues) return;
    const e = endTok || tok;
    issues.push({
      code, severity: sev, message,
      line: tok.line, column: tok.col,
      endLine: e.endLine != null ? e.endLine : tok.line,
      endColumn: e.endCol != null ? e.endCol : tok.col + 1,
      fix: fix || null,
    });
  }


  const scopes = [{ vars: new Map(), narrowed: null }];
  function pushScope(narrowed) { scopes.push({ vars: new Map(), narrowed: narrowed || null }); }
  function popScope() { if (scopes.length > 1) scopes.pop(); }

  function declareVar(nameTok, info) {
    const v = {
      name: nameTok.value,
      line: nameTok.line, col: nameTok.col, endCol: nameTok.endCol || nameTok.col + nameTok.value.length,
      type: (info && info.type) || ANY,
      annotated: !!(info && info.annotated),
      annEndCol: (info && info.annEndCol) || null,
      annEndLine: (info && info.annEndLine) || null,
      isParam: !!(info && info.isParam),
      isFunction: !!(info && info.isFunction),
      refs: [],
    };
    scopes[scopes.length - 1].vars.set(v.name, v);
    allVars.push(v);
    return v;
  }

  function lookupVar(name) {
    for (let s = scopes.length - 1; s >= 0; s--) {
      if (scopes[s].vars.has(name)) {
        const v = scopes[s].vars.get(name);
        for (let n = scopes.length - 1; n >= s; n--) {
          const nar = scopes[n].narrowed;
          if (nar && nar.has(name)) return { v, eff: nar.get(name) };
        }
        return { v, eff: v.type };
      }
    }
    return null;
  }

  function recordRef(v, tok) {
    if (refsCount >= MAX_REFS) return;
    refsCount++;
    v.refs.push({ line: tok.line, col: tok.col, endCol: tok.endCol || tok.col + 1 });
  }


  const blockStack = [];
  function pushBlock(kind, narrowed) { blockStack.push({ kind }); pushScope(narrowed || null); }
  function popBlock() { if (blockStack.length) blockStack.pop(); popScope(); }


  const fnStack = [];


  function matchForward(openIdx, openV, closeV) {
    let depth = 0;
    const cap = Math.min(len, openIdx + MAX_SCAN);
    for (let i = openIdx; i < cap; i++) {
      if (--fuel < 0) { budgetExhausted = true; return -1; }
      if (tokens[i].value === openV) depth++;
      else if (tokens[i].value === closeV) { depth--; if (depth === 0) return i; }
    }
    return -1;
  }


  function consumeTypeAnnotation(k) {
    let depth = 0, parts = [], j = k + 1;
    while (j < len) {
      const t = tokens[j];
      if (t.type === "op") {
        if (t.value === "{" || t.value === "(" || t.value === "<") { depth++; parts.push(t.value); j++; continue; }
        if (t.value === "}" || t.value === ")" || t.value === ">") {
          if (depth === 0) break;
          depth--; parts.push(t.value); j++; continue;
        }
        if (depth > 0) { parts.push(t.value); j++; continue; }
        if (t.value === "?" || t.value === "|" || t.value === "&" || t.value === "." || t.value === "->") { parts.push(t.value); j++; continue; }
        break;
      }
      if (t.type === "name" || (t.type === "keyword" && (t.value === "nil" || t.value === "true" || t.value === "false")) || t.type === "string" || t.type === "number") {
        const prev = parts[parts.length - 1];
        if (depth === 0 && parts.length > 0 && prev !== "." && prev !== "|" && prev !== "&" && prev !== "->" && prev !== "{" && prev !== "(" && prev !== "<" && prev !== ",") break;
        parts.push(t.value); j++; continue;
      }
      if (depth > 0) { parts.push(t.value); j++; continue; }
      break;
    }
    return { text: parts.join(""), next: j, endTok: tokens[j - 1] || tokens[k] };
  }


  function inferValue(k) {
    const t = tk(k);
    if (!t) return ANY;
    if (t.type === "number") return NUMBER;
    if (t.type === "string") return STRING;
    if (t.type === "keyword") {
      if (t.value === "true" || t.value === "false") return BOOLEAN;
      if (t.value === "nil") return NIL;
      if (t.value === "function") return functionType({ params: [], returns: [] });
    }
    if (t.type === "op" && t.value === "{") return inferTableLit(k);
    if (t.type === "name") {

      if (t.value === "Instance") {
        const d = tk(k + 1), nm = tk(k + 2), op = tk(k + 3), arg = tk(k + 4);
        if (d && d.value === "." && nm && nm.value === "new" && op && op.value === "(" && arg && arg.type === "string") {
          const cls = litFromStringToken(arg);
          if (cls) return classType(cls);
        }
        return MARK_INSTANCE_CTR;
      }

      if (t.value === "game") {
        const d = tk(k + 1);
        if (d && d.value === ":") {
          const m = tk(k + 2);
          if (m && m.value === "GetService") {
            const op = tk(k + 3), arg = tk(k + 4);
            if (op && op.value === "(" && arg && arg.type === "string") {
              const svc = litFromStringToken(arg);
              if (svc) return classType(svc);
            }
          }
        }
        return MARK_DATAMODEL;
      }

      try {
        const dtS = getDatatypeStatic(t.value, "new");
        if (dtS) {
          const d = tk(k + 1), nm = tk(k + 2);
          if (d && d.value === ".") {
            if (nm && nm.value === "new") return datatypeType(t.value);
            if (nm && nm.type === "name") {
              const stMember = getDatatypeStatic(t.value, nm.value);
              if (stMember) {
                const rt = typeFromApiTypeName(stMember.returnType || stMember.type || "any");
                return rt || ANY;
              }
            }
            return { kind: "datatype-static", name: t.value };
          }
        }
      } catch (e) {                             }

      if (t.value === "Enum") return MARK_ENUM_ROOT;

      if (t.value === "require") {
        if (resolveRequire) {
          try { return resolveRequire(tk(k + 2)) || ANY; } catch (e) { return ANY; }
        }
        return ANY;
      }

      const lv = lookupVar(t.value);
      if (lv) return lv.eff;
      return ANY;
    }
    return ANY;
  }

  function inferTableLit(k) {
    const closeIdx = matchForward(k, "{", "}");
    if (closeIdx < 0 || closeIdx - k > 600) return tableType({ fields: null });
    const fields = Object.create(null);
    let j = k + 1, count = 0;
    while (j < closeIdx && count < MAX_FIELDS) {
      const key = tk(j);
      const eq = tk(j + 1);
      if (key && key.type === "name" && eq && eq.value === "=") {
        const val = inferValue(j + 2);
        fields[key.value] = widen(val);
        count++;
        j += 3;
        const sep = tk(j);
        if (sep && sep.value === ",") j++;
        continue;
      }
      break;
    }
    return tableType({ fields: Object.keys(fields).length ? fields : null, sealed: true });
  }


  function typeOfChain(segments, line) {
    if (!Array.isArray(segments) || !segments.length) return null;
    try {
      let cur = resolveBase(segments[0], line);
      if (!cur) return null;
      for (let i = 1; i < segments.length && i < 16; i++) {
        cur = advanceChain(cur, segments[i]);
        if (!cur) return null;
      }
      return toContractType(cur);
    } catch (e) {
      return null;
    }
  }

  function resolveBase(seg, line) {
    if (!seg || !seg.name) return null;
    const name = seg.name;

    const lv = lookupVar(name);
    if (lv) {
      let t = lv.eff;
      if (seg.call) t = callReturn(t, seg);
      return t;
    }

    if (name === "game" || name === "workspace" || name === "script") {
      if (name === "game") return seg.call ? null : MARK_DATAMODEL;
      if (name === "workspace") return classType("Workspace");
      if (name === "script") return classType("Script");
    }
    if (name === "Instance") return seg.call ? null : MARK_INSTANCE_CTR;
    if (name === "Enum") return seg.call ? null : MARK_ENUM_ROOT;

    try {
      const dtS = getDatatypeStatic && getDatatypeStatic(name, "new");
      if (dtS) return { kind: "datatype-static", name };
    } catch (e) {          }

    try {
      const lib = getLibrary && getLibrary(name);
      if (lib) return { kind: "lib", name };
    } catch (e) {          }
    return null;
  }

  function advanceChain(cur, seg) {
    if (!cur || !seg || !seg.name) return null;
    const name = seg.name;

    if (cur.kind === "datamodel") {
      if (name === "GetService" && seg.call) {
        const svc = litFromArgsText(seg.args);
        return svc ? classType(svc) : classType("Instance");
      }
      return null;
    }

    if (cur.kind === "instance-ctor") {
      if (name === "new" && seg.call) {
        const cls = litFromArgsText(seg.args);
        return cls ? classType(cls) : classType("Instance");
      }
      return null;
    }

    if (cur.kind === "enum-root") {
      return { kind: "enum", name };
    }

    if (cur.kind === "enum") {
      return { kind: "enumItem", enumName: cur.name };
    }

    if (cur.kind === "datatype-static") {
      if (seg.call) {
        try {
          const stm = getDatatypeStatic(cur.name, name);
          if (stm) {
            const rt = typeFromApiTypeName(stm.returnType || stm.type || "any");
            return rt || ANY;
          }
        } catch (e) {          }
        if (name === "new") return datatypeType(cur.name);
        return null;
      }
      return null;
    }

    if (cur.kind === "lib") {
      try {
        const lm = getLibraryMember && getLibraryMember(cur.name, name);
        if (lm) {
          const rt = typeFromApiTypeName(lm.returnType || lm.type || "any");
          return rt || ANY;
        }
      } catch (e) {          }
      return null;
    }

    if (cur.kind === "datatype") {
      try {
        const dm = getDatatypeMember && getDatatypeMember(cur.name, name);
        if (dm) {
          const rt = typeFromApiTypeName(dm.returnType || dm.type || "any");
          return rt || ANY;
        }
      } catch (e) {          }
      return null;
    }

    if (cur.kind === "class") {
      try {
        const hit = apiMemberType(cur.className, name);
        if (hit) {
          if (seg.call && hit.kind === "Method") {
            const rt = Array.isArray(hit.type.returns) && hit.type.returns.length ? hit.type.returns[0] : null;
            return rt || ANY;
          }
          return hit.type || ANY;
        }
      } catch (e) {          }
      return null;
    }

    if (cur.kind === "table" && cur.fields) {
      const ft = cur.fields[name];
      if (ft) return seg.call ? callReturn(ft, seg) : ft;
      return null;
    }

    if (cur.kind === "union" && Array.isArray(cur.options)) {
      const nonNil = cur.options.filter(function (o) { return !isNilOpt(o); });
      if (!nonNil.length) return null;
      return advanceChain(nonNil[0], seg);
    }
    return null;
  }

  function callReturn(t, seg) {
    if (!t || typeof t !== "object") return ANY;
    if (t.kind === "function") {
      if (Array.isArray(t.returns) && t.returns.length) return t.returns[0];
      if (t.returns && typeof t.returns === "object") return t.returns;
      return ANY;
    }
    return ANY;
  }


  function typeAtPosition(line, col) {
    for (let s = allVars.length - 1; s >= 0; s--) {
      const v = allVars[s];
      if (v.line === line && v.col <= col && col <= (v.endCol || v.col + v.name.length)) {
        return formatType(v.type);
      }
      for (const r of v.refs) {
        if (r.line === line && r.col <= col && col <= (r.endCol || r.col + 1)) {
          const lv = lookupVar(v.name);
          return formatType(lv ? lv.eff : v.type);
        }
      }
    }
    return null;
  }


  let k = 0;
  while (k < len) {


    if (--fuel < 0) { budgetExhausted = true; break; }
    const tok = tokens[k];


    if ((tok.type === "name" && tok.value === "type") || (tok.type === "name" && tok.value === "export")) {
      const isExport = tok.value === "export";
      const typeKw = isExport ? tk(k + 1) : tok;
      const nameTok = isExport ? tk(k + 2) : tk(k + 1);
      if (typeKw && typeKw.value === "type" && nameTok && nameTok.type === "name") {
        const eqTok = isExport ? tk(k + 3) : tk(k + 2);
        if (eqTok && eqTok.value === "=") {
          const colonIdx = isExport ? k + 3 : k + 2;


          let j = colonIdx + 1, depth2 = 0, parts = [];
          while (j < len) {
            const t = tokens[j];
            if (t.type === "op" && (t.value === "{" || t.value === "(" || t.value === "<")) { depth2++; parts.push(t.value); j++; continue; }
            if (t.type === "op" && (t.value === "}" || t.value === ")" || t.value === ">")) {
              if (depth2 === 0) break; depth2--; parts.push(t.value); j++; continue;
            }
            if (depth2 > 0) { parts.push(t.value); j++; continue; }
            if (t.type === "op" && (t.value === "|" || t.value === "&" || t.value === "." || t.value === "->" || t.value === "?")) { parts.push(t.value); j++; continue; }
            if (t.type === "name" || (t.type === "keyword" && (t.value === "nil" || t.value === "true" || t.value === "false")) || t.type === "string" || t.type === "number") {
              const prev = parts[parts.length - 1];
              if (parts.length > 0 && prev !== "." && prev !== "|" && prev !== "&" && prev !== "->" && prev !== "{" && prev !== "(" && prev !== "<" && prev !== ",") break;
              parts.push(t.value); j++; continue;
            }
            break;
          }
          const annText = parts.join("");
          if (annText) {
            try {
              const parsed = parseTypeAnnotation(annText, { aliases });
              if (parsed && parsed.type) aliases[nameTok.value] = parsed.type;
            } catch (e) {          }
          }
          k = j;
          continue;
        }
      }
    }


    if (tok.type === "keyword" && tok.value === "local") {
      const next = tk(k + 1);

      if (next && next.type === "keyword" && next.value === "function") {
        const nameTok2 = tk(k + 2);
        if (nameTok2 && nameTok2.type === "name") {
          const v = declareVar(nameTok2, { isFunction: true, type: functionType({ params: [], returns: [] }) });
          pushBlock("function");
          fnStack.push({ v, params: [], returnsSeen: [], retAnn: null, variadic: false });

          let j = k + 3;
          if (tk(j) && tk(j).value === "(") {
            j++;
            while (j < len) {
              const pt = tk(j);
              if (!pt || pt.value === ")") { j++; break; }
              if (pt.type === "name") {
                let ptype = ANY, annEndTok = null;
                const col = tk(j + 1);
                if (col && col.value === ":") {
                  const ann = consumeTypeAnnotation(j + 1);
                  const parsed = parseTypeAnnotationSafe(ann.text);
                  ptype = parsed || ANY;
                  annEndTok = ann.endTok;
                  j = ann.next;
                } else {
                  if (mode === "strict") addIssue("LUA024", "Par\u00e2metro '" + pt.value + "' sem anota\u00e7\u00e3o de tipo (implicitamente any).", pt, pt);
                  j++;
                }
                const pv = declareVar(pt, { isParam: true, type: ptype, annotated: annEndTok !== null });
                fnStack[fnStack.length - 1].params.push({ name: pt.value, type: ptype, optional: false });
              } else if (pt.value === "...") {
                fnStack[fnStack.length - 1].variadic = true; j++;
              } else { j++; }
              const sep = tk(j);
              if (sep && sep.value === ",") j++;
            }
          }

          if (tk(j) && tk(j).value === ":") {
            const ann = consumeTypeAnnotation(j);
            fnStack[fnStack.length - 1].retAnn = parseTypeAnnotationSafe(ann.text);
            k = ann.next; continue;
          }
          k = j; continue;
        }
        k += 2; continue;
      }

      let j = k + 1;
      const declared = [];
      while (j < len) {
        const t = tk(j);
        if (!t || t.type !== "name") break;
        let annotation = null, annType = null, annEndTok = null, next2 = j + 1;
        const after = tk(j + 1);
        if (after && after.value === ":") {
          const ann = consumeTypeAnnotation(j + 1);
          annotation = ann.text;
          annEndTok = ann.endTok;
          annType = parseTypeAnnotationSafe(annotation);
          next2 = ann.next;
        }
        declared.push({ tok: t, annotation, annType, annEndTok });
        j = next2;
        const sep = tk(j);
        if (sep && sep.value === ",") { j++; continue; }
        break;
      }
      const eqTok = tk(j);
      const hasInit = eqTok && eqTok.value === "=";
      for (let d = 0; d < declared.length; d++) {
        const { tok: nameTok, annotation, annType, annEndTok } = declared[d];
        let inferredType = ANY;
        if (hasInit && d === 0) inferredType = inferValue(j + 1);

        if (annotation) {
          const parsed = parseTypeAnnotationSafe(annotation);
          if (!parsed) {
            addIssue("LUA023", "Anota\u00e7\u00e3o de tipo inv\u00e1lida: '" + annotation + "'.", nameTok, annEndTok || nameTok);
          } else if (annType) {

            if (hasInit && d === 0 && !isUnknown(inferredType) && !isUnknown(annType)) {
              const chk = isAssignable(widen(inferredType), annType);
              if (!chk.ok) {
                addIssue("LUA017", "Atribui\u00e7\u00e3o incompat\u00edvel: " + (chk.reason || formatType(inferredType) + " n\u00e3o \u00e9 atribu\u00edvel a " + formatType(annType)) + ".", nameTok, nameTok);
              }
            }
          }
        }
        const finalType = annType || widen(inferredType);
        declareVar(nameTok, { type: finalType, annotated: !!annotation, annEndCol: annEndTok ? annEndTok.endCol : null });
      }
      k = j; continue;
    }


    if (tok.type === "keyword" && tok.value === "function") {
      pushBlock("function");
      fnStack.push({ v: null, params: [], returnsSeen: [], retAnn: null, variadic: false });
      let j = k + 1;

      while (j < len && (tk(j).type === "name" || (tk(j).type === "op" && (tk(j).value === "." || tk(j).value === ":")))) j++;

      if (tk(j) && tk(j).value === "(") {
        j++;
        while (j < len) {
          const pt = tk(j);
          if (!pt || pt.value === ")") { j++; break; }
          if (pt.type === "name") {
            let ptype = ANY;
            const col = tk(j + 1);
            if (col && col.value === ":") {
              const ann = consumeTypeAnnotation(j + 1);
              ptype = parseTypeAnnotationSafe(ann.text) || ANY;
              j = ann.next;
            } else {
              if (mode === "strict") addIssue("LUA024", "Par\u00e2metro '" + pt.value + "' sem anota\u00e7\u00e3o de tipo (implicitamente any).", pt, pt);
              j++;
            }
            declareVar(pt, { isParam: true, type: ptype });
            fnStack[fnStack.length - 1].params.push({ name: pt.value, type: ptype, optional: false });
          } else if (pt.value === "...") {
            fnStack[fnStack.length - 1].variadic = true; j++;
          } else j++;
          const sep = tk(j);
          if (sep && sep.value === ",") j++;
        }
      }
      if (tk(j) && tk(j).value === ":") {
        const ann = consumeTypeAnnotation(j);
        fnStack[fnStack.length - 1].retAnn = parseTypeAnnotationSafe(ann.text);
        k = ann.next; continue;
      }
      k = j; continue;
    }


    if (tok.type === "keyword" && tok.value === "return") {
      const fn = fnStack.length ? fnStack[fnStack.length - 1] : null;
      if (fn) {
        const retVal = inferValue(k + 1);
        fn.returnsSeen.push(widen(retVal));
        if (fn.retAnn && !isUnknown(retVal) && !isUnknown(fn.retAnn)) {
          const chk = isAssignable(widen(retVal), fn.retAnn);
          if (!chk.ok) addIssue("LUA020", "Retorno incompat\u00edvel: " + (chk.reason || formatType(retVal) + " n\u00e3o \u00e9 atribu\u00edvel a " + formatType(fn.retAnn)) + ".", tok, tok);
        }
      } else {

        moduleReturnType = widen(inferValue(k + 1));
      }
      k++; continue;
    }


    if (tok.type === "keyword") {
      if (tok.value === "end") {
        if (blockStack.length) {
          const top = blockStack[blockStack.length - 1];
          if (top.kind === "function" && fnStack.length) fnStack.pop();
          popBlock();
        }
        k++; continue;
      }
      if (tok.value === "until") { if (blockStack.length) popBlock(); k++; continue; }
      if (tok.value === "else" || tok.value === "elseif") {

        popScope(); pushScope(null);
        k++; continue;
      }
      if (tok.value === "if" || tok.value === "while" || tok.value === "for") {

        const narrowed = parseCondition(k + 1);
        pushBlock(tok.value, narrowed);
        k++; continue;
      }
      if (tok.value === "do" || tok.value === "repeat") {
        pushBlock(tok.value);
        k++; continue;
      }
      if (tok.value === "then") { k++; continue; }
      k++; continue;
    }


    if (tok.type === "name") {
      const lv = lookupVar(tok.value);
      if (lv) recordRef(lv.v, tok);

      const next = tk(k + 1);

      if (next && next.value === "=") {
        if (lv && lv.v.annotated) {
          const rhs = inferValue(k + 2);
          if (!isUnknown(rhs) && !isUnknown(lv.v.type)) {
            const chk = isAssignable(widen(rhs), lv.v.type);
            if (!chk.ok) addIssue("LUA017", "Atribui\u00e7\u00e3o incompat\u00edvel: " + (chk.reason || formatType(rhs) + " n\u00e3o \u00e9 atribu\u00edvel a " + formatType(lv.v.type)) + ".", tok, tok);
          }
        }
        k += 2; continue;
      }


      if (next && (next.value === "." || next.value === ":")) {
        const sep = next.value;
        const memberTok = tk(k + 2);
        if (memberTok && memberTok.type === "name" && lv) {
          const baseType = lv.eff;

          const nilKey = tok.line + ":" + tok.col;
          if (isNilable(baseType) && !nilSafeKeys.has(nilKey)) {
            addIssue("LUA022", "'" + tok.value + "' (" + formatType(baseType) + ") pode ser nil neste ponto.", tok, tok);
          }

          checkMemberExists(baseType, memberTok, sep === ":" ? "method" : "prop", k + 3);
        }
        k += 3; continue;
      }
      k++; continue;
    }

    k++;
  }


  function checkMemberExists(baseType, memberTok, kind, nextIdx) {
    if (!baseType || isUnknown(baseType) || isMarker(baseType)) return;
    const name = memberTok.value;
    if (baseType.kind === "class") {
      try {
        const hit = apiMemberType(baseType.className, name);
        if (hit) {

          if (kind === "method" || (tk(nextIdx) && tk(nextIdx).value === "(")) {
            checkCallArgs(hit.type, memberTok, nextIdx, baseType.className + "." + name);
          }
          return;
        }
      } catch (e) {          }
      try {
        const mbs = membersOf(baseType.className);
        if (mbs && mbs.all) {
          const candidates = Array.from(mbs.all.keys());
          const near = nearestName(name, candidates);
          const fix = near ? { title: "Substituir por '" + near + "'", edits: [{ line: memberTok.line, column: memberTok.col, endLine: memberTok.line, endColumn: memberTok.endCol || memberTok.col + name.length, newText: near }] } : null;
          addIssue("LUA021", "Membro '" + name + "' n\u00e3o existe em " + baseType.className + ".", memberTok, memberTok, fix);
        }
      } catch (e) {          }
      return;
    }
    if (baseType.kind === "datatype") {
      try {
        const dm = getDatatypeMember(baseType.name, name);
        if (dm) return;
        addIssue("LUA021", "Membro '" + name + "' n\u00e3o existe em " + baseType.name + ".", memberTok, memberTok);
      } catch (e) {          }
      return;
    }
    if (baseType.kind === "table" && baseType.fields && baseType.sealed) {
      if (!baseType.fields[name]) {
        const near = nearestName(name, Object.keys(baseType.fields));
        const fix = near ? { title: "Substituir por '" + near + "'", edits: [{ line: memberTok.line, column: memberTok.col, endLine: memberTok.line, endColumn: memberTok.endCol || memberTok.col + name.length, newText: near }] } : null;
        addIssue("LUA021", "Membro '" + name + "' n\u00e3o existe na tabela.", memberTok, memberTok, fix);
      }
    }
  }


  function checkCallArgs(fnType, calleeTok, nextIdx, calleeName) {
    if (!fnType || fnType.kind !== "function") return;
    const opTok = tk(nextIdx);
    if (!opTok || opTok.value !== "(") return;
    const closeIdx = matchForward(nextIdx, "(", ")");
    if (closeIdx < 0 || closeIdx - nextIdx > 600) return;

    const argTypes = [];
    let j = nextIdx + 1;
    while (j < closeIdx) {
      argTypes.push(widen(inferValue(j)));

      let depth2 = 0;
      while (j < closeIdx) {
        if (tokens[j].value === "(" || tokens[j].value === "{") depth2++;
        else if (tokens[j].value === ")" || tokens[j].value === "}") depth2--;
        else if (tokens[j].value === "," && depth2 === 0) { j++; break; }
        j++;
      }
    }
    const params = Array.isArray(fnType.params) ? fnType.params.filter(function (p) { return p && !p.optional; }) : [];
    const allParams = Array.isArray(fnType.params) ? fnType.params : [];

    if (!fnType.varargs && !fnType.variadic) {
      if (argTypes.length < params.length) {
        addIssue("LUA019", "Argumentos insuficientes em '" + calleeName + "': esperado " + params.length + ", recebido " + argTypes.length + ".", calleeTok, calleeTok);
        return;
      }
      if (argTypes.length > allParams.length) {
        addIssue("LUA019", "Argumentos em excesso em '" + calleeName + "': esperado " + allParams.length + ", recebido " + argTypes.length + ".", calleeTok, calleeTok);
        return;
      }
    }

    for (let i = 0; i < Math.min(argTypes.length, allParams.length); i++) {
      const pt = allParams[i];
      if (!pt || !pt.type || isUnknown(pt.type) || isUnknown(argTypes[i])) continue;
      const chk = isAssignable(argTypes[i], pt.type);
      if (!chk.ok) {
        addIssue("LUA018", "Argumento " + (i + 1) + " de '" + calleeName + "': " + (chk.reason || formatType(argTypes[i]) + " n\u00e3o \u00e9 atribu\u00edvel a " + formatType(pt.type)) + ".", calleeTok, calleeTok);
      }
    }
  }


  function parseCondition(startK) {
    const cap = Math.min(len, startK + MAX_COND);
    const narrowed = new Map();
    let j = startK;
    while (j < cap) {
      const t = tk(j);
      if (!t || t.type === "keyword" && (t.value === "then" || t.value === "do")) break;

      if (t.type === "name") {
        const op = tk(j + 1);
        if (op && op.value === "~=" && tk(j + 2) && tk(j + 2).type === "keyword" && tk(j + 2).value === "nil") {
          const lv2 = lookupVar(t.value);
          if (lv2) {
            try { narrowed.set(t.value, stripNil(lv2.eff)); } catch (e) {          }
          }
          j += 3; continue;
        }

        if (t.value === "typeof" && tk(j + 1) && tk(j + 1).value === "(") {
          const inner = tk(j + 2), cp = tk(j + 3), eq = tk(j + 4), tag = tk(j + 5);
          if (inner && inner.type === "name" && cp && cp.value === ")" && eq && eq.value === "==" && tag && tag.type === "string") {
            const tagVal = litFromStringToken(tag);
            if (tagVal) {
              const lv2 = lookupVar(inner.value);
              if (lv2) {
                try { narrowed.set(inner.value, narrowByTypeof(lv2.eff, tagVal)); } catch (e) {          }
              }
            }
            j += 6; continue;
          }
        }

        if (tk(j + 1) && tk(j + 1).value === ":" && tk(j + 2) && tk(j + 2).value === "IsA" && tk(j + 3) && tk(j + 3).value === "(") {
          const arg = tk(j + 4);
          if (arg && arg.type === "string") {
            const cls = litFromStringToken(arg);
            if (cls) {
              const lv2 = lookupVar(t.value);
              if (lv2) {
                try { narrowed.set(t.value, narrowByIsA(lv2.eff, cls)); } catch (e) {          }
              }
            }
            j += 6; continue;
          }
        }

        const lv2 = lookupVar(t.value);
        if (lv2 && isNilable(lv2.eff)) {
          try {
            narrowed.set(t.value, narrowTruthy(lv2.eff));

            if (nilSafeKeys.size < MAX_NILSAFE) nilSafeKeys.add(t.line + ":" + t.col);
          } catch (e) {          }
        }
      }
      j++;
    }
    return narrowed.size ? narrowed : null;
  }


  function parseTypeAnnotationSafe(text) {
    if (!text) return null;
    try {
      const res = parseTypeAnnotation(text, { aliases });
      if (res && res.errors && res.errors.length) return null;
      return (res && res.type) || null;
    } catch (e) {
      return null;
    }
  }


  const locals = allVars.map(function (v) {
    return {
      name: v.name,
      line: v.line, col: v.col, endCol: v.endCol,
      type: formatType(v.type),
      annotated: v.annotated,
      isParam: v.isParam,
      isFunction: v.isFunction,
    };
  });

  const aliasStrings = Object.create(null);
  for (const k2 in aliases) aliasStrings[k2] = formatType(aliases[k2]);

  const nilSafeRefs = Array.from(nilSafeKeys).slice(0, MAX_NILSAFE);

  return {
    mode,
    issues,
    locals,
    aliases: aliasStrings,
    moduleReturnType: moduleReturnType ? toContractType(moduleReturnType) : null,
    nilSafeRefs,
    budgetExhausted,
    typeOfChain,
    typeAtPosition,
    formatType,
  };
}
