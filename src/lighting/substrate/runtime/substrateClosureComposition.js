import { injectRuntimeClosureShader } from '../sbRuntimeClosureShader.js';
export function composeSubstrateClosures(source, options) {
  const result = injectRuntimeClosureShader(source, options);
  if (!result.installed) return result;
  const replacements = [
    ['#define SB_REAL_CLOSURES 1', '#define SB_REAL_CLOSURES 1\nuniform int uSbInheritedSlot;'],
    ['PhysicalMaterial sbRuntimeBaseMaterial = material;', 'PhysicalMaterial sbRuntimeBaseMaterial = material;\nvec3 sbRuntimeOriginalEmission = totalEmissiveRadiance;\nfloat sbRuntimeOriginalOpacity = diffuseColor.a;'],
    ['material.diffuseColor = sbRuntimeSlab.albedo * sbRuntimeColorModulation;', 'float sbRuntimeInherit = sbRuntimeSlot == uSbInheritedSlot ? 1.0 : 0.0;\n material.diffuseColor = mix(sbRuntimeSlab.albedo * sbRuntimeColorModulation, sbRuntimeBaseMaterial.diffuseColor, sbRuntimeInherit);'],
    ['material.specularColor = sbRuntimeSlab.f0;', 'material.specularColor = mix(sbRuntimeSlab.f0, mix(sbRuntimeSlab.f0, diffuseColor.rgb, metalnessFactor), sbRuntimeInherit);'],
    ['float sbRuntimeRoughness = sbRuntimeSlab.roughness * sbRuntimeRoughnessModulation;', 'float sbRuntimeRoughness = mix(sbRuntimeSlab.roughness * sbRuntimeRoughnessModulation, max(0.0, sbRuntimeBaseMaterial.roughness - geometryRoughness), sbRuntimeInherit);'],
    ['sbRuntimeEmission += sbRuntimeSlab.emissive * sbRuntimeWeight;', 'sbRuntimeEmission += mix(sbRuntimeSlab.emissive, sbRuntimeOriginalEmission, sbRuntimeInherit) * sbRuntimeWeight;'],
    ['diffuseColor.a = clamp(sbRuntimeOpacity, 0.0, 1.0);', 'diffuseColor.a = sbRuntimeOriginalOpacity * clamp(sbRuntimeOpacity, 0.0, 1.0);'],
  ];
  for (const [before, after] of replacements) {
    if (!result.source.includes(before)) return { source, installed: false, reason: 'Ported closure shader contract changed: ' + before.slice(0, 55) };
    result.source = result.source.replace(before, after);
  }
  return result;
}
