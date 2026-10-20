export const LOG_LUMINANCE_FRAGMENT = `
uniform sampler2D uSceneColor;
uniform float uPreExposure;
varying vec2 vUv;
void main() {
  vec3 color = max(texture2D(uSceneColor, vUv).rgb, vec3(0.0));
  float luminance = dot(color, vec3(0.2126, 0.7152, 0.0722)) / uPreExposure;
  float sceneLog = log2(max(luminance, 0.000000059604644775390625));
  gl_FragColor = vec4(sceneLog, sceneLog, sceneLog, 0.0);
}
`;
