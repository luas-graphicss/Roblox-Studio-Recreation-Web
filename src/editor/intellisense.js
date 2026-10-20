import {
  API_CLASSES, KNOWN_SERVICES, SNIPPETS, LUAU_GLOBALS, ROBLOX_GLOBAL_VALUES,
  LUAU_LIBRARIES, API_DATATYPES, DEPRECATED_GLOBAL_FIXES, DEPRECATED_MEMBER_FIXES,
  resolveClassName, membersOf, findMember, getDatatype, getGlobal, getLibrary,
  getLibraryMember, enumNames, enumItems, buildKnownGlobalsSet, sanitizeDoc,
  formatParam, signatureLabel, memberMarkdown, classMarkdown, datatypeMarkdown,
  enumMarkdown, localMarkdown, classFromReturnType,
} from "./apiDocs.js";
import { analyzeLuau, LUAU_KEYWORDS } from "./luauAnalysis.js";


import * as luauAnalysisModule from "./luauAnalysis.js";
import { LUAU_LANGUAGE_ID } from "./luauLang.js";
import { settings } from "../config/settings.js";                                        
import { isDebugHoverPriority } from "../debugger/controller.js";            

const MARKER_OWNER = "luau-analysis";
const KNOWN_GLOBALS_SET = buildKnownGlobalsSet();
const MAX_REFERENCES = 500;                                       


const FALLBACK_TYPE_CODES = Object.freeze(["LUA017", "LUA018", "LUA019", "LUA020", "LUA021", "LUA022", "LUA023", "LUA024", "LUA025"]);
function typeDiagnosticCodesSet() {
  const raw = luauAnalysisModule.TYPE_DIAGNOSTIC_CODES;
  try {
    if (raw && typeof raw.has === "function") return raw;
    if (Array.isArray(raw)) return new Set(raw);
  } catch (_) {                 }
  return new Set(FALLBACK_TYPE_CODES);
}


export const DATAMODEL_METHODS = Object.freeze([
  { kind: "Method", name: "GetService", parameters: [{ name: "className", type: "string" }], returnType: "Instance", description: "Retorna o serviço com o nome dado, criando-o se necessário.", deprecated: false, overloads: null },
  { kind: "Method", name: "FindService", parameters: [{ name: "className", type: "string" }], returnType: "Instance?", description: "Retorna o serviço se ele já existir; caso contrário, nil.", deprecated: false, overloads: null },
  { kind: "Method", name: "IsLoaded", parameters: [], returnType: "boolean", description: "True se o jogo terminou de carregar.", deprecated: false, overloads: null },
  { kind: "Method", name: "BindToClose", parameters: [{ name: "callback", type: "function" }], returnType: "void", description: "Registra um callback executado antes do servidor encerrar.", deprecated: false, overloads: null },
]);

let monacoRef = null;
let registered = false;


const modelData = new WeakMap();

export function attachModel(model, opts = {}) {
  modelData.set(model, { getInstance: opts.getInstance || null, analysis: null });
}

export function detachModel(model) {
  modelData.delete(model);
  if (monacoRef && model && !model.isDisposed()) {
    monacoRef.editor.setModelMarkers(model, MARKER_OWNER, []);
  }
}

function recFor(model) {
  let rec = modelData.get(model);
  if (!rec) { rec = { getInstance: null, analysis: null }; modelData.set(model, rec); }
  return rec;
}


export function getAnalysis(model) {
  const rec = recFor(model);
  const version = model.getVersionId();
  const typeCheck = settings.get("luauTypeChecking") !== false;
  const mode = settings.get("luauStrictByDefault") ? "strict" : null;
  if (!rec.analysis || rec.analysis.version !== version ||
      rec.analysis.typeCheck !== typeCheck || rec.analysis.mode !== mode) {
    rec.analysis = {
      version,
      typeCheck,
      mode,
      result: analyzeLuau(model.getValue(), {
        knownGlobals: KNOWN_GLOBALS_SET,
        deprecatedGlobals: DEPRECATED_GLOBAL_FIXES,
        deprecatedMembers: DEPRECATED_MEMBER_FIXES,
        maxIssues: 200,
        typeCheck,                                                   
        mode,                                                          
      }),
    };
  }
  return rec.analysis.result;
}


function typeInfoOf(analysis) {
  const ti = analysis && analysis.typeInfo;
  return ti && typeof ti.typeOfChain === "function" ? ti : null;
}

function safeTypeOfChain(analysis, segments, line) {
  const ti = typeInfoOf(analysis);
  if (!ti || !Array.isArray(segments) || !segments.length) return null;
  try {
    return ti.typeOfChain(segments, line || 1) || null;
  } catch (_) {
    return null;                                                         
  }
}


function analysisMode(analysis) {
  if (!analysis) return null;
  const ti = analysis.typeInfo;
  const m = (ti && ti.mode) || analysis.mode || null;
  return typeof m === "string" && m ? m : null;
}


export function getAnalysisMode(model) {
  try {
    return analysisMode(getAnalysis(model));
  } catch (_) {
    return null;
  }
}


function splitNilable(t) {
  if (!t || t.kind !== "union" || !Array.isArray(t.options)) {
    return { inner: t || null, nilable: !!(t && (t.nilable || t.optional)) };
  }
  const isNil = (o) => !o || o.kind === "nil" || o.name === "nil";
  const rest = t.options.filter((o) => !isNil(o));
  const nilable = rest.length !== t.options.length;
  if (!rest.length) return { inner: null, nilable };
  if (rest.length === 1) return { inner: rest[0], nilable };
  return { inner: { ...t, options: rest }, nilable };
}


function typeTableFields(t) {
  const out = [];
  const src = t && (t.fields || t.props || t.properties);
  if (Array.isArray(src)) {
    for (const f of src) {
      if (f && typeof f.name === "string" && f.name) out.push({ name: f.name, type: f.type || f.valueType || null });
    }
  } else if (src && typeof src === "object") {
    for (const k of Object.keys(src)) {
      if (k) out.push({ name: k, type: src[k] });
    }
  }
  return out.slice(0, 200);                   
}


