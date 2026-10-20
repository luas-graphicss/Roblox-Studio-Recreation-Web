export const RECONSTRUCTION_SAMPLING_SHADER = `
bool finiteScalar(float value) {
  return value == value && abs(value) <= 3.402823e38;
}
bool finiteColor(vec4 value) {
  return all(lessThanEqual(abs(value), vec4(65504.0))) && value.a >= 0.0 && value.a <= 1.0;
}
vec2 pixelUv(vec2 pixel, vec2 size) {
  return (clamp(pixel, vec2(0.0), size - 1.0) + 0.5) / size;
}
vec4 sampleBilinear(sampler2D image, vec2 uv, vec2 size) {
  vec2 position = uv * size - 0.5;
  vec2 base = floor(position);
  vec2 fraction = fract(position);
  vec4 lower = mix(texture2D(image, pixelUv(base, size)), texture2D(image, pixelUv(base + vec2(1.0, 0.0), size)), fraction.x);
  vec4 upper = mix(texture2D(image, pixelUv(base + vec2(0.0, 1.0), size)), texture2D(image, pixelUv(base + vec2(1.0, 1.0), size)), fraction.x);
  return mix(lower, upper, fraction.y);
}
float cubicWeight(float distance) {
  float radius = abs(distance);
  if (radius <= 1.0) return ((1.5 * radius - 2.5) * radius) * radius + 1.0;
  if (radius < 2.0) return ((-0.5 * radius + 2.5) * radius - 4.0) * radius + 2.0;
  return 0.0;
}
vec4 sampleReconstructed(sampler2D image, vec2 uv, vec2 size, bool cubic) {
  if (!cubic) return sampleBilinear(image, uv, size);
  vec2 position = uv * size - 0.5;
  vec2 base = floor(position);
  vec4 accumulated = vec4(0.0);
  vec4 minimumColor = vec4(65504.0);
  vec4 maximumColor = vec4(-65504.0);
  float weightSum = 0.0;
  for (int row = -1; row <= 2; row++) {
    for (int column = -1; column <= 2; column++) {
      vec2 pixel = base + vec2(float(column), float(row));
      vec4 sampled = texture2D(image, pixelUv(pixel, size));
      float weight = cubicWeight(position.x - pixel.x) * cubicWeight(position.y - pixel.y);
      accumulated += sampled * weight;
      weightSum += weight;
      minimumColor = min(minimumColor, sampled);
      maximumColor = max(maximumColor, sampled);
    }
  }
  return clamp(accumulated / weightSum, minimumColor, maximumColor);
}
vec3 toLuminanceChroma(vec3 color) {
  return vec3(dot(color, vec3(0.25, 0.5, 0.25)), 0.5 * (color.r - color.b), 0.5 * color.g - 0.25 * (color.r + color.b));
}
vec3 fromLuminanceChroma(vec3 color) {
  return vec3(color.x + color.y - color.z, color.x + color.z, color.x - color.y - color.z);
}
vec3 clipHistoryBox(vec3 value, vec3 lower, vec3 upper) {
  vec3 center = 0.5 * (upper + lower);
  vec3 extent = max(0.5 * (upper - lower), vec3(0.000001));
  vec3 displacement = value - center;
  vec3 normalizedDistance = abs(displacement) / extent;
  float maximumDistance = max(normalizedDistance.x, max(normalizedDistance.y, normalizedDistance.z));
  return maximumDistance > 1.0 ? center + displacement / maximumDistance : value;
}
float linearDepth(float depth, vec2 planes, bool orthographic, bool alreadyLinear) {
  if (alreadyLinear) return depth;
  return orthographic ? mix(planes.x, planes.y, depth) : planes.x / (1.0 - depth * (1.0 - planes.x / planes.y));
}
`;
