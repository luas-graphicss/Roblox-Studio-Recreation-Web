export function buildMegaLightsDepthGlsl() {
  return `
#include <packing>
uniform vec2 uDepthTexel;

float rswUnpack(const in vec4 packedDepth) {
  return unpackRGBAToDepth(packedDepth);
}

vec2 rswDepthGradient(const in vec2 uv, const in float centerDepth) {
  vec2 centerUv = (floor(uv / uDepthTexel) + 0.5) * uDepthTexel;
  float leftDepth = rswUnpack(texture2D(tDepth, centerUv - vec2(uDepthTexel.x, 0.0)));
  float rightDepth = rswUnpack(texture2D(tDepth, centerUv + vec2(uDepthTexel.x, 0.0)));
  float bottomDepth = rswUnpack(texture2D(tDepth, centerUv - vec2(0.0, uDepthTexel.y)));
  float topDepth = rswUnpack(texture2D(tDepth, centerUv + vec2(0.0, uDepthTexel.y)));
  vec2 backward = vec2(centerDepth - leftDepth, centerDepth - bottomDepth);
  vec2 forward = vec2(rightDepth - centerDepth, topDepth - centerDepth);
  return vec2(
    abs(backward.x) < abs(forward.x) ? backward.x : forward.x,
    abs(backward.y) < abs(forward.y) ? backward.y : forward.y
  );
}

float rswAlignDepth(const in float depth, const in vec2 uv, const in vec2 depthGradient) {
  vec2 pixelOffset = fract(uv / uDepthTexel) - 0.5;
  return depth + dot(depthGradient, pixelOffset);
}

float rswTraceViewZ(const in vec2 uv, const in vec2 depthGradient) {
  vec2 pixelPosition = uv / uDepthTexel;
  vec2 pixelCenter = floor(pixelPosition) + 0.5;
  float sampledDepth = rswUnpack(texture2D(tDepth, pixelCenter * uDepthTexel));
  if (sampledDepth >= 0.9999) return -uFar;
  float alignedDepth = rswAlignDepth(sampledDepth, uv, depthGradient);
  return perspectiveDepthToViewZ(alignedDepth, uNear, uFar);
}
`;
}
