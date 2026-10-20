import { traceResultIndexOf } from "./mlSampleShadingCore.js";
import { MGL_TRACE_RESULT } from "./mlPipelineContract.js";
import { LAMBERT_DIFFUSE_WITHOUT_ALBEDO, MINIMUM_ROUGHNESS } from "./mlMicrofacetBrdfCore.js";

export const SAMPLE_SHADING_OUTPUT_LOCATIONS = Object.freeze({
  shadedDiffuse: 0,
  shadedSpecular: 1,
});


export const ROUGHNESS_SOURCE = Object.freeze({
  uniform: "uMglSceneNormal",
  channel: "a",
  contractSaysInstead: "sceneAlbedoRoughness.a",
});

export const SAMPLE_RESOLVER_REFUSAL_MARKER = "MGL_SAMPLE_RESOLVER_NOT_PROVIDED";
export const OCCLUDED_SAMPLE_GUARD_MARKER = "MGL_SKIP_SAMPLE_THAT_IS_NOT_VISIBLE";

const BASE_UNIFORM_DECLARATIONS = Object.freeze([
  { type: "sampler2D", name: "uMglSceneDepth" },
  { type: "sampler2D", name: "uMglSceneNormal" },
  { type: "sampler2D", name: "uMglLightSamples" },
  { type: "sampler2D", name: "uMglSampleVisibility" },
  { type: "int", name: "uMglSamplesPerPixel" },
  { type: "float", name: "uMglDownsampleFactor" },
  { type: "vec2", name: "uMglRenderResolution" },
]);

const PACKED_LIGHTS_UNIFORM = Object.freeze({ type: "sampler2D", name: "uMglPackedLights" });

function uniformDeclarationsFor(options) {
  const declarations = BASE_UNIFORM_DECLARATIONS.slice();


  if (options && options.lightSampleResolverGlsl) declarations.push(PACKED_LIGHTS_UNIFORM);
  return declarations;
}

export function sampleShadingUniformNames(options) {
  return uniformDeclarationsFor(options).map((declaration) => declaration.name);
}

function refusingLightSampleResolver() {
  return [
    "// " + SAMPLE_RESOLVER_REFUSAL_MARKER + ": ML-F7 and ML-F11 own the conversion",
    "// from a packed sample into a direction and a radiance. Until they land",
    "// this program writes ZERO instead of inventing a point light.",
    "bool mglResolveLightSample(vec4 packedSample, out vec3 sampleRadiance, out vec3 sampleDirection, out float probabilityDensity) {",
    "  sampleRadiance = vec3(0.0);",
    "  sampleDirection = vec3(0.0, 0.0, 1.0);",
    "  probabilityDensity = 0.0;",
    "  return false;",
    "}",
  ].join("\n");
}

