export const BILATERAL_FILTER_FRAGMENT = `
uniform sampler2D uInput;
uniform vec2 uDirection;
uniform int uRadius;
uniform float uSpatialSigma;
uniform float uRangeSigma;
uniform float uEdgeThreshold;
varying vec2 vUv;
void main() {
  vec4 center = texture2D(uInput, vUv);
  float bilateralSum = 0.0;
  float bilateralWeight = 0.0;
  float blurredSum = 0.0;
  float blurredWeight = 0.0;
  float edgeSpan = center.a;
  for (int offset = -8; offset <= 8; offset++) {
    if (abs(offset) > uRadius) continue;
    vec4 sampleValue = texture2D(uInput, vUv + float(offset) * uDirection);
    float difference = abs(sampleValue.b - center.b);
    float spatialDistance = float(offset) / uSpatialSigma;
    float rangeDistance = difference / uRangeSigma;
    float spatialWeight = exp(-0.5 * spatialDistance * spatialDistance);
    float rangeWeight = difference <= uEdgeThreshold ? exp(-0.5 * rangeDistance * rangeDistance) : 0.0;
    bilateralSum += sampleValue.r * spatialWeight * rangeWeight;
    bilateralWeight += spatialWeight * rangeWeight;
    blurredSum += sampleValue.g * spatialWeight;
    blurredWeight += spatialWeight;
    edgeSpan = max(edgeSpan, max(difference, sampleValue.a));
  }
  gl_FragColor = vec4(bilateralSum / bilateralWeight, blurredSum / blurredWeight, center.b, edgeSpan);
}
`;