function localFormatType(t, depth) {
  const d = depth || 0;
  if (t == null) return "unknown";
  if (typeof t === "string") return t;
  if (d > 3) return "...";
  const kind = t.kind || null;
  if (kind === "union" && Array.isArray(t.options)) {
    const un = splitNilable(t);
    const base = un.inner ? localFormatType(un.inner, d + 1) : "nil";
    return un.nilable ? base + "?" : base;
  }
  if (kind === "array") return "{" + localFormatType(t.element || t.elementType, d + 1) + "}";
  if (kind === "table") {
    const fields = typeTableFields(t);
    const shown = fields.slice(0, 4).map((f) => f.name + ": " + localFormatType(f.type, d + 1));
    return "{ " + shown.join(", ") + (fields.length > 4 ? ", ..." : "") + " }";
  }
  if (kind === "function") {
    const params = Array.isArray(t.params || t.parameters) ? (t.params || t.parameters) : [];
    const ret = t.returns || t.returnType || null;
    return "(" + params.map((p) => (p && p.name ? p.name : "_") + (p && p.type ? ": " + localFormatType(p.type, d + 1) : "")).join(", ") + ")" + (ret ? " -> " + localFormatType(ret, d + 1) : "");
  }
  const name = t.className || t.name || null;
  if (typeof name === "string" && name) return name + (t.nilable || t.optional ? "?" : "");
  return "unknown";
}

function formatTypeLabel(analysis, t) {
  const ti = analysis && analysis.typeInfo;
  if (ti && typeof ti.formatType === "function") {
    try {
      const s = ti.formatType(t);
      if (typeof s === "string" && s) return s;
    } catch (_) {                             }
  }
  return localFormatType(t, 0);
}


function typeOriginLabel(t, entry) {
  const src = t && typeof (t.source || t.origin) === "string" ? String(t.source || t.origin) : null;
  if (src) {
    if (/annot|anota/i.test(src)) return "anotação";
    if (/api/i.test(src)) return "API";
    return "inferido";
  }
  if (entry && entry.annotation) return "anotação";
  return "inferido";
}


function typeToTarget(analysis, t, depth) {
  const d = depth || 0;
  if (!t || d > 4) return null;
  const un = splitNilable(t);
  const inner = un.inner;
  const nilable = un.nilable;
  if (!inner) return null;
  const kind = inner.kind || null;


  if (kind === "enum-root" || kind === "enum" || kind === "enum-item" || kind === "datatype-static" || kind === "lib" || kind === "datamodel") return null;
  if (kind === "class" || (!kind && inner.className)) {
    const cls = resolveClassName(String(inner.className || inner.name || "")) || null;
    if (!cls) return null;
    return { kind: "class", className: cls, inst: null, nilable };
  }
  if (kind === "datatype") {
    const name = String(inner.name || "");
    if (!getDatatype(name)) return null;
    return { kind: "datatype", name, nilable };
  }
  if (kind === "table") {
    const fields = typeTableFields(inner).map((f) => ({
      name: f.name,
      label: formatTypeLabel(analysis, f.type),
      isFunction: !!(f.type && f.type.kind === "function"),
    }));
    if (!fields.length) return null;
    return { kind: "type-table", fields, nilable };
  }
  if (kind === "array") {

    const elTarget = typeToTarget(analysis, inner.element || inner.elementType, d + 1);
    if (elTarget) elTarget.nilable = elTarget.nilable || nilable;
    return elTarget;
  }
  if (kind === "function") {
    return { kind: "type-function", fn: inner, label: formatTypeLabel(analysis, inner), nilable };
  }
  const prim = String(inner.name || inner.kind || "");
  if (prim === "string") return { kind: "lib-instance", name: "string", nilable };

  if (resolveClassName(prim)) return { kind: "class", className: resolveClassName(prim), inst: null, nilable };
  if (getDatatype(prim)) return { kind: "datatype", name: prim, nilable };
  return null;
}


let _typedResolveDepth = 0;
function resolveTypedChainTarget(model, segments, line) {
  if (_typedResolveDepth > 0) return null;
  const analysis = getAnalysis(model);
  const t = safeTypeOfChain(analysis, segments, line);
  if (!t) return null;
  const target = typeToTarget(analysis, t, 0);
  if (!target) return null;
  if (target.kind === "class") {

    _typedResolveDepth++;
    try {
      const h = resolveChainTargetHeuristic(model, segments);
      if (h && h.kind === "class" && h.inst) {
        target.inst = h.inst;
        if (target.className === "Instance" && h.className) target.className = h.className;
      }
    } finally {
      _typedResolveDepth--;
    }
  }
  return target;
}


export function analyzeAndMark(model) {
  if (!monacoRef || !model || model.isDisposed()) return [];
  const result = getAnalysis(model);
  const sev = monacoRef.MarkerSeverity;
  const markers = result.issues.map((it) => ({
    severity: it.severity === "error" ? sev.Error : it.severity === "warning" ? sev.Warning : sev.Info,
    message: it.message,
    startLineNumber: it.line, startColumn: it.column,
    endLineNumber: it.endLine, endColumn: it.endColumn,
    code: it.code, source: "Luau",                                                       
  }));
  monacoRef.editor.setModelMarkers(model, MARKER_OWNER, markers);
  return result.issues;
}


function safeChildren(inst) {
  try {
    if (!inst) return [];
    if (typeof inst.GetChildren === "function") return inst.GetChildren() || [];
    if (Array.isArray(inst.Children)) return inst.Children;
  } catch (err) {              }
  return [];
}
function childByName(inst, name) {
  try {
    if (!inst) return null;
    if (typeof inst.FindFirstChild === "function") {
      const c = inst.FindFirstChild(name);
      if (c) return c;
    }
    for (const c of safeChildren(inst)) {
      if (c && c.Name === name) return c;
    }
  } catch (err) {              }
  return null;
}
function rootOf(inst) {
  let cur = inst, guard = 0;
  try {
    while (cur && cur.Parent && guard++ < 200) cur = cur.Parent;
  } catch (err) { return null; }
  return cur;
}
function classNameOf(inst, fallback) {
  try { return (inst && inst.ClassName) || fallback || null; } catch (err) { return fallback || null; }
}


function parseChainBefore(text) {
  let i = text.length - 1;
  const trailing = text[i] === "." || text[i] === ":" ? text[i] : null;
  if (!trailing) return null;
  i--;
  const segments = [];
  let guard = 0;
  while (i >= 0 && guard++ < 24) {
    let call = false, args = null;
    if (text[i] === ")") {
      let depth = 0, j = i;
      while (j >= 0) {
        if (text[j] === ")") depth++;
        else if (text[j] === "(") { depth--; if (depth === 0) break; }
        j--;
      }
      if (j < 0) return null;
      args = text.slice(j + 1, i);
      call = true;
      i = j - 1;
    }
    let j = i;
    while (j >= 0 && /[A-Za-z0-9_]/.test(text[j])) j--;
    const name = text.slice(j + 1, i + 1);
    if (!name) return null;
    segments.unshift({ name, call, args, sep: null });
    const sepChar = j >= 0 ? text[j] : null;
    if (sepChar === "." || sepChar === ":") {
      segments[0].sep = sepChar;
      i = j - 1;
      continue;
    }
    break;
  }
  if (!segments.length || segments[0].sep !== null) return null;
  return { segments, trailing };
}

