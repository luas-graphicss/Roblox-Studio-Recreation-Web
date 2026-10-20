import { BLOOM_SAMPLING_GLSL } from "./bloomSampling.glsl.js";

export const BLOOM_UPSAMPLE_FRAGMENT = `
uniform sampler2D bandTexture;
uniform sampler2D lowerTexture;
uniform vec2 outputSize;
uniform vec3 bandGain;
uniform bool hasLowerBand;
${BLOOM_SAMPLING_GLSL}
void main() {
  vec3 band = texelFetch(bandTexture, ivec2(gl_FragCoord.xy), 0).rgb * bandGain;
  vec3 lower = vec3(0.0);
  if (hasLowerBand) {
    vec2 lowerPosition = gl_FragCoord.xy * vec2(textureSize(lowerTexture, 0)) / outputSize - 0.5;
    lower = sampleBloomLinear(lowerTexture, lowerPosition).rgb;
  }
  gl_FragColor = vec4(band + lower, 0.0);
}
`;
