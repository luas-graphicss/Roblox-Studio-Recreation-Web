import { lz4Compress, lz4Decompress } from "./lz4.js";
import { RBX_LIMITS } from "./rbxTypeMaps.js";
import { bytesToBase64, base64ToBytes, MAX_SMOOTH_GRID_BYTES } from "./rbxBlobs.js";
import {
  RBX_UNKNOWN_LIMITS,
  captureUnknownProp,
  unknownPropName,
  isUnknownPropName,
  unknownPropFromScanned,
  captureUnknownChunk,
  unknownChunkToBytes,
  unknownChunkLabel,
} from "./rbxUnknown.js";

const MAGIC = "<roblox!";
const SIGNATURE = [0x89, 0xff, 0x0d, 0x0a, 0x1a, 0x0a];
const MAX_UNCOMPRESSED_TOTAL = 200 * 1024 * 1024;


const TYPE = Object.freeze({
  string: 0x01, binaryString: 0x01, bool: 0x02, int: 0x03, float: 0x04, double: 0x05,
  udim: 0x06, udim2: 0x07, ray: 0x08, faces: 0x09, axes: 0x0a, brickColor: 0x0b,
  color3: 0x0c, vector2: 0x0d, vector3: 0x0e, vector2i16: 0x0f, cframe: 0x10,
  token: 0x12, ref: 0x13, vector3i16: 0x14,
  numberSeq: 0x15, colorSeq: 0x16, numberRange: 0x17, rect: 0x18, physProps: 0x19,
  color3u8: 0x1a, int64: 0x1b, sharedString: 0x1c, optionalCFrame: 0x1e,
  uniqueId: 0x1f, font: 0x20, securityCaps: 0x21,
});


const MAX_SEQ_KEYPOINTS = 4096;
const FONT_STYLES = ["Normal", "Italic"];
const UNIQUE_ID_BYTES = 16;
const ZERO_UNIQUE_ID = "0".repeat(UNIQUE_ID_BYTES * 2);

const BINARY_STRING_PROPS = new Set([
  "AttributesSerialize", "Tags", "SmoothGrid", "MaterialColors", "MeshData",
  "ChildData", "AssetId", "PhysicalConfigData", "CollisionGroupData", "PhysicsGrid",


  "PhysicsData", "MeshData2", "AeroMeshData",
]);

const TE = new TextEncoder();
const TD = new TextDecoder("utf-8", { fatal: false });
const F32 = new DataView(new ArrayBuffer(8));

export function isRbxBinary(bytes) {
  if (!bytes || bytes.length < MAGIC.length) return false;
  for (let i = 0; i < MAGIC.length; i++) {
    if (bytes[i] !== MAGIC.charCodeAt(i)) return false;
  }
  return true;
}

class ByteWriter {
  constructor() {
    this.buf = new Uint8Array(4096);
    this.len = 0;
  }
  _ensure(n) {
    if (this.len + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.len + n) cap *= 2;
    const nb = new Uint8Array(cap);
    nb.set(this.buf.subarray(0, this.len));
    this.buf = nb;
  }
  bytes(arr) {
    this._ensure(arr.length);
    this.buf.set(arr, this.len);
    this.len += arr.length;
  }
  u8(v) {
    this._ensure(1);
    this.buf[this.len++] = v & 0xff;
  }
  u16(v) {
    this.u8(v);
    this.u8(v >>> 8);
  }
  u32(v) {
    this.u8(v);
    this.u8(v >>> 8);
    this.u8(v >>> 16);
    this.u8(v >>> 24);
  }
  f32le(v) {
    F32.setFloat32(0, Number.isFinite(v) ? v : 0, true);
    this.u8(F32.getUint8(0));
    this.u8(F32.getUint8(1));
    this.u8(F32.getUint8(2));
    this.u8(F32.getUint8(3));
  }
  f64le(v) {
    F32.setFloat64(0, Number.isFinite(v) ? v : 0, true);
    for (let i = 0; i < 8; i++) this.u8(F32.getUint8(i));
  }
  string(s) {
    const b = TE.encode(String(s == null ? "" : s));
    this.u32(b.length);
    this.bytes(b);
  }
  take() {
    return this.buf.subarray(0, this.len);
  }
}

class ByteReader {
  constructor(bytes) {
    this.b = bytes;
    this.pos = 0;
  }
  _need(n) {
    if (this.pos + n > this.b.length) throw new Error("Arquivo binário truncado.");
  }
  bytes(n) {
    this._need(n);
    const out = this.b.subarray(this.pos, this.pos + n);
    this.pos += n;
    return out;
  }
  u8() {
    this._need(1);
    return this.b[this.pos++];
  }
  u16() {
    return this.u8() | (this.u8() << 8);
  }
  u32() {
    return (this.u8() | (this.u8() << 8) | (this.u8() << 16) | (this.u8() << 24)) >>> 0;
  }
  i32() {
    return this.u32() | 0;
  }
  i16() {
    const v = this.u16();
    return v > 0x7fff ? v - 0x10000 : v;
  }
  f32le() {
    const b = this.bytes(4);
    F32.setUint8(0, b[0]);
    F32.setUint8(1, b[1]);
    F32.setUint8(2, b[2]);
    F32.setUint8(3, b[3]);
    return F32.getFloat32(0, true);
  }
  f64le() {
    const b = this.bytes(8);
    for (let i = 0; i < 8; i++) F32.setUint8(i, b[i]);
    return F32.getFloat64(0, true);
  }
  string(maxLen) {
    const len = this.u32();
    if (len > (maxLen || RBX_LIMITS.maxStringLen)) throw new Error("String binária excede o limite.");
    return TD.decode(this.bytes(len));
  }
  eof() {
    return this.pos >= this.b.length;
  }
}

const zz = (v) => (((v | 0) << 1) ^ ((v | 0) >> 31)) >>> 0;
const unzz = (u) => ((u >>> 1) ^ -(u & 1)) | 0;

function rotF32(v) {
  F32.setFloat32(0, Number.isFinite(v) ? v : 0, false);
  const bits = F32.getUint32(0, false);
  return ((bits << 1) | (bits >>> 31)) >>> 0;
}

function unrotF32(u) {
  const bits = ((u >>> 1) | (u << 31)) >>> 0;
  F32.setUint32(0, bits, false);
  const v = F32.getFloat32(0, false);
  return Number.isFinite(v) ? v : 0;
}