function stringArgOf(args) {
  if (!args) return null;



  const mm = /^\s*[\u0022\u0027]([^\u0022\u0027]+)[\u0022\u0027]\s*$/.exec(args);
  return mm ? mm[1] : null;
}


function inferLocalClass(model, entry, line) {
  const typed = resolveTypedChainTarget(model, [{ name: entry.name, call: false, args: null, sep: null }], line || entry.line);
  if (typed && (typed.kind === "class" || typed.kind === "datatype" || typed.kind === "lib-instance")) return typed;
  if (entry.annotation) {
    const cls = resolveClassName(entry.annotation.replace(/\?$/, ""));
    if (cls) return { kind: "class", className: cls };
    if (getDatatype(entry.annotation.replace(/\?$/, ""))) return { kind: "datatype", name: entry.annotation.replace(/\?$/, "") };
  }
  let lineText = "";
  try { lineText = model.getLineContent(entry.line); } catch (err) { return null; }
  let mm = new RegExp("\\b" + entry.name + "\\s*=\\s*game\\s*:\\s*GetService\\s*\\(\\s*[\"']([A-Za-z]+)[\"']").exec(lineText);
  if (mm && resolveClassName(mm[1])) return { kind: "class", className: resolveClassName(mm[1]) };
  mm = new RegExp("\\b" + entry.name + "\\s*=\\s*Instance\\.new\\s*\\(\\s*[\"']([A-Za-z]+)[\"']").exec(lineText);
  if (mm && resolveClassName(mm[1])) return { kind: "class", className: resolveClassName(mm[1]) };
  mm = new RegExp("\\b" + entry.name + "\\s*=\\s*([A-Za-z_][A-Za-z0-9_]*)\\.new\\s*\\(").exec(lineText);
  if (mm && getDatatype(mm[1])) return { kind: "datatype", name: mm[1] };
  if (entry.inferredType === "string") return { kind: "lib-instance", name: "string" };
  return null;
}


function resolveChainTarget(model, segments, line) {
  const typed = resolveTypedChainTarget(model, segments, line);
  if (typed) return typed;
  return resolveChainTargetHeuristic(model, segments);
}

function resolveChainTargetHeuristic(model, segments) {
  const rec = recFor(model);
  const scriptInst = rec.getInstance ? (function () { try { return rec.getInstance(); } catch (err) { return null; } })() : null;
  let target = null;
  for (let s = 0; s < segments.length; s++) {
    const seg = segments[s];
    if (s === 0) {
      if (seg.name === "game") { target = { kind: "datamodel", inst: scriptInst ? rootOf(scriptInst) : null }; continue; }
      if (seg.name === "workspace") {
        const root = scriptInst ? rootOf(scriptInst) : null;
        target = { kind: "class", className: "Workspace", inst: root ? childByName(root, "Workspace") : null };
        continue;
      }
      if (seg.name === "script") { target = { kind: "class", className: classNameOf(scriptInst, "Script") || "Script", inst: scriptInst }; continue; }
      if (seg.name === "Enum") { target = { kind: "enum-root" }; continue; }
      if (getDatatype(seg.name)) {
        target = seg.call ? { kind: "datatype", name: seg.name } : { kind: "datatype-static", name: seg.name };
        continue;
      }
      if (getLibrary(seg.name)) { target = { kind: "lib", name: seg.name }; continue; }

      const analysis = getAnalysis(model);
      const entry = analysis.locals.filter((l) => l.name === seg.name).pop() || null;
      if (entry) {
        const inferred = inferLocalClass(model, entry);
        if (inferred && inferred.kind === "class") { target = { kind: "class", className: inferred.className, inst: null }; continue; }
        if (inferred && inferred.kind === "datatype") { target = { kind: "datatype", name: inferred.name }; continue; }
        return null;
      }
      if (resolveClassName(seg.name) && API_CLASSES[resolveClassName(seg.name)].service) {
        target = { kind: "class", className: resolveClassName(seg.name), inst: null };
        continue;
      }
      return null;
    }
    if (!target) return null;
    if (target.kind === "enum-root") {
      target = enumItems(seg.name) ? { kind: "enum", name: seg.name } : null;
      continue;
    }
    if (target.kind === "enum") return null;
    if (target.kind === "lib" || target.kind === "lib-instance") return null;
    if (target.kind === "datatype-static") {
      target = seg.call && seg.name === "new" ? { kind: "datatype", name: target.name } : null;
      continue;
    }
    if (target.kind === "datatype") {
      const dt = getDatatype(target.name);
      const member = dt ? dt.members.find((mm) => mm.name === seg.name) : null;
      if (!member) return null;
      const vt = member.valueType || member.returnType;
      if (vt && getDatatype(String(vt).replace(/\?$/, ""))) { target = { kind: "datatype", name: String(vt).replace(/\?$/, "") }; continue; }
      const cls = classFromReturnType(vt);
      target = cls ? { kind: "class", className: cls, inst: null } : null;
      continue;
    }
    if (target.kind === "datamodel") {
      if (seg.call && seg.name === "GetService") {
        const svc = stringArgOf(seg.args);
        const cls = svc ? resolveClassName(svc) : null;
        target = { kind: "class", className: cls || "Instance", inst: target.inst && svc ? childByName(target.inst, svc) : null };
        continue;
      }
      if (!seg.call && resolveClassName(seg.name) && API_CLASSES[resolveClassName(seg.name)].service) {
        target = { kind: "class", className: resolveClassName(seg.name), inst: target.inst ? childByName(target.inst, seg.name) : null };
        continue;
      }

      target = resolveMemberStep({ kind: "class", className: "Instance", inst: target.inst }, seg);
      continue;
    }
    if (target.kind === "class") {
      target = resolveMemberStep(target, seg);
      continue;
    }
    return null;
  }
  return target;
}


