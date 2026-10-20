import { EDGE_STOPPING_DEFAULTS } from "./mlUpsampleEdgeWeightCore.js";

export const MGL_UPSAMPLE_GLSL_REVISION = 1;


export const STOCHASTIC_UPSAMPLE_UNIFORM_NAMES = Object.freeze([
  "uMglUpsampleDepthWeight",
  "uMglUpsampleNormalWeight",
]);


export const STOCHASTIC_UPSAMPLE_INPUT_UNIFORM_NAMES = Object.freeze([
  "uMglSceneDepth",
  "uMglSceneNormal",
  "uMglShadedDiffuse",
  "uMglShadedSpecular",
  "uMglHistoryDiffuse",
  "uMglHistorySpecular",
  "uMglBlueNoise",
  "uMglDownsampleFactor",
]);


export const UPSAMPLE_SOURCE_CODE = Object.freeze({
  downsampledNeighbor: 0,
  history: 1,
  nearestNeighborLastResort: 2,
  hole: 3,
});

export function stochasticUpsampleUniformDeclarations() {
  return [
    "uniform float uMglUpsampleDepthWeight;",
    "uniform float uMglUpsampleNormalWeight;",
    "uniform float uMglDownsampleFactor;",
    "uniform highp sampler2D uMglSceneDepth;",
    "uniform highp sampler2D uMglSceneNormal;",
    "uniform highp sampler2D uMglShadedDiffuse;",
    "uniform highp sampler2D uMglShadedSpecular;",
    "uniform highp sampler2D uMglHistoryDiffuse;",
    "uniform highp sampler2D uMglHistorySpecular;",
    "uniform highp sampler2D uMglBlueNoise;",
  ].join("\n");
}

export function stochasticUpsampleFunctions() {
  const minimumSimilarity = EDGE_STOPPING_DEFAULTS.minimumSimilarity.toFixed(6);
  return [
    "const float MGL_UPSAMPLE_EPSILON = 1e-6;",
    "const float MGL_UPSAMPLE_MINIMUM_SIMILARITY = " + minimumSimilarity + ";",
    "const int MGL_UPSAMPLE_SOURCE_NEIGHBOR = " + UPSAMPLE_SOURCE_CODE.downsampledNeighbor + ";",
    "const int MGL_UPSAMPLE_SOURCE_HISTORY = " + UPSAMPLE_SOURCE_CODE.history + ";",
    "const int MGL_UPSAMPLE_SOURCE_NEAREST = " + UPSAMPLE_SOURCE_CODE.nearestNeighborLastResort + ";",
    "const int MGL_UPSAMPLE_SOURCE_HOLE = " + UPSAMPLE_SOURCE_CODE.hole + ";",
    "",
    "float mglUpsampleRelativeDepthDifference(float centerDepth, float neighborDepth) {",
    "  float scale = max(max(abs(centerDepth), abs(neighborDepth)), MGL_UPSAMPLE_EPSILON);",
    "  return abs(centerDepth - neighborDepth) / scale;",
    "}",
    "",
    "float mglUpsampleDepthSimilarity(float centerDepth, float neighborDepth) {",
    "  float relativeDifference = mglUpsampleRelativeDepthDifference(centerDepth, neighborDepth);",
    "  return exp(-relativeDifference * max(0.0, uMglUpsampleDepthWeight));",
    "}",
    "",
    "float mglUpsampleNormalSimilarity(vec3 centerNormal, vec3 neighborNormal) {",
    "  float cosine = max(0.0, dot(normalize(centerNormal), normalize(neighborNormal)));",
    "  return pow(cosine, max(0.0, uMglUpsampleNormalWeight));",
    "}",
    "",
    "// Returns 0.0 for a REJECTED tap: no depth or normal evidence, no weight.",
    "float mglUpsampleEdgeWeight(float centerDepth, vec3 centerNormal, float neighborDepth, vec3 neighborNormal) {",
    "  float depthSimilarity = mglUpsampleDepthSimilarity(centerDepth, neighborDepth);",
    "  float normalSimilarity = mglUpsampleNormalSimilarity(centerNormal, neighborNormal);",
    "  float acceptedDepth = step(MGL_UPSAMPLE_MINIMUM_SIMILARITY, depthSimilarity);",
    "  float acceptedNormal = step(MGL_UPSAMPLE_MINIMUM_SIMILARITY, normalSimilarity);",
    "  return depthSimilarity * normalSimilarity * acceptedDepth * acceptedNormal;",
    "}",
    "",
    "int mglHeaviestUpsampleTap(float weights[4]) {",
    "  int bestIndex = 0;",
    "  float bestWeight = weights[0];",
    "  for (int index = 1; index != 4; index++) {",
    "    if (weights[index] > bestWeight) {",
    "      bestWeight = weights[index];",
    "      bestIndex = index;",
    "    }",
    "  }",
    "  return bestIndex;",
    "}",
    "",
    "// Inverse cumulative walk. A tap with weight 0 can never win: the strict",
    "// comparison makes the rejection of the edge weight final.",
    "int mglSelectStochasticUpsampleTap(float weights[4], float randomValue, out float chosenProbability) {",
    "  chosenProbability = 0.0;",
    "  float weightSum = 0.0;",
    "  for (int index = 0; index != 4; index++) {",
    "    weightSum += weights[index];",
    "  }",
    "  if (MGL_UPSAMPLE_EPSILON > weightSum) {",
    "    return -1;",
    "  }",
    "  float target = clamp(randomValue, 0.0, 0.999999) * weightSum;",
    "  float cumulative = 0.0;",
    "  int chosenIndex = -1;",
    "  for (int index = 0; index != 4; index++) {",
    "    cumulative += weights[index];",
    "    if (chosenIndex == -1 && cumulative > target) {",
    "      chosenIndex = index;",
    "    }",
    "  }",
    "  if (chosenIndex == -1) {",
    "    return -1;",
    "  }",
    "  chosenProbability = weights[chosenIndex] / weightSum;",
    "  return chosenIndex;",
    "}",
  ].join("\n");
}


