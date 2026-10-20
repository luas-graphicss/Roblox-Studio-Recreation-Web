export const PREFILTER_FRAGMENT = `
uniform sampler2D sourceTexture;
uniform vec2 sourceSize;
uniform vec2 reducedSize;
uniform float preExposure;
uniform float threshold;
uniform float softKnee;
uniform float prefilterMinimum;
uniform float prefilterMaximum;
uniform float prefilterMultiplier;
vec3 filterRadiance(vec3 storedColor) {
  vec3 radiance = max(storedColor / preExposure, vec3(0.0));
  float luminance = dot(radiance, vec3(0.2126, 0.7152, 0.0722));
  float excess = max(luminance - threshold, 0.0);
  if (softKnee > 0.0) {
    float transition = clamp(luminance - threshold + softKnee, 0.0, 2.0 * softKnee);
    excess = max(excess, transition * transition / (4.0 * softKnee));
  }
  float selection = luminance > 0.0 ? min(excess / luminance, 1.0) : 0.0;
  float boostWeight = prefilterMaximum > prefilterMinimum ? clamp((luminance - prefilterMinimum) / (prefilterMaximum - prefilterMinimum), 0.0, 1.0) : step(prefilterMinimum, luminance);
  boostWeight = boostWeight * boostWeight * (3.0 - 2.0 * boostWeight);
  return radiance * selection * mix(1.0, prefilterMultiplier, boostWeight) * preExposure;
}
void main() {
  vec2 cell = floor(gl_FragCoord.xy);
  vec2 lower = cell * sourceSize / reducedSize;
  vec2 upper = (cell + 1.0) * sourceSize / reducedSize;
  vec2 first = floor(lower);
  vec3 sum = vec3(0.0);
  for (int vertical = 0; vertical < 5; vertical++) {
    for (int horizontal = 0; horizontal < 5; horizontal++) {
      vec2 pixel = first + vec2(float(horizontal), float(vertical));
      vec2 overlap = max(vec2(0.0), min(upper, pixel + 1.0) - max(lower, pixel));
      float weight = overlap.x * overlap.y;
      if (weight > 0.0 && all(lessThan(pixel, sourceSize))) sum += filterRadiance(texture2D(sourceTexture, (pixel + 0.5) / sourceSize).rgb) * weight;
    }
  }
  gl_FragColor = vec4(sum / ((upper.x - lower.x) * (upper.y - lower.y)), 0.0);
}
`;