function resolveMemberStep(target, seg) {
  const className = target.className;
  if (seg.call) {
    if (seg.name === "Clone") return { kind: "class", className, inst: null };
    if (seg.name === "FindFirstChild" || seg.name === "WaitForChild") {
      const childName = stringArgOf(seg.args);
      const child = target.inst && childName ? childByName(target.inst, childName) : null;
      return { kind: "class", className: classNameOf(child, "Instance") || "Instance", inst: child };
    }
    if (seg.name === "FindFirstChildOfClass" || seg.name === "FindFirstChildWhichIsA" || seg.name === "FindFirstAncestorOfClass" || seg.name === "FindFirstAncestorWhichIsA") {
      const cls = stringArgOf(seg.args);
      return { kind: "class", className: (cls && resolveClassName(cls)) || "Instance", inst: null };
    }
    const found = findMember(className, seg.name);
    if (found && (found.kind === "Method")) {
      const cls = classFromReturnType(found.member.returnType);
      if (cls) return { kind: "class", className: cls, inst: null };
      const vt = String(found.member.returnType || "").replace(/\?$/, "");
      if (getDatatype(vt)) return { kind: "datatype", name: vt };
      return null;
    }
    return null;
  }
  if (seg.name === "Parent") {
    let parent = null;
    try { parent = target.inst ? target.inst.Parent : null; } catch (err) { parent = null; }
    return { kind: "class", className: classNameOf(parent, "Instance") || "Instance", inst: parent };
  }
  const found = findMember(className, seg.name);
  if (found && found.kind === "Property") {
    const vt = String(found.member.valueType || "").replace(/\?$/, "");
    const cls = resolveClassName(vt);
    if (cls) return { kind: "class", className: cls, inst: null };
    if (getDatatype(vt)) return { kind: "datatype", name: vt };
    return null;
  }
  if (found) return null;

  const child = target.inst ? childByName(target.inst, seg.name) : null;
  if (child) return { kind: "class", className: classNameOf(child, "Instance") || "Instance", inst: child };
  return null;
}


function kindMap(monaco) {
  const K = monaco.languages.CompletionItemKind;
  return {
    Property: K.Field, Method: K.Method, Event: K.Event, Callback: K.Function,
    Function: K.Function, Keyword: K.Keyword, Variable: K.Variable,
    Class: K.Class, Enum: K.Enum, EnumItem: K.EnumMember, Constant: K.Constant,
    Snippet: K.Snippet, Module: K.Module, Child: K.Folder,
  };
}

function memberSuggestion(monaco, entry, range, owner) {
  const member = entry.member || entry;
  const kind = entry.kind || member.kind || "Property";
  const kinds = kindMap(monaco);
  let detail = "";
  let insertText = member.name;
  let insertRules = undefined;
  if (kind === "Property") detail = member.valueType + (member.readOnly ? " (somente leitura)" : "");
  else if (kind === "Method" || kind === "Function") {
    detail = signatureLabel(member, "", "");
    insertText = member.name + "($0)";
    insertRules = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
  } else if (kind === "Event") {
    detail = "RBXScriptSignal";
    insertText = member.name;
  } else if (kind === "Callback") detail = "callback";
  else if (kind === "Constant") detail = member.valueType || "";
  const sug = {
    label: member.name,
    kind: kinds[kind] || kinds.Property,
    detail,
    documentation: { value: memberMarkdown(entry, owner), isTrusted: false },
    insertText,
    sortText: (kind === "Property" ? "1" : kind === "Method" || kind === "Function" ? "2" : "3") + member.name,
    range,
  };
  if (insertRules !== undefined) sug.insertTextRules = insertRules;
  if (member.deprecated) sug.tags = [monaco.languages.CompletionItemTag.Deprecated];
  return sug;
}

function suggestionsForTarget(monaco, target, trailing, range) {
  const kinds = kindMap(monaco);
  const out = [];
  if (!target) return out;
  if (target.kind === "enum-root") {
    if (trailing !== ".") return out;
    for (const name of enumNames()) {
      out.push({
        label: name, kind: kinds.Enum, detail: "Enum",
        documentation: { value: enumMarkdown(name) || "", isTrusted: false },
        insertText: name, sortText: "1" + name, range,
      });
    }
    return out;
  }
  if (target.kind === "enum") {
    if (trailing !== ".") return out;
    for (const item of enumItems(target.name) || []) {
      out.push({
        label: item, kind: kinds.EnumItem, detail: "Enum." + target.name,
        documentation: { value: enumMarkdown(target.name, item) || "", isTrusted: false },
        insertText: item, sortText: "1" + item, range,
      });
    }
    return out;
  }
  if (target.kind === "lib" || target.kind === "lib-instance") {
    const lib = getLibrary(target.name);
    if (!lib) return out;
    for (const member of lib.members) {
      out.push(memberSuggestion(monaco, { member, kind: member.kind === "Property" ? "Constant" : "Function" }, range, target.name));
    }
    return out;
  }
  if (target.kind === "datatype-static") {
    const dt = getDatatype(target.name);
    if (!dt) return out;
    for (const st of dt.statics) {
      out.push(memberSuggestion(monaco, { member: st, kind: st.kind === "Property" ? "Constant" : "Function" }, range, target.name));
    }
    return out;
  }
  if (target.kind === "datatype") {
    const dt = getDatatype(target.name);
    if (!dt) return out;
    for (const member of dt.members) {
      if (trailing === ":" && member.kind !== "Method") continue;
      if (trailing === "." && member.kind === "Method") continue;
      out.push(memberSuggestion(monaco, { member, kind: member.kind === "Property" ? "Property" : member.kind }, range, target.name));
    }
    return out;
  }

  if (target.kind === "type-table") {
    for (const f of target.fields || []) {
      if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(f.name)) continue;
      if (trailing === ":" && !f.isFunction) continue;
      const sug = {
        label: f.name,
        kind: f.isFunction ? kinds.Function : kinds.Property,
        detail: sanitizeDoc(String(f.label || "campo")),
        documentation: { value: "Campo do tipo inferido da tabela (motor de tipos).", isTrusted: false },
        insertText: f.name,
        sortText: "0" + f.name,
        range,
      };
      if (f.isFunction) {
        sug.insertText = f.name + "($0)";
        sug.insertTextRules = monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet;
      }
      out.push(sug);
    }
    return out;
  }

  if (target.kind === "type-function") return out;
  if (target.kind === "datamodel") {
    if (trailing === ":") {
      for (const mm of DATAMODEL_METHODS) out.push(memberSuggestion(monaco, { member: mm, kind: "Method" }, range, "game"));
      const instInfo = membersOf("Instance");
      for (const [, entry] of instInfo.all) {
        if (entry.kind === "Method") out.push(memberSuggestion(monaco, entry, range, "game"));
      }
    } else {
      for (const svc of KNOWN_SERVICES) {
        out.push({
          label: svc, kind: kinds.Class, detail: "servi\u00e7o",
          documentation: { value: classMarkdown(svc) || "", isTrusted: false },
          insertText: svc, sortText: "0" + svc, range,
        });
      }
      const instInfo = membersOf("Instance");
      for (const [, entry] of instInfo.all) {
        if (entry.kind !== "Method") out.push(memberSuggestion(monaco, entry, range, "game"));
      }
    }
    return out;
  }
  if (target.kind === "class") {
    const info = membersOf(target.className);
    if (info) {
      for (const [, entry] of info.all) {
        if (trailing === ":" && entry.kind !== "Method") continue;
        if (trailing === "." && entry.kind === "Method") continue;
        out.push(memberSuggestion(monaco, entry, range, target.className));
      }
    }
    if (trailing === ".") {
      for (const child of safeChildren(target.inst).slice(0, 60)) {
        const childName = (child && child.Name) || "";
        if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(childName)) continue;
        out.push({
          label: childName, kind: kinds.Child, detail: classNameOf(child, "Instance"),
          documentation: { value: "Filho de `" + sanitizeDoc((target.inst && target.inst.Name) || "") + "` no DataModel.", isTrusted: false },
          insertText: childName, sortText: "0" + childName, range,
        });
      }
    }
    return out;
  }
  return out;
}

