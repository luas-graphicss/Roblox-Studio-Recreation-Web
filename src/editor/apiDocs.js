import { API_CLASSES, CLASS_ALIASES } from "./apiClasses.js";
import {
  LUAU_GLOBALS, ROBLOX_GLOBAL_VALUES, LUAU_LIBRARIES, API_DATATYPES,
  SNIPPETS, DEPRECATED_GLOBAL_FIXES, DEPRECATED_MEMBER_FIXES,
} from "./apiGlobals.js";
import { Enums } from "../datamodel/types.js";

export {
  API_CLASSES, CLASS_ALIASES, LUAU_GLOBALS, ROBLOX_GLOBAL_VALUES,
  LUAU_LIBRARIES, API_DATATYPES, SNIPPETS,
  DEPRECATED_GLOBAL_FIXES, DEPRECATED_MEMBER_FIXES, Enums,
};


export const KNOWN_SERVICES = Object.freeze(
  Object.keys(API_CLASSES).filter((name) => API_CLASSES[name].service).sort(),
);


export function resolveClassName(name) {
  if (Object.prototype.hasOwnProperty.call(API_CLASSES, name)) return name;
  if (Object.prototype.hasOwnProperty.call(CLASS_ALIASES, name)) return CLASS_ALIASES[name];
  return null;
}

export function getClass(name) {
  const resolved = resolveClassName(name);
  return resolved ? API_CLASSES[resolved] : null;
}


const membersCache = new Map();


export function membersOf(className) {
  const resolved = resolveClassName(className);
  if (!resolved) return null;
  if (membersCache.has(resolved)) return membersCache.get(resolved);
  const all = new Map();
  const chain = [];
  let cur = resolved;
  let guard = 0;
  while (cur && API_CLASSES[cur] && guard++ < 32) {
    chain.unshift(cur);
    cur = API_CLASSES[cur].superclass;
  }
  for (const cls of chain) {
    const def = API_CLASSES[cls];
    for (const p of def.properties) all.set(p.name, { member: p, owner: cls, kind: "Property" });
    for (const mm of def.methods) all.set(mm.name, { member: mm, owner: cls, kind: "Method" });
    for (const e of def.events) all.set(e.name, { member: e, owner: cls, kind: "Event" });
    for (const cb of def.callbacks) all.set(cb.name, { member: cb, owner: cls, kind: "Callback" });
  }
  const result = { className: resolved, chain, all };
  membersCache.set(resolved, result);
  return result;
}


export function findMember(className, memberName) {
  const info = membersOf(className);
  if (!info) return null;
  return info.all.get(memberName) || null;
}


export function getDatatype(name) {
  return Object.prototype.hasOwnProperty.call(API_DATATYPES, name) ? API_DATATYPES[name] : null;
}
export function getDatatypeStatic(typeName, memberName) {
  const dt = getDatatype(typeName);
  if (!dt) return null;
  return dt.statics.find((s) => s.name === memberName) || null;
}
export function getDatatypeMember(typeName, memberName) {
  const dt = getDatatype(typeName);
  if (!dt) return null;
  return dt.members.find((s) => s.name === memberName) || null;
}
export function getGlobal(name) {
  return LUAU_GLOBALS.find((g) => g.name === name) ||
    ROBLOX_GLOBAL_VALUES.find((g) => g.name === name) || null;
}
export function getLibrary(name) {
  return Object.prototype.hasOwnProperty.call(LUAU_LIBRARIES, name) ? LUAU_LIBRARIES[name] : null;
}
export function getLibraryMember(libName, memberName) {
  const lib = getLibrary(libName);
  if (!lib) return null;
  return lib.members.find((mm) => mm.name === memberName) || null;
}


export function enumNames() {
  return Object.keys(Enums);
}
export function enumItems(name) {
  return Object.prototype.hasOwnProperty.call(Enums, name) ? Enums[name] : null;
}


export function buildKnownGlobalsSet() {
  const set = new Set();
  for (const g of LUAU_GLOBALS) set.add(g.name);
  for (const g of ROBLOX_GLOBAL_VALUES) set.add(g.name);
  for (const lib of Object.keys(LUAU_LIBRARIES)) set.add(lib);
  for (const dt of Object.keys(API_DATATYPES)) set.add(dt);
  set.add("Enum");
  return set;
}


