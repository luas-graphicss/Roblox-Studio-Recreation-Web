import { LuaTable, LuaFunction, luaTypeName, numToStr } from "../runtime/lua/interpreter.js";

export const MAX_DEPTH = 10;
export const MAX_CHILDREN = 200;
export const STRING_PREVIEW = 120;
export const STRING_FULL_MAX = 5000;

function isUserdata(v) {
  return !!(v && typeof v === "object" && (v.__isInstance === true || typeof v.__ud === "string"));
}

function isLuaFunction(v) {
  if (!v || typeof v !== "object") return false;
  if (v instanceof LuaFunction) return true;
  return !!(v.__native || (v.node && v.closure !== undefined));
}

function fmtNum(n) {
  try {
    return numToStr(n);
  } catch (e) {
    return String(n);
  }
}

function sanitizeText(s) {


  return String(s).replace(/[\u0000-\u0008\u000b-\u001f\u007f]/g, "").replace(/\n/g, "\u21b5");
}

export function typeOf(value, bridge) {
  if (isUserdata(value) && bridge && typeof bridge.typeName === "function") {
    try { return bridge.typeName(value); } catch (e) { return "userdata"; }
  }
  return luaTypeName(value, bridge || null);
}


export function summarize(value, bridge) {
  if (value === undefined || value === null) return { type: "nil", display: "nil", expandable: false };
  const t = typeof value;
  if (t === "boolean") return { type: "boolean", display: value ? "true" : "false", expandable: false };
  if (t === "number") return { type: "number", display: fmtNum(value), expandable: false };
  if (t === "string") {
    const full = value.length > STRING_FULL_MAX ? value.slice(0, STRING_FULL_MAX) + "\u2026" : value;
    const truncated = full.length > STRING_PREVIEW;
    const preview = truncated ? full.slice(0, STRING_PREVIEW) + "\u2026" : full;
    return {
      type: "string",
      display: '"' + sanitizeText(preview) + '"',
      fullText: truncated ? '"' + sanitizeText(full) + '"' : null,
      expandable: false,
      truncatedString: truncated,
    };
  }
  if (isLuaFunction(value)) {


    const name = value.name && value.name !== "anonymous" && value.name !== "luau" ? value.name : "";
    return { type: "function", display: value.__native ? `function: [native${name ? " " + name : ""}]` : `function${name ? " " + name : ""}`, expandable: false };
  }
  if (value instanceof LuaTable) {
    let n = 0;
    try { n = value.map ? value.map.size : 0; } catch (e) { n = 0; }
    return { type: "table", display: `table (${n} ${n === 1 ? "item" : "itens"})`, expandable: n > 0 };
  }
  if (isUserdata(value)) {
    const ud = value.__ud;
    if (value.__isInstance === true) {
      const cls = value.className || "Instance";
      const nm = typeof value.name === "string" ? value.name : "";
      return { type: cls, display: `${nm || cls} [${cls}]`, expandable: true };
    }
    if (ud === "Vector3") return { type: "Vector3", display: `${fmtNum(value.x)}, ${fmtNum(value.y)}, ${fmtNum(value.z)}`, expandable: true };
    if (ud === "Vector2") return { type: "Vector2", display: `${fmtNum(value.x)}, ${fmtNum(value.y)}`, expandable: true };
    if (ud === "Color3") return { type: "Color3", display: `${fmtNum(value.r)}, ${fmtNum(value.g)}, ${fmtNum(value.b)}`, expandable: true };
    if (ud === "CFrame") return { type: "CFrame", display: `${fmtNum(value.x)}, ${fmtNum(value.y)}, ${fmtNum(value.z)}`, expandable: true };
    if (ud === "UDim") return { type: "UDim", display: `${fmtNum(value.scale)}, ${fmtNum(value.offset)}`, expandable: true };
    if (ud === "UDim2") return { type: "UDim2", display: `{${fmtNum(value.xScale)}, ${fmtNum(value.xOffset)}}, {${fmtNum(value.yScale)}, ${fmtNum(value.yOffset)}}`, expandable: true };
    if (ud === "EnumItem") return { type: "EnumItem", display: `Enum.${value.enumType || "?"}.${value.name || "?"}`, expandable: false };
    if (ud === "EnumType") return { type: "EnumType", display: `Enum.${value.enumName || "?"}`, expandable: false };
    return { type: ud || "userdata", display: String(ud || "userdata"), expandable: true };
  }

  return { type: "userdata", display: "userdata", expandable: false };
}

function keyDisplay(k) {
  if (typeof k === "string") return sanitizeText(k.length > 60 ? k.slice(0, 60) + "\u2026" : k);
  if (typeof k === "number") return "[" + fmtNum(k) + "]";
  if (typeof k === "boolean") return "[" + String(k) + "]";
  return "[" + typeOf(k, null) + "]";
}


const INSTANCE_MAIN_PROPS = [
  "Position", "Size", "Anchored", "CanCollide", "Transparency", "Color",
  "Material", "Value", "Text", "Health", "MaxHealth", "WalkSpeed", "JumpPower",
  "Brightness", "Enabled", "Source", "Disabled", "Visible", "Parent",
];


