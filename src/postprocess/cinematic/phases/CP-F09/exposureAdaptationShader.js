export const EXPOSURE_ADAPTATION_FRAGMENT = `
precision highp float;
uniform sampler2D previousStateTexture;
uniform sampler2D meteringTexture;
uniform bool hasPreviousState;
uniform bool meteringUsesTexture;
uniform vec2 meteringEvUv;
uniform bool meteringHasWeight;
uniform float meteredEv100;
uniform float manualEv100;
uniform bool automaticMode;
uniform bool frozenExposure;
uniform float minimumEv100;
uniform float maximumEv100;
uniform float compensationStops;
uniform float speedUpStopsPerSecond;
uniform float speedDownStopsPerSecond;
uniform float transitionDistanceStops;
uniform float deltaSeconds;
uniform float exposureScale;
uniform float framePreExposure;
uniform int curvePointCount;
uniform vec2 curvePoints[32];
varying vec2 vUv;

float curveCompensation(float sourceEv100) {
  if (curvePointCount == 0) return 0.0;
  float result = curvePoints[0].y;
  for (int index = 1; index < 32; index++) {
    if (index >= curvePointCount) break;
    vec2 left = curvePoints[index - 1];
    vec2 right = curvePoints[index];
    float weight = clamp((sourceEv100 - left.x) / (right.x - left.x), 0.0, 1.0);
    if (sourceEv100 >= left.x) result = mix(left.y, right.y, weight);
  }
  return result;
}

float adaptEv(float actual, float target) {
  float signedDistance = target - actual;
  float distance = abs(signedDistance);
  float direction = sign(signedDistance);
  float speed = signedDistance > 0.0 ? speedUpStopsPerSecond : speedDownStopsPerSecond;
  if (distance == 0.0 || speed == 0.0 || deltaSeconds == 0.0) return actual;
  if (transitionDistanceStops == 0.0) return actual + direction * min(distance, speed * deltaSeconds);
  float linearSeconds = max(0.0, distance - transitionDistanceStops) / speed;
  if (deltaSeconds <= linearSeconds) return actual + direction * speed * deltaSeconds;
  float remaining = min(distance, transitionDistanceStops) * exp(-speed * (deltaSeconds - linearSeconds) / transitionDistanceStops);
  return target - direction * remaining;
}

void main() {
  float measured = meteringUsesTexture ? texture2D(meteringTexture, meteringEvUv).r : meteredEv100;
  float inputWeight = meteringHasWeight ? texture2D(meteringTexture, vec2(0.875, 0.5)).r : 1.0;
  bool validWeight = !automaticMode || (inputWeight > 0.0 && inputWeight <= 1.0e20);
  float sourceEv100 = automaticMode ? measured : manualEv100;
  bool validInput = validWeight && sourceEv100 == sourceEv100 && abs(sourceEv100) <= 64.0;
  float previousMultiplier = hasPreviousState ? texture2D(previousStateTexture, vec2(2.5 / 6.0, 0.5)).r : framePreExposure;
  float previousActual = log2(exposureScale) - log2(previousMultiplier);
  float target = previousActual;
  float totalCompensation = 0.0;
  float actual = previousActual;
  float multiplier = previousMultiplier;
  if (validInput) {
    totalCompensation = compensationStops + curveCompensation(sourceEv100);
    float constrained = automaticMode ? clamp(sourceEv100, minimumEv100, maximumEv100) : sourceEv100;
    target = constrained - totalCompensation;
    if (!frozenExposure) {
      actual = !hasPreviousState || !automaticMode ? target : adaptEv(previousActual, target);
      multiplier = exposureScale * exp2(-actual);
    }
  }
  float stateValue = actual;
  if (vUv.x >= 1.0 / 6.0) stateValue = target;
  if (vUv.x >= 2.0 / 6.0) stateValue = multiplier;
  if (vUv.x >= 3.0 / 6.0) stateValue = totalCompensation;
  if (vUv.x >= 4.0 / 6.0) stateValue = validInput ? 1.0 : 0.0;
  if (vUv.x >= 5.0 / 6.0) stateValue = validInput ? sourceEv100 : 0.0;
  gl_FragColor = vec4(stateValue, 0.0, 0.0, 1.0);
}
`;
