import { RECONSTRUCTION_SAMPLING_SHADER } from "./reconstructionSamplingShader.js";

export const TEMPORAL_RESOLVE_FRAGMENT = `
precision highp float;
varying vec2 vUv;
uniform sampler2D currentColorTexture;
uniform sampler2D dilatedVelocityTexture;
uniform sampler2D depthTexture;
uniform sampler2D validityTexture;
uniform sampler2D reactiveTexture;
uniform sampler2D translucencyTexture;
uniform sampler2D previousColorTexture;
uniform sampler2D previousDepthTexture;
uniform vec2 renderSize;
uniform vec2 outputSize;
uniform vec2 jitterPixels;
uniform vec2 depthPlanes;
uniform float sourceExposureScale;
uniform float framePreExposure;
uniform float baseHistoryWeight;
uniform float historySampleCount;
uniform float motionRejectionPixels;
uniform float depthRelativeThreshold;
uniform float depthAbsoluteThreshold;
uniform float varianceGamma;
uniform float reactiveStrength;
uniform float luminanceRejection;
uniform bool hasHistory;
uniform bool accumulationEnabled;
uniform bool hasValidity;
uniform bool hasReactiveMask;
uniform bool hasTranslucencyMask;
uniform bool varianceClipping;
uniform bool cubicCurrentFilter;
uniform bool cubicHistoryFilter;
uniform bool orthographicDepth;
uniform bool inputDepthLinear;
uniform bool diagnosticOutput;
${RECONSTRUCTION_SAMPLING_SHADER}
void main() {
  vec2 rasterUv = vUv + jitterPixels / renderSize;
  vec2 centerPixel = floor(rasterUv * renderSize);
  vec2 centerUv = pixelUv(centerPixel, renderSize);
  float upscaleInfluence = clamp(max(outputSize.x / renderSize.x, outputSize.y / renderSize.y) - 1.0, 0.0, 1.0);
  vec2 sampleDistance = (centerPixel + 0.5 - rasterUv * renderSize) * outputSize / renderSize;
  float sampleConfidence = exp(-2.0 * dot(sampleDistance, sampleDistance));
  vec3 pointSample = texture2D(currentColorTexture, centerUv).rgb * sourceExposureScale;
  vec4 current = sampleReconstructed(currentColorTexture, rasterUv, renderSize, cubicCurrentFilter);
  current.rgb *= sourceExposureScale;
  bool rangeInvalid = !finiteColor(current);
  float sourceDepth = texture2D(depthTexture, centerUv).r;
  float currentDepth = linearDepth(sourceDepth, depthPlanes, orthographicDepth, inputDepthLinear);
  if (!finiteScalar(sourceDepth) || !finiteScalar(currentDepth) || currentDepth < depthPlanes.x || currentDepth > depthPlanes.y * 1.0001) rangeInvalid = true;
  vec3 neighborhoodMinimum = vec3(65504.0);
  vec3 neighborhoodMaximum = vec3(-65504.0);
  vec3 firstMoment = vec3(0.0);
  vec3 secondMoment = vec3(0.0);
  float reactive = 0.0;
  for (int row = -1; row <= 1; row++) {
    for (int column = -1; column <= 1; column++) {
      vec2 sampleUv = pixelUv(centerPixel + vec2(float(column), float(row)), renderSize);
      vec4 colorSample = texture2D(currentColorTexture, sampleUv);
      colorSample.rgb *= sourceExposureScale;
      if (!finiteColor(colorSample)) rangeInvalid = true;
      vec3 transformed = toLuminanceChroma(colorSample.rgb);
      neighborhoodMinimum = min(neighborhoodMinimum, transformed);
      neighborhoodMaximum = max(neighborhoodMaximum, transformed);
      firstMoment += transformed;
      secondMoment += transformed * transformed;
      float mask = 0.0;
      if (hasValidity) {
        vec4 validitySample = texture2D(validityTexture, sampleUv);
        if (!all(greaterThanEqual(validitySample, vec4(0.0))) || !all(lessThanEqual(validitySample, vec4(1.0)))) rangeInvalid = true;
        mask = validitySample.a;
      }
      if (hasReactiveMask) {
        float externalReactive = texture2D(reactiveTexture, sampleUv).r;
        if (!(externalReactive >= 0.0 && externalReactive <= 1.0)) rangeInvalid = true;
        mask = max(mask, externalReactive);
      }
      if (hasTranslucencyMask) {
        float translucency = texture2D(translucencyTexture, sampleUv).r;
        if (!(translucency >= 0.0 && translucency <= 1.0)) rangeInvalid = true;
        mask = max(mask, translucency);
      }
      reactive = max(reactive, mask);
    }
  }
  float reconstructionTrust = reactive <= 0.0001 && current.a >= 0.999 ? upscaleInfluence : 0.0;
  vec4 motion = texture2D(dilatedVelocityTexture, centerUv);
  vec2 previousUv = vUv - motion.xy;
  float reason = 0.0;
  float warmupWeight = min(baseHistoryWeight, historySampleCount / (historySampleCount + 1.0));
  float historyWeight = mix(baseHistoryWeight, warmupWeight, upscaleInfluence);
  vec4 previous = current;
  if (!hasHistory || !accumulationEnabled) { historyWeight = 0.0; reason = 1.0; }
  else if (any(lessThan(previousUv, 0.5 / outputSize)) || any(greaterThan(previousUv, 1.0 - 0.5 / outputSize))) { historyWeight = 0.0; reason = 2.0; }
  else if (motion.a < 0.5 || motion.b < 0.5) { historyWeight = 0.0; reason = 3.0; }
  if (hasValidity) {
    vec4 centerValidity = texture2D(validityTexture, centerUv);
    if (centerValidity.b < 0.5 || centerValidity.g < 0.5 || centerValidity.r < 0.5) { historyWeight = 0.0; reason = 3.0; }
  }
  if (historyWeight > 0.0) {
    float previousDepth = texture2D(previousDepthTexture, pixelUv(floor(previousUv * outputSize), outputSize)).r;
    float depthThreshold = depthAbsoluteThreshold + depthRelativeThreshold * max(currentDepth, previousDepth);
    if (!finiteScalar(previousDepth) || previousDepth <= 0.0 || abs(previousDepth - currentDepth) > depthThreshold) { historyWeight = 0.0; reason = 4.0; }
  }
  if (historyWeight > 0.0) {
    previous = sampleReconstructed(previousColorTexture, previousUv, outputSize, cubicHistoryFilter);
    if (!finiteColor(previous)) { historyWeight = 0.0; rangeInvalid = true; }
    vec3 lower = neighborhoodMinimum;
    vec3 upper = neighborhoodMaximum;
    if (varianceClipping) {
      vec3 mean = firstMoment / 9.0;
      vec3 deviation = sqrt(max(secondMoment / 9.0 - mean * mean, vec3(0.0)));
      float confidenceGamma = varianceGamma * (1.0 + reconstructionTrust * sampleConfidence);
      lower = max(lower, mean - confidenceGamma * deviation);
      upper = min(upper, mean + confidenceGamma * deviation);
    }
    vec3 transformedHistory = toLuminanceChroma(previous.rgb);
    vec3 clipped = clipHistoryBox(transformedHistory, lower, upper);
    float sampleRadius = max(abs(sampleDistance.x), abs(sampleDistance.y));
    float clipConfidence = 1.0 - smoothstep(0.25, 0.65, sampleRadius);
    float staticReconstruction = length(motion.xy * outputSize) < 0.5 ? reconstructionTrust : 0.0;
    clipped = mix(transformedHistory, clipped, mix(1.0, clipConfidence, staticReconstruction));
    if (length(clipped - transformedHistory) > 0.0001) reason = 6.0;
    previous.rgb = fromLuminanceChroma(clipped);
    float currentLuminance = dot(current.rgb, vec3(0.2126, 0.7152, 0.0722)) / framePreExposure;
    float previousLuminance = dot(previous.rgb, vec3(0.2126, 0.7152, 0.0722)) / framePreExposure;
    float luminanceDifference = abs(currentLuminance - previousLuminance) / max(0.01, max(abs(currentLuminance), abs(previousLuminance)));
    historyWeight *= max(0.0, 1.0 - luminanceRejection * luminanceDifference);
    historyWeight /= 1.0 + length(motion.xy * outputSize) / motionRejectionPixels;
    historyWeight = 1.0 - (1.0 - historyWeight) * mix(1.0, clamp(sampleConfidence * 2.0, 0.05, 1.0), reconstructionTrust);
  }
  float reactiveFactor = 1.0 - reactive * reactiveStrength;
  historyWeight *= reactiveFactor * reactiveFactor;
  if (reactive > 0.0 && reactiveStrength > 0.0 && hasHistory) reason = 5.0;
  vec3 temporalSample = historyWeight > 0.0 ? mix(current.rgb, pointSample, reconstructionTrust) : current.rgb;
  vec4 resolved = vec4(mix(temporalSample, previous.rgb, historyWeight), current.a);
  if (!finiteColor(resolved)) rangeInvalid = true;
  if (rangeInvalid) { resolved = vec4(16.0, 0.0, 16.0, 1.0); historyWeight = 0.0; reason = 8.0; }
  gl_FragColor = diagnosticOutput ? vec4(historyWeight, reason, reactive, rangeInvalid ? 1.0 : 0.0) : resolved;
}
`;
