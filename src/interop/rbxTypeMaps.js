import { getClassDef, isClass } from "../datamodel/classes.js";


import { IL_PUBLIC_API } from "../lighting/publicApiCore.js";

export const RBX_LIMITS = Object.freeze({
  maxFileBytes: 50 * 1024 * 1024,
  maxInstances: 100000,
  maxDepth: 500,
  maxPropsPerItem: 512,
  maxStringLen: 4 * 1024 * 1024,
});

function invert(map) {
  const out = {};
  for (const key of Object.keys(map)) out[map[key]] = key;
  return Object.freeze(out);
}

const MATERIAL = Object.freeze({
  Plastic: 256, SmoothPlastic: 272, Neon: 288,
  Wood: 512, WoodPlanks: 528,
  Marble: 784, Basalt: 788, Slate: 800, CrackedLava: 804,
  Concrete: 816, Limestone: 820, Granite: 832, Pavement: 836,
  Brick: 848, Pebble: 864, Cobblestone: 880, Rock: 896, Sandstone: 912,
  CorrodedMetal: 1040, DiamondPlate: 1056, Foil: 1072, Metal: 1088,
  Grass: 1280, Sand: 1296, Fabric: 1312, Snow: 1328, Mud: 1344,
  Ground: 1360, Asphalt: 1376, Salt: 1392,
  Ice: 1536, Glacier: 1552, Glass: 1568,
  Cardboard: 1600, Carpet: 1616, Leather: 1680, Plaster: 1696, Rubber: 1712,


  Air: 1792, Water: 2048,
});

const SHAPE = Object.freeze({ Ball: 0, Block: 1, Cylinder: 2, Wedge: 3, CornerWedge: 4 });

const SURFACE = Object.freeze({
  Smooth: 0, Glue: 1, Weld: 2, Studs: 3, Inlet: 4,
  Universal: 5, Hinge: 6, Motor: 7, SteppingMotor: 8,
});

const NORMAL_ID = Object.freeze({ Right: 0, Top: 1, Back: 2, Left: 3, Bottom: 4, Front: 5 });

const TECHNOLOGY = Object.freeze({ Voxel: 1, Compatibility: 2, ShadowMap: 3, Future: 4 });

const MODEL_STREAMING = Object.freeze({ Default: 0, Atomic: 1, Persistent: 2, PersistentPerPlayer: 3 });

export const TOKENS = Object.freeze({
  Material: Object.freeze({ toRbx: MATERIAL, fromRbx: invert(MATERIAL), fallback: "Plastic" }),
  Shape: Object.freeze({ toRbx: SHAPE, fromRbx: invert(SHAPE), fallback: "Block" }),
  SurfaceType: Object.freeze({ toRbx: SURFACE, fromRbx: invert(SURFACE), fallback: "Smooth" }),
  NormalId: Object.freeze({ toRbx: NORMAL_ID, fromRbx: invert(NORMAL_ID), fallback: "Front" }),
  LightingTechnology: Object.freeze({ toRbx: TECHNOLOGY, fromRbx: invert(TECHNOLOGY), fallback: "ShadowMap" }),
  ModelStreamingMode: Object.freeze({ toRbx: MODEL_STREAMING, fromRbx: invert(MODEL_STREAMING), fallback: "Default" }),
});

export function enumToToken(tokenId, value) {
  const t = TOKENS[tokenId];
  if (!t) return null;
  const n = t.toRbx[value];
  return typeof n === "number" ? n : t.toRbx[t.fallback];
}

export function tokenToEnum(tokenId, num) {
  const t = TOKENS[tokenId];
  if (!t) return null;
  const name = t.fromRbx[num];
  return typeof name === "string" ? name : t.fallback;
}

export function classIsA(className, ancestor) {
  let cur = className;
  let hops = 0;
  while (cur && hops < 32) {
    if (cur === ancestor) return true;
    const def = getClassDef(cur);
    cur = def ? def.extends : null;
    hops += 1;
  }
  return false;
}

function e(internal, rbx, kind, tokenId) {
  return Object.freeze({ internal, rbx, kind, tokenId: tokenId || null });
}

const BASEPART_ENTRIES = Object.freeze([
  e("Size", "size", "vector3"),
  e("Anchored", "Anchored", "bool"),
  e("CanCollide", "CanCollide", "bool"),
  e("CanTouch", "CanTouch", "bool"),
  e("CanQuery", "CanQuery", "bool"),
  e("CastShadow", "CastShadow", "bool"),
  e("Locked", "Locked", "bool"),
  e("Massless", "Massless", "bool"),
  e("Transparency", "Transparency", "float"),
  e("Color", "Color3uint8", "color3uint8"),
  e("Material", "Material", "token", "Material"),
  e("CollisionGroup", "CollisionGroup", "string"),
  e("TopSurface", "TopSurface", "token", "SurfaceType"),
  e("BottomSurface", "BottomSurface", "token", "SurfaceType"),
  e("FrontSurface", "FrontSurface", "token", "SurfaceType"),
  e("BackSurface", "BackSurface", "token", "SurfaceType"),
  e("LeftSurface", "LeftSurface", "token", "SurfaceType"),
  e("RightSurface", "RightSurface", "token", "SurfaceType"),
]);

