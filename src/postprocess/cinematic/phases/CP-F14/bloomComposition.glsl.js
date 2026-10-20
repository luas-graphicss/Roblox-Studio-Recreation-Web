const compositionInputs = `
uniform sampler2D sourceTexture;
uniform sampler2D glareTexture;
uniform bool bloomActive;
vec4 readComposedColor() {
  vec4 source = texelFetch(sourceTexture, ivec2(gl_FragCoord.xy), 0);
  if (!bloomActive) return source;
  vec3 glare = texelFetch(glareTexture, ivec2(gl_FragCoord.xy), 0).rgb;
  return vec4(source.rgb + glare, source.a);
}
`;

export const BLOOM_RANGE_FRAGMENT = `
${compositionInputs}
void main() {
  vec4 color = readComposedColor();
  bool glareInvalid = bloomActive && texelFetch(glareTexture, ivec2(gl_FragCoord.xy), 0).a > 0.0;
  bool invalid = glareInvalid || any(isnan(color)) || any(isinf(color)) || any(greaterThan(abs(color), vec4(65504.0)));
  gl_FragColor = vec4(invalid ? 1.0 : 0.0, 0.0, 0.0, 1.0);
}
`;

export const BLOOM_COMPOSITION_FRAGMENT = `
${compositionInputs}
float finiteHalf(float value) {
  if (isnan(value)) return 0.0;
  return clamp(value, -65504.0, 65504.0);
}
void main() {
  vec4 color = readComposedColor();
  gl_FragColor = vec4(finiteHalf(color.r), finiteHalf(color.g), finiteHalf(color.b), finiteHalf(color.a));
}
`;
