export const CHROMATIC_FRAGMENT_SHADER = `
uniform highp sampler2D cp23Source;
uniform vec2 cp23SourceSize;
uniform vec2 cp23OutputSize;
uniform vec4 cp23Crop;
uniform vec2 cp23AxisScale;
uniform vec2 cp23Center;
uniform float cp23Intensity;
uniform float cp23StartOffset;
uniform bool cp23ExactCopy;
uniform bool cp23Premultiplied;
uniform int cp23EdgeMode;

vec4 cp23ReadTexel(ivec2 coordinate) {
  ivec2 extent = ivec2(cp23SourceSize);
  if (cp23EdgeMode == 1 && (any(lessThan(coordinate, ivec2(0))) || any(greaterThanEqual(coordinate, extent)))) return vec4(0.0);
  return texelFetch(cp23Source, clamp(coordinate, ivec2(0), extent - ivec2(1)), 0);
}

vec4 cp23Sample(vec2 coordinate) {
  vec2 position = coordinate * cp23SourceSize - 0.5;
  ivec2 lower = ivec2(floor(position));
  vec2 fraction = fract(position);
  vec4 bottom = mix(cp23ReadTexel(lower), cp23ReadTexel(lower + ivec2(1, 0)), fraction.x);
  vec4 top = mix(cp23ReadTexel(lower + ivec2(0, 1)), cp23ReadTexel(lower + ivec2(1)), fraction.x);
  return mix(bottom, top, fraction.y);
}

vec3 cp23StraightColor(vec4 value) {
  return value.a > 0.0 ? value.rgb / value.a : vec3(0.0);
}

vec4 cp23FiniteColor(vec4 value) {
  if (any(isnan(value)) || any(isinf(value)) || any(greaterThan(abs(value.rgb), vec3(65504.0))) || value.a < 0.0 || value.a > 1.0) return vec4(1.0, 0.0, 1.0, 1.0);
  return value;
}

void main() {
  vec2 outputUv = gl_FragCoord.xy / cp23OutputSize;
  vec2 delta = outputUv - cp23Center;
  float radius = length(2.0 * delta * cp23AxisScale);
  float radialWeight = cp23StartOffset < 1.0 ? clamp((radius - cp23StartOffset) / (1.0 - cp23StartOffset), 0.0, 1.0) : 0.0;
  float strength = cp23Intensity * 0.01 * radialWeight;
  vec2 sourceUv = cp23Crop.xy + outputUv * cp23Crop.zw;
  vec4 base = cp23ExactCopy ? cp23ReadTexel(ivec2(gl_FragCoord.xy)) : cp23Sample(sourceUv);
  if (strength == 0.0) {
    gl_FragColor = cp23FiniteColor(base);
    return;
  }
  vec2 redUv = cp23Crop.xy + (cp23Center + delta * (1.0 - strength)) * cp23Crop.zw;
  vec2 greenUv = cp23Crop.xy + (cp23Center + delta * (1.0 - strength * 0.5)) * cp23Crop.zw;
  vec4 redSample = cp23Sample(redUv);
  vec4 greenSample = cp23Sample(greenUv);
  vec3 rgb = vec3(redSample.r, greenSample.g, base.b);
  if (cp23Premultiplied) rgb = vec3(cp23StraightColor(redSample).r, cp23StraightColor(greenSample).g, cp23StraightColor(base).b) * base.a;
  gl_FragColor = cp23FiniteColor(vec4(rgb, base.a));
}
`;
