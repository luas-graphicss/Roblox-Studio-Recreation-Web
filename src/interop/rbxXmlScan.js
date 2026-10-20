import { RBX_LIMITS, isPlaceService } from "./rbxTypeMaps.js";
import { MAX_SMOOTH_GRID_B64 } from "./rbxBlobs.js";

const VALUE_TAGS = new Set([
  "string", "ProtectedString", "bool", "float", "double", "int", "int64",
  "token", "Color3", "Color3uint8", "Vector3", "CoordinateFrame", "CFrame", "Ref",
  "BinaryString",

  "UDim", "UDim2", "Ray", "Faces", "Axes", "BrickColor", "Vector2", "Vector2int16",
  "Vector3int16", "NumberSequence", "ColorSequence", "NumberRange", "Rect2D",
  "PhysicalProperties", "OptionalCoordinateFrame", "UniqueId", "Font",
  "SecurityCapabilities",
]);

const MAX_SEQ_KEYPOINTS = 4096;

function unescapeXml(s) {
  return String(s)
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&");
}

function parseAttrs(raw) {
  const out = {};
  const re = /([\w:]+)="([^"]*)"/g;
  let m;
  while ((m = re.exec(raw))) out[m[1]] = unescapeXml(m[2]);
  return out;
}

function num(raw) {
  const v = parseFloat(String(raw == null ? "" : raw).trim());
  return Number.isFinite(v) ? v : 0;
}

function childNum(inner, tag) {
  const m = new RegExp("<" + tag + ">([^<]*)</" + tag + ">").exec(inner);
  return m ? num(m[1]) : 0;
}



function section(inner, tag) {
  const open = "<" + tag + ">";
  const close = "</" + tag + ">";
  const start = inner.indexOf(open);
  if (start === -1) return "";
  const end = inner.indexOf(close, start + open.length);
  if (end === -1) return "";
  return inner.slice(start + open.length, end);
}



function urlText(inner) {
  const s = String(inner == null ? "" : inner);


  if (s.indexOf("<url>") !== -1) return textValue(section(s, "url")).trim();
  return textValue(s).trim();
}

function numList(inner) {
  const out = [];
  const parts = String(inner == null ? "" : inner).trim().split(/\s+/);
  for (const piece of parts) {
    if (!piece) continue;
    const v = parseFloat(piece);
    out.push(Number.isFinite(v) ? v : 0);
    if (out.length >= MAX_SEQ_KEYPOINTS * 5) break;
  }
  return out;
}

function textValue(inner) {
  if (inner.indexOf("<![CDATA[") === -1) return unescapeXml(inner);
  let out = "";
  let pos = 0;
  while (true) {
    const start = inner.indexOf("<![CDATA[", pos);
    if (start === -1) break;
    const end = inner.indexOf("]]>", start + 9);
    if (end === -1) throw new Error("CDATA truncado.");
    out += inner.slice(start + 9, end);
    pos = end + 3;
  }
  return out;
}

function findClose(text, tag, from) {
  const closeTag = "</" + tag + ">";
  let pos = from;
  while (true) {
    const close = text.indexOf(closeTag, pos);
    if (close === -1) throw new Error("Tag <" + tag + "> sem fechamento.");
    const cdata = text.indexOf("<![CDATA[", pos);
    if (cdata === -1 || cdata > close) return { start: close, next: close + closeTag.length };
    const cdEnd = text.indexOf("]]>", cdata + 9);
    if (cdEnd === -1) throw new Error("CDATA truncado.");
    pos = cdEnd + 3;
  }
}

