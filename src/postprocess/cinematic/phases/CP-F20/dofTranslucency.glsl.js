export const DOF_TRANSLUCENCY_FRAGMENT = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uOpaque;
uniform sampler2D uTranslucency;
uniform float uLayerExposureScale;
uniform bool uWriteRange;
void main() {
  vec4 opaque = texture2D(uOpaque, vUv);
  vec4 layer = texture2D(uTranslucency, vUv);
  bool invalid = any(notEqual(layer, layer)) || any(notEqual(opaque, opaque)) || layer.a < 0.0 || layer.a > 1.0;
  vec4 composed = invalid ? opaque : vec4(layer.rgb * uLayerExposureScale + opaque.rgb * (1.0 - layer.a), layer.a + opaque.a * (1.0 - layer.a));
  invalid = invalid || any(greaterThan(abs(composed), vec4(65504.0)));
  gl_FragColor = uWriteRange ? vec4(invalid ? 1.0 : 0.0, 0.0, 0.0, 1.0) : clamp(composed, vec4(-65504.0), vec4(65504.0));
}
`;