function wordSuggestions(monaco, model, position, range) {
  const kinds = kindMap(monaco);
  const out = [];

  for (const kw of LUAU_KEYWORDS) {
    out.push({ label: kw, kind: kinds.Keyword, detail: "keyword", insertText: kw, sortText: "3" + kw, range });
  }

  for (const g of LUAU_GLOBALS) {
    const sug = memberSuggestion(monaco, { member: g, kind: "Function" }, range, "");
    sug.sortText = "2" + g.name;
    out.push(sug);
  }
  for (const g of ROBLOX_GLOBAL_VALUES) {
    out.push({
      label: g.name, kind: kinds.Variable, detail: g.valueType || "global",
      documentation: { value: memberMarkdown({ member: g, kind: "Property" }, ""), isTrusted: false },
      insertText: g.name, sortText: "2" + g.name, range,
    });
  }

  for (const lib of Object.keys(LUAU_LIBRARIES)) {
    out.push({
      label: lib, kind: kinds.Module, detail: "biblioteca",
      documentation: { value: sanitizeDoc(LUAU_LIBRARIES[lib].description || ""), isTrusted: false },
      insertText: lib, sortText: "2" + lib, range,
    });
  }
  for (const dt of Object.keys(API_DATATYPES)) {
    out.push({
      label: dt, kind: kinds.Class, detail: "tipo",
      documentation: { value: datatypeMarkdown(dt) || "", isTrusted: false },
      insertText: dt, sortText: "2" + dt, range,
    });
  }
  out.push({ label: "Enum", kind: kinds.Enum, detail: "enums do Roblox", insertText: "Enum", sortText: "2Enum", range });

  const analysis = getAnalysis(model);
  const seen = new Set();
  for (const entry of analysis.locals) {
    if (entry.line > position.lineNumber) continue;
    if (seen.has(entry.name) || entry.name === "self") continue;
    seen.add(entry.name);
    out.push({
      label: entry.name,
      kind: entry.isFunction ? kinds.Function : kinds.Variable,
      detail: entry.annotation || entry.inferredType || "local",
      documentation: { value: localMarkdown(entry), isTrusted: false },
      insertText: entry.name, sortText: "0" + entry.name, range,
    });
  }

  for (const sn of SNIPPETS) {
    out.push({
      label: sn.label, kind: kinds.Snippet, detail: "snippet",
      documentation: { value: sanitizeDoc(sn.description || ""), isTrusted: false },
      insertText: sn.insertText,
      insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
      sortText: "4" + sn.label, range,
    });
  }
  return out;
}

