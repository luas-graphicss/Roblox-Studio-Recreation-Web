import { SB_ANISOTROPY_ASPECT_FACTOR } from "./sbAnisotropyCore.js";
import { SB_RUNTIME_SPECULAR_PROFILE_LIGHTING } from "./sbRuntimeSpecularProfileGlsl.js";

function anisotropicSpecularGlsl() {
  return `
vec3 sbRuntimeAnisotropicSpecular(const in vec3 lightDirection, const in vec3 viewDirection,
 const in vec3 surfaceNormal, const in PhysicalMaterial material) {
 vec3 tangent;
 vec3 bitangent;
 float strength = sbAnisotropyStrength();
 if (strength <= 0.0 || !sbSurfaceTangentFrame(surfaceNormal, tangent, bitangent)) {
  return BRDF_GGX(lightDirection, viewDirection, surfaceNormal, material);
 }
 sbRotateTangentFrame(surfaceNormal, sbAnisotropyRotation(), tangent, bitangent);
 vec3 halfVector = lightDirection + viewDirection;
 if (dot(halfVector, halfVector) < 1e-10) return vec3(0.0);
 halfVector = normalize(halfVector);
 float cosineLight = saturate(dot(surfaceNormal, lightDirection));
 float cosineView = saturate(dot(surfaceNormal, viewDirection));
 float cosineHalf = saturate(dot(surfaceNormal, halfVector));
 float alpha = material.roughness * material.roughness;
 float aspect = sqrt(max(1.0 - ${SB_ANISOTROPY_ASPECT_FACTOR.toFixed(8)} * strength, 0.0001));
 float alphaTangent = clamp(alpha / aspect, 0.0001, 1.0);
 float alphaBitangent = clamp(alpha * aspect, 0.0001, 1.0);
 vec3 scaledHalf = vec3(dot(tangent, halfVector) / alphaTangent,
  dot(bitangent, halfVector) / alphaBitangent, cosineHalf);
 float shape = dot(scaledHalf, scaledHalf);
 float distribution = RECIPROCAL_PI / max(alphaTangent * alphaBitangent * shape * shape, 1e-12);
 float maskingView = cosineLight * length(vec3(alphaTangent * dot(tangent, viewDirection),
  alphaBitangent * dot(bitangent, viewDirection), cosineView));
 float maskingLight = cosineView * length(vec3(alphaTangent * dot(tangent, lightDirection),
  alphaBitangent * dot(bitangent, lightDirection), cosineLight));
 float visibility = 0.5 / max(maskingView + maskingLight, 1e-12);
 return F_Schlick(material.specularColor, material.specularF90,
  saturate(dot(viewDirection, halfVector))) * distribution * visibility;
}
`;
}

function hairDirectGlsl() {
  return `
 if (sbRuntimeHairActive > 0.5) {
  vec3 hairBaseSpecular = BRDF_GGX(directLight.direction, geometryViewDir, geometryNormal, material);
  reflectedLight.directSpecular -= cosineLight * directLight.color * hairBaseSpecular;
  float hairWrap = saturate(dot(geometryNormal, directLight.direction) * 0.5 + 0.5);
  reflectedLight.directDiffuse += directLight.color * BRDF_Lambert(material.diffuseColor) * (hairWrap - cosineLight) * (1.0 - sbRuntimeHairScatter);
  PhysicalMaterial hairMaterial = material;
  hairMaterial.roughness = sbRuntimeHairPrimaryWidth;
  float hairCosinePrimary = saturate(dot(sbRuntimeHairPrimaryNormal, directLight.direction));
  vec3 hairLobeR = BRDF_GGX(directLight.direction, geometryViewDir, sbRuntimeHairPrimaryNormal, hairMaterial) * hairCosinePrimary;
  hairMaterial.roughness = sbRuntimeHairInnerWidth;
  hairMaterial.specularColor = vec3(1.0);
  hairMaterial.specularF90 = 1.0;
  float hairCosineInner = saturate(dot(sbRuntimeHairInnerNormal, directLight.direction));
  vec3 hairLobeTRT = BRDF_GGX(directLight.direction, geometryViewDir, sbRuntimeHairInnerNormal, hairMaterial) * hairCosineInner * sbRuntimeHairTRT;
  float hairForward = saturate(dot(-directLight.direction, geometryViewDir));
  float hairAcross = 1.0 - abs(dot(sbRuntimeHairFiber, directLight.direction));
  vec3 hairLobeTT = sbRuntimeHairTT * (pow(hairForward, 12.0) * 0.75 + 0.08) * hairAcross * sbRuntimeHairScatter;
  reflectedLight.directSpecular += directLight.color * (hairLobeR + hairLobeTRT + hairLobeTT) * hairWrap;
 }
`;
}

