import { TERRAIN_MATERIALS } from "../terrain/materials.js";
import {
  SMOOTH_GRID_LIMITS,
  decodeSmoothGridBytes,
  encodeSmoothGridBytes,
} from "./rbxSmoothGrid.js";

const TE = new TextEncoder();
const TD = new TextDecoder("utf-8", { fatal: false });

export const MAX_BLOB_BYTES = 4 * 1024 * 1024;
export const MAX_SMOOTH_GRID_BYTES = SMOOTH_GRID_LIMITS.maxBytes;
export const MAX_SMOOTH_GRID_B64 = Math.ceil(MAX_SMOOTH_GRID_BYTES / 3) * 4 + 4;

const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
const B64_REV = (() => {
  const t = new Int16Array(128).fill(-1);
  for (let i = 0; i < 64; i++) t[B64.charCodeAt(i)] = i;
  return t;
})();

export function bytesToBase64(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : new Uint8Array(0);
  let out = "";
  let i = 0;
  for (; i + 2 < b.length; i += 3) {
    const n = (b[i] << 16) | (b[i + 1] << 8) | b[i + 2];
    out += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63] + B64[(n >>> 6) & 63] + B64[n & 63];
  }
  const rest = b.length - i;
  if (rest === 1) {
    const n = b[i] << 16;
    out += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63] + "==";
  } else if (rest === 2) {
    const n = (b[i] << 16) | (b[i + 1] << 8);
    out += B64[(n >>> 18) & 63] + B64[(n >>> 12) & 63] + B64[(n >>> 6) & 63] + "=";
  }
  return out;
}

export function base64ToBytes(text, maxBytes) {
  const s = String(text == null ? "" : text).replace(/\s+/g, "");
  if (!/^[A-Za-z0-9+/]*={0,2}$/.test(s)) return null;
  const clean = s.replace(/=+$/, "");
  if (clean.length % 4 === 1) return null;
  const outLen = Math.floor((clean.length * 3) / 4);
  const cap = typeof maxBytes === "number" && maxBytes > 0 ? maxBytes : MAX_BLOB_BYTES;
  if (outLen > cap) return null;
  const out = new Uint8Array(outLen);
  let acc = 0;
  let bits = 0;
  let pos = 0;
  for (let i = 0; i < clean.length; i++) {
    const code = clean.charCodeAt(i);
    const v = code < 128 ? B64_REV[code] : -1;
    if (v < 0) return null;
    acc = (acc << 6) | v;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      out[pos++] = (acc >>> bits) & 0xff;
    }
  }
  return out;
}

class BlobWriter {
  constructor() {
    this.buf = new Uint8Array(256);
    this.view = new DataView(this.buf.buffer);
    this.len = 0;
  }
  _ensure(n) {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + n) cap *= 2;
    const nb = new Uint8Array(cap);
    nb.set(this.buf.subarray(0, this.len));
    this.buf = nb;
    this.view = new DataView(nb.buffer);
  }
  u8(v) {
    this._ensure(1);
    this.buf[this.len++] = v & 0xff;
  }
  u16(v) {
    this._ensure(2);
    this.view.setUint16(this.len, v & 0xffff, true);
    this.len += 2;
  }
  u32(v) {
    this._ensure(4);
    this.view.setUint32(this.len, v >>> 0, true);
    this.len += 4;
  }
  i32(v) {
    this._ensure(4);
    this.view.setInt32(this.len, v | 0, true);
    this.len += 4;
  }
  f32(v) {
    this._ensure(4);
    this.view.setFloat32(this.len, Number.isFinite(v) ? v : 0, true);
    this.len += 4;
  }
  f64(v) {
    this._ensure(8);
    this.view.setFloat64(this.len, Number.isFinite(v) ? v : 0, true);
    this.len += 8;
  }
  bytes(arr) {
    this._ensure(arr.length);
    this.buf.set(arr, this.len);
    this.len += arr.length;
  }
  string(s) {
    const b = TE.encode(String(s == null ? "" : s));
    this.u32(b.length);
    this.bytes(b);
  }
  take() {
    return this.buf.slice(0, this.len);
  }
}