function provideCompletions(monaco, model, position) {
  const word = model.getWordUntilPosition(position);
  const range = new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
  const before = model.getValueInRange(new monaco.Range(position.lineNumber, 1, position.lineNumber, word.startColumn));


  const svcMatch = /GetService\s*\(\s*([\u0022\u0027]?)$/.exec(before);
  if (svcMatch) {
    const hasQuote = !!svcMatch[1];
    return {
      suggestions: KNOWN_SERVICES.map((svc) => ({
        label: '"' + svc + '"',
        kind: monaco.languages.CompletionItemKind.Text,
        detail: "servi\u00e7o",
        documentation: { value: classMarkdown(svc) || "", isTrusted: false },
        insertText: hasQuote ? svc : '"' + svc + '"',
        sortText: "0" + svc,
        range,
      })),
    };
  }


  if (/:\s*Connect\s*\(\s*$/.test(before)) {
    return {
      suggestions: [{
        label: "function (callback)",
        kind: monaco.languages.CompletionItemKind.Snippet,
        detail: "fun\u00e7\u00e3o an\u00f4nima",
        documentation: { value: "O par\u00e2metro de `:Connect` \u00e9 uma fun\u00e7\u00e3o callback.", isTrusted: false },
        insertText: "function(${1})\n\t${0}\nend",
        insertTextRules: monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet,
        sortText: "0function",
        range,
      }],
    };
  }


  const chain = parseChainBefore(before);
  if (chain) {
    const target = resolveChainTarget(model, chain.segments, position.lineNumber);                               
    const suggestions = suggestionsForTarget(monaco, target, chain.trailing, range);
    if (target && target.nilable) {

      for (const s of suggestions) s.detail = (s.detail ? s.detail + " " : "") + "· base pode ser nil";
    }
    return { suggestions };
  }


  if (word.word.length === 0) return { suggestions: [] };
  return { suggestions: wordSuggestions(monaco, model, position, range) };
}


function hoverRange(monaco, position, word) {
  return new monaco.Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn);
}

let _apiCmdRegistered = false;            
function ensureApiBrowserCommand(monaco) {
  if (_apiCmdRegistered || !monaco || !monaco.editor || typeof monaco.editor.registerCommand !== "function") return;
  _apiCmdRegistered = true;
  try {
    monaco.editor.registerCommand("rsw.apiBrowser.open", (_accessor, args) => {
      window.dispatchEvent(new CustomEvent("rsw:apibrowser", { detail: args && typeof args === "object" ? args : {} }));
    });
  } catch (_) {

  }
}

function provideHover(monaco, model, position) {


  if (isDebugHoverPriority()) return null;
  const word = model.getWordAtPosition(position);
  if (!word) return null;
  const range = hoverRange(monaco, position, word);
  const before = model.getValueInRange(new monaco.Range(position.lineNumber, 1, position.lineNumber, word.startColumn));
  const name = word.word;
  ensureApiBrowserCommand(monaco);
  const md = (value, apiWord = name) => {
    const contents = [{ value, isTrusted: false }];
    if (apiWord) {
      const href = "command:rsw.apiBrowser.open?" + encodeURIComponent(JSON.stringify({ word: String(apiWord) }));
      contents.push({ value: "[View in API Browser](" + href + ")", isTrusted: true });
    }
    return { range, contents };
  };


  if (/[.:]\s*$/.test(before)) {
    const sep = before.trimEnd().slice(-1);
    const chain = parseChainBefore(before.trimEnd());
    if (chain) {
      const target = resolveChainTarget(model, chain.segments, position.lineNumber);             
      if (target) {
        if (target.kind === "enum-root") { const v = enumMarkdown(name); if (v) return md(v); }
        if (target.kind === "enum") { const v = enumMarkdown(target.name, name); if (v) return md(v); }
        if (target.kind === "lib" || target.kind === "lib-instance") {
          const member = getLibraryMember(target.name, name);
          if (member) return md(memberMarkdown({ member, kind: member.kind === "Property" ? "Constant" : "Function" }, target.name));
        }
        if (target.kind === "datatype-static") {
          const dt = getDatatype(target.name);
          const st = dt && dt.statics.find((s) => s.name === name);
          if (st) return md(memberMarkdown({ member: st, kind: st.kind === "Property" ? "Constant" : "Function" }, target.name));
        }
        if (target.kind === "datatype") {
          const dt = getDatatype(target.name);
          const member = dt && dt.members.find((s) => s.name === name);
          if (member) return md(memberMarkdown({ member, kind: member.kind }, target.name));
        }
        if (target.kind === "datamodel") {
          const dm = DATAMODEL_METHODS.find((mm) => mm.name === name);
          if (dm) return md(memberMarkdown({ member: dm, kind: "Method" }, "game"));
          if (resolveClassName(name) && API_CLASSES[resolveClassName(name)].service) return md(classMarkdown(name));
          const found = findMember("Instance", name);
          if (found) return md(memberMarkdown(found));
        }
        if (target.kind === "class") {
          const found = findMember(target.className, name);
          if (found) return md(memberMarkdown(found));
          const child = target.inst ? childByName(target.inst, name) : null;
          if (child) return md("```luau\n" + sanitizeDoc(name) + ": " + sanitizeDoc(classNameOf(child, "Instance")) + "\n```\n\nInst\u00e2ncia filha no DataModel.");
        }
      }


      const analysisTyped = getAnalysis(model);
      const typedMember = safeTypeOfChain(analysisTyped, chain.segments.concat([{ name, call: false, args: null, sep: sep === ":" ? ":" : "." }]), position.lineNumber);
      if (typedMember) {
        const modeTyped = analysisMode(analysisTyped);
        return md(
          "```luau\n" + sanitizeDoc(name) + ": " + sanitizeDoc(formatTypeLabel(analysisTyped, typedMember)) + "\n```\n\n" +
          "Origem: " + typeOriginLabel(typedMember, null) +
          (modeTyped ? " · modo do arquivo: `" + sanitizeDoc(modeTyped) + "`" : ""),
          null,
        );
      }
    }

    if (Object.prototype.hasOwnProperty.call(DEPRECATED_MEMBER_FIXES, name)) {
      return md("\u26a0\ufe0f `" + sanitizeDoc(name) + "` \u00e9 obsoleto. Use `" + sanitizeDoc(DEPRECATED_MEMBER_FIXES[name]) + "`.");
    }
    return null;
  }


  const analysis = getAnalysis(model);
  for (const entry of analysis.locals) {
    if (entry.name !== name) continue;
    const onDecl = entry.line === position.lineNumber && position.column >= entry.col && position.column <= entry.endCol;
    const onRef = entry.refs.some((r) => r.line === position.lineNumber && position.column >= r.col && position.column <= r.endCol);
    if (onDecl || onRef) {

      let extra = "";
      const typedLocal = safeTypeOfChain(analysis, [{ name: entry.name, call: false, args: null, sep: null }], position.lineNumber);
      if (typedLocal) {
        const un = splitNilable(typedLocal);
        extra += "\n\n---\n`" + sanitizeDoc(entry.name) + ": " + sanitizeDoc(formatTypeLabel(analysis, typedLocal)) + "`" +
          (un.nilable ? " *(pode ser nil)*" : "") + " — origem: " + typeOriginLabel(typedLocal, entry);
      }
      const modeLocal = analysisMode(analysis);
      if (modeLocal) extra += (extra ? " · " : "\n\n---\n") + "modo do arquivo: `" + sanitizeDoc(modeLocal) + "`";
      return md(localMarkdown(entry) + extra, null);
    }
  }

  const g = getGlobal(name);
  if (g) return md(memberMarkdown({ member: g, kind: g.kind === "Property" ? "Property" : "Function" }, ""));
  if (getLibrary(name)) return md("```luau\n" + name + "\n```\n\n**Biblioteca**\n\n" + sanitizeDoc(LUAU_LIBRARIES[name].description || ""));
  if (name === "Enum") return md("```luau\nEnum\n```\n\nNamespace com todos os enums do Roblox (" + enumNames().length + " dispon\u00edveis).");
  if (getDatatype(name)) return md(datatypeMarkdown(name));
  if (resolveClassName(name)) return md(classMarkdown(name));
  return null;
}


function findCallContext(model, position) {
  const startLine = Math.max(1, position.lineNumber - 6);
  const text = model.getValueInRange({
    startLineNumber: startLine, startColumn: 1,
    endLineNumber: position.lineNumber, endColumn: position.column,
  });
  let depth = 0;
  let commas = 0;
  let inStr = null;

  for (let i = text.length - 1; i >= 0; i--) {
    const ch = text[i];
    if (inStr) { if (ch === inStr && text[i - 1] !== "\\") inStr = null; continue; }
    if (ch === '"' || ch === "'") { inStr = ch; continue; }
    if (ch === ")" || ch === "]" || ch === "}") { depth++; continue; }
    if (ch === "[" || ch === "{") { if (depth > 0) depth--; continue; }
    if (ch === "(") {
      if (depth > 0) { depth--; continue; }
      const before = text.slice(0, i);
      const mm = /([A-Za-z_][A-Za-z0-9_]*(?:\s*[.:]\s*[A-Za-z_][A-Za-z0-9_]*)*)\s*$/.exec(before);
      if (!mm) return null;
      return { callee: mm[1].replace(/\s+/g, ""), activeParameter: commas, beforeCallee: before.slice(0, before.length - mm[0].length) };
    }
    if (ch === "," && depth === 0) commas++;
  }
  return null;
}

function signatureFromMember(member, ownerPrefix, separator) {
  const params = (member.parameters || []).map((p) => ({
    label: formatParam(p),
    documentation: { value: "`" + sanitizeDoc(p.type) + "`" + (p.optional ? " *(opcional)*" : ""), isTrusted: false },
  }));
  return {
    label: signatureLabel(member, ownerPrefix, separator),
    documentation: { value: sanitizeDoc(member.description || ""), isTrusted: false },
    parameters: params,
  };
}

function overloadSignatures(member) {
  const out = [];
  for (const o of member.overloads || []) {
    const inner = /\(([^)]*)\)/.exec(o);
    const params = inner && inner[1].trim().length
      ? inner[1].split(",").map((p) => ({ label: p.trim() }))
      : [];
    out.push({ label: o, documentation: { value: "", isTrusted: false }, parameters: params });
  }
  return out;
}


