import { ACCUMULATION_LIMITS } from "./mlTemporalAccumulationCore.js";
import { HISTORY_REJECTION_LIMITS } from "./mlHistoryRejectionCore.js";
import { LUMINANCE_WEIGHTS, VARIANCE_LIMITS } from "./mlTemporalVarianceCore.js";
import { MAXIMUM_VELOCITY_IN_UV, VELOCITY_DEAD_ZONE_IN_ENCODED_UNITS } from "./mlVelocityEncodingCore.js";

export const MGL_TEMPORAL_FILTER_GLSL_REVISION = 1;


export const TEMPORAL_FILTER_UNIFORM_NAMES = Object.freeze([
  "uMglHistoryDiffuse",
  "uMglHistorySpecular",
  "uMglTemporalVariance",
  "uMglTemporalFrameCount",
]);


export const TEMPORAL_FILTER_INPUT_UNIFORM_NAMES = Object.freeze([
  "uMglSceneDepth",
  "uMglSceneNormal",
  "uMglSceneVelocity",
  "uMglShadedDiffuse",
  "uMglShadedSpecular",
]);


export const TEMPORAL_FILTER_OUTPUT_NAMES = Object.freeze([
  "mglHistoryDiffuseOut",
  "mglHistorySpecularOut",
  "mglTemporalVarianceOut",
]);

export const HISTORY_GEOMETRY_SOURCES = Object.freeze({

  currentFrameAtTheTap: "currentFrameAtTheTap",

  previousFrameTexel: "previousFrameTexel",
});

const GLSL_FLOAT_DECIMALS = 8;

function glslFloat(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error("mlTemporalFilterGlsl: refusing to write a non finite constant into the shader");
  }
  return number.toFixed(GLSL_FLOAT_DECIMALS);
}


export function temporalFilterConstants() {
  return [
    `const float MGL_MAXIMUM_HISTORY_FRAME_COUNT = ${glslFloat(ACCUMULATION_LIMITS.maximumHistoryFrameCount)};`,
    `const float MGL_MINIMUM_BLEND_WEIGHT = ${glslFloat(ACCUMULATION_LIMITS.minimumBlendWeight)};`,
    `const float MGL_MAXIMUM_VELOCITY_IN_UV = ${glslFloat(MAXIMUM_VELOCITY_IN_UV)};`,
    `const float MGL_VELOCITY_DEAD_ZONE = ${glslFloat(VELOCITY_DEAD_ZONE_IN_ENCODED_UNITS)};`,
    `const float MGL_RELATIVE_DEPTH_TOLERANCE = ${glslFloat(HISTORY_REJECTION_LIMITS.relativeDepthTolerance)};`,
    `const float MGL_MINIMUM_NORMAL_COSINE = ${glslFloat(HISTORY_REJECTION_LIMITS.minimumNormalCosine)};`,
    `const float MGL_MINIMUM_ACCEPTED_TAP_WEIGHT = ${glslFloat(HISTORY_REJECTION_LIMITS.minimumAcceptedTapWeight)};`,
    `const vec3 MGL_LUMINANCE_WEIGHTS = vec3(${glslFloat(LUMINANCE_WEIGHTS.red)}, ${glslFloat(LUMINANCE_WEIGHTS.green)}, ${glslFloat(LUMINANCE_WEIGHTS.blue)});`,
    `const float MGL_RELATIVE_VARIANCE_FLOOR = ${glslFloat(VARIANCE_LIMITS.relativeVarianceFloor)};`,
    "const ivec2 MGL_BILINEAR_OFFSETS[4] = ivec2[4](ivec2(0, 0), ivec2(1, 0), ivec2(0, 1), ivec2(1, 1));",
  ].join("\n");
}

export function temporalFilterUniformDeclarations() {
  return [
    "uniform sampler2D uMglSceneDepth;",
    "uniform sampler2D uMglSceneNormal;",
    "uniform sampler2D uMglSceneVelocity;",
    "uniform sampler2D uMglShadedDiffuse;",
    "uniform sampler2D uMglShadedSpecular;",
    "uniform sampler2D uMglHistoryDiffuse;",
    "uniform sampler2D uMglHistorySpecular;",
    "uniform sampler2D uMglTemporalVariance;",
    "uniform int uMglTemporalFrameCount;",
  ].join("\n");
}






