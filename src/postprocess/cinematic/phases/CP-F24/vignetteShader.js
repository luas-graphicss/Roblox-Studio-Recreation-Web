export const VIGNETTE_GLSL = `
uniform float cp24Intensity;
uniform vec2 cp24AxisScale;

float cp24VignetteFactor(vec2 viewportUv) {
  vec2 radialPosition = (viewportUv * 2.0 - 1.0) * cp24AxisScale;
  float transmission = max(0.0, 1.0 - cp24Intensity * dot(radialPosition, radialPosition));
  return transmission * transmission;
}

vec4 cp24RoundToStorage(vec4 color) {
  return vec4(unpackHalf2x16(packHalf2x16(color.rg)), unpackHalf2x16(packHalf2x16(color.ba)));
}

vec4 cp24ApplyVignette(vec4 color, vec2 viewportUv) {
  if (!all(lessThanEqual(abs(color), vec4(65504.0)))) return vec4(1.0, 0.0, 1.0, 1.0);
  if (cp24Intensity == 0.0) return color;
  vec4 attenuated = vec4(color.rgb * cp24VignetteFactor(viewportUv), color.a);
  return cp24RoundToStorage(attenuated);
}
`;

export const VIGNETTE_FRAGMENT_SHADER = `
uniform sampler2D cp24InputTexture;
varying vec2 vUv;
${VIGNETTE_GLSL}
void main() {
  gl_FragColor = cp24ApplyVignette(texture2D(cp24InputTexture, vUv), vUv);
}
`;
