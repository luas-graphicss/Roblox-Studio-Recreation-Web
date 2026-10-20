export const REFR_CACHE_KEY = "rswGlassRefr1";


export const GRAB_MAX_SIZE = 1280;

export const GRAB_SCALE = 0.5;

export const DEFAULT_GLASS_IOR = 1.52;               


export const GLASS_REFR_DEFS = Object.freeze({
  Glass: Object.freeze({ ior: 1.52, absorb: Object.freeze([0.1, 0.06, 0.04]), mip: 0.0, thick: 0.6 }),
  Ice: Object.freeze({ ior: 1.31, absorb: Object.freeze([0.3, 0.14, 0.07]), mip: 1.5, thick: 1.2 }),
  Glacier: Object.freeze({ ior: 1.31, absorb: Object.freeze([0.45, 0.22, 0.12]), mip: 2.5, thick: 2.0 }),


  ForceField: Object.freeze({ ior: 1.05, absorb: Object.freeze([0, 0, 0]), mip: 0.8, thick: 0.3 }),
});

export function isRefractiveMaterialName(name) {
  return !!GLASS_REFR_DEFS[name];
}


export function iorToF0(ior) {
  const n = Number(ior);
  if (!Number.isFinite(n) || n <= 0) return 0;
  const r = (n - 1) / (n + 1);
  return r * r;
}


export function iorToOffset(ior) {
  const n = Number(ior);
  if (!Number.isFinite(n)) return 0;
  return Math.min(0.12, Math.max(0, (n - 1) * 0.18));
}


export function fresnelSchlick(ndv, f0) {
  const c = Math.min(1, Math.max(0, Number(ndv) || 0));
  const f = Math.min(1, Math.max(0, Number(f0) || 0));
  return f + (1 - f) * Math.pow(1 - c, 5);
}


export function beerLambert(absorb, thickness) {
  const t = Math.max(0, Number(thickness) || 0);
  const a = Array.isArray(absorb) ? absorb : [0, 0, 0];
  return [
    Math.exp(-(Number(a[0]) || 0) * t),
    Math.exp(-(Number(a[1]) || 0) * t),
    Math.exp(-(Number(a[2]) || 0) * t),
  ];
}


export function approxThickness(ndv, base) {
  const b = Math.max(0, Number(base) || 0);
  const c = Math.max(0.08, Math.min(1, Number(ndv) || 0));
  return Math.min(b / c, b * 12.5);
}


export function transmissionFor(alpha, ndv, f0) {
  const a = Math.min(1, Math.max(0, Number(alpha) || 0));
  return (1 - a) * (1 - fresnelSchlick(ndv, f0));
}


export function glassShaderStatics(name, iorOverride) {
  const def = GLASS_REFR_DEFS[name];
  if (!def) return null;
  let ior = def.ior;


  if (name === "Glass" && iorOverride != null) {
    const o = Number(iorOverride);
    if (Number.isFinite(o)) ior = Math.min(3, Math.max(1, o));
  }
  return {
    ior,
    f0: iorToF0(ior),
    offset: iorToOffset(ior),
    absorb: def.absorb.slice(),
    mip: def.mip,
    thick: def.thick,
  };
}


export function refractionEligible(opts) {
  const o = opts || {};
  if (o.flag === false) return false;
  if (o.lightModel === "basic") return false;
  if (o.weak === true && o.tier === "micro") return false;
  if (o.patchesDisabled === true) return false;
  return true;
}


export function grabPlan(opts) {
  const w = Math.max(1, Math.floor(Number(opts && opts.w) || 0) || 1);
  const h = Math.max(1, Math.floor(Number(opts && opts.h) || 0) || 1);
  const scale = Math.min(GRAB_SCALE, GRAB_MAX_SIZE / Math.max(w, h));
  return {
    w: Math.max(8, Math.floor(w * scale)),
    h: Math.max(8, Math.floor(h * scale)),
    scale,
  };
}


export function shouldGrab(opts) {
  const o = opts || {};
  const bit = o.interleaveBit ? 1 : 0;
  if (!(Number(o.glassCount) > 0)) return { render: false, nextBit: bit };
  const nextBit = (bit + 1) & 1;
  if (o.camSame === true && o.continuous === true && nextBit === 1) return { render: false, nextBit };
  return { render: true, nextBit };
}


export function buildGlassRefrFragPars() {
  return [
    "uniform sampler2D uRswScene;",
    "uniform vec2 uRswSceneSize;",
    "uniform float uRswSceneOn;",
    "uniform float uRswGlassF0;",
    "uniform float uRswGlassOff;",
    "uniform float uRswGlassMip;",
    "uniform float uRswGlassThk;",
    "uniform vec3 uRswGlassAbs;",
  ].join("\n");
}


export function buildGlassRefrFragMain() {
  return [
    "{",
    "\tif (uRswSceneOn > 0.5) {",
    "\t\tvec3 rswGN = normalize(normal);",
    "\t\tvec3 rswGV = normalize(vViewPosition);",
    "\t\tfloat rswGNdV = clamp(abs(dot(rswGN, rswGV)), 0.08, 1.0);",

    "\t\tvec2 rswGUv = gl_FragCoord.xy / uRswSceneSize;",
    "\t\trswGUv += rswGN.xy * uRswGlassOff * (0.65 + 0.35 * (1.0 - rswGNdV));",
    "\t\trswGUv = clamp(rswGUv, vec2(0.002), vec2(0.998));",

    "\t\tvec4 rswGS = texture2D(uRswScene, rswGUv, uRswGlassMip);",

    "\t\tfloat rswGThk = min(uRswGlassThk / rswGNdV, uRswGlassThk * 12.5);",
    "\t\tvec3 rswGT = exp(-uRswGlassAbs * rswGThk);",

    "\t\tfloat rswGF = uRswGlassF0 + (1.0 - uRswGlassF0) * pow(1.0 - rswGNdV, 5.0);",
    "\t\tfloat rswGTr = (1.0 - clamp(diffuseColor.a, 0.0, 1.0)) * (1.0 - rswGF);",


    "\t\tvec3 rswGBg = mix(diffuseColor.rgb * 0.55, rswGS.rgb, clamp(rswGS.a, 0.0, 1.0));",
    "\t\ttotalEmissiveRadiance += rswGBg * rswGT * rswGTr;",


    "\t\tdiffuseColor.rgb *= (1.0 - rswGTr);",
    "\t\tdiffuseColor.a = 1.0;",
    "\t}",
    "}",
  ].join("\n");
}
