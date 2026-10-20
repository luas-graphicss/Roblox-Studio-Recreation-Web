import { ccTransform } from "./postfxDietCore.js";

export const RENDER_STYLES = Object.freeze(["Classic", "Realistic"]);

export const CC_CLAMP_CLASSIC = 4;


export const CC_CLAMP_HDR = 65504;

export function sanitizeRenderStyle(raw) {
  return raw === "Realistic" ? "Realistic" : "Classic";
}


export function hdrPipelinePlan(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  const renderStyle = sanitizeRenderStyle(src.renderStyle);
  const realistic = renderStyle === "Realistic";
  const byteFallback = src.dietByte === true;
  return Object.freeze({
    renderStyle,
    realistic,

    ccClampMax: realistic ? CC_CLAMP_HDR : CC_CLAMP_CLASSIC,
    byteFallback,

    hdrHonest: realistic && !byteFallback,
  });
}


export function ccProbe(rgb, ccParams, plan) {
  const p = plan && typeof plan === "object" && Number.isFinite(Number(plan.ccClampMax))
    ? plan
    : hdrPipelinePlan(null);
  return ccTransform(rgb, ccParams, p.ccClampMax);
}


const SRGB_SLOTS = Object.freeze([
  "map", "emissiveMap", "envMap", "background", "matcap",
  "sheenColorMap", "specularColorMap",
]);
const LINEAR_SLOTS = Object.freeze([
  "normalMap", "roughnessMap", "metalnessMap", "aoMap", "alphaMap",
  "bumpMap", "displacementMap", "lightMap", "gradientMap", "clearcoatMap",
  "clearcoatNormalMap", "clearcoatRoughnessMap", "transmissionMap",
  "thicknessMap", "specularIntensityMap", "iridescenceMap",
  "iridescenceThicknessMap", "anisotropyMap", "sheenRoughnessMap",
]);


export const AUDIT_TEXTURE_SLOTS = Object.freeze([
  ...SRGB_SLOTS.filter((s) => s !== "background"),
  ...LINEAR_SLOTS,
]);

export function expectedColorSpaceFor(slot) {
  if (typeof slot !== "string") return null;
  if (SRGB_SLOTS.indexOf(slot) >= 0) return "srgb";
  if (LINEAR_SLOTS.indexOf(slot) >= 0) return "linear";
  return null;
}


export function auditTextureColorSpaces(entries, consts) {
  const list = Array.isArray(entries) ? entries : [];
  const c = consts && typeof consts === "object" ? consts : {};
  const srgbVal = typeof c.srgb === "string" ? c.srgb : "srgb";
  const linVal = typeof c.linear === "string" ? c.linear : "";
  const linAlt = typeof c.linearAlt === "string" ? c.linearAlt : "srgb-linear";
  const issues = [];
  let ok = 0;
  let unclassified = 0;
  let checked = 0;
  for (const e of list) {
    if (!e || typeof e !== "object") continue;
    checked += 1;
    const expected = expectedColorSpaceFor(e.slot);
    if (expected === null) {
      unclassified += 1;
      continue;
    }
    const actual = typeof e.colorSpace === "string" ? e.colorSpace : "";
    const good = expected === "srgb"
      ? actual === srgbVal
      : actual === linVal || actual === linAlt;
    if (good) ok += 1;
    else issues.push({ slot: String(e.slot), name: typeof e.name === "string" ? e.name : "", expected, actual });
  }
  return { checked, ok, unclassified, issues };
}
