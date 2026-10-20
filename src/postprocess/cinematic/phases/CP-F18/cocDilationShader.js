export const COC_DILATION_FRAGMENT = `
varying vec2 vUv;
uniform sampler2D sourceTiles;
uniform vec2 tileGridSize;
uniform ivec2 dilationAxis;
uniform int dilationReach;
uniform float tileExtentRenderPixels;
void main() {
  ivec2 destination = ivec2(gl_FragCoord.xy);
  vec4 result = texture2D(sourceTiles, (vec2(destination) + 0.5) / tileGridSize);
  int flags = int(result.b + 0.5);
  for (int offset = -32; offset <= 32; offset++) {
    if (offset == 0 || abs(offset) > dilationReach) continue;
    ivec2 sourcePixel = destination + dilationAxis * offset;
    if (any(lessThan(sourcePixel, ivec2(0))) || any(greaterThanEqual(sourcePixel, ivec2(tileGridSize)))) continue;
    vec4 candidate = texture2D(sourceTiles, (vec2(sourcePixel) + 0.5) / tileGridSize);
    float distancePixels = max(float(abs(offset) - 1), 0.0) * tileExtentRenderPixels;
    bool nearReaches = candidate.r > 0.0 && candidate.r >= distancePixels;
    bool farReaches = candidate.g > 0.0 && candidate.g >= distancePixels;
    if (nearReaches) result.r = max(result.r, candidate.r);
    if (farReaches) result.g = max(result.g, candidate.g);
    if (nearReaches || farReaches) {
      flags |= int(candidate.b + 0.5);
      result.a = max(result.a, candidate.a);
    }
  }
  gl_FragColor = vec4(result.rg, float(flags), result.a);
}
`;