export function buildStochasticUpsampleVertexShader() {
  return [
    "precision highp float;",
    "in vec3 position;",
    "out vec2 vMglUpsampleUv;",
    "void main() {",
    "  vMglUpsampleUv = position.xy * 0.5 + 0.5;",
    "  gl_Position = vec4(position.xy, 0.0, 1.0);",
    "}",
  ].join("\n");
}





export function buildStochasticUpsampleFragmentShader(options) {
  const settings = options || {};
  const writeSpecular = settings.writeSpecular !== false;
  const lines = [
    "precision highp float;",
    "precision highp int;",
    "",
    "in vec2 vMglUpsampleUv;",
    "",
    "layout(location = 0) out vec4 mglUpsampledDiffuse;",
  ];
  if (writeSpecular) lines.push("layout(location = 1) out vec4 mglUpsampledSpecular;");
  lines.push(
    "",
    stochasticUpsampleUniformDeclarations(),
    "",
    stochasticUpsampleFunctions(),
    "",
    "void main() {",
    "  ivec2 fullSize = textureSize(uMglSceneDepth, 0);",
    "  ivec2 downsampledSize = textureSize(uMglShadedDiffuse, 0);",
    "  ivec2 fullPixel = clamp(ivec2(vMglUpsampleUv * vec2(fullSize)), ivec2(0), fullSize - ivec2(1));",
    "  int downsampleFactor = int(max(1.0, uMglDownsampleFactor));",
    "",
    "  float centerDepth = texelFetch(uMglSceneDepth, fullPixel, 0).r;",
    "  vec3 centerNormal = texelFetch(uMglSceneNormal, fullPixel, 0).rgb;",
    "",
    "  // Same half texel shift as mlUpsampleNeighborhoodCore.js.",
    "  vec2 sampleSpace = (vec2(fullPixel) + 0.5) / float(downsampleFactor) - 0.5;",
    "  vec2 basePixel = floor(sampleSpace);",
    "  vec2 fraction = sampleSpace - basePixel;",
    "",
    "  float bilinearWeights[4];",
    "  bilinearWeights[0] = (1.0 - fraction.x) * (1.0 - fraction.y);",
    "  bilinearWeights[1] = fraction.x * (1.0 - fraction.y);",
    "  bilinearWeights[2] = (1.0 - fraction.x) * fraction.y;",
    "  bilinearWeights[3] = fraction.x * fraction.y;",
    "",
    "  ivec2 tapPixels[4];",
    "  float weights[4];",
    "  for (int index = 0; index != 4; index++) {",
    "    ivec2 offset = ivec2(index == 1 || index == 3 ? 1 : 0, index >= 2 ? 1 : 0);",
    "    ivec2 tapPixel = clamp(ivec2(basePixel) + offset, ivec2(0), downsampledSize - ivec2(1));",
    "    tapPixels[index] = tapPixel;",
    "    ivec2 tapFullPixel = clamp(",
    "      tapPixel * downsampleFactor + ivec2(downsampleFactor / 2),",
    "      ivec2(0),",
    "      fullSize - ivec2(1)",
    "    );",
    "    float tapDepth = texelFetch(uMglSceneDepth, tapFullPixel, 0).r;",
    "    vec3 tapNormal = texelFetch(uMglSceneNormal, tapFullPixel, 0).rgb;",
    "    weights[index] = bilinearWeights[index] * mglUpsampleEdgeWeight(centerDepth, centerNormal, tapDepth, tapNormal);",
    "  }",
    "",
    "  ivec2 noiseSize = textureSize(uMglBlueNoise, 0);",
    "  float randomValue = texelFetch(uMglBlueNoise, fullPixel % noiseSize, 0).r;",
    "  float chosenProbability = 0.0;",
    "  int chosenIndex = mglSelectStochasticUpsampleTap(weights, randomValue, chosenProbability);",
    "",
    "  vec4 historyDiffuse = texelFetch(uMglHistoryDiffuse, fullPixel, 0);",
    "  vec4 historySpecular = texelFetch(uMglHistorySpecular, fullPixel, 0);",
    "",
    "  int source = MGL_UPSAMPLE_SOURCE_NEIGHBOR;",
    "  vec3 diffuse = vec3(0.0);",
    "  vec3 specular = vec3(0.0);",
    "  if (chosenIndex == -1) {",
    "    // Every tap was rejected: reuse the history of THIS pixel, which is the",
    "    // only value that belongs to this surface.",
    "    if (historyDiffuse.a > 0.0) {",
    "      source = MGL_UPSAMPLE_SOURCE_HISTORY;",
    "      diffuse = historyDiffuse.rgb;",
    "      specular = historySpecular.rgb;",
    "    } else {",
    "      // No history yet (first frames, or a disoccluded pixel). The nearest",
    "      // tap keeps the pixel filled and is counted apart, because it is the",
    "      // one path that can leak by one downsampled texel.",
    "      source = MGL_UPSAMPLE_SOURCE_NEAREST;",
    "      ivec2 nearestPixel = tapPixels[mglHeaviestUpsampleTap(bilinearWeights)];",
    "      diffuse = texelFetch(uMglShadedDiffuse, nearestPixel, 0).rgb;",
    "      specular = texelFetch(uMglShadedSpecular, nearestPixel, 0).rgb;",
    "    }",
    "  } else {",
    "    diffuse = texelFetch(uMglShadedDiffuse, tapPixels[chosenIndex], 0).rgb;",
    "    specular = texelFetch(uMglShadedSpecular, tapPixels[chosenIndex], 0).rgb;",
    "  }",
    "",
    "  // Alpha carries the counter: 0 tap, 1 history, 2 nearest, 3 hole.",
    "  mglUpsampledDiffuse = vec4(diffuse, float(source));",
  );
  if (writeSpecular) lines.push("  mglUpsampledSpecular = vec4(specular, chosenProbability);");
  lines.push("}");
  return lines.join("\n");
}
