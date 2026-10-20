import {
  LuaTable,
  LuaFunction,
  nativeFn,
  LuaError,
  luaTypeName,
} from "./interpreter.js";
import { epochSecondsFromDateTable } from "./osDateTable.js";

const MAX_PACK_BYTES = 1024 * 1024;
const MAX_BUFFER_BYTES = 16 * 1024 * 1024;


const PERM = (() => {
  const base = new Uint8Array(256);
  for (let i = 0; i < 256; i++) base[i] = i;
  let seed = 1103515245;
  for (let i = 255; i > 0; i--) {
    seed = (seed * 1103515245 + 12345) >>> 0;
    const j = seed % (i + 1);
    const t = base[i];
    base[i] = base[j];
    base[j] = t;
  }
  const p = new Uint8Array(512);
  for (let i = 0; i < 512; i++) p[i] = base[i & 255];
  return p;
})();

function fade(t) {
  return t * t * t * (t * (t * 6 - 15) + 10);
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function grad(hash, x, y, z) {
  const h = hash & 15;
  const u = h < 8 ? x : y;
  const v = h < 4 ? y : (h === 12 || h === 14 ? x : z);
  return ((h & 1) === 0 ? u : -u) + ((h & 2) === 0 ? v : -v);
}

function perlin(x, y, z) {
  const X = Math.floor(x) & 255;
  const Y = Math.floor(y) & 255;
  const Z = Math.floor(z) & 255;
  x -= Math.floor(x);
  y -= Math.floor(y);
  z -= Math.floor(z);
  const u = fade(x);
  const v = fade(y);
  const w = fade(z);
  const A = PERM[X] + Y;
  const AA = PERM[A] + Z;
  const AB = PERM[A + 1] + Z;
  const B = PERM[X + 1] + Y;
  const BA = PERM[B] + Z;
  const BB = PERM[B + 1] + Z;
  return lerp(
    lerp(
      lerp(grad(PERM[AA], x, y, z), grad(PERM[BA], x - 1, y, z), u),
      lerp(grad(PERM[AB], x, y - 1, z), grad(PERM[BB], x - 1, y - 1, z), u),
      v,
    ),
    lerp(
      lerp(grad(PERM[AA + 1], x, y, z - 1), grad(PERM[BA + 1], x - 1, y, z - 1), u),
      lerp(grad(PERM[AB + 1], x, y - 1, z - 1), grad(PERM[BB + 1], x - 1, y - 1, z - 1), u),
      v,
    ),
    w,
  );
}


function strToBytes(s) {
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i) & 0xff;
  return out;
}

function bytesToStr(u8) {
  let s = "";
  const CHUNK = 0x8000;
  for (let i = 0; i < u8.length; i += CHUNK) {
    s += String.fromCharCode.apply(null, u8.subarray(i, Math.min(i + CHUNK, u8.length)));
  }
  return s;
}

function intToBytesLE(value, size) {
  let v = Math.trunc(Number(value) || 0);
  if (v < 0) v += Math.pow(2, size * 8);
  const out = new Array(size);
  for (let i = 0; i < size; i++) {
    out[i] = v % 256;
    v = Math.floor(v / 256);
  }
  return out;
}

function bytesToInt(bytes, pos, size, little, signed) {
  let v = 0;
  if (little) {
    for (let i = size - 1; i >= 0; i--) v = v * 256 + bytes[pos + i];
  } else {
    for (let i = 0; i < size; i++) v = v * 256 + bytes[pos + i];
  }
  if (signed) {
    const max = Math.pow(2, size * 8);
    if (v >= max / 2) v -= max;
  }
  return v;
}

function clampIntSize(n) {
  if (!Number.isFinite(n) || n < 1 || n > 8) {
    throw new LuaError("string.pack: tamanho de inteiro deve estar entre 1 e 8");
  }
  return Math.floor(n);
}

