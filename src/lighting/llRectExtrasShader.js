import { BARN_DOOR_OPEN_SLOPE, RECT_EXTRAS_MAX_PROMOTED } from "./llRectExtrasCore.js";

export const RECT_EXTRAS_UNIFORMS = Object.freeze({
  enabled: "uLlRectExtrasOn",


  barnSlope: "uLlRectBarnSlope",

  sourceTint: "uLlRectSourceTint",
});

export const RECT_EXTRAS_HELPER_NAME = "llApplyRectExtras";

const RECT_AREA_LIGHT_UNIFORM_PATTERN = /uniform\s+RectAreaLight\s+rectAreaLights\[\s*NUM_RECT_AREA_LIGHTS\s*\]\s*;/;
const RECT_AREA_LIGHT_LOOP_PATTERN = /rectAreaLight\s*=\s*rectAreaLights\[\s*i\s*\]\s*;/;

function glslFloat(value) {
  const number = Number(value);
  return Number.isInteger(number) ? number.toFixed(1) : String(number);
}

export function hasRectAreaLightUniforms(source) {
  return typeof source === "string" && RECT_AREA_LIGHT_UNIFORM_PATTERN.test(source);
}

export function hasRectAreaLightLoop(source) {
  return typeof source === "string" && RECT_AREA_LIGHT_LOOP_PATTERN.test(source);
}

export function isAlreadyPatched(source) {
  return typeof source === "string" && source.indexOf(RECT_EXTRAS_HELPER_NAME) >= 0;
}


export function buildRectExtrasDeclarationsGlsl() {
  const { enabled, barnSlope, sourceTint } = RECT_EXTRAS_UNIFORMS;
  return [
    "",
    "\t// LL-F7 rect extras: barn doors, SourceTexture tint and TwoSided.",
    "\tuniform float " + enabled + ";",
    "\tuniform vec4 " + barnSlope + "[ " + RECT_EXTRAS_MAX_PROMOTED + " ];",
    "\tuniform vec4 " + sourceTint + "[ " + RECT_EXTRAS_MAX_PROMOTED + " ];",
    "\tfloat llRectBarnAxisAttenuation( const in float lateralOffset, const in float normalDistance, const in float tipSlope, const in float softEdge ) {",
    "\t\tif ( tipSlope >= " + glslFloat(BARN_DOOR_OPEN_SLOPE) + " ) return 1.0;",
    "\t\tfloat slope = abs( lateralOffset ) / max( normalDistance, 1e-4 );",
    "\t\tfloat inner = tipSlope * ( 1.0 - softEdge );",
    "\t\treturn 1.0 - smoothstep( inner, tipSlope, slope );",
    "\t}",
    "\tvoid " + RECT_EXTRAS_HELPER_NAME + "( inout RectAreaLight rectLight, const in vec3 shadingPosition, const in vec4 barnSlope, const in vec4 sourceTint ) {",
    "\t\tif ( " + enabled + " <= 0.0 ) return;",
    "\t\tvec3 toPoint = shadingPosition - rectLight.position;",
    "\t\t// cross( halfWidth, halfHeight ) is the local +Z of the light and three",
    "\t\t// emits down -Z, so the emitting normal is the opposite of that cross.",
    "\t\tvec3 emissionNormal = -normalize( cross( rectLight.halfWidth, rectLight.halfHeight ) );",
    "\t\tfloat normalDistance = dot( toPoint, emissionNormal );",
    "\t\tif ( sourceTint.w > 0.5 && normalDistance < 0.0 ) {",
    "\t\t\t// TwoSided: mirror one half axis so the back of the rect emits too.",
    "\t\t\trectLight.halfWidth = -rectLight.halfWidth;",
    "\t\t\tnormalDistance = -normalDistance;",
    "\t\t}",
    "\t\tfloat acrossWidth = llRectBarnAxisAttenuation( dot( toPoint, normalize( rectLight.halfWidth ) ), normalDistance, barnSlope.x, barnSlope.z );",
    "\t\tfloat acrossHeight = llRectBarnAxisAttenuation( dot( toPoint, normalize( rectLight.halfHeight ) ), normalDistance, barnSlope.y, barnSlope.z );",
    "\t\trectLight.color *= sourceTint.rgb * mix( 1.0, acrossWidth * acrossHeight, barnSlope.w );",
    "\t}",
  ].join("\n");
}

export function buildRectExtrasCallGlsl() {
  const { barnSlope, sourceTint } = RECT_EXTRAS_UNIFORMS;
  return [
    "\t\t#if UNROLLED_LOOP_INDEX < " + RECT_EXTRAS_MAX_PROMOTED,
    "\t\t" +
      RECT_EXTRAS_HELPER_NAME +
      "( rectAreaLight, geometryPosition, " +
      barnSlope +
      "[ UNROLLED_LOOP_INDEX ], " +
      sourceTint +
      "[ UNROLLED_LOOP_INDEX ] );",
    "\t\t#endif",
  ].join("\n");
}

export function rewriteLightsParsBegin(source) {
  if (!hasRectAreaLightUniforms(source)) return null;
  if (isAlreadyPatched(source)) return source;
  return source.replace(RECT_AREA_LIGHT_UNIFORM_PATTERN, (match) => match + "\n" + buildRectExtrasDeclarationsGlsl());
}

export function rewriteLightsFragmentBegin(source) {
  if (!hasRectAreaLightLoop(source)) return null;
  if (isAlreadyPatched(source)) return source;
  return source.replace(RECT_AREA_LIGHT_LOOP_PATTERN, (match) => match + "\n" + buildRectExtrasCallGlsl());
}
