import { normalizeSubstrateSmMapAsset } from '../../lighting/substrateSm/ssmMapValidation.js';
import { serializeSubstrateSmKeyDescriptor } from '../../lighting/substrateSm/ssmKeySerialization.js';
import { isSubstrateSmMaskPlan } from '../../lighting/substrateSm/ssmMaskPlanCore.js';
import { describeSubstrateSmHostTexture } from './ssmHostTextureDescriptor.js';

function describe(THREE, texture, expected) {
  return normalizeSubstrateSmMapAsset(describeSubstrateSmHostTexture({ THREE, texture,
    id: expected.id, revision: expected.revision, status: 'ready', dynamic: 'static' }), expected.role ?? 'mask');
}

function requireMatchingTexture(THREE, texture, expected) {
  const actual = describe(THREE, texture, expected);
  for (const field of ['width', 'height', 'format', 'colorSpace', 'mipMode', 'mipLevels', 'uploadVersion']) {
    if (actual[field] !== expected[field]) throw new Error(`Spatial texture ${field} changed after planning`);
  }
  if (serializeSubstrateSmKeyDescriptor(actual.sampling) !== serializeSubstrateSmKeyDescriptor(expected.sampling)) {
    throw new Error('Spatial texture sampling changed after planning');
  }
  return texture;
}

export function validateSubstrateSmSpatialTextures({ THREE, maskPlan, material, maskTexture, ormTexture, bakedLease }) {
  if (!isSubstrateSmMaskPlan(maskPlan)) throw new TypeError('An admitted mask plan is required');
  if (!material?.isMeshStandardMaterial || material.isMeshPhysicalMaterial || material.transparent
    || material.opacity !== 1 || material.alphaTest > 0) {
    throw new Error('The current F18 texture seam is opaque Standard only; other hosts require explicit adaptation');
  }
  for (const binding of maskPlan.mapPlan.bindings) requireMatchingTexture(THREE, material[binding.sampler], binding);
  if (maskPlan.mode === 'optional') {
    const reference = maskPlan.mapPlan.bindings.find(binding => binding.role === maskPlan.uvRole);
    requireMatchingTexture(THREE, material[reference.sampler], reference);
    return requireMatchingTexture(THREE, maskTexture, maskPlan.source);
  }
  const orm = maskPlan.mapPlan.orm;
  if (maskPlan.mode === 'packed') {
    if (ormTexture !== material.roughnessMap || ormTexture !== material.metalnessMap
      || (orm.occlusion && ormTexture !== material.aoMap)) throw new Error('Packed mask reuse requires the actual shared ORM resource');
    return requireMatchingTexture(THREE, ormTexture, maskPlan.source);
  }
  if (!bakedLease || typeof bakedLease.isValid !== 'function' || !bakedLease.isValid()
    || bakedLease.contextGeneration !== maskPlan.contextGeneration || bakedLease.resource !== ormTexture) {
    throw new Error('Static mask output requires a current F08 cache lease');
  }
  const signature = bakedLease.key?.signature;
  if (typeof signature !== 'string' || !signature.startsWith('ssm/recipe/v1:')) throw new Error('Baked mask provenance requires a recipe key');
  const descriptor = JSON.parse(signature.slice('ssm/recipe/v1:'.length));
  if (serializeSubstrateSmKeyDescriptor(descriptor.mapPlan) !== serializeSubstrateSmKeyDescriptor(maskPlan.keyDescriptor)) {
    throw new Error('The baked texture lease belongs to a different mask plan');
  }
  const actual = describe(THREE, ormTexture, { id: 'derived-mask', revision: 1 });
  const output = maskPlan.bake.output;
  if (actual.width !== output.width || actual.height !== output.height || actual.format !== output.format
    || actual.colorSpace !== output.colorSpace || actual.mipLevels !== output.layout.levels.length
    || serializeSubstrateSmKeyDescriptor(actual.sampling) !== serializeSubstrateSmKeyDescriptor(output.sampling)) {
    throw new Error('The baked ORM-mask resource differs from its admitted output');
  }
  return ormTexture;
}
