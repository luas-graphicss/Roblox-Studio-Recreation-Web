export const EXPOSURE_APPLICATION_FRAGMENT = `
precision highp float;
uniform sampler2D sceneColorTexture;
uniform sampler2D adaptationTexture;
uniform float colorPreExposure;
varying vec2 vUv;
void main() {
  vec4 sceneColor = texture2D(sceneColorTexture, vUv);
  float exposureMultiplier = texture2D(adaptationTexture, vec2(2.5 / 6.0, 0.5)).r;
  gl_FragColor = vec4(sceneColor.rgb * (exposureMultiplier / colorPreExposure), sceneColor.a);
}
`;
