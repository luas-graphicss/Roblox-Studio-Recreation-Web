export const HISTORY_RESCALE_FRAGMENT = `
precision highp float;
uniform sampler2D historyTexture;
uniform float preExposureScale;
varying vec2 vUv;
void main() {
  vec4 historySample = texture2D(historyTexture, vUv);
  gl_FragColor = vec4(historySample.rgb * preExposureScale, historySample.a);
}
`;