export function childrenOf(value, opts) {
  const o = opts || {};
  const bridge = o.bridge || null;
  const depth = o.depth || 0;
  const limit = Math.min(typeof o.limit === "number" ? o.limit : MAX_CHILDREN, 2000);
  const ancestors = o.ancestors || new Set();
  const out = { children: [], hasMore: false, total: 0 };
  if (depth >= MAX_DEPTH) return out;

  const pushChild = (name, v, extra) => {
    const circular = v && typeof v === "object" && ancestors.has(v);
    const sum = circular
      ? { type: "", display: "[circular reference]", expandable: false, circular: true }
      : summarize(v, bridge);
    out.children.push(Object.assign({ name, value: circular ? undefined : v, summary: sum }, extra || {}));
  };

  if (value instanceof LuaTable) {
    let entries = [];
    try { entries = [...value.map.entries()]; } catch (e) { entries = []; }
    out.total = entries.length;

    entries.sort((a, b) => {
      const an = typeof a[0] === "number", bn = typeof b[0] === "number";
      if (an && bn) return a[0] - b[0];
      if (an) return -1;
      if (bn) return 1;
      return String(a[0]) < String(b[0]) ? -1 : 1;
    });
    for (const [k, v] of entries.slice(0, limit)) pushChild(keyDisplay(k), v);
    out.hasMore = entries.length > limit;


    let mt = null;
    try { mt = value.metatable; } catch (e) { mt = null; }
    if (mt) {
      pushChild("(metatable)", mt);
      out.total += 1;
    }
    return out;
  }

  if (!isUserdata(value)) return out;

  if (value.__isInstance === true) {
    pushChild("ClassName", value.className || "Instance");
    pushChild("Name", typeof value.name === "string" ? value.name : "");
    const seen = new Set(["ClassName", "Name"]);
    let props = [];
    try { props = typeof value.listProperties === "function" ? value.listProperties() : []; } catch (e) { props = []; }
    const byName = new Map();
    for (const p of props) byName.set(p.name, p);
    const ordered = [];
    for (const nm of INSTANCE_MAIN_PROPS) {
      if (byName.has(nm) && !seen.has(nm)) { ordered.push(byName.get(nm)); seen.add(nm); }
    }
    for (const p of props) {
      if (!seen.has(p.name)) { ordered.push(p); seen.add(p.name); }
    }
    let count = 2;
    for (const p of ordered) {
      if (count >= limit) { out.hasMore = true; break; }
      if (p.name === "Source") continue;                                             
      let v;
      if (p.name === "Parent") {
        try { v = value.getParent ? value.getParent() : null; } catch (e) { v = null; }
        pushChild("Parent", v || undefined);
        count++;
        continue;
      }
      v = p.value;

      if (v && typeof v === "object" && !isUserdata(v) && !(v instanceof LuaTable)) {
        if (typeof v.x === "number" && typeof v.y === "number" && typeof v.z === "number") {
          pushChild(p.name, { __ud: "Vector3", x: v.x, y: v.y, z: v.z });
        } else if (typeof v.r === "number" && typeof v.g === "number" && typeof v.b === "number") {
          pushChild(p.name, { __ud: "Color3", r: v.r, g: v.g, b: v.b });
        } else {
          pushChild(p.name, String(p.type || "value"));
        }
      } else {
        pushChild(p.name, v);
      }
      count++;
    }


    let attrs = [];
    try { attrs = typeof value.getAttributesList === "function" ? value.getAttributesList() : []; } catch (e) { attrs = []; }
    for (const a of attrs) {
      if (count >= limit) { out.hasMore = true; break; }
      let av = a.value;
      if (av && typeof av === "object" && !isUserdata(av) && !(av instanceof LuaTable)) {
        if (typeof av.x === "number" && typeof av.y === "number" && typeof av.z === "number") {
          av = { __ud: "Vector3", x: av.x, y: av.y, z: av.z };
        } else if (typeof av.r === "number" && typeof av.g === "number" && typeof av.b === "number") {
          av = { __ud: "Color3", r: av.r, g: av.g, b: av.b };
        } else {
          av = String(a.type || "value");
        }
      }
      pushChild("@" + a.name, av, { isAttribute: true });
      count++;
    }
    let kids = [];
    try { kids = typeof value.getChildren === "function" ? value.getChildren() : []; } catch (e) { kids = []; }
    if (kids.length) {
      for (const c of kids.slice(0, Math.max(0, limit - count))) pushChild(c.name || c.className, c, { isChildInstance: true });
      if (kids.length > Math.max(0, limit - count)) out.hasMore = true;
    }




    const propCandidates = ordered.filter((p) => p.name !== "Source").length;
    out.total = Math.max(out.children.length, 2 + propCandidates + attrs.length + kids.length);
    return out;
  }


  const ud = value.__ud;
  const fields =
    ud === "Vector3" ? ["x", "y", "z"] :
    ud === "Vector2" ? ["x", "y"] :
    ud === "Color3" ? ["r", "g", "b"] :
    ud === "CFrame" ? ["x", "y", "z"] :
    ud === "UDim" ? ["scale", "offset"] :
    ud === "UDim2" ? ["xScale", "xOffset", "yScale", "yOffset"] :
    null;
  if (fields) {
    const label = { x: "X", y: "Y", z: "Z", r: "R", g: "G", b: "B", scale: "Scale", offset: "Offset", xScale: "X.Scale", xOffset: "X.Offset", yScale: "Y.Scale", yOffset: "Y.Offset" };
    for (const f of fields) pushChild(label[f] || f, value[f]);
    out.total = out.children.length;
    return out;
  }


  let count = 0;
  for (const k of Object.keys(value)) {
    if (k.startsWith("__")) continue;
    const v = value[k];
    const tv = typeof v;
    if (tv === "function") continue;
    if (tv === "object" && v !== null && !isUserdata(v) && !(v instanceof LuaTable)) continue;
    if (count >= limit) { out.hasMore = true; break; }
    pushChild(k, v);
    count++;
  }
  out.total = count;
  return out;
}
