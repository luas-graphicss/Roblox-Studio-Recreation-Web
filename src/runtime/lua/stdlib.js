import {
  LuaTable,
  LuaFunction,
  nativeFn,
  LuaError,
  truthy,
  luaTypeName,
} from "./interpreter.js";
import { installStdlibExtras } from "./stdlibExtra.js";
import { createLuauRandomGenerator } from "./luauRandomGenerator.js";


function syncCall(interp, fn, args) {
  const gen = interp.call(fn, args, 0);
  let step = gen.next();
  let guard = 0;
  while (!step.done) {
    if (++guard > 500000) throw new LuaError("callback síncrono demorou demais");
    step = gen.next();
  }
  return step.value || [];
}

function tableUnpack(args) {
  const t = args[0];
  if (!(t instanceof LuaTable)) return [];
  const i = args[1] === undefined ? 1 : Math.trunc(args[1]);
  const j = args[2] === undefined ? t.length() : Math.trunc(args[2]);

  if (j - i + 1 > 1e6) throw new LuaError("too many results to unpack");
  const out = [];
  for (let k = i; k <= j; k++) out.push(t.rawget(k));
  return out;
}


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

function luaPatternToRegex(pat, flags) {
  let out = "";
  let i = 0;
  const n = pat.length;
  while (i < n) {
    const c = pat[i];
    if (c === "%") {
      const nx = pat[i + 1];
      if (nx === undefined) throw new LuaError("malformed pattern (ends with '%')");
      if (nx === "b" || nx === "f") {


        throw new LuaError(`pattern '%${nx}' não é suportado neste runtime`);
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


function toUint64Str(n, radix, argPos) {
  if (!Number.isFinite(n)) {
    throw new LuaError(`bad argument #${argPos} to 'format' (number has no integer representation)`);
  }
  return BigInt.asUintN(64, BigInt(Math.trunc(n))).toString(radix);
}


function cFormatG(num, precIn) {
  if (Number.isNaN(num)) return "nan";
  if (!Number.isFinite(num)) return num > 0 ? "inf" : "-inf";
  if (num === 0) return "0";
  const P = Math.min(99, precIn === undefined ? 6 : (precIn === 0 ? 1 : precIn));
  const [mantRaw, expRaw] = num.toExponential(P - 1).split("e");
  const e = parseInt(expRaw, 10);
  if (e < -4 || e >= P) {
    let m = mantRaw;
    if (m.indexOf(".") >= 0) m = m.replace(/0+$/, "").replace(/\.$/, "");
    return m + "e" + (e < 0 ? "-" : "+") + String(Math.abs(e)).padStart(2, "0");
  }
  let s = num.toFixed(Math.min(100, Math.max(0, P - 1 - e)));
  if (s.indexOf(".") >= 0) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s;
}


function luaStrArg(interp, v, fname, argn = 1) {
  if (typeof v === "string") return v;
  if (typeof v === "number") return interp.tostring(v);
  throw new LuaError(`bad argument #${argn} to '${fname}' (string expected, got ${luaTypeName(v, interp && interp.bridge)})`);
}

function luaFormat(interp, args) {
  const fmt = luaStrArg(interp, args[0], "format");
  let ai = 1;
  return fmt.replace(/%[-+ #0]*\d*(?:\.\d+)?[diouxXeEfgGqsc%]/g, (spec) => {
    const conv = spec[spec.length - 1];
    if (conv === "%") return "%";
    const val = args[ai++];
    const flagsMatch = spec.match(/^%([-+ #0]*)(\d*)(?:\.(\d+))?/);
    const flags = flagsMatch[1] || "";
    const width = flagsMatch[2] ? parseInt(flagsMatch[2], 10) : 0;
    const prec = flagsMatch[3] !== undefined ? parseInt(flagsMatch[3], 10) : undefined;
    function pad(s, isNum) {
      if (s.length >= width) return s;
      if (flags.includes("-")) return s + " ".repeat(width - s.length);
      if (flags.includes("0") && isNum) {

        const sign = s[0] === "-" || s[0] === "+" || s[0] === " " ? s[0] : "";
        const body = sign ? s.slice(1) : s;
        return sign + "0".repeat(width - s.length) + body;
      }
      return " ".repeat(width - s.length) + s;
    }
    switch (conv) {
      case "d": case "i": {
        const raw = interp.tonumber(val) || 0;


        if (!Number.isFinite(raw)) {
          throw new LuaError(`bad argument #${ai} to 'format' (number has no integer representation)`);
        }
        let nm = Math.trunc(raw);
        let sign = nm < 0 ? "-" : flags.includes("+") ? "+" : flags.includes(" ") ? " " : "";
        return pad(sign + Math.abs(nm).toString(), true);
      }
      case "u": return pad(toUint64Str(interp.tonumber(val) || 0, 10, ai), true);
      case "x": return pad(toUint64Str(interp.tonumber(val) || 0, 16, ai), true);
      case "X": return pad(toUint64Str(interp.tonumber(val) || 0, 16, ai).toUpperCase(), true);
      case "o": return pad(toUint64Str(interp.tonumber(val) || 0, 8, ai), true);
      case "e": case "E": {

        const numE = interp.tonumber(val) ?? 0;
        let s;
        if (Number.isFinite(numE)) {
          s = numE.toExponential(prec === undefined ? 6 : Math.min(99, prec));

          s = s.replace(/e([+-])(\d)$/, "e$10$2");
        } else {

          s = Number.isNaN(numE) ? "nan" : numE > 0 ? "inf" : "-inf";
        }
        if (conv === "E") s = s.toUpperCase();
        return pad(s, true);
      }
      case "f": {
        const numF = interp.tonumber(val) ?? 0;
        let s = Number.isFinite(numF)
          ? numF.toFixed(prec === undefined ? 6 : Math.min(100, prec))
          : Number.isNaN(numF) ? "nan" : numF > 0 ? "inf" : "-inf";
        if (flags.includes("+") && numF >= 0) s = "+" + s;
        return pad(s, true);
      }
      case "g": case "G": {
        let s = cFormatG(interp.tonumber(val) ?? 0, prec);
        if (conv === "G") s = s.toUpperCase();
        return pad(s, true);
      }
      case "c": return String.fromCharCode(interp.tonumber(val) || 0);
      case "s": {
        let s = interp.tostring(val);
        if (prec !== undefined) s = s.slice(0, prec);
        return pad(s, false);
      }
      case "q": return JSON.stringify(interp.tostring(val));
      default: return spec;
    }
  });
}

export function installStdlib(interp, deps = {}) {
  const logger = deps.logger || null;
  const G = interp.globals;
  const set = (name, value) => G.rawset(name, value);
  const argList = (args) => args.map((a) => interp.tostring(a)).join("\t");


  set("print", nativeFn((args) => {
    if (logger) logger.info(argList(args), { source: "Script" });
    return [];
  }, "print"));
  set("warn", nativeFn((args) => {
    if (logger) logger.warn(argList(args), { source: "Script" });
    return [];
  }, "warn"));
  set("error", nativeFn((args) => {
    throw new LuaError(args[0], args[1] === undefined ? 1 : args[1]);
  }, "error"));
  set("assert", nativeFn((args) => {
    if (!truthy(args[0])) {
      throw new LuaError(args[1] !== undefined ? args[1] : "assertion failed!");
    }
    return args;
  }, "assert"));


  set("pcall", nativeFn(function* (args) {
    try {
      const res = yield* interp.call(args[0], args.slice(1), 0);
      return [true, ...res];
    } catch (e) {
      if (e instanceof LuaError) return [false, e.luaMessage];
      if (e && e.name === "LuaSyntaxError") return [false, e.message];


      if (e instanceof RangeError) return [false, "stack overflow"];
      throw e;
    }
  }, "pcall", true));
  set("xpcall", nativeFn(function* (args) {
    try {
      const res = yield* interp.call(args[0], args.slice(2), 0);
      return [true, ...res];
    } catch (e) {
      let msg;
      if (e instanceof LuaError) msg = e.luaMessage;
      else if (e && e.name === "LuaSyntaxError") msg = e.message;
      else if (e instanceof RangeError) msg = "stack overflow";
      else throw e;
      const hres = yield* interp.call(args[1], [msg], 0);
      return [false, ...hres];
    }
  }, "xpcall", true));


  set("type", nativeFn((args) => {
    const v = args[0];
    if (v === undefined || v === null) return ["nil"];
    const t = typeof v;
    if (t === "boolean" || t === "number" || t === "string") return [t];
    if (v instanceof LuaTable) return ["table"];
    if (v instanceof LuaFunction || v.__native) return ["function"];
    return ["userdata"];
  }, "type"));
  set("typeof", nativeFn((args) => [luaTypeName(args[0], interp.bridge)], "typeof"));
  set("tostring", nativeFn((args) => [interp.tostring(args[0])], "tostring"));
  set("tonumber", nativeFn((args) => {
    const base = args[1];
    if (base !== undefined && base !== null) {
      const b = Math.trunc(interp.tonumber(base) || 0);
      if (!(b >= 2 && b <= 36)) throw new LuaError("bad argument #2 to 'tonumber' (base out of range)");
      if (typeof args[0] !== "string") {
        if (b === 10) return [interp.tonumber(args[0])];
        throw new LuaError("bad argument #1 to 'tonumber' (string expected)");
      }


      const raw = args[0].trim().toLowerCase();
      const neg = raw[0] === "-";
      const body = neg || raw[0] === "+" ? raw.slice(1) : raw;
      if (!body) return [undefined];
      const digits = "0123456789abcdefghijklmnopqrstuvwxyz".slice(0, b);
      for (const ch of body) {
        if (!digits.includes(ch)) return [undefined];
      }
      const n = parseInt(body, b);
      return [isNaN(n) ? undefined : neg ? -n : n];
    }
    return [interp.tonumber(args[0])];
  }, "tonumber"));


  set("ipairs", nativeFn((args) => {
    const t = args[0];
    if (!(t instanceof LuaTable)) throw new LuaError("bad argument #1 to 'ipairs' (table expected)");
    const iter = nativeFn((a) => {
      const i = (a[1] || 0) + 1;
      const v = a[0].rawget(i);
      if (v === undefined) return [];
      return [i, v];
    }, "ipairs_iter");
    return [iter, t, 0];
  }, "ipairs"));
  set("pairs", nativeFn((args) => {
    const t = args[0];
    if (!(t instanceof LuaTable)) throw new LuaError("bad argument #1 to 'pairs' (table expected)");
    const keys = [...t.map.keys()];
    let idx = 0;
    const iter = nativeFn(() => {
      while (idx < keys.length) {
        const k = keys[idx++];
        const v = t.rawget(k);
        if (v !== undefined) return [k, v];
      }
      return [];
    }, "pairs_iter");
    return [iter, t, undefined];
  }, "pairs"));
  set("next", nativeFn((args) => {
    const t = args[0];
    const keys = [...t.map.keys()];
    const key = args[1];
    if (key === undefined || key === null) {
      if (keys.length === 0) return [];
      return [keys[0], t.rawget(keys[0])];
    }
    const i = keys.indexOf(key);
    if (i < 0 || i + 1 >= keys.length) return [];
    return [keys[i + 1], t.rawget(keys[i + 1])];
  }, "next"));
  set("select", nativeFn((args) => {
    const sel = args[0];
    const rest = args.slice(1);
    if (sel === "#") return [rest.length];
    const i = Math.trunc(interp.tonumber(sel));
    if (Number.isNaN(i)) throw new LuaError("bad argument #1 to 'select'");
    if (i < 0) {
      if (-i > rest.length) throw new LuaError("bad argument #1 to 'select' (index out of range)");
      return rest.slice(rest.length + i);
    }

    if (i === 0) throw new LuaError("bad argument #1 to 'select' (index out of range)");
    return rest.slice(i - 1);
  }, "select"));

  set("rawget", nativeFn((args) => [args[0].rawget(args[1])], "rawget"));
  set("rawset", nativeFn((args) => { args[0].rawset(args[1], args[2]); return [args[0]]; }, "rawset"));
  set("rawequal", nativeFn((args) => [args[0] === args[1]], "rawequal"));
  set("rawlen", nativeFn((args) => {
    const v = args[0];
    if (typeof v === "string") return [v.length];
    if (v instanceof LuaTable) return [v.length()];
    throw new LuaError("table or string expected");
  }, "rawlen"));
  set("setmetatable", nativeFn((args) => {
    const t = args[0];
    if (!(t instanceof LuaTable)) throw new LuaError("bad argument #1 to 'setmetatable' (table expected)");
    const mt = args[1];
    if (mt !== undefined && mt !== null && !(mt instanceof LuaTable)) {
      throw new LuaError("bad argument #2 to 'setmetatable' (nil or table expected)");
    }
    if (t.frozen) throw new LuaError("attempt to modify a frozen table");
    if (t.metatable instanceof LuaTable && t.metatable.rawget("__metatable") !== undefined) {
      throw new LuaError("cannot change a protected metatable");
    }
    t.metatable = mt === undefined || mt === null ? null : mt;
    return [t];
  }, "setmetatable"));
  set("getmetatable", nativeFn((args) => {
    const t = args[0];
    if (t instanceof LuaTable) {
      if (t.metatable instanceof LuaTable) {

        const prot = t.metatable.rawget("__metatable");
        if (prot !== undefined) return [prot];
      }
      return [t.metatable || undefined];
    }
    return [undefined];
  }, "getmetatable"));
  set("unpack", nativeFn((args) => tableUnpack(args), "unpack"));
  set("newproxy", nativeFn(() => [new LuaTable()], "newproxy"));


  const math = new LuaTable();
  const mset = (k, v) => math.rawset(k, v);
  mset("pi", Math.PI);
  mset("huge", Infinity);


  const mnum = (v, fname, idx = 1) => {
    const n = interp.tonumber(v);
    if (typeof n !== "number") {
      throw new LuaError(`bad argument #${idx} to '${fname}' (number expected, got ${luaTypeName(v, interp.bridge)})`);
    }
    return n;
  };
  const m1 = (name, f) => mset(name, nativeFn((a) => [f(mnum(a[0], name))], "math." + name));
  m1("abs", Math.abs); m1("ceil", Math.ceil); m1("floor", Math.floor);
  m1("sqrt", Math.sqrt); m1("sin", Math.sin); m1("cos", Math.cos);
  m1("tan", Math.tan); m1("asin", Math.asin); m1("acos", Math.acos);
  m1("atan", Math.atan); m1("exp", Math.exp);
  m1("rad", (x) => x * Math.PI / 180); m1("deg", (x) => x * 180 / Math.PI);
  m1("sign", Math.sign);
  mset("log", nativeFn((a) => {
    const x = mnum(a[0], "log");
    const base = a[1] !== undefined ? mnum(a[1], "log", 2) : undefined;

    return [base !== undefined ? Math.log(x) / Math.log(base) : Math.log(x)];
  }, "math.log"));
  mset("log10", nativeFn((a) => [Math.log10(mnum(a[0], "log10"))], "math.log10"));
  mset("pow", nativeFn((a) => [Math.pow(mnum(a[0], "pow"), mnum(a[1], "pow", 2))], "math.pow"));
  mset("atan2", nativeFn((a) => [Math.atan2(mnum(a[0], "atan2"), mnum(a[1], "atan2", 2))], "math.atan2"));



  mset("fmod", nativeFn((a) => { const x = mnum(a[0], "fmod"), y = mnum(a[1], "fmod", 2); return [x % y]; }, "math.fmod"));
  mset("modf", nativeFn((a) => {
    const x = mnum(a[0], "modf");

    if (!Number.isFinite(x)) return [x, Number.isNaN(x) ? NaN : 0];
    const ip = Math.trunc(x);
    return [ip, x - ip];
  }, "math.modf"));


  mset("max", nativeFn((a) => {
    if (a.length === 0) throw new LuaError("bad argument #1 to 'max' (number expected, got no value)");
    return [Math.max(...a.map((x, i) => mnum(x, "max", i + 1)))];
  }, "math.max"));
  mset("min", nativeFn((a) => {
    if (a.length === 0) throw new LuaError("bad argument #1 to 'min' (number expected, got no value)");
    return [Math.min(...a.map((x, i) => mnum(x, "min", i + 1)))];
  }, "math.min"));


  mset("round", nativeFn((a) => {
    const x = mnum(a[0], "round");
    return [x >= 0 ? Math.floor(x + 0.5) : Math.ceil(x - 0.5)];
  }, "math.round"));
  mset("clamp", nativeFn((a) => {
    const x = mnum(a[0], "clamp"), lo = mnum(a[1], "clamp", 2), hi = mnum(a[2], "clamp", 3);

    if (lo > hi) throw new LuaError("invalid argument #3 to 'clamp' (max must be greater than or equal to min)");
    return [Math.max(lo, Math.min(hi, x))];
  }, "math.clamp"));



  const luauRandom = createLuauRandomGenerator();
  mset("random", nativeFn((a) => {
    if (a.length === 0) return [luauRandom.nextUnitFloat()];
    if (a.length === 1) {
      const hi = Math.floor(interp.tonumber(a[0]));
      if (!Number.isFinite(hi)) throw new LuaError("bad argument #1 to 'random' (number expected)");
      if (hi < 1) throw new LuaError("bad argument #1 to 'random' (interval is empty)");
      return [Math.floor(luauRandom.nextUnitFloat() * hi) + 1];
    }
    const lo = Math.floor(interp.tonumber(a[0]));
    const hi = Math.floor(interp.tonumber(a[1]));
    if (!Number.isFinite(lo) || !Number.isFinite(hi)) {
      throw new LuaError("bad argument to 'random' (number expected)");
    }
    if (lo > hi) throw new LuaError("bad argument #2 to 'random' (interval is empty)");
    return [Math.floor(luauRandom.nextUnitFloat() * (hi - lo + 1)) + lo];
  }, "math.random"));



  mset("randomseed", nativeFn((a) => {
    luauRandom.reseed(a.length === 0 ? undefined : interp.tonumber(a[0]));
    return [];
  }, "math.randomseed"));
  set("math", math);


  const string = new LuaTable();
  const sset = (k, v) => string.rawset(k, v);


  sset("len", nativeFn((a) => [luaStrArg(interp, a[0], "len").length], "string.len"));
  sset("upper", nativeFn((a) => [luaStrArg(interp, a[0], "upper").toUpperCase()], "string.upper"));
  sset("lower", nativeFn((a) => [luaStrArg(interp, a[0], "lower").toLowerCase()], "string.lower"));
  sset("reverse", nativeFn((a) => [luaStrArg(interp, a[0], "reverse").split("").reverse().join("")], "string.reverse"));
  sset("rep", nativeFn((a) => {
    const s = luaStrArg(interp, a[0], "rep"); const n = Math.max(0, Math.floor(interp.tonumber(a[1]) || 0));
    const sep = a[2] !== undefined ? String(a[2]) : "";

    if ((s.length + sep.length) * n > 16 * 1024 * 1024) {
      throw new LuaError("string.rep: resultado grande demais");
    }
    return [n === 0 ? "" : Array(n).fill(s).join(sep)];
  }, "string.rep"));
  sset("sub", nativeFn((a) => {
    const s = luaStrArg(interp, a[0], "sub");
    let i = a[1] === undefined ? 1 : Math.trunc(interp.tonumber(a[1]));
    let j = a[2] === undefined ? -1 : Math.trunc(interp.tonumber(a[2]));
    const len = s.length;
    if (i < 0) i = Math.max(len + i + 1, 1); else if (i === 0) i = 1;
    if (j < 0) j = len + j + 1; else if (j > len) j = len;
    if (i > j) return [""];
    return [s.slice(i - 1, j)];
  }, "string.sub"));
  sset("byte", nativeFn((a) => {
    const s = luaStrArg(interp, a[0], "byte");
    let i = a[1] === undefined ? 1 : Math.trunc(interp.tonumber(a[1]));
    let j = a[2] === undefined ? i : Math.trunc(interp.tonumber(a[2]));
    if (i < 0) i = s.length + i + 1;
    if (j < 0) j = s.length + j + 1;

    if (i < 1) i = 1;
    if (j > s.length) j = s.length;
    const out = [];
    for (let k = i; k <= j; k++) out.push(s.charCodeAt(k - 1));
    return out;
  }, "string.byte"));
  sset("char", nativeFn((a) => [a.map((c, idx) => {
    const code = interp.tonumber(c);

    if (code === undefined || !Number.isFinite(code) || code < 0 || code > 255 || Math.trunc(code) !== code) {
      throw new LuaError(`bad argument #${idx + 1} to 'char' (value out of range)`);
    }
    return String.fromCharCode(code);
  }).join("")], "string.char"));
  sset("format", nativeFn((a) => [luaFormat(interp, a)], "string.format"));
  sset("split", nativeFn((a) => {
    const s = luaStrArg(interp, a[0], "split");
    const sep = a[1] === undefined ? "," : luaStrArg(interp, a[1], "split", 2);
    const t = new LuaTable();
    const parts = sep === "" ? s.split("") : s.split(sep);
    parts.forEach((p, i) => t.rawset(i + 1, p));
    return [t];
  }, "string.split"));
  sset("find", nativeFn((a) => {
    const s = luaStrArg(interp, a[0], "find");
    const pat = luaStrArg(interp, a[1], "find", 2);
    let init = a[2] === undefined ? 1 : Math.trunc(interp.tonumber(a[2]));
    if (init < 0) init = Math.max(s.length + init + 1, 1);
    if (init < 1) init = 1;                                                     
    if (init > s.length + 1) return [];
    if (truthy(a[3])) {
      const idx = s.indexOf(pat, init - 1);
      if (idx < 0) return [];
      return [idx + 1, idx + pat.length];
    }
    const re = luaPatternToRegex(pat, "");
    const m = re.exec(s.slice(init - 1));
    if (!m) return [];
    const start = init + m.index;
    const out = [start, start + m[0].length - 1];
    for (let k = 1; k < m.length; k++) out.push(m[k]);
    return out;
  }, "string.find"));
  sset("match", nativeFn((a) => {
    const s = luaStrArg(interp, a[0], "match");
    const re = luaPatternToRegex(luaStrArg(interp, a[1], "match", 2), "");
    const m = re.exec(s);
    if (!m) return [];
    return m.length > 1 ? m.slice(1) : [m[0]];
  }, "string.match"));
  sset("gmatch", nativeFn((a) => {
    const s = luaStrArg(interp, a[0], "gmatch");
    const re = luaPatternToRegex(luaStrArg(interp, a[1], "gmatch", 2), "g");
    const iter = nativeFn(() => {
      const m = re.exec(s);
      if (!m) return [];
      if (m[0].length === 0) re.lastIndex++;
      return m.length > 1 ? m.slice(1) : [m[0]];
    }, "gmatch_iter");
    return [iter];
  }, "string.gmatch"));
  sset("gsub", nativeFn((a) => {
    const s = luaStrArg(interp, a[0], "gsub");
    const re = luaPatternToRegex(luaStrArg(interp, a[1], "gsub", 2), "g");


    const repl = typeof a[2] === "number" ? interp.tostring(a[2]) : a[2];
    const maxN = a[3] === undefined ? Infinity : interp.tonumber(a[3]);
    let count = 0;
    const result = s.replace(re, (...m) => {
      if (count >= maxN) return m[0];
      count++;
      const groups = m.slice(0, m.length - 2);
      const whole = groups[0];
      const caps = groups.length > 1 ? groups.slice(1) : [whole];
      if (typeof repl === "string") {
        return repl.replace(/%([0-9%])/g, (_, d) => {
          if (d === "%") return "%";
          if (d === "0") return whole;
          return caps[parseInt(d, 10) - 1] !== undefined ? String(caps[parseInt(d, 10) - 1]) : "";
        });
      }
      if (repl instanceof LuaTable) {
        const v = repl.rawget(caps[0]);
        return truthy(v) ? interp.tostring(v) : whole;
      }
      if (repl instanceof LuaFunction || (repl && repl.__native)) {
        const res = syncCall(interp, repl, caps);
        return truthy(res[0]) ? interp.tostring(res[0]) : whole;
      }
      return whole;
    });
    return [result, count];
  }, "string.gsub"));
  set("string", string);


  const table = new LuaTable();
  const tset = (k, v) => table.rawset(k, v);
  tset("insert", nativeFn((a) => {
    const t = a[0];
    if (!(t instanceof LuaTable)) throw new LuaError("bad argument #1 to 'insert' (table expected)");
    if (a.length >= 3) {
      const pos = Math.trunc(interp.tonumber(a[1]));
      const len = t.length();
      if (!(pos >= 1 && pos <= len + 1)) {
        throw new LuaError("bad argument #2 to 'insert' (position out of bounds)");
      }
      for (let k = len; k >= pos; k--) t.rawset(k + 1, t.rawget(k));
      t.rawset(pos, a[2]);
    } else if (a.length === 2) {
      t.rawset(t.length() + 1, a[1]);
    } else {
      throw new LuaError("wrong number of arguments to 'insert'");
    }
    return [];
  }, "table.insert"));
  tset("remove", nativeFn((a) => {
    const t = a[0];
    if (!(t instanceof LuaTable)) throw new LuaError("bad argument #1 to 'remove' (table expected)");
    const len = t.length();
    const pos = a[1] === undefined ? len : Math.trunc(interp.tonumber(a[1]));
    if (len > 0 && !(pos >= 1 && pos <= len + 1)) {
      throw new LuaError("bad argument #2 to 'remove' (position out of bounds)");
    }
    if (len === 0) return [];
    const removed = t.rawget(pos);
    for (let k = pos; k < len; k++) t.rawset(k, t.rawget(k + 1));


    if (pos <= len) t.rawset(len, undefined);
    return [removed];
  }, "table.remove"));
  tset("concat", nativeFn((a) => {
    const t = a[0];
    const sep = a[1] === undefined ? "" : String(a[1]);
    const i = a[2] === undefined ? 1 : Math.trunc(interp.tonumber(a[2]));
    const j = a[3] === undefined ? t.length() : Math.trunc(interp.tonumber(a[3]));
    const parts = [];
    for (let k = i; k <= j; k++) {
      const v = t.rawget(k);


      if (typeof v !== "string" && typeof v !== "number") {
        throw new LuaError(`invalid value (at index ${k}) in table for 'concat'`);
      }
      parts.push(typeof v === "number" ? interp.tostring(v) : v);
    }
    return [parts.join(sep)];
  }, "table.concat"));
  tset("find", nativeFn((a) => {
    const t = a[0];
    const len = t.length();
    for (let k = 1; k <= len; k++) if (t.rawget(k) === a[1]) return [k];
    return [];
  }, "table.find"));
  tset("sort", nativeFn((a) => {
    const t = a[0];
    const comp = a[1];
    const len = t.length();
    const arr = [];
    for (let k = 1; k <= len; k++) arr.push(t.rawget(k));
    arr.sort((x, y) => {
      if (comp) {
        const less = truthy(syncCall(interp, comp, [x, y])[0]);
        if (less) return -1;
        const greater = truthy(syncCall(interp, comp, [y, x])[0]);
        return greater ? 1 : 0;
      }
      if (typeof x === "number" && typeof y === "number") {
        return x < y ? -1 : x > y ? 1 : 0;
      }
      if (typeof x === "string" && typeof y === "string") {
        return x < y ? -1 : x > y ? 1 : 0;
      }


      throw new LuaError(`attempt to compare ${luaTypeName(x, interp.bridge)} with ${luaTypeName(y, interp.bridge)}`);
    });
    for (let k = 0; k < arr.length; k++) t.rawset(k + 1, arr[k]);
    return [];
  }, "table.sort"));
  tset("unpack", nativeFn((a) => tableUnpack(a), "table.unpack"));
  tset("pack", nativeFn((a) => {
    const t = new LuaTable();
    a.forEach((v, i) => t.rawset(i + 1, v));
    t.rawset("n", a.length);
    return [t];
  }, "table.pack"));
  tset("clear", nativeFn((a) => { if (a[0] instanceof LuaTable) a[0].map.clear(); return []; }, "table.clear"));
  tset("create", nativeFn((a) => {
    const t = new LuaTable();
    const n = Math.trunc(interp.tonumber(a[0]) || 0);
    if (n > 1e6) throw new LuaError("table.create: tamanho grande demais");
    if (a[1] !== undefined) for (let k = 1; k <= n; k++) t.rawset(k, a[1]);
    return [t];
  }, "table.create"));
  tset("getn", nativeFn((a) => [a[0].length()], "table.getn"));
  set("table", table);


  const os = new LuaTable();
  os.rawset("time", nativeFn(() => [Math.floor(Date.now() / 1000)], "os.time"));


  os.rawset("clock", nativeFn(() => [(typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now()) / 1000], "os.clock"));
  os.rawset("date", nativeFn((a) => [new Date().toString()], "os.date"));
  set("os", os);

  set("tick", nativeFn(() => [Date.now() / 1000], "tick"));


  set("_G", G);
  set("_VERSION", "Luau (RSW)");


  installStdlibExtras(interp);
}
