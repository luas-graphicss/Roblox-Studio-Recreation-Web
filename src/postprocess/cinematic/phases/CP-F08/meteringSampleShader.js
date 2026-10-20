export const METERING_SAMPLE_SHADER = `
uniform sampler2D uSceneColor;
uniform sampler2D uMeteringMask;
uniform ivec2 uSourceSize;
uniform ivec2 uMaskSize;
uniform bool uHasMask;
uniform float uLogPreExposure;
uniform float uMinimumLog;
vec4 meteringSample(ivec2 pixel) {
  if (any(greaterThanEqual(pixel, uSourceSize))) return vec4(0.0);
  vec3 radiance = texelFetch(uSceneColor, pixel, 0).rgb;
  float maskWeight = 1.0;
  if (uHasMask) {
    ivec2 maskPixel = min(ivec2((vec2(pixel) + 0.5) / vec2(uSourceSize) * vec2(uMaskSize)), uMaskSize - 1);
    maskWeight = texelFetch(uMeteringMask, maskPixel, 0).r;
  }
  if (any(isnan(radiance)) || any(isinf(radiance)) || isnan(maskWeight) || isinf(maskWeight)) return vec4(0.0, 0.0, 1.0, 0.0);
  float weight = clamp(maskWeight, 0.0, 1.0);
  float luminance = dot(max(radiance, vec3(0.0)), vec3(0.2126, 0.7152, 0.0722));
  float logLuminance = luminance > 0.0 ? max(uMinimumLog, log2(luminance) - uLogPreExposure) : uMinimumLog;
  return vec4(logLuminance * weight, weight, 0.0, luminance == 0.0 ? weight : 0.0);
}
`;
