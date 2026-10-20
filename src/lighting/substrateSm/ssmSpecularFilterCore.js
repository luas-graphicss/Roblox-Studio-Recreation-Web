import { SSM_BSDF_MINIMUM_ROUGHNESS } from './ssmBsdfNumerics.js';
import {
  SPEC_AA_STR_DEFAULT,
  SPEC_AA_KERNEL_DEFAULT,
} from '../specularAaCore.js';

function requireRange(value, name, maximum) {
  if (!Number.isFinite(value) || value < 0 || value > maximum) {
    throw new RangeError(
      `SSM filter ${name} must be finite and within [0, ${maximum}]`,
    );
  }
}

export function filterSubstrateSmPerceptualRoughness({
  perceptualRoughness,
  geometryRoughness = 0,
  normalVariance = 0,
  enabled = false,
  strength = SPEC_AA_STR_DEFAULT,
  kernel = SPEC_AA_KERNEL_DEFAULT,
}) {
  requireRange(perceptualRoughness, 'perceptualRoughness', 1);
  requireRange(geometryRoughness, 'geometryRoughness', 2);
  requireRange(normalVariance, 'normalVariance', Infinity);
  requireRange(strength, 'strength', 4);
  requireRange(kernel, 'kernel', 1);
  if (typeof enabled !== 'boolean')
    throw new TypeError('SSM filter enabled must be a boolean');
  const roughness = Math.min(
    Math.max(perceptualRoughness, SSM_BSDF_MINIMUM_ROUGHNESS) +
      geometryRoughness,
    1,
  );
  if (!enabled || strength === 0 || kernel === 0 || normalVariance === 0)
    return roughness;
  const addedVariance = Math.min(2 * strength * normalVariance, kernel);
  return Math.min(Math.sqrt(Math.sqrt(roughness ** 4 + addedVariance)), 1);
}
