import { MAXIMUM_REDUCTION_TAPS_PER_AXIS } from "./mlHzbCore.js";


export function buildHierarchicalDepthSeedFragmentShader() {
  return [
    "precision highp float;",
    "uniform sampler2D uSceneDepth;",
    "uniform float uFarPlane;",
    "out vec4 outHierarchicalDepth;",
    "void main() {",
    "  vec4 depthTexel = texelFetch(uSceneDepth, ivec2(gl_FragCoord.xy), 0);",
    "  // An uncovered pixel is not depth zero, it is depth INFINITY. Seeding it",
    "  // with the cleared 0 would make the sky the nearest thing in the frame",
    "  // and ML-F5 would cull every cell behind it.",
    "  float linearViewDepth = depthTexel.a >= 0.5 ? depthTexel.r : uFarPlane;",
    "  outHierarchicalDepth = vec4(linearViewDepth, linearViewDepth, 0.0, 1.0);",
    "}",
  ].join("\n");
}


export function buildHierarchicalDepthReductionFragmentShader() {
  const maximumTaps = String(MAXIMUM_REDUCTION_TAPS_PER_AXIS);
  return [
    "precision highp float;",
    "uniform sampler2D uSourceLevel;",
    "uniform vec2 uSourceSize;",
    "uniform vec2 uDestinationSize;",
    "out vec4 outHierarchicalDepth;",
    "void main() {",
    "  vec2 destinationTexel = floor(gl_FragCoord.xy);",
    "  vec2 firstSourceTexel = destinationTexel * 2.0;",
    "  // The last column and the last row absorb the leftover texel of an odd",
    "  // level. Dropping it would make the pyramid optimistic, and an optimistic",
    "  // HZB culls geometry that is really there.",
    "  float lastSourceX = destinationTexel.x >= uDestinationSize.x - 1.0",
    "    ? uSourceSize.x - 1.0",
    "    : min(firstSourceTexel.x + 1.0, uSourceSize.x - 1.0);",
    "  float lastSourceY = destinationTexel.y >= uDestinationSize.y - 1.0",
    "    ? uSourceSize.y - 1.0",
    "    : min(firstSourceTexel.y + 1.0, uSourceSize.y - 1.0);",
    "  float smallestDepth = 3.402823466e38;",
    "  float largestDepth = -3.402823466e38;",
    "  for (int tapY = 0; tapY < " + maximumTaps + "; tapY++) {",
    "    float sourceY = firstSourceTexel.y + float(tapY);",
    "    if (sourceY > lastSourceY) break;",
    "    for (int tapX = 0; tapX < " + maximumTaps + "; tapX++) {",
    "      float sourceX = firstSourceTexel.x + float(tapX);",
    "      if (sourceX > lastSourceX) break;",
    "      vec2 sourceDepthPair = texelFetch(uSourceLevel, ivec2(int(sourceX), int(sourceY)), 0).rg;",
    "      smallestDepth = min(smallestDepth, sourceDepthPair.r);",
    "      largestDepth = max(largestDepth, sourceDepthPair.g);",
    "    }",
    "  }",
    "  outHierarchicalDepth = vec4(smallestDepth, largestDepth, 0.0, 1.0);",
    "}",
  ].join("\n");
}
