import { bytesToBase64, base64ToBytes } from "./rbxBlobs.js";

export const RBX_UNKNOWN_VERSION = "interop-unknown-1";


export const RBX_UNKNOWN_RESIDUES_VERSION = "interop-unknown-2";


export const RBX_UNKNOWN_PERSIST_VERSION = "interop-unknown-3";


export const RBX_UNKNOWN_DYNAMIC_VERSION = "interop-unknown-4";


export const RBX_UNKNOWN_MODEL_VERSION = "interop-unknown-5";

export const RBX_UNKNOWN_LIMITS = Object.freeze({

  maxBlobBytes: 256 * 1024,

  maxRecordsPerInstance: 16,
  maxBytesPerInstance: 1024 * 1024,

  maxRecordsPerFile: 512,


  maxFileChunks: 8,

  maxBagProps: 128,
  maxBagDepth: 6,
  maxBagTextLen: 1024 * 1024,

  maxNameLen: 1024,
});


export const UNKNOWN_PROP_PREFIX = "RSWU1:";

const NAME_RE = /^RSWU1:([0-9a-fA-F]{1,2}):(\d{1,10}):([\s\S]+)$/;
const TAG_RE = /^[A-Za-z_][\w.-]*$/;
const ATTR_RE = /^[A-Za-z_][\w:.-]*$/;