function decodeValue(tag, name, inner) {
  if (!name) return null;
  switch (tag) {
    case "string":
    case "ProtectedString":
      return { name, t: "string", v: textValue(inner).slice(0, RBX_LIMITS.maxStringLen) };
    case "bool":
      return { name, t: "bool", v: textValue(inner).trim() === "true" };
    case "float":
      return { name, t: "float", v: num(inner) };
    case "double":
      return { name, t: "double", v: num(inner) };
    case "int":
      return { name, t: "int", v: Math.round(num(inner)) };
    case "int64":
      return { name, t: "int64", v: Math.round(num(inner)) };
    case "token":
      return { name, t: "token", v: Math.max(0, Math.round(num(inner))) >>> 0 };
    case "Color3":
      return { name, t: "color3", v: { r: childNum(inner, "R"), g: childNum(inner, "G"), b: childNum(inner, "B") } };
    case "Color3uint8":
      return { name, t: "color3u8", v: Math.max(0, Math.round(num(inner))) >>> 0 };
    case "Vector3":
      return { name, t: "vector3", v: { x: childNum(inner, "X"), y: childNum(inner, "Y"), z: childNum(inner, "Z") } };
    case "CoordinateFrame":
    case "CFrame": {
      const r = ["R00", "R01", "R02", "R10", "R11", "R12", "R20", "R21", "R22"].map((t) => childNum(inner, t));
      return { name, t: "cframe", v: { x: childNum(inner, "X"), y: childNum(inner, "Y"), z: childNum(inner, "Z"), r } };
    }
    case "BinaryString": {
      const b64 = textValue(inner).replace(/\s+/g, "");
      return { name, t: "binaryString", v: b64.length > MAX_SMOOTH_GRID_B64 ? "" : b64 };
    }
    case "UDim":
      return { name, t: "udim", v: { s: childNum(inner, "S"), o: Math.round(childNum(inner, "O")) } };
    case "UDim2":
      return { name, t: "udim2", v: {
        xs: childNum(inner, "XS"), xo: Math.round(childNum(inner, "XO")),
        ys: childNum(inner, "YS"), yo: Math.round(childNum(inner, "YO")),
      } };
    case "Ray": {
      const o = section(inner, "origin");
      const d = section(inner, "direction");
      return { name, t: "ray", v: {
        ox: childNum(o, "X"), oy: childNum(o, "Y"), oz: childNum(o, "Z"),
        dx: childNum(d, "X"), dy: childNum(d, "Y"), dz: childNum(d, "Z"),
      } };
    }
    case "Faces":
      return { name, t: "faces", v: Math.max(0, Math.round(childNum(inner, "faces"))) & 0x3f };
    case "Axes":
      return { name, t: "axes", v: Math.max(0, Math.round(childNum(inner, "axes"))) & 0x07 };
    case "BrickColor":
      return { name, t: "brickColor", v: Math.max(0, Math.round(num(textValue(inner)))) >>> 0 };
    case "Vector2":
      return { name, t: "vector2", v: { x: childNum(inner, "X"), y: childNum(inner, "Y") } };
    case "Vector2int16":
      return { name, t: "vector2i16", v: {
        x: Math.round(childNum(inner, "X")), y: Math.round(childNum(inner, "Y")),
      } };
    case "Vector3int16":
      return { name, t: "vector3i16", v: {
        x: Math.round(childNum(inner, "X")),
        y: Math.round(childNum(inner, "Y")),
        z: Math.round(childNum(inner, "Z")),
      } };
    case "NumberSequence": {
      const ns = numList(textValue(inner));
      const kps = [];
      for (let i = 0; i + 2 < ns.length && kps.length < MAX_SEQ_KEYPOINTS; i += 3) {
        kps.push({ t: ns[i], v: ns[i + 1], e: ns[i + 2] });
      }
      return { name, t: "numberSeq", v: kps };
    }
    case "ColorSequence": {
      const cs = numList(textValue(inner));
      const kps = [];
      for (let i = 0; i + 4 < cs.length && kps.length < MAX_SEQ_KEYPOINTS; i += 5) {
        kps.push({ t: cs[i], r: cs[i + 1], g: cs[i + 2], b: cs[i + 3], e: cs[i + 4] });
      }
      return { name, t: "colorSeq", v: kps };
    }
    case "NumberRange": {
      const nr = numList(textValue(inner));
      return { name, t: "numberRange", v: { min: nr.length ? nr[0] : 0, max: nr.length > 1 ? nr[1] : 0 } };
    }
    case "Rect2D": {
      const mn = section(inner, "min");
      const mx = section(inner, "max");
      return { name, t: "rect", v: {
        minX: childNum(mn, "X"), minY: childNum(mn, "Y"),
        maxX: childNum(mx, "X"), maxY: childNum(mx, "Y"),
      } };
    }
    case "PhysicalProperties": {
      const custom = /<CustomPhysics>\s*true\s*<\/CustomPhysics>/.test(inner);
      if (!custom) return { name, t: "physProps", v: null };
      return { name, t: "physProps", v: {
        d: childNum(inner, "Density"),
        f: childNum(inner, "Friction"),
        e: childNum(inner, "Elasticity"),
        fw: childNum(inner, "FrictionWeight"),
        ew: childNum(inner, "ElasticityWeight"),
      } };
    }
    case "OptionalCoordinateFrame": {
      const cf = section(inner, "CFrame");
      if (!cf.trim()) return { name, t: "optionalCFrame", v: null };
      const r = ["R00", "R01", "R02", "R10", "R11", "R12", "R20", "R21", "R22"].map((t) => childNum(cf, t));
      return { name, t: "optionalCFrame", v: {
        x: childNum(cf, "X"), y: childNum(cf, "Y"), z: childNum(cf, "Z"), r,
      } };
    }
    case "UniqueId":
      return { name, t: "uniqueId", v: textValue(inner).replace(/[^0-9a-fA-F]/g, "").slice(0, 32) };
    case "Font": {
      const style = /<Style>\s*Italic\s*<\/Style>/.test(inner) ? 1 : 0;
      const weight = Math.round(childNum(inner, "Weight"));
      return { name, t: "font", v: {
        family: urlText(section(inner, "Family")),
        weight: weight > 0 ? weight : 400,
        style,
        cachedFaceId: urlText(section(inner, "CachedFaceId")),
      } };
    }
    case "SecurityCapabilities": {

      const digits = textValue(inner).trim().replace(/[^0-9-]/g, "");
      return { name, t: "securityCaps", v: /^-?\d+$/.test(digits) ? digits : "0" };
    }
    case "Ref": {
      const v = textValue(inner).trim();
      return { name, t: "ref", v: v && v !== "null" && v !== "nil" ? v : null };
    }
    default:
      return null;
  }
}

