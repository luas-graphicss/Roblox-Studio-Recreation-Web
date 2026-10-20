import { wrapFunctionDefinition } from "./llGlslPatchCore.js";
import {
  LL_MAX_SHAPED_LIGHTS,
  LL_MAX_SIN_ANGULAR_RADIUS_SQUARED,
  LL_SHAPE_MATCH_TOLERANCE_SQUARED,
} from "./llSourceShapeCore.js";
import {
  SHAPED_LIGHT_COUNT_UNIFORM,
  SHAPE_CENTER_VIEW_UNIFORM,
  SHAPE_HALF_AXIS_VIEW_UNIFORM,
  SHAPE_RADIUS_UNIFORM,
  SOURCE_SHAPE_UNIFORM_NAMES,
} from "./llSourceShapeContract.js";


export const SOURCE_SHAPE_PARS_CHUNK_NAME = "lights_pars_begin";


export const SOURCE_SHAPE_FRAGMENT_CHUNK_NAME = "lights_fragment_begin";

export const POINT_LIGHT_INFO_ANCHOR = "getPointLightInfo";
export const SPOT_LIGHT_INFO_ANCHOR = "getSpotLightInfo";
export const LEGACY_POINT_LIGHT_INFO_NAME = "llLegacyGetPointLightInfo";
export const LEGACY_SPOT_LIGHT_INFO_NAME = "llLegacyGetSpotLightInfo";


export const SHADING_NORMAL_GLOBAL = "llShadingNormalView";


export const SHADING_NORMAL_ANCHOR_PATTERN = /vec3\s+geometryClearcoatNormal\s*=\s*vec3\(\s*0\.0\s*\)\s*;/;


export const SHADING_NORMAL_PUBLISH_GLSL = SHADING_NORMAL_GLOBAL + " = geometryNormal;";

function toGlslFloat(value) {
  const text = String(value);
  return text.indexOf(".") === -1 && text.indexOf("e") === -1 ? text + ".0" : text;
}


export function buildSourceShapePreludeGlsl() {
  const slots = String(LL_MAX_SHAPED_LIGHTS);
  const matchTolerance = toGlslFloat(LL_SHAPE_MATCH_TOLERANCE_SQUARED);
  const maxSinSquared = toGlslFloat(LL_MAX_SIN_ANGULAR_RADIUS_SQUARED);
  return [
    "// ---- LL-F4 source shape (sphere / capsule), engine port ----",
    "uniform int " + SHAPED_LIGHT_COUNT_UNIFORM + ";",
    "uniform vec3 " + SHAPE_CENTER_VIEW_UNIFORM + "[ " + slots + " ];",
    "uniform vec3 " + SHAPE_HALF_AXIS_VIEW_UNIFORM + "[ " + slots + " ];",
    "uniform float " + SHAPE_RADIUS_UNIFORM + "[ " + slots + " ];",
    "vec3 " + SHADING_NORMAL_GLOBAL + " = vec3( 0.0 );",
    "int llFindShapedLight( const in vec3 lightCenterView ) {",
    "  for ( int index = 0; index < " + slots + "; index ++ ) {",
    "    if ( index >= " + SHAPED_LIGHT_COUNT_UNIFORM + " ) break;",
    "    vec3 centerOffset = " + SHAPE_CENTER_VIEW_UNIFORM + "[ index ] - lightCenterView;",
    "    if ( dot( centerOffset, centerOffset ) <= " + matchTolerance + " ) return index;",
    "  }",
    "  return -1;",
    "}",
    "float llSphereDiffuseCosine( const in float cosIncidence, const in float sinAngularRadiusSquared ) {",
    "  if ( cosIncidence * cosIncidence > sinAngularRadiusSquared ) return max( cosIncidence, 0.0 );",
    "  float sine = sqrt( max( 1.0 - cosIncidence * cosIncidence, 1e-8 ) );",
    "  float horizonRatio = sqrt( max( 1.0 / sinAngularRadiusSquared - 1.0, 0.0 ) );",
    "  float clippedCosine = clamp( - horizonRatio * ( cosIncidence / sine ), -1.0, 1.0 );",
    "  float clippedChord = sine * sqrt( max( 1.0 - clippedCosine * clippedCosine, 0.0 ) );",
    "  float irradiance = ( cosIncidence * acos( clippedCosine ) - horizonRatio * clippedChord ) * sinAngularRadiusSquared + atan( clippedChord / max( horizonRatio, 1e-8 ) );",
    "  return clamp( max( irradiance, 0.0 ) / ( 3.141592653589793 * sinAngularRadiusSquared ), 0.0, 1.0 );",
    "}",
    "void llApplySourceShape( const in vec3 lightCenterView, const in vec3 shadingPositionView, inout vec3 lightDirection ) {",
    "  int shapeIndex = llFindShapedLight( lightCenterView );",
    "  if ( shapeIndex < 0 ) return;",
    "  vec3 halfAxis = " + SHAPE_HALF_AXIS_VIEW_UNIFORM + "[ shapeIndex ];",
    "  float halfAxisLengthSquared = dot( halfAxis, halfAxis );",
    "  float axisParameter = 0.0;",
    "  if ( halfAxisLengthSquared > 1e-8 ) {",
    "    axisParameter = clamp( dot( shadingPositionView - lightCenterView, halfAxis ) / halfAxisLengthSquared, -1.0, 1.0 );",
    "  }",
    "  vec3 nearestSourcePoint = lightCenterView + halfAxis * axisParameter;",
    "  vec3 shadingToSource = nearestSourcePoint - shadingPositionView;",
    "  float sourceDistanceSquared = dot( shadingToSource, shadingToSource );",
    "  if ( sourceDistanceSquared <= 1e-8 ) return;",
    "  float sourceDistance = sqrt( sourceDistanceSquared );",
    "  vec3 sourceDirection = shadingToSource / sourceDistance;",
    "  float sourceRadius = " + SHAPE_RADIUS_UNIFORM + "[ shapeIndex ];",
    "  float sinAngularRadiusSquared = min( ( sourceRadius * sourceRadius ) / sourceDistanceSquared, " + maxSinSquared + " );",
    "  if ( sinAngularRadiusSquared <= 1e-8 ) {",
    "    lightDirection = sourceDirection;",
    "    return;",
    "  }",
    "  float cosIncidence = clamp( dot( " + SHADING_NORMAL_GLOBAL + ", sourceDirection ), -1.0, 1.0 );",
    "  float shapedCosine = llSphereDiffuseCosine( cosIncidence, sinAngularRadiusSquared );",
    "  vec3 tangent = sourceDirection - " + SHADING_NORMAL_GLOBAL + " * cosIncidence;",
    "  float tangentLength = length( tangent );",
    "  if ( tangentLength <= 1e-5 ) {",
    "    lightDirection = sourceDirection;",
    "    return;",
    "  }",
    "  lightDirection = normalize( " + SHADING_NORMAL_GLOBAL + " * shapedCosine + ( tangent / tangentLength ) * sqrt( max( 1.0 - shapedCosine * shapedCosine, 0.0 ) ) );",
    "}",
  ].join("\n");
}

