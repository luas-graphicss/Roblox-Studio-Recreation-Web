import { SSM_BSDF_GLSL } from './ssmBsdfGlsl.js';
import { SSM_BSDF_MINIMUM_ROUGHNESS } from './ssmBsdfNumerics.js';
import { SSM_LIGHTING_SURFACE_GLSL } from './ssmLightingSurfaceGlsl.js';

export const SSM_DIRECT_LIGHTING_REVISION = 'ssm-direct-lighting-v1';

const RESOLVED_PHYSICAL_MATERIAL_GLSL = `
  PhysicalMaterial ssmAreaMaterial = material;
  ssmAreaMaterial.diffuseColor = ssmResolvedSurface.diffuseReflectance;
  ssmAreaMaterial.specularColor = ssmResolvedSurface.specularF0;
  ssmAreaMaterial.specularF90 = ssmResolvedSurface.specularF90;
  ssmAreaMaterial.roughness = max(ssmResolvedSurface.perceptualRoughness, ${SSM_BSDF_MINIMUM_ROUGHNESS});
`;

function buildHostAreaSpecularGlsl() {
  return `
  if (llAreaLightEnabled > 0.5) {
    float normalView = clamp(dot(geometryNormal, geometryViewDir), 0.0, 1.0);
    vec3 viewTransmission = vec3(1.0) - ssmSchlickFresnel(
      ssmResolvedSurface.specularF0, ssmResolvedSurface.specularF90, normalView);
    vec3 lightTransmission = vec3(1.0) - ssmSchlickFresnel(
      ssmResolvedSurface.specularF0, ssmResolvedSurface.specularF90, normalLight);
    reflectedLight.directDiffuse += visibleIrradiance * ssmResolvedSurface.diffuseReflectance
      * viewTransmission * lightTransmission * RECIPROCAL_PI;
    ${RESOLVED_PHYSICAL_MATERIAL_GLSL}
    reflectedLight.directSpecular += llAreaSpecularDirect(
      directLight, visibleIrradiance, geometryPosition, geometryNormal, geometryViewDir, ssmAreaMaterial);
    return;
  }
`;
}

function buildHostRectAreaGlsl() {
  return `
#if NUM_RECT_AREA_LIGHTS > 0
void ssmDirectRectArea(
  const in RectAreaLight rectAreaLight,
  const in vec3 geometryPosition,
  const in vec3 geometryNormal,
  const in vec3 geometryViewDir,
  const in vec3 geometryClearcoatNormal,
  const in PhysicalMaterial material,
  inout ReflectedLight reflectedLight
) {
  ${RESOLVED_PHYSICAL_MATERIAL_GLSL}
  RE_Direct_RectArea_Physical(rectAreaLight, geometryPosition, geometryNormal,
    geometryViewDir, geometryClearcoatNormal, ssmAreaMaterial, reflectedLight);
}
#undef RE_Direct_RectArea
#define RE_Direct_RectArea ssmDirectRectArea
#endif
`;
}

export function buildSubstrateSmDirectLightingGlsl({ materialPath, hostAreaSpecular = false } = {}) {
  if (!['standard', 'phong', 'poolPhong'].includes(materialPath)) {
    throw new RangeError('Direct lighting requires the Standard or Phong host');
  }
  const standard = materialPath === 'standard';
  if (hostAreaSpecular && !standard) throw new RangeError('The host area specular path requires Standard');
  const materialType = standard ? 'PhysicalMaterial' : 'BlinnPhongMaterial';
  return `
#define SSM_DIRECT_LIGHTING_V1
${SSM_LIGHTING_SURFACE_GLSL}
${SSM_BSDF_GLSL}
void ssmDirectLighting(
  const in IncidentLight directLight,
  const in vec3 geometryPosition,
  const in vec3 geometryNormal,
  const in vec3 geometryViewDir,
  const in vec3 geometryClearcoatNormal,
  const in ${materialType} material,
  inout ReflectedLight reflectedLight
) {
  float normalLight = clamp(dot(geometryNormal, directLight.direction), 0.0, 1.0);
  vec3 visibleIrradiance = directLight.color * normalLight;
  ${hostAreaSpecular ? buildHostAreaSpecularGlsl() : ''}
  SsmBsdfResult response = ssmEvaluateBaseBsdf(
    ssmResolvedSurface.diffuseReflectance,
    ssmResolvedSurface.specularF0,
    ssmResolvedSurface.specularF90,
    ssmResolvedSurface.perceptualRoughness,
    geometryNormal,
    geometryViewDir,
    directLight.direction
  );
  reflectedLight.directDiffuse += visibleIrradiance * response.diffuse;
  reflectedLight.directSpecular += visibleIrradiance * response.specular;
}
#undef RE_Direct
#define RE_Direct ssmDirectLighting
${standard ? buildHostRectAreaGlsl() : ''}
`;
}
