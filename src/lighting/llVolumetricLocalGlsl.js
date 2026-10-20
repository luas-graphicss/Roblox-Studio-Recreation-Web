import { VOL_FOG_PASS_VERT, buildVolFogMarchGlsl } from "./volumetricFogCore.js";
import { LOCAL_VOLUMETRIC_MAX_LIGHTS } from "./llVolumetricLocalContract.js";

export const LOCAL_VOLUMETRIC_DECLARATIONS_MARKER = "// LL-F17 local volumetric scattering declarations";
export const LOCAL_VOLUMETRIC_INSCATTER_FUNCTION = "llVolLocalInscatter";
export const LOCAL_VOLUMETRIC_SHADOW_FUNCTION = "llVolLocalShadow";
export const LOCAL_VOLUMETRIC_PASS_VERTEX_GLSL = VOL_FOG_PASS_VERT;


export const VOL_FOG_MARCH_MAIN_ANCHOR = "void main() {";
export const VOL_FOG_SUN_ACCUMULATION_ANCHOR =
  "    acc += (uSunColor * (vis * ph) + uAmbColor) * (T * sigmaT * 0.9 * dt);";
export const VOL_FOG_LEGACY_LOCAL_ACCUMULATION_ANCHOR =
  "    accL += ci.rgb * (ci.a * uDensity * 0.9 * 0.0796 * integ * win);";
export const VOL_FOG_HEIGHT_FALLOFF_LINE =
  "    float hf = exp(-max(sp.y - uHeightRef, 0.0) * uHeightFalloff);";
export const VOL_FOG_TRANSMITTANCE_LINE = "    T *= exp(-sigmaT * dt);";

export const LOCAL_VOLUMETRIC_REWRITE_REFUSAL = Object.freeze({
  ALREADY_REWRITTEN: "already-rewritten",
  MAIN_NOT_FOUND: "march-main-not-found",
  SUN_ACCUMULATION_NOT_UNIQUE: "sun-accumulation-line-not-found-exactly-once",
  LEGACY_LOCAL_NOT_UNIQUE: "legacy-local-accumulation-line-not-found-exactly-once",
});

function countOccurrences(source, needle) {
  let total = 0;
  let index = source.indexOf(needle);
  while (index >= 0) {
    total++;
    index = source.indexOf(needle, index + needle.length);
  }
  return total;
}


function shadowFunctionGlsl(atlasShadowing) {
  if (!atlasShadowing) {
    return [
      "// No atlas declarations in this program: shafts are unshaded on purpose.",
      "float " + LOCAL_VOLUMETRIC_SHADOW_FUNCTION + "(const in float atlasMetaRow, const in vec3 worldSample) {",
      "  return 1.0;",
      "}",
    ];
  }
  return [
    "float " + LOCAL_VOLUMETRIC_SHADOW_FUNCTION + "(const in float atlasMetaRow, const in vec3 worldSample) {",
    "  if (uLlVolLocalAtlasOn <= 0.0) { return 1.0; }",
    "  if (atlasMetaRow < 0.0) { return 1.0; }",
    "  vec3 viewSample = (uLlVolLocalViewMatrix * vec4(worldSample, 1.0)).xyz;",
    "  float visibility = rswSaVis(atlasMetaRow, viewSample);",
    "  if (visibility < 0.0) { return 1.0; }",
    "  return visibility;",
    "}",
  ];
}


