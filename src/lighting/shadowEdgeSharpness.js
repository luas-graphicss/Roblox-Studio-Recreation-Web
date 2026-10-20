export const DEFAULT_SHADOW_SOFTNESS = 0.2;


export const SHARP_EDGE_MIN_TEXELS = 1;


export const SHARP_EDGE_MAX_TEXELS = 5;


export const LOCAL_LIGHT_EDGE_TEXELS = 1;


export const SUN_SOFTNESS_SCALE_SHADOW_MAP = 5;
export const SUN_SOFTNESS_SCALE_FUTURE = 6;
export const SUN_SOFTNESS_SCALE_VOXEL = 10;

export function sunSoftnessScaleFor(technology) {
  if (technology === "Voxel") return SUN_SOFTNESS_SCALE_VOXEL;
  if (technology === "Future") return SUN_SOFTNESS_SCALE_FUTURE;
  return SUN_SOFTNESS_SCALE_SHADOW_MAP;
}


function readShadowSoftness(softness) {
  const parsed = Number(softness);
  return Number.isFinite(parsed) ? parsed : DEFAULT_SHADOW_SOFTNESS;
}


export function sunEdgeTexels(softness, technology) {
  const softnessTexels = readShadowSoftness(softness) * sunSoftnessScaleFor(technology);
  return Math.max(SHARP_EDGE_MIN_TEXELS, softnessTexels);
}


export function softKernelPenumbraTexels(softness) {
  return Math.min(SHARP_EDGE_MAX_TEXELS, sunEdgeTexels(softness, "ShadowMap"));
}