export const FAMILIES = Object.freeze([
  Object.freeze({
    id: "basePart",
    matches: (cls) => classIsA(cls, "BasePart"),
    entries: BASEPART_ENTRIES,
  }),
  Object.freeze({
    id: "partShape",
    matches: (cls) => cls === "Part",
    entries: Object.freeze([e("Shape", "shape", "token", "Shape")]),
  }),
  Object.freeze({
    id: "spawnLocation",
    matches: (cls) => cls === "SpawnLocation",
    entries: Object.freeze([
      e("Enabled", "Enabled", "bool"),
      e("Neutral", "Neutral", "bool"),
      e("Duration", "Duration", "int"),
      e("AllowTeamChangeOnTouch", "AllowTeamChangeOnTouch", "bool"),
    ]),
  }),
  Object.freeze({
    id: "script",
    matches: (cls) => classIsA(cls, "Script"),
    entries: Object.freeze([
      e("Source", "Source", "protectedString"),
      e("Disabled", "Disabled", "bool"),
    ]),
  }),
  Object.freeze({
    id: "model",
    matches: (cls) => classIsA(cls, "Model"),
    entries: Object.freeze([e("ModelStreamingMode", "ModelStreamingMode", "token", "ModelStreamingMode")]),
  }),
  Object.freeze({
    id: "lighting",
    matches: (cls) => cls === "Lighting",
    entries: Object.freeze([
      e("Ambient", "Ambient", "color3"),
      e("Brightness", "Brightness", "float"),
      e("ColorShift_Bottom", "ColorShift_Bottom", "color3"),
      e("ColorShift_Top", "ColorShift_Top", "color3"),
      e("EnvironmentDiffuseScale", "EnvironmentDiffuseScale", "float"),
      e("EnvironmentSpecularScale", "EnvironmentSpecularScale", "float"),
      e("ExposureCompensation", "ExposureCompensation", "float"),
      e("FogColor", "FogColor", "color3"),
      e("FogEnd", "FogEnd", "float"),
      e("FogStart", "FogStart", "float"),
      e("GeographicLatitude", "GeographicLatitude", "float"),
      e("GlobalShadows", "GlobalShadows", "bool"),
      e("OutdoorAmbient", "OutdoorAmbient", "color3"),
      e("ShadowSoftness", "ShadowSoftness", "float"),
      e("Technology", "Technology", "token", "LightingTechnology"),
      e("TimeOfDay", "TimeOfDay", "string"),
    ]),
  }),
  Object.freeze({
    id: "light",
    matches: (cls) => classIsA(cls, "Light"),
    entries: Object.freeze([
      e("Brightness", "Brightness", "float"),
      e("Color", "Color", "color3"),
      e("Enabled", "Enabled", "bool"),
      e("Shadows", "Shadows", "bool"),
    ]),
  }),
  Object.freeze({
    id: "lightRange",
    matches: (cls) => cls === "PointLight" || cls === "SpotLight" || cls === "SurfaceLight",
    entries: Object.freeze([e("Range", "Range", "float")]),
  }),
  Object.freeze({
    id: "lightCone",
    matches: (cls) => cls === "SpotLight" || cls === "SurfaceLight",
    entries: Object.freeze([
      e("Angle", "Angle", "float"),
      e("Face", "Face", "token", "NormalId"),
    ]),
  }),
  Object.freeze({
    id: "atmosphere",
    matches: (cls) => cls === "Atmosphere",
    entries: Object.freeze([
      e("Color", "Color", "color3"),
      e("Decay", "Decay", "color3"),
      e("Density", "Density", "float"),
      e("Glare", "Glare", "float"),
      e("Haze", "Haze", "float"),
      e("Offset", "Offset", "float"),
    ]),
  }),
  Object.freeze({
    id: "stringValue",
    matches: (cls) => cls === "StringValue",
    entries: Object.freeze([e("Value", "Value", "string")]),
  }),
  Object.freeze({
    id: "boolValue",
    matches: (cls) => cls === "BoolValue",
    entries: Object.freeze([e("Value", "Value", "bool")]),
  }),
  Object.freeze({
    id: "intValue",
    matches: (cls) => cls === "IntValue",
    entries: Object.freeze([e("Value", "Value", "int64")]),
  }),
  Object.freeze({
    id: "numberValue",
    matches: (cls) => cls === "NumberValue",
    entries: Object.freeze([e("Value", "Value", "double")]),
  }),
  Object.freeze({
    id: "vector3Value",
    matches: (cls) => cls === "Vector3Value",
    entries: Object.freeze([e("Value", "Value", "vector3")]),
  }),
  Object.freeze({
    id: "color3Value",
    matches: (cls) => cls === "Color3Value",
    entries: Object.freeze([e("Value", "Value", "color3")]),
  }),
  Object.freeze({
    id: "objectValue",
    matches: (cls) => cls === "ObjectValue",
    entries: Object.freeze([e("Value", "Value", "ref")]),
  }),
]);















