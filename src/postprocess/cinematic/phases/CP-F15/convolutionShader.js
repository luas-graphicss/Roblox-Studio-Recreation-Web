import { CONVOLUTION_BATCH_SIZE } from "./convolutionSettings.js";

export const CONVOLUTION_FRAGMENT = `
uniform sampler2D sourceTexture;
uniform sampler2D previousTexture;
uniform vec2 sourceSize;
uniform vec2 paddedSize;
uniform vec2 paddingOrigin;
uniform bool firstBatch;
uniform int tapCount;
uniform vec2 tapOffsets[${CONVOLUTION_BATCH_SIZE}];
uniform vec3 tapWeights[${CONVOLUTION_BATCH_SIZE}];
void main() {
  vec2 outputPixel = floor(gl_FragCoord.xy) - paddingOrigin;
  vec3 sum = vec3(0.0);
  if (!firstBatch) sum = texture2D(previousTexture, gl_FragCoord.xy / paddedSize).rgb;
  for (int tapIndex = 0; tapIndex < ${CONVOLUTION_BATCH_SIZE}; tapIndex++) {
    if (tapIndex >= tapCount) break;
    vec2 sourcePixel = outputPixel - tapOffsets[tapIndex];
    if (all(greaterThanEqual(sourcePixel, vec2(0.0))) && all(lessThan(sourcePixel, sourceSize))) {
      sum += texture2D(sourceTexture, (sourcePixel + 0.5) / sourceSize).rgb * tapWeights[tapIndex];
    }
  }
  gl_FragColor = vec4(sum, 0.0);
}
`;
