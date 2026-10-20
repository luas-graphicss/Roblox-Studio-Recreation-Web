export const LENS_FLARE_SAMPLING_GLSL = `
vec4 flareReadTexel(sampler2D source, ivec2 pixel) {
  ivec2 size = textureSize(source, 0);
  if (any(lessThan(pixel, ivec2(0))) || any(greaterThanEqual(pixel, size))) return vec4(0.0);
  return texelFetch(source, pixel, 0);
}
vec4 flareSample(sampler2D source, vec2 uv) {
  vec2 pixel = uv * vec2(textureSize(source, 0)) - 0.5;
  ivec2 lower = ivec2(floor(pixel));
  vec2 fraction = fract(pixel);
  vec4 a = flareReadTexel(source, lower);
  vec4 b = flareReadTexel(source, lower + ivec2(1, 0));
  vec4 c = flareReadTexel(source, lower + ivec2(0, 1));
  vec4 d = flareReadTexel(source, lower + ivec2(1, 1));
  vec4 result = mix(mix(a, b, fraction.x), mix(c, d, fraction.x), fraction.y);
  result.a = result.a > 0.0 ? 1.0 : 0.0;
  return result;
}
vec4 flareBound(vec3 color, float invalid) {
  bvec3 notFinite = bvec3(isnan(color.x) || isinf(color.x), isnan(color.y) || isinf(color.y), isnan(color.z) || isinf(color.z));
  bool overflow = any(greaterThan(abs(color), vec3(65504.0))) || any(notFinite);
  if (notFinite.x) color.x = 0.0;
  if (notFinite.y) color.y = 0.0;
  if (notFinite.z) color.z = 0.0;
  return vec4(clamp(color, vec3(-65504.0), vec3(65504.0)), max(invalid, overflow ? 1.0 : 0.0));
}
`;
