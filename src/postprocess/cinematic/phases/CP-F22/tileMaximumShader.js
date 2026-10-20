export const TILE_MAXIMUM_FRAGMENT = `
uniform sampler2D flattenedTexture;
void main() {
  ivec2 size = textureSize(flattenedTexture, 0);
  ivec2 first = ivec2(gl_FragCoord.xy) * 16;
  vec4 maximum = vec4(0.0);
  float maximumSquared = 0.0;
  for (int row = 0; row < 16; row++) {
    for (int column = 0; column < 16; column++) {
      ivec2 position = first + ivec2(column, row);
      if (any(greaterThanEqual(position, size))) continue;
      vec4 candidate = texelFetch(flattenedTexture, position, 0);
      float squaredLength = dot(candidate.xy, candidate.xy);
      if (candidate.a > 0.0 && squaredLength > maximumSquared) {
        maximum = candidate;
        maximumSquared = squaredLength;
      }
    }
  }
  gl_FragColor = maximum;
}
`;
