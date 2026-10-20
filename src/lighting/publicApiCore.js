"use strict";

function hardAssert(cond, msg) {
  if (!cond) throw new Error("[publicApiCore] " + msg);
}


export const ENUM_OPTIONS = Object.freeze({
  RenderStyle: Object.freeze(["Classic", "Realistic"]),
  ToneMapper: Object.freeze(["Legacy", "AgX", "ACES", "PBRNeutral"]),
  ColorGradingPreset: Object.freeze(["None", "FilmicCool", "Golden", "Noir"]),
  BloomMode: Object.freeze(["Classic", "Energy"]),
  LightPreset: Object.freeze(["None", "Candle", "Tungsten", "Halogen", "LED", "Fluorescent", "Sodium", "Daylight"]),
  NormalMapConvention: Object.freeze(["Auto", "OpenGL", "DirectX"]),
  AlphaMode: Object.freeze(["Overlay", "Transparency", "TintMask"]),
  NormalId: Object.freeze(["Front", "Back", "Top", "Bottom", "Left", "Right"]),
  ProbeShape: Object.freeze(["Box", "Sphere"]),
});


function e(prop, type, def, extra) {
  return Object.freeze(Object.assign({ prop: prop, type: type, default: def }, extra || {}));
}

export const IL_PUBLIC_API = Object.freeze({
  Lighting: Object.freeze({
    props: Object.freeze([
      e("RenderStyle", "enum", "Classic", { options: ENUM_OPTIONS.RenderStyle, phase: "IL-F2" }),
      e("ToneMapper", "enum", "Legacy", { options: ENUM_OPTIONS.ToneMapper, phase: "IL-F3" }),
      e("AutoExposure", "boolean", null, { tristate: true, phase: "IL-F5" }),
      e("LocalExposure", "boolean", null, { tristate: true, phase: "IL-F6" }),
      e("LocalExposureStrength", "number", 0.35, { min: 0, max: 1, phase: "IL-F6" }),
      e("MaterialFeatures", "boolean", null, { tristate: true, phase: "IL-F11" }),
      e("GlassRefraction", "boolean", null, { tristate: true, phase: "IL-F12" }),
      e("IndexOfRefraction", "number", 1.52, { min: 1, max: 3, phase: "IL-F12" }),
      e("SkyTurbidity", "number", 3, { min: 1.7, max: 10, phase: "IL-F14" }),
      e("SkyGroundAlbedo", "number", 0.25, { min: 0, max: 1, phase: "IL-F14" }),
      e("VolumetricFog", "boolean", null, { tristate: true, phase: "IL-F18" }),
      e("SSR", "boolean", null, { tristate: true, phase: "IL-F21" }),
      e("ReflectionProbes", "boolean", null, { tristate: true, phase: "IL-F22" }),
      e("PlanarReflections", "boolean", null, { tristate: true, phase: "IL-F23" }),
      e("LightPhotometry", "boolean", null, { tristate: true, phase: "IL-F27" }),
      e("ShadowAtlas", "boolean", null, { tristate: true, phase: "F14" }),                       
      e("LightCluster", "boolean", null, { tristate: true, phase: "IL-F28" }),
      e("AreaLightParts", "boolean", null, { tristate: true, phase: "IL-F37" }),
      e("LensFlare", "boolean", null, { tristate: true, phase: "IL-F30" }),
      e("LensFlareIntensity", "number", 0.35, { min: 0, max: 1, phase: "IL-F30" }),
      e("CinematicPostProcess", "boolean", null, { tristate: true, phase: "CP-F34" }),
      e("ColorGradingPreset", "enum", "None", { options: ENUM_OPTIONS.ColorGradingPreset, phase: "IL-F31" }),
      e("WhiteBalanceTemperature", "number", 6500, { min: 1500, max: 15000, phase: "IL-F31" }),
      e("WhiteBalanceTint", "number", 0, { min: -1, max: 1, phase: "IL-F31" }),
      e("ColorGradingLutAmount", "number", 1, { min: 0, max: 1, phase: "IL-F31" }),
      e("TemporalAA", "boolean", null, { tristate: true, phase: "IL-F32" }),
      e("MotionBlur", "boolean", null, { tristate: true, phase: "IL-F32" }),

      e("ObjectMotionVectors", "boolean", null, { tristate: true, phase: "IL-F40" }),
      e("TemporalUpscale", "boolean", null, { tristate: true, phase: "IL-F40" }),
      e("ChromaticAberration", "number", 0, { min: 0, max: 1, phase: "IL-F32" }),
      e("FilmGrain", "number", 0, { min: 0, max: 1, phase: "IL-F32" }),
    ]),
  }),

  Light: Object.freeze({
    abstract: true,
    qaClass: "PointLight",
    props: Object.freeze([
      e("Temperature", "number", 0, { min: 0, max: 12000, phase: "IL-F27" }),
      e("LightPreset", "enum", "None", { options: ENUM_OPTIONS.LightPreset, phase: "IL-F27" }),
    ]),
  }),
  PointLight: Object.freeze({
    props: Object.freeze([
      e("SourceRadius", "number", 0, { min: 0, max: 8, phase: "IL-F25" }),
      e("IesProfile", "string", "", { phase: "IL-F26" }),
    ]),
  }),
  SpotLight: Object.freeze({
    props: Object.freeze([
      e("SourceRadius", "number", 0, { min: 0, max: 8, phase: "IL-F25" }),
      e("IesProfile", "string", "", { phase: "IL-F26" }),
      e("LightFunction", "string", "", { phase: "IL-F26" }),
      e("LightFunctionRotation", "number", 0, { min: 0, max: 360, phase: "IL-F26" }),
    ]),
  }),
  SurfaceLight: Object.freeze({
    props: Object.freeze([
      e("IesProfile", "string", "", { phase: "IL-F26" }),
      e("LightFunction", "string", "", { phase: "IL-F26" }),
      e("LightFunctionRotation", "number", 0, { min: 0, max: 360, phase: "IL-F26" }),
    ]),
  }),

  RectLight: Object.freeze({
    newClass: true,
    props: Object.freeze([
      e("Face", "enum", "Front", { options: ENUM_OPTIONS.NormalId, countCheck: false, phase: "IL-F25" }),
      e("Width", "number", 2, { min: 0.05, max: 64, countCheck: false, phase: "IL-F25" }),
      e("Height", "number", 1, { min: 0.05, max: 64, countCheck: false, phase: "IL-F25" }),
      e("Range", "number", 16, { min: 0, max: 60, countCheck: false, phase: "IL-F25" }),
    ]),
  }),

    TubeLight: Object.freeze({
      newClass: true,
      props: Object.freeze([
        e("Face", "enum", "Front", { options: ENUM_OPTIONS.NormalId, countCheck: false, phase: "IL-F37" }),
        e("Length", "number", 2, { min: 0.05, max: 64, countCheck: false, phase: "IL-F37" }),
        e("Range", "number", 16, { min: 0, max: 60, countCheck: false, phase: "IL-F37" }),
        e("TubeRadius", "number", 0.1, { min: 0.01, max: 8, phase: "IL-F37" }),
      ]),
    }),

  ReflectionProbe: Object.freeze({
    newClass: true,
    props: Object.freeze([
      e("Enabled", "boolean", true, { countCheck: false, phase: "IL-F22" }),
      e("Shape", "enum", "Box", { options: ENUM_OPTIONS.ProbeShape, countCheck: false, phase: "IL-F22" }),
      e("Position", "vector3", Object.freeze({ x: 0, y: 8, z: 0 }), { countCheck: false, phase: "IL-F22" }),
      e("Size", "vector3", Object.freeze({ x: 32, y: 16, z: 32 }), { countCheck: false, phase: "IL-F22" }),
      e("Priority", "number", 0, { countCheck: false, qa: 3, phase: "IL-F22" }),
      e("Resolution", "number", 64, { countCheck: false, qa: 128, phase: "IL-F22" }),
      e("BlendDistance", "number", 2, { min: 0, max: 16, phase: "IL-F22" }),
    ]),
  }),

  Clouds: Object.freeze({
    newClass: true,
    props: Object.freeze([
      e("Enabled", "boolean", true, { countCheck: false, phase: "IL-F19" }),
      e("Cover", "number", 0.5, { min: 0, max: 1, phase: "IL-F19" }),
      e("Density", "number", 0.7, { min: 0, max: 1, countCheck: false, phase: "IL-F19" }),
      e("Color", "color3", Object.freeze({ r: 1, g: 1, b: 1 }), { countCheck: false, phase: "IL-F19" }),
    ]),
  }),
  Sky: Object.freeze({
    props: Object.freeze([
      e("SkyboxHdri", "string", "", { phase: "IL-F16" }),
      e("HdriIntensity", "number", 1, { min: 0, max: 8, phase: "IL-F16" }),
      e("MoonPhase", "number", 0.5, { min: 0, max: 1, phase: "IL-F15" }),
    ]),
  }),
  BloomEffect: Object.freeze({
    props: Object.freeze([
      e("Mode", "enum", "Classic", { options: ENUM_OPTIONS.BloomMode, countCheck: false, phase: "IL-F29" }),
      e("Anamorphic", "number", 1, { min: 1, max: 3, phase: "IL-F29" }),
      e("Dirt", "number", 0, { min: 0, max: 1, phase: "IL-F29" }),
    ]),
  }),

  BasePart: Object.freeze({
    abstract: true,
    qaClass: "Part",
    props: Object.freeze([
      e("Mirror", "boolean", false, { phase: "IL-F23" }),
    ]),
  }),
  SurfaceAppearance: Object.freeze({
    props: Object.freeze([
      e("NormalMapConvention", "enum", "Auto", { options: ENUM_OPTIONS.NormalMapConvention, phase: "IL-F10" }),
      e("HeightMap", "string", "", { countCheck: false, phase: "IL-F10" }),
      e("HeightScale", "number", 0.02, { min: 0, max: 0.2, countCheck: false, phase: "IL-F10" }),
      e("DetailColorMap", "string", "", { phase: "IL-F10" }),
      e("DetailNormalMap", "string", "", { phase: "IL-F10" }),
      e("DetailTiling", "number", 8, { min: 0.05, max: 256, phase: "IL-F10" }),
    ]),
  }),
});