export function buildRuntimeDirectLightingGlsl({
  slabDiffuse,
  anisotropy,
  secondLobe,
  specularEnergy,
  hair = false,
}) {
  if (!slabDiffuse && !anisotropy && !secondLobe && !hair) return SB_RUNTIME_SPECULAR_PROFILE_LIGHTING;
  const specularFunction = anisotropy
    ? "sbRuntimeAnisotropicSpecular"
    : "BRDF_GGX";
  return `${anisotropy ? anisotropicSpecularGlsl() : ""}
void sbRuntimeDirect(const in IncidentLight directLight, const in vec3 geometryPosition,
 const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal,
 const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
 RE_Direct_Physical(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
 float cosineLight = saturate(dot(geometryNormal, directLight.direction));
 ${hair ? hairDirectGlsl() : ""}
 ${
   anisotropy || secondLobe
     ? `
 vec3 baseSpecular = BRDF_GGX(directLight.direction, geometryViewDir, geometryNormal, material);
 vec3 surfaceSpecular = ${specularFunction}(directLight.direction, geometryViewDir, geometryNormal, material);
 ${
   secondLobe
     ? `
 float secondWeight = sbSecondLobeWeight();
 if (secondWeight > 0.0) {
  PhysicalMaterial secondMaterial = material;
  secondMaterial.roughness = clamp(sbSecondLobeRoughness() * sbRuntimeRoughnessModulation + sbRuntimeGeometryRoughness, 0.0525, 1.0);
  vec3 secondSpecular = ${specularFunction}(directLight.direction, geometryViewDir, geometryNormal, secondMaterial);
  ${
    specularEnergy
      ? `
  float cosineView = saturate(dot(geometryNormal, geometryViewDir));
  vec3 averageFresnel = sbAverageFresnel(material.specularColor, material.specularF90);
  vec3 baseEnergy = sbMultiScatterEnergyScale(sbWhiteFurnaceDirectionalAlbedo(cosineView, material.roughness), averageFresnel);
  vec3 secondEnergy = sbMultiScatterEnergyScale(sbWhiteFurnaceDirectionalAlbedo(cosineView, secondMaterial.roughness), averageFresnel);
  secondSpecular *= secondEnergy / max(baseEnergy, vec3(0.00001));
  `
      : ""
  }
  surfaceSpecular = mix(surfaceSpecular, secondSpecular, secondWeight);
 }
 `
     : ""
 }
 reflectedLight.directSpecular += cosineLight * directLight.color * (surfaceSpecular - baseSpecular);
 `
     : ""
 }
 ${
   slabDiffuse
     ? `
 float cosineView = saturate(dot(geometryNormal, geometryViewDir));
 vec3 fresnel = F_Schlick(material.specularColor, material.specularF90, cosineView);
 vec3 corrected = sbSlabDiffuseCoupledBsdf(material.diffuseColor, material.roughness, cosineLight, fresnel);
 reflectedLight.directDiffuse += cosineLight * directLight.color * (corrected - BRDF_Lambert(material.diffuseColor));
 `
     : ""
 }
}
#undef RE_Direct
#define RE_Direct sbRuntimeDirect
${SB_RUNTIME_SPECULAR_PROFILE_LIGHTING}
`;
}