function typedSignatureHelp(model, position, ctx, parts, seps) {
  const analysis = getAnalysis(model);
  if (!typeInfoOf(analysis)) return null;
  const segments = parts.map((p, i) => ({ name: p, call: false, args: null, sep: i === 0 ? null : (seps[i - 1] || ".") }));
  const t = safeTypeOfChain(analysis, segments, position.lineNumber);
  const un = splitNilable(t || null);
  const fn = un.inner;
  if (!fn || fn.kind !== "function") return null;
  const params = Array.isArray(fn.params || fn.parameters) ? (fn.params || fn.parameters) : [];
  const badIndex = findIncompatibleArg(analysis, position.lineNumber, params.length);
  const sigParams = params.map((p, i) => {
    const pname = p && p.name ? String(p.name) : "arg" + (i + 1);
    const ptype = p && p.type ? formatTypeLabel(analysis, p.type) : null;
    let doc = ptype ? "`" + sanitizeDoc(ptype) + "`" + (p && p.optional ? " *(opcional)*" : "") : "";
    if (badIndex === i) doc = "Aviso: tipo do argumento não encaixa neste parâmetro." + (doc ? "\n\n" + doc : "");
    return { label: pname + (ptype ? ": " + sanitizeDoc(ptype) : ""), documentation: { value: doc, isTrusted: false } };
  });
  const label = sanitizeDoc(ctx.callee) + "(" + sigParams.map((p) => p.label).join(", ") + ")" +
    (fn.returns || fn.returnType ? " -> " + sanitizeDoc(formatTypeLabel(analysis, fn.returns || fn.returnType)) : "");
  const mode = analysisMode(analysis);
  const docLines = [];
  if (badIndex >= 0) docLines.push("Aviso: há diagnóstico de tipo (LUA017–LUA025) nesta chamada.");
  docLines.push(mode ? "Assinatura tipada — modo do arquivo: `" + sanitizeDoc(mode) + "`." : "Assinatura tipada (motor de tipos).");
  const active = Math.min(ctx.activeParameter, Math.max(0, sigParams.length - 1));
  return {
    value: {
      signatures: [{ label, documentation: { value: docLines.join("\n\n"), isTrusted: false }, parameters: sigParams }],
      activeSignature: 0,
      activeParameter: active,
    },
    dispose() {            },
  };
}



function findIncompatibleArg(analysis, line, paramCount) {
  const codes = typeDiagnosticCodesSet();
  for (const it of (analysis && analysis.issues) || []) {
    if (it.line !== line || !codes.has(String(it.code || ""))) continue;
    if (typeof it.paramIndex === "number" && it.paramIndex >= 0 && it.paramIndex < paramCount) return it.paramIndex;
    const mm = /argumento\s+(\d+)/i.exec(String(it.message || ""));
    if (mm) {
      const idx = Number(mm[1]) - 1;
      if (idx >= 0 && idx < paramCount) return idx;
    }
  }
  return -1;
}

function provideSignatureHelp(monaco, model, position) {
  const ctx = findCallContext(model, position);
  if (!ctx) return null;
  const parts = ctx.callee.split(/[.:]/);
  const seps = ctx.callee.match(/[.:]/g) || [];
  const fnName = parts[parts.length - 1];
  let member = null;
  let ownerPrefix = "";
  let separator = "";
  if (parts.length === 1) {
    member = getGlobal(fnName);
  } else {
    const baseChainText = ctx.beforeCallee + parts.slice(0, -1).map((p, idx) => p + (idx < seps.length - 1 ? seps[idx] : "")).join("") + seps[seps.length - 1];
    const chain = parseChainBefore(parts.slice(0, -1).join(".") + seps[seps.length - 1]);
    void baseChainText;
    if (parts.length === 2) {
      const base = parts[0];
      separator = seps[seps.length - 1] || ":";
      ownerPrefix = base;
      if (getLibrary(base)) member = getLibraryMember(base, fnName);
      else if (getDatatype(base)) {
        const dt = getDatatype(base);
        member = dt.statics.find((s) => s.name === fnName) || dt.members.find((s) => s.name === fnName);
      } else if (base === "game") {
        member = DATAMODEL_METHODS.find((mm) => mm.name === fnName) || (findMember("Instance", fnName) || {}).member || null;
      }
    }
    if (!member && chain) {
      const target = resolveChainTarget(model, chain.segments, position.lineNumber);             
      if (target && target.kind === "class") {
        const found = findMember(target.className, fnName);
        if (found && found.kind === "Method") { member = found.member; ownerPrefix = target.className; separator = ":"; }
      } else if (target && target.kind === "datamodel") {
        member = DATAMODEL_METHODS.find((mm) => mm.name === fnName) || null;
        ownerPrefix = "game"; separator = ":";
      } else if (target && (target.kind === "datatype" || target.kind === "datatype-static")) {
        const dt = getDatatype(target.name);
        member = (dt && (dt.statics.find((s) => s.name === fnName) || dt.members.find((s) => s.name === fnName))) || null;
        ownerPrefix = target.name; separator = ".";
      } else if (target && (target.kind === "lib" || target.kind === "lib-instance")) {
        member = getLibraryMember(target.name, fnName);
        ownerPrefix = target.name; separator = ".";
      }
    }
  }
  if (!member || !member.parameters) {


    return typedSignatureHelp(model, position, ctx, parts, seps);
  }
  const signatures = [signatureFromMember(member, ownerPrefix, separator)].concat(overloadSignatures(member));
  const active = Math.min(ctx.activeParameter, Math.max(0, (member.parameters || []).length - 1));
  return {
    value: { signatures, activeSignature: 0, activeParameter: active },
    dispose() {            },
  };
}


