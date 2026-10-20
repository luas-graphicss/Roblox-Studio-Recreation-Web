export const COC_SETUP_FRAGMENT = `
varying vec2 vUv;
uniform sampler2D sourceDepth;
uniform sampler2D sourceCoverage;
uniform vec2 cameraPlanesMeters;
uniform float maxOutputPixelsPerSensorMm;
uniform vec2 renderRadiusPerOutputRadius;
uniform float opticalRadiusScale;
uniform float focusDiopters;
uniform float maxRadiusOutputPixels;
uniform bool cocEnabled;
uniform bool hardwareDepth;
uniform bool coverageInAlpha;
uniform int skyPolicy;
void main() {
  vec4 coverageSample = texture2D(sourceCoverage, vUv);
  float coverage = coverageInAlpha ? coverageSample.a : coverageSample.r;
  if (isnan(coverage) || isinf(coverage) || coverage < 0.0 || coverage > 1.0) {
    gl_FragColor = vec4(0.0);
    return;
  }
  bool sky = coverage == 0.0;
  if (sky && skyPolicy == 2) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, 3.0);
    return;
  }
  float inverseDepthMeters = 0.0;
  if (!sky) {
    float depth = texture2D(sourceDepth, vUv).r;
    if (isnan(depth) || isinf(depth) || depth < 0.0 || (!hardwareDepth && depth == 0.0) || (hardwareDepth && depth > 1.0)) {
      gl_FragColor = vec4(0.0);
      return;
    }
    inverseDepthMeters = hardwareDepth ? mix(1.0 / cameraPlanesMeters.x, 1.0 / cameraPlanesMeters.y, depth) : 1.0 / depth;
  }
  float radiusMm = opticalRadiusScale * (focusDiopters - inverseDepthMeters);
  if (!cocEnabled || (sky && skyPolicy == 1)) radiusMm = 0.0;
  float signedOutputRadius = radiusMm * maxOutputPixelsPerSensorMm;
  float cappedOutputRadius = clamp(signedOutputRadius, -maxRadiusOutputPixels, maxRadiusOutputPixels);
  gl_FragColor = vec4(cappedOutputRadius * renderRadiusPerOutputRadius, coverage, sky ? 2.0 : 1.0);
}
`;
