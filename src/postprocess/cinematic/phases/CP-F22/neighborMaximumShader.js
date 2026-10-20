export const NEIGHBOR_MAXIMUM_FRAGMENT = `
uniform sampler2D tileTexture;
uniform int neighborRadius;
void main() {
  ivec2 size = textureSize(tileTexture, 0);
  ivec2 center = ivec2(gl_FragCoord.xy);
  vec4 maximum = vec4(0.0);
  float maximumSquared = 0.0;
  for (int row = -17; row <= 17; row++) {
    if (abs(row) > neighborRadius) continue;
    for (int column = -17; column <= 17; column++) {
      if (abs(column) > neighborRadius) continue;
      ivec2 position = center + ivec2(column, row);
      if (any(lessThan(position, ivec2(0))) || any(greaterThanEqual(position, size))) continue;
      vec4 candidate = texelFetch(tileTexture, position, 0);
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
