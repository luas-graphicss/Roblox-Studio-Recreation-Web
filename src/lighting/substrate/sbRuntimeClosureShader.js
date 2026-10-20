import { slabFieldEncodings, closureRecordStrideBytes } from './sbMaterialBufferCore.js';
import { buildRuntimeDirectLightingGlsl } from './sbRuntimeDirectLightingGlsl.js';
import { injectRuntimeMaterialModulation } from './sbRuntimeMaterialModulation.js';
import { sbSpecializedClosureDeclarations, sbSpecializedPreLightingGlsl, sbSpecializedPostLightingGlsl } from './sbSpecializedClosureGlsl.js';
import { SB_ROUGH_REFRACTION_RUNTIME_GLSL } from './sbRoughRefractionGlsl.js';
import { buildSlabMapRuntimeGlsl, SB_SLAB_MAP_GLSL, SB_SLAB_MAP_GLSL_STRUCT_NAME } from './sbSlabMapGlsl.js';
const fields = new Set(slabFieldEncodings().map(field => field.name));
const field = (name, fallback) => fields.has(name) ? `sbRuntimeSlab.${name}` : fallback;
export const RUNTIME_FEATURE_UNIFORMS = ['uSbAnisotropy', 'uSbSecondLobe', 'uSbThinFilm', 'uSbFuzz', 'uSbGlint', 'uSbSpecularProfileIndex', 'uSbThinTranslucency'];
export const RUNTIME_FEATURE_COMPONENT_COUNTS = Object.freeze([2, 2, 2, 4, 3, 1, 4]);
export const RUNTIME_THIN_TRANSLUCENCY_UNIFORM = 'uSbRuntimeThin';
export const RUNTIME_SCREEN_UNIFORMS = Object.freeze({
  dbuffer: 'uSbDBuffer', dbufferSize: 'uSbDBufferSize', dbufferOn: 'uSbDBufferOn', dbufferParams: 'uSbDBufferParams', dbufferNormal: 'uSbDBufferNormal',
  oitAccumulate: 'uSbOitAccumulate', reflectionTracking: 'uSbReflectionTrackingOn', lightFunctionMask: 'uSbDomainLightFunctionMask',
  sceneColor: 'uSbSceneColor', sceneDepth: 'uSbSceneDepth', sceneParams: 'uSbSceneParams', sceneSize: 'uSbSceneSize',
});
export const RUNTIME_SCENE_DEPTH_GLSL = `
float sbRuntimeSceneViewDepth(vec2 uv) {
 float sbSceneDepthSample = unpackRGBAToDepth(texture2D(${RUNTIME_SCREEN_UNIFORMS.sceneDepth}, uv));
 return ${RUNTIME_SCREEN_UNIFORMS.sceneParams}.z > 0.5
  ? -orthographicDepthToViewZ(sbSceneDepthSample, ${RUNTIME_SCREEN_UNIFORMS.sceneParams}.x, ${RUNTIME_SCREEN_UNIFORMS.sceneParams}.y)
  : -perspectiveDepthToViewZ(sbSceneDepthSample, ${RUNTIME_SCREEN_UNIFORMS.sceneParams}.x, ${RUNTIME_SCREEN_UNIFORMS.sceneParams}.y);
}`;
export const RUNTIME_HAIR_GLOBALS_GLSL = `
float sbRuntimeHairActive = 0.0;
vec3 sbRuntimeHairFiber = vec3(0.0);
vec3 sbRuntimeHairPrimaryNormal = vec3(0.0);
vec3 sbRuntimeHairInnerNormal = vec3(0.0);
float sbRuntimeHairPrimaryWidth = 0.3;
float sbRuntimeHairInnerWidth = 0.3;
vec3 sbRuntimeHairTT = vec3(0.0);
vec3 sbRuntimeHairTRT = vec3(0.0);
float sbRuntimeHairScatter = 0.0;`;
export const RUNTIME_OIT_WEIGHT_GLSL = `
float sbRuntimeOitWeight(float viewDepth, float coverage) {
 float normalizedDepth = abs(viewDepth) / 200.0;
 float falloff = 0.03 / (1e-5 + pow(normalizedDepth, 4.0));
 return clamp(coverage * falloff, 1e-2, 3e3);
}`;
function bindClosureFeatures(source, tier) {
  const expressions = [
    `vec2(${field('anisotropy', '0.0')}, ${field('anisotropyRotation', '0.0')})`,
    `vec2(${field('secondRoughness', '0.5')}, ${field('secondRoughnessWeight', '0.0')})`,
    `vec2(${field('thinFilmThicknessNanometers', '0.0')}, ${field('thinFilmIor', field('thinFilmIOR', '1.35'))})`,
    `vec4(${field('fuzzAmount', '0.0')}, ${field('fuzzRoughness', 'sbRuntimeSlab.roughness')}, dot(floor(clamp(${field('fuzzColor', 'vec3(1.0)')}, 0.0, 1.0) * 255.0 + 0.5), vec3(65536.0, 256.0, 1.0)), ${tier === 'forte' ? '1.0' : '0.0'})`,
    `vec3(${field('glintDensity', '0.0')}, ${field('glintRoughness', '0.2')}, 37.0)`,
    field('specularProfileIndex', '0.0'),
    `${RUNTIME_THIN_TRANSLUCENCY_UNIFORM}[sbRuntimeSlot]`,
  ];
  const assignments = [];
  RUNTIME_FEATURE_UNIFORMS.forEach((name, index) => {
    const declaration = new RegExp(`uniform\\s+(vec[234]|float|int)\\s+${name}\\s*;`);
    const match = source.match(declaration);
    if (!match) return;
    const type = match[1];
    source = source.replace(declaration, `uniform ${type} ${name}Input;\n${type} ${name};`);
    const expression = type === 'int' ? `int(${expressions[index]} + 0.5)` : expressions[index];
    assignments.push(`${name} = uSbRuntimeOverrides[${index}] > 0.5 ? ${name}Input : ${expression};`);
  });
  return { source, assignments: assignments.join('\n') };
}
export function injectRuntimeClosureShader(source, { tier = 'medio', limit = 2, layering = true, slabDiffuse = true, anisotropy = false, secondLobe = false, specularEnergy = false, roughRefraction = false, eye = false, subsurface = false, decalBuffer = true, orderedTranslucency = true, roughnessTracking = true, lightFunction = false, hair = true, water = false, slabMaps = [] } = {}) {
  const begin = '#include <lights_fragment_begin>';
  const end = '#include <aomap_fragment>';
  const opaque = '#include <opaque_fragment>';
  if (!source.includes(begin) || !source.includes(end) || !source.includes('#include <lights_physical_fragment>')) return { source, installed: false, reason: 'Physical lighting anchors missing' };
  const modulation = injectRuntimeMaterialModulation(source);
  if (!modulation.installed) return modulation;
  source = modulation.source;
  source = source.replace(/(#define SB_DEBUG_CLOSURE_BYTES) [0-9.]+/, `$1 ${closureRecordStrideBytes().toFixed(6)}`);
  const features = bindClosureFeatures(source, tier);
  source = features.source;
  const subsurfaceField = fields.has('subsurfaceMeanFreePath');
  const subsurfaceOn = subsurface && subsurfaceField;
  const slabMapRuntime = buildSlabMapRuntimeGlsl({ boundSlots: Array.isArray(slabMaps) ? slabMaps : [], availableFields: [...fields] });
  const slabMapDecoders = slabMapRuntime.samplers.length > 0 && !source.includes('struct ' + SB_SLAB_MAP_GLSL_STRUCT_NAME) ? SB_SLAB_MAP_GLSL.declarations + '\n' + SB_SLAB_MAP_GLSL.code : '';
  const globals = `
#define SB_REAL_CLOSURES 1
uniform vec3 uSbRuntimeWeights;
uniform vec4 uSbRuntimeLayers[3];
uniform vec3 uSbRuntimeCoverage;
uniform vec3 uSbRuntimeParents;
uniform float uSbRuntimeOverrides[${RUNTIME_FEATURE_UNIFORMS.length}];
uniform vec4 ${RUNTIME_THIN_TRANSLUCENCY_UNIFORM}[3];
${decalBuffer ? `uniform sampler2D ${RUNTIME_SCREEN_UNIFORMS.dbuffer};\nuniform sampler2D ${RUNTIME_SCREEN_UNIFORMS.dbufferNormal};\nuniform vec2 ${RUNTIME_SCREEN_UNIFORMS.dbufferSize};\nuniform float ${RUNTIME_SCREEN_UNIFORMS.dbufferOn};\nuniform vec4 ${RUNTIME_SCREEN_UNIFORMS.dbufferParams};` : ''}
${water ? `uniform sampler2D ${RUNTIME_SCREEN_UNIFORMS.sceneColor};\nuniform sampler2D ${RUNTIME_SCREEN_UNIFORMS.sceneDepth};\nuniform vec4 ${RUNTIME_SCREEN_UNIFORMS.sceneParams};\nuniform vec2 ${RUNTIME_SCREEN_UNIFORMS.sceneSize};\n${RUNTIME_SCENE_DEPTH_GLSL}` : ''}
${hair ? RUNTIME_HAIR_GLOBALS_GLSL : ''}
${orderedTranslucency ? `uniform float ${RUNTIME_SCREEN_UNIFORMS.oitAccumulate};\n${RUNTIME_OIT_WEIGHT_GLSL}` : ''}
${roughnessTracking ? `uniform float ${RUNTIME_SCREEN_UNIFORMS.reflectionTracking};` : ''}
${lightFunction ? `uniform vec4 ${RUNTIME_SCREEN_UNIFORMS.lightFunctionMask};
vec3 sbRuntimeLightFunctionMask() {
 mat3 sbLfToWorld = transpose(mat3(viewMatrix));
 vec3 sbLfAxisView = vec3(0.0, 0.0, 1.0);
 #if NUM_DIR_LIGHTS > 0
 sbLfAxisView = directionalLights[0].direction;
 #endif
 vec3 sbLfAxis = normalize(sbLfToWorld * sbLfAxisView);
 vec3 sbLfWorld = cameraPosition + sbLfToWorld * (-vViewPosition);
 vec3 sbLfLateral = sbLfWorld - sbLfAxis * dot(sbLfWorld, sbLfAxis);
 float sbLfValue = 0.5 + 0.5 * cos(length(sbLfLateral) * ${RUNTIME_SCREEN_UNIFORMS.lightFunctionMask}.a);
 return mix(vec3(1.0), ${RUNTIME_SCREEN_UNIFORMS.lightFunctionMask}.rgb, sbLfValue);
}` : ''}
float sbRuntimeRoughnessModulation;
${roughRefraction && layering ? SB_ROUGH_REFRACTION_RUNTIME_GLSL : ''}
${slabMapDecoders}
${slabMapRuntime.declarations}
${secondLobe ? 'float sbRuntimeGeometryRoughness;' : ''}
${sbSpecializedClosureDeclarations()}
`;
  const directLighting = buildRuntimeDirectLightingGlsl({ slabDiffuse, anisotropy, secondLobe, specularEnergy, hair });
  source = source.replace(/void\s+main\s*\(/, `${globals}\n${directLighting}\nvoid main(`);
  const open = `
PhysicalMaterial sbRuntimeBaseMaterial = material;
ReflectedLight sbRuntimeSum = ReflectedLight(vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0));
vec3 sbRuntimeEmission = vec3(0.0);
float sbRuntimeOpacity = 0.0;
float sbRuntimeReflectionRoughness = sbRuntimeBaseMaterial.roughness;
float sbRuntimeReflectionWeight = -1.0;
${subsurfaceOn ? 'vec3 sbRuntimeSubsurfaceMfp = vec3(0.0);' : ''}
${secondLobe ? 'sbRuntimeGeometryRoughness = geometryRoughness;' : ''}
vec3 sbRuntimeBaseNormal = normal;
${decalBuffer ? `vec4 sbRuntimeDecal = vec4(0.0);\nvec3 sbRuntimeDecalNormal = normal;\nif (${RUNTIME_SCREEN_UNIFORMS.dbufferOn} > 0.5) {\n vec2 sbRuntimeDecalUv = gl_FragCoord.xy / max(${RUNTIME_SCREEN_UNIFORMS.dbufferSize}, vec2(1.0));\n sbRuntimeDecal = texture2D(${RUNTIME_SCREEN_UNIFORMS.dbuffer}, sbRuntimeDecalUv);\n vec3 sbRuntimeDecalPacked = texture2D(${RUNTIME_SCREEN_UNIFORMS.dbufferNormal}, sbRuntimeDecalUv).xyz * 2.0 - 1.0;\n if (dot(sbRuntimeDecalPacked, sbRuntimeDecalPacked) > 1e-4) sbRuntimeDecalNormal = normalize(mix(normal, normalize(sbRuntimeDecalPacked), clamp(sbRuntimeDecal.a * ${RUNTIME_SCREEN_UNIFORMS.dbufferParams}.z, 0.0, 1.0)));\n}` : ''}
for (int sbRuntimeSlot = 0; sbRuntimeSlot < ${Math.max(1, Math.min(3, Math.floor(limit)))}; sbRuntimeSlot++) {
 if (sbRuntimeSlot >= uSbClosureCount) break;
 normal = ${decalBuffer ? 'sbRuntimeDecalNormal' : 'sbRuntimeBaseNormal'};
 float sbRuntimeKind = sbClosureKind(float(sbRuntimeSlot));
 SbSlabClosure sbRuntimeSlab = sbReadClosureAsSlab(float(sbRuntimeSlot), sbRuntimeKind);
${slabMapRuntime.apply}
 ${features.assignments}
 material = sbRuntimeBaseMaterial;
 material.diffuseColor = sbRuntimeSlab.albedo * sbRuntimeColorModulation;
 material.specularColor = sbRuntimeSlab.f0;
 material.specularF90 = ${field('f90', '1.0')};
 float sbRuntimeRoughness = sbRuntimeSlab.roughness * sbRuntimeRoughnessModulation;
 ${roughRefraction && layering ? `
 float sbRuntimeRoughStrength = 0.0;
 {
   vec3 sbRuntimeRoughViewDir = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
   float sbRuntimeRoughCosine = max(abs(dot(sbRuntimeBaseNormal, sbRuntimeRoughViewDir)), 0.05);
   int sbRuntimeRoughLayer = sbRuntimeSlot;
   for (int sbRuntimeRoughDepth = 0; sbRuntimeRoughDepth < 3; sbRuntimeRoughDepth++) {
     int sbRuntimeRoughParent = int(uSbRuntimeParents[sbRuntimeRoughLayer]);
     if (sbRuntimeRoughParent < 0) break;
     SbSlabClosure sbRuntimeCoat = sbReadSlabClosure(float(sbRuntimeRoughParent));
     float sbRuntimeCoatIor = sbRoughRefractionIorFromF0(sbRuntimeCoat.f0);
     float sbRuntimeLayerStrength = sbRoughRefractionStrength(sbRuntimeCoat.roughness, sbRuntimeCoatIor, uSbRuntimeCoverage[sbRuntimeRoughLayer], uSbRuntimeLayers[sbRuntimeRoughLayer].w, sbRuntimeRoughCosine);
     sbRuntimeRoughStrength = min(1.0, sqrt(sbRuntimeRoughStrength * sbRuntimeRoughStrength + sbRuntimeLayerStrength * sbRuntimeLayerStrength));
     sbRuntimeRoughLayer = sbRuntimeRoughParent;
   }
 }
 sbRuntimeRoughness = sbRoughRefractionBroaden(sbRuntimeRoughness, sbRuntimeRoughStrength);
 normal = sbRoughRefractionBlurNormal(normal, nonPerturbedNormal, sbRuntimeRoughStrength);
 ` : ''}
 ${decalBuffer ? `
 material.diffuseColor = mix(material.diffuseColor, sbRuntimeDecal.rgb, sbRuntimeDecal.a);
 sbRuntimeRoughness = mix(sbRuntimeRoughness, ${RUNTIME_SCREEN_UNIFORMS.dbufferParams}.x, sbRuntimeDecal.a * ${RUNTIME_SCREEN_UNIFORMS.dbufferParams}.y);
 ` : ''}
 ${sbSpecializedPreLightingGlsl({ hair })}
 material.roughness = clamp(${eye ? 'uSbEye.z' : 'sbRuntimeRoughness'} + geometryRoughness, 0.0525, 1.0);
 #ifdef USE_SHEEN
 material.sheenColor = vec3(0.0);
 #endif
 #ifdef USE_CLEARCOAT
 material.clearcoat = 0.0;
 #endif
 #ifdef USE_IRIDESCENCE
 material.iridescence = 0.0;
 #endif
 reflectedLight = ReflectedLight(vec3(0.0), vec3(0.0), vec3(0.0), vec3(0.0));
 ${begin}
`;
  const close = `
 ${sbSpecializedPostLightingGlsl({ water })}
 vec3 sbRuntimeAttenuation = vec3(1.0);
 ${layering ? `
 float sbRuntimeCosine = max(abs(dot(normal, geometryViewDir)), 0.05);
 int sbRuntimeLayer = sbRuntimeSlot;
 for (int sbRuntimeDepth = 0; sbRuntimeDepth < 3; sbRuntimeDepth++) {
  int sbRuntimeParent = int(uSbRuntimeParents[sbRuntimeLayer]);
  if (sbRuntimeParent < 0) break;
  vec4 sbRuntimeLayerData = uSbRuntimeLayers[sbRuntimeLayer];
  vec3 sbRuntimeTransmission = pow(clamp(sbRuntimeLayerData.xyz, vec3(0.0001), vec3(1.0)), vec3(sbRuntimeLayerData.w / sbRuntimeCosine));
  SbSlabClosure sbRuntimeTop = sbReadSlabClosure(float(sbRuntimeParent));
  vec3 sbRuntimeTopFresnel = F_Schlick(sbRuntimeTop.f0, 1.0, sbRuntimeCosine);
  sbRuntimeAttenuation *= mix(vec3(1.0), sbRuntimeTransmission * (vec3(1.0) - sbRuntimeTopFresnel), uSbRuntimeCoverage[sbRuntimeLayer]);
  sbRuntimeLayer = sbRuntimeParent;
 }
 ` : ''}
 vec3 sbRuntimeWeight = max(uSbRuntimeWeights[sbRuntimeSlot], 0.0) * sbRuntimeAttenuation;
 ${lightFunction ? `
 {
  vec3 sbRuntimeLightMask = sbRuntimeLightFunctionMask();
  reflectedLight.directDiffuse *= sbRuntimeLightMask;
  reflectedLight.directSpecular *= sbRuntimeLightMask;
 }
 ` : ''}
 ${subsurfaceOn ? `
 {
  vec3 sbRuntimeBleed = sbSubsurfaceBleedFraction(sbRuntimeSlab.subsurfaceMeanFreePath);
  vec3 sbRuntimeMoved = reflectedLight.directDiffuse * sbRuntimeBleed;
  reflectedLight.directDiffuse -= sbRuntimeMoved;
  reflectedLight.indirectDiffuse += sbRuntimeMoved;
  sbRuntimeSubsurfaceMfp = max(sbRuntimeSubsurfaceMfp, sbRuntimeSlab.subsurfaceMeanFreePath * sbRuntimeWeight.x);
 }
 ` : ''}
 {
  float sbRuntimeLobeWeight = dot(material.specularColor, vec3(1.0 / 3.0)) * dot(sbRuntimeWeight, vec3(1.0 / 3.0));
  if (sbRuntimeLobeWeight > sbRuntimeReflectionWeight) {
   sbRuntimeReflectionWeight = sbRuntimeLobeWeight;
   sbRuntimeReflectionRoughness = material.roughness;
  }
 }
 sbRuntimeSum.directDiffuse += reflectedLight.directDiffuse * sbRuntimeWeight;
 sbRuntimeSum.indirectDiffuse += reflectedLight.indirectDiffuse * sbRuntimeWeight;
 sbRuntimeSum.directSpecular += reflectedLight.directSpecular * sbRuntimeWeight;
 sbRuntimeSum.indirectSpecular += reflectedLight.indirectSpecular * sbRuntimeWeight;
 sbRuntimeEmission += sbRuntimeSlab.emissive * sbRuntimeWeight;
 sbRuntimeOpacity += sbRuntimeSlab.opacity * max(uSbRuntimeWeights[sbRuntimeSlot], 0.0);
}
normal = sbRuntimeBaseNormal;
reflectedLight = sbRuntimeSum;
material = sbRuntimeBaseMaterial;
#ifdef USE_SHEEN
material.sheenColor = vec3(0.0);
#endif
#ifdef USE_CLEARCOAT
material.clearcoat = 0.0;
#endif
${roughnessTracking ? `
if (${RUNTIME_SCREEN_UNIFORMS.reflectionTracking} > 0.5) {
 material.roughness = sbRuntimeReflectionRoughness;
 roughnessFactor = sbRuntimeReflectionRoughness;
}
` : ''}
totalEmissiveRadiance = sbRuntimeEmission;
diffuseColor.a = clamp(sbRuntimeOpacity, 0.0, 1.0);
vec3 geometryPosition = -vViewPosition;
vec3 geometryNormal = normal;
vec3 geometryViewDir = isOrthographic ? vec3(0.0, 0.0, 1.0) : normalize(vViewPosition);
vec3 geometryClearcoatNormal = vec3(0.0);
#ifdef USE_CLEARCOAT
geometryClearcoatNormal = clearcoatNormal;
#endif
${end}
`;
  let result = source.replace(begin, open).replace(end, close);
  if (orderedTranslucency && result.includes(opaque)) {
    result = result.replace(opaque, `${opaque}
if (${RUNTIME_SCREEN_UNIFORMS.oitAccumulate} > 0.5) {
 float sbRuntimeOitCoverage = clamp(gl_FragColor.a, 0.0, 1.0);
 float sbRuntimeOitDepth = 1.0 / max(gl_FragCoord.w, 1e-5);
 float sbRuntimeOitWeightValue = sbRuntimeOitWeight(sbRuntimeOitDepth, sbRuntimeOitCoverage);
 gl_FragColor = vec4(gl_FragColor.rgb * sbRuntimeOitCoverage * sbRuntimeOitWeightValue, sbRuntimeOitCoverage * sbRuntimeOitWeightValue);
}`);
  }
  return { source: result, installed: true, reason: null, slabMapSamplers: slabMapRuntime.samplers, slabMapSlots: slabMapRuntime.boundSlots };
}