function interleaveU32(values) {
  const n = values.length;
  const out = new Uint8Array(n * 4);
  for (let i = 0; i < n; i++) {
    const v = values[i] >>> 0;
    out[i] = v >>> 24;
    out[n + i] = (v >>> 16) & 0xff;
    out[2 * n + i] = (v >>> 8) & 0xff;
    out[3 * n + i] = v & 0xff;
  }
  return out;
}

function deinterleaveU32(r, n) {
  const b = r.bytes(n * 4);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    out[i] = ((b[i] << 24) | (b[n + i] << 16) | (b[2 * n + i] << 8) | b[3 * n + i]) >>> 0;
  }
  return out;
}

function writeRefArray(w, refs) {
  let prev = 0;
  const deltas = new Array(refs.length);
  for (let i = 0; i < refs.length; i++) {
    deltas[i] = zz(refs[i] - prev);
    prev = refs[i];
  }
  w.bytes(interleaveU32(deltas));
}

function readRefArray(r, n) {
  const us = deinterleaveU32(r, n);
  const out = new Array(n);
  let prev = 0;
  for (let i = 0; i < n; i++) {
    prev = (prev + unzz(us[i])) | 0;
    out[i] = prev;
  }
  return out;
}

function writeF32Array(w, values) {
  w.bytes(interleaveU32(values.map(rotF32)));
}

function readF32Array(r, n) {
  return deinterleaveU32(r, n).map(unrotF32);
}

function writeI64Array(w, values) {
  const n = values.length;
  const out = new Uint8Array(n * 8);
  for (let i = 0; i < n; i++) {
    let v = BigInt(Math.round(Number.isFinite(values[i]) ? values[i] : 0));
    v = (v << 1n) ^ (v >> 63n);
    v &= 0xffffffffffffffffn;
    for (let p = 0; p < 8; p++) {
      out[p * n + i] = Number((v >> BigInt((7 - p) * 8)) & 0xffn);
    }
  }
  w.bytes(out);
}

function readI64Array(r, n) {
  const b = r.bytes(n * 8);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let u = 0n;
    for (let p = 0; p < 8; p++) u = (u << 8n) | BigInt(b[p * n + i]);
    const v = (u >> 1n) ^ -(u & 1n);
    out[i] = Number(v);
  }
  return out;
}


function toBig(v) {
  try {
    if (typeof v === "bigint") return v;
    if (typeof v === "number") return BigInt(Math.round(Number.isFinite(v) ? v : 0));
    const s = String(v == null ? "0" : v).trim();
    return /^-?\d+$/.test(s) ? BigInt(s) : 0n;
  } catch (_) {
    return 0n;
  }
}


const U64_MASK = 0xffffffffffffffffn;
const U64_SIGN = 0x8000000000000000n;

function writeCapsU64Array(w, values) {
  const n = values.length;
  const out = new Uint8Array(n * 8);
  for (let i = 0; i < n; i++) {
    const raw = toBig(values[i]) & U64_MASK;

    const signed = raw >= U64_SIGN ? raw - (U64_MASK + 1n) : raw;
    const t = ((signed << 1n) ^ (signed >> 63n)) & U64_MASK;
    for (let p = 0; p < 8; p++) out[p * n + i] = Number((t >> BigInt((7 - p) * 8)) & 0xffn);
  }
  w.bytes(out);
}

function readCapsU64Array(r, n) {
  const b = r.bytes(n * 8);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    let u = 0n;
    for (let p = 0; p < 8; p++) u = (u << 8n) | BigInt(b[p * n + i]);

    out[i] = (((u >> 1n) ^ -(u & 1n)) & U64_MASK).toString();
  }
  return out;
}

function writeI32Array(w, values) {
  w.bytes(interleaveU32(values.map((v) => zz(Math.round(fin(v))))));
}

function readI32Array(r, n) {
  return deinterleaveU32(r, n).map(unzz);
}


function writeFixedInterleaved(w, values, size) {
  const n = values.length;
  const out = new Uint8Array(n * size);
  for (let i = 0; i < n; i++) {
    const one = values[i];
    for (let p = 0; p < size; p++) out[p * n + i] = (one && one[p]) || 0;
  }
  w.bytes(out);
}

function readFixedInterleaved(r, n, size) {
  const b = r.bytes(n * size);
  const out = new Array(n);
  for (let i = 0; i < n; i++) {
    const one = new Uint8Array(size);
    for (let p = 0; p < size; p++) one[p] = b[p * n + i];
    out[i] = one;
  }
  return out;
}

const HEX = "0123456789abcdef";

function bytesToHex(bytes) {
  let s = "";
  for (let i = 0; i < bytes.length; i++) s += HEX[(bytes[i] >> 4) & 0xf] + HEX[bytes[i] & 0xf];
  return s;
}

function hexToBytes(hex, size) {
  const s = String(hex == null ? "" : hex).replace(/[^0-9a-fA-F]/g, "");
  const out = new Uint8Array(size);
  for (let i = 0; i < size; i++) {
    const v = parseInt(s.substr(i * 2, 2), 16);
    out[i] = Number.isFinite(v) ? v : 0;
  }
  return out;
}

const NORMALS = [
  [1, 0, 0], [0, 1, 0], [0, 0, 1], [-1, 0, 0], [0, -1, 0], [0, 0, -1],
];

function rotationFromId(id) {
  const orient = id - 1;
  const xi = Math.floor(orient / 6) % 6;
  const yi = orient % 6;
  const x = NORMALS[xi];
  const y = NORMALS[yi];
  const z = [
    x[1] * y[2] - x[2] * y[1],
    x[2] * y[0] - x[0] * y[2],
    x[0] * y[1] - x[1] * y[0],
  ];
  return [x[0], y[0], z[0], x[1], y[1], z[1], x[2], y[2], z[2]];
}

function defaultFor(t) {
  switch (t) {
    case "string": return "";
    case "binaryString": return "";
    case "bool": return false;
    case "color3": return { r: 0, g: 0, b: 0 };
    case "color3u8": return 0;
    case "vector3": return { x: 0, y: 0, z: 0 };
    case "cframe": return { x: 0, y: 0, z: 0, r: [1, 0, 0, 0, 1, 0, 0, 0, 1] };
    case "ref": return null;
    case "udim": return { s: 0, o: 0 };
    case "udim2": return { xs: 0, xo: 0, ys: 0, yo: 0 };
    case "ray": return { ox: 0, oy: 0, oz: 0, dx: 0, dy: 0, dz: 0 };
    case "vector2": return { x: 0, y: 0 };
    case "vector2i16": return { x: 0, y: 0 };
    case "vector3i16": return { x: 0, y: 0, z: 0 };
    case "numberSeq": return [];
    case "colorSeq": return [];
    case "numberRange": return { min: 0, max: 0 };
    case "rect": return { minX: 0, minY: 0, maxX: 0, maxY: 0 };
    case "physProps": return null;
    case "optionalCFrame": return null;
    case "uniqueId": return ZERO_UNIQUE_ID;
    case "font": return { family: "", weight: 400, style: 0, cachedFaceId: "" };


    case "brickColor": return 194;
    case "faces": return 0;
    case "axes": return 0;
    case "securityCaps": return "0";
    default: return 0;
  }
}

