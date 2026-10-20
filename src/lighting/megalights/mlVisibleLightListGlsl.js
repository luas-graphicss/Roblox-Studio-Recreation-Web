export const VISIBLE_LIGHT_LIST_GLSL_REVISION = 1;
export const VISIBLE_LIGHT_LIST_GLSL_CONSUMER = "ML-F11";


export const VISIBLE_LIGHT_LIST_UNIFORM_NAMES = Object.freeze({
  listTexture: "uMglVisibleLightList",
  lightsPerTile: "uMglVisibleLightsPerTile",
  guidingTileSize: "uMglGuidingTileSize",
});

export function visibleLightListUniformDeclarations() {
  return [
    "uniform sampler2D uMglVisibleLightList;",
    "uniform int uMglVisibleLightsPerTile;",
    "uniform int uMglGuidingTileSize;",
  ].join("\n");
}

export function visibleLightListFetchFunctions() {
  return [
    "struct MglGuidedLight {",
    "  float lightIndex;",
    "  float tileContributionWeight;",
    "  float needsShadowTrace;",
    "  float lightShapeIndex;",
    "};",
    "",
    "// The list texture is (tileCountX * lightsPerTile) wide and tileCountY tall.",
    "ivec2 mglGuidingTileCount() {",
    "  ivec2 listSize = textureSize(uMglVisibleLightList, 0);",
    "  return ivec2(listSize.x / max(uMglVisibleLightsPerTile, 1), listSize.y);",
    "}",
    "",
    "// 0.0 at the CENTRE of tile 0: the interpolation must be symmetric on a border.",
    "vec2 mglContinuousGuidingTile(vec2 pixelPosition) {",
    "  return (pixelPosition + 0.5) / float(max(uMglGuidingTileSize, 1)) - 0.5;",
    "}",
    "",
    "// Picks ONE of the four nearest lists with probability equal to its bilinear",
    "// weight. Same neighbour order as mlTileGuidingCore.js.",
    "ivec2 mglSelectGuidingTile(vec2 pixelPosition, float randomValue) {",
    "  vec2 continuousTile = mglContinuousGuidingTile(pixelPosition);",
    "  vec2 baseTile = floor(continuousTile);",
    "  vec2 fraction = continuousTile - baseTile;",
    "  vec4 neighbourWeights = vec4(",
    "    (1.0 - fraction.x) * (1.0 - fraction.y),",
    "    fraction.x * (1.0 - fraction.y),",
    "    (1.0 - fraction.x) * fraction.y,",
    "    fraction.x * fraction.y",
    "  );",
    "  float pick = clamp(randomValue, 0.0, 0.9999999);",
    "  vec2 chosenOffset = vec2(0.0, 0.0);",
    "  float cumulativeWeight = neighbourWeights.x;",
    "  if (pick >= cumulativeWeight) { chosenOffset = vec2(1.0, 0.0); cumulativeWeight += neighbourWeights.y; }",
    "  if (pick >= cumulativeWeight) { chosenOffset = vec2(0.0, 1.0); cumulativeWeight += neighbourWeights.z; }",
    "  if (pick >= cumulativeWeight) { chosenOffset = vec2(1.0, 1.0); }",
    "  ivec2 tileCount = mglGuidingTileCount();",
    "  return clamp(ivec2(baseTile + chosenOffset), ivec2(0), tileCount - ivec2(1));",
    "}",
    "",
    "// One texelFetch per guided light: no filtering, no mip, no division.",
    "MglGuidedLight mglFetchGuidedLight(ivec2 guidingTile, int slotIndex) {",
    "  ivec2 texelPosition = ivec2(guidingTile.x * uMglVisibleLightsPerTile + slotIndex, guidingTile.y);",
    "  vec4 packedGuidedLight = texelFetch(uMglVisibleLightList, texelPosition, 0);",
    "  MglGuidedLight guidedLight;",
    "  guidedLight.lightIndex = packedGuidedLight.r;",
    "  guidedLight.tileContributionWeight = packedGuidedLight.g;",
    "  guidedLight.needsShadowTrace = packedGuidedLight.b;",
    "  guidedLight.lightShapeIndex = packedGuidedLight.a;",
    "  return guidedLight;",
    "}",
    "",
    "bool mglGuidedSlotIsEmpty(MglGuidedLight guidedLight) {",
    "  return guidedLight.lightIndex < 0.0;",
    "}",
  ].join("\n");
}


export function visibleLightListGlslSource() {
  return visibleLightListUniformDeclarations() + "\n\n" + visibleLightListFetchFunctions() + "\n";
}