export function xmlToRbxModel(xml) {
  const text = String(xml == null ? "" : xml);
  if (!text.trim()) throw new Error("XML vazio.");
  if (text.length > RBX_LIMITS.maxFileBytes) throw new Error("XML excede o limite de 50MB.");
  const instances = [];
  const stack = [];
  let props = null;
  let i = 0;
  const n = text.length;
  while (i < n) {
    const lt = text.indexOf("<", i);
    if (lt === -1) break;
    const gt = text.indexOf(">", lt);
    if (gt === -1) throw new Error("XML truncado.");
    const raw = text.slice(lt + 1, gt);
    i = gt + 1;
    if (raw.startsWith("?") || raw.startsWith("!")) continue;
    if (raw.startsWith("/")) {
      const name = raw.slice(1).trim();
      if (name === "Item") stack.pop();
      else if (name === "Properties") props = null;
      continue;
    }
    const selfClose = raw.endsWith("/");
    const tagName = (raw.match(/^[\w:]+/) || [""])[0];
    if (!tagName || tagName === "roblox" || tagName === "Meta") continue;
    if (tagName === "Item") {
      if (instances.length >= RBX_LIMITS.maxInstances) throw new Error("XML excede o limite de instâncias.");
      if (stack.length >= RBX_LIMITS.maxDepth) throw new Error("XML excede a profundidade máxima.");
      const attrs = parseAttrs(raw);
      const item = {
        className: attrs.class || "Folder",
        referent: attrs.referent || "__auto" + instances.length,
        parentRef: stack.length ? stack[stack.length - 1].referent : null,
        isService: stack.length === 0 && isPlaceService(attrs.class || ""),
        props: [],
      };
      instances.push(item);
      if (!selfClose) stack.push(item);
      continue;
    }
    if (tagName === "Properties") {
      props = stack.length ? stack[stack.length - 1].props : null;
      continue;
    }
    if (props && VALUE_TAGS.has(tagName) && !selfClose) {
      const attrs = parseAttrs(raw);
      const end = findClose(text, tagName, i);
      const inner = text.slice(i, end.start);
      i = end.next;
      const prop = decodeValue(tagName, attrs.name || "", inner);
      if (prop && props.length < RBX_LIMITS.maxPropsPerItem) props.push(prop);
    }
  }
  if (!instances.length) throw new Error("XML sem instâncias.");
  return { instances };
}
