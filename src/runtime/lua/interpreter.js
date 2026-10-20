export class LuaTable {
  constructor() {
    this.map = new Map();
    this.metatable = null;
  }
  rawget(key) {
    const v = this.map.get(normalizeKey(key));
    return v === undefined ? undefined : v;
  }
  rawset(key, value) {
    if (this.frozen) throw new LuaError("attempt to modify a frozen table");
    if (key === undefined || key === null) throw new LuaError("table index is nil");
    if (typeof key === "number" && Number.isNaN(key)) throw new LuaError("table index is NaN");
    const k = normalizeKey(key);
    if (value === undefined) this.map.delete(k);
    else this.map.set(k, value);
  }
  length() {
    let n = 0;
    while (this.map.get(n + 1) !== undefined) n++;
    return n;
  }
}


function normalizeKey(key) {
  return key;
}

export class LuaFunction {
  constructor(node, closure, name) {
    this.node = node;
    this.closure = closure;
    this.name = name || "?";
  }
}



export function nativeFn(fn, name, isGen = false) {
  return { __native: true, fn, name: name || "native", isGen: !!isGen };
}

export class LuaError extends Error {
  constructor(value, level, traceback) {
    const msg = typeof value === "string" ? value : luaToDisplay(value);
    super(msg);
    this.name = "LuaError";
    this.luaMessage = value;
    this.level = level == null ? 1 : level;
    this.traceback = traceback || "";
  }
}


export function truthy(v) {
  return v !== undefined && v !== null && v !== false;
}

export function luaTypeName(v, bridge) {
  if (v === undefined || v === null) return "nil";
  const t = typeof v;
  if (t === "boolean") return "boolean";
  if (t === "number") return "number";
  if (t === "string") return "string";
  if (v instanceof LuaTable) return "table";
  if (v instanceof LuaFunction || (v && v.__native)) return "function";
  if (bridge && bridge.isUserdata && bridge.isUserdata(v)) {
    const n = bridge.typeName && bridge.typeName(v);
    return n || "userdata";
  }
  return "userdata";
}

function numToStr(n) {


  if (Number.isInteger(n) && Math.abs(n) < 1e14) return Object.is(n, -0) ? "-0" : String(n);
  if (!isFinite(n)) return n > 0 ? "inf" : n < 0 ? "-inf" : "nan";

  let s = n.toPrecision(14);
  if (s.indexOf("e") >= 0) {


    const [mant, exp] = s.split("e");
    let m = mant;
    if (m.indexOf(".") >= 0) m = m.replace(/0+$/, "").replace(/\.$/, "");
    const sign = exp[0] === "-" ? "-" : "+";
    const digits = exp.replace(/^[+-]/, "").padStart(2, "0");
    return m + "e" + sign + digits;
  }
  if (s.indexOf(".") >= 0) s = s.replace(/0+$/, "").replace(/\.$/, "");
  return s;
}

function luaToDisplay(v) {
  if (v === undefined || v === null) return "nil";
  if (typeof v === "string") return v;
  if (typeof v === "number") return numToStr(v);
  if (typeof v === "boolean") return v ? "true" : "false";
  if (v instanceof LuaTable) return "table: 0x0";
  if (v instanceof LuaFunction || (v && v.__native)) return "function: 0x0";
  return "userdata";
}

export { numToStr, luaToDisplay };
