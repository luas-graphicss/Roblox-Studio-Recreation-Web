export const MOTION_GATHER_FRAGMENT = `
uniform sampler2D colorTexture;
uniform sampler2D flattenedTexture;
uniform sampler2D neighborTexture;
uniform vec2 shutterInterval;
uniform float logDepthTolerance;
uniform float motionTolerance;
uniform int sampleCount;
uniform int blurEnabled;

vec4 gatherAt(vec2 sourcePosition, vec2 centerPosition, vec4 centerRecord, float shutterTime, out float weight, out float nearestDepth) {
  ivec2 size = textureSize(colorTexture, 0);
  vec2 gridPosition = sourcePosition - 0.5;
  ivec2 first = ivec2(floor(gridPosition));
  vec2 fraction = fract(gridPosition);
  vec4 sum = vec4(0.0);
  weight = 0.0;
  nearestDepth = 10000.0;
  for (int row = 0; row < 2; row++) {
    for (int column = 0; column < 2; column++) {
      ivec2 pixel = first + ivec2(column, row);
      if (any(lessThan(pixel, ivec2(0))) || any(greaterThanEqual(pixel, size))) continue;
      vec4 record = texelFetch(flattenedTexture, pixel, 0);
      if (record.a <= 0.0 || record.z > centerRecord.z + logDepthTolerance) continue;
      if (record.a == 2.0 && centerRecord.a != 2.0) continue;
      vec2 reconstructedPosition = vec2(pixel) + 0.5 + record.xy * shutterTime;
      if (length(reconstructedPosition - centerPosition) > motionTolerance) continue;
      float bilinearWeight = (column == 0 ? 1.0 - fraction.x : fraction.x) * (row == 0 ? 1.0 - fraction.y : fraction.y);
      vec4 color = texelFetch(colorTexture, pixel, 0);
      sum += color * bilinearWeight;
      weight += bilinearWeight;
      if (bilinearWeight > 0.0) nearestDepth = min(nearestDepth, record.z);
    }
  }
  return sum;
}

void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  vec4 original = texelFetch(colorTexture, pixel, 0);
  if (blurEnabled == 0) { gl_FragColor = original; return; }
  vec4 centerRecord = texelFetch(flattenedTexture, pixel, 0);
  vec2 dominantVelocity = texelFetch(neighborTexture, pixel / 16, 0).xy;
  if (centerRecord.a <= 0.0 || max(length(centerRecord.xy), length(dominantVelocity)) < 0.0001) { gl_FragColor = original; return; }
  bool useOwnDirection = length(centerRecord.xy) > 0.0001 && length(dominantVelocity - centerRecord.xy) > 0.25;
  vec4 integratedColor = vec4(0.0);
  for (int sampleIndex = 0; sampleIndex < 64; sampleIndex++) {
    if (sampleIndex >= sampleCount) break;
    float shutterTime = mix(shutterInterval.x, shutterInterval.y, (float(sampleIndex) + 0.5) / float(sampleCount));
    float weight;
    float nearestDepth;
    vec4 contribution = gatherAt(gl_FragCoord.xy - dominantVelocity * shutterTime, gl_FragCoord.xy, centerRecord, shutterTime, weight, nearestDepth);
    if (useOwnDirection) {
      float ownWeight;
      float ownDepth;
      vec4 ownContribution = gatherAt(gl_FragCoord.xy - centerRecord.xy * shutterTime, gl_FragCoord.xy, centerRecord, shutterTime, ownWeight, ownDepth);
      if (ownWeight > 0.0 && (weight <= 0.0 || ownDepth < nearestDepth - logDepthTolerance || (abs(ownDepth - nearestDepth) <= logDepthTolerance && ownWeight > weight))) {
        contribution = ownContribution;
        weight = ownWeight;
      }
    }
    integratedColor += contribution + original * max(0.0, 1.0 - weight);
  }
  gl_FragColor = integratedColor / float(sampleCount);
}
`;
