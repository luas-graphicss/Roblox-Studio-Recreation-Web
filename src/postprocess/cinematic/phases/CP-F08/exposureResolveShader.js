export const EXPOSURE_RESOLVE_SHADER = `
uniform sampler2D uStatistics;
uniform sampler2D uHistogram;
uniform int uMode;
uniform vec2 uHistogramRange;
uniform vec2 uPercentiles;
uniform vec2 uEvBounds;
uniform float uMiddleGray;
uniform float uLuminanceCalibration;
uniform float uManualEv100;
uniform float uManualExposureCalibration;
void main() {
  float totalWeight = texelFetch(uStatistics, ivec2(1, 0), 0).r;
  float meanLog2 = log2(uMiddleGray);
  if (uMode == 0 && totalWeight > 0.0) meanLog2 = texelFetch(uStatistics, ivec2(0, 0), 0).r / totalWeight;
  if (uMode == 1 && totalWeight > 0.0) {
    float histogramWeight = 0.0;
    for (int bin = 0; bin < 64; bin++) histogramWeight += texelFetch(uHistogram, ivec2(bin, 0), 0).r;
    vec2 selectedRange = histogramWeight * uPercentiles * 0.01;
    float accumulatedWeight = 0.0;
    float selectedWeight = 0.0;
    float weightedLogSum = 0.0;
    for (int bin = 0; bin < 64; bin++) {
      float nextWeight = accumulatedWeight + texelFetch(uHistogram, ivec2(bin, 0), 0).r;
      float retainedWeight = max(0.0, min(nextWeight, selectedRange.y) - max(accumulatedWeight, selectedRange.x));
      float binCenter = mix(uHistogramRange.x, uHistogramRange.y, (float(bin) + 0.5) / 64.0);
      weightedLogSum += retainedWeight * binCenter;
      selectedWeight += retainedWeight;
      accumulatedWeight = nextWeight;
    }
    if (selectedWeight > 0.0) meanLog2 = weightedLogSum / selectedWeight;
  }
  float targetEv100 = clamp(meanLog2 + log2(100.0 / uLuminanceCalibration), uEvBounds.x, uEvBounds.y);
  float targetExposure = uMiddleGray / (exp2(targetEv100) * uLuminanceCalibration / 100.0);
  if (totalWeight == 0.0) { targetEv100 = log2(uMiddleGray * 100.0 / uLuminanceCalibration); targetExposure = 1.0; }
  if (uMode == 2) {
    targetEv100 = uManualEv100;
    targetExposure = exp2(-targetEv100) / uManualExposureCalibration;
    meanLog2 = log2(uMiddleGray / targetExposure);
  }
  vec4 result = vec4(meanLog2, targetEv100, targetExposure, totalWeight);
  gl_FragColor = vec4(result[int(gl_FragCoord.x)], 0.0, 0.0, 1.0);
}
`;
