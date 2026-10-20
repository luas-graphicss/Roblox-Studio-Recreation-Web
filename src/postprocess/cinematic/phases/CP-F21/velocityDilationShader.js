import { RECONSTRUCTION_SAMPLING_SHADER } from "./reconstructionSamplingShader.js";

export const VELOCITY_DILATION_FRAGMENT = `
precision highp float;
varying vec2 vUv;
uniform sampler2D depthTexture;
uniform sampler2D velocityTexture;
uniform sampler2D validityTexture;
uniform vec2 renderSize;
uniform bool hasValidity;
uniform bool dilationEnabled;
${RECONSTRUCTION_SAMPLING_SHADER}
void main() {
  vec2 center = floor(vUv * renderSize);
  float closestDepth = texture2D(depthTexture, pixelUv(center, renderSize)).r;
  vec2 selectedUv = pixelUv(center, renderSize);
  if (dilationEnabled) {
    for (int row = -1; row <= 1; row++) {
      for (int column = -1; column <= 1; column++) {
        vec2 candidatePixel = center + vec2(float(column), float(row));
        vec2 candidateUv = pixelUv(candidatePixel, renderSize);
        float candidateDepth = texture2D(depthTexture, candidateUv).r;
        if (finiteScalar(candidateDepth) && candidateDepth >= 0.0 && candidateDepth < closestDepth) {
          closestDepth = candidateDepth;
          selectedUv = candidateUv;
        }
      }
    }
  }
  vec4 velocity = texture2D(velocityTexture, selectedUv);
  vec4 validity = hasValidity ? texture2D(validityTexture, selectedUv) : vec4(velocity.a);
  bool finiteMotion = all(lessThanEqual(abs(velocity.xy), vec2(65504.0)));
  bool validSignals = all(greaterThanEqual(validity, vec4(0.0))) && all(lessThanEqual(validity, vec4(1.0)));
  float valid = finiteMotion && validSignals && velocity.a >= 0.5 && validity.g >= 0.5 ? 1.0 : 0.0;
  gl_FragColor = vec4(valid > 0.5 ? velocity.xy : vec2(0.0), valid * validity.r, valid);
}
`;
