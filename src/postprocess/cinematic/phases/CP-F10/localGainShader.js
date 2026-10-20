export const LOCAL_GAIN_FRAGMENT = `
uniform sampler2D uBase;
uniform sampler2D uSceneColor;
uniform sampler2D uVelocity;
uniform sampler2D uHistory;
uniform vec2 uInverseSize;
uniform vec2 uJitterDeltaUv;
uniform float uHistoryWeight;
uniform float uHistoryRejectionStops;
uniform float uHighlightContrast;
uniform float uShadowContrast;
uniform float uDetailStrength;
uniform float uPivotStops;
uniform float uExposureOffsetStops;
uniform float uBlurredLuminanceBlend;
uniform float uEdgeThreshold;
uniform float uDetailLimit;
uniform float uMaxGainStops;
uniform bool uEnabled;
varying vec2 vUv;
float localBase(vec4 sampleValue) {
  float confidence = max(0.0, 1.0 - sampleValue.a / uEdgeThreshold);
  float blendWeight = uBlurredLuminanceBlend * confidence * confidence;
  float mixedBase = mix(sampleValue.r, sampleValue.g, blendWeight);
  return clamp(mixedBase, sampleValue.b - uDetailLimit, sampleValue.b + uDetailLimit);
}
float gainFor(vec4 sampleValue) {
  if (!uEnabled) return 0.0;
  float base = localBase(sampleValue);
  float relativeBase = base + uExposureOffsetStops - uPivotStops;
  float contrast = relativeBase >= 0.0 ? uHighlightContrast : uShadowContrast;
  float detail = sampleValue.b - base;
  return clamp((contrast - 1.0) * relativeBase + (uDetailStrength - 1.0) * detail, -uMaxGainStops, uMaxGainStops);
}
void main() {
  vec4 base = texture2D(uBase, vUv);
  float gain = gainFor(base);
  float acceptedWeight = 0.0;
  if (uEnabled && uHistoryWeight > 0.0) {
    vec4 velocity = texture2D(uVelocity, vUv);
    vec2 previousUv = vUv - velocity.rg + uJitterDeltaUv;
    vec2 lower = 0.5 * uInverseSize;
    vec2 upper = vec2(1.0) - lower;
    bool inBounds = all(greaterThanEqual(previousUv, lower)) && all(lessThanEqual(previousUv, upper));
    if (velocity.a >= 0.5 && inBounds) {
      vec4 previous = texture2D(uHistory, previousUv);
      if (abs(previous.g - base.b) <= uHistoryRejectionStops) {
        float minimumGain = gain;
        float maximumGain = gain;
        for (int row = -1; row <= 1; row++) {
          for (int column = -1; column <= 1; column++) {
            vec4 neighbor = texture2D(uBase, vUv + vec2(float(column), float(row)) * uInverseSize);
            float neighborGain = gainFor(neighbor);
            minimumGain = min(minimumGain, neighborGain);
            maximumGain = max(maximumGain, neighborGain);
          }
        }
        gain = mix(gain, clamp(previous.r, minimumGain, maximumGain), uHistoryWeight);
        acceptedWeight = uHistoryWeight;
      }
    }
  }
  vec3 absoluteColor = abs(texture2D(uSceneColor, vUv).rgb);
  float maximumChannel = max(absoluteColor.r, max(absoluteColor.g, absoluteColor.b));
  float headroomStops = maximumChannel > 0.0 ? log2(65504.0 / maximumChannel) : 24.0;
  float representableHeadroom = floor(headroomStops * 256.0) / 256.0;
  if (gain > representableHeadroom) {
    gain = representableHeadroom;
    acceptedWeight = -1.0;
  }
  gl_FragColor = vec4(gain, base.b, localBase(base), acceptedWeight);
}
`;
