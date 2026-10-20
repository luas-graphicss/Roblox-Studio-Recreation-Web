import { hasFunctionDefinition, wrapFunctionDefinition } from "./llGlslPatchCore.js";
import { SHADOW_SOURCE_MIX_UNIFORM } from "./llShadowSourceContract.js";
import {
  LEGACY_SHADOW_RADIUS,
  SHADOW_META_MARKER,
  SHADOW_META_SLOPE_QUANTUM,
  SHADOW_META_SLOPE_STRIDE,
} from "./llShadowMetaPackCore.js";
import {
  ENGINE_PCSS_MAX_FILTER_UV,
  ENGINE_PCSS_MAX_SEARCH_UV,
  ENGINE_PCSS_MIN_FILTER_TEXELS,
} from "./llShadowSourceCore.js";
import {
  BLOCKER_SEARCH_TAPS,
  FILTER_TAPS,
  GOLDEN_ANGLE_RADIANS,
  MAX_SLOPE_DEPTH_PER_TEXEL,
} from "./llShadowFilterKernelCore.js";


export const SHADOW_SOURCE_ANCHOR = "shadowmapParsFragment";
export const SHADOW_SOURCE_CHUNK = "shadowmap_pars_fragment";

export const STOCK_SHADOW_FUNCTION = "getShadow";
export const LEGACY_SHADOW_FUNCTION = "llLegacyGetShadow";


export const SHADOW_SOURCE_TEXT_MARKER = "llShadowSourcePenumbra";

export const REWRITE_REFUSAL = Object.freeze({
  emptySource: "empty shader source",
  alreadyRewritten: "chunk already carries the LL-F14 wrapper",
  stockFunctionMissing: "three.js getShadow definition not found (signature changed?)",
  legacyNameTaken: "llLegacyGetShadow already exists in this shader",
  surgeryFailed: "rename plus insert did not produce a new source",
});

function glslFloat(value) {
  const number = Number(value);
  const text = String(number);
  return text.indexOf(".") >= 0 || text.indexOf("e") >= 0 ? text : text + ".0";
}

function glslInt(value) {
  return String(Math.max(1, Math.floor(Number(value) || 0)));
}


export const SHADOW_SOURCE_GLSL_CONSTANTS = Object.freeze({
  LL_F14_META_MARKER: glslFloat(SHADOW_META_MARKER),
  LL_F14_META_SLOPE_STRIDE: glslFloat(SHADOW_META_SLOPE_STRIDE),
  LL_F14_META_SLOPE_QUANTUM: glslFloat(SHADOW_META_SLOPE_QUANTUM),
  LL_F14_LEGACY_SHADOW_RADIUS: glslFloat(LEGACY_SHADOW_RADIUS),
  LL_F14_GOLDEN_ANGLE: glslFloat(GOLDEN_ANGLE_RADIANS),
  LL_F14_MIN_FILTER_TEXELS: glslFloat(ENGINE_PCSS_MIN_FILTER_TEXELS),
  LL_F14_MAX_FILTER_UV: glslFloat(ENGINE_PCSS_MAX_FILTER_UV),
  LL_F14_MAX_SEARCH_UV: glslFloat(ENGINE_PCSS_MAX_SEARCH_UV),
  LL_F14_MAX_SLOPE_DEPTH_PER_TEXEL: glslFloat(MAX_SLOPE_DEPTH_PER_TEXEL),
  LL_F14_SEARCH_TAPS: glslInt(BLOCKER_SEARCH_TAPS),
  LL_F14_FILTER_TAPS: glslInt(FILTER_TAPS),
});


