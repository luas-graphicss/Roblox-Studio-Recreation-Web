import {
  GI_BLEND_UNIFORM,
  GI_EMITTER_COUNT_UNIFORM,
  GI_EMITTER_NORMAL_UNIFORM,
  GI_EMITTER_ORIGIN_UNIFORM,
  GI_EMITTER_RADIANCE_UNIFORM,
  MAX_BOUNCE_EMITTERS,
} from "./llGiLocalContract.js";

export const GI_LOCAL_IRRADIANCE_FUNCTION = "llGiLocalIrradiance";
export const INDIRECT_DIFFUSE_GUARD = "#if defined( RE_IndirectDiffuse )";

export const GI_LOCAL_INJECTION_MARKER = "irradiance += " + GI_LOCAL_IRRADIANCE_FUNCTION + "(";

const GEOMETRY_POSITION_SYMBOL = "geometryPosition";
const GEOMETRY_NORMAL_SYMBOL = "geometryNormal";
const FALLBACK_POSITION_EXPRESSION = "- vViewPosition";
const FALLBACK_NORMAL_EXPRESSION = "normal";


export function resolveShadingPointExpressions(sources) {
  const list = Array.isArray(sources) ? sources : [sources];
  let probe = "";
  for (let index = 0; index !== list.length; index += 1) {
    if (typeof list[index] === "string") probe += list[index];
  }
  return Object.freeze({
    position: probe.indexOf(GEOMETRY_POSITION_SYMBOL) >= 0 ? GEOMETRY_POSITION_SYMBOL : FALLBACK_POSITION_EXPRESSION,
    normal: probe.indexOf(GEOMETRY_NORMAL_SYMBOL) >= 0 ? GEOMETRY_NORMAL_SYMBOL : FALLBACK_NORMAL_EXPRESSION,
  });
}

export function buildGiLocalDeclarations() {
  const maxEmitters = String(MAX_BOUNCE_EMITTERS);
  return [
    "// ---- LL-F18 GI local: bounce das luzes locais (view space) ----",
    "uniform float " + GI_BLEND_UNIFORM + ";",
    "uniform float " + GI_EMITTER_COUNT_UNIFORM + ";",
    "uniform vec4 " + GI_EMITTER_ORIGIN_UNIFORM + "[ " + maxEmitters + " ];",
    "uniform vec4 " + GI_EMITTER_RADIANCE_UNIFORM + "[ " + maxEmitters + " ];",
    "uniform vec4 " + GI_EMITTER_NORMAL_UNIFORM + "[ " + maxEmitters + " ];",
    "vec3 " + GI_LOCAL_IRRADIANCE_FUNCTION + "( const in vec3 shadingPosition, const in vec3 shadingNormal ) {",
    "\tvec3 bounced = vec3( 0.0 );",
    "\tif ( " + GI_BLEND_UNIFORM + " <= 0.0 ) return bounced;",


    "\tfor ( int emitterIndex = 0; emitterIndex < " + maxEmitters + "; emitterIndex ++ ) {",
    "\t\tif ( float( emitterIndex ) >= " + GI_EMITTER_COUNT_UNIFORM + " ) break;",
    "\t\tvec4 emitterOrigin = " + GI_EMITTER_ORIGIN_UNIFORM + "[ emitterIndex ];",
    "\t\tfloat squaredRadius = emitterOrigin.w * emitterOrigin.w;",
    "\t\tif ( squaredRadius <= 0.0 ) continue;",
    "\t\tvec3 toEmitter = emitterOrigin.xyz - shadingPosition;",
    "\t\tfloat squaredDistance = dot( toEmitter, toEmitter );",
    "\t\tif ( squaredDistance >= squaredRadius ) continue;",
    "\t\tfloat distanceToEmitter = sqrt( max( squaredDistance, 1e-8 ) );",
    "\t\tvec3 directionToEmitter = toEmitter / distanceToEmitter;",
    "\t\tfloat receiverCosine = max( dot( shadingNormal, directionToEmitter ), 0.0 );",
    "\t\tif ( receiverCosine <= 0.0 ) continue;",
    "\t\tfloat emitterCosine = max( dot( " + GI_EMITTER_NORMAL_UNIFORM + "[ emitterIndex ].xyz, - directionToEmitter ), 0.0 );",
    "\t\tif ( emitterCosine <= 0.0 ) continue;",
    "\t\tfloat closing = clamp( 1.0 - squaredDistance / squaredRadius, 0.0, 1.0 );",
    "\t\tvec4 emitterRadiance = " + GI_EMITTER_RADIANCE_UNIFORM + "[ emitterIndex ];",
    "\t\tfloat formFactor = receiverCosine * emitterCosine * closing * closing * emitterRadiance.w / ( squaredDistance + 1.0 );",
    "\t\tbounced += emitterRadiance.rgb * formFactor;",
    "\t}",
    "\treturn bounced * " + GI_BLEND_UNIFORM + ";",
    "}",
    "",
  ].join("\n");
}

export function buildGiLocalInjectionStatement(expressions) {
  const shadingPoint = expressions || resolveShadingPointExpressions("");
  return (
    "\t" + GI_LOCAL_INJECTION_MARKER + " " + shadingPoint.position + ", " + shadingPoint.normal + " ); // LL-F18"
  );
}













export function injectGiLocalIntoIndirectChunk(source, expressions) {
  if (typeof source !== "string") return null;
  if (source.indexOf(GI_LOCAL_INJECTION_MARKER) >= 0) return null;
  const guardIndex = source.lastIndexOf(INDIRECT_DIFFUSE_GUARD);
  if (guardIndex === -1) return null;
  const insertAt = guardIndex + INDIRECT_DIFFUSE_GUARD.length;
  return source.slice(0, insertAt) + "\n" + buildGiLocalInjectionStatement(expressions) + source.slice(insertAt);
}


export function declarationsArePresent(shaderSource) {
  return typeof shaderSource === "string" && shaderSource.indexOf(GI_LOCAL_IRRADIANCE_FUNCTION + "(") >= 0;
}
