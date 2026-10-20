import { LENS_FLARE_SAMPLING_GLSL } from "./lensFlareSampling.glsl.js";

export const LENS_FLARE_FEATURES_FRAGMENT = `
uniform sampler2D sourceTexture;
uniform vec2 sourceSize;
uniform int ghostCount;
uniform vec2 ghostParameters[8];
uniform vec3 ghostTints[8];
uniform float haloIntensity;
uniform float haloRadiusPixels;
uniform vec3 haloTint;
uniform float dispersionPixels;
uniform float featureNormalization;
uniform bool flareEnabled;
varying vec2 vUv;
${LENS_FLARE_SAMPLING_GLSL}
vec4 chromaticSample(vec2 uv, vec2 axis) {
  vec2 displacement = axis * dispersionPixels / sourceSize;
  vec4 red = flareSample(sourceTexture, uv - displacement);
  vec4 green = flareSample(sourceTexture, uv);
  vec4 blue = flareSample(sourceTexture, uv + displacement);
  return vec4(red.r, green.g, blue.b, max(red.a, max(green.a, blue.a)));
}
void main() {
  if (!flareEnabled) { gl_FragColor = vec4(0.0); return; }
  vec3 result = vec3(0.0);
  float invalid = 0.0;
  for (int index = 0; index < 8; index++) {
    if (index >= ghostCount) break;
    float position = ghostParameters[index].x;
    float weight = ghostParameters[index].y;
    if (weight == 0.0) continue;
    vec2 sourceUv = vec2(0.5) + (vUv - 0.5) / position;
    vec2 direction = (sourceUv - 0.5) * sourceSize;
    float distanceToCenter = length(direction);
    vec2 axis = distanceToCenter > 0.0 ? direction / distanceToCenter : vec2(0.0);
    vec4 sampleValue = chromaticSample(sourceUv, axis);
    result += sampleValue.rgb * ghostTints[index] * weight / (position * position);
    invalid = max(invalid, sampleValue.a);
  }
  if (haloIntensity > 0.0) {
    for (int index = 0; index < 32; index++) {
      float angle = 6.283185307179586 * float(index) / 32.0;
      vec2 axis = vec2(cos(angle), sin(angle));
      vec2 sourceUv = vec2(1.0) - vUv + axis * haloRadiusPixels / sourceSize;
      vec4 sampleValue = chromaticSample(sourceUv, axis);
      result += sampleValue.rgb * haloTint * (haloIntensity / 32.0);
      invalid = max(invalid, sampleValue.a);
    }
  }
  gl_FragColor = flareBound(result * featureNormalization, invalid);
}
`;