export function buildShadowSourceHelpersGlsl() {
  const c = SHADOW_SOURCE_GLSL_CONSTANTS;
  return [
    "// LL-F14 " + SHADOW_SOURCE_TEXT_MARKER + ": penumbra from the SOURCE size, per light.",
    "uniform float " + SHADOW_SOURCE_MIX_UNIFORM + ";",
    "const float LL_F14_META_MARKER = " + c.LL_F14_META_MARKER + ";",
    "const float LL_F14_META_SLOPE_STRIDE = " + c.LL_F14_META_SLOPE_STRIDE + ";",
    "const float LL_F14_META_SLOPE_QUANTUM = " + c.LL_F14_META_SLOPE_QUANTUM + ";",
    "const float LL_F14_LEGACY_SHADOW_RADIUS = " + c.LL_F14_LEGACY_SHADOW_RADIUS + ";",
    "const float LL_F14_GOLDEN_ANGLE = " + c.LL_F14_GOLDEN_ANGLE + ";",
    "const float LL_F14_MIN_FILTER_TEXELS = " + c.LL_F14_MIN_FILTER_TEXELS + ";",
    "const float LL_F14_MAX_FILTER_UV = " + c.LL_F14_MAX_FILTER_UV + ";",
    "const float LL_F14_MAX_SEARCH_UV = " + c.LL_F14_MAX_SEARCH_UV + ";",
    "const float LL_F14_MAX_SLOPE_DEPTH_PER_TEXEL = " + c.LL_F14_MAX_SLOPE_DEPTH_PER_TEXEL + ";",
    "",
    "bool llShadowSourceHasMeta( const in float packedRadius ) {",
    "  return packedRadius >= LL_F14_META_MARKER;",
    "}",
    "",
    "// The channel smuggles the per-light numbers INSIDE shadowRadius, so the",
    "// legacy sampler must never see the packed number: three would read it as a",
    "// PCF spread of thousands of texels and paint a frame that is not legacy.",
    "// Hand it the stock radius instead - this is what makes mix 0 byte for byte.",
    "float llShadowSourceLegacyRadius( const in float packedRadius ) {",
    "  return llShadowSourceHasMeta( packedRadius ) ? LL_F14_LEGACY_SHADOW_RADIUS : packedRadius;",
    "}",
    "",
    "float llShadowSourceTexelScaleFrom( const in float packedRadius ) {",
    "  float rest = packedRadius - LL_F14_META_MARKER;",
    "  return rest - floor( rest / LL_F14_META_SLOPE_STRIDE ) * LL_F14_META_SLOPE_STRIDE;",
    "}",
    "",
    "float llShadowSourceSlopeBiasFrom( const in float packedRadius ) {",
    "  float rest = packedRadius - LL_F14_META_MARKER;",
    "  return floor( rest / LL_F14_META_SLOPE_STRIDE ) * LL_F14_META_SLOPE_QUANTUM;",
    "}",
    "",
    "vec2 llShadowSourceVogelDisk( const in float tapIndex, const in float tapCount ) {",
    "  float tapRadius = sqrt( ( tapIndex + 0.5 ) / tapCount );",
    "  float tapAngle = tapIndex * LL_F14_GOLDEN_ANGLE;",
    "  return vec2( cos( tapAngle ), sin( tapAngle ) ) * tapRadius;",
    "}",
    "",
    "float llShadowSourceDepthAt( sampler2D shadowMap, const in vec2 uv ) {",
    "  return unpackRGBAToDepth( texture2D( shadowMap, uv ) );",
    "}",
    "",
    "// Local depth slope read off the MAP itself with 4 taps. Derivative free on",
    "// purpose: getShadow is called inside a ternary in three's light loop and",
    "// dFdx/dFdy in non uniform control flow is undefined by the GLSL spec.",
    "float llShadowSourceSlopeDepthPerTexel( sampler2D shadowMap, const in vec2 uv, const in vec2 texelSize ) {",
    "  float right = llShadowSourceDepthAt( shadowMap, uv + vec2( texelSize.x, 0.0 ) );",
    "  float left = llShadowSourceDepthAt( shadowMap, uv - vec2( texelSize.x, 0.0 ) );",
    "  float up = llShadowSourceDepthAt( shadowMap, uv + vec2( 0.0, texelSize.y ) );",
    "  float down = llShadowSourceDepthAt( shadowMap, uv - vec2( 0.0, texelSize.y ) );",
    "  float slope = max( abs( right - left ), abs( up - down ) ) * 0.5;",
    "  return min( slope, LL_F14_MAX_SLOPE_DEPTH_PER_TEXEL );",
    "}",
  ].join("\n");
}


