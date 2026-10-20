import { LENS_FLARE_SAMPLING_GLSL } from "./lensFlareSampling.glsl.js";

export const LENS_FLARE_PREFILTER_FRAGMENT = `
uniform sampler2D sourceTexture;
uniform vec2 outputSize;
uniform float threshold;
uniform float softKnee;
uniform float sourcePreExposure;
${LENS_FLARE_SAMPLING_GLSL}
vec4 extractHighlight(ivec2 pixel) {
  vec4 raw = texelFetch(sourceTexture, pixel, 0);
  vec4 bounded = flareBound(raw.rgb, any(isnan(raw)) || any(isinf(raw)) ? 1.0 : 0.0);
  vec3 positive = max(bounded.rgb, vec3(0.0));
  float luminance = dot(positive, vec3(0.2126, 0.7152, 0.0722));
  float cutoff = threshold * sourcePreExposure;
  float knee = cutoff * softKnee;
  float excess = max(luminance - cutoff, 0.0);
  if (knee > 0.0) {
    float transition = clamp(luminance - cutoff + knee, 0.0, 2.0 * knee);
    excess = max(excess, transition * transition / (4.0 * knee));
  }
  float factor = luminance > 0.0 ? min(excess / luminance, 1.0) : 0.0;
  return vec4(positive * factor, bounded.a);
}
void main() {
  vec2 scale = vec2(textureSize(sourceTexture, 0)) / outputSize;
  vec2 lower = floor(gl_FragCoord.xy) * scale;
  vec2 upper = lower + scale;
  ivec2 start = ivec2(floor(lower));
  vec3 radiance = vec3(0.0);
  float invalid = 0.0;
  for (int y = 0; y < 5; y++) {
    if (float(start.y + y) >= upper.y) break;
    for (int x = 0; x < 5; x++) {
      if (float(start.x + x) >= upper.x) break;
      ivec2 pixel = start + ivec2(x, y);
      if (any(greaterThanEqual(pixel, textureSize(sourceTexture, 0)))) continue;
      vec2 overlap = max(vec2(0.0), min(upper, vec2(pixel) + 1.0) - max(lower, vec2(pixel)));
      vec4 highlight = extractHighlight(pixel);
      radiance += highlight.rgb * overlap.x * overlap.y;
      invalid = max(invalid, highlight.a);
    }
  }
  gl_FragColor = flareBound(radiance / (scale.x * scale.y), invalid);
}
`;
