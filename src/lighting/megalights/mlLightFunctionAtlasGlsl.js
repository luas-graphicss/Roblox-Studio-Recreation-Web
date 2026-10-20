import {
  LIGHT_FUNCTION_ATLAS_SIZE,
  LIGHT_FUNCTION_CELL_PITCH,
  LIGHT_FUNCTION_GRID,
  LIGHT_FUNCTION_GUTTER,
  LIGHT_FUNCTION_NEUTRAL_SLOT,
  LIGHT_FUNCTION_SAMPLE_OFFSET,
  LIGHT_FUNCTION_SAMPLE_SPAN,
} from "./mlLightFunctionAtlasCore.js";

export const LIGHT_FUNCTION_ATLAS_SAMPLER_UNIFORM = "uMglLightFunctionAtlas";
export const LIGHT_FUNCTION_ATLAS_SIZE_UNIFORM = "uMglLightFunctionAtlasSize";

function glslFloat(value) {
  return Number(value).toFixed(1);
}

export function buildLightFunctionAtlasGlsl() {
  return [
    "// ML-F6: light function atlas - cookies, IES profiles and rect textures in",
    "// ONE texture unit. Slot travels per light in packedAtlasSlots; slot " + String(LIGHT_FUNCTION_NEUTRAL_SLOT) + " is",
    "// neutral (opaque white), so a light with no light function is a fetch and",
    "// not a branch.",
    "uniform sampler2D " + LIGHT_FUNCTION_ATLAS_SAMPLER_UNIFORM + ";",
    "uniform vec2 " + LIGHT_FUNCTION_ATLAS_SIZE_UNIFORM + ";",
    "vec2 mglLightFunctionAtlasUv( float slot, vec2 functionUv ) {",
    "\tvec2 cellIndex = vec2( mod( slot, " + glslFloat(LIGHT_FUNCTION_GRID) + " ), floor( slot / " + glslFloat(LIGHT_FUNCTION_GRID) + " ) );",
    "\tvec2 interiorOrigin = cellIndex * " + glslFloat(LIGHT_FUNCTION_CELL_PITCH) + " + " + glslFloat(LIGHT_FUNCTION_GUTTER) + ";",
    "\tvec2 insideCell = clamp( functionUv, 0.0, 1.0 ) * " + glslFloat(LIGHT_FUNCTION_SAMPLE_SPAN) + " + " + glslFloat(LIGHT_FUNCTION_SAMPLE_OFFSET) + ";",
    "\treturn ( interiorOrigin + insideCell ) / " + LIGHT_FUNCTION_ATLAS_SIZE_UNIFORM + ";",
    "}",
    "vec4 mglSampleLightFunction( float slot, vec2 functionUv ) {",
    "\treturn texture2D( " + LIGHT_FUNCTION_ATLAS_SAMPLER_UNIFORM + ", mglLightFunctionAtlasUv( slot, functionUv ) );",
    "}",
    "vec4 mglSampleLightFunctionLod( float slot, vec2 functionUv, float mipLevel ) {",
    "#if __VERSION__ >= 300",
    "\treturn textureLod( " + LIGHT_FUNCTION_ATLAS_SAMPLER_UNIFORM + ", mglLightFunctionAtlasUv( slot, functionUv ), mipLevel );",
    "#else",
    "\treturn texture2D( " + LIGHT_FUNCTION_ATLAS_SAMPLER_UNIFORM + ", mglLightFunctionAtlasUv( slot, functionUv ) );",
    "#endif",
    "}",
    "// Grayscale profiles are replicated over rgb, so .r is the mask and .rgb is",
    "// the color of a textured rect: one fetch answers both questions.",
    "float mglLightFunctionMask( float slot, vec2 functionUv ) {",
    "\treturn mglSampleLightFunction( slot, functionUv ).r;",
    "}",
    "",
  ].join("\n");
}

export function describeLightFunctionAtlasGlsl() {
  return {
    declaredUniforms: [LIGHT_FUNCTION_ATLAS_SAMPLER_UNIFORM, LIGHT_FUNCTION_ATLAS_SIZE_UNIFORM],
    declaredFunctions: [
      "mglLightFunctionAtlasUv",
      "mglSampleLightFunction",
      "mglSampleLightFunctionLod",
      "mglLightFunctionMask",
    ],
    atlasSize: LIGHT_FUNCTION_ATLAS_SIZE,
    patchesSharedShader: false,
  };
}
