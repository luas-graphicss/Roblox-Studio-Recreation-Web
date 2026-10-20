import {
  resolveClassName,
  membersOf,
  findMember,
  getDatatype,
  enumItems,
} from "./apiDocs.js";

export const TYPES_VERSION = "luau-types-1";

const freeze = Object.freeze;
const hasOwn = (obj, k) => Object.prototype.hasOwnProperty.call(obj, k);


export const ANY = freeze({ kind: "any" });
export const UNKNOWN = freeze({ kind: "unknown" });
export const NEVER = freeze({ kind: "never" });
export const NIL = freeze({ kind: "nil" });
export const BOOLEAN = freeze({ kind: "boolean" });
export const NUMBER = freeze({ kind: "number" });
export const STRING = freeze({ kind: "string" });
export const THREAD = freeze({ kind: "thread" });
export const BUFFER = freeze({ kind: "buffer" });

const TRUE_LITERAL = freeze({ kind: "boolean", literal: true });
const FALSE_LITERAL = freeze({ kind: "boolean", literal: false });


function safeType(t) {
  return t && typeof t === "object" && typeof t.kind === "string" ? t : ANY;
}


export function classType(className) {
  return freeze({ kind: "class", className: String(className == null ? "" : className) });
}
export function datatypeType(name) {
  return freeze({ kind: "datatype", name: String(name == null ? "" : name) });
}
export function enumType(name) {
  return freeze({ kind: "enum", name: String(name == null ? "" : name) });
}
export function enumItemType(enumName) {
  return freeze({ kind: "enumItem", enumName: String(enumName == null ? "" : enumName) });
}
export function arrayType(element) {
  return freeze({ kind: "array", element: safeType(element) });
}
export function tableType(def) {
  const d = def || {};
  const fields = {};
  const src = d.fields || {};
  for (const k of Object.keys(src)) fields[k] = safeType(src[k]);
  const indexer = d.indexer && d.indexer.key && d.indexer.value
    ? freeze({ key: safeType(d.indexer.key), value: safeType(d.indexer.value) })
    : null;
  return freeze({ kind: "table", fields: freeze(fields), indexer, sealed: !!d.sealed });
}
export function functionType(def) {
  const d = def || {};
  const params = (Array.isArray(d.params) ? d.params : []).map((p) => freeze({
    name: p && p.name != null ? String(p.name) : null,
    type: safeType(p && p.type),
    optional: !!(p && p.optional),
  }));
  return freeze({
    kind: "function",
    params: freeze(params),
    varargs: d.varargs ? safeType(d.varargs) : null,
    returns: freeze((Array.isArray(d.returns) ? d.returns : []).map(safeType)),
    selfParam: !!d.selfParam,
  });
}
export function literalString(s) {
  return freeze({ kind: "string", literal: String(s == null ? "" : s) });
}
export function literalNumber(n) {
  const v = Number(n);
  return freeze({ kind: "number", literal: Number.isFinite(v) ? v : 0 });
}
export function literalBoolean(b) {
  return b ? TRUE_LITERAL : FALSE_LITERAL;
}


function typeKey(t, depth) {
  const v = safeType(t);
  const d = depth || 0;
  if (d > 12) return "\u2026";
  switch (v.kind) {
    case "boolean":
    case "number":
    case "string":
      return v.literal === undefined ? v.kind : v.kind + ":" + JSON.stringify(v.literal);
    case "class":
      return "class:" + (resolveClassName(v.className) || v.className);
    case "datatype":
      return "datatype:" + v.name;
    case "enum":
      return "enum:" + v.name;
    case "enumItem":
      return "enumItem:" + v.enumName;
    case "array":
      return "array<" + typeKey(v.element, d + 1) + ">";
    case "table": {
      const fs = Object.keys(v.fields || {}).sort()
        .map((k) => k + ":" + typeKey(v.fields[k], d + 1)).join(",");
      const ix = v.indexer
        ? "[" + typeKey(v.indexer.key, d + 1) + "]:" + typeKey(v.indexer.value, d + 1)
        : "";
      return "table{" + fs + ";" + ix + ";" + (v.sealed ? "s" : "u") + "}";
    }
    case "function": {
      const ps = (v.params || [])
        .map((p) => typeKey(p.type, d + 1) + (p.optional ? "?" : "")).join(",");
      const va = v.varargs ? "..." + typeKey(v.varargs, d + 1) : "";
      const rs = (v.returns || []).map((r) => typeKey(r, d + 1)).join(",");
      return "fn" + (v.selfParam ? "self" : "") + "(" + ps + (va ? "," + va : "") + ")->(" + rs + ")";
    }
    case "union":
      return "union(" + (v.options || []).map((o) => typeKey(o, d + 1)).sort().join("|") + ")";
    default:
      return v.kind;
  }
}


