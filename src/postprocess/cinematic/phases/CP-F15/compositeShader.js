export const CLEAR_FRAGMENT = `
void main() { gl_FragColor = vec4(0.0); }
`;

export const COMPOSITE_FRAGMENT = `
uniform sampler2D sourceTexture;
uniform sampler2D glareTexture;
uniform vec2 sourceSize;
uniform vec2 reducedSize;
uniform vec2 paddedSize;
uniform vec2 paddingOrigin;
uniform float intensity;
uniform bool effectEnabled;
vec3 readGlare(vec2 pixel) {
  if (any(lessThan(pixel, vec2(0.0))) || any(greaterThanEqual(pixel, paddedSize))) return vec3(0.0);
  return texture2D(glareTexture, (pixel + 0.5) / paddedSize).rgb;
}
void main() {
  vec2 uv = gl_FragCoord.xy / sourceSize;
  vec4 source = texture2D(sourceTexture, uv);
  if (!effectEnabled) { gl_FragColor = source; return; }
  vec2 coordinate = uv * reducedSize - 0.5 + paddingOrigin;
  vec2 lower = floor(coordinate);
  vec2 fraction = fract(coordinate);
  vec3 bottom = mix(readGlare(lower), readGlare(lower + vec2(1.0, 0.0)), fraction.x);
  vec3 top = mix(readGlare(lower + vec2(0.0, 1.0)), readGlare(lower + vec2(1.0)), fraction.x);
  gl_FragColor = vec4(source.rgb + intensity * mix(bottom, top, fraction.y), source.a);
}
`;