const IL_KIND_BY_TYPE = Object.freeze({
  boolean: "bool",
  number: "float",
  string: "string",
  enum: "string",
  color3: "color3",
  vector3: "vector3",
});

function ilEntry(p) {
  const kind = IL_KIND_BY_TYPE[p.type];
  if (!kind) return null;
  return Object.freeze({
    internal: p.prop,
    rbx: p.prop,
    kind,
    tokenId: null,
    nullable: p.tristate === true,
    ilf44: true,
  });
}

const IL_FAMILIES = Object.freeze(Object.keys(IL_PUBLIC_API).map((className) => {
  const def = IL_PUBLIC_API[className];
  const entries = Object.freeze(def.props.map(ilEntry).filter(Boolean));


  const matches = def.abstract ? (cls) => classIsA(cls, className) : (cls) => cls === className;
  return Object.freeze({ id: "il:" + className, matches, entries });
}));


export function ilEntriesFor(className) {
  const out = [];
  for (const fam of IL_FAMILIES) {
    let match = false;
    try { match = fam.matches(className); } catch (_) { match = false; }
    if (match) out.push(...fam.entries);
  }
  return out;
}


export function ilAbsentServiceDefaults(className, presentRbxNames) {
  const out = [];
  const present = presentRbxNames instanceof Set ? presentRbxNames : new Set(presentRbxNames || []);
  const def = IL_PUBLIC_API[className];
  if (!def || def.abstract) return out;
  for (const p of def.props) {
    if (!IL_KIND_BY_TYPE[p.type]) continue;
    if (present.has(p.prop)) continue;
    out.push({ prop: p.prop, value: p.default });
  }
  return out;
}

const _entriesCache = new Map();

export function getEntriesFor(className) {
  if (_entriesCache.has(className)) return _entriesCache.get(className);
  const out = [];
  const seen = new Set();
  for (const fam of FAMILIES) {
    let match = false;
    try { match = fam.matches(className); } catch (_) { match = false; }
    if (!match) continue;
    for (const entry of fam.entries) {
      if (seen.has(entry.rbx)) continue;
      seen.add(entry.rbx);
      out.push(entry);
    }
  }


  for (const entry of ilEntriesFor(className)) {
    if (seen.has(entry.rbx)) continue;
    seen.add(entry.rbx);
    out.push(entry);
  }
  _entriesCache.set(className, out);
  return out;
}

export function findEntryByRbxName(className, rbxName) {
  for (const entry of getEntriesFor(className)) {
    if (entry.rbx === rbxName) return entry;
  }
  return null;
}

const RBX_CLASS_CONVERSIONS = Object.freeze({
  WedgePart: Object.freeze({ className: "Part", presets: Object.freeze({ Shape: "Wedge" }) }),
  CornerWedgePart: Object.freeze({ className: "Part", presets: Object.freeze({ Shape: "CornerWedge" }) }),
});

export function rbxClassToInternal(rbxClass) {
  const conv = RBX_CLASS_CONVERSIONS[rbxClass];
  if (conv) return conv;
  if (isClass(rbxClass)) return { className: rbxClass, presets: null };
  return null;
}

export const PLACE_SERVICES = Object.freeze([
  "Workspace", "Lighting", "ReplicatedFirst", "ReplicatedStorage",
  "ServerStorage", "ServerScriptService", "StarterGui", "StarterPack",
  "StarterPlayer", "SoundService", "Teams",
]);

export function isPlaceService(className) {
  return PLACE_SERVICES.indexOf(className) !== -1;
}

const DEG = Math.PI / 180;

export function eulerDegToMatrix(rxDeg, ryDeg, rzDeg) {
  const a = Math.cos(rxDeg * DEG), b = Math.sin(rxDeg * DEG);
  const c = Math.cos(ryDeg * DEG), d = Math.sin(ryDeg * DEG);
  const ee = Math.cos(rzDeg * DEG), f = Math.sin(rzDeg * DEG);
  return [
    c * ee, -c * f, d,
    a * f + b * ee * d, a * ee - b * f * d, -b * c,
    b * f - a * ee * d, b * ee + a * f * d, a * c,
  ];
}

export function matrixToEulerDeg(m) {
  const clamp = (n) => Math.min(1, Math.max(-1, n));
  const m11 = m[0], m12 = m[1], m13 = m[2];
  const m22 = m[4], m23 = m[5];
  const m32 = m[7], m33 = m[8];
  const y = Math.asin(clamp(m13));
  let x, z;
  if (Math.abs(m13) < 0.9999999) {
    x = Math.atan2(-m23, m33);
    z = Math.atan2(-m12, m11);
  } else {
    x = Math.atan2(m32, m22);
    z = 0;
  }
  return { x: x / DEG, y: y / DEG, z: z / DEG };
}