export function unionType(list) {
  const flat = [];
  const push = (t) => {
    const v = safeType(t);
    if (v.kind === "union") {
      for (const o of v.options || []) push(o);
      return;
    }
    if (v.kind === "never") return;
    flat.push(v);
  };
  if (Array.isArray(list)) for (const t of list) push(t);
  if (!flat.length) return NEVER;
  for (const t of flat) if (t.kind === "any") return ANY;
  for (const t of flat) if (t.kind === "unknown") return UNKNOWN;
  const barePrim = new Set();
  for (const t of flat) {
    if ((t.kind === "boolean" || t.kind === "number" || t.kind === "string") && t.literal === undefined) {
      barePrim.add(t.kind);
    }
  }
  let hasTrue = false;
  let hasFalse = false;
  for (const t of flat) {
    if (t.kind === "boolean" && t.literal === true) hasTrue = true;
    if (t.kind === "boolean" && t.literal === false) hasFalse = true;
  }
  const collapseBool = hasTrue && hasFalse;
  const out = [];
  const seen = new Set();
  for (let t of flat) {
    if ((t.kind === "boolean" || t.kind === "number" || t.kind === "string") && t.literal !== undefined) {
      if (barePrim.has(t.kind)) continue;
      if (t.kind === "boolean" && collapseBool) t = BOOLEAN;
    }
    const k = typeKey(t);
    if (!seen.has(k)) {
      seen.add(k);
      out.push(t);
    }
  }
  if (!out.length) return NEVER;
  if (out.length === 1) return out[0];
  return freeze({ kind: "union", options: freeze(out) });
}

export function optional(t) {
  return unionType([safeType(t), NIL]);
}

export function stripNil(t) {
  const v = safeType(t);
  if (v.kind === "nil") return NEVER;
  if (v.kind === "union") return unionType((v.options || []).filter((o) => safeType(o).kind !== "nil"));
  return v;
}


export function isNilable(t) {
  return nilableCheck(safeType(t), 0);
}
function nilableCheck(v, d) {
  if (d > 16) return false;
  if (v.kind === "nil") return true;
  if (v.kind === "union") return (v.options || []).some((o) => nilableCheck(safeType(o), d + 1));
  return false;
}


const FN_ANY = functionType({ params: [], varargs: ANY, returns: [ANY], selfParam: false });
const DICT_ANY = tableType({ indexer: { key: STRING, value: ANY } });
const EMPTY_TABLE = tableType({});


const API_PRIMITIVE_TYPES = {
  float: NUMBER,
  int: NUMBER,
  int64: NUMBER,
  double: NUMBER,
  bool: BOOLEAN,
  Content: STRING,
  ContentId: STRING,
  ProtectedString: STRING,
  BinaryString: STRING,
  Variant: ANY,
  Tuple: ANY,
  Objects: arrayType(classType("Instance")),
  Dictionary: DICT_ANY,
  Map: DICT_ANY,
  Array: arrayType(ANY),
  Function: FN_ANY,
  void: NIL,
};


const PUNCT = "(){}[],:.|&?<>;";

function tokenizeAnnotation(text) {
  const src = String(text == null ? "" : text);
  const toks = [];
  let i = 0;
  const n = src.length;
  while (i < n) {
    const c = src[i];
    if (c === " " || c === "\t" || c === "\r" || c === "\n") { i++; continue; }
    if (c === "-" && src[i + 1] === ">") { toks.push({ t: "->" }); i += 2; continue; }
    if (c === "." && src[i + 1] === "." && src[i + 2] === ".") { toks.push({ t: "..." }); i += 3; continue; }
    if (PUNCT.indexOf(c) !== -1) { toks.push({ t: c }); i++; continue; }
    if (c === '"' || c === "'") {
      let j = i + 1;
      let s = "";
      while (j < n && src[j] !== c) {
        if (src[j] === "\\" && j + 1 < n) { s += src[j + 1]; j += 2; }
        else { s += src[j]; j++; }
      }
      toks.push({ t: "string", v: s });
      i = j < n ? j + 1 : n;
      continue;
    }
    if (c >= "0" && c <= "9") {
      let j = i;
      while (j < n && /[0-9A-Fa-f._xX]/.test(src[j])) j++;
      const num = Number(src.slice(i, j).replace(/_/g, ""));
      toks.push({ t: "number", v: Number.isFinite(num) ? num : 0 });
      i = j;
      continue;
    }
    if (/[A-Za-z_]/.test(c)) {
      let j = i;
      while (j < n && /[A-Za-z0-9_]/.test(src[j])) j++;
      toks.push({ t: "name", v: src.slice(i, j) });
      i = j;
      continue;
    }


    toks.push({ t: "junk", v: c });
    i++;
  }
  return toks;
}