export const IL_PUBLIC_API_TOTAL = 73;

export function publicApiClasses() {
  return Object.keys(IL_PUBLIC_API);
}

export function publicApiEntries() {
  const out = [];
  for (const className of Object.keys(IL_PUBLIC_API)) {
    const def = IL_PUBLIC_API[className];
    for (const p of def.props) out.push(Object.freeze(Object.assign({ className: className }, p)));
  }
  return out;
}

export function entriesForClass(className) {
  const def = IL_PUBLIC_API[className];
  return def ? def.props.slice() : [];
}

export function defaultFor(className, prop) {
  const def = IL_PUBLIC_API[className];
  if (!def) return undefined;
  const hit = def.props.find(function (p) { return p.prop === prop; });
  return hit ? hit.default : undefined;
}

export function isTriState(className, prop) {
  const def = IL_PUBLIC_API[className];
  if (!def) return false;
  const hit = def.props.find(function (p) { return p.prop === prop; });
  return !!(hit && hit.tristate);
}





export function expectedRegistrationCounts() {
  const counts = new Map();
  for (const entry of publicApiEntries()) {
    if (entry.countCheck === false) continue;
    counts.set(entry.prop, (counts.get(entry.prop) || 0) + 1);
  }
  return counts;
}


export function migrateSavedProps(className, savedProps) {
  const def = IL_PUBLIC_API[className];
  hardAssert(def, "classe fora do inventário: " + className);
  const saved = savedProps && typeof savedProps === "object" ? savedProps : {};
  const props = {};
  for (const k of Object.keys(saved)) props[k] = saved[k];
  const defaulted = [];
  for (const p of def.props) {
    if (Object.prototype.hasOwnProperty.call(saved, p.prop)) continue;
    props[p.prop] = p.default;
    defaulted.push(p.prop);
  }
  return { props: props, defaulted: defaulted };
}


