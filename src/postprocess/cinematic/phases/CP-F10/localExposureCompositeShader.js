export const LOCAL_EXPOSURE_COMPOSITE_FRAGMENT = `
uniform sampler2D uSceneColor;
uniform sampler2D uGain;
varying vec2 vUv;
void main() {
  vec4 source = texture2D(uSceneColor, vUv);
  float gainStops = texture2D(uGain, vUv).r;
  gl_FragColor = vec4(source.rgb * exp2(gainStops), source.a);
}
`;