const MAX_DEPTH = 40;

function peekT(st, o) {
  const tok = st.toks[st.pos + (o || 0)];
  return tok ? tok.t : null;
}
function peekTok(st, o) {
  return st.toks[st.pos + (o || 0)] || null;
}
function err(st, message) {
  if (st.errors.length < 24) st.errors.push({ message });
}
function findMatching(st, openT, closeT, from) {
  let depth = 0;
  for (let i = from; i < st.toks.length; i++) {
    const t = st.toks[i].t;
    if (t === openT) depth++;
    else if (t === closeT) {
      depth--;
      if (depth === 0) return i;
    }
  }
  return -1;
}
function skipBalanced(st, openT, closeT) {

  let depth = 0;
  let guard = 0;
  while (st.pos < st.toks.length && guard++ < 500) {
    const t = st.toks[st.pos].t;
    st.pos++;
    if (t === openT) depth++;
    else if (t === closeT) {
      depth--;
      if (depth === 0) return true;
    }
  }
  err(st, "'" + openT + "' sem fechamento na anotação de tipo");
  return false;
}

function parseUnionT(st, depth) {
  if (depth > MAX_DEPTH) {
    err(st, "Anotação de tipo profunda demais");
    st.pos++;
    return ANY;
  }
  if (peekT(st) === "|") st.pos++;                      
  const first = parseInterT(st, depth + 1);
  if (peekT(st) !== "|") return first;
  const opts = [first];
  while (peekT(st) === "|") {
    st.pos++;
    opts.push(parseInterT(st, depth + 1));
  }
  return unionType(opts);
}

function parseInterT(st, depth) {
  const first = parsePostfixT(st, depth + 1);
  if (peekT(st) !== "&") return first;
  const parts = [first];
  while (peekT(st) === "&") {
    st.pos++;
    parts.push(parsePostfixT(st, depth + 1));
  }
  return intersectTypes(parts);
}


function intersectTypes(parts) {
  const rest = parts.filter((t) => t.kind !== "any" && t.kind !== "unknown");
  if (!rest.length) return parts[0] || ANY;
  if (rest.length === 1) return rest[0];
  if (rest.every((t) => t.kind === "table")) {
    const fields = {};
    let indexer = null;
    let sealed = false;
    for (const t of rest) {
      for (const k of Object.keys(t.fields || {})) {
        if (!hasOwn(fields, k)) fields[k] = t.fields[k];
      }
      if (!indexer && t.indexer) indexer = t.indexer;
      sealed = sealed || !!t.sealed;
    }
    return tableType({ fields, indexer, sealed });
  }
  const cls = rest.find((t) => t.kind === "class");
  if (cls) return cls;
  return rest[0];
}

function parsePostfixT(st, depth) {
  let t = parsePrimaryT(st, depth + 1);
  while (peekT(st) === "?") {
    st.pos++;
    t = optional(t);
  }
  return t;
}

function parsePrimaryT(st, depth) {
  if (depth > MAX_DEPTH) {
    err(st, "Anotação de tipo profunda demais");
    st.pos++;
    return ANY;
  }
  const tok = peekTok(st);
  if (!tok) {
    err(st, "Anotação de tipo incompleta");
    return ANY;
  }
  if (tok.t === "(") {
    const close = findMatching(st, "(", ")", st.pos);
    const after = close >= 0 ? st.toks[close + 1] : null;
    if (after && after.t === "->") return parseFunctionT(st, depth + 1);
    st.pos++;       
    if (peekT(st) === ")") {
      st.pos++;
      err(st, "Tipo vazio '()' só é válido como retorno de função");
      return ANY;
    }
    const inner = parseUnionT(st, depth + 1);
    if (peekT(st) === ")") st.pos++;
    else err(st, "Faltou ')' na anotação de tipo");
    return inner;
  }
  if (tok.t === "{") return parseTableT(st, depth + 1);
  if (tok.t === "name") {
    if (tok.v === "typeof" && peekT(st, 1) === "(") {
      st.pos++;            
      skipBalanced(st, "(", ")");
      return ANY;                                  
    }
    return parseNamedT(st, depth + 1);
  }
  if (tok.t === "string") {
    st.pos++;
    return literalString(tok.v);
  }
  if (tok.t === "number") {
    st.pos++;
    return literalNumber(tok.v);
  }
  if (tok.t === "...") {

    st.pos++;
    const nxt = peekT(st);
    if (nxt === ")" || nxt === null || nxt === ",") return ANY;
    return parseUnionT(st, depth + 1);
  }
  err(st, "Token inesperado '" + (tok.v != null ? tok.v : tok.t) + "' na anotação de tipo");
  st.pos++;
  return ANY;
}

