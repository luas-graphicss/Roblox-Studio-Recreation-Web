export const DOF_SAMPLING_GLSL = `
bool finiteValue(float value) { return value == value && abs(value) <= 1.0e30; }
bool validGuide(vec4 guide) {
  return guide.a > 0.5 && finiteValue(guide.r) && finiteValue(guide.g) && finiteValue(guide.b) && guide.b >= 0.0 && guide.b <= 1.0;
}
bool insidePixelBounds(vec2 uv, vec2 size) {
  vec2 halfPixel = (0.5 - 0.0001) / size;
  return all(greaterThanEqual(uv, halfPixel)) && all(lessThanEqual(uv, vec2(1.0) - halfPixel));
}
vec2 pixelUv(vec2 pixel, vec2 size) { return (clamp(pixel, vec2(0.0), size - 1.0) + 0.5) / size; }
bool compatibleGuides(vec4 currentGuide, vec4 candidate, vec3 tolerances, float relativeCoc) {
  if (!validGuide(currentGuide) || !validGuide(candidate)) return false;
  if (abs(exp2(candidate.r - currentGuide.r) - 1.0) > tolerances.x) return false;
  if (abs(currentGuide.b - candidate.b) > tolerances.y) return false;
  if (currentGuide.g * candidate.g < 0.0 && max(abs(currentGuide.g), abs(candidate.g)) > tolerances.z) return false;
  return abs(currentGuide.g - candidate.g) <= tolerances.z + relativeCoc * max(abs(currentGuide.g), abs(candidate.g));
}
vec2 reprojectUv(vec2 currentUv, vec2 velocity, vec2 localSize, vec2 fullSize, vec2 jitterDelta) {
  return currentUv - velocity * fullSize / localSize + jitterDelta / localSize;
}
bool validMotion(vec4 velocity, vec2 fullSize, float maximumMotion) {
  return velocity.a > 0.5 && finiteValue(velocity.r) && finiteValue(velocity.g) && length(velocity.rg * fullSize) <= maximumMotion;
}
vec3 toYCoCg(vec3 color) { return vec3(dot(color, vec3(0.25, 0.5, 0.25)), color.r - color.b, color.g - 0.5 * (color.r + color.b)); }
vec3 fromYCoCg(vec3 color) { return vec3(color.r + 0.5 * color.g - 0.5 * color.b, color.r + 0.5 * color.b, color.r - 0.5 * color.g - 0.5 * color.b); }
bool finiteColor(vec4 color) {
  return finiteValue(color.r) && finiteValue(color.g) && finiteValue(color.b) && finiteValue(color.a) && all(lessThanEqual(abs(color.rgb), vec3(65504.0))) && color.a >= 0.0 && color.a <= 1.0;
}
`;
