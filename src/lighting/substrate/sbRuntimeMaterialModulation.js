export function injectRuntimeMaterialModulation(source) {
  const anchors = ["map_fragment", "color_fragment", "roughnessmap_fragment"];
  if (anchors.some((anchor) => !source.includes("#include <" + anchor + ">")))
    return {
      source,
      installed: false,
      reason: "Material modulation anchors missing",
    };
  source = source.replace(
    "#include <map_fragment>",
    "vec3 sbRuntimeOriginalBaseColor = diffuseColor.rgb;\ndiffuseColor.rgb = vec3(1.0);\n#include <map_fragment>",
  );
  source = source.replace(
    "#include <color_fragment>",
    "#include <color_fragment>\nvec3 sbRuntimeColorModulation = diffuseColor.rgb;\ndiffuseColor.rgb *= sbRuntimeOriginalBaseColor;",
  );
  source = source.replace(
    "#include <roughnessmap_fragment>",
    `
  sbRuntimeRoughnessModulation = 1.0;
  #ifdef USE_ROUGHNESSMAP
  sbRuntimeRoughnessModulation = texture2D(roughnessMap, vRoughnessMapUv).g;
  #endif
  float roughnessFactor = roughness * sbRuntimeRoughnessModulation;
  `,
  );
  return { source, installed: true, reason: null };
}