export function qaValueFor(entry) {
  if (entry.qa !== undefined) return entry.qa;
  const t = entry.type;
  if (t === "boolean") return entry.default === true ? false : true;
  if (t === "enum") {
    const alt = entry.options.find(function (o) { return o !== entry.default; });
    return alt !== undefined ? alt : entry.default;
  }
  if (t === "number") {
    const min = typeof entry.min === "number" ? entry.min : entry.default - 1;
    const max = typeof entry.max === "number" ? entry.max : entry.default + 1;
    const mid = min + (max - min) * 0.5;
    let v = Math.abs(mid - entry.default) > 1e-9 ? mid : max;
    if (Math.abs(v - entry.default) < 1e-9) v = min;
    return v;
  }
  if (t === "string") return "qa-il-f35";
  if (t === "vector3") return { x: entry.default.x + 1, y: entry.default.y + 2, z: entry.default.z + 3 };
  if (t === "color3") return { r: 0.25, g: 0.5, b: 0.75 };
  hardAssert(false, "tipo sem qaValue: " + t);
}


export function roundTripPlan() {
  return publicApiEntries().map(function (entry) {
    const def = IL_PUBLIC_API[entry.className];
    return Object.freeze({
      className: entry.className,
      qaClass: def.qaClass || entry.className,
      newClass: !!def.newClass,
      prop: entry.prop,
      type: entry.type,
      default: entry.default,
      tristate: !!entry.tristate,
      options: entry.options || null,
      qaValue: qaValueFor(entry),
      phase: entry.phase,
    });
  });
}


(function selfCheck() {
  const entries = publicApiEntries();
  hardAssert(entries.length === IL_PUBLIC_API_TOTAL, "inventário deve ter " + IL_PUBLIC_API_TOTAL + " props, tem " + entries.length);
  const seen = new Set();
  for (const entry of entries) {
    hardAssert(typeof entry.prop === "string" && entry.prop.length > 0, "prop sem nome");
    const key = entry.className + "." + entry.prop;
    hardAssert(!seen.has(key), "entrada duplicada no inventário: " + key);
    seen.add(key);

    hardAssert(/^(IL-)?F\d+$/.test(entry.phase || ""), "fase inválida em " + key);
    if (entry.tristate) hardAssert(entry.default === null, "tri-state sem default null: " + key);
    if (entry.type === "enum") {
      hardAssert(Array.isArray(entry.options) && entry.options.indexOf(entry.default) !== -1, "enum default fora das options: " + key);
    }
    if (typeof entry.min === "number" && typeof entry.max === "number" && typeof entry.default === "number") {
      hardAssert(entry.default >= entry.min && entry.default <= entry.max, "default fora do clamp: " + key);
    }
    const q = qaValueFor(entry);
    hardAssert(JSON.stringify(q) !== JSON.stringify(entry.default), "qaValue igual ao default: " + key);
  }
})();