const POINT_LIGHT_WRAPPER_GLSL = [
  "void getPointLightInfo( const in PointLight pointLight, const in vec3 geometryPosition, out IncidentLight light ) {",
  "  " + LEGACY_POINT_LIGHT_INFO_NAME + "( pointLight, geometryPosition, light );",
  "  if ( light.visible ) llApplySourceShape( pointLight.position, geometryPosition, light.direction );",
  "}",
].join("\n");

const SPOT_LIGHT_WRAPPER_GLSL = [
  "void getSpotLightInfo( const in SpotLight spotLight, const in vec3 geometryPosition, out IncidentLight light ) {",
  "  " + LEGACY_SPOT_LIGHT_INFO_NAME + "( spotLight, geometryPosition, light );",
  "  if ( light.visible ) llApplySourceShape( spotLight.position, geometryPosition, light.direction );",
  "}",
].join("\n");


export function preludeDeclaresEveryUniform() {
  const prelude = buildSourceShapePreludeGlsl();
  return SOURCE_SHAPE_UNIFORM_NAMES.every((uniformName) => prelude.indexOf(uniformName) !== -1);
}








export function injectSourceShapeIntoLightsPars(chunkSource) {
  const source = typeof chunkSource === "string" ? chunkSource : "";
  if (source.indexOf(LEGACY_POINT_LIGHT_INFO_NAME) !== -1) {
    return Object.freeze({ source: source, replaced: false, reason: "already-injected" });
  }
  const withPointWrapper = wrapFunctionDefinition(buildSourceShapePreludeGlsl() + "\n" + source, {
    functionName: POINT_LIGHT_INFO_ANCHOR,
    legacyFunctionName: LEGACY_POINT_LIGHT_INFO_NAME,
    wrapperSource: POINT_LIGHT_WRAPPER_GLSL,
  });
  if (withPointWrapper === null) {
    return Object.freeze({ source: source, replaced: false, reason: "point-light-info-not-found" });
  }
  const withSpotWrapper = wrapFunctionDefinition(withPointWrapper, {
    functionName: SPOT_LIGHT_INFO_ANCHOR,
    legacyFunctionName: LEGACY_SPOT_LIGHT_INFO_NAME,
    wrapperSource: SPOT_LIGHT_WRAPPER_GLSL,
  });
  if (withSpotWrapper === null) {
    return Object.freeze({ source: source, replaced: false, reason: "spot-light-info-not-found" });
  }
  return Object.freeze({ source: withSpotWrapper, replaced: true, reason: "" });
}









export function injectShadingNormalPublish(chunkSource) {
  const source = typeof chunkSource === "string" ? chunkSource : "";
  if (source.indexOf(SHADING_NORMAL_PUBLISH_GLSL) !== -1) {
    return Object.freeze({ source: source, replaced: false, reason: "already-injected" });
  }
  if (!SHADING_NORMAL_ANCHOR_PATTERN.test(source)) {
    return Object.freeze({ source: source, replaced: false, reason: "shading-normal-anchor-not-found" });
  }
  const patched = source.replace(
    SHADING_NORMAL_ANCHOR_PATTERN,
    (anchorText) => anchorText + "\n\t" + SHADING_NORMAL_PUBLISH_GLSL,
  );
  return Object.freeze({ source: patched, replaced: true, reason: "" });
}