export function buildShadowSourceWrapperGlsl() {
  const c = SHADOW_SOURCE_GLSL_CONSTANTS;
  return [
    buildShadowSourceHelpersGlsl(),
    "",
    "float " + STOCK_SHADOW_FUNCTION + "( sampler2D shadowMap, vec2 shadowMapSize, float shadowBias, float shadowRadius, vec4 shadowCoord ) {",
    "  // No meta on this light (directional, point, or phase off): legacy path,",
    "  // byte for byte, with no extra tap.",
    "  if ( " + SHADOW_SOURCE_MIX_UNIFORM + " <= 0.0 || ! llShadowSourceHasMeta( shadowRadius ) ) {",
    "    return " + LEGACY_SHADOW_FUNCTION + "( shadowMap, shadowMapSize, shadowBias, llShadowSourceLegacyRadius( shadowRadius ), shadowCoord );",
    "  }",
    "  vec3 projected = shadowCoord.xyz / shadowCoord.w;",
    "  bool insideMap = projected.x >= 0.0 && projected.x <= 1.0 && projected.y >= 0.0 && projected.y <= 1.0;",
    "  if ( ! insideMap || projected.z > 1.0 ) return 1.0;",
    "  float receiverDepth = projected.z + shadowBias;",
    "  vec2 texelSize = vec2( 1.0 ) / shadowMapSize;",
    "  float mapSize = shadowMapSize.x;",
    "  float sourceTexelScale = llShadowSourceTexelScaleFrom( shadowRadius );",
    "  // Widest penumbra this light can cast happens with the blocker at the near",
    "  // plane, so scale * receiverDepth IS the exact search bound.",
    "  float searchTexelRadius = min( sourceTexelScale * receiverDepth, LL_F14_MAX_SEARCH_UV * mapSize );",
    "  float blockerDepthSum = 0.0;",
    "  float blockerCount = 0.0;",
    "  for ( int tap = 0; tap < " + c.LL_F14_SEARCH_TAPS + "; tap ++ ) {",
    "    vec2 tapOffset = llShadowSourceVogelDisk( float( tap ), " + glslFloat(BLOCKER_SEARCH_TAPS) + " ) * searchTexelRadius;",
    "    float sampledDepth = llShadowSourceDepthAt( shadowMap, projected.xy + tapOffset * texelSize );",
    "    if ( sampledDepth < receiverDepth ) {",
    "      blockerDepthSum += sampledDepth;",
    "      blockerCount += 1.0;",
    "    }",
    "  }",
    "  // Nothing between the light and this point: fully lit, no filtering.",
    "  if ( blockerCount < 0.5 ) return 1.0;",
    "  float averageBlockerDepth = blockerDepthSum / blockerCount;",
    "  float filterTexelRadius = clamp( sourceTexelScale * ( receiverDepth - averageBlockerDepth ), LL_F14_MIN_FILTER_TEXELS, LL_F14_MAX_FILTER_UV * mapSize );",
    "  // A/B knob: blends the penumbra WIDTH down to the 1 texel floor, so the",
    "  // comparison costs zero extra taps and zero recompiles.",
    "  filterTexelRadius = mix( LL_F14_MIN_FILTER_TEXELS, filterTexelRadius, clamp( " + SHADOW_SOURCE_MIX_UNIFORM + ", 0.0, 1.0 ) );",
    "  float slopeBias = llShadowSourceSlopeBiasFrom( shadowRadius );",
    "  float tapBias = 0.0;",
    "  if ( slopeBias > 0.0 ) {",
    "    tapBias = slopeBias * llShadowSourceSlopeDepthPerTexel( shadowMap, projected.xy, texelSize ) * filterTexelRadius;",
    "  }",
    "  float litSum = 0.0;",
    "  for ( int tap = 0; tap < " + c.LL_F14_FILTER_TAPS + "; tap ++ ) {",
    "    vec2 tapOffset = llShadowSourceVogelDisk( float( tap ), " + glslFloat(FILTER_TAPS) + " ) * filterTexelRadius;",
    "    litSum += texture2DCompare( shadowMap, projected.xy + tapOffset * texelSize, receiverDepth - tapBias );",
    "  }",
    "  return litSum / " + glslFloat(FILTER_TAPS) + ";",
    "}",
  ].join("\n");
}










export function rewriteShadowmapChunk(source) {
  const text = typeof source === "string" ? source : "";
  if (text === "") return refuse(text, REWRITE_REFUSAL.emptySource);
  if (text.indexOf(SHADOW_SOURCE_TEXT_MARKER) >= 0) return refuse(text, REWRITE_REFUSAL.alreadyRewritten);
  if (!hasFunctionDefinition(text, STOCK_SHADOW_FUNCTION)) return refuse(text, REWRITE_REFUSAL.stockFunctionMissing);
  if (hasFunctionDefinition(text, LEGACY_SHADOW_FUNCTION)) return refuse(text, REWRITE_REFUSAL.legacyNameTaken);
  const rewritten = wrapFunctionDefinition(text, {
    functionName: STOCK_SHADOW_FUNCTION,
    legacyFunctionName: LEGACY_SHADOW_FUNCTION,
    wrapperSource: buildShadowSourceWrapperGlsl(),
  });
  if (typeof rewritten !== "string" || rewritten === text) return refuse(text, REWRITE_REFUSAL.surgeryFailed);
  return Object.freeze({ ok: true, source: rewritten, refusal: null });
}

function refuse(source, refusal) {
  return Object.freeze({ ok: false, source: source, refusal: refusal });
}