function parseNamedT(st, depth) {
  const names = [peekTok(st).v];
  st.pos++;
  while (peekT(st) === "." && peekT(st, 1) === "name") {
    st.pos++;
    names.push(peekTok(st).v);
    st.pos++;
  }
  if (peekT(st) === "<") skipBalanced(st, "<", ">");                          
  if (names[0] === "Enum") {
    if (names.length === 1) {
      err(st, "'Enum' sem nome na anotação de tipo");
      return ANY;
    }
    const en = names[1];
    if (!enumItems(en)) err(st, "Enum desconhecido: 'Enum." + en + "'");
    return names.length >= 3 ? enumItemType(en) : enumType(en);
  }
  if (names.length > 1) {
    err(st, "Tipo desconhecido: '" + names.join(".") + "'");
    return ANY;
  }
  const name = names[0];
  switch (name) {
    case "nil": return NIL;
    case "any": return ANY;
    case "unknown": return UNKNOWN;
    case "never": return NEVER;
    case "boolean": return BOOLEAN;
    case "number": return NUMBER;
    case "string": return STRING;
    case "thread": return THREAD;
    case "buffer": return BUFFER;
    case "true": return TRUE_LITERAL;
    case "false": return FALSE_LITERAL;
    case "self": return ANY;
    default: break;
  }
  if (st.aliases && hasOwn(st.aliases, name)) return safeType(st.aliases[name]);
  if (hasOwn(API_PRIMITIVE_TYPES, name)) return API_PRIMITIVE_TYPES[name];
  const cls = resolveClassName(name);
  if (cls) return classType(cls);
  if (getDatatype(name)) return datatypeType(name);
  if (/^[A-Z][A-Za-z0-9]?$/.test(name)) return ANY;                                  
  err(st, "Tipo desconhecido: '" + name + "'");
  return ANY;
}

function parseFunctionT(st, depth) {
  st.pos++;       
  const params = [];
  let varargs = null;
  if (peekT(st) === ")") {
    st.pos++;
  } else {
    let guard = 0;
    while (st.pos < st.toks.length && guard++ < 200) {
      const before = st.pos;
      if (peekT(st) === "...") {
        st.pos++;
        if (peekT(st) === ":") st.pos++;                   
        const nxt = peekT(st);
        varargs = (nxt === ")" || nxt === "," || nxt === null) ? ANY : parseUnionT(st, depth + 1);
      } else {
        let pname = null;
        let optFlag = false;
        if (peekT(st) === "name" && (peekT(st, 1) === ":" || (peekT(st, 1) === "?" && peekT(st, 2) === ":"))) {
          pname = peekTok(st).v;
          st.pos++;
          if (peekT(st) === "?") { optFlag = true; st.pos++; }
          st.pos++;       
        }
        const ty = parseUnionT(st, depth + 1);
        params.push({ name: pname, type: ty, optional: optFlag || isNilable(ty) });
      }
      if (peekT(st) === ",") { st.pos++; continue; }
      if (peekT(st) === ")") { st.pos++; break; }
      err(st, "Esperado ',' ou ')' nos parâmetros da função");
      if (st.pos === before) st.pos++;                     
      if (st.pos >= st.toks.length) break;
    }
  }
  if (peekT(st) === "->") st.pos++;
  else err(st, "Faltou '->' no tipo de função");
  let returns = [];
  if (peekT(st) === "(") {
    const close = findMatching(st, "(", ")", st.pos);
    const after = close >= 0 ? st.toks[close + 1] : null;
    if (after && after.t === "->") {
      returns = [parseUnionT(st, depth + 1)];                          
    } else {
      st.pos++;       
      if (peekT(st) === ")") {
        st.pos++;                      
      } else {
        let guard = 0;
        while (st.pos < st.toks.length && guard++ < 200) {
          const before = st.pos;
          if (peekT(st) === "...") st.pos++;                                    
          returns.push(parseUnionT(st, depth + 1));
          if (peekT(st) === ",") { st.pos++; continue; }
          if (peekT(st) === ")") { st.pos++; break; }
          err(st, "Esperado ',' ou ')' nos retornos da função");
          if (st.pos === before) st.pos++;
          if (st.pos >= st.toks.length) break;
        }
      }
    }
  } else if (peekT(st) !== null) {
    returns = [parseUnionT(st, depth + 1)];
  }
  return functionType({ params, varargs, returns, selfParam: false });
}