export function temporalFilterFunctions() {
  return [
    "float mglLuminance(vec3 radiance) {",
    "  return dot(radiance, MGL_LUMINANCE_WEIGHTS);",
    "}",
    "",
    "vec2 mglDecodeScreenVelocity(vec2 encodedVelocity) {",
    "  vec2 centred = clamp(encodedVelocity, 0.0, 1.0) - 0.5;",
    "  // UNORM8 dead zone. The two codes closest to zero are 127/255 and 128/255",
    "  // and NEITHER of them is zero: without this, a pixel that never moved",
    "  // reprojects almost two pixels away at 1920 wide, failing the 0.1 px gate",
    "  // of this phase by a factor of nineteen. step(|c|, dead) mirrors the <=",
    "  // of the core: the boundary code is inside the dead zone, not outside it.",
    "  vec2 outsideDeadZone = vec2(1.0) - step(abs(centred), vec2(MGL_VELOCITY_DEAD_ZONE));",
    "  centred *= outsideDeadZone;",
    "  return centred * 2.0 * MGL_MAXIMUM_VELOCITY_IN_UV;",
    "}",
    "",
    "vec2 mglPreviousPixelCentre(ivec2 pixel, vec2 frameSize, vec2 velocityInUv) {",
    "  // Half texel in, half texel out. Dropping either half is a permanent",
    "  // 0.5 px bias on every static pixel - five times the gate of this phase.",
    "  vec2 uv = (vec2(pixel) + 0.5) / frameSize;",
    "  return (uv - velocityInUv) * frameSize - 0.5;",
    "}",
    "",
    "float mglRelativeDepthDifference(float currentDepth, float historyDepth) {",
    "  // Relative, never absolute: the same tolerance has to hold at 30 cm and",
    "  // at 300 m, so the difference is divided by the LARGER of the two depths.",
    "  // The 1e-6 floor mirrors the inline floor of relativeDepthDifference in",
    "  // mlHistoryRejectionCore.js, which does not export it. The spec compares",
    "  // the two by transcription, so the mirror cannot drift from the core.",
    "  float scale = max(max(abs(currentDepth), abs(historyDepth)), 0.00000100);",
    "  return abs(currentDepth - historyDepth) / scale;",
    "}",
    "",
    "float mglAcceptedTapWeight(float bilinearWeight, float currentDepth, vec3 currentNormal, float tapDepth, vec3 tapNormal, float tapFrameCount) {",
    "  if (bilinearWeight <= MGL_MINIMUM_ACCEPTED_TAP_WEIGHT) return 0.0;",
    "  if (tapFrameCount <= 0.0) return 0.0;",
    "  if (mglRelativeDepthDifference(currentDepth, tapDepth) > MGL_RELATIVE_DEPTH_TOLERANCE) return 0.0;",
    "  if (dot(normalize(currentNormal), normalize(tapNormal)) < MGL_MINIMUM_NORMAL_COSINE) return 0.0;",
    "  return bilinearWeight;",
    "}",
    "",
    "float mglHistoryFrameCeiling() {",
    "  return min(MGL_MAXIMUM_HISTORY_FRAME_COUNT, float(uMglTemporalFrameCount));",
    "}",
    "",
    "float mglBlendWeight(float historyFrameCount, bool historyAccepted) {",
    "  // No history means the current sample IS the answer, weight 1. Anything",
    "  // less would blend against a buffer this pixel has no right to.",
    "  if (!historyAccepted) return 1.0;",
    "  float clamped = clamp(historyFrameCount, 0.0, mglHistoryFrameCeiling());",
    "  return max(MGL_MINIMUM_BLEND_WEIGHT, 1.0 / (clamped + 1.0));",
    "}",
    "",
    "float mglSecondMomentFromVariance(float variance, float meanLuminance) {",
    "  // The channel the frozen layout does not have, recovered exactly.",
    "  return max(0.0, variance) + meanLuminance * meanLuminance;",
    "}",
    "",
    "float mglVarianceFromMoments(float firstMoment, float secondMoment) {",
    "  // The argument order mirrors varianceFromMoments(firstMoment,",
    "  // secondMoment) in mlTemporalVarianceCore.js on purpose: same name, same",
    "  // order. Two functions that share a name and swap their arguments are a",
    "  // trap for whoever transcribes the next phase.",
    "  return max(0.0, secondMoment - firstMoment * firstMoment);",
    "}",
    "",
    "float mglRelativeVariance(float variance, float meanLuminance) {",
    "  // Exported for ML-F21 so the two phases cannot disagree about what",
    "  // \"relative variance\" means. Absolute variance on a strong specular",
    "  // highlight is a false positive by construction: the same 1% of noise is",
    "  // a variance of 4 at luminance 200 and of 4e-6 at luminance 0.2.",
    "  float squaredMean = max(meanLuminance * meanLuminance, MGL_RELATIVE_VARIANCE_FLOOR);",
    "  return max(0.0, variance) / squaredMean;",
    "}",
  ].join("\n");
}

