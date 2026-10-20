import { SSM_BSDF_GLSL } from '../../lighting/substrateSm/ssmBsdfGlsl.js';
import { SSM_BSDF_MINIMUM_ROUGHNESS } from '../../lighting/substrateSm/ssmBsdfNumerics.js';
import { buildSubstrateSmRecipeUniformDeclarations, getSubstrateSmRecipeFieldExpression } from '../../lighting/substrateSm/ssmRecipeLayoutGlsl.js';
import { SSM_BASE_UNIFORM_VECTOR_COUNT, SSM_SHADER_CONTRACT } from './ssmShaderContract.js';

const field = name => getSubstrateSmRecipeFieldExpression(name, SSM_BASE_UNIFORM_VECTOR_COUNT);

export function buildSubstrateSmSurfaceDeclarations(hostBackend) {
  const materialType = hostBackend === 'standard' ? 'PhysicalMaterial' : 'BlinnPhongMaterial';
  return `
${buildSubstrateSmRecipeUniformDeclarations(SSM_BASE_UNIFORM_VECTOR_COUNT)}
struct SsmSurface {
  vec3 diffuseReflectance;
  vec3 specularF0;
  float specularF90;
  float perceptualRoughness;
  float reflectionRoughness;
};
SsmSurface ssmSurface;
${SSM_BSDF_GLSL}
void RE_Direct_SsmBase(
  const in IncidentLight directLight,
  const in vec3 geometryPosition,
  const in vec3 geometryNormal,
  const in vec3 geometryViewDir,
  const in vec3 geometryClearcoatNormal,
  const in ${materialType} material,
  inout ReflectedLight reflectedLight
) {
  SsmBsdfResult ssmResponse = ssmEvaluateBaseBsdf(
    ssmSurface.diffuseReflectance, ssmSurface.specularF0, ssmSurface.specularF90,
    ssmSurface.perceptualRoughness, geometryNormal, geometryViewDir, directLight.direction
  );
  vec3 ssmIrradiance = max(dot(geometryNormal, directLight.direction), 0.0) * directLight.color;
  reflectedLight.directDiffuse += ssmIrradiance * ssmResponse.diffuse;
  reflectedLight.directSpecular += ssmIrradiance * ssmResponse.specular;
}
#undef RE_Direct
#define RE_Direct RE_Direct_SsmBase
${SSM_SHADER_CONTRACT.responseReady}
`;
}

export function buildSubstrateSmSurfaceResolution({ emissionMode, tintMode }) {
  const diffuseMultiplier = tintMode === 'host-diffuse' ? ' * diffuseColor.rgb' : '';
  return `
ssmSurface.diffuseReflectance = ${field('diffuseReflectance')}${diffuseMultiplier};
ssmSurface.specularF0 = ${field('specularF0')};
ssmSurface.specularF90 = ${field('specularF90')};
ssmSurface.perceptualRoughness = max(${field('perceptualRoughness')}, ${SSM_BSDF_MINIMUM_ROUGHNESS});
ssmSurface.reflectionRoughness = max(${field('reflectionRoughness')}, ${SSM_BSDF_MINIMUM_ROUGHNESS});
${emissionMode === 'recipe' ? `totalEmissiveRadiance = ${field('emissiveRadiance')};\n` : ''}${SSM_SHADER_CONTRACT.surfaceReady}
`;
}

export function buildSubstrateSmHostMaterialResolution(hostBackend) {
  return `
material.diffuseColor = ssmSurface.diffuseReflectance;
material.specularColor = ssmSurface.specularF0;
${hostBackend === 'standard' ? `material.specularF90 = ssmSurface.specularF90;
material.roughness = ssmSurface.reflectionRoughness;
roughnessFactor = ssmSurface.reflectionRoughness;` : 'material.specularStrength = 1.0;'}
${SSM_SHADER_CONTRACT.hostMaterialReady}
`;
}
