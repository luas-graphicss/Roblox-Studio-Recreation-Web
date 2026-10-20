import { BLOOM_SAMPLING_GLSL } from "./bloomSampling.glsl.js";

export const BLOOM_GLARE_FRAGMENT = `
uniform sampler2D sourceTexture;
uniform vec2 outputSize;
uniform float intensity;
uniform float tintNormalization;
${BLOOM_SAMPLING_GLSL}
float finiteGlare(float value) {
  return isnan(value) ? 0.0 : clamp(value, 0.0, 65504.0);
}
void main() {
  vec2 position = gl_FragCoord.xy * vec2(textureSize(sourceTexture, 0)) / outputSize - 0.5;
  vec3 radiance = sampleBloomLinear(sourceTexture, position).rgb * intensity * tintNormalization;
  bool invalid = any(isnan(radiance)) || any(isinf(radiance)) || any(greaterThan(radiance, vec3(65504.0)));
  gl_FragColor = vec4(finiteGlare(radiance.r), finiteGlare(radiance.g), finiteGlare(radiance.b), invalid ? 1.0 : 0.0);
}
`;

export const BLOOM_BLACK_FRAGMENT = `
void main() {
  gl_FragColor = vec4(0.0);
}
`;