function parsePackFormat(fmt) {
  const ops = [];
  const s = String(fmt);
  let little = true;
  let i = 0;
  while (i < s.length) {
    const c = s[i++];
    if (c === "<" || c === "=") { little = true; continue; }
    if (c === ">") { little = false; continue; }
    if (c === "!" || c === " ") continue;
    let digits = "";
    while (i < s.length && s[i] >= "0" && s[i] <= "9") digits += s[i++];
    const n = digits ? parseInt(digits, 10) : null;
    switch (c) {
      case "b": ops.push({ t: "int", size: 1, signed: true, little }); break;
      case "B": ops.push({ t: "int", size: 1, signed: false, little }); break;
      case "h": ops.push({ t: "int", size: 2, signed: true, little }); break;
      case "H": ops.push({ t: "int", size: 2, signed: false, little }); break;
      case "i": ops.push({ t: "int", size: clampIntSize(n === null ? 4 : n), signed: true, little }); break;
      case "I": ops.push({ t: "int", size: clampIntSize(n === null ? 4 : n), signed: false, little }); break;
      case "l": case "j": ops.push({ t: "int", size: 8, signed: true, little }); break;
      case "L": case "J": case "T": ops.push({ t: "int", size: 8, signed: false, little }); break;
      case "f": ops.push({ t: "f32", little }); break;
      case "d": case "n": ops.push({ t: "f64", little }); break;
      case "s": ops.push({ t: "str", sizeSize: clampIntSize(n === null ? 4 : n), little }); break;
      case "z": ops.push({ t: "zstr" }); break;
      case "x": ops.push({ t: "pad" }); break;
      case "c":
        if (n === null) throw new LuaError("string.pack: 'c' requer tamanho fixo (ex.: c8)");
        if (n > MAX_PACK_BYTES) throw new LuaError("string.pack: tamanho de 'c' excede 1MB");
        ops.push({ t: "cstr", size: n });
        break;
      default:
        throw new LuaError(`string.pack: op\u00e7\u00e3o de formato inv\u00e1lida '${c}'`);
    }
  }
  return ops;
}

const floatScratch = new DataView(new ArrayBuffer(8));

function pushFloat(bytes, value, size, little) {
  if (size === 4) floatScratch.setFloat32(0, Number(value) || 0, little);
  else floatScratch.setFloat64(0, Number(value) || 0, little);
  for (let i = 0; i < size; i++) bytes.push(floatScratch.getUint8(i));
}

function readFloat(bytes, pos, size, little) {
  for (let i = 0; i < size; i++) floatScratch.setUint8(i, bytes[pos + i]);
  return size === 4 ? floatScratch.getFloat32(0, little) : floatScratch.getFloat64(0, little);
}


function isBuffer(v) {
  return !!v && v.__ud === "buffer" && v.u8 instanceof Uint8Array;
}

function bufArg(v, name) {
  if (!isBuffer(v)) throw new LuaError(`buffer.${name}: buffer esperado`);
  return v;
}

function bufOffset(b, offset, count, name) {
  const o = Math.trunc(Number(offset));
  if (!Number.isFinite(o) || o < 0 || o + count > b.u8.length) {
    throw new LuaError(`buffer.${name}: acesso fora dos limites (offset ${offset}, count ${count}, tamanho ${b.u8.length})`);
  }
  return o;
}

function makeBuffer(size) {
  const n = Math.trunc(Number(size));
  if (!Number.isFinite(n) || n < 0 || n > MAX_BUFFER_BYTES) {
    throw new LuaError(`buffer.create: tamanho inv\u00e1lido (0 a ${MAX_BUFFER_BYTES})`);
  }
  const u8 = new Uint8Array(n);
  return { __ud: "buffer", u8, dv: new DataView(u8.buffer) };
}

