import { SPOT_CONE_MIX_UNIFORM } from "./llSpotConeContract.js";


export const SPOT_CONE_CHUNK_NAME = "lights_pars_begin";


export const LEGACY_SPOT_ATTENUATION_GLSL = [
  "float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {",
  "\treturn smoothstep( coneCosine, penumbraCosine, angleCosine );",
  "}",
].join("\n");

export const SPOT_CONE_UNIFORM_DECLARATION_GLSL = "uniform float " + SPOT_CONE_MIX_UNIFORM + ";";


export const MIN_CONE_COSINE_SPAN_GLSL = "0.000001";

export function buildSpotConeAttenuationGlsl() {
  return [
    "float getSpotAttenuation( const in float coneCosine, const in float penumbraCosine, const in float angleCosine ) {",
    "\tfloat legacySpotAttenuation = smoothstep( coneCosine, penumbraCosine, angleCosine );",
    "\tif ( " + SPOT_CONE_MIX_UNIFORM + " <= 0.0 ) return legacySpotAttenuation;",
    "\tfloat coneCosineSpan = max( penumbraCosine - coneCosine, " + MIN_CONE_COSINE_SPAN_GLSL + " );",
    "\tfloat ueConeRamp = clamp( ( angleCosine - coneCosine ) / coneCosineSpan, 0.0, 1.0 );",
    "\tfloat ueSpotAttenuation = ueConeRamp * ueConeRamp;",
    "\tif ( " + SPOT_CONE_MIX_UNIFORM + " >= 1.0 ) return ueSpotAttenuation;",
    "\treturn mix( legacySpotAttenuation, ueSpotAttenuation, " + SPOT_CONE_MIX_UNIFORM + " );",
    "}",
  ].join("\n");
}


export function injectSpotConeAttenuation(chunkSource) {
  const source = typeof chunkSource === "string" ? chunkSource : "";
  if (source.indexOf(SPOT_CONE_UNIFORM_DECLARATION_GLSL) >= 0) {
    return Object.freeze({ source: source, replaced: false, reason: "already-injected" });
  }
  if (source.indexOf(LEGACY_SPOT_ATTENUATION_GLSL) < 0) {
    return Object.freeze({ source: source, replaced: false, reason: "legacy-signature-not-found" });
  }
  const replacement = SPOT_CONE_UNIFORM_DECLARATION_GLSL + "\n" + buildSpotConeAttenuationGlsl();
  return Object.freeze({ source: source.replace(LEGACY_SPOT_ATTENUATION_GLSL, replacement), replaced: true, reason: "" });
}