function parseTableT(st, depth) {
  st.pos++;       
  const fields = {};
  let indexer = null;
  const elements = [];
  let guard = 0;
  let closed = false;
  while (st.pos < st.toks.length && guard++ < 200) {
    const before = st.pos;
    if (peekT(st) === "}") {
      st.pos++;
      closed = true;
      break;
    }
    if (peekT(st) === "[") {
      st.pos++;
      const key = parseUnionT(st, depth + 1);
      if (peekT(st) === "]") st.pos++;
      else err(st, "Faltou ']' no indexador da tabela");
      if (peekT(st) === ":") st.pos++;
      else err(st, "Faltou ':' no indexador da tabela");
      const value = parseUnionT(st, depth + 1);
      if (indexer) err(st, "Tabela com mais de um indexador");
      indexer = { key, value };
    } else if (peekT(st) === "name" && peekT(st, 1) === ":") {
      const fname = peekTok(st).v;
      st.pos += 2;
      fields[fname] = parseUnionT(st, depth + 1);
    } else {
      elements.push(parseUnionT(st, depth + 1));
    }
    if (peekT(st) === "," || peekT(st) === ";") { st.pos++; continue; }
    if (peekT(st) === "}") {
      st.pos++;
      closed = true;
      break;
    }
    err(st, "Esperado ',' ou '}' na tabela");
    if (st.pos === before) st.pos++;
    if (st.pos >= st.toks.length) break;
  }
  if (!closed && guard >= 200) err(st, "Tabela sem fechamento na anotação de tipo");
  const hasFields = Object.keys(fields).length > 0;
  if (elements.length && !hasFields && !indexer) {
    return arrayType(elements.length === 1 ? elements[0] : unionType(elements));
  }
  if (elements.length) err(st, "Mistura de elementos de array com campos nomeados na tabela");
  return tableType({ fields, indexer, sealed: false });
}

export function parseTypeAnnotation(text, ctx) {
  const errors = [];
  try {
    const toks = tokenizeAnnotation(text);
    if (!toks.length) {
      errors.push({ message: "Anotação de tipo vazia" });
      return { type: ANY, errors };
    }
    const st = { toks, pos: 0, errors, aliases: (ctx && ctx.aliases) || null };
    const type = parseUnionT(st, 0);
    if (st.pos < toks.length) err(st, "Conteúdo inesperado após o fim da anotação de tipo");
    return { type, errors };
  } catch (e) {
    errors.push({ message: "Falha interna ao analisar anotação: " + (e && e.message ? e.message : String(e)) });
    return { type: ANY, errors };
  }
}


export function formatType(t) {
  try {
    return fmt(safeType(t), 0);
  } catch (e) {
    return "any";
  }
}
function fmt(v, depth) {
  if (depth > 6) return "\u2026";
  switch (v.kind) {
    case "any":
    case "unknown":
    case "never":
    case "nil":
    case "thread":
    case "buffer":
      return v.kind;
    case "boolean":
      return v.literal === undefined ? "boolean" : (v.literal ? "true" : "false");
    case "number":
      return v.literal === undefined ? "number" : String(v.literal);
    case "string":
      return v.literal === undefined ? "string" : JSON.stringify(v.literal);
    case "class":
      return v.className || "Instance";
    case "datatype":
      return v.name || "userdata";
    case "enum":
      return "Enum." + v.name;
    case "enumItem":
      return "Enum." + v.enumName;
    case "array":
      return "{ " + fmt(safeType(v.element), depth + 1) + " }";
    case "table": {
      const parts = [];
      const keys = Object.keys(v.fields || {});
      for (const k of keys.slice(0, 5)) parts.push(k + ": " + fmt(safeType(v.fields[k]), depth + 1));
      if (keys.length > 5) parts.push("\u2026");
      if (v.indexer) {
        parts.push("[" + fmt(safeType(v.indexer.key), depth + 1) + "]: " + fmt(safeType(v.indexer.value), depth + 1));
      }
      return parts.length ? "{ " + parts.join(", ") + " }" : "{}";
    }
    case "function": {
      const ps = (v.params || []).map((p) => fmt(safeType(p.type), depth + 1));
      if (v.varargs) ps.push("..." + fmt(safeType(v.varargs), depth + 1));
      const rs = (v.returns || []).map((r) => fmt(safeType(r), depth + 1));
      const rlabel = rs.length === 1 ? rs[0] : "(" + rs.join(", ") + ")";
      return "(" + ps.join(", ") + ") -> " + rlabel;
    }
    case "union": {
      const opts = (v.options || []).map(safeType);
      const hasNil = opts.some((o) => o.kind === "nil");
      const rest = opts.filter((o) => o.kind !== "nil");
      if (hasNil && rest.length === 1) {
        const inner = fmt(rest[0], depth + 1);
        const paren = rest[0].kind === "function" || rest[0].kind === "union";
        return (paren ? "(" + inner + ")" : inner) + "?";
      }
      const parts = rest.map((o) => {
        const s = fmt(o, depth + 1);
        return o.kind === "function" ? "(" + s + ")" : s;
      });
      if (hasNil) parts.push("nil");
      return parts.join(" | ") || "never";
    }
    default:
      return String(v.kind || "any");
  }
}