export function findLocalDefinition(model, position) {
  const word = model.getWordAtPosition(position);
  if (!word) return null;
  const analysis = getAnalysis(model);
  for (const entry of analysis.locals) {
    if (entry.name !== word.word) continue;
    const onDecl = entry.line === position.lineNumber && position.column >= entry.col && position.column <= entry.endCol;
    const onRef = entry.refs.some((r) => r.line === position.lineNumber && position.column >= r.col && position.column <= r.endCol);
    if (onDecl || onRef) {
      return { lineNumber: entry.line, column: entry.col, endColumn: entry.endCol, entry };
    }
  }
  return null;
}


export function resolveRequireTarget(model, position) {
  const rec = recFor(model);
  if (!rec.getInstance) return null;
  let scriptInst = null;
  try { scriptInst = rec.getInstance(); } catch (err) { return null; }
  if (!scriptInst) return null;
  const lineText = model.getLineContent(position.lineNumber);
  const re = /require\s*\(([^()]*)\)/g;
  let mm;
  while ((mm = re.exec(lineText)) !== null) {
    const start = mm.index + 1;
    const end = mm.index + mm[0].length;
    if (position.column < start || position.column > end + 1) continue;
    const arg = mm[1].trim();
    const path = arg.split(/[.:]/).map((p) => {
      const call = /^([A-Za-z_][A-Za-z0-9_]*)\s*\(\s*[\u0022\u0027]?([^\u0022\u0027)]*)[\u0022\u0027]?\s*$/.exec(p.trim());
      return call ? { name: call[1], arg: call[2] } : { name: p.replace(/\s+/g, ""), arg: null };
    });
    if (!path.length) return null;
    let cur = null;
    const root = rootOf(scriptInst);
    for (let idx = 0; idx < path.length; idx++) {
      const seg = path[idx];
      if (idx === 0) {
        if (seg.name === "script") cur = scriptInst;
        else if (seg.name === "game") cur = root;
        else if (seg.name === "workspace") cur = root ? childByName(root, "Workspace") : null;
        else return null;
        continue;
      }
      if (!cur) return null;
      if (seg.name === "Parent") {
        try { cur = cur.Parent || null; } catch (err) { cur = null; }
        continue;
      }
      if (seg.name === "GetService" || seg.name === "FindFirstChild" || seg.name === "WaitForChild") {
        cur = seg.arg ? childByName(cur, seg.arg) : null;
        continue;
      }
      cur = childByName(cur, seg.name);
    }
    if (cur && classNameOf(cur) === "ModuleScript") return cur;
    return null;
  }
  return null;
}

function provideDefinition(monaco, model, position) {
  const def = findLocalDefinition(model, position);
  if (!def) return null;
  return {
    uri: model.uri,
    range: new monaco.Range(def.lineNumber, def.column, def.lineNumber, def.endColumn),
  };
}

function provideReferences(monaco, model, position) {
  const word = model.getWordAtPosition(position);
  if (!word) return [];
  const def = findLocalDefinition(model, position);
  if (def && def.entry) {
    const locs = [{ line: def.entry.line, col: def.entry.col, endCol: def.entry.endCol }].concat(def.entry.refs);
    return locs.slice(0, MAX_REFERENCES).map((r) => ({
      uri: model.uri,
      range: new monaco.Range(r.line, r.col, r.line, r.endCol),
    }));
  }

  const matches = model.findMatches(word.word, false, false, true, " \t`~!@#$%^&*()-=+[{]}\\|;:'\",.<>/?", false, MAX_REFERENCES);
  return matches.map((m2) => ({ uri: model.uri, range: m2.range }));
}


function provideCodeActions(monaco, model, range, context) {
  const actions = [];
  const analysis = getAnalysis(model);
  for (const marker of context.markers || []) {
    const code = typeof marker.code === "object" && marker.code ? marker.code.value : marker.code;
    const it = analysis.issues.find((isu) =>
      isu.code === code && isu.line === marker.startLineNumber && isu.column === marker.startColumn && isu.fix);
    if (!it || !it.fix) continue;
    actions.push({
      title: it.fix.title,
      kind: "quickfix",
      diagnostics: [marker],
      isPreferred: true,
      edit: {
        edits: it.fix.edits.map((e) => ({
          resource: model.uri,
          versionId: model.getVersionId(),
          textEdit: {
            range: new monaco.Range(e.line, e.column, e.endLine, e.endColumn),
            text: e.newText,
          },
        })),
      },
    });
  }
  return { actions, dispose() {            } };
}


export function registerIntellisense(monaco) {
  if (registered || !monaco) return;
  registered = true;
  monacoRef = monaco;
  const lang = LUAU_LANGUAGE_ID;

  monaco.languages.registerCompletionItemProvider(lang, {
    triggerCharacters: [".", ":", "(", '"', "'"],
    provideCompletionItems(model, position) {
      try { return provideCompletions(monaco, model, position); }
      catch (err) { return { suggestions: [] }; }
    },
  });

  monaco.languages.registerHoverProvider(lang, {
    provideHover(model, position) {
      try { return provideHover(monaco, model, position); }
      catch (err) { return null; }
    },
  });

  monaco.languages.registerSignatureHelpProvider(lang, {
    signatureHelpTriggerCharacters: ["(", ","],
    signatureHelpRetriggerCharacters: [","],
    provideSignatureHelp(model, position) {
      try { return provideSignatureHelp(monaco, model, position); }
      catch (err) { return null; }
    },
  });

  monaco.languages.registerDefinitionProvider(lang, {
    provideDefinition(model, position) {
      try { return provideDefinition(monaco, model, position); }
      catch (err) { return null; }
    },
  });

  monaco.languages.registerReferenceProvider(lang, {
    provideReferences(model, position) {
      try { return provideReferences(monaco, model, position); }
      catch (err) { return []; }
    },
  });

  monaco.languages.registerCodeActionProvider(lang, {
    provideCodeActions(model, range, context) {
      try { return provideCodeActions(monaco, model, range, context); }
      catch (err) { return { actions: [], dispose() {            } }; }
    },
  });
}