export function buildLocalVolumetricDeclarationsGlsl(options) {
  const settings = options || {};
  const maxLights = String(LOCAL_VOLUMETRIC_MAX_LIGHTS);
  return [
    LOCAL_VOLUMETRIC_DECLARATIONS_MARKER,
    "uniform float uLlVolLocalOn;",
    "uniform float uLlVolLocalCount;",
    "uniform float uLlVolLocalAtlasOn;",
    "uniform mat4 uLlVolLocalViewMatrix;",
    "// xyz = world position, w = range in studs",
    "uniform vec4 uLlVolLocalPositionRange[" + maxLights + "];",
    "// rgb = color premultiplied by intensity, a = VolumetricScatteringIntensity",
    "uniform vec4 uLlVolLocalColorScattering[" + maxLights + "];",
    "// xyz = cone axis (light -> target), w = 1 spot / 0 omni",
    "uniform vec4 uLlVolLocalConeAxis[" + maxLights + "];",
    "// x = cos(outer half angle), y = cos(inner half angle), z = atlas meta row",
    "uniform vec4 uLlVolLocalConeCosines[" + maxLights + "];",
    "",
    "// Henyey-Greenstein of the MEDIUM (same uAniso the sun term uses); 12.56637 = 4pi.",
    "// JS mirror: localVolumetricPhase in llVolumetricLocalCore.js.",
    "float llVolLocalPhase(const in float anisotropy, const in float cosViewToLight) {",
    "  float g = clamp(anisotropy, -0.99, 0.99);",
    "  float g2 = g * g;",
    "  float den = 1.0 + g2 - 2.0 * g * cosViewToLight;",
    "  return (1.0 - g2) / (12.56637 * pow(max(den, 1e-4), 1.5));",
    "}",
    "",
    "// UE inverse-square window - the SAME curve LL-F2 gives the surfaces.",
    "float llVolLocalDistanceAttenuation(const in float distanceToLight, const in float range) {",
    "  float rangeWindow = 1.0;",
    "  if (range > 0.0) {",
    "    float normalized = distanceToLight / range;",
    "    float normalizedSquared = normalized * normalized;",
    "    float closing = clamp(1.0 - normalizedSquared * normalizedSquared, 0.0, 1.0);",
    "    rangeWindow = closing * closing;",
    "  }",
    "  return rangeWindow / (distanceToLight * distanceToLight + 1.0);",
    "}",
    "",
    "// LL-F5 cone, evaluated at the froxel sample: squared ramp outer -> inner.",
    "float llVolLocalConeAttenuation(const in vec4 coneAxis, const in vec4 coneCosines, const in vec3 lightToSample) {",
    "  if (coneAxis.w < 0.5) { return 1.0; }",
    "  float cosTheta = dot(coneAxis.xyz, lightToSample);",
    "  float cosineSpan = max(coneCosines.y - coneCosines.x, 1e-6);",
    "  float ramp = clamp((cosTheta - coneCosines.x) / cosineSpan, 0.0, 1.0);",
    "  return ramp * ramp;",
    "}",
    "",
  ]
    .concat(shadowFunctionGlsl(settings.atlasShadowing === true))
    .concat([
      "",
      "// In-scattering of every selected local light at ONE march sample.",
      "// scatterWeight is T * sigmaT * albedo * dt, exactly the weight the sun",
      "// term already carries, so both terms share the medium of the pixel.",
      "vec3 " + LOCAL_VOLUMETRIC_INSCATTER_FUNCTION + "(const in vec3 worldSample, const in vec3 viewRayDirection, const in float scatterWeight) {",
      "  vec3 inscatter = vec3(0.0);",
      "  if (uLlVolLocalOn <= 0.0) { return inscatter; }",
      "  for (int lightIndex = 0; lightIndex < " + maxLights + "; lightIndex++) {",
      "    if (float(lightIndex) >= uLlVolLocalCount) { break; }",
      "    vec4 positionRange = uLlVolLocalPositionRange[lightIndex];",
      "    vec3 sampleToLight = positionRange.xyz - worldSample;",
      "    float distanceToLight = max(length(sampleToLight), 1e-4);",
      "    vec3 directionToLight = sampleToLight / distanceToLight;",
      "    float distanceAttenuation = llVolLocalDistanceAttenuation(distanceToLight, positionRange.w);",
      "    if (distanceAttenuation <= 0.0) { continue; }",
      "    vec4 coneAxis = uLlVolLocalConeAxis[lightIndex];",
      "    vec4 coneCosines = uLlVolLocalConeCosines[lightIndex];",
      "    float coneAttenuation = llVolLocalConeAttenuation(coneAxis, coneCosines, -directionToLight);",
      "    if (coneAttenuation <= 0.0) { continue; }",
      "    float visibility = " + LOCAL_VOLUMETRIC_SHADOW_FUNCTION + "(coneCosines.z, worldSample);",
      "    if (visibility <= 0.0) { continue; }",
      "    float phase = llVolLocalPhase(uAniso, dot(viewRayDirection, directionToLight));",
      "    vec4 colorScattering = uLlVolLocalColorScattering[lightIndex];",
      "    inscatter += colorScattering.rgb * (colorScattering.a * distanceAttenuation * coneAttenuation * visibility * phase);",
      "  }",
      "  return inscatter * (scatterWeight * uLlVolLocalOn);",
      "}",
    ])
    .join("\n");
}