export function encodeRbxBinary(model, opts) {
  const instances = (model && model.instances) || [];
  if (!instances.length) throw new Error("Nada para exportar.");
  if (instances.length > RBX_LIMITS.maxInstances) throw new Error("Export excede o limite de instâncias.");
  const refIndex = new Map();
  for (let i = 0; i < instances.length; i++) refIndex.set(instances[i].referent, i);

  const classes = [];
  const classByName = new Map();
  for (let i = 0; i < instances.length; i++) {
    const inst = instances[i];
    let cls = classByName.get(inst.className);
    if (!cls) {
      cls = { name: inst.className, refs: [], service: false, propOrder: [], propMap: new Map() };
      classByName.set(inst.className, cls);
      classes.push(cls);
    }
    cls.refs.push(i);
    if (inst.isService) cls.service = true;
    for (const p of inst.props || []) {


      if (p.t === "binaryString" && isUnknownPropName(p.name)) {
        const urec = unknownPropFromScanned(p.name, p.v);
        if (urec) {
          if (!cls.unknownProps) cls.unknownProps = new Map();
          let u = cls.unknownProps.get(p.name);
          if (!u) {
            u = { rec: urec, name: p.name, holders: new Map() };
            cls.unknownProps.set(p.name, u);
          }
          if (!u.holders.has(i)) u.holders.set(i, p.v);
        }
        continue;
      }
      let col = cls.propMap.get(p.name);
      if (!col) {
        col = { name: p.name, t: p.t, values: new Map() };
        cls.propMap.set(p.name, col);
        cls.propOrder.push(col);
      }
      if (col.t === p.t && !col.values.has(i)) col.values.set(i, p.v);
    }
  }

  const file = new ByteWriter();
  for (let i = 0; i < MAGIC.length; i++) file.u8(MAGIC.charCodeAt(i));
  for (const b of SIGNATURE) file.u8(b);
  file.u16(0);
  file.u32(classes.length);
  file.u32(instances.length);
  file.u32(0);
  file.u32(0);

  const chunk = (name, payload, noCompress) => {
    let comp = null;
    if (!noCompress && payload.length > 64) {
      try {
        const c = lz4Compress(payload);
        if (c.length < payload.length) comp = c;
      } catch (_) {
        comp = null;
      }
    }
    for (let i = 0; i < 4; i++) file.u8(name.charCodeAt(i));
    file.u32(comp ? comp.length : 0);
    file.u32(payload.length);
    file.u32(0);
    file.bytes(comp || payload);
  };

  const meta = new ByteWriter();
  meta.u32(1);
  meta.string("ExplicitAutoJoints");
  meta.string("true");
  chunk("META", meta.take());

  for (let cid = 0; cid < classes.length; cid++) {
    const cls = classes[cid];
    const w = new ByteWriter();
    w.u32(cid);
    w.string(cls.name);
    w.u8(cls.service ? 1 : 0);
    w.u32(cls.refs.length);
    writeRefArray(w, cls.refs);
    if (cls.service) {
      for (let i = 0; i < cls.refs.length; i++) w.u8(1);
    }
    chunk("INST", w.take());
  }

  for (let cid = 0; cid < classes.length; cid++) {
    const cls = classes[cid];
    for (const col of cls.propOrder) {
      const w = new ByteWriter();
      w.u32(cid);
      w.string(col.name);
      w.u8(TYPE[col.t]);
      const vals = cls.refs.map((idx) => {
        const v = col.values.get(idx);
        return v === undefined ? defaultFor(col.t) : v;
      });
      switch (col.t) {
        case "string":
          for (const v of vals) w.string(v);
          break;
        case "binaryString":
          for (const v of vals) {
            const raw = base64ToBytes(v, MAX_SMOOTH_GRID_BYTES) || new Uint8Array(0);
            w.u32(raw.length);
            w.bytes(raw);
          }
          break;
        case "bool":
          for (const v of vals) w.u8(v ? 1 : 0);
          break;
        case "int":
          w.bytes(interleaveU32(vals.map((v) => zz(Math.round(v)))));
          break;
        case "float":
          writeF32Array(w, vals);
          break;
        case "double":
          for (const v of vals) w.f64le(v);
          break;
        case "token":
          w.bytes(interleaveU32(vals.map((v) => Math.max(0, Math.round(v)) >>> 0)));
          break;
        case "int64":
          writeI64Array(w, vals);
          break;
        case "color3":
          writeF32Array(w, vals.map((c) => (c && c.r) || 0));
          writeF32Array(w, vals.map((c) => (c && c.g) || 0));
          writeF32Array(w, vals.map((c) => (c && c.b) || 0));
          break;
        case "color3u8": {
          for (const v of vals) w.u8((v >>> 16) & 0xff);
          for (const v of vals) w.u8((v >>> 8) & 0xff);
          for (const v of vals) w.u8(v & 0xff);
          break;
        }
        case "vector3":
          writeF32Array(w, vals.map((v) => (v && v.x) || 0));
          writeF32Array(w, vals.map((v) => (v && v.y) || 0));
          writeF32Array(w, vals.map((v) => (v && v.z) || 0));
          break;
        case "cframe": {
          for (const v of vals) {
            w.u8(0);
            const m = (v && v.r) || [1, 0, 0, 0, 1, 0, 0, 0, 1];
            for (let k = 0; k < 9; k++) w.f32le(m[k]);
          }
          writeF32Array(w, vals.map((v) => (v && v.x) || 0));
          writeF32Array(w, vals.map((v) => (v && v.y) || 0));
          writeF32Array(w, vals.map((v) => (v && v.z) || 0));
          break;
        }
        case "udim":
          writeF32Array(w, vals.map((v) => (v && v.s) || 0));
          writeI32Array(w, vals.map((v) => (v && v.o) || 0));
          break;
        case "udim2":
          writeF32Array(w, vals.map((v) => (v && v.xs) || 0));
          writeF32Array(w, vals.map((v) => (v && v.ys) || 0));
          writeI32Array(w, vals.map((v) => (v && v.xo) || 0));
          writeI32Array(w, vals.map((v) => (v && v.yo) || 0));
          break;
        case "ray":
          for (const v of vals) {
            w.f32le((v && v.ox) || 0); w.f32le((v && v.oy) || 0); w.f32le((v && v.oz) || 0);
            w.f32le((v && v.dx) || 0); w.f32le((v && v.dy) || 0); w.f32le((v && v.dz) || 0);
          }
          break;
        case "faces":
        case "axes":
          for (const v of vals) w.u8(Math.max(0, Math.round(fin(v))) & 0xff);
          break;
        case "brickColor":
          w.bytes(interleaveU32(vals.map((v) => Math.max(0, Math.round(fin(v))) >>> 0)));
          break;
        case "vector2":
          writeF32Array(w, vals.map((v) => (v && v.x) || 0));
          writeF32Array(w, vals.map((v) => (v && v.y) || 0));
          break;
        case "vector2i16":
          for (const v of vals) {
            w.u16(Math.round((v && v.x) || 0) & 0xffff);
            w.u16(Math.round((v && v.y) || 0) & 0xffff);
          }
          break;
        case "vector3i16":
          for (const v of vals) {
            w.u16(Math.round((v && v.x) || 0) & 0xffff);
            w.u16(Math.round((v && v.y) || 0) & 0xffff);
            w.u16(Math.round((v && v.z) || 0) & 0xffff);
          }
          break;
        case "numberSeq":
          for (const v of vals) {
            const kps = Array.isArray(v) ? v.slice(0, MAX_SEQ_KEYPOINTS) : [];
            w.u32(kps.length);
            for (const k of kps) { w.f32le(k.t); w.f32le(k.v); w.f32le(k.e); }
          }
          break;
        case "colorSeq":
          for (const v of vals) {
            const kps = Array.isArray(v) ? v.slice(0, MAX_SEQ_KEYPOINTS) : [];
            w.u32(kps.length);
            for (const k of kps) { w.f32le(k.t); w.f32le(k.r); w.f32le(k.g); w.f32le(k.b); w.f32le(k.e); }
          }
          break;
        case "numberRange":
          for (const v of vals) { w.f32le((v && v.min) || 0); w.f32le((v && v.max) || 0); }
          break;
        case "rect":
          writeF32Array(w, vals.map((v) => (v && v.minX) || 0));
          writeF32Array(w, vals.map((v) => (v && v.minY) || 0));
          writeF32Array(w, vals.map((v) => (v && v.maxX) || 0));
          writeF32Array(w, vals.map((v) => (v && v.maxY) || 0));
          break;
        case "physProps":
          for (const v of vals) {
            if (!v) { w.u8(0); continue; }
            w.u8(1);
            w.f32le(v.d); w.f32le(v.f); w.f32le(v.e); w.f32le(v.fw); w.f32le(v.ew);
          }
          break;
        case "optionalCFrame": {
          w.u8(TYPE.cframe);
          for (const v of vals) {
            w.u8(0);
            const m = (v && v.r) || [1, 0, 0, 0, 1, 0, 0, 0, 1];
            for (let k = 0; k < 9; k++) w.f32le(m[k]);
          }
          writeF32Array(w, vals.map((v) => (v && v.x) || 0));
          writeF32Array(w, vals.map((v) => (v && v.y) || 0));
          writeF32Array(w, vals.map((v) => (v && v.z) || 0));
          w.u8(TYPE.bool);
          for (const v of vals) w.u8(v ? 1 : 0);
          break;
        }
        case "uniqueId":
          writeFixedInterleaved(w, vals.map((v) => hexToBytes(v, UNIQUE_ID_BYTES)), UNIQUE_ID_BYTES);
          break;
        case "font":


          for (const v of vals) {
            w.string((v && v.family) || "");
            w.u16(Math.max(0, Math.round((v && v.weight) || 0)) & 0xffff);
            w.u8(Math.max(0, Math.round((v && v.style) || 0)) & 0xff);
            w.string((v && v.cachedFaceId) || "");
          }
          break;
        case "securityCaps":
          writeCapsU64Array(w, vals);
          break;
        case "ref": {
          const ids = vals.map((v) => {
            const idx = v == null ? -1 : refIndex.get(v);
            return idx === undefined ? -1 : idx;
          });
          writeRefArray(w, ids);
          break;
        }
        default:
          continue;
      }
      chunk("PROP", w.take());
    }


    if (cls.unknownProps) {
      for (const u of cls.unknownProps.values()) {
        if (u.rec.count === cls.refs.length && u.holders.size === 1) {
          const uw = new ByteWriter();
          uw.u32(cid);
          uw.string(u.rec.propName);
          uw.u8(u.rec.typeId);
          uw.bytes(u.rec.bytes);
          chunk("PROP", uw.take());
          continue;
        }
        const uw = new ByteWriter();
        uw.u32(cid);
        uw.string(u.name);
        uw.u8(TYPE.binaryString);
        for (const idx of cls.refs) {
          const b64 = u.holders.get(idx);
          const raw = b64 ? base64ToBytes(b64, RBX_UNKNOWN_LIMITS.maxBlobBytes) : null;
          uw.u32(raw ? raw.length : 0);
          if (raw) uw.bytes(raw);
        }
        chunk("PROP", uw.take());
      }
    }
  }


  const extraChunks = opts && Array.isArray(opts.fileChunks) ? opts.fileChunks : [];
  for (let i = 0; i < extraChunks.length && i < RBX_UNKNOWN_LIMITS.maxFileChunks; i++) {
    const rec = unknownChunkToBytes(extraChunks[i]);
    if (rec) chunk(rec.name, rec.bytes, true);
  }

  const prnt = new ByteWriter();
  prnt.u8(0);
  prnt.u32(instances.length);
  writeRefArray(prnt, instances.map((_, i) => i));
  writeRefArray(prnt, instances.map((inst) => {
    const p = inst.parentRef == null ? undefined : refIndex.get(inst.parentRef);
    return p === undefined ? -1 : p;
  }));
  chunk("PRNT", prnt.take());

  chunk("END\0", TE.encode("</roblox>"), true);
  return file.take().slice();
}