function classInherits(childName, parentName) {
  const c = resolveClassName(childName);
  const p = resolveClassName(parentName);
  if (!c || !p) return String(childName) === String(parentName);
  if (c === p) return true;
  const info = membersOf(c);
  return !!info && info.chain.indexOf(p) !== -1;
}
function commonClassAncestor(aName, bName) {
  const a = resolveClassName(aName);
  const b = resolveClassName(bName);
  if (!a || !b) return null;
  const ia = membersOf(a);
  const ib = membersOf(b);
  if (!ia || !ib) return null;
  const inB = new Set(ib.chain);
  for (let i = ia.chain.length - 1; i >= 0; i--) {
    if (inB.has(ia.chain[i])) return ia.chain[i];
  }
  return null;
}


function failMsg(s, t, detail) {
  const base = fmt(safeType(s), 0) + " n\u00e3o \u00e9 atribu\u00edvel a " + fmt(safeType(t), 0);
  return detail ? base + " (" + detail + ")" : base;
}

export function isAssignable(source, target) {
  try {
    const reason = assignCheck(safeType(source), safeType(target), 0);
    return reason === null ? { ok: true, reason: null } : { ok: false, reason };
  } catch (e) {
    return { ok: true, reason: null };                                     
  }
}

function assignCheck(s, t, depth) {
  if (depth > 24) return null;                                        
  if (s.kind === "any" || t.kind === "any") return null;
  if (t.kind === "unknown") return null;
  if (s.kind === "never") return null;
  if (s.kind === "unknown") {
    return failMsg(s, t, "unknown precisa ser refinado (typeof/IsA) antes de usar");
  }
  if (t.kind === "never") return failMsg(s, t, null);
  if (s.kind === "union") {
    for (const o of s.options || []) {
      const r = assignCheck(safeType(o), t, depth + 1);
      if (r !== null) return failMsg(s, t, r);
    }
    return null;
  }
  if (t.kind === "union") {
    for (const o of t.options || []) {
      if (assignCheck(s, safeType(o), depth + 1) === null) return null;
    }
    return failMsg(s, t, s.kind === "nil" ? "a uni\u00e3o n\u00e3o inclui nil" : "nenhuma op\u00e7\u00e3o da uni\u00e3o aceita o valor");
  }
  if (s.kind === "nil") {
    if (t.kind === "nil") return null;
    return failMsg(s, t, "nil s\u00f3 \u00e9 aceito por nil ou por uni\u00f5es com nil \u2014 use " + fmt(t, 0) + "?");
  }
  switch (t.kind) {
    case "boolean":
    case "number":
    case "string": {
      if (s.kind !== t.kind) return failMsg(s, t, null);
      if (t.literal === undefined) return null;
      if (s.literal === undefined) return failMsg(s, t, "o alvo exige exatamente " + fmt(t, 0));
      return Object.is(s.literal, t.literal) ? null : failMsg(s, t, null);
    }
    case "nil":
      return failMsg(s, t, null);
    case "thread":
    case "buffer":
      return s.kind === t.kind ? null : failMsg(s, t, null);
    case "class": {
      if (s.kind !== "class") return failMsg(s, t, null);
      if (classInherits(s.className, t.className)) return null;
      const sn = resolveClassName(s.className) || s.className;
      const tn = resolveClassName(t.className) || t.className;
      return failMsg(s, t, sn + " n\u00e3o herda de " + tn);
    }
    case "datatype":
      return s.kind === "datatype" && s.name === t.name ? null : failMsg(s, t, null);
    case "enum": {
      if (s.kind === "enum" && s.name === t.name) return null;
      if (s.kind === "enumItem" && s.enumName === t.name) return null;
      return failMsg(s, t, null);
    }
    case "enumItem":
      return s.kind === "enumItem" && s.enumName === t.enumName ? null : failMsg(s, t, null);
    case "array": {
      if (s.kind === "array") {
        const r = assignCheck(safeType(s.element), safeType(t.element), depth + 1);
        return r === null ? null : failMsg(s, t, "elemento: " + r);
      }
      if (s.kind === "table") {
        const noFields = Object.keys(s.fields || {}).length === 0;
        if (noFields && !s.indexer) return null;                          
        if (s.indexer && assignCheck(NUMBER, safeType(s.indexer.key), depth + 1) === null) {
          const r = assignCheck(safeType(s.indexer.value), safeType(t.element), depth + 1);
          return r === null ? null : failMsg(s, t, "elemento: " + r);
        }
      }
      return failMsg(s, t, null);
    }
    case "table": {
      if (s.kind === "array") {
        const req = Object.keys(t.fields || {}).filter((k) => !isNilable(safeType(t.fields[k])));
        if (req.length) return failMsg(s, t, "campo obrigat\u00f3rio '" + req[0] + "' ausente");
        if (t.indexer) {
          const r = assignCheck(safeType(s.element), safeType(t.indexer.value), depth + 1);
          if (r !== null) return failMsg(s, t, "valor do indexador: " + r);
        }
        return null;
      }
      if (s.kind !== "table") {
        return failMsg(s, t, "apenas tabelas estruturais s\u00e3o aceitas aqui");
      }
      for (const k of Object.keys(t.fields || {})) {
        const tf = safeType(t.fields[k]);
        const has = s.fields && hasOwn(s.fields, k);
        if (!has) {
          if (isNilable(tf)) continue;
          if (s.indexer && assignCheck(safeType(s.indexer.value), tf, depth + 1) === null) continue;
          return failMsg(s, t, "campo obrigat\u00f3rio '" + k + "' ausente");
        }
        const r = assignCheck(safeType(s.fields[k]), tf, depth + 1);
        if (r !== null) return failMsg(s, t, "campo '" + k + "': " + r);
      }
      if (t.indexer) {
        for (const k of Object.keys(s.fields || {})) {
          const r = assignCheck(safeType(s.fields[k]), safeType(t.indexer.value), depth + 1);
          if (r !== null) return failMsg(s, t, "campo '" + k + "' vs indexador: " + r);
        }
        if (s.indexer) {
          const r = assignCheck(safeType(s.indexer.value), safeType(t.indexer.value), depth + 1);
          if (r !== null) return failMsg(s, t, "valor do indexador: " + r);
        }
      }
      return null;
    }
    case "function": {
      if (s.kind !== "function") return failMsg(s, t, null);
      if (!!s.selfParam !== !!t.selfParam) {
        return failMsg(s, t, s.selfParam
          ? "m\u00e9todo (self via ':') onde se espera fun\u00e7\u00e3o comum"
          : "fun\u00e7\u00e3o comum onde se espera m\u00e9todo (self via ':')");
      }
      const sReq = (s.params || []).filter((p) => !p.optional).length;
      const tCap = (t.params || []).length;
      if (sReq > tCap && !t.varargs) {
        return failMsg(s, t, "a fun\u00e7\u00e3o exige " + sReq + " par\u00e2metro(s), mas o alvo declara " + tCap);
      }
      const n = Math.min((s.params || []).length, (t.params || []).length);
      for (let i = 0; i < n; i++) {
        const r = assignCheck(safeType(t.params[i].type), safeType(s.params[i].type), depth + 1);                  
        if (r !== null) return failMsg(s, t, "par\u00e2metro " + (i + 1) + ": " + r);
      }
      const sr = s.returns || [];
      const tr = t.returns || [];
      for (let i = 0; i < tr.length; i++) {
        const want = safeType(tr[i]);
        if (i >= sr.length) {
          if (isNilable(want) || want.kind === "nil") continue;
          return failMsg(s, t, "retorno " + (i + 1) + " ausente (esperado " + fmt(want, 0) + ")");
        }
        const r = assignCheck(safeType(sr[i]), want, depth + 1);              
        if (r !== null) return failMsg(s, t, "retorno " + (i + 1) + ": " + r);
      }
      return null;
    }
    default:
      return failMsg(s, t, null);
  }
}