class BlobReader {
  constructor(bytes) {
    this.b = bytes;
    this.view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    this.pos = 0;
  }
  _need(n) {
    if (this.pos + n > this.b.length) throw new Error("Blob truncado.");
  }
  u8() {
    this._need(1);
    return this.b[this.pos++];
  }
  u16() {
    this._need(2);
    const v = this.view.getUint16(this.pos, true);
    this.pos += 2;
    return v;
  }
  u32() {
    this._need(4);
    const v = this.view.getUint32(this.pos, true);
    this.pos += 4;
    return v;
  }
  i32() {
    this._need(4);
    const v = this.view.getInt32(this.pos, true);
    this.pos += 4;
    return v;
  }
  f32() {
    this._need(4);
    const v = this.view.getFloat32(this.pos, true);
    this.pos += 4;
    return v;
  }
  f64() {
    this._need(8);
    const v = this.view.getFloat64(this.pos, true);
    this.pos += 8;
    return v;
  }
  bytes(n) {
    this._need(n);
    const out = this.b.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  string(maxLen) {
    const len = this.u32();
    if (len > maxLen) throw new Error("String do blob excede o limite.");
    return TD.decode(this.bytes(len));
  }
  eof() {
    return this.pos >= this.b.length;
  }
}

const ATTR_IDS = Object.freeze({
  string: 0x02,
  boolean: 0x03,
  number: 0x06,
  UDim: 0x09,
  UDim2: 0x0a,
  BrickColor: 0x0e,
  Color3: 0x0f,
  Vector2: 0x10,
  Vector3: 0x11,
  CFrame: 0x14,
  NumberSequence: 0x17,
  ColorSequence: 0x19,
  NumberRange: 0x1b,
  Rect: 0x1c,
  Font: 0x21,
});

export const BRICKCOLOR_NUMBERS = Object.freeze({
  "White": 1,
  "Bright red": 21,
  "Bright blue": 23,
  "Bright yellow": 24,
  "Black": 26,
  "Dark green": 28,
  "Bright green": 37,
  "Bright orange": 106,
  "Bright violet": 110,
  "Reddish brown": 192,
  "Medium stone grey": 194,
  "Dark stone grey": 199,
  "Brown": 217,
  "Steel blue": 305,
  "Navy blue": 1011,
  "Magenta": 1015,
  "Pink": 1016,
});

const BRICKCOLOR_NAMES = (() => {
  const m = new Map();
  for (const name of Object.keys(BRICKCOLOR_NUMBERS)) m.set(BRICKCOLOR_NUMBERS[name], name);
  return m;
})();

const ATTR_NAME_RE = /^[0-9A-Za-z_]{1,100}$/;
const MAX_ATTR_ENTRIES = 200;
const MAX_SEQ_KEYPOINTS = 100;
const MAX_FONT_STRING = 512;


const AXIS_VECTORS = Object.freeze([
  [1, 0, 0], [0, 1, 0], [0, 0, 1],
  [-1, 0, 0], [0, -1, 0], [0, 0, -1],
]);

const AXIS_TOL = 1e-6;

function quatToMatrix(q) {
  const x = q.qx || 0;
  const y = q.qy || 0;
  const z = q.qz || 0;
  const w = q.qw == null ? 1 : q.qw;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}


function matrixToQuat(m) {
  const t = m[0] + m[4] + m[8];
  let qx;
  let qy;
  let qz;
  let qw;
  if (t > 0) {
    const s = Math.sqrt(t + 1) * 2;
    qw = s / 4;
    qx = (m[7] - m[5]) / s;
    qy = (m[2] - m[6]) / s;
    qz = (m[3] - m[1]) / s;
  } else if (m[0] >= m[4] && m[0] >= m[8]) {
    const s = Math.sqrt(1 + m[0] - m[4] - m[8]) * 2;
    qx = s / 4;
    qw = (m[7] - m[5]) / s;
    qy = (m[1] + m[3]) / s;
    qz = (m[2] + m[6]) / s;
  } else if (m[4] >= m[8]) {
    const s = Math.sqrt(1 + m[4] - m[0] - m[8]) * 2;
    qy = s / 4;
    qw = (m[2] - m[6]) / s;
    qx = (m[1] + m[3]) / s;
    qz = (m[5] + m[7]) / s;
  } else {
    const s = Math.sqrt(1 + m[8] - m[0] - m[4]) * 2;
    qz = s / 4;
    qw = (m[3] - m[1]) / s;
    qx = (m[2] + m[6]) / s;
    qy = (m[5] + m[7]) / s;
  }
  const n = Math.sqrt(qx * qx + qy * qy + qz * qz + qw * qw);
  if (!Number.isFinite(n) || n < 1e-8) return { qx: 0, qy: 0, qz: 0, qw: 1 };
  const sign = qw < 0 ? -1 : 1;
  return { qx: (sign * qx) / n, qy: (sign * qy) / n, qz: (sign * qz) / n, qw: (sign * qw) / n };
}


function axisIdOfVec(a, b, c) {
  const row = [a, b, c];
  let id = -1;
  for (let i = 0; i < 3; i++) {
    const v = row[i];
    if (Math.abs(v) <= AXIS_TOL) continue;
    if (Math.abs(Math.abs(v) - 1) > AXIS_TOL) return -1;
    if (id !== -1) return -1;
    id = v > 0 ? i : i + 3;
  }
  return id;
}

function basicRotationFromId(id) {
  if (!Number.isInteger(id) || id < 0x02 || id > 0x23) return null;
  const xId = Math.floor((id - 1) / 6);
  const yId = (id - 1) % 6;
  if (xId > 5 || xId % 3 === yId % 3) return null;
  const x = AXIS_VECTORS[xId];
  const y = AXIS_VECTORS[yId];
  const z = [
    x[1] * y[2] - x[2] * y[1],
    x[2] * y[0] - x[0] * y[2],
    x[0] * y[1] - x[1] * y[0],
  ];


  return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
}


function basicRotationIdOf(m) {
  const xId = axisIdOfVec(m[0], m[3], m[6]);
  const yId = axisIdOfVec(m[1], m[4], m[7]);
  if (xId < 0 || yId < 0 || xId % 3 === yId % 3) return null;
  const id = 6 * xId + yId + 1;
  const expected = basicRotationFromId(id);
  if (!expected) return null;
  for (let i = 0; i < 9; i++) {
    if (Math.abs(m[i] - expected[i]) > AXIS_TOL) return null;
  }
  return id;
}


const FONT_STYLE_NORMAL = 0;
const FONT_STYLE_ITALIC = 1;
const FONT_FAMILY_PREFIX = "rbxasset://fonts/families/";
export const FONT_DEFAULT_ENUM = "SourceSans";

export const FONT_ATTR_SPECS = Object.freeze([
  ["Legacy", "LegacyArial.json", 400, FONT_STYLE_NORMAL],
  ["Arial", "Arial.json", 400, FONT_STYLE_NORMAL],
  ["ArialBold", "Arial.json", 700, FONT_STYLE_NORMAL],
  ["SourceSans", "SourceSansPro.json", 400, FONT_STYLE_NORMAL],
  ["SourceSansBold", "SourceSansPro.json", 700, FONT_STYLE_NORMAL],
  ["SourceSansItalic", "SourceSansPro.json", 400, FONT_STYLE_ITALIC],
  ["SourceSansSemibold", "SourceSansPro.json", 600, FONT_STYLE_NORMAL],
  ["SourceSansLight", "SourceSansPro.json", 300, FONT_STYLE_NORMAL],
  ["SourceSansSmallcaps", "SourceSansPro.json", 400, FONT_STYLE_NORMAL],
  ["Roboto", "Roboto.json", 400, FONT_STYLE_NORMAL],
  ["RobotoBold", "Roboto.json", 700, FONT_STYLE_NORMAL],
  ["RobotoLight", "Roboto.json", 300, FONT_STYLE_NORMAL],
  ["RobotoMono", "RobotoMono.json", 400, FONT_STYLE_NORMAL],
  ["GothamBlack", "GothamSSm.json", 900, FONT_STYLE_NORMAL],
  ["GothamBold", "GothamSSm.json", 700, FONT_STYLE_NORMAL],
  ["GothamMedium", "GothamSSm.json", 500, FONT_STYLE_NORMAL],
  ["GothamLight", "GothamSSm.json", 300, FONT_STYLE_NORMAL],
  ["TitilliumWeb", "TitilliumWeb.json", 400, FONT_STYLE_NORMAL],
  ["Oswald", "Oswald.json", 400, FONT_STYLE_NORMAL],
  ["Nunito", "Nunito.json", 400, FONT_STYLE_NORMAL],
  ["Merriweather", "Merriweather.json", 400, FONT_STYLE_NORMAL],
  ["Ubuntu", "Ubuntu.json", 400, FONT_STYLE_NORMAL],
]);

const FONT_SPEC_BY_ENUM = (() => {
  const m = new Map();
  for (const [name, file, weight, style] of FONT_ATTR_SPECS) {
    m.set(name, { family: FONT_FAMILY_PREFIX + file, weight, style });
  }
  return m;
})();


function fontFamilyKey(family) {
  const base = String(family == null ? "" : family).split("/").pop() || "";
  return base.toLowerCase().replace(/\.json$/, "");
}


function fontEnumFromSpec(family, weight, style) {
  const key = fontFamilyKey(family);
  if (!key) return null;
  let best = null;
  let bestScore = -Infinity;
  for (const [name, file, w, s] of FONT_ATTR_SPECS) {
    if (fontFamilyKey(file) !== key) continue;
    const score = (s === style ? 2000 : 0) - Math.min(1999, Math.abs(w - weight));
    if (score > bestScore) {
      bestScore = score;
      best = name;
    }
  }
  return best;
}

function writeAttrValue(w, type, value) {
  switch (type) {
    case "string":
      w.string(value);
      return true;
    case "boolean":
      w.u8(value ? 1 : 0);
      return true;
    case "number":
      w.f64(value);
      return true;
    case "UDim":
      w.f32(value.scale);
      w.i32(value.offset);
      return true;
    case "UDim2":
      w.f32(value.xScale);
      w.i32(value.xOffset);
      w.f32(value.yScale);
      w.i32(value.yOffset);
      return true;
    case "BrickColor":
      w.u32(BRICKCOLOR_NUMBERS[value] != null ? BRICKCOLOR_NUMBERS[value] : 194);
      return true;
    case "Color3":
      w.f32(value.r);
      w.f32(value.g);
      w.f32(value.b);
      return true;
    case "Vector2":
      w.f32(value.x);
      w.f32(value.y);
      return true;
    case "Vector3":
      w.f32(value.x);
      w.f32(value.y);
      w.f32(value.z);
      return true;
    case "CFrame": {
      w.f32(value.x);
      w.f32(value.y);
      w.f32(value.z);
      const m = quatToMatrix(value);
      const basicId = basicRotationIdOf(m);
      if (basicId != null) {
        w.u8(basicId);
      } else {
        w.u8(0x00);
        for (const c of m) w.f32(c);
      }
      return true;
    }
    case "Font": {
      const spec = FONT_SPEC_BY_ENUM.get(value);
      if (!spec) throw new Error(`Font fora do enum: ${value}`);
      w.u16(spec.weight);
      w.u8(spec.style);
      w.string(spec.family);
      w.string("");
      return true;
    }
    case "NumberSequence": {



      const all = Array.isArray(value.keypoints) ? value.keypoints : [];
      const kps = all.length > MAX_SEQ_KEYPOINTS ? all.slice(0, MAX_SEQ_KEYPOINTS) : all;
      w.u32(kps.length);
      for (const kp of kps) {
        w.f32(kp.envelope || 0);
        w.f32(kp.time);
        w.f32(kp.value);
      }
      return true;
    }
    case "ColorSequence": {

      const all = Array.isArray(value.keypoints) ? value.keypoints : [];
      const kps = all.length > MAX_SEQ_KEYPOINTS ? all.slice(0, MAX_SEQ_KEYPOINTS) : all;
      w.u32(kps.length);
      for (const kp of kps) {
        w.f32(0);
        w.f32(kp.time);
        w.f32(kp.color.r);
        w.f32(kp.color.g);
        w.f32(kp.color.b);
      }
      return true;
    }
    case "NumberRange":
      w.f32(value.min);
      w.f32(value.max);
      return true;
    case "Rect":
      w.f32(value.minX);
      w.f32(value.minY);
      w.f32(value.maxX);
      w.f32(value.maxY);
      return true;
    default:
      return false;
  }
}

export function encodeAttributesBlob(list, warnings) {
  const warn = (m) => {
    if (Array.isArray(warnings)) warnings.push(m);
  };
  const entries = [];
  for (const a of Array.isArray(list) ? list : []) {
    if (!a || typeof a.name !== "string" || !ATTR_NAME_RE.test(a.name) || /^RBX/.test(a.name)) continue;
    if (ATTR_IDS[a.type] == null) continue;
    if (a.value == null && a.type !== "string") continue;
    entries.push(a);
    if (entries.length >= MAX_ATTR_ENTRIES) break;
  }
  if (!entries.length) return null;
  const bodies = [];
  for (const a of entries) {
    try {
      const ew = new BlobWriter();
      ew.string(a.name);
      ew.u8(ATTR_IDS[a.type]);
      writeAttrValue(ew, a.type, a.value);
      bodies.push(ew.take());
    } catch (_) {
      warn(`Atributo "${a.name}" com valor inválido foi omitido no export.`);
    }
  }
  if (!bodies.length) return null;
  const w = new BlobWriter();
  w.u32(bodies.length);
  for (const b of bodies) w.bytes(b);
  const out = w.take();
  if (out.length > MAX_BLOB_BYTES) {
    warn("Atributos excedem 4MB e foram omitidos no export.");
    return null;
  }
  return out;
}

function readSeqCount(r) {
  const n = r.u32();
  if (n > MAX_SEQ_KEYPOINTS) throw new Error("Sequência excede o limite de keypoints.");
  return n;
}

function readAttrValue(r, id) {
  switch (id) {
    case 0x02:
      return { type: "string", value: r.string(MAX_BLOB_BYTES) };
    case 0x03:
      return { type: "boolean", value: r.u8() !== 0 };
    case 0x05:
      return { type: "number", value: r.f32() };
    case 0x06:
      return { type: "number", value: r.f64() };
    case 0x09:
      return { type: "UDim", value: { scale: r.f32(), offset: r.i32() } };
    case 0x0a:
      return {
        type: "UDim2",
        value: { xScale: r.f32(), xOffset: r.i32(), yScale: r.f32(), yOffset: r.i32() },
      };
    case 0x0e: {
      const n = r.u32();
      return { type: "BrickColor", value: BRICKCOLOR_NAMES.get(n) || "Medium stone grey" };
    }
    case 0x0f:
      return { type: "Color3", value: { r: r.f32(), g: r.f32(), b: r.f32() } };
    case 0x10:
      return { type: "Vector2", value: { x: r.f32(), y: r.f32() } };
    case 0x11:
      return { type: "Vector3", value: { x: r.f32(), y: r.f32(), z: r.f32() } };
    case 0x14: {
      const x = r.f32();
      const y = r.f32();
      const z = r.f32();
      const rotId = r.u8();
      let m;
      if (rotId === 0x00) {
        m = [];
        for (let i = 0; i < 9; i++) m.push(r.f32());
      } else {
        m = basicRotationFromId(rotId);
        if (!m) throw new Error(`CFrame com id de rotação inválido: 0x${rotId.toString(16)}.`);
      }
      const q = matrixToQuat(m);
      return { type: "CFrame", value: { x, y, z, qx: q.qx, qy: q.qy, qz: q.qz, qw: q.qw } };
    }
    case 0x17: {
      const count = readSeqCount(r);
      const keypoints = [];
      for (let i = 0; i < count; i++) {
        const envelope = r.f32();
        const time = r.f32();
        const value = r.f32();
        keypoints.push({ time, value, envelope });
      }
      return { type: "NumberSequence", value: { keypoints } };
    }
    case 0x19: {
      const count = readSeqCount(r);
      const keypoints = [];
      for (let i = 0; i < count; i++) {
        r.f32();
        const time = r.f32();
        const cr = r.f32();
        const cg = r.f32();
        const cb = r.f32();
        keypoints.push({ time, color: { r: cr, g: cg, b: cb } });
      }
      return { type: "ColorSequence", value: { keypoints } };
    }
    case 0x1b:
      return { type: "NumberRange", value: { min: r.f32(), max: r.f32() } };
    case 0x1c:
      return { type: "Rect", value: { minX: r.f32(), minY: r.f32(), maxX: r.f32(), maxY: r.f32() } };
    case 0x21: {
      const weight = r.u16();
      const style = r.u8();
      const family = r.string(MAX_FONT_STRING);
      r.string(MAX_FONT_STRING);                                                
      const enumName = fontEnumFromSpec(family, weight, style);
      if (!enumName) {
        return {
          type: "Font",
          value: FONT_DEFAULT_ENUM,
          warning: `família desconhecida ("${family}") importada como ${FONT_DEFAULT_ENUM}.`,
        };
      }
      return { type: "Font", value: enumName };
    }
    default:
      return undefined;
  }
}

export function decodeAttributesBlob(bytes, warnings) {
  const warn = (m) => {
    if (Array.isArray(warnings)) warnings.push(m);
  };
  const attributes = [];
  if (!(bytes instanceof Uint8Array) || !bytes.length) return { ok: true, attributes };
  if (bytes.length > MAX_BLOB_BYTES) {
    warn("AttributesSerialize excede o limite de 4MB; atributos ignorados.");
    return { ok: false, attributes };
  }
  const r = new BlobReader(bytes);
  try {
    const count = r.u32();
    if (count > MAX_ATTR_ENTRIES) {
      warn(`AttributesSerialize com ${count} entradas excede o limite; ignorado.`);
      return { ok: false, attributes };
    }
    const seen = new Set();
    for (let i = 0; i < count; i++) {
      const name = r.string(256);
      const id = r.u8();
      const decoded = readAttrValue(r, id);
      if (decoded === undefined) {
        warn(`Atributo "${name}" com tipo 0x${id.toString(16)} desconhecido; atributos restantes ignorados.`);
        return { ok: true, attributes };
      }
      if (decoded.warning) warn(`Atributo "${name}": ${decoded.warning}`);
      if (seen.has(name)) continue;
      seen.add(name);
      attributes.push({ name, type: decoded.type, value: decoded.value });
    }
    return { ok: true, attributes };
  } catch (_) {
    warn("AttributesSerialize malformado; atributos ignorados.");
    return { ok: false, attributes };
  }
}

export function encodeTagsBlob(tags) {
  const list = (Array.isArray(tags) ? tags : []).filter((t) => typeof t === "string" && t.length > 0);
  if (!list.length) return null;
  return TE.encode(list.join("\0"));
}

export function decodeTagsBlob(bytes) {
  if (!(bytes instanceof Uint8Array) || !bytes.length) return [];
  return TD.decode(bytes)
    .split("\0")
    .filter((t) => t.length > 0)
    .slice(0, 64);
}


const SMOOTH_GRID_LOG2 = 5;

const RBX_MATERIAL_TABLE = Object.freeze([
  "Air", "Water", "Grass", "Slate", "Concrete", "Brick", "Sand", "WoodPlanks",
  "Rock", "Glacier", "Snow", "Sandstone", "Mud", "Basalt", "Ground",
  "CrackedLava", "Asphalt", "Cobblestone", "Ice", "LeafyGrass", "Salt",
  "Limestone", "Pavement",
]);

const RBX_MATERIAL_FALLBACKS = Object.freeze({
  WoodPlanks: "Ground",
  Asphalt: "Pavement",
  Ice: "Glacier",
  LeafyGrass: "Grass",
  Salt: "Snow",
});

const INTERNAL_INDEX_BY_NAME = (() => {
  const m = Object.create(null);
  TERRAIN_MATERIALS.forEach((mat, i) => {
    m[mat.name] = i;
  });
  return m;
})();

const INTERNAL_TO_RBX = TERRAIN_MATERIALS.map((m) => {
  const idx = RBX_MATERIAL_TABLE.indexOf(m.name);
  return idx > 0 ? idx : RBX_MATERIAL_TABLE.indexOf("Grass");
});

const RBX_TO_INTERNAL = RBX_MATERIAL_TABLE.map((name, i) => {
  if (i === 0) return -1;
  if (INTERNAL_INDEX_BY_NAME[name] != null) return INTERNAL_INDEX_BY_NAME[name];
  const fb = RBX_MATERIAL_FALLBACKS[name];
  return fb != null && INTERNAL_INDEX_BY_NAME[fb] != null ? INTERNAL_INDEX_BY_NAME[fb] : 0;
});


const UNKNOWN_MATERIAL_FALLBACK =
  INTERNAL_INDEX_BY_NAME.Grass != null ? INTERNAL_INDEX_BY_NAME.Grass : 0;


export function encodeSmoothGrid(chunkEntries) {
  return encodeSmoothGridBytes(chunkEntries, {
    internalToRbx: INTERNAL_TO_RBX,
    chunkSizeLog2: SMOOTH_GRID_LOG2,
  });
}


export function decodeSmoothGrid(bytes, warnings, opts) {
  return decodeSmoothGridBytes(bytes, warnings, {
    layout: opts && typeof opts.layout === "string" ? opts.layout : "auto",
    materialMap: RBX_TO_INTERNAL,
    fallbackMaterial: UNKNOWN_MATERIAL_FALLBACK,
  });
}

const MATERIAL_COLORS_ORDER = RBX_MATERIAL_TABLE.slice(2);

const EXTRA_MATERIAL_COLORS = Object.freeze({
  WoodPlanks: 0x9b7b4f,
  Asphalt: 0x737370,
  Ice: 0xcbe6f2,
  LeafyGrass: 0x6aa844,
  Salt: 0xe6e6e1,
});

export function buildMaterialColors() {
  const out = new Uint8Array(69);
  let pos = 6;
  for (const name of MATERIAL_COLORS_ORDER) {
    const idx = INTERNAL_INDEX_BY_NAME[name];
    const rgb = idx != null ? TERRAIN_MATERIALS[idx].color >>> 0 : (EXTRA_MATERIAL_COLORS[name] || 0x808080) >>> 0;
    out[pos++] = (rgb >>> 16) & 0xff;
    out[pos++] = (rgb >>> 8) & 0xff;
    out[pos++] = rgb & 0xff;
  }
  return out;
}

export function encodeTerrainBlobs(chunkEntries, warnings) {
  const grid = encodeSmoothGrid(chunkEntries);
  if (!grid) {

    if (Array.isArray(warnings) && Array.isArray(chunkEntries) && chunkEntries.length > 0) {
      warnings.push("Terreno não codificado no export (entradas inválidas ou acima do orçamento do SmoothGrid).");
    }
    return null;
  }
  return {
    smoothGrid: bytesToBase64(grid),
    materialColors: bytesToBase64(buildMaterialColors()),
  };
}

function emptySmoothGridResult(partial) {
  return {
    ok: false,
    partial: !!partial,
    layout: "roblox",
    version: 0,
    chunkSizeLog2: 0,
    chunks: [],

    stats: { rbxChunks: 0, internalChunks: 0, voxels: 0, runs: 0, unknownMaterials: 0, truncatedAt: -1, occCells: 0, chunksWritten: 0, chunksDiscarded: 0 },
  };
}

export function decodeSmoothGridBase64(b64, warnings, opts) {
  const s = typeof b64 === "string" ? b64 : "";
  if (s.length > MAX_SMOOTH_GRID_B64) {


    if (Array.isArray(warnings)) {
      warnings.push(`SmoothGrid em base64 excede o orçamento de ${MAX_SMOOTH_GRID_BYTES} bytes; importando só o começo do blob (antes o terreno inteiro era ignorado).`);
    }
    const safeChars = Math.floor(MAX_SMOOTH_GRID_BYTES / 3) * 4;
    const head = base64ToBytes(s.slice(0, safeChars), MAX_SMOOTH_GRID_BYTES);
    if (!head) {
      if (Array.isArray(warnings)) warnings.push("SmoothGrid com base64 inválido; terreno ignorado.");
      return emptySmoothGridResult(true);
    }
    const dec = decodeSmoothGrid(head, warnings, opts);
    dec.partial = true;
    if (Array.isArray(warnings)) {
      const totalBytes = Math.floor((s.length * 3) / 4);
      const pct = totalBytes > 0 ? Math.max(1, Math.min(99, Math.round((head.length / totalBytes) * 100))) : 0;
      warnings.push(`SmoothGrid: ${head.length} de ~${totalBytes} bytes decodificados (~${pct}% do blob); chunks além do teto ficaram de fora do import.`);
    }
    return dec;
  }
  const bytes = base64ToBytes(s, MAX_SMOOTH_GRID_BYTES);
  if (!bytes) {
    if (Array.isArray(warnings)) warnings.push("SmoothGrid com base64 inválido; terreno ignorado.");
    return emptySmoothGridResult(false);
  }
  return decodeSmoothGrid(bytes, warnings, opts);
}
