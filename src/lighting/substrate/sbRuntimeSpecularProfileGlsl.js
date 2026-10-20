export const SB_RUNTIME_SPECULAR_PROFILE_LIGHTING = `
#ifdef SB_SPECULAR_PROFILE_AVAILABLE
#define SB_RUNTIME_SPECULAR_PROFILE_DIRECT 1

void sbRuntimeProfiledDirect(const in IncidentLight directLight, const in vec3 geometryPosition,
 const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal,
 const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
 if (uSbSpecularProfileIndex == 0) {
  RE_Direct(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
  return;
 }
 ReflectedLight lightContribution = ReflectedLight(vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0));
 RE_Direct(directLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, lightContribution);
 float cosineView = clamp(dot(geometryNormal, geometryViewDir), 0.0, 1.0);
 float cosineLight = clamp(dot(geometryNormal, directLight.direction), 0.0, 1.0);
 float profileGain = sbSampleSpecularProfileGain(cosineView, cosineLight, uSbSpecularProfileIndex);
 reflectedLight.directSpecular += lightContribution.directSpecular * profileGain;
 reflectedLight.directDiffuse += lightContribution.directDiffuse;
}
#undef RE_Direct
#define RE_Direct sbRuntimeProfiledDirect

#if NUM_RECT_AREA_LIGHTS > 0 && defined(RE_Direct_RectArea)
void sbRuntimeProfiledAreaDirect(const in RectAreaLight areaLight, const in vec3 geometryPosition,
 const in vec3 geometryNormal, const in vec3 geometryViewDir, const in vec3 geometryClearcoatNormal,
 const in PhysicalMaterial material, inout ReflectedLight reflectedLight) {
 if (uSbSpecularProfileIndex == 0) {
  RE_Direct_RectArea(areaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, reflectedLight);
  return;
 }
 ReflectedLight lightContribution = ReflectedLight(vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0));
 RE_Direct_RectArea(areaLight, geometryPosition, geometryNormal, geometryViewDir, geometryClearcoatNormal, material, lightContribution);
 vec3 lightOffset = areaLight.position - geometryPosition;
 vec3 centerDirection = lightOffset * inversesqrt(max(dot(lightOffset, lightOffset), 0.00000001));
 float cosineView = clamp(dot(geometryNormal, geometryViewDir), 0.0, 1.0);
 float cosineLight = clamp(dot(geometryNormal, centerDirection), 0.0, 1.0);
 float profileGain = sbSampleSpecularProfileGain(cosineView, cosineLight, uSbSpecularProfileIndex);
 reflectedLight.directSpecular += lightContribution.directSpecular * profileGain;
 reflectedLight.directDiffuse += lightContribution.directDiffuse;
}
#undef RE_Direct_RectArea
#define RE_Direct_RectArea sbRuntimeProfiledAreaDirect
#endif
#endif
`;
