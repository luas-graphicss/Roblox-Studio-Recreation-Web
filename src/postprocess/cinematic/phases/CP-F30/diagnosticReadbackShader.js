export const DIAGNOSTIC_READBACK_FRAGMENT = `
precision highp float;
uniform sampler2D sourceTexture;
uniform vec2 sourceSize;
uniform int channelIndex;
void main() {
  vec2 sourceUv = (floor(gl_FragCoord.xy) + vec2(0.5)) / sourceSize;
  vec4 sampleValue = texture2D(sourceTexture, sourceUv);
  float channelValue = sampleValue.r;
  if (channelIndex == 1) channelValue = sampleValue.g;
  if (channelIndex == 2) channelValue = sampleValue.b;
  if (channelIndex == 3) channelValue = sampleValue.a;
  gl_FragColor = vec4(channelValue, 0.0, 0.0, 1.0);
}
`;
