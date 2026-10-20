import { boxCenter, segmentLengthInsideBox } from "./llRaySlabCore.js";

export const SUBSURFACE_EXTINCTION_PER_STUD = 1.6;
export const SUBSURFACE_DEFAULT_THICKNESS_STUDS = 0.25;
export const SUBSURFACE_DEFAULT_WRAP = 0.5;
export const SUBSURFACE_DEFAULT_STRENGTH = 1;
export const SUBSURFACE_DEFAULT_SHARPNESS = 4;
export const SUBSURFACE_MAX_THICKNESS_STUDS = 8;
export const SUBSURFACE_AMBIENT_MIX = 0.25;
export const SUBSURFACE_FORWARD_MIX = 0.75;

export const SUBSURFACE_TIER_STRENGTH = Object.freeze({ fraco: 0, medio: 1, forte: 1 });

export function saturate(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return number < 0 ? 0 : number > 1 ? 1 : number;
}


export function wrappedBackLight(nDotL, wrap) {
  const backLit = Math.max(-Number(nDotL), 0);
  const wrapAmount = Math.max(Number(wrap) || 0, 0);
  const wrapped = saturate((backLit + wrapAmount) / (1 + wrapAmount));
  return wrapped * wrapped;
}

export function subsurfaceTransmittance(thicknessStuds, extinctionPerStud) {
  const thickness = Math.max(Number(thicknessStuds) || 0, 0);
  const extinction = Number.isFinite(extinctionPerStud)
    ? Math.max(extinctionPerStud, 0)
    : SUBSURFACE_EXTINCTION_PER_STUD;
  return Math.exp(-thickness * extinction);
}

export function forwardScatterLobe(viewDotLight, sharpness) {
  return Math.pow(saturate(viewDotLight), Math.max(Number(sharpness) || 1, 1));
}

export function resolveSubsurfaceMaterial(options) {
  const settings = options || {};
  const tierStrength = Object.prototype.hasOwnProperty.call(SUBSURFACE_TIER_STRENGTH, settings.tier)
    ? SUBSURFACE_TIER_STRENGTH[settings.tier]
    : 1;
  const strength = saturate(
    (Number.isFinite(settings.strength) ? settings.strength : SUBSURFACE_DEFAULT_STRENGTH) * tierStrength,
  );
  const thicknessStuds = Math.min(
    Math.max(Number.isFinite(settings.thicknessStuds) ? settings.thicknessStuds : SUBSURFACE_DEFAULT_THICKNESS_STUDS, 0),
    SUBSURFACE_MAX_THICKNESS_STUDS,
  );
  const wrap = Math.max(Number.isFinite(settings.wrap) ? settings.wrap : SUBSURFACE_DEFAULT_WRAP, 0);
  const sharpness = Math.max(
    Number.isFinite(settings.sharpness) ? settings.sharpness : SUBSURFACE_DEFAULT_SHARPNESS,
    1,
  );
  return { thicknessStuds, wrap, strength, sharpness, enabled: strength > 0 };
}


export function subsurfaceUniformVector(resolved) {
  return [resolved.thicknessStuds, resolved.wrap, resolved.strength, resolved.sharpness];
}

export function subsurfaceRadiance(options) {
  const settings = options || {};
  const material = settings.material || resolveSubsurfaceMaterial({});
  if (!material.strength) return [0, 0, 0];
  const lightColor = settings.lightColor || [0, 0, 0];
  const albedo = settings.albedo || [1, 1, 1];
  const wrapped = wrappedBackLight(settings.nDotL, material.wrap);
  const transmitted = subsurfaceTransmittance(material.thicknessStuds, settings.extinctionPerStud);
  const forward = forwardScatterLobe(settings.viewDotLight, material.sharpness);
  const gain = material.strength * wrapped * transmitted
    * (SUBSURFACE_AMBIENT_MIX + SUBSURFACE_FORWARD_MIX * forward);
  return [lightColor[0] * albedo[0] * gain, lightColor[1] * albedo[1] * gain, lightColor[2] * albedo[2] * gain];
}


export function measuredThicknessStuds(options) {
  const settings = options || {};
  const box = settings.box;
  if (!box) return SUBSURFACE_DEFAULT_THICKNESS_STUDS;
  const from = settings.surfacePoint || boxCenter(box);
  const to = settings.lightPosition || [0, 0, 0];
  const half = segmentLengthInsideBox(from, to, box);
  const thickness = half * (settings.surfacePoint ? 1 : 2);
  if (!(thickness > 0)) return 0;
  return Math.min(thickness, SUBSURFACE_MAX_THICKNESS_STUDS);
}


export function linearizeDepth(depth01, near, far) {
  const ndc = saturate(depth01) * 2 - 1;
  const denominator = far + near - ndc * (far - near);
  if (Math.abs(denominator) < 1e-9) return far;
  return (2 * near * far) / denominator;
}

export function depthFromViewDistance(viewDistance, near, far) {
  const distance = Math.max(Number(viewDistance) || 0, near);
  const ndc = (far + near) / (far - near) - (2 * far * near) / ((far - near) * distance);
  return saturate(ndc * 0.5 + 0.5);
}

export function thicknessFromShadowDepth(options) {
  const settings = options || {};
  const near = Number.isFinite(settings.near) ? settings.near : 0.5;
  const far = Number.isFinite(settings.far) ? settings.far : 100;
  const receiver = linearizeDepth(settings.receiverDepth01, near, far);
  const occluder = linearizeDepth(settings.occluderDepth01, near, far);
  return Math.min(Math.max(receiver - occluder, 0), SUBSURFACE_MAX_THICKNESS_STUDS);
}
