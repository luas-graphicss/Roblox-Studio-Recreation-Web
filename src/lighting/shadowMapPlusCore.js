export const SM_PLUS_TEXEL_TARGET = 0.35;                                   


export function resolveShadowMapPlus(raw, tech) {
  if (tech !== "ShadowMap") return false;
  if (raw === false) return false;
  return raw === true || raw === null || raw === undefined;
}
