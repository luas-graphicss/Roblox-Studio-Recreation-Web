import { DOF_SAMPLING_GLSL } from "./dofSampling.glsl.js";
export const DOF_TEMPORAL_RESOLVE_FRAGMENT = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uSource;
uniform sampler2D uGuide;
uniform sampler2D uReducedColor;
uniform sampler2D uReducedGuide;
uniform sampler2D uVelocity;
uniform sampler2D uReactive;
uniform sampler2D uPreviousColor;
uniform sampler2D uPreviousGuide;
uniform sampler2D uPreviousStatistics;
uniform vec2 uSize;
uniform vec2 uReducedSize;
uniform vec2 uFullSize;
uniform vec2 uJitterDelta;
uniform vec3 uTolerances;
uniform float uRelativeCoc;
uniform float uScale;
uniform float uMaximumMotion;
uniform float uHistoryWeight;
uniform float uMaximumSamples;
uniform float uCameraWeight;
uniform float uHistoryExposureScale;
uniform float uPreExposure;
uniform float uClampSigma;
uniform float uClampMargin;
uniform float uRelativeMargin;
uniform bool uEnabled;
uniform bool uHistoryAllowed;
uniform bool uCinematic;
uniform bool uWriteStatistics;
${DOF_SAMPLING_GLSL}
vec4 reconstructCurrent(vec4 currentGuide, vec4 fallbackColor) {
  if (uScale <= 1.0 || abs(currentGuide.g) <= 0.5 || !validGuide(currentGuide)) return fallbackColor;
  vec2 position = gl_FragCoord.xy / uScale - 0.5;
  vec2 basePixel = floor(position);
  vec2 fraction = fract(position);
  vec4 color = vec4(0.0);
  float totalWeight = 0.0;
  for (int y = 0; y < 2; y++) {
    for (int x = 0; x < 2; x++) {
      vec2 uv = pixelUv(basePixel + vec2(float(x), float(y)), uReducedSize);
      vec4 guide = texture2D(uReducedGuide, uv);
      if (compatibleGuides(currentGuide, guide, uTolerances, uRelativeCoc)) {
        float weight = (x == 0 ? 1.0 - fraction.x : fraction.x) * (y == 0 ? 1.0 - fraction.y : fraction.y);
        color += texture2D(uReducedColor, uv) * weight;
        totalWeight += weight;
      }
    }
  }
  return totalWeight > 0.00001 ? color / totalWeight : fallbackColor;
}
vec4 sampleHistory(vec2 position, vec4 guide, out float samples, out float totalWeight) {
  vec2 basePixel = floor(position);
  vec2 fraction = fract(position);
  vec4 color = vec4(0.0);
  samples = 0.0;
  totalWeight = 0.0;
  for (int y = 0; y < 2; y++) {
    for (int x = 0; x < 2; x++) {
      vec2 uv = pixelUv(basePixel + vec2(float(x), float(y)), uSize);
      vec4 previousGuide = texture2D(uPreviousGuide, uv);
      vec4 statistics = texture2D(uPreviousStatistics, uv);
      vec4 previousColor = texture2D(uPreviousColor, uv);
      previousColor.rgb *= uHistoryExposureScale;
      if (compatibleGuides(guide, previousGuide, uTolerances, uRelativeCoc) && statistics.a > 0.5 && finiteColor(previousColor)) {
        float weight = (x == 0 ? 1.0 - fraction.x : fraction.x) * (y == 0 ? 1.0 - fraction.y : fraction.y);
        color += previousColor * weight;
        samples += statistics.r * weight;
        totalWeight += weight;
      }
    }
  }
  if (totalWeight > 0.00001) { samples /= totalWeight; color /= totalWeight; }
  return color;
}
vec3 clipHistory(vec3 historyColor, vec4 guide, vec3 centerColor) {
  vec3 minimumColor = toYCoCg(centerColor);
  vec3 maximumColor = minimumColor;
  vec3 mean = vec3(0.0);
  vec3 secondMoment = vec3(0.0);
  float count = 0.0;
  vec2 centerPixel = floor(gl_FragCoord.xy);
  for (int y = -1; y <= 1; y++) {
    for (int x = -1; x <= 1; x++) {
      vec2 uv = pixelUv(centerPixel + vec2(float(x), float(y)), uSize);
      vec4 candidateGuide = texture2D(uGuide, uv);
      vec4 candidateColor = texture2D(uSource, uv);
      if (compatibleGuides(guide, candidateGuide, uTolerances, uRelativeCoc) && finiteColor(candidateColor)) {
        vec3 color = toYCoCg(candidateColor.rgb);
        minimumColor = min(minimumColor, color);
        maximumColor = max(maximumColor, color);
        mean += color;
        secondMoment += color * color;
        count += 1.0;
      }
    }
  }
  mean = count > 0.0 ? mean / count : toYCoCg(centerColor);
  vec3 variance = count > 0.0 ? max(secondMoment / count - mean * mean, vec3(0.0)) : vec3(0.0);
  vec3 margin = vec3(uClampMargin * uPreExposure) + abs(toYCoCg(centerColor)) * uRelativeMargin;
  vec3 lower = max(minimumColor - margin, mean - uClampSigma * sqrt(variance) - margin);
  vec3 upper = min(maximumColor + margin, mean + uClampSigma * sqrt(variance) + margin);
  return clamp(fromYCoCg(clamp(toYCoCg(historyColor), lower, upper)), vec3(-65504.0), vec3(65504.0));
}
void main() {
  vec2 currentUv = gl_FragCoord.xy / uSize;
  vec4 source = texture2D(uSource, currentUv);
  vec4 guide = texture2D(uGuide, currentUv);
  bool valid = validGuide(guide) && finiteColor(source);
  vec4 currentColor = finiteColor(source) ? source : vec4(0.0);
  if (uEnabled && valid) currentColor = reconstructCurrent(guide, currentColor);
  float samples = 1.0;
  float historyWeight = 0.0;
  float reason = !uEnabled ? 7.0 : !valid ? 5.0 : 1.0;
  if (uEnabled && valid && uHistoryAllowed) {
    vec4 velocity = texture2D(uVelocity, currentUv);
    vec2 previousPosition = gl_FragCoord.xy - 0.5 - velocity.rg * uFullSize + uJitterDelta;
    vec2 previousUv = (previousPosition + 0.5) / uSize;
    float reactive = texture2D(uReactive, currentUv).r;
    reason = 2.0;
    if (validMotion(velocity, uFullSize, uMaximumMotion) && insidePixelBounds(previousUv, uSize)) {
      reason = 4.0;
      if (finiteValue(reactive) && reactive >= 0.0 && reactive < 1.0) {
        float previousSamples;
        float availableWeight;
        vec4 previousColor = sampleHistory(previousPosition, guide, previousSamples, availableWeight);
        reason = 3.0;
        if (availableWeight > 0.00001) {
          samples = min(max(previousSamples, 1.0) + 1.0, uMaximumSamples);
          historyWeight = min(uCinematic ? 1.0 - 1.0 / samples : uHistoryWeight, 1.0 - 1.0 / samples) * (1.0 - reactive) * uCameraWeight;
          vec3 clipped = clipHistory(previousColor.rgb, guide, currentColor.rgb);
          reason = length(clipped - previousColor.rgb) > 0.0001 * max(uPreExposure, 1.0) ? 6.0 : 0.0;
          previousColor.rgb = clipped;
          previousColor.a = clamp(previousColor.a, currentColor.a - uTolerances.y, currentColor.a + uTolerances.y);
          currentColor = mix(currentColor, previousColor, historyWeight);
          if (historyWeight <= 0.0) samples = 1.0;
        }
      }
    }
  }
  currentColor.a = finiteColor(source) ? source.a : 0.0;
  gl_FragColor = uWriteStatistics ? vec4(samples, historyWeight, reason, valid ? 1.0 : 0.0) : currentColor;
}
`;
