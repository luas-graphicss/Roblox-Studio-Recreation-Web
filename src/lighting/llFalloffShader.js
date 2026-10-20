import { UNREAL_NEAR_FIELD_OFFSET } from "./llFalloffCore.js";

export const FALLOFF_BLEND_UNIFORM = "uLlFalloffOn";
export const THREE_FUNCTION_NAME = "getDistanceAttenuation";
export const LEGACY_FUNCTION_NAME = "llLegacyDistanceAttenuation";
export const UNREAL_FUNCTION_NAME = "llUnrealDistanceAttenuation";
export const LIGHTS_CHUNK_NAME = "lights_pars_begin";


const LEGACY_DEFINITION_PATTERN = /float\s+getDistanceAttenuation\s*\(\s*const/;
const ATTENUATION_SIGNATURE = "( const in float lightDistance, const in float cutoffDistance, const in float decayExponent )";

function toGlslFloat(value) {
  return Number.isInteger(value) ? value.toFixed(1) : String(value);
}

export function hasDistanceAttenuationDefinition(chunkSource) {
  return LEGACY_DEFINITION_PATTERN.test(String(chunkSource || ""));
}


export function buildFalloffGlsl() {
  return [
    "// LL-F2 falloff UE (uLlFalloffOn: 0 = three legado, 1 = UE)",
    "uniform float " + FALLOFF_BLEND_UNIFORM + ";",
    "float " + LEGACY_FUNCTION_NAME + ATTENUATION_SIGNATURE + ";",
    "float " + UNREAL_FUNCTION_NAME + "( const in float lightDistance, const in float attenuationRadius ) {",
    "\tfloat distanceOverRadius = attenuationRadius > 0.0 ? lightDistance / attenuationRadius : 0.0;",
    "\tfloat radiusWindow = pow2( saturate( 1.0 - pow4( distanceOverRadius ) ) );",
    "\treturn radiusWindow / ( lightDistance * lightDistance + " + toGlslFloat(UNREAL_NEAR_FIELD_OFFSET) + " );",
    "}",
    "float " + THREE_FUNCTION_NAME + ATTENUATION_SIGNATURE + " {",
    "\tfloat legacyAttenuation = " + LEGACY_FUNCTION_NAME + "( lightDistance, cutoffDistance, decayExponent );",
    "\tfloat unrealAmount = clamp( " + FALLOFF_BLEND_UNIFORM + ", 0.0, 1.0 );",
    "\tif ( unrealAmount <= 0.0 ) return legacyAttenuation;",
    "\tfloat unrealAttenuation = " + UNREAL_FUNCTION_NAME + "( lightDistance, cutoffDistance );",
    "\treturn mix( legacyAttenuation, unrealAttenuation, unrealAmount );",
    "}",
  ].join("\n");
}


export function rewriteLightsChunk(chunkSource) {
  const source = String(chunkSource || "");
  const found = source.match(LEGACY_DEFINITION_PATTERN);
  if (!found) return null;
  const definitionStart = found.index;
  const head = source.slice(0, definitionStart);
  const tail = source.slice(definitionStart).replace(LEGACY_DEFINITION_PATTERN, "float " + LEGACY_FUNCTION_NAME + "( const");
  return head + buildFalloffGlsl() + "\n" + tail;
}
