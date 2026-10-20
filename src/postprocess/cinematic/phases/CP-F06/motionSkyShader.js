export const MOTION_SKY_FRAGMENT = `
precision highp float;
uniform mat4 inverseCurrentViewProjection;
uniform mat4 previousViewProjection;
uniform vec3 cameraPositionWorld;
uniform vec2 renderSize;
uniform vec2 currentJitter;
uniform vec2 previousJitter;
uniform float historyValid;
uniform float outputMode;
uniform sampler2D previousIdentity;
uniform sampler2D sceneDepth;
varying vec2 vUv;
void main() {
  if (texture2D(sceneDepth, vUv).r < 1.0 - 4.0 / 16777215.0) {
    gl_FragColor = vec4(0.0);
    return;
  }
  if (outputMode > 0.5 && outputMode < 1.5) {
    gl_FragColor = vec4(1.0 / 255.0, 0.0, 0.0, 1.0);
    return;
  }
  vec2 currentUv = vUv - currentJitter / renderSize;
  vec4 farPoint = inverseCurrentViewProjection * vec4(currentUv * 2.0 - 1.0, 1.0, 1.0);
  vec3 direction = normalize(farPoint.xyz / farPoint.w - cameraPositionWorld);
  vec4 previousClip = previousViewProjection * vec4(direction, 0.0);
  if (historyValid < 0.5 || previousClip.w <= 0.0) {
    gl_FragColor = outputMode < 0.5 ? vec4(0.0) : vec4(0.0, 0.0, 1.0, 0.0);
    return;
  }
  vec2 oldUv = previousClip.xy / previousClip.w * 0.5 + 0.5;
  vec2 velocity = currentUv - oldUv;
  bool valid = all(lessThanEqual(abs(velocity), vec2(65504.0)));
  vec2 historyUv = oldUv + previousJitter / renderSize;
  bool inside = all(greaterThanEqual(historyUv, vec2(0.0))) && all(lessThan(historyUv, vec2(1.0)));
  bool visible = false;
  if (valid && inside) {
    vec4 identity = texture2D(previousIdentity, historyUv);
    visible = identity.a > 0.5 && abs(identity.r - 1.0 / 255.0) < 0.5 / 255.0 && identity.g < 0.5 / 255.0 && identity.b < 0.5 / 255.0;
  }
  gl_FragColor = outputMode < 0.5 ? (valid ? vec4(velocity, 1.0, 1.0) : vec4(0.0)) : vec4(visible ? 1.0 : 0.0, valid ? 1.0 : 0.0, 1.0, 0.0);
}
`;
