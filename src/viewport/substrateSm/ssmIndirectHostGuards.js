import { SSM_THREE_REVISION } from '../../lighting/substrateSm/ssmContract.js';
import {
  validateSubstrateSmRecipePayload,
  readSubstrateSmRecipePayload,
  SSM_RECIPE_FLOAT_COUNT,
} from '../../lighting/substrateSm/ssmRecipeLayout.js';
import { buildSubstrateSmRecipeUniformDeclarations } from '../../lighting/substrateSm/ssmRecipeLayoutGlsl.js';
import { isSubstrateSmShaderResponseOwned } from './ssmShaderOwnership.js';
import { failSubstrateSmIndirectCandidate } from './ssmIndirectShaderSource.js';

export function inspectSubstrateSmIndirectHost({
  shader,
  threeRevision,
  materialPath,
  environmentKind,
  family,
  vectorCount,
}) {
  if (threeRevision !== SSM_THREE_REVISION)
    failSubstrateSmIndirectCandidate('SSM_INDIRECT_REVISION_UNSUPPORTED');
  if (!isSubstrateSmShaderResponseOwned(shader))
    failSubstrateSmIndirectCandidate('SSM_INDIRECT_SHADER_OWNERSHIP_REQUIRED');
  if (!['standard', 'phong', 'poolPhong'].includes(materialPath))
    failSubstrateSmIndirectCandidate('SSM_INDIRECT_HOST_PATH_UNSUPPORTED');
  if (family !== 'base')
    failSubstrateSmIndirectCandidate('SSM_INDIRECT_EXTENSION_DELEGATED');
  if (!['none', 'host-cube-uv', 'host-stack', 'cube'].includes(environmentKind))
    failSubstrateSmIndirectCandidate('SSM_INDIRECT_ENVIRONMENT_KIND_REQUIRED');
  if (materialPath !== 'standard' && environmentKind !== 'none')
    failSubstrateSmIndirectCandidate(
      'SSM_INDIRECT_PHONG_ENVIRONMENT_DELEGATED',
    );
  if (materialPath === 'standard' && environmentKind === 'cube')
    failSubstrateSmIndirectCandidate(
      'SSM_INDIRECT_PREFILTERED_ENVIRONMENT_REQUIRED',
    );
  if (!Number.isInteger(vectorCount) || vectorCount < 7 || vectorCount > 8)
    failSubstrateSmIndirectCandidate('SSM_INDIRECT_RECIPE_PREFIX_REQUIRED');
  let surface;
  try {
    const gpuValues = shader.uniforms?.uSsmRecipe?.value;
    if (
      !(gpuValues instanceof Float32Array) ||
      gpuValues.length !== vectorCount * 4
    ) {
      throw new TypeError(
        'SSM recipe GPU storage must match its declared vec4 prefix',
      );
    }
    const payload =
      gpuValues.length === SSM_RECIPE_FLOAT_COUNT
        ? gpuValues
        : new Float32Array(SSM_RECIPE_FLOAT_COUNT);
    if (payload !== gpuValues) payload.set(gpuValues);
    validateSubstrateSmRecipePayload(payload);
    surface = readSubstrateSmRecipePayload(payload);
  } catch (error) {
    failSubstrateSmIndirectCandidate(
      'SSM_INDIRECT_RECIPE_HOLDER_REQUIRED',
      error.message,
    );
  }
  for (const name of ['diffuseReflectance', 'specularF0']) {
    if (surface[name].some((value) => value < 0 || value > 1))
      failSubstrateSmIndirectCandidate(
        'SSM_INDIRECT_REFLECTANCE_INVALID',
        name,
      );
  }
  for (const name of [
    'specularF90',
    'perceptualRoughness',
    'reflectionRoughness',
  ]) {
    if (surface[name] < 0 || surface[name] > 1)
      failSubstrateSmIndirectCandidate('SSM_INDIRECT_SURFACE_INVALID', name);
  }
  const standard = materialPath === 'standard';
  const expectedFamily = standard ? '#define STANDARD' : '#define PHONG';
  if (!shader.fragmentShader.includes(expectedFamily))
    failSubstrateSmIndirectCandidate('SSM_INDIRECT_SHADER_FAMILY_MISMATCH');
  if (
    environmentKind === 'host-stack' &&
    !shader.fragmentShader.includes('rswStkRadiance')
  )
    failSubstrateSmIndirectCandidate('SSM_INDIRECT_HOST_STACK_REQUIRED');
  return { standard, surface };
}

export function getSubstrateSmIndirectRecipeDeclaration(source, vectorCount) {
  const declarations = [
    ...source.matchAll(/uniform\s+vec4\s+uSsmRecipe\s*\[\s*(\d+)\s*\]\s*;/g),
  ];
  if (
    declarations.length > 1 ||
    (declarations.length === 1 && Number(declarations[0][1]) !== vectorCount)
  ) {
    failSubstrateSmIndirectCandidate(
      'SSM_INDIRECT_RECIPE_DECLARATION_MISMATCH',
    );
  }
  if (
    declarations.length === 0 &&
    /uniform\s+\w+\s+uSsmRecipe\b/.test(source)
  ) {
    failSubstrateSmIndirectCandidate(
      'SSM_INDIRECT_RECIPE_DECLARATION_MISMATCH',
    );
  }
  return declarations.length === 1
    ? ''
    : buildSubstrateSmRecipeUniformDeclarations(vectorCount);
}
