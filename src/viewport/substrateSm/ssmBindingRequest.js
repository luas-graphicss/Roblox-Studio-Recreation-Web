import { resolveSubstrateSmBackend } from '../../lighting/substrateSm/ssmBackendPolicyCore.js';
import { createSubstrateSmCompiledRecipe, SSM_COMPILER_VERSION } from '../../lighting/substrateSm/ssmCompiledRecipeCore.js';
import { copySubstrateSmImmutableData } from '../../lighting/substrateSm/ssmImmutableData.js';
import { createSubstrateSmProgramKey, assertSubstrateSmKey } from '../../lighting/substrateSm/ssmRecipeKeys.js';
import { writeSubstrateSmRecipePayload, readSubstrateSmRecipePayload } from '../../lighting/substrateSm/ssmRecipeLayout.js';
import { serializeSubstrateSmKeyDescriptor } from '../../lighting/substrateSm/ssmKeySerialization.js';
import { SSM_BASE_UNIFORM_VECTOR_COUNT, SSM_SHADER_PATCH_GENERATION } from './ssmShaderContract.js';

export function inspectSubstrateSmBindingMaterial(material, materialPath) {
  const standard = material?.isMeshStandardMaterial === true && material.isMeshPhysicalMaterial !== true;
  const phong = material?.isMeshPhongMaterial === true;
  if (!(materialPath === 'standard' && standard) && !(['phong', 'poolPhong'].includes(materialPath) && phong)) {
    throw new Error('SSM_BINDING_MATERIAL_PATH_UNSUPPORTED');
  }
  if (material.transparent || material.alphaHash || material.opacity !== 1 || material.transmission > 0
    || material.wireframe || material.flatShading || material.userData?.__rswGlassRefr) {
    throw new Error('SSM_BINDING_MATERIAL_DOMAIN_DELEGATED');
  }
  if (!Number.isFinite(material.alphaTest) || material.alphaTest < 0 || material.alphaTest > 1) {
    throw new Error('SSM_BINDING_ALPHA_TEST_INVALID');
  }
  if (material.roughnessMap || material.metalnessMap || material.specularMap) {
    throw new Error('SSM_MAPPED_RESPONSE_REQUIRES_ADAPTER');
  }
  return standard ? 'standard' : 'phong';
}

export function prepareSubstrateSmBindingRequest({ THREE, material, materialPath, request, recoveryGeneration }) {
  if (!request || typeof request !== 'object' || Array.isArray(request)) throw new Error('SSM_BINDING_REQUEST_REQUIRED');
  const hostBackend = inspectSubstrateSmBindingMaterial(material, materialPath);
  const routing = copySubstrateSmImmutableData(request.routing);
  const decision = resolveSubstrateSmBackend({ ...routing, materialPath, threeRevision: String(THREE.REVISION),
    hostPathReady: routing?.hostPathReady === true, blendMode: material.alphaTest > 0 ? 'alphaTest' : 'opaque' });
  if (routing?.materialPath !== materialPath || routing?.blendMode !== (material.alphaTest > 0 ? 'alphaTest' : 'opaque')) {
    throw new Error('SSM_BINDING_HOST_ROUTE_MISMATCH');
  }
  if (request.stageOnly !== undefined && typeof request.stageOnly !== 'boolean') {
    throw new Error('SSM_BINDING_STAGE_FLAG_INVALID');
  }
  const stageOnly = request.stageOnly === true;
  const canStage = stageOnly && decision.eligible && decision.state === 'preparing';
  if (!decision.ready && !canStage) {
    return { ok: false, reason: decision.code, pending: decision.eligible, decision };
  }
  const effectiveQuality = decision.effectiveQuality ?? decision.proposedQuality;
  const candidate = routing.candidates[effectiveQuality];
  if (candidate.recipe.family !== 'base' || candidate.recipe.compilerVersion !== SSM_COMPILER_VERSION) {
    throw new Error('SSM_BINDING_BASE_RECIPE_REQUIRED');
  }
  const payload = writeSubstrateSmRecipePayload(candidate.recipe.parameters);
  const recipeValidation = createSubstrateSmCompiledRecipe({ family: 'base', parameters: readSubstrateSmRecipePayload(payload) }, candidate.recipe.profile);
  if (!recipeValidation.ok || candidate.recipe.parameters.opacity !== 1) throw new Error('SSM_BINDING_RECIPE_INVALID');
  if (candidate.usage.fragmentUniformVectors < SSM_BASE_UNIFORM_VECTOR_COUNT || candidate.usage.payloadBytes !== 128) {
    throw new Error('SSM_BINDING_LAYOUT_UNDERREPORTED');
  }
  assertSubstrateSmKey(request.recipeKey, 'recipe');
  if (request.recipeKey.signature.length > 65536) throw new Error('SSM_BINDING_RECIPE_KEY_LIMIT');
  const emissionMode = request.emissionMode ?? 'host';
  const tintMode = request.tintMode ?? 'host-diffuse';
  if (!['host', 'recipe'].includes(emissionMode) || !['host-diffuse', 'none'].includes(tintMode)) {
    throw new Error('SSM_BINDING_SURFACE_POLICY_INVALID');
  }
  if (typeof request.structuralVariant !== 'string' || !request.structuralVariant || request.structuralVariant.length > 1024) {
    throw new Error('SSM_BINDING_STRUCTURAL_VARIANT_REQUIRED');
  }
  const transforms = request.transforms ?? [];
  if (!Array.isArray(transforms) || transforms.length > 8) throw new Error('SSM_BINDING_TRANSFORM_LIMIT');
  const identifiers = transforms.map(extension => {
    if (typeof extension?.id !== 'string' || !extension.id || extension.id.length > 256
      || typeof extension.transform !== 'function') throw new Error('SSM_BINDING_TRANSFORM_CONTRACT');
    return extension.id;
  });
  if (new Set(identifiers).size !== identifiers.length) throw new Error('SSM_BINDING_TRANSFORM_DUPLICATE');
  const programKey = createSubstrateSmProgramKey({ family: 'base', hostBackend,
    structuralVariant: serializeSubstrateSmKeyDescriptor({ variant: request.structuralVariant, emissionMode, tintMode, transforms: identifiers,
      transaction: SSM_SHADER_PATCH_GENERATION, recoveryGeneration }),
    patchGeneration: request.patchGeneration ?? SSM_SHADER_PATCH_GENERATION, mapBindings: request.mapBindings ?? [] });
  if (programKey.signature.length > 8192) throw new Error('SSM_BINDING_PROGRAM_KEY_LIMIT');
  const failureKey = serializeSubstrateSmKeyDescriptor({ sourceRevision: routing.sourceRevision, contextGeneration: routing.contextGeneration,
    recipe: request.recipeKey.signature, program: programKey.signature, capabilities: routing.capabilities, hostUsage: routing.hostUsage, usage: candidate.usage });
  return { ok: true, hostBackend, routing, decision, stageOnly, effectiveQuality, payload, recipeKey: request.recipeKey, programKey, failureKey,
    emissionMode, tintMode, transforms: Object.freeze(transforms.map(extension => Object.freeze({ id: extension.id, transform: extension.transform }))),
    validateResources: request.validateResources };
}