function brdfHelpers() {
  return [
    "float mglClampCosine(float value) {",
    "  return clamp(value, 0.0, 1.0);",
    "}",
    "",
    "float mglAlphaFromRoughness(float roughness) {",
    "  float clampedRoughness = clamp(roughness, MGL_MINIMUM_ROUGHNESS, 1.0);",
    "  return clampedRoughness * clampedRoughness;",
    "}",
    "",
    "float mglGgxNormalDistribution(float roughness, float cosineHalfAngle) {",
    "  float alpha = mglAlphaFromRoughness(roughness);",
    "  float alphaSquared = alpha * alpha;",
    "  float cosine = mglClampCosine(cosineHalfAngle);",
    "  float denominator = cosine * cosine * (alphaSquared - 1.0) + 1.0;",
    "  if (denominator <= 0.0) return 0.0;",
    "  return alphaSquared / (3.14159265 * denominator * denominator);",
    "}",
    "",
    "// Height correlated Smith visibility, with 1/(4 NdotL NdotV) already inside.",
    "float mglSmithVisibility(float roughness, float cosineViewAngle, float cosineLightAngle) {",
    "  float alpha = mglAlphaFromRoughness(roughness);",
    "  float alphaSquared = alpha * alpha;",
    "  float cosineView = mglClampCosine(cosineViewAngle);",
    "  float cosineLight = mglClampCosine(cosineLightAngle);",
    "  if (cosineView <= MGL_MINIMUM_COSINE || cosineLight <= MGL_MINIMUM_COSINE) return 0.0;",
    "  float viewTerm = cosineLight * sqrt(cosineView * cosineView * (1.0 - alphaSquared) + alphaSquared);",
    "  float lightTerm = cosineView * sqrt(cosineLight * cosineLight * (1.0 - alphaSquared) + alphaSquared);",
    "  float sum = viewTerm + lightTerm;",
    "  return sum > 0.0 ? 0.5 / sum : 0.0;",
    "}",
    "",
    "// The sample buffer of ML-F11 is addressed as one row of samplesPerPixel",
    "// texels per downsampled pixel. This is the SINGLE place that writes the",
    "// addressing down, so ML-F11 has one line to correct instead of a hunt.",
    "ivec2 mglSampleTexel(ivec2 downsampledPixel, int sampleIndex) {",
    "  return ivec2(downsampledPixel.x * uMglSamplesPerPixel + sampleIndex, downsampledPixel.y);",
    "}",
    "",
    "vec3 mglViewDirectionAt(vec2 screenUv) {",
    "  vec2 normalizedDeviceXy = screenUv * 2.0 - 1.0;",
    "  vec3 viewRay = vec3(normalizedDeviceXy * MGL_VIEW_RAY_SCALE, -1.0);",
    "  return normalize(-viewRay);",
    "}",
  ].join("\n");
}

function shadingMain() {
  return [
    "void main() {",
    "  ivec2 downsampledPixel = ivec2(gl_FragCoord.xy);",
    "  vec2 screenUv = (gl_FragCoord.xy * max(uMglDownsampleFactor, 1.0)) / max(uMglRenderResolution, vec2(1.0));",
    "  vec4 depthTexel = texture(uMglSceneDepth, screenUv);",
    "  vec4 normalTexel = texture(uMglSceneNormal, screenUv);",
    "",
    "  // Coverage 0 is the sky. Shading it would light up the background, which",
    "  // is the classic deferred mistake.",
    "  if (depthTexel.a < 0.5) {",
    "    outMglShadedDiffuse = vec4(0.0);",
    "    outMglShadedSpecular = vec4(0.0);",
    "    return;",
    "  }",
    "",
    "  vec3 surfaceNormal = normalize(normalTexel.rgb * 2.0 - 1.0);",
    "  float roughness = normalTexel." + ROUGHNESS_SOURCE.channel + ";",
    "  vec3 viewDirection = mglViewDirectionAt(screenUv);",
    "  float cosineViewAngle = mglClampCosine(dot(surfaceNormal, viewDirection));",
    "",
    "  vec3 diffuseRadiance = vec3(0.0);",
    "  vec3 specularRadiance = vec3(0.0);",
    "  float weightSum = 0.0;",
    "  // The divisor is the budget that was DRAWN, never the samples that",
    "  // survived: dividing by the survivors would make a shadowed pixel as",
    "  // bright as a lit one and shadowing would cost rays for nothing.",
    "  float drawnSampleCount = float(max(uMglSamplesPerPixel, 1));",
    "",
    "  for (int sampleIndex = 0; sampleIndex < uMglSamplesPerPixel; sampleIndex++) {",
    "    ivec2 sampleTexel = mglSampleTexel(downsampledPixel, sampleIndex);",
    "    vec4 visibilityTexel = texelFetch(uMglSampleVisibility, sampleTexel, 0);",
    "    // " + OCCLUDED_SAMPLE_GUARD_MARKER + ": occluded AND unknown leave here,",
    "    // before any BRDF is evaluated, and they stay in the divisor.",
    "    if (abs(visibilityTexel.r - MGL_TRACE_RESULT_VISIBLE) > MGL_TRACE_RESULT_EPSILON) continue;",
    "",
    "    vec4 packedSample = texelFetch(uMglLightSamples, sampleTexel, 0);",
    "    vec3 sampleRadiance;",
    "    vec3 sampleDirection;",
    "    float probabilityDensity;",
    "    if (!mglResolveLightSample(packedSample, sampleRadiance, sampleDirection, probabilityDensity)) continue;",
    "    if (probabilityDensity <= 0.0) continue;",
    "",
    "    float cosineLightAngle = dot(surfaceNormal, sampleDirection);",
    "    if (cosineLightAngle <= 0.0) continue;",
    "",
    "    float reservoirWeight = max(packedSample.g, 0.0);",
    "    if (reservoirWeight <= 0.0) continue;",
    "    float throughput = reservoirWeight / probabilityDensity;",
    "",
    "    vec3 halfVector = normalize(sampleDirection + viewDirection);",
    "    float cosineHalfAngle = mglClampCosine(dot(surfaceNormal, halfVector));",
    "    float specularLobe = mglGgxNormalDistribution(roughness, cosineHalfAngle) *",
    "      mglSmithVisibility(roughness, cosineViewAngle, cosineLightAngle);",
    "",
    "    // No albedo and no Fresnel: both are put back AFTER the denoiser.",
    "    diffuseRadiance += sampleRadiance * (MGL_LAMBERT_WITHOUT_ALBEDO * cosineLightAngle * throughput);",
    "    specularRadiance += sampleRadiance * (specularLobe * cosineLightAngle * throughput);",
    "    weightSum += reservoirWeight;",
    "  }",
    "",
    "  float normalization = 1.0 / drawnSampleCount;",
    "  outMglShadedDiffuse = vec4(diffuseRadiance * normalization, weightSum * normalization);",
    "  outMglShadedSpecular = vec4(specularRadiance * normalization, weightSum * normalization);",
    "}",
  ].join("\n");
}