export function sanitizeDoc(text) {
  return String(text == null ? "" : text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

export function formatParam(p) {
  let s = p.name + ": " + p.type;
  if (p.optional) s += "?";
  if (p.default !== undefined && p.default !== null) s += " = " + p.default;
  return s;
}


export function signatureLabel(member, ownerPrefix, separator) {
  const params = (member.parameters || []).map(formatParam).join(", ");
  const ret = member.returnType ? ": " + member.returnType : "";
  const prefix = ownerPrefix ? ownerPrefix + (separator || ":") : "";
  return prefix + member.name + "(" + params + ")" + ret;
}

function deprecatedNote(member) {
  return member.deprecated ? "\n\n\u26a0\ufe0f **Obsoleto.** Evite usar em código novo." : "";
}


export function memberMarkdown(entry, ownerName) {
  const member = entry.member || entry;
  const kind = entry.kind || member.kind || "Member";
  const owner = entry.owner || ownerName || "";
  const name = sanitizeDoc(member.name);
  const desc = sanitizeDoc(member.description || "");
  if (kind === "Property") {
    let head = "```luau\n" + (owner ? owner + "." : "") + member.name + ": " + member.valueType + "\n```";
    let meta = "**Propriedade**" + (member.readOnly ? " \u00b7 *somente leitura*" : "");
    return head + "\n\n" + meta + "\n\n" + desc + deprecatedNote(member);
  }
  if (kind === "Method" || kind === "Function") {
    const sep = kind === "Method" ? ":" : ".";
    let head = "```luau\n" + signatureLabel(member, owner, owner ? sep : "") + "\n```";
    let body = "**" + (kind === "Method" ? "M\u00e9todo" : "Fun\u00e7\u00e3o") + "**\n\n" + desc;
    if (member.overloads && member.overloads.length) {
      body += "\n\n*Overloads:*\n" + member.overloads.map((o) => "- `" + sanitizeDoc(o) + "`").join("\n");
    }
    return head + "\n\n" + body + deprecatedNote(member);
  }
  if (kind === "Event") {
    const params = (member.parameters || []).map(formatParam).join(", ");
    let head = "```luau\n" + (owner ? owner + "." : "") + member.name + ": RBXScriptSignal(" + params + ")\n```";
    return head + "\n\n**Evento** \u00b7 conecte com `:Connect(function(" + sanitizeDoc((member.parameters || []).map((p) => p.name).join(", ")) + ") ... end)`\n\n" + desc + deprecatedNote(member);
  }
  if (kind === "Callback") {
    const params = (member.parameters || []).map(formatParam).join(", ");
    let head = "```luau\n" + (owner ? owner + "." : "") + member.name + " = function(" + params + ")" + (member.returnType ? ": " + member.returnType : "") + "\n```";
    return head + "\n\n**Callback**\n\n" + desc + deprecatedNote(member);
  }
  return "**" + name + "**\n\n" + desc;
}


export function classMarkdown(name) {
  const resolved = resolveClassName(name);
  if (!resolved) return null;
  const def = API_CLASSES[resolved];
  let md = "```luau\n" + resolved + (def.superclass ? " : " + def.superclass : "") + "\n```";
  md += "\n\n**Classe**" + (def.service ? " \u00b7 *servi\u00e7o*" : "");
  if (def.superclass) md += " \u00b7 herda de `" + def.superclass + "`";
  md += "\n\n" + sanitizeDoc(def.description || "");
  if (def.deprecated) md += "\n\n\u26a0\ufe0f **Obsoleta.**";
  return md;
}


export function datatypeMarkdown(name) {
  const dt = getDatatype(name);
  if (!dt) return null;
  let md = "```luau\n" + name + "\n```\n\n**Tipo**\n\n" + sanitizeDoc(dt.description || "");
  const ctors = dt.statics.filter((s) => s.kind === "Function");
  if (ctors.length) {
    md += "\n\n*Construtores:*\n" + ctors.slice(0, 4).map((c) => "- `" + sanitizeDoc(signatureLabel(c, name, ".")) + "`").join("\n");
  }
  return md;
}


export function enumMarkdown(enumName, itemName) {
  const items = enumItems(enumName);
  if (!items) return null;
  if (itemName) {
    if (!items.includes(itemName)) return null;
    return "```luau\nEnum." + enumName + "." + itemName + "\n```\n\n**EnumItem** \u00b7 valor de `Enum." + sanitizeDoc(enumName) + "`";
  }
  const shown = items.slice(0, 12).map((it) => "- `" + sanitizeDoc(it) + "`").join("\n");
  const more = items.length > 12 ? "\n- *... e mais " + (items.length - 12) + "*" : "";
  return "```luau\nEnum." + enumName + "\n```\n\n**Enum** com " + items.length + " valores:\n" + shown + more;
}


export function localMarkdown(localEntry) {
  const type = localEntry.annotation || localEntry.inferredType || "any";
  let md = "```luau\nlocal " + localEntry.name + ": " + type + "\n```";
  md += "\n\n**Vari\u00e1vel local**" + (localEntry.isParam ? " \u00b7 *par\u00e2metro*" : "") + (localEntry.isFunction ? " \u00b7 *fun\u00e7\u00e3o*" : "");
  if (localEntry.valueLiteral != null && localEntry.valueLiteral !== "nil") {
    md += "\n\nValor: `" + sanitizeDoc(String(localEntry.valueLiteral).slice(0, 80)) + "`";
  }
  md += "\n\nDeclarada na linha " + localEntry.line + ".";
  return md;
}


export function classFromReturnType(returnType) {
  if (!returnType) return null;
  let t = String(returnType).trim();
  if (t.endsWith("?")) t = t.slice(0, -1);
  if (resolveClassName(t)) return resolveClassName(t);
  if (getDatatype(t)) return null;                                        
  return null;
}