export function unify(a, b) {
  try {
    const x = safeType(a);
    const y = safeType(b);
    if (x === y || typeKey(x) === typeKey(y)) return x;
    if (x.kind === "any" || y.kind === "any") return ANY;
    if (x.kind === "never") return y;
    if (y.kind === "never") return x;
    if (x.kind === "unknown" || y.kind === "unknown") return UNKNOWN;
    if (x.kind === y.kind && (x.kind === "boolean" || x.kind === "number" || x.kind === "string")) {
      if (x.literal === undefined) return x;
      if (y.literal === undefined) return y;
      return x.kind === "boolean" ? BOOLEAN : (x.kind === "number" ? NUMBER : STRING);
    }
    if (x.kind === "class" && y.kind === "class") {
      const anc = commonClassAncestor(x.className, y.className);
      if (anc) return classType(anc);
    }
    return unionType([x, y]);
  } catch (e) {
    return ANY;
  }
}


const EMPTY_CTX = freeze({ aliases: freeze({}) });




export function typeFromApiTypeName(name) {
  try {
    if (name == null) return null;
    const raw = String(name).trim();
    if (!raw || raw === "void" || raw === "()") return null;
    return parseTypeAnnotation(raw, EMPTY_CTX).type;                          
  } catch (e) {
    return ANY;
  }
}

