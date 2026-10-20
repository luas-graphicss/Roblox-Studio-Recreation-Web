export const BLOOM_SAMPLING_GLSL = `
int mirrorIndex(int index, int extent) {
  int period = extent * 2;
  int wrapped = ((index % period) + period) % period;
  return wrapped < extent ? wrapped : period - wrapped - 1;
}
vec4 mirrorFetch(sampler2D sourceTexture, ivec2 position) {
  ivec2 extent = textureSize(sourceTexture, 0);
  ivec2 mirrored = ivec2(mirrorIndex(position.x, extent.x), mirrorIndex(position.y, extent.y));
  return texelFetch(sourceTexture, mirrored, 0);
}
vec4 sampleBloomLinear(sampler2D sourceTexture, vec2 pixelPosition) {
  ivec2 first = ivec2(floor(pixelPosition));
  vec2 fraction = fract(pixelPosition);
  vec4 lower = mix(mirrorFetch(sourceTexture, first), mirrorFetch(sourceTexture, first + ivec2(1, 0)), fraction.x);
  vec4 upper = mix(mirrorFetch(sourceTexture, first + ivec2(0, 1)), mirrorFetch(sourceTexture, first + ivec2(1, 1)), fraction.x);
  return mix(lower, upper, fraction.y);
}
`;
