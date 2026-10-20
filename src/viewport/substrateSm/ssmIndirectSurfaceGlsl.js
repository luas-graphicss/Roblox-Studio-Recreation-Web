import { getSubstrateSmRecipeFieldExpression } from '../../lighting/substrateSm/ssmRecipeLayoutGlsl.js';

const SURFACE_FIELDS = Object.freeze([
  'diffuseReflectance',
  'specularF0',
  'specularF90',
  'perceptualRoughness',
  'reflectionRoughness',
]);

export function getSubstrateSmIndirectDefaultFields(vectorCount) {
  return Object.fromEntries(
    SURFACE_FIELDS.map((field) => [
      field,
      getSubstrateSmRecipeFieldExpression(field, vectorCount),
    ]),
  );
}

export function buildSubstrateSmIndirectSurfaceGlsl({
  fields,
  standard,
  hostSpecularAa,
}) {
  const geometry = standard
    ? 'geometryRoughness'
    : 'ssmIndirectGeometryRoughness';
  const geometryDeclaration = standard
    ? ''
    : `
vec3 ssmIndirectGeometryGradient = max(abs(dFdx(nonPerturbedNormal)), abs(dFdy(nonPerturbedNormal)));
float ssmIndirectGeometryRoughness = max(max(ssmIndirectGeometryGradient.x, ssmIndirectGeometryGradient.y), ssmIndirectGeometryGradient.z);
`;
  const varianceDeclaration = hostSpecularAa
    ? `
vec3 ssmIndirectNormalDx = dFdx(normal);
vec3 ssmIndirectNormalDy = dFdy(normal);
float ssmIndirectNormalVariance = dot(ssmIndirectNormalDx, ssmIndirectNormalDx) + dot(ssmIndirectNormalDy, ssmIndirectNormalDy);
`
    : 'float ssmIndirectNormalVariance = 0.0;';
  const controls = hostSpecularAa
    ? 'uRswSpecAaStr, uRswSpecAaKernel, uRswSpecAaOn'
    : '0.0, 0.0, 0.0';
  return `${geometryDeclaration}
${varianceDeclaration}
float ssmIndirectPerceptualRoughness = ssmFilterPerceptualRoughness(${fields.perceptualRoughness}, ${geometry}, ssmIndirectNormalVariance, ${controls});
float ssmIndirectReflectionRoughness = ssmFilterPerceptualRoughness(${fields.reflectionRoughness}, ${geometry}, ssmIndirectNormalVariance, ${controls});
${standard ? 'material.roughness = ssmIndirectPerceptualRoughness;' : ''}
SsmIndirectSurface ssmIndirectSurface;
ssmIndirectSurface.diffuseReflectance = ${fields.diffuseReflectance};
ssmIndirectSurface.specularF0 = ${fields.specularF0};
ssmIndirectSurface.specularF90 = ${fields.specularF90};
ssmIndirectSurface.reflectionRoughness = ssmIndirectReflectionRoughness;
`;
}

export function buildSubstrateSmIndirectResponsePrelude() {
  return 'SsmIndirectResponse ssmIndirectResponse = ssmEvaluateIndirectResponse(ssmIndirectSurface, clamp(dot(geometryNormal, geometryViewDir), 0.0, 1.0));';
}

export const SSM_INDIRECT_DIFFUSE_ACCUMULATION =
  'reflectedLight.indirectDiffuse += irradiance * ssmIndirectResponse.diffuseReflectance * 0.3183098861837907;';

export const SSM_INDIRECT_SPECULAR_ACCUMULATION = `
reflectedLight.indirectSpecular += radiance * ssmIndirectResponse.singleScattering + iblIrradiance * ssmIndirectResponse.multipleScattering * 0.3183098861837907;
reflectedLight.indirectDiffuse += iblIrradiance * ssmIndirectResponse.diffuseReflectance * 0.3183098861837907;
`;