function fin(n) {
  return typeof n === "number" && Number.isFinite(n) ? n : 0;
}

function fmtNum(n) {
  const v = fin(n);
  if (Number.isInteger(v)) return String(v);
  const s = v.toFixed(6).replace(/0+$/, "").replace(/\.$/, "");
  return s === "-0" ? "0" : s;
}

function xmlEscape(s) {
  return String(s)
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function propXml(p) {
  if (p && p.v == null) {


    const fallback = defaultFor(p.t);
    if (fallback && typeof fallback === "object") p = { name: p.name, t: p.t, v: fallback };
  }
  switch (p.t) {
    case "string":
      return `<string name="${xmlEscape(p.name)}">${xmlEscape(p.v)}</string>`;
    case "binaryString":
      return `<BinaryString name="${xmlEscape(p.name)}">${p.v}</BinaryString>`;
    case "bool":
      return `<bool name="${xmlEscape(p.name)}">${p.v ? "true" : "false"}</bool>`;
    case "int":
      return `<int name="${xmlEscape(p.name)}">${Math.round(fin(p.v))}</int>`;
    case "int64":
      return `<int64 name="${xmlEscape(p.name)}">${Math.round(fin(p.v))}</int64>`;
    case "float":
      return `<float name="${xmlEscape(p.name)}">${fmtNum(p.v)}</float>`;
    case "double":
      return `<double name="${xmlEscape(p.name)}">${fmtNum(p.v)}</double>`;
    case "token":
      return `<token name="${xmlEscape(p.name)}">${p.v >>> 0}</token>`;
    case "color3":
      return `<Color3 name="${xmlEscape(p.name)}"><R>${fmtNum(p.v.r)}</R><G>${fmtNum(p.v.g)}</G><B>${fmtNum(p.v.b)}</B></Color3>`;
    case "color3u8":
      return `<Color3uint8 name="${xmlEscape(p.name)}">${p.v >>> 0}</Color3uint8>`;
    case "vector3":
      return `<Vector3 name="${xmlEscape(p.name)}"><X>${fmtNum(p.v.x)}</X><Y>${fmtNum(p.v.y)}</Y><Z>${fmtNum(p.v.z)}</Z></Vector3>`;
    case "cframe": {
      const tags = ["X", "Y", "Z", "R00", "R01", "R02", "R10", "R11", "R12", "R20", "R21", "R22"];
      const vals = [p.v.x, p.v.y, p.v.z, ...p.v.r];
      let inner = "";
      for (let i = 0; i < 12; i++) inner += `<${tags[i]}>${fmtNum(vals[i])}</${tags[i]}>`;
      return `<CoordinateFrame name="${xmlEscape(p.name)}">${inner}</CoordinateFrame>`;
    }
    case "udim":
      return `<UDim name="${xmlEscape(p.name)}"><S>${fmtNum(p.v.s)}</S><O>${Math.round(fin(p.v.o))}</O></UDim>`;
    case "udim2":
      return `<UDim2 name="${xmlEscape(p.name)}"><XS>${fmtNum(p.v.xs)}</XS><XO>${Math.round(fin(p.v.xo))}</XO><YS>${fmtNum(p.v.ys)}</YS><YO>${Math.round(fin(p.v.yo))}</YO></UDim2>`;
    case "ray":
      return `<Ray name="${xmlEscape(p.name)}"><origin><X>${fmtNum(p.v.ox)}</X><Y>${fmtNum(p.v.oy)}</Y><Z>${fmtNum(p.v.oz)}</Z></origin><direction><X>${fmtNum(p.v.dx)}</X><Y>${fmtNum(p.v.dy)}</Y><Z>${fmtNum(p.v.dz)}</Z></direction></Ray>`;
    case "faces":
      return `<Faces name="${xmlEscape(p.name)}"><faces>${Math.round(fin(p.v))}</faces></Faces>`;
    case "axes":
      return `<Axes name="${xmlEscape(p.name)}"><axes>${Math.round(fin(p.v))}</axes></Axes>`;
    case "brickColor":
      return `<BrickColor name="${xmlEscape(p.name)}">${Math.round(fin(p.v))}</BrickColor>`;
    case "vector2":
      return `<Vector2 name="${xmlEscape(p.name)}"><X>${fmtNum(p.v.x)}</X><Y>${fmtNum(p.v.y)}</Y></Vector2>`;
    case "vector2i16":
      return `<Vector2int16 name="${xmlEscape(p.name)}"><X>${Math.round(fin(p.v.x))}</X><Y>${Math.round(fin(p.v.y))}</Y></Vector2int16>`;
    case "vector3i16":
      return `<Vector3int16 name="${xmlEscape(p.name)}"><X>${Math.round(fin(p.v.x))}</X><Y>${Math.round(fin(p.v.y))}</Y><Z>${Math.round(fin(p.v.z))}</Z></Vector3int16>`;
    case "numberSeq": {
      const kps = Array.isArray(p.v) ? p.v : [];
      let inner = "";
      for (const k of kps) inner += `${fmtNum(k.t)} ${fmtNum(k.v)} ${fmtNum(k.e)} `;
      return `<NumberSequence name="${xmlEscape(p.name)}">${inner}</NumberSequence>`;
    }
    case "colorSeq": {
      const kps = Array.isArray(p.v) ? p.v : [];
      let inner = "";
      for (const k of kps) inner += `${fmtNum(k.t)} ${fmtNum(k.r)} ${fmtNum(k.g)} ${fmtNum(k.b)} ${fmtNum(k.e)} `;
      return `<ColorSequence name="${xmlEscape(p.name)}">${inner}</ColorSequence>`;
    }
    case "numberRange":
      return `<NumberRange name="${xmlEscape(p.name)}">${fmtNum(p.v.min)} ${fmtNum(p.v.max)} </NumberRange>`;
    case "rect":
      return `<Rect2D name="${xmlEscape(p.name)}"><min><X>${fmtNum(p.v.minX)}</X><Y>${fmtNum(p.v.minY)}</Y></min><max><X>${fmtNum(p.v.maxX)}</X><Y>${fmtNum(p.v.maxY)}</Y></max></Rect2D>`;
    case "physProps": {
      if (!p.v) return `<PhysicalProperties name="${xmlEscape(p.name)}"><CustomPhysics>false</CustomPhysics></PhysicalProperties>`;
      return `<PhysicalProperties name="${xmlEscape(p.name)}"><CustomPhysics>true</CustomPhysics><Density>${fmtNum(p.v.d)}</Density><Friction>${fmtNum(p.v.f)}</Friction><Elasticity>${fmtNum(p.v.e)}</Elasticity><FrictionWeight>${fmtNum(p.v.fw)}</FrictionWeight><ElasticityWeight>${fmtNum(p.v.ew)}</ElasticityWeight></PhysicalProperties>`;
    }
    case "optionalCFrame": {
      if (!p.v) return `<OptionalCoordinateFrame name="${xmlEscape(p.name)}"></OptionalCoordinateFrame>`;
      const tags = ["X", "Y", "Z", "R00", "R01", "R02", "R10", "R11", "R12", "R20", "R21", "R22"];
      const nums = [p.v.x, p.v.y, p.v.z, ...(p.v.r || [])];
      let inner = "";
      for (let i = 0; i < 12; i++) inner += `<${tags[i]}>${fmtNum(nums[i])}</${tags[i]}>`;
      return `<OptionalCoordinateFrame name="${xmlEscape(p.name)}"><CFrame>${inner}</CFrame></OptionalCoordinateFrame>`;
    }
    case "uniqueId":
      return `<UniqueId name="${xmlEscape(p.name)}">${String(p.v || "").replace(/[^0-9a-fA-F]/g, "")}</UniqueId>`;
    case "font": {
      const f = p.v || {};

      const fam = xmlEscape(f.family || "");
      const face = xmlEscape(f.cachedFaceId || "");
      const weight = Math.round(fin(f.weight)) || 400;
      return `<Font name="${xmlEscape(p.name)}"><Family><url>${fam}</url></Family><Weight>${weight}</Weight><Style>${FONT_STYLES[f.style] || "Normal"}</Style><CachedFaceId><url>${face}</url></CachedFaceId></Font>`;
    }
    case "securityCaps":
      return `<SecurityCapabilities name="${xmlEscape(p.name)}">${toBig(p.v).toString()}</SecurityCapabilities>`;
    case "ref":
      return `<Ref name="${xmlEscape(p.name)}">${p.v == null ? "null" : xmlEscape(p.v)}</Ref>`;
    default:
      return "";
  }
}

export function decodeRbxBinary(bytes) {
  const warnings = [];
  try {
    if (!isRbxBinary(bytes)) return { ok: false, error: "O arquivo não é um binário Roblox válido." };
    if (bytes.length > RBX_LIMITS.maxFileBytes) return { ok: false, error: "O arquivo excede o limite de 50MB." };
    const r = new ByteReader(bytes);
    r.bytes(MAGIC.length);
    const sig = r.bytes(SIGNATURE.length);
    for (let i = 0; i < SIGNATURE.length; i++) {
      if (sig[i] !== SIGNATURE[i]) return { ok: false, error: "Assinatura binária inválida." };
    }
    const version = r.u16();
    if (version !== 0) return { ok: false, error: `Versão binária ${version} não suportada.` };
    r.u32();
    const declaredInstances = r.u32();
    if (declaredInstances > RBX_LIMITS.maxInstances) {
      return { ok: false, error: `Arquivo excede o limite de ${RBX_LIMITS.maxInstances} instâncias.` };
    }
    r.bytes(8);

    const classes = new Map();
    const instances = new Map();
    const parentOf = new Map();
    const sharedStrings = [];
    const sharedStringsRaw = [];
    let skippedPropTypes = 0;
    const skippedTypeIds = new Set();

    const preservedUnknown = [];


    const fileChunks = [];
    const preservedChunks = [];
    let unknownChunks = 0;
    let totalUncompressed = 0;
    let sawEnd = false;

    while (!r.eof() && !sawEnd) {
      const nameBytes = r.bytes(4);
      const name = String.fromCharCode(nameBytes[0], nameBytes[1], nameBytes[2], nameBytes[3]).replace(/\0+$/, "");
      const compLen = r.u32();
      const uncompLen = r.u32();
      r.u32();
      totalUncompressed += uncompLen;
      if (uncompLen > MAX_UNCOMPRESSED_TOTAL || totalUncompressed > MAX_UNCOMPRESSED_TOTAL) {
        return { ok: false, error: "Arquivo binário excede o limite de dados descomprimidos." };
      }
      const payload = compLen === 0 ? r.bytes(uncompLen) : lz4Decompress(r.bytes(compLen), uncompLen);
      const c = new ByteReader(payload);
      if (name === "END") {
        sawEnd = true;
        break;
      }
      if (name === "META") continue;
      if (name === "SSTR") {
        try {
          c.u32();
          const count = c.u32();
          for (let i = 0; i < count && i < 100000; i++) {
            c.bytes(16);



            const len = c.u32();
            if (len > RBX_LIMITS.maxStringLen) throw new Error("String binária excede o limite.");
            const raw = c.bytes(len);
            sharedStrings.push(TD.decode(raw));
            sharedStringsRaw.push(raw);
          }
        } catch (_) {
          warnings.push("Chunk SSTR malformado ignorado.");
        }
        continue;
      }
      if (name === "INST") {
        const cid = c.u32();
        const clsName = c.string(1024);
        const format = c.u8();
        const count = c.u32();
        if (instances.size + count > RBX_LIMITS.maxInstances) {
          return { ok: false, error: `Arquivo excede o limite de ${RBX_LIMITS.maxInstances} instâncias.` };
        }
        const refs = readRefArray(c, count);
        if (format === 1) c.bytes(count);
        classes.set(cid, { name: clsName, refs });
        for (const ref of refs) {
          if (ref < 0) continue;
          instances.set(ref, { className: clsName, props: [] });
        }
        continue;
      }
      if (name === "PROP") {
        const cid = c.u32();
        const cls = classes.get(cid);
        if (!cls) {
          warnings.push("Chunk PROP para classe desconhecida ignorado.");
          continue;
        }
        const propName = c.string(1024);
        const typeId = c.u8();
        const n = cls.refs.length;
        let vals = null;
        try {
          switch (typeId) {
            case TYPE.string: {
              vals = [];


              const isBinary = BINARY_STRING_PROPS.has(propName) || isUnknownPropName(propName);
              for (let i = 0; i < n; i++) {
                if (isBinary) {
                  const len = c.u32();
                  if (len > MAX_SMOOTH_GRID_BYTES) throw new Error("BinaryString excede o limite.");
                  vals.push({ t: "binaryString", v: bytesToBase64(c.bytes(len)) });
                } else {
                  vals.push({ t: "string", v: c.string() });
                }
              }
              break;
            }
            case TYPE.bool: {
              const b = c.bytes(n);
              vals = Array.from(b, (x) => ({ t: "bool", v: x === 1 }));
              break;
            }
            case TYPE.int:
              vals = deinterleaveU32(c, n).map((u) => ({ t: "int", v: unzz(u) }));
              break;
            case TYPE.float:
              vals = readF32Array(c, n).map((v) => ({ t: "float", v }));
              break;
            case TYPE.double: {
              vals = [];
              for (let i = 0; i < n; i++) vals.push({ t: "double", v: c.f64le() });
              break;
            }
            case TYPE.token:
              vals = deinterleaveU32(c, n).map((u) => ({ t: "token", v: u }));
              break;
            case TYPE.int64:
              vals = readI64Array(c, n).map((v) => ({ t: "int64", v }));
              break;
            case TYPE.color3: {
              const rr = readF32Array(c, n);
              const gg = readF32Array(c, n);
              const bb = readF32Array(c, n);
              vals = rr.map((v, i) => ({ t: "color3", v: { r: v, g: gg[i], b: bb[i] } }));
              break;
            }
            case TYPE.color3u8: {
              const rr = c.bytes(n);
              const gg = c.bytes(n);
              const bb = c.bytes(n);
              vals = Array.from(rr, (v, i) => ({ t: "color3u8", v: ((0xff << 24) | (v << 16) | (gg[i] << 8) | bb[i]) >>> 0 }));
              break;
            }
            case TYPE.vector3: {
              const xx = readF32Array(c, n);
              const yy = readF32Array(c, n);
              const zzv = readF32Array(c, n);
              vals = xx.map((v, i) => ({ t: "vector3", v: { x: v, y: yy[i], z: zzv[i] } }));
              break;
            }
            case TYPE.cframe: {
              const mats = [];
              for (let i = 0; i < n; i++) {
                const id = c.u8();
                if (id === 0) {
                  const m = [];
                  for (let k = 0; k < 9; k++) m.push(c.f32le());
                  mats.push(m);
                } else {
                  mats.push(rotationFromId(id));
                }
              }
              const xx = readF32Array(c, n);
              const yy = readF32Array(c, n);
              const zzv = readF32Array(c, n);
              vals = mats.map((m, i) => ({ t: "cframe", v: { x: xx[i], y: yy[i], z: zzv[i], r: m } }));
              break;
            }
            case TYPE.ref: {
              const ids = readRefArray(c, n);
              vals = ids.map((id) => ({ t: "ref", v: id < 0 ? null : "RBX" + id }));
              break;
            }
            case TYPE.udim: {
              const ss = readF32Array(c, n);
              const oo = readI32Array(c, n);
              vals = ss.map((v, i) => ({ t: "udim", v: { s: v, o: oo[i] } }));
              break;
            }
            case TYPE.udim2: {
              const sx = readF32Array(c, n);
              const sy = readF32Array(c, n);
              const ox = readI32Array(c, n);
              const oy = readI32Array(c, n);
              vals = sx.map((v, i) => ({ t: "udim2", v: { xs: v, ys: sy[i], xo: ox[i], yo: oy[i] } }));
              break;
            }
            case TYPE.ray: {
              vals = [];
              for (let i = 0; i < n; i++) {
                vals.push({ t: "ray", v: {
                  ox: c.f32le(), oy: c.f32le(), oz: c.f32le(),
                  dx: c.f32le(), dy: c.f32le(), dz: c.f32le(),
                } });
              }
              break;
            }
            case TYPE.faces: {
              const fb = c.bytes(n);
              vals = Array.from(fb, (x) => ({ t: "faces", v: x & 0x3f }));
              break;
            }
            case TYPE.axes: {
              const ab = c.bytes(n);
              vals = Array.from(ab, (x) => ({ t: "axes", v: x & 0x07 }));
              break;
            }
            case TYPE.brickColor:
              vals = deinterleaveU32(c, n).map((u) => ({ t: "brickColor", v: u >>> 0 }));
              break;
            case TYPE.vector2: {
              const vx = readF32Array(c, n);
              const vy = readF32Array(c, n);
              vals = vx.map((v, i) => ({ t: "vector2", v: { x: v, y: vy[i] } }));
              break;
            }
            case TYPE.vector2i16: {
              vals = [];
              for (let i = 0; i < n; i++) vals.push({ t: "vector2i16", v: { x: c.i16(), y: c.i16() } });
              break;
            }
            case TYPE.vector3i16: {
              vals = [];
              for (let i = 0; i < n; i++) vals.push({ t: "vector3i16", v: { x: c.i16(), y: c.i16(), z: c.i16() } });
              break;
            }
            case TYPE.numberSeq: {
              vals = [];
              for (let i = 0; i < n; i++) {
                const count = c.u32();
                if (count > MAX_SEQ_KEYPOINTS) throw new Error("NumberSequence excede o limite.");
                const kps = [];
                for (let k = 0; k < count; k++) kps.push({ t: c.f32le(), v: c.f32le(), e: c.f32le() });
                vals.push({ t: "numberSeq", v: kps });
              }
              break;
            }
            case TYPE.colorSeq: {
              vals = [];
              for (let i = 0; i < n; i++) {
                const count = c.u32();
                if (count > MAX_SEQ_KEYPOINTS) throw new Error("ColorSequence excede o limite.");
                const kps = [];
                for (let k = 0; k < count; k++) {
                  kps.push({ t: c.f32le(), r: c.f32le(), g: c.f32le(), b: c.f32le(), e: c.f32le() });
                }
                vals.push({ t: "colorSeq", v: kps });
              }
              break;
            }
            case TYPE.numberRange: {
              vals = [];
              for (let i = 0; i < n; i++) vals.push({ t: "numberRange", v: { min: c.f32le(), max: c.f32le() } });
              break;
            }
            case TYPE.rect: {
              const rx0 = readF32Array(c, n);
              const ry0 = readF32Array(c, n);
              const rx1 = readF32Array(c, n);
              const ry1 = readF32Array(c, n);
              vals = rx0.map((v, i) => ({ t: "rect", v: { minX: v, minY: ry0[i], maxX: rx1[i], maxY: ry1[i] } }));
              break;
            }
            case TYPE.physProps: {
              vals = [];
              for (let i = 0; i < n; i++) {
                const custom = c.u8();
                if (!custom) { vals.push({ t: "physProps", v: null }); continue; }
                vals.push({ t: "physProps", v: {
                  d: c.f32le(), f: c.f32le(), e: c.f32le(), fw: c.f32le(), ew: c.f32le(),
                } });
              }
              break;
            }
            case TYPE.optionalCFrame: {
              const inner = c.u8();
              if (inner !== TYPE.cframe) throw new Error("OptionalCFrame com cabeçalho inesperado.");
              const mats = [];
              for (let i = 0; i < n; i++) {
                const id = c.u8();
                if (id === 0) {
                  const m = [];
                  for (let k = 0; k < 9; k++) m.push(c.f32le());
                  mats.push(m);
                } else {
                  mats.push(rotationFromId(id));
                }
              }
              const ox2 = readF32Array(c, n);
              const oy2 = readF32Array(c, n);
              const oz2 = readF32Array(c, n);
              const boolMarker = c.u8();
              if (boolMarker !== TYPE.bool) throw new Error("OptionalCFrame sem marcador de presença.");
              const present = c.bytes(n);
              vals = mats.map((m, i) => ({
                t: "optionalCFrame",
                v: present[i] ? { x: ox2[i], y: oy2[i], z: oz2[i], r: m } : null,
              }));
              break;
            }
            case TYPE.uniqueId:
              vals = readFixedInterleaved(c, n, UNIQUE_ID_BYTES).map((b) => ({ t: "uniqueId", v: bytesToHex(b) }));
              break;
            case TYPE.font: {


              vals = [];
              for (let i = 0; i < n; i++) {
                const family = c.string(1024);
                const weight = c.u16();
                const style = c.u8();
                const cachedFaceId = c.string(1024);
                vals.push({ t: "font", v: { family, weight, style, cachedFaceId } });
              }
              break;
            }
            case TYPE.securityCaps:
              vals = readCapsU64Array(c, n).map((v) => ({ t: "securityCaps", v }));
              break;
            case TYPE.sharedString: {
              const idx = deinterleaveU32(c, n);


              const asBinary = BINARY_STRING_PROPS.has(propName);
              vals = idx.map((i) => {
                if (asBinary) {
                  const raw = sharedStringsRaw[i];
                  return { t: "binaryString", v: raw ? bytesToBase64(raw) : "" };
                }
                return { t: "string", v: sharedStrings[i] != null ? sharedStrings[i] : "" };
              });
              break;
            }
            default: {


              const rec = preservedUnknown.length < RBX_UNKNOWN_LIMITS.maxRecordsPerFile
                ? captureUnknownProp({ propName, typeId, count: n, bytes: payload.subarray(c.pos) })
                : null;
              let attached = false;
              if (rec) {
                for (const ref of cls.refs) {
                  const inst = instances.get(ref);
                  if (!inst) continue;
                  if (inst.props.length < RBX_LIMITS.maxPropsPerItem) {
                    inst.props.push({ name: unknownPropName(rec), t: "binaryString", v: rec.b64 });
                    preservedUnknown.push(`${cls.name}.${propName} (id 0x${typeId.toString(16)})`);
                    attached = true;
                  }
                  break;
                }
              }
              if (!attached) {
                skippedPropTypes += 1;
                skippedTypeIds.add(typeId);
              }
              continue;
            }
          }
        } catch (e) {
          warnings.push(`Propriedade "${propName}" malformada ignorada.`);
          continue;
        }
        for (let i = 0; i < n; i++) {
          const inst = instances.get(cls.refs[i]);
          if (!inst || !vals[i] || inst.props.length >= RBX_LIMITS.maxPropsPerItem) continue;
          inst.props.push({ name: propName, t: vals[i].t, v: vals[i].v });
        }
        continue;
      }
      if (name === "PRNT") {
        c.u8();
        const count = c.u32();
        const children = readRefArray(c, count);
        const parents = readRefArray(c, count);
        for (let i = 0; i < count; i++) parentOf.set(children[i], parents[i]);
        continue;
      }


      const chunkRec = fileChunks.length < RBX_UNKNOWN_LIMITS.maxFileChunks
        ? captureUnknownChunk({
            name: String.fromCharCode(nameBytes[0], nameBytes[1], nameBytes[2], nameBytes[3]),
            bytes: payload,
          })
        : null;
      if (chunkRec) {
        fileChunks.push(chunkRec);
        preservedChunks.push(`${unknownChunkLabel(chunkRec)} (${payload.length} bytes)`);
      } else {
        unknownChunks += 1;
      }
    }

    if (!sawEnd) return { ok: false, error: "Arquivo binário incompleto (END ausente)." };
    if (!instances.size) return { ok: false, error: "O arquivo não contém instâncias." };

    const childrenOf = new Map();
    const roots = [];
    for (const ref of instances.keys()) {
      const p = parentOf.has(ref) ? parentOf.get(ref) : -1;
      if (p < 0 || !instances.has(p) || p === ref) {
        roots.push(ref);
        continue;
      }
      if (!childrenOf.has(p)) childrenOf.set(p, []);
      childrenOf.get(p).push(ref);
    }

    const out = [
      '<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" ' +
        'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" ' +
        'xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">',
    ];
    const visited = new Set();
    let emitted = 0;
    let badProps = 0;
    const emit = (ref, depth) => {
      if (visited.has(ref) || depth > RBX_LIMITS.maxDepth) return;
      visited.add(ref);
      const inst = instances.get(ref);
      emitted += 1;
      out.push(`<Item class="${xmlEscape(inst.className)}" referent="RBX${ref}">`);
      out.push("<Properties>");
      for (const p of inst.props) {
        let xml = "";
        try {
          xml = propXml(p);
        } catch (_) {
          badProps += 1;
        }
        if (xml) out.push(xml);
      }
      out.push("</Properties>");
      for (const ch of childrenOf.get(ref) || []) emit(ch, depth + 1);
      out.push("</Item>");
    };
    for (const ref of roots) emit(ref, 1);
    out.push("</roblox>");

    if (visited.size < instances.size) {
      warnings.push(`${instances.size - visited.size} instância(s) com parentesco cíclico ou inválido ignorada(s).`);
    }
    if (badProps > 0) {
      warnings.push(`${badProps} propriedade(s) com valor inválido não foram escritas no XML.`);
    }
    if (preservedUnknown.length > 0) {
      const sample = preservedUnknown.slice(0, 8).join(", ");
      const extra = preservedUnknown.length > 8 ? ` e mais ${preservedUnknown.length - 8}` : "";
      warnings.push(
        `${preservedUnknown.length} propriedade(s) com type id fora do formato preservada(s) byte a byte e reemitida(s) no export: ${sample}${extra}.`,
      );
    }
    if (skippedPropTypes > 0) {
      const ids = [...skippedTypeIds].map((id) => "0x" + id.toString(16)).join(", ");
      warnings.push(`${skippedPropTypes} propriedade(s) com type id fora do formato (${ids}) foram ignoradas por exceder os limites de preservação.`);
    }
    if (preservedChunks.length > 0) {
      warnings.push(
        `${preservedChunks.length} chunk(s) desconhecido(s) preservado(s) byte a byte e reemitido(s) no Export .rbxl: ${preservedChunks.join(", ")}.`,
      );
    }
    if (unknownChunks > 0) {
      warnings.push(`${unknownChunks} chunk(s) desconhecido(s) ignorado(s).`);
    }
    return { ok: true, xml: out.join("\n"), warnings, count: emitted, fileChunks };
  } catch (e) {
    return { ok: false, error: "Binário malformado: " + ((e && e.message) || "erro desconhecido."), warnings };
  }
}