export function rewriteVolumetricFogMarchGlsl(source, options) {
  const settings = options || {};
  const atlasDeclarationsGlsl = typeof settings.atlasDeclarationsGlsl === "string" ? settings.atlasDeclarationsGlsl : "";
  const atlasShadowing = atlasDeclarationsGlsl.length > 0;
  const refuse = (refusal) => ({ ok: false, source, refusal, atlasShadowing: false, injections: [] });
  if (source.indexOf(LOCAL_VOLUMETRIC_DECLARATIONS_MARKER) >= 0) {
    return refuse(LOCAL_VOLUMETRIC_REWRITE_REFUSAL.ALREADY_REWRITTEN);
  }
  if (source.indexOf(VOL_FOG_MARCH_MAIN_ANCHOR) < 0) {
    return refuse(LOCAL_VOLUMETRIC_REWRITE_REFUSAL.MAIN_NOT_FOUND);
  }
  if (countOccurrences(source, VOL_FOG_SUN_ACCUMULATION_ANCHOR) !== 1) {
    return refuse(LOCAL_VOLUMETRIC_REWRITE_REFUSAL.SUN_ACCUMULATION_NOT_UNIQUE);
  }
  if (countOccurrences(source, VOL_FOG_LEGACY_LOCAL_ACCUMULATION_ANCHOR) !== 1) {
    return refuse(LOCAL_VOLUMETRIC_REWRITE_REFUSAL.LEGACY_LOCAL_NOT_UNIQUE);
  }
  const declarations = [atlasDeclarationsGlsl, buildLocalVolumetricDeclarationsGlsl({ atlasShadowing })]
    .filter((block) => block.length > 0)
    .join("\n");
  const inLoopInjection =
    VOL_FOG_SUN_ACCUMULATION_ANCHOR +
    "\n    acc += " +
    LOCAL_VOLUMETRIC_INSCATTER_FUNCTION +
    "(sp, dir, T * sigmaT * 0.9 * dt);";


  const legacyCrossFade =
    "    accL += ci.rgb * ((1.0 - uLlVolLocalOn) * (ci.a * uDensity * 0.9 * 0.0796 * integ * win));";
  const rewritten = source
    .replace(VOL_FOG_MARCH_MAIN_ANCHOR, declarations + "\n" + VOL_FOG_MARCH_MAIN_ANCHOR)
    .replace(VOL_FOG_SUN_ACCUMULATION_ANCHOR, inLoopInjection)
    .replace(VOL_FOG_LEGACY_LOCAL_ACCUMULATION_ANCHOR, legacyCrossFade);
  return {
    ok: true,
    source: rewritten,
    refusal: "",
    atlasShadowing,
    injections: ["declarations", "in-march-local-inscatter", "legacy-analytic-cross-fade"],
  };
}


export function buildLocalVolumetricMarchFragmentGlsl(options) {
  return rewriteVolumetricFogMarchGlsl(buildVolFogMarchGlsl(), options);
}