function signalType() {
  if (getDatatype("RBXScriptSignal")) return datatypeType("RBXScriptSignal");
  const cls = resolveClassName("RBXScriptSignal");
  if (cls) return classType(cls);
  return datatypeType("RBXScriptSignal");
}

export function typeOfApiMember(className, memberName) {
  try {
    const hit = findMember(className, memberName);
    if (!hit) return null;
    const m = hit.member;
    const kind = hit.kind;
    if (kind === "Property") {
      return { type: typeFromApiTypeName(m.valueType) || ANY, kind };
    }
    if (kind === "Method" || kind === "Callback") {
      const params = [];
      let varargs = null;
      for (const p of m.parameters || []) {
        const pt = typeFromApiTypeName(p.type) || ANY;
        if (p.name === "..." || /^\.\.\./.test(String(p.name || ""))) {
          varargs = pt;
          continue;
        }
        params.push({ name: p.name || null, type: pt, optional: !!p.optional });
      }
      const ret = m.returnType == null || m.returnType === "void" ? null : typeFromApiTypeName(m.returnType);
      return {
        type: functionType({ params, varargs, returns: ret ? [ret] : [], selfParam: kind === "Method" }),
        kind,
      };
    }
    if (kind === "Event") {
      return { type: signalType(), kind };
    }
    return { type: ANY, kind };
  } catch (e) {
    return null;
  }
}


export function narrowTruthy(t) {
  const v = safeType(t);
  switch (v.kind) {
    case "nil":
      return NEVER;
    case "boolean":
      return v.literal === undefined ? TRUE_LITERAL : (v.literal ? v : NEVER);
    case "union":
      return unionType((v.options || []).map(narrowTruthy));
    default:
      return v;                                                                   
  }
}

export function narrowFalsy(t) {
  const v = safeType(t);
  switch (v.kind) {
    case "nil":
      return v;
    case "boolean":
      return v.literal === undefined ? FALSE_LITERAL : (v.literal ? NEVER : v);
    case "union":
      return unionType((v.options || []).map(narrowFalsy));
    case "any":
    case "unknown":
      return unionType([NIL, FALSE_LITERAL]);
    default:
      return NEVER;                                                                           
  }
}


function typeofTag(v) {
  switch (v.kind) {
    case "nil": return "nil";
    case "boolean": return "boolean";
    case "number": return "number";
    case "string": return "string";
    case "thread": return "thread";
    case "buffer": return "buffer";
    case "function": return "function";
    case "table":
    case "array": return "table";
    case "datatype": return v.name || "userdata";
    case "class": return "Instance";
    case "enum": return "Enum";
    case "enumItem": return "EnumItem";
    default: return null;                                    
  }
}

const TYPEOF_FALLBACK = {
  nil: NIL,
  boolean: BOOLEAN,
  number: NUMBER,
  string: STRING,
  thread: THREAD,
  buffer: BUFFER,
  function: FN_ANY,
  table: EMPTY_TABLE,
  Instance: classType("Instance"),
  userdata: ANY,
};

export function narrowByTypeof(t, s) {
  let tag = String(s == null ? "" : s);
  if (tag === "vector") tag = "Vector3";                                           
  const v = safeType(t);
  if (v.kind === "union") {
    return unionType((v.options || []).map((o) => narrowByTypeof(o, tag)));
  }
  if (v.kind === "any" || v.kind === "unknown") {
    if (hasOwn(TYPEOF_FALLBACK, tag)) return TYPEOF_FALLBACK[tag];
    if (getDatatype(tag)) return datatypeType(tag);                            
    return v;
  }
  const mine = typeofTag(v);
  if (mine === null) return v;
  return mine === tag ? v : NEVER;
}

export function narrowByIsA(t, className) {
  const targetName = resolveClassName(className) || String(className == null ? "" : className);
  const v = safeType(t);
  if (v.kind === "union") {
    return unionType((v.options || []).map((o) => narrowByIsA(o, targetName)));
  }
  if (v.kind === "any" || v.kind === "unknown") return classType(targetName);
  if (v.kind === "class") {
    if (classInherits(v.className, targetName)) return v;                        
    if (classInherits(targetName, v.className)) return classType(targetName);           
    return NEVER;
  }
  return NEVER;                              
}
