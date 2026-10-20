export const TRANSLUCENCY_FRAGMENT = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uBackgroundColor;
uniform sampler2D uForegroundColor;
uniform sampler2D uBackgroundCoverage;
uniform sampler2D uForegroundCoverage;
uniform sampler2D uBackgroundReactive;
uniform sampler2D uForegroundReactive;
uniform sampler2D uBackgroundVelocity;
uniform sampler2D uForegroundVelocity;
uniform sampler2D uPreviousValidation;
uniform bool uHasPreviousValidation;
uniform float uExposureScale;
uniform bool uEnabled;
uniform int uOutputKind;
bool finiteChannels(vec4 value) {
  return all(equal(value, value)) && all(lessThanEqual(abs(value), vec4(65504.0)));
}
bool unitValue(float value) {
  return value >= 0.0 && value <= 1.0;
}
bool validSample(vec4 color, float coverage, float reactive, vec4 velocity) {
  bool zeroAlpha = color.a == 0.0 && any(notEqual(color.rgb, vec3(0.0)));
  return finiteChannels(color) && finiteChannels(velocity) && unitValue(color.a) && unitValue(coverage) && unitValue(reactive) && unitValue(velocity.a) && !zeroAlpha;
}
void main() {
  vec4 background = texture2D(uBackgroundColor, vUv);
  vec4 foreground = texture2D(uForegroundColor, vUv);
  float backgroundCoverage = texture2D(uBackgroundCoverage, vUv).r;
  float foregroundCoverage = texture2D(uForegroundCoverage, vUv).r;
  float backgroundReactive = texture2D(uBackgroundReactive, vUv).r;
  float foregroundReactive = texture2D(uForegroundReactive, vUv).r;
  vec4 backgroundVelocity = texture2D(uBackgroundVelocity, vUv);
  vec4 foregroundVelocity = texture2D(uForegroundVelocity, vUv);
  bool backgroundValid = validSample(background, backgroundCoverage, backgroundReactive, backgroundVelocity);
  bool foregroundValid = validSample(foreground, foregroundCoverage, foregroundReactive, foregroundVelocity);
  vec4 color = background;
  float coverage = backgroundCoverage;
  float reactive = backgroundReactive;
  vec4 velocity = backgroundVelocity;
  bool valid = backgroundValid;
  if (uEnabled) {
    color = vec4(foreground.rgb * uExposureScale + background.rgb * (1.0 - foreground.a), foreground.a + background.a * (1.0 - foreground.a));
    coverage = foregroundCoverage + backgroundCoverage * (1.0 - foregroundCoverage);
    bool hasForeground = foreground.a > 0.0;
    velocity = hasForeground ? foregroundVelocity : backgroundVelocity;
    float selectedCoverage = hasForeground ? foregroundCoverage : backgroundCoverage;
    float selectedAlpha = hasForeground ? foreground.a : background.a;
    bool motionValid = (selectedCoverage > 0.0 || selectedAlpha > 0.0) && velocity.a > 0.5;
    if (!motionValid) velocity = vec4(0.0);
    reactive = max(max(backgroundReactive, foregroundReactive), (coverage > 0.0 || color.a > 0.0) && !motionValid ? 1.0 : 0.0);
    valid = backgroundValid && foregroundValid && finiteChannels(color);
  }
  valid = valid && (!uHasPreviousValidation || texture2D(uPreviousValidation, vUv).r == 0.0);
  if (uOutputKind == 4) {
    gl_FragColor = vec4(valid ? 0.0 : 1.0, 0.0, 0.0, 1.0);
    return;
  }
  if (!valid) {
    color = backgroundValid ? background : vec4(0.0);
    coverage = backgroundValid ? backgroundCoverage : 0.0;
    reactive = 1.0;
    velocity = vec4(0.0);
  }
  if (uOutputKind == 0) gl_FragColor = color;
  else if (uOutputKind == 1) gl_FragColor = vec4(coverage, 0.0, 0.0, 1.0);
  else if (uOutputKind == 2) gl_FragColor = vec4(reactive, 0.0, 0.0, 1.0);
  else gl_FragColor = velocity;
}
`;