export function buildTemporalFilterVertexShader() {
  return [
    "// No varying on purpose: this pass is texel to texel, so the fragment stage",
    "// addresses its inputs with gl_FragCoord and texelFetch. An interpolated uv",
    "// would only add a rounding question that has no right answer.",
    "in vec3 position;",
    "",
    "void main() {",
    "  gl_Position = vec4(position.xy, 0.0, 1.0);",
    "}",
  ].join("\n");
}





export function buildTemporalFilterFragmentShader(options) {
  const settings = options || {};
  const historyGeometrySource = settings.historyGeometrySource || HISTORY_GEOMETRY_SOURCES.currentFrameAtTheTap;
  if (historyGeometrySource === HISTORY_GEOMETRY_SOURCES.previousFrameTexel) {
    throw new Error(
      "mlTemporalFilterGlsl: previousFrameTexel needs a previous-frame geometry channel, and MGL_BUFFERS reserves none - that is an ML-F2 contract change, not a shader option",
    );
  }
  if (historyGeometrySource !== HISTORY_GEOMETRY_SOURCES.currentFrameAtTheTap) {
    throw new Error(`mlTemporalFilterGlsl: unknown historyGeometrySource "${historyGeometrySource}"`);
  }

  return [
    "precision highp float;",
    "precision highp int;",
    "precision highp sampler2D;",
    "",
    temporalFilterUniformDeclarations(),
    "",
    temporalFilterConstants(),
    "",
    "layout(location = 0) out vec4 mglHistoryDiffuseOut;",
    "layout(location = 1) out vec4 mglHistorySpecularOut;",
    "layout(location = 2) out vec4 mglTemporalVarianceOut;",
    "",
    temporalFilterFunctions(),
    "",
    "void main() {",
    "  ivec2 pixel = ivec2(gl_FragCoord.xy);",
    "  vec2 frameSize = vec2(textureSize(uMglShadedDiffuse, 0));",
    "  ivec2 lastPixel = ivec2(frameSize) - ivec2(1);",
    "",
    "  vec3 currentDiffuse = texelFetch(uMglShadedDiffuse, pixel, 0).rgb;",
    "  vec3 currentSpecular = texelFetch(uMglShadedSpecular, pixel, 0).rgb;",
    "  float currentDepth = texelFetch(uMglSceneDepth, pixel, 0).r;",
    "  vec3 currentNormal = texelFetch(uMglSceneNormal, pixel, 0).xyz * 2.0 - 1.0;",
    "",
    "  vec2 velocityInUv = mglDecodeScreenVelocity(texelFetch(uMglSceneVelocity, pixel, 0).rg);",
    "  vec2 previousPixelCentre = mglPreviousPixelCentre(pixel, frameSize, velocityInUv);",
    "  ivec2 basePixel = ivec2(floor(previousPixelCentre));",
    "  vec2 tapFraction = previousPixelCentre - vec2(basePixel);",
    "",
    "  vec3 historyDiffuse = vec3(0.0);",
    "  vec3 historySpecular = vec3(0.0);",
    "  float historyDiffuseVariance = 0.0;",
    "  float historySpecularVariance = 0.0;",
    "  float historyFrameCount = 0.0;",
    "  float acceptedWeightSum = 0.0;",
    "",
    "  for (int tapIndex = 0; tapIndex < 4; tapIndex++) {",
    "    ivec2 tapOffset = MGL_BILINEAR_OFFSETS[tapIndex];",
    "    ivec2 tapPixel = basePixel + tapOffset;",
    "    if (tapPixel.x < 0 || tapPixel.y < 0 || tapPixel.x > lastPixel.x || tapPixel.y > lastPixel.y) continue;",
    "",
    "    vec2 axisWeights = mix(vec2(1.0) - tapFraction, tapFraction, vec2(tapOffset));",
    "    float bilinearWeight = axisWeights.x * axisWeights.y;",
    "",
    "    vec4 tapDiffuse = texelFetch(uMglHistoryDiffuse, tapPixel, 0);",
    "    vec4 tapSpecular = texelFetch(uMglHistorySpecular, tapPixel, 0);",
    "    vec2 tapVariance = texelFetch(uMglTemporalVariance, tapPixel, 0).rg;",
    "    // DECLARED RESIDUAL: current frame geometry at the reprojected tap. See",
    "    // the header - the previous frame geometry has no reserved channel.",
    "    float tapDepth = texelFetch(uMglSceneDepth, tapPixel, 0).r;",
    "    vec3 tapNormal = texelFetch(uMglSceneNormal, tapPixel, 0).xyz * 2.0 - 1.0;",
    "",
    "    float weight = mglAcceptedTapWeight(bilinearWeight, currentDepth, currentNormal, tapDepth, tapNormal, tapDiffuse.a);",
    "    if (weight <= 0.0) continue;",
    "",
    "    acceptedWeightSum += weight;",
    "    historyDiffuse += tapDiffuse.rgb * weight;",
    "    historySpecular += tapSpecular.rgb * weight;",
    "    historyDiffuseVariance += tapVariance.r * weight;",
    "    historySpecularVariance += tapVariance.g * weight;",
    "    historyFrameCount += tapDiffuse.a * weight;",
    "  }",
    "",
    "  bool historyAccepted = acceptedWeightSum > MGL_MINIMUM_ACCEPTED_TAP_WEIGHT;",
    "  if (historyAccepted) {",
    "    // RENORMALISE by the accepted weight, never by 1.0. A rejected tap must",
    "    // cost the pixel its HISTORY, not its ENERGY: dividing by the full",
    "    // bilinear sum is the dark fringe on every silhouette, and no gate on",
    "    // the mean image ever catches it.",
    "    float inverseWeightSum = 1.0 / acceptedWeightSum;",
    "    historyDiffuse *= inverseWeightSum;",
    "    historySpecular *= inverseWeightSum;",
    "    historyDiffuseVariance *= inverseWeightSum;",
    "    historySpecularVariance *= inverseWeightSum;",
    "    historyFrameCount *= inverseWeightSum;",
    "  } else {",
    "    historyDiffuse = vec3(0.0);",
    "    historySpecular = vec3(0.0);",
    "    historyDiffuseVariance = 0.0;",
    "    historySpecularVariance = 0.0;",
    "    historyFrameCount = 0.0;",
    "  }",
    "",
    "  float blendWeight = mglBlendWeight(historyFrameCount, historyAccepted);",
    "  vec3 resolvedDiffuse = mix(historyDiffuse, currentDiffuse, blendWeight);",
    "  vec3 resolvedSpecular = mix(historySpecular, currentSpecular, blendWeight);",
    "",
    "  float currentDiffuseLuminance = mglLuminance(currentDiffuse);",
    "  float currentSpecularLuminance = mglLuminance(currentSpecular);",
    "  float historyDiffuseSecondMoment = mglSecondMomentFromVariance(historyDiffuseVariance, mglLuminance(historyDiffuse));",
    "  float historySpecularSecondMoment = mglSecondMomentFromVariance(historySpecularVariance, mglLuminance(historySpecular));",
    "  float diffuseSecondMoment = mix(historyDiffuseSecondMoment, currentDiffuseLuminance * currentDiffuseLuminance, blendWeight);",
    "  float specularSecondMoment = mix(historySpecularSecondMoment, currentSpecularLuminance * currentSpecularLuminance, blendWeight);",
    "",
    "  // ABSOLUTE variance goes to the buffer, because that is what the frozen",
    "  // layout names. ML-F21 divides it by luminance(history)^2 with",
    "  // mglRelativeVariance above - every term of that division is already in",
    "  // the buffers it samples, and renaming a frozen channel to store the",
    "  // ratio instead would be a contract change disguised as a shader detail.",
    "  float diffuseVariance = mglVarianceFromMoments(mglLuminance(resolvedDiffuse), diffuseSecondMoment);",
    "  float specularVariance = mglVarianceFromMoments(mglLuminance(resolvedSpecular), specularSecondMoment);",
    "",
    "  float nextFrameCount = historyAccepted",
    "    ? min(floor(historyFrameCount) + 1.0, mglHistoryFrameCeiling())",
    "    : 1.0;",
    "",
    "  // Alpha carries the history LENGTH, never a flag: that is the frozen",
    "  // meaning of the channel, and the blend weight of the next frame is",
    "  // computed from it.",
    "  mglHistoryDiffuseOut = vec4(resolvedDiffuse, nextFrameCount);",
    "  mglHistorySpecularOut = vec4(resolvedSpecular, nextFrameCount);",
    "  mglTemporalVarianceOut = vec4(diffuseVariance, specularVariance, 0.0, 0.0);",
    "}",
  ].join("\n");
}
