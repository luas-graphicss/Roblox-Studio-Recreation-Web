import { FACTORIZATION_FLOOR } from "./mlAlbedoFactorizationCore.js";

export const MGL_COMPOSITION_GLSL_REVISION = "mgl-composition-1";


export const COMPOSITION_SAMPLER_UNIFORM_NAMES = Object.freeze([
  "uMglHistoryDiffuse",
  "uMglHistorySpecular",
]);

export const COMPOSITION_RESOLUTION_UNIFORM_NAME = "uMglRenderResolution";
export const COMPOSITION_CHUNK_NAME = "lights_fragment_begin";
export const COMPOSITION_ANCHOR_NAME = "lightsFragmentBegin";

function glslFloat(value) {
  const asNumber = Number(value);
  const safe = Number.isFinite(asNumber) ? asNumber : 0;
  const text = String(safe);
  return text.indexOf(".") >= 0 || text.indexOf("e") >= 0 ? text : text + ".0";
}


export function buildCompositionDeclarations() {
  return [
    "#define MGL_HISTORY_COMPOSITION_AVAILABLE 1",
    "uniform sampler2D uMglHistoryDiffuse;",
    "uniform sampler2D uMglHistorySpecular;",
    "uniform vec2 uMglRenderResolution;",
    "",
    "vec2 mglCompositionUv() {",
    "  return gl_FragCoord.xy / max( uMglRenderResolution, vec2( 1.0 ) );",
    "}",
    "",
    "vec3 mglEnvBrdfApproximation( vec3 specularColor, float roughness, float cosineViewAngle ) {",
    "  float fitX = -1.0 * roughness + 1.0;",
    "  float fitY = -0.0275 * roughness + 0.0425;",
    "  float fitZ = -0.572 * roughness + 1.04;",
    "  float fitW = 0.022 * roughness + -0.04;",
    "  float term = min( fitX * fitX, exp2( -9.28 * cosineViewAngle ) ) * fitX + fitY;",
    "  float scale = -1.04 * term + fitZ;",
    "  float bias = 1.04 * term + fitW;",
    "  return specularColor * scale + bias;",
    "}",
  ].join("\n");
}


export function resolveShadingIdentifiers(chunkSource) {
  const source = typeof chunkSource === "string" ? chunkSource : "";
  return {
    normal: source.indexOf("geometryNormal") >= 0 ? "geometryNormal" : "normal",
    viewDirection:
      source.indexOf("geometryViewDir") >= 0 ? "geometryViewDir" : "normalize( vViewPosition )",
  };
}


export function appendCompositionToLightsFragmentBegin(chunkSource, options) {
  const settings = options || {};
  const identifiers = resolveShadingIdentifiers(chunkSource);
  const floor = glslFloat(
    settings.factorizationFloor === undefined ? FACTORIZATION_FLOOR : settings.factorizationFloor,
  );

  const composition = [
    "",
    "// --- ML-F18 composition, slot 160 -------------------------------------",
    "// REPLACES the two direct terms three.js just computed. Adding here would",
    "// light every pixel twice; that is the refusal this phase enforces.",
    "#if defined( RE_Direct )",
    "{",
    "  vec2 mglUv = mglCompositionUv();",
    "  vec3 mglDenoisedDiffuse = texture2D( uMglHistoryDiffuse, mglUv ).rgb;",
    "  vec3 mglDenoisedSpecular = texture2D( uMglHistorySpecular, mglUv ).rgb;",
    "  float mglCosineViewAngle = saturate( dot( " + identifiers.normal + ", " + identifiers.viewDirection + " ) );",
    "  // The albedo and the EnvBRDF ML-F18 factored out, multiplied back in at",
    "  // full resolution. The floor keeps a black surface from erasing the",
    "  // signal, so a denoiser bug reads as a wrong colour and not as no image.",
    "  vec3 mglDiffuseFactor = max( material.diffuseColor, vec3( " + floor + " ) );",
    "  vec3 mglSpecularFactor = max(",
    "    mglEnvBrdfApproximation( material.specularColor, material.roughness, mglCosineViewAngle ),",
    "    vec3( " + floor + " )",
    "  );",
    "  reflectedLight.directDiffuse = mglDenoisedDiffuse * mglDiffuseFactor;",
    "  reflectedLight.directSpecular = mglDenoisedSpecular * mglSpecularFactor;",
    "}",
    "#endif",
  ].join("\n");

  return chunkSource + composition;
}


export function describeCompositionGlsl() {
  return {
    revision: MGL_COMPOSITION_GLSL_REVISION,
    anchor: COMPOSITION_ANCHOR_NAME,
    chunk: COMPOSITION_CHUNK_NAME,
    samplerUniforms: COMPOSITION_SAMPLER_UNIFORM_NAMES.slice(),
    resolutionUniform: COMPOSITION_RESOLUTION_UNIFORM_NAME,
    replaces: ["reflectedLight.directDiffuse", "reflectedLight.directSpecular"],
    addsToExistingLighting: false,
    newUniformNamesIntroduced: 0,
    factorizationFloor: FACTORIZATION_FLOOR,
    identifiersAreDiscoveredFromTheChunk: true,
    boundary:
      "it samples the two samplers the contract reserves to ML-F20 (uMglHistoryDiffuse, uMglHistorySpecular, scope lighting): the composition consumes the FILTERED history, so no third sampler and no new texture unit is spent",
  };
}