function xmlEscape(s) {
  return String(s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}


function b64ByteLen(b64) {
  const s = String(b64 == null ? "" : b64).replace(/\s+/g, "");
  if (s === "") return 0;
  const paddingLength = s.endsWith("==") ? 2 : s.endsWith("=") ? 1 : 0;
  return Math.floor((s.length * 3) / 4) - paddingLength;
}


export function captureUnknownProp(input) {
  const propName = String(input && input.propName != null ? input.propName : "");
  const typeId = input ? Number(input.typeId) : NaN;
  const count = input ? Number(input.count) : NaN;
  const bytes = input && input.bytes instanceof Uint8Array ? input.bytes : null;
  if (!propName || propName.length > RBX_UNKNOWN_LIMITS.maxNameLen) return null;
  if (propName.indexOf(":") !== -1) return null;
  if (!Number.isInteger(typeId) || typeId < 0 || typeId > 0xff) return null;
  if (!Number.isInteger(count) || count < 0 || count > 0xffffffff) return null;
  if (!bytes || bytes.length > RBX_UNKNOWN_LIMITS.maxBlobBytes) return null;
  return { propName, typeId, count, b64: bytesToBase64(bytes) };
}


export function unknownPropName(rec) {
  return UNKNOWN_PROP_PREFIX + rec.typeId.toString(16) + ":" + rec.count + ":" + rec.propName;
}

export function isUnknownPropName(name) {
  return typeof name === "string" && name.length > UNKNOWN_PROP_PREFIX.length &&
    name.startsWith(UNKNOWN_PROP_PREFIX);
}


export function parseUnknownPropName(name) {
  if (!isUnknownPropName(name)) return null;
  const m = NAME_RE.exec(name);
  if (!m) return null;
  const typeId = parseInt(m[1], 16);
  const count = parseInt(m[2], 10);
  if (!Number.isInteger(typeId) || typeId < 0 || typeId > 0xff) return null;
  if (!Number.isInteger(count) || count < 0 || count > 0xffffffff) return null;
  if (m[3].length > RBX_UNKNOWN_LIMITS.maxNameLen) return null;
  return { typeId, count, propName: m[3] };
}


export function unknownPropFromXml(name, b64) {
  const head = parseUnknownPropName(name);
  if (!head) return null;
  const clean = String(b64 == null ? "" : b64).replace(/\s+/g, "");
  if (clean === "") return { propName: head.propName, typeId: head.typeId, count: head.count, b64: "" };
  const bytes = base64ToBytes(clean, RBX_UNKNOWN_LIMITS.maxBlobBytes);
  if (!bytes) return null;
  return { propName: head.propName, typeId: head.typeId, count: head.count, b64: clean };
}


export function unknownPropFromScanned(name, b64) {
  const head = parseUnknownPropName(name);
  if (!head) return null;
  const clean = String(b64 == null ? "" : b64).replace(/\s+/g, "");
  if (clean === "") return { propName: head.propName, typeId: head.typeId, count: head.count, bytes: new Uint8Array(0) };
  const bytes = base64ToBytes(clean, RBX_UNKNOWN_LIMITS.maxBlobBytes);
  if (!bytes) return null;
  return { propName: head.propName, typeId: head.typeId, count: head.count, bytes };
}


export function opaqueToXml(rec) {
  return `<BinaryString name="${xmlEscape(unknownPropName(rec))}">${rec.b64}</BinaryString>`;
}


export function attachOpaqueProp(inst, rec) {
  if (!inst || !rec || typeof rec.b64 !== "string") return false;
  if (b64ByteLen(rec.b64) > RBX_UNKNOWN_LIMITS.maxBlobBytes) return false;
  if (!(inst._rbxUnknownProps instanceof Map)) {
    try { inst._rbxUnknownProps = new Map(); } catch (_) { return false; }
    if (!(inst._rbxUnknownProps instanceof Map)) return false;
  }
  const map = inst._rbxUnknownProps;
  const key = unknownPropName(rec);
  if (map.has(key)) return false;
  if (map.size >= RBX_UNKNOWN_LIMITS.maxRecordsPerInstance) return false;
  let total = b64ByteLen(rec.b64);
  for (const r of map.values()) total += b64ByteLen(r.b64);
  if (total > RBX_UNKNOWN_LIMITS.maxBytesPerInstance) return false;
  map.set(key, rec);
  return true;
}

export function readOpaqueProps(inst) {
  const map = inst && inst._rbxUnknownProps;
  if (!(map instanceof Map)) return [];
  return [...map.values()];
}









export function captureXmlPropElement(el, depth) {
  const d = depth == null ? 1 : depth;
  if (!el || d > RBX_UNKNOWN_LIMITS.maxBagDepth) return null;
  const tag = String(el.tagName || "");
  if (!TAG_RE.test(tag)) return null;
  const attrs = {};
  try {
    if (el.attributes && typeof el.attributes.length === "number") {
      for (let i = 0; i < el.attributes.length; i++) {
        const a = el.attributes[i];
        if (a && a.name != null) attrs[String(a.name)] = String(a.value == null ? "" : a.value);
      }
    } else if (el.attrs && typeof el.attrs === "object") {
      for (const k of Object.keys(el.attrs)) attrs[k] = String(el.attrs[k]);
    }
  } catch (_) {                                              }
  const kids = [];
  try {
    for (const ch of el.children || []) {
      const sub = captureXmlPropElement(ch, d + 1);
      if (sub) kids.push(sub);
      if (kids.length >= 64) break;
    }
  } catch (_) {                                        }
  if (kids.length > 0) return { tag, attrs, children: kids };
  let text = "";
  try { text = String(el.textContent == null ? "" : el.textContent); } catch (_) { text = ""; }
  if (text.length > RBX_UNKNOWN_LIMITS.maxBagTextLen) text = text.slice(0, RBX_UNKNOWN_LIMITS.maxBagTextLen);
  return { tag, attrs, text };
}


export function captureUnknownClass(className, propRecords) {
  const cls = String(className == null ? "" : className).slice(0, RBX_UNKNOWN_LIMITS.maxNameLen);
  const props = [];
  for (const rec of Array.isArray(propRecords) ? propRecords : []) {
    if (!rec || typeof rec.tag !== "string") continue;
    props.push(rec);
    if (props.length >= RBX_UNKNOWN_LIMITS.maxBagProps) break;
  }
  return { className: cls || "Folder", props };
}

export function attachUnknownClass(inst, rec) {
  if (!inst || !rec || typeof rec.className !== "string" || !rec.className) return false;
  try { inst._rbxUnknownClass = rec; } catch (_) { return false; }
  return true;
}

export function readUnknownClass(inst) {
  const rec = inst && inst._rbxUnknownClass;
  if (!rec || typeof rec.className !== "string" || !rec.className) return null;
  return { className: rec.className, props: Array.isArray(rec.props) ? rec.props : [] };
}


export function bagPropToXml(node) {
  return serializeNode(node, 1);
}

function serializeNode(node, depth) {
  if (!node || depth > RBX_UNKNOWN_LIMITS.maxBagDepth) return "";
  const tag = String(node.tag || "");
  if (!TAG_RE.test(tag)) return "";
  let attrs = "";
  const src = node.attrs && typeof node.attrs === "object" ? node.attrs : {};
  for (const k of Object.keys(src)) {
    if (!ATTR_RE.test(k)) continue;
    attrs += ` ${k}="${xmlEscape(src[k])}"`;
  }
  if (Array.isArray(node.children) && node.children.length > 0) {
    let inner = "";
    for (const ch of node.children) inner += serializeNode(ch, depth + 1);
    return `<${tag}${attrs}>${inner}</${tag}>`;
  }
  return `<${tag}${attrs}>${xmlEscape(node.text == null ? "" : node.text)}</${tag}>`;
}


export function captureUnknownChunk(input) {
  const name = input && typeof input.name === "string" ? input.name : "";
  const bytes = input && input.bytes instanceof Uint8Array ? input.bytes : null;
  if (name.length !== 4) return null;
  for (let i = 0; i < 4; i++) if (name.charCodeAt(i) > 0xff) return null;
  if (!bytes || bytes.length > RBX_UNKNOWN_LIMITS.maxBlobBytes) return null;
  return { name, b64: bytesToBase64(bytes) };
}


export function unknownChunkToBytes(rec) {
  if (!rec || typeof rec.name !== "string" || rec.name.length !== 4) return null;
  for (let i = 0; i < 4; i++) if (rec.name.charCodeAt(i) > 0xff) return null;
  if (typeof rec.b64 !== "string") return null;
  if (rec.b64 === "") return { name: rec.name, bytes: new Uint8Array(0) };
  const bytes = base64ToBytes(rec.b64, RBX_UNKNOWN_LIMITS.maxBlobBytes);
  return bytes ? { name: rec.name, bytes } : null;
}


export function unknownChunkLabel(rec) {
  const name = rec && typeof rec.name === "string" ? rec.name : "";
  if (/^[\x21-\x7e]{4}$/.test(name)) return name;
  let hex = "0x";
  for (let i = 0; i < name.length && i < 4; i++) {
    hex += name.charCodeAt(i).toString(16).padStart(2, "0");
  }
  return hex;
}









export function captureBagRef(propName) {
  const name = String(propName == null ? "" : propName);
  if (!name || name.length > RBX_UNKNOWN_LIMITS.maxNameLen) return null;
  return { tag: "Ref", attrs: { name }, text: "null", refTarget: null };
}

export function isBagRef(node) {
  return !!node && node.tag === "Ref" && !!node.attrs && typeof node.attrs.name === "string";
}


export function snapshotOpaqueProps(inst) {
  const map = inst && inst._rbxUnknownProps;
  return map instanceof Map ? new Map(map) : null;
}

export function restoreOpaqueProps(inst, snap) {
  if (!inst) return false;
  try {
    if (snap instanceof Map) inst._rbxUnknownProps = new Map(snap);
    else if (inst._rbxUnknownProps instanceof Map) inst._rbxUnknownProps.clear();
  } catch (_) {
    return false;
  }
  return true;
}


export function bagNodeToJson(node, refIdOf, depth) {
  const d = depth == null ? 1 : depth;
  if (!node || typeof node.tag !== "string" || d > RBX_UNKNOWN_LIMITS.maxBagDepth) return null;
  if (!TAG_RE.test(node.tag)) return null;
  const out = { tag: node.tag, attrs: {} };
  const src = node.attrs && typeof node.attrs === "object" ? node.attrs : {};
  for (const k of Object.keys(src)) {
    if (!ATTR_RE.test(k)) continue;
    out.attrs[k] = String(src[k] == null ? "" : src[k]);
  }
  if (isBagRef(node)) {
    out.text = "null";
    const id = node.refTarget && typeof refIdOf === "function" ? refIdOf(node.refTarget) : null;
    if (typeof id === "string" && id) out.ref = id;
    return out;
  }
  if (Array.isArray(node.children) && node.children.length > 0) {
    const kids = [];
    for (const ch of node.children) {
      const sub = bagNodeToJson(ch, refIdOf, d + 1);
      if (sub) kids.push(sub);
      if (kids.length >= 64) break;
    }
    if (kids.length > 0) {
      out.children = kids;
      return out;
    }
  }
  let text = String(node.text == null ? "" : node.text);
  if (text.length > RBX_UNKNOWN_LIMITS.maxBagTextLen) text = text.slice(0, RBX_UNKNOWN_LIMITS.maxBagTextLen);
  out.text = text;
  return out;
}


const _DPT = Object.freeze({ String: "String", Number: "Number", Boolean: "Boolean", Color: "Color", Vector3: "Vector3" });
const _DYN_NUM_TAGS = new Set(["float", "double", "int", "int64"]);
const _CHILD_TEXT = (parent, tag) => {
  if (!parent || !Array.isArray(parent.children)) return null;
  const ch = parent.children.find((c) => c && c.tag === tag);
  return ch ? String(ch.text == null ? "" : ch.text).trim() : null;
};
const _parseNum = (s) => {
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};
const _to255 = (v) => Math.max(0, Math.min(255, Math.round(v * 255)));
const _fmtDynNum = (n, integer) => {
  if (!Number.isFinite(n)) return "0";
  if (integer) return String(Math.round(n));
  return String(Math.round(n * 1e6) / 1e6);
};

export function decodeBagNodeToDynamicProp(node) {
  if (!node || typeof node !== "object") return null;
  const name = node.attrs && typeof node.attrs.name === "string" ? node.attrs.name : "";
  if (!name || name.length > RBX_UNKNOWN_LIMITS.maxNameLen) return null;
  if (isUnknownPropName(name)) return null;                                    
  const tag = node.tag || "";


  if (tag === "Vector3") {
    const x = _parseNum(_CHILD_TEXT(node, "X"));
    const y = _parseNum(_CHILD_TEXT(node, "Y"));
    const z = _parseNum(_CHILD_TEXT(node, "Z"));
    if (x == null || y == null || z == null) return null;
    return { name, type: _DPT.Vector3, value: { x, y, z }, xmlTag: "Vector3" };
  }


  if (tag === "Color3") {
    const r = _parseNum(_CHILD_TEXT(node, "R"));
    const g = _parseNum(_CHILD_TEXT(node, "G"));
    const b = _parseNum(_CHILD_TEXT(node, "B"));
    if (r == null || g == null || b == null) return null;
    return { name, type: _DPT.Color, value: { r: Math.max(0, Math.min(1, r)), g: Math.max(0, Math.min(1, g)), b: Math.max(0, Math.min(1, b)) }, xmlTag: "Color3" };
  }


  if (Array.isArray(node.children) && node.children.length > 0) return null;
  const text = String(node.text == null ? "" : node.text);

  if (tag === "string") return { name, type: _DPT.String, value: text, xmlTag: "string" };

  if (tag === "bool") {
    if (text !== "true" && text !== "false") return null;
    return { name, type: _DPT.Boolean, value: text === "true", xmlTag: "bool" };
  }

  if (tag === "Color3uint8") {
    const u = parseInt(text, 10);
    if (!Number.isFinite(u)) return null;
    return {
      name,
      type: _DPT.Color,
      value: { r: ((u >> 16) & 0xff) / 255, g: ((u >> 8) & 0xff) / 255, b: (u & 0xff) / 255 },
      xmlTag: "Color3uint8",
    };
  }

  if (_DYN_NUM_TAGS.has(tag)) {
    const n = _parseNum(text);
    if (n == null) return null;

    if ((tag === "int" || tag === "int64") && !Number.isSafeInteger(n)) return null;
    return { name, type: _DPT.Number, value: n, xmlTag: tag };
  }

  return null;                                                            
}


export function dynamicPropToBagNode(dp) {
  if (!dp || typeof dp.name !== "string" || !dp.name) return null;
  const attrs = { name: dp.name };
  const xmlTag = typeof dp.xmlTag === "string" && dp.xmlTag ? dp.xmlTag : null;

  if (dp.type === _DPT.Vector3) {
    const v = dp.value || {};
    return {
      tag: xmlTag || "Vector3",
      attrs,
      children: [
        { tag: "X", attrs: {}, text: _fmtDynNum(v.x, false) },
        { tag: "Y", attrs: {}, text: _fmtDynNum(v.y, false) },
        { tag: "Z", attrs: {}, text: _fmtDynNum(v.z, false) },
      ],
    };
  }

  if (dp.type === _DPT.Color) {
    const c = dp.value || {};
    if (xmlTag === "Color3uint8") {
      const u = (((_to255(c.r)) << 16) | ((_to255(c.g)) << 8) | _to255(c.b)) >>> 0;
      return { tag: "Color3uint8", attrs, text: String(u) };
    }

    return {
      tag: "Color3",
      attrs,
      children: [
        { tag: "R", attrs: {}, text: _fmtDynNum(c.r, false) },
        { tag: "G", attrs: {}, text: _fmtDynNum(c.g, false) },
        { tag: "B", attrs: {}, text: _fmtDynNum(c.b, false) },
      ],
    };
  }

  if (dp.type === _DPT.Boolean) {
    return { tag: xmlTag || "bool", attrs, text: dp.value ? "true" : "false" };
  }

  if (dp.type === _DPT.Number) {
    const isInt = xmlTag === "int" || xmlTag === "int64";
    return { tag: xmlTag || "double", attrs, text: _fmtDynNum(dp.value, isInt) };
  }

  if (dp.type === _DPT.String) {
    return { tag: xmlTag || "string", attrs, text: String(dp.value == null ? "" : dp.value) };
  }

  return null;
}

export function bagNodeFromJson(raw, depth) {
  const d = depth == null ? 1 : depth;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  if (d > RBX_UNKNOWN_LIMITS.maxBagDepth) return null;
  const tag = typeof raw.tag === "string" ? raw.tag : "";
  if (!TAG_RE.test(tag)) return null;
  const attrs = {};
  if (raw.attrs && typeof raw.attrs === "object" && !Array.isArray(raw.attrs)) {
    for (const k of Object.keys(raw.attrs)) {
      if (!ATTR_RE.test(k)) continue;
      const v = raw.attrs[k];
      attrs[k] = typeof v === "string" ? v : String(v == null ? "" : v);
    }
  }
  if (tag === "Ref" && typeof attrs.name === "string" && attrs.name) {
    const node = { tag: "Ref", attrs: { name: attrs.name }, text: "null", refTarget: null };
    if (typeof raw.ref === "string" && raw.ref && raw.ref.length <= 32) node.refId = raw.ref;
    return node;
  }
  if (Array.isArray(raw.children) && raw.children.length > 0) {
    const kids = [];
    for (const ch of raw.children) {
      const sub = bagNodeFromJson(ch, d + 1);
      if (sub) kids.push(sub);
      if (kids.length >= 64) break;
    }
    if (kids.length > 0) return { tag, attrs, children: kids };
  }
  let text = typeof raw.text === "string" ? raw.text : "";
  if (text.length > RBX_UNKNOWN_LIMITS.maxBagTextLen) text = text.slice(0, RBX_UNKNOWN_LIMITS.maxBagTextLen);
  return { tag, attrs, text };
}
