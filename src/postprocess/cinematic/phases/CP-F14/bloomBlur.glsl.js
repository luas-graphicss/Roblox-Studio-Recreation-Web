import { BLOOM_SAMPLING_GLSL } from "./bloomSampling.glsl.js";

export const BLOOM_BLUR_FRAGMENT = `
uniform sampler2D sourceTexture;
uniform vec2 axis;
uniform float filterScale;
${BLOOM_SAMPLING_GLSL}
void main() {
  vec2 position = gl_FragCoord.xy - 0.5;
  vec2 displacement = axis * filterScale;
  vec3 filtered = sampleBloomLinear(sourceTexture, position).rgb * 0.375;
  filtered += (sampleBloomLinear(sourceTexture, position - displacement).rgb + sampleBloomLinear(sourceTexture, position + displacement).rgb) * 0.25;
  filtered += (sampleBloomLinear(sourceTexture, position - 2.0 * displacement).rgb + sampleBloomLinear(sourceTexture, position + 2.0 * displacement).rgb) * 0.0625;
  gl_FragColor = vec4(filtered, 0.0);
}
`;