export function installStdlibExtras(interp) {
  const G = interp.globals;
  const set = (name, value) => G.rawset(name, value);
  const num = (v) => interp.tonumber(v);
  const isCallable = (v) => v instanceof LuaFunction || (v && v.__native);


  const table = G.rawget("table");
  table.rawset("move", nativeFn((a) => {
    const a1 = a[0];
    if (!(a1 instanceof LuaTable)) throw new LuaError("bad argument #1 to 'move' (table expected)");
    const f = Math.trunc(num(a[1]) || 0);
    const e = Math.trunc(num(a[2]) || 0);
    const t = Math.trunc(num(a[3]) || 0);
    const a2 = a[4] === undefined ? a1 : a[4];
    if (!(a2 instanceof LuaTable)) throw new LuaError("bad argument #5 to 'move' (table expected)");
    if (e - f > 1000000) throw new LuaError("table.move: faixa grande demais (m\u00e1x. 1e6 elementos)");
    if (e >= f) {
      if (t > f && a1 === a2) {
        for (let k = e; k >= f; k--) a2.rawset(t + (k - f), a1.rawget(k));
      } else {
        for (let k = f; k <= e; k++) a2.rawset(t + (k - f), a1.rawget(k));
      }
    }
    return [a2];
  }, "table.move"));
  table.rawset("freeze", nativeFn((a) => {
    const t = a[0];
    if (!(t instanceof LuaTable)) throw new LuaError("bad argument #1 to 'freeze' (table expected)");
    t.frozen = true;
    return [t];
  }, "table.freeze"));
  table.rawset("isfrozen", nativeFn((a) => {
    const t = a[0];
    if (!(t instanceof LuaTable)) throw new LuaError("bad argument #1 to 'isfrozen' (table expected)");
    return [t.frozen === true];
  }, "table.isfrozen"));
  table.rawset("clone", nativeFn((a) => {
    const t = a[0];
    if (!(t instanceof LuaTable)) throw new LuaError("bad argument #1 to 'clone' (table expected)");
    const out = new LuaTable();
    for (const [k, v] of t.map) out.map.set(k, v);
    out.metatable = t.metatable;
    return [out];
  }, "table.clone"));
  table.rawset("find", nativeFn((a) => {
    const t = a[0];
    if (!(t instanceof LuaTable)) throw new LuaError("bad argument #1 to 'find' (table expected)");
    const init = a[2] === undefined ? 1 : Math.max(1, Math.trunc(num(a[2]) || 1));
    const len = t.length();
    for (let k = init; k <= len; k++) {
      if (t.rawget(k) === a[1]) return [k];
    }
    return [];
  }, "table.find"));
  table.rawset("clear", nativeFn((a) => {
    const t = a[0];
    if (!(t instanceof LuaTable)) throw new LuaError("bad argument #1 to 'clear' (table expected)");
    if (t.frozen) throw new LuaError("attempt to modify a frozen table");
    t.map.clear();
    return [];
  }, "table.clear"));


  const math = G.rawget("math");
  math.rawset("atan", nativeFn((a) => {
    const y = num(a[0]);
    if (a[1] !== undefined) return [Math.atan2(y, num(a[1]))];
    return [Math.atan(y)];
  }, "math.atan"));
  math.rawset("noise", nativeFn((a) => {
    const x = num(a[0]) || 0;
    const y = a[1] === undefined ? 0 : (num(a[1]) || 0);
    const z = a[2] === undefined ? 0 : (num(a[2]) || 0);
    return [perlin(x, y, z)];
  }, "math.noise"));
  math.rawset("map", nativeFn((a) => {
    const x = num(a[0]) || 0;
    const inMin = num(a[1]) || 0;
    const inMax = num(a[2]) || 0;
    const outMin = num(a[3]) || 0;
    const outMax = num(a[4]) || 0;
    const span = inMax - inMin;
    if (span === 0) return [outMin];
    return [outMin + ((x - inMin) / span) * (outMax - outMin)];
  }, "math.map"));


  const string = G.rawget("string");
  string.rawset("match", nativeFn((a) => {
    const s = String(a[0]);
    let init = a[2] === undefined ? 1 : Math.trunc(num(a[2]) || 1);
    if (init < 0) init = Math.max(s.length + init + 1, 1);
    if (init < 1) init = 1;
    const slice = s.slice(init - 1);
    const re = buildLuaRegex(String(a[1]), "");
    const m = re.exec(slice);
    if (!m) return [];
    return m.length > 1 ? m.slice(1) : [m[0]];
  }, "string.match"));

  function buildLuaRegex(pat, flags) {
    const CLASS_MAP = {
      a: "A-Za-z", A: "^A-Za-z",
      d: "0-9", D: "^0-9",
      l: "a-z", L: "^a-z",
      u: "A-Z", U: "^A-Z",
      s: "\\s", S: "\\S",
      w: "0-9A-Za-z", W: "^0-9A-Za-z",
      p: "!-/:-@\\[-`{-~", P: "^!-/:-@\\[-`{-~", x: "0-9A-Fa-f", X: "^0-9A-Fa-f",
      c: "\\x00-\\x1f\\x7f", C: "^\\x00-\\x1f\\x7f",
      g: "\\x21-\\x7e", G: "^\\x21-\\x7e",
    };
    let out = "";
    let i = 0;
    const n = pat.length;
    while (i < n) {
      const c = pat[i];
      if (c === "%") {
        const nx = pat[i + 1];
        if (nx === undefined) throw new LuaError("malformed pattern (ends with '%')");
        if (nx === "b" || nx === "f") {
          throw new LuaError(`pattern '%${nx}' n\u00e3o \u00e9 suportado neste runtime`);
        }
        if (CLASS_MAP[nx]) out += "[" + CLASS_MAP[nx] + "]";
        else out += "\\" + nx;
        i += 2;
        continue;
      }
      if (c === "[") {
        out += "[";
        i++;
        if (pat[i] === "^") { out += "^"; i++; }
        while (i < n && pat[i] !== "]") {
          if (pat[i] === "%" && CLASS_MAP[pat[i + 1]]) {
            const cls = CLASS_MAP[pat[i + 1]];



            if (cls[0] === "^") {
              if (pat[i + 1] === "D") { out += "\\D"; i += 2; continue; }
              throw new LuaError(`pattern: classe negada '%${pat[i + 1]}' dentro de '[]' não é suportada neste runtime`);
            }
            out += cls; i += 2;
          }
          else if (pat[i] === "%") { out += "\\" + pat[i + 1]; i += 2; }
          else { out += pat[i]; i++; }
        }
        out += "]";
        i++;
        continue;
      }
      if (c === "-") { out += "*?"; i++; continue; }
      if ("().+*?".includes(c)) { out += c; i++; continue; }
      if (c === "^") { out += i === 0 ? "^" : "\\^"; i++; continue; }
      if (c === "$") { out += i === n - 1 ? "$" : "\\$"; i++; continue; }
      if ("{}|\\/".includes(c)) out += "\\" + c;
      else out += c;
      i++;
    }

    return new RegExp(out, flags + "s");
  }

  string.rawset("pack", nativeFn((a) => {
    const ops = parsePackFormat(a[0]);
    const bytes = [];
    let ai = 1;
    for (const op of ops) {
      if (bytes.length > MAX_PACK_BYTES) throw new LuaError("string.pack: resultado excede 1MB");
      if (op.t === "pad") { bytes.push(0); continue; }
      const val = a[ai++];
      if (op.t === "int") {
        const le = intToBytesLE(num(val) || 0, op.size);
        if (!op.little) le.reverse();
        for (const b of le) bytes.push(b);
      } else if (op.t === "f32") {
        pushFloat(bytes, num(val) || 0, 4, op.little);
      } else if (op.t === "f64") {
        pushFloat(bytes, num(val) || 0, 8, op.little);
      } else if (op.t === "str") {
        const sv = String(val === undefined ? "" : val);
        const le = intToBytesLE(sv.length, op.sizeSize);
        if (!op.little) le.reverse();
        for (const b of le) bytes.push(b);
        for (const b of strToBytes(sv)) bytes.push(b);
      } else if (op.t === "zstr") {
        const sv = String(val === undefined ? "" : val);
        if (sv.indexOf("\0") >= 0) throw new LuaError("string.pack: 'z' n\u00e3o aceita zeros embutidos");
        for (const b of strToBytes(sv)) bytes.push(b);
        bytes.push(0);
      } else if (op.t === "cstr") {
        const sv = String(val === undefined ? "" : val);
        if (sv.length > op.size) throw new LuaError("string.pack: string maior que o tamanho de 'c'");
        for (const b of strToBytes(sv)) bytes.push(b);
        for (let k = sv.length; k < op.size; k++) bytes.push(0);
      }
    }
    if (bytes.length > MAX_PACK_BYTES) throw new LuaError("string.pack: resultado excede 1MB");
    return [bytesToStr(Uint8Array.from(bytes))];
  }, "string.pack"));

  string.rawset("packsize", nativeFn((a) => {
    const ops = parsePackFormat(a[0]);
    let total = 0;
    for (const op of ops) {
      if (op.t === "pad") total += 1;
      else if (op.t === "int") total += op.size;
      else if (op.t === "f32") total += 4;
      else if (op.t === "f64") total += 8;
      else if (op.t === "cstr") total += op.size;
      else throw new LuaError("string.packsize: formato de tamanho vari\u00e1vel ('s'/'z') n\u00e3o \u00e9 permitido");
    }
    return [total];
  }, "string.packsize"));

  string.rawset("unpack", nativeFn((a) => {
    const ops = parsePackFormat(a[0]);
    const bytes = strToBytes(String(a[1] === undefined ? "" : a[1]));
    let pos = a[2] === undefined ? 0 : Math.max(0, Math.trunc(num(a[2]) || 1) - 1);
    const out = [];
    const need = (count, what) => {
      if (pos + count > bytes.length) throw new LuaError(`string.unpack: dados insuficientes para '${what}'`);
    };
    for (const op of ops) {
      if (op.t === "pad") { need(1, "x"); pos += 1; continue; }
      if (op.t === "int") {
        need(op.size, "inteiro");
        out.push(bytesToInt(bytes, pos, op.size, op.little, op.signed));
        pos += op.size;
      } else if (op.t === "f32") {
        need(4, "float");
        out.push(readFloat(bytes, pos, 4, op.little));
        pos += 4;
      } else if (op.t === "f64") {
        need(8, "double");
        out.push(readFloat(bytes, pos, 8, op.little));
        pos += 8;
      } else if (op.t === "str") {
        need(op.sizeSize, "tamanho de string");
        const len = bytesToInt(bytes, pos, op.sizeSize, op.little, false);
        pos += op.sizeSize;
        need(len, "string");
        out.push(bytesToStr(bytes.subarray(pos, pos + len)));
        pos += len;
      } else if (op.t === "zstr") {
        let end = pos;
        while (end < bytes.length && bytes[end] !== 0) end++;
        if (end >= bytes.length) throw new LuaError("string.unpack: 'z' sem terminador zero");
        out.push(bytesToStr(bytes.subarray(pos, end)));
        pos = end + 1;
      } else if (op.t === "cstr") {
        need(op.size, "c");
        out.push(bytesToStr(bytes.subarray(pos, pos + op.size)));
        pos += op.size;
      }
    }
    out.push(pos + 1);
    return out;
  }, "string.unpack"));


  const utf8 = new LuaTable();
  const uset = (k, v) => utf8.rawset(k, v);
  uset("charpattern", "[\0-\x7F\xC2-\xFD][\x80-\xBF]*");
  uset("char", nativeFn((a) => {
    const cps = a.map((v) => {
      const n = Math.trunc(num(v));
      if (!Number.isFinite(n) || n < 0 || n > 0x10ffff) throw new LuaError("utf8.char: codepoint inv\u00e1lido");
      return n;
    });
    return [String.fromCodePoint(...cps)];
  }, "utf8.char"));
  uset("codepoint", nativeFn((a) => {
    const s = String(a[0]);
    let i = a[1] === undefined ? 1 : Math.trunc(num(a[1]) || 1);
    let j = a[2] === undefined ? i : Math.trunc(num(a[2]) || i);
    if (i < 0) i = s.length + i + 1;
    if (j < 0) j = s.length + j + 1;
    const out = [];
    let pos = i - 1;
    while (pos < j && pos < s.length) {
      const cp = s.codePointAt(pos);
      if (cp === undefined) break;
      out.push(cp);
      pos += cp > 0xffff ? 2 : 1;
    }
    return out;
  }, "utf8.codepoint"));
  uset("codes", nativeFn((a) => {
    const s = String(a[0]);
    let pos = 0;
    const iter = nativeFn(() => {
      if (pos >= s.length) return [];
      const cp = s.codePointAt(pos);
      const at = pos + 1;
      pos += cp > 0xffff ? 2 : 1;
      return [at, cp];
    }, "utf8.codes_iter");
    return [iter, s, 0];
  }, "utf8.codes"));
  uset("len", nativeFn((a) => {
    const s = String(a[0]);
    let i = a[1] === undefined ? 1 : Math.trunc(num(a[1]) || 1);
    let j = a[2] === undefined ? -1 : Math.trunc(num(a[2]) || -1);
    const n = s.length;
    if (i < 0) i = n + i + 1;
    if (j < 0) j = n + j + 1;
    if (i < 1) i = 1;
    if (j > n) j = n;
    let count = 0;
    let pos = i - 1;
    while (pos < j) {
      const cp = s.codePointAt(pos);
      if (cp === undefined) break;
      count++;
      pos += cp > 0xffff ? 2 : 1;
    }
    return [count];
  }, "utf8.len"));
  uset("offset", nativeFn((a) => {
    const s = String(a[0]);
    const nArg = Math.trunc(num(a[1]) || 0);
    let i = a[2] === undefined ? (nArg >= 0 ? 1 : s.length + 1) : Math.trunc(num(a[2]) || 1);
    if (i < 1) i = 1;
    if (nArg === 0) return [i];
    if (nArg > 0) {
      let pos = i - 1;
      let remaining = nArg - 1;
      while (remaining > 0 && pos < s.length) {
        const cp = s.codePointAt(pos);
        pos += cp > 0xffff ? 2 : 1;
        remaining--;
      }
      if (remaining > 0 || pos > s.length) return [undefined];
      return [pos + 1];
    }
    let pos = i - 1;
    let remaining = -nArg;
    while (remaining > 0 && pos > 0) {
      pos--;
      const code = s.charCodeAt(pos);
      if (code >= 0xdc00 && code <= 0xdfff && pos > 0) pos--;
      remaining--;
    }
    if (remaining > 0) return [undefined];
    return [pos + 1];
  }, "utf8.offset"));
  uset("nfcnormalize", nativeFn((a) => [String(a[0]).normalize("NFC")], "utf8.nfcnormalize"));
  uset("nfdnormalize", nativeFn((a) => [String(a[0]).normalize("NFD")], "utf8.nfdnormalize"));
  uset("graphemes", nativeFn((a) => {
    const s = String(a[0]);
    const segments = [];
    if (typeof Intl !== "undefined" && typeof Intl.Segmenter === "function") {
      const seg = new Intl.Segmenter("und", { granularity: "grapheme" });
      for (const part of seg.segment(s)) {
        segments.push([part.index + 1, part.index + part.segment.length]);
      }
    } else {
      let pos = 0;
      while (pos < s.length) {
        const cp = s.codePointAt(pos);
        const size = cp > 0xffff ? 2 : 1;
        segments.push([pos + 1, pos + size]);
        pos += size;
      }
    }
    let idx = 0;
    const iter = nativeFn(() => {
      if (idx >= segments.length) return [];
      const seg = segments[idx++];
      return [seg[0], seg[1]];
    }, "utf8.graphemes_iter");
    return [iter];
  }, "utf8.graphemes"));
  set("utf8", utf8);


  const buffer = new LuaTable();
  const bset = (k, v) => buffer.rawset(k, v);
  bset("create", nativeFn((a) => [makeBuffer(num(a[0]) || 0)], "buffer.create"));
  bset("fromstring", nativeFn((a) => {
    const u8 = strToBytes(String(a[0] === undefined ? "" : a[0]));
    if (u8.length > MAX_BUFFER_BYTES) throw new LuaError("buffer.fromstring: string grande demais");
    return [{ __ud: "buffer", u8, dv: new DataView(u8.buffer) }];
  }, "buffer.fromstring"));
  bset("tostring", nativeFn((a) => [bytesToStr(bufArg(a[0], "tostring").u8)], "buffer.tostring"));
  bset("len", nativeFn((a) => [bufArg(a[0], "len").u8.length], "buffer.len"));
  bset("copy", nativeFn((a) => {
    const target = bufArg(a[0], "copy");
    const source = bufArg(a[2], "copy");
    const sourceOffset = a[3] === undefined ? 0 : Math.trunc(num(a[3]) || 0);
    const count = a[4] === undefined ? source.u8.length - sourceOffset : Math.trunc(num(a[4]) || 0);
    if (count < 0) throw new LuaError("buffer.copy: count negativo");
    const so = bufOffset(source, sourceOffset, count, "copy");
    const to = bufOffset(target, a[1], count, "copy");
    target.u8.set(source.u8.subarray(so, so + count), to);
    return [];
  }, "buffer.copy"));
  bset("fill", nativeFn((a) => {
    const b = bufArg(a[0], "fill");
    const value = Math.trunc(num(a[2]) || 0) & 0xff;
    const offset = Math.trunc(num(a[1]) || 0);
    const count = a[3] === undefined ? b.u8.length - offset : Math.trunc(num(a[3]) || 0);
    if (count < 0) throw new LuaError("buffer.fill: count negativo");
    const o = bufOffset(b, offset, count, "fill");
    b.u8.fill(value, o, o + count);
    return [];
  }, "buffer.fill"));
  const readers = [
    ["readi8", 1, (b, o) => b.dv.getInt8(o)],
    ["readu8", 1, (b, o) => b.dv.getUint8(o)],
    ["readi16", 2, (b, o) => b.dv.getInt16(o, true)],
    ["readu16", 2, (b, o) => b.dv.getUint16(o, true)],
    ["readi32", 4, (b, o) => b.dv.getInt32(o, true)],
    ["readu32", 4, (b, o) => b.dv.getUint32(o, true)],
    ["readf32", 4, (b, o) => b.dv.getFloat32(o, true)],
    ["readf64", 8, (b, o) => b.dv.getFloat64(o, true)],
  ];
  for (const [name, size, fn] of readers) {
    bset(name, nativeFn((a) => {
      const b = bufArg(a[0], name);
      const o = bufOffset(b, a[1], size, name);
      return [fn(b, o)];
    }, "buffer." + name));
  }
  const writers = [
    ["writei8", 1, (b, o, v) => b.dv.setInt8(o, v)],
    ["writeu8", 1, (b, o, v) => b.dv.setUint8(o, v)],
    ["writei16", 2, (b, o, v) => b.dv.setInt16(o, v, true)],
    ["writeu16", 2, (b, o, v) => b.dv.setUint16(o, v, true)],
    ["writei32", 4, (b, o, v) => b.dv.setInt32(o, v, true)],
    ["writeu32", 4, (b, o, v) => b.dv.setUint32(o, v, true)],
    ["writef32", 4, (b, o, v) => b.dv.setFloat32(o, v, true)],
    ["writef64", 8, (b, o, v) => b.dv.setFloat64(o, v, true)],
  ];
  for (const [name, size, fn] of writers) {
    bset(name, nativeFn((a) => {
      const b = bufArg(a[0], name);
      const o = bufOffset(b, a[1], size, name);
      fn(b, o, num(a[2]) || 0);
      return [];
    }, "buffer." + name));
  }
  bset("readstring", nativeFn((a) => {
    const b = bufArg(a[0], "readstring");
    const count = Math.max(0, Math.trunc(num(a[2]) || 0));
    const o = bufOffset(b, a[1], count, "readstring");
    return [bytesToStr(b.u8.subarray(o, o + count))];
  }, "buffer.readstring"));
  bset("writestring", nativeFn((a) => {
    const b = bufArg(a[0], "writestring");
    const sv = String(a[2] === undefined ? "" : a[2]);
    const count = a[3] === undefined ? sv.length : Math.max(0, Math.trunc(num(a[3]) || 0));
    if (count > sv.length) throw new LuaError("buffer.writestring: count maior que a string");
    const o = bufOffset(b, a[1], count, "writestring");
    for (let i = 0; i < count; i++) b.u8[o + i] = sv.charCodeAt(i) & 0xff;
    return [];
  }, "buffer.writestring"));
  set("buffer", buffer);


  const coStack = [];
  const coErrorMessage = (e) => {
    if (e instanceof LuaError) return e.luaMessage;
    return String(e && e.message ? e.message : e);
  };

  function* coResume(co, args) {
    if (!co || co.__coroutine !== true) {
      throw new LuaError("bad argument #1 to 'resume' (coroutine expected)");
    }
    if (co.status === "dead") return [false, "cannot resume dead coroutine"];
    if (co.status !== "suspended") return [false, "cannot resume non-suspended coroutine"];
    let input;
    if (!co.gen) {
      co.gen = interp.call(co.fn, args, 0);
      input = undefined;
    } else {
      input = args;
    }
    const parent = coStack.length ? coStack[coStack.length - 1] : null;
    if (parent) parent.status = "normal";
    co.status = "running";
    coStack.push(co);
    try {
      for (;;) {
        let step;
        try {
          step = co.gen.next(input);
        } catch (e) {
          co.status = "dead";
          return [false, coErrorMessage(e)];
        }
        if (step.done) {
          co.status = "dead";
          return [true, ...(Array.isArray(step.value) ? step.value : [])];
        }
        const cmd = step.value;
        if (cmd && cmd.kind === "coyield") {
          co.status = "suspended";
          return [true, ...(cmd.values || [])];
        }



        const stackIdx = coStack.lastIndexOf(co);
        if (stackIdx >= 0) coStack.splice(stackIdx, 1);
        try {
          input = yield cmd;
        } finally {
          coStack.push(co);
        }
      }
    } finally {
      const i = coStack.lastIndexOf(co);
      if (i >= 0) coStack.splice(i, 1);
      if (parent) parent.status = "running";
    }
  }

  const coroutine = new LuaTable();
  coroutine.rawset("create", nativeFn((a) => {
    if (!isCallable(a[0])) throw new LuaError("bad argument #1 to 'create' (function expected)");
    return [{ __coroutine: true, status: "suspended", fn: a[0], gen: null }];
  }, "coroutine.create"));
  coroutine.rawset("resume", nativeFn(function* (a) {
    return yield* coResume(a[0], a.slice(1));
  }, "coroutine.resume", true));
  coroutine.rawset("yield", nativeFn(function* (args) {
    if (!coStack.length) {
      yield { kind: "wait", seconds: 0 };
      return [];
    }
    const sent = yield { kind: "coyield", values: args.slice() };
    return Array.isArray(sent) ? sent : [];
  }, "coroutine.yield", true));
  coroutine.rawset("status", nativeFn((a) => {
    const co = a[0];
    if (!co || co.__coroutine !== true) throw new LuaError("bad argument #1 to 'status' (coroutine expected)");
    return [co.status];
  }, "coroutine.status"));
  coroutine.rawset("wrap", nativeFn((a) => {
    if (!isCallable(a[0])) throw new LuaError("bad argument #1 to 'wrap' (function expected)");
    const co = { __coroutine: true, status: "suspended", fn: a[0], gen: null };
    return [nativeFn(function* (args) {
      const res = yield* coResume(co, args);
      if (res[0] !== true) throw new LuaError(res[1]);
      return res.slice(1);
    }, "coroutine.wrap", true)];
  }, "coroutine.wrap"));
  coroutine.rawset("isyieldable", nativeFn(() => [true], "coroutine.isyieldable"));
  coroutine.rawset("running", nativeFn(() => {
    const top = coStack.length ? coStack[coStack.length - 1] : undefined;
    return [top, coStack.length === 0];
  }, "coroutine.running"));


  coroutine.rawset("close", nativeFn((a) => {
    const co = a[0];
    if (!co || co.__coroutine !== true) throw new LuaError("bad argument #1 to 'close' (coroutine expected)");
    if (co.status === "running") throw new LuaError("cannot close a running coroutine");
    if (co.status !== "dead") {
      co.status = "dead";
      if (co.gen) {
        try { co.gen.return(undefined); } catch (_) {                            }
        co.gen = null;
      }
    }
    return [true];
  }, "coroutine.close"));
  set("coroutine", coroutine);


  set("load", nativeFn((a) => {
    if (typeof a[0] !== "string") {
      return [undefined, "load: apenas chunks em string s\u00e3o suportados"];
    }
    let ast;
    try {
      ast = interp.compile(String(a[0]));
    } catch (e) {
      return [undefined, String(e && e.message ? e.message : e)];
    }
    const chunkName = a[1] !== undefined ? String(a[1]) : "=(load)";


    return [nativeFn(function* (callArgs) {
      return yield* interp.run(ast, null, callArgs);
    }, chunkName, true)];
  }, "load"));

  set("newproxy", nativeFn((a) => {
    const t = new LuaTable();
    if (a[0] === true) t.metatable = new LuaTable();
    return [t];
  }, "newproxy"));

  const origTypeCheck = (v) => {
    if (v === undefined || v === null) return "nil";
    const t = typeof v;
    if (t === "boolean" || t === "number" || t === "string") return t;
    if (v.__coroutine === true) return "thread";
    if (v.__ud === "buffer") return "buffer";
    if (v instanceof LuaTable) return "table";
    if (v instanceof LuaFunction || v.__native) return "function";
    return "userdata";
  };
  set("type", nativeFn((args) => [origTypeCheck(args[0])], "type"));
  set("typeof", nativeFn((args) => {
    const v = args[0];
    if (v && v.__coroutine === true) return ["thread"];
    if (v && v.__ud === "buffer") return ["buffer"];
    return [luaTypeName(v, interp.bridge)];
  }, "typeof"));


  set("rawlen", nativeFn((args) => {
    const v = args[0];
    if (typeof v === "string") return [v.length];
    if (v instanceof LuaTable) return [v.length()];
    throw new LuaError("table or string expected");
  }, "rawlen"));
  set("rawget", nativeFn((args) => {
    const t = args[0];
    if (!(t instanceof LuaTable)) throw new LuaError("bad argument #1 to 'rawget' (table expected)");
    return [t.rawget(args[1])];
  }, "rawget"));
  set("rawset", nativeFn((args) => {
    const t = args[0];
    if (!(t instanceof LuaTable)) throw new LuaError("bad argument #1 to 'rawset' (table expected)");
    t.rawset(args[1], args[2]);                                     
    return [t];
  }, "rawset"));


  const os = G.rawget("os");


  os.rawset("time", nativeFn((a) => {
    const t = a[0];
    if (t instanceof LuaTable) return [epochSecondsFromDateTable(t)];
    return [Math.floor(Date.now() / 1000)];
  }, "os.time"));
  os.rawset("date", nativeFn((a) => {
    let fmt = a[0] === undefined ? "%c" : String(a[0]);
    const t = a[1] === undefined ? Math.floor(Date.now() / 1000) : Math.trunc(num(a[1]) || 0);
    let utc = false;
    if (fmt.startsWith("!")) {
      utc = true;
      fmt = fmt.slice(1);
    }
    const d = new Date(t * 1000);
    const get = {
      year: utc ? d.getUTCFullYear() : d.getFullYear(),
      month: (utc ? d.getUTCMonth() : d.getMonth()) + 1,
      day: utc ? d.getUTCDate() : d.getDate(),
      hour: utc ? d.getUTCHours() : d.getHours(),
      min: utc ? d.getUTCMinutes() : d.getMinutes(),
      sec: utc ? d.getUTCSeconds() : d.getSeconds(),
      wday: (utc ? d.getUTCDay() : d.getDay()) + 1,
    };
    if (fmt === "*t") {
      const out = new LuaTable();
      const start = Date.UTC(get.year, 0, 1);
      const yday = Math.floor((Date.UTC(get.year, get.month - 1, get.day) - start) / 86400000) + 1;
      out.rawset("year", get.year);
      out.rawset("month", get.month);
      out.rawset("day", get.day);
      out.rawset("hour", get.hour);
      out.rawset("min", get.min);
      out.rawset("sec", get.sec);
      out.rawset("wday", get.wday);
      out.rawset("yday", yday);
      out.rawset("isdst", false);
      return [out];
    }
    const WDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    const pad2 = (n) => String(n).padStart(2, "0");
    const rep = {
      "%Y": String(get.year),
      "%y": pad2(get.year % 100),
      "%m": pad2(get.month),
      "%d": pad2(get.day),
      "%H": pad2(get.hour),
      "%M": pad2(get.min),
      "%S": pad2(get.sec),
      "%p": get.hour < 12 ? "AM" : "PM",
      "%A": WDAYS[get.wday - 1],
      "%a": WDAYS[get.wday - 1].slice(0, 3),
      "%B": MONTHS[get.month - 1],
      "%b": MONTHS[get.month - 1].slice(0, 3),
      "%x": pad2(get.month) + "/" + pad2(get.day) + "/" + pad2(get.year % 100),
      "%X": pad2(get.hour) + ":" + pad2(get.min) + ":" + pad2(get.sec),
      "%c": WDAYS[get.wday - 1].slice(0, 3) + " " + MONTHS[get.month - 1].slice(0, 3) + " " + pad2(get.day) + " " + pad2(get.hour) + ":" + pad2(get.min) + ":" + pad2(get.sec) + " " + get.year,
      "%%": "%",
    };
    return [fmt.replace(/%[YymdHMSpAaBbxXc%]/g, (m) => (rep[m] !== undefined ? rep[m] : m))];
  }, "os.date"));
}
