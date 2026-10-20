import { createSubstrateSmBsdfResult, evaluateSubstrateSmBsdf } from './ssmBsdfCore.js';
import {
  SSM_BSDF_MINIMUM_ROUGHNESS,
  SSM_BSDF_MINIMUM_DENOMINATOR,
  SSM_BSDF_MINIMUM_HALF_LENGTH_SQUARED,
} from './ssmBsdfNumerics.js';
import { tangentDotProduct } from './ssmTangentMath.js';
import { isSubstrateSmTangentFrameValid } from './ssmTangentFrameCore.js';

export const SSM_ANISOTROPY_ASPECT_FACTOR = 0.9;

function requireAnisotropy(value) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < -1 || value > 1) {
    throw new RangeError('SSM anisotropy must be a finite number within [-1, 1]');
  }
  return value;
}

export function resolveSubstrateSmAnisotropicAlphas(perceptualRoughness, anisotropy) {
  requireAnisotropy(anisotropy);
  if (typeof perceptualRoughness !== 'number' || !Number.isFinite(perceptualRoughness) ||
      perceptualRoughness < 0 || perceptualRoughness > 1) {
    throw new RangeError('SSM perceptual roughness must be within [0, 1]');
  }
  const roughness = Math.max(SSM_BSDF_MINIMUM_ROUGHNESS, perceptualRoughness);
  const alpha = roughness * roughness;
  const aspect = Math.sqrt(1 - SSM_ANISOTROPY_ASPECT_FACTOR * Math.abs(anisotropy));
  const broad = Math.min(1, alpha / aspect);
  const narrow = alpha * aspect;
  return {
    alphaTangent: anisotropy < 0 ? narrow : broad,
    alphaBitangent: anisotropy < 0 ? broad : narrow,
  };
}

export function evaluateSubstrateSmAnisotropicBsdf({
  surface,
  normal,
  viewDirection,
  lightDirection,
  frame,
} = {}, target = createSubstrateSmBsdfResult()) {
  const anisotropy = requireAnisotropy(surface?.anisotropy ?? 0);
  evaluateSubstrateSmBsdf({ surface, normal, viewDirection, lightDirection }, target);
  if (anisotropy === 0 || !isSubstrateSmTangentFrameValid(frame, normal)) return target;
  const normalView = Math.min(1, Math.max(0, tangentDotProduct(normal, viewDirection)));
  const normalLight = Math.min(1, Math.max(0, tangentDotProduct(normal, lightDirection)));
  if (normalView <= 0 || normalLight <= 0) return target;
  const halfSum = viewDirection.map((value, index) => value + lightDirection[index]);
  const halfLengthSquared = tangentDotProduct(halfSum, halfSum);
  if (halfLengthSquared <= SSM_BSDF_MINIMUM_HALF_LENGTH_SQUARED) return target;
  const halfDirection = halfSum.map(value => value / Math.sqrt(halfLengthSquared));
  const normalHalf = Math.min(1, Math.max(0, tangentDotProduct(normal, halfDirection)));
  const viewHalf = Math.min(1, Math.max(0, tangentDotProduct(viewDirection, halfDirection)));
  const { alphaTangent, alphaBitangent } = resolveSubstrateSmAnisotropicAlphas(surface.perceptualRoughness, anisotropy);
  const scaledHalfTangent = tangentDotProduct(frame.tangent, halfDirection) / alphaTangent;
  const scaledHalfBitangent = tangentDotProduct(frame.bitangent, halfDirection) / alphaBitangent;
  const distributionShape = scaledHalfTangent ** 2 + scaledHalfBitangent ** 2 + normalHalf ** 2;
  const distribution = 1 / (Math.PI * alphaTangent * alphaBitangent * distributionShape ** 2);
  const stretchedView = Math.hypot(
    alphaTangent * tangentDotProduct(frame.tangent, viewDirection),
    alphaBitangent * tangentDotProduct(frame.bitangent, viewDirection), normalView,
  );
  const stretchedLight = Math.hypot(
    alphaTangent * tangentDotProduct(frame.tangent, lightDirection),
    alphaBitangent * tangentDotProduct(frame.bitangent, lightDirection), normalLight,
  );
  const visibility = 0.5 / Math.max(normalLight * stretchedView + normalView * stretchedLight, SSM_BSDF_MINIMUM_DENOMINATOR);
  const grazingWeight = (1 - viewHalf) ** 5;
  for (let channel = 0; channel < 3; channel += 1) {
    const fresnel = surface.specularF0[channel] + (surface.specularF90 - surface.specularF0[channel]) * grazingWeight;
    target.specular[channel] = fresnel * distribution * visibility;
    target.total[channel] = target.diffuse[channel] + target.specular[channel];
  }
  return target;
}
