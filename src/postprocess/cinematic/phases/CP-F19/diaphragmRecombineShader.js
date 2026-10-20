export const DIAPHRAGM_RECOMBINE_SHADER = `
precision highp float;
precision highp sampler2D;
uniform sampler2D nearLayer;
uniform sampler2D filledFarLayer;
uniform sampler2D kernelNormalization;
uniform int alphaMode;
varying vec2 vUv;
void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  if (texelFetch(kernelNormalization, pixel, 0).r < 0.0) { gl_FragColor = vec4(1.0, 0.0, 1.0, 1.0); return; }
  vec4 foreground = texelFetch(nearLayer, pixel, 0);
  vec4 background = texelFetch(filledFarLayer, pixel, 0);
  float backgroundCoverage = alphaMode == 0 ? 1.0 : clamp(background.a, 0.0, 1.0);
  float alpha = foreground.a + backgroundCoverage * (1.0 - foreground.a);
  vec3 premultiplied = foreground.rgb * foreground.a + background.rgb * backgroundCoverage * (1.0 - foreground.a);
  gl_FragColor = vec4(alphaMode == 1 && alpha > 0.0 ? premultiplied / alpha : premultiplied, alpha);
}
`;
export const DIAPHRAGM_COPY_SHADER = `
precision highp float;
precision highp sampler2D;
uniform sampler2D sourceColor;
void main() { gl_FragColor = texelFetch(sourceColor, ivec2(gl_FragCoord.xy), 0); }
`;
export const DIAPHRAGM_CLEAR_SHADER = `
precision highp float;
precision highp sampler2D;
uniform vec4 clearValue;
void main() { gl_FragColor = clearValue; }
`;
