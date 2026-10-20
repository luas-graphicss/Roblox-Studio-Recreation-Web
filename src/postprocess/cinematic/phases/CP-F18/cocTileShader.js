export const COC_TILE_FRAGMENT = `
varying vec2 vUv;
uniform sampler2D reducedRadii;
uniform sampler2D reducedInfo;
uniform vec2 reducedSize;
uniform int tileSize;
void main() {
  ivec2 tileOrigin = ivec2(gl_FragCoord.xy) * tileSize;
  float nearRadius = 0.0;
  float farRadius = 0.0;
  float coverageMaximum = 0.0;
  int flags = 0;
  for (int offsetY = 0; offsetY < 16; offsetY++) {
    for (int offsetX = 0; offsetX < 16; offsetX++) {
      if (offsetX >= tileSize || offsetY >= tileSize) continue;
      ivec2 pixel = tileOrigin + ivec2(offsetX, offsetY);
      if (any(greaterThanEqual(pixel, ivec2(reducedSize)))) continue;
      vec2 uv = (vec2(pixel) + 0.5) / reducedSize;
      vec4 radii = texture2D(reducedRadii, uv);
      vec4 info = texture2D(reducedInfo, uv);
      nearRadius = max(nearRadius, max(-radii.r, -radii.g));
      farRadius = max(farRadius, max(radii.b, radii.a));
      flags |= int(info.r + 0.5);
      coverageMaximum = max(coverageMaximum, info.g);
    }
  }
  gl_FragColor = vec4(nearRadius, farRadius, float(flags), coverageMaximum);
}
`;
