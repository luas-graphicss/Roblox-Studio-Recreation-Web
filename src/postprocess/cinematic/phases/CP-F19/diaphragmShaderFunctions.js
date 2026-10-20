export const DIAPHRAGM_SHADER_FUNCTIONS = `
precision highp float;
precision highp sampler2D;
precision highp int;
uniform sampler2D sourceColor;
uniform sampler2D signedCoc;
uniform sampler2D surfaceData;
uniform sampler2D kernelNormalization;
uniform ivec2 sourceSize;
uniform vec2 apertureScale;
uniform float bladeCount;
uniform float bladeCurvature;
uniform float bladeRotation;
uniform vec2 maximumRadius;
uniform int alphaMode;
uniform float focusProtectionRadius;
uniform float depthTolerance;
varying vec2 vUv;

bool insideSource(ivec2 pixel) {
  return all(greaterThanEqual(pixel, ivec2(0))) && all(lessThan(pixel, sourceSize));
}
float footprintWeight(ivec2 offset, float radius) {
  if (radius == 0.0) return all(equal(offset, ivec2(0))) ? 1.0 : 0.0;
  vec2 position = vec2(offset) / apertureScale;
  float distanceFromCenter = length(position);
  if (distanceFromCenter == 0.0) return min(1.0, radius + 0.5);
  float sector = 6.283185307179586 / bladeCount;
  float angle = mod(atan(position.y, position.x) - bladeRotation, sector) - sector * 0.5;
  float polygonRadius = cos(3.141592653589793 / bladeCount) / cos(angle);
  float boundary = mix(polygonRadius, 1.0, bladeCurvature) * radius;
  return clamp(boundary + 0.5 - distanceFromCenter, 0.0, 1.0);
}
bool validInput(ivec2 pixel) {
  vec4 color = texelFetch(sourceColor, pixel, 0);
  vec4 surface = texelFetch(surfaceData, pixel, 0);
  float coc = texelFetch(signedCoc, pixel, 0).r;
  if (any(isnan(color)) || any(isinf(color)) || any(greaterThan(abs(color.rgb), vec3(65504.0)))) return false;
  if (any(isnan(surface)) || any(isinf(surface)) || isnan(coc) || isinf(coc)) return false;
  if (surface.a != 1.0 || surface.g < 0.0 || surface.g > 1.0 || color.a < 0.0 || color.a > 1.0) return false;
  if (surface.b != 0.0 && surface.b != 1.0) return false;
  if (surface.g > 0.0 && surface.b == 0.0 && surface.r <= 0.0) return false;
  if (abs(surface.g - color.a) > 0.001) return false;
  if (alphaMode == 0 && (surface.g != 1.0 || color.a != 1.0)) return false;
  if (alphaMode == 2 && color.a == 0.0 && any(notEqual(color.rgb, vec3(0.0)))) return false;
  if (alphaMode == 2 && color.a > 0.0 && any(greaterThan(abs(color.rgb / color.a), vec3(65504.0)))) return false;
  return coc >= -maximumRadius.x - 0.00001 && coc <= maximumRadius.y + 0.00001;
}
vec3 straightColor(vec4 color) {
  return alphaMode == 2 ? (color.a > 0.0 ? color.rgb / color.a : vec3(0.0)) : color.rgb;
}
float fartherThan(vec4 candidate, vec4 receiver) {
  if (receiver.b == 1.0 || receiver.g == 0.0) return 0.0;
  if (candidate.b == 1.0) return 1.0;
  return candidate.r > receiver.r + depthTolerance ? 1.0 : 0.0;
}
`;