export function buildSampleShadingFragmentShader(options) {
  const settings = options || {};
  const viewRayScale = settings.viewRayScale || { x: 1, y: 1 };
  const visibleIndex = traceResultIndexOf(MGL_TRACE_RESULT.visible).toFixed(1);
  const resolver = settings.lightSampleResolverGlsl || refusingLightSampleResolver();
  const declarations = uniformDeclarationsFor(settings).map(
    (declaration) => "uniform " + declaration.type + " " + declaration.name + ";",
  );

  return ["precision highp float;", ""]
    .concat(declarations)
    .concat([
      "",
      "const float MGL_LAMBERT_WITHOUT_ALBEDO = " + LAMBERT_DIFFUSE_WITHOUT_ALBEDO.toFixed(9) + ";",
      "const float MGL_MINIMUM_ROUGHNESS = " + MINIMUM_ROUGHNESS.toFixed(6) + ";",
      "const float MGL_MINIMUM_COSINE = 1e-6;",
      "const float MGL_TRACE_RESULT_VISIBLE = " + visibleIndex + ";",
      "const float MGL_TRACE_RESULT_EPSILON = 0.25;",
      "const vec2 MGL_VIEW_RAY_SCALE = vec2(" +
        Number(viewRayScale.x).toFixed(6) +
        ", " +
        Number(viewRayScale.y).toFixed(6) +
        ");",
      "",
      "layout(location = " +
        SAMPLE_SHADING_OUTPUT_LOCATIONS.shadedDiffuse +
        ") out vec4 outMglShadedDiffuse;",
      "layout(location = " +
        SAMPLE_SHADING_OUTPUT_LOCATIONS.shadedSpecular +
        ") out vec4 outMglShadedSpecular;",
      "",
    ])
    .concat([brdfHelpers(), "", resolver, "", shadingMain(), ""])
    .join("\n");
}
