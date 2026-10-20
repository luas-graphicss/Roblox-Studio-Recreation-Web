import { BLOOM_SAMPLING_GLSL } from "./bloomSampling.glsl.js";

export const BLOOM_DOWNSAMPLE_FRAGMENT = `
uniform sampler2D sourceTexture;
uniform vec2 outputSize;
uniform float threshold;
uniform float softKnee;
uniform float preExposure;
uniform bool extractHighlights;
${BLOOM_SAMPLING_GLSL}

vec3 thresholdColor(vec3 storedColor) {
  vec3 positiveColor = max(storedColor, vec3(0.0));
  if (threshold < 0.0) return positiveColor;
  float brightness = max(max(positiveColor.r, positiveColor.g), positiveColor.b) / preExposure;
  if (brightness <= 0.0) return vec3(0.0);
  float kneeWidth = threshold * softKnee;
  float transition = clamp(brightness - threshold + kneeWidth, 0.0, 2.0 * kneeWidth);
  float softExcess = kneeWidth > 0.0 ? transition * transition / (4.0 * kneeWidth) : 0.0;
  float contribution = min(1.0, max(max(brightness - threshold, 0.0), softExcess) / brightness);
  return positiveColor * contribution;
}
vec2 cellOverlap(vec2 position, vec2 begin, vec2 end) {
  return max(vec2(0.0), min(end, position + 1.0) - max(begin, position));
}
void main() {
  vec2 footprint = vec2(textureSize(sourceTexture, 0)) / outputSize;
  vec2 begin = floor(gl_FragCoord.xy) * footprint;
  vec2 end = begin + footprint;
  ivec2 first = ivec2(floor(begin));
  vec3 filtered = vec3(0.0);
  for (int offsetY = -1; offsetY < 4; offsetY++) {
    for (int offsetX = -1; offsetX < 4; offsetX++) {
      ivec2 position = first + ivec2(offsetX, offsetY);
      vec2 support = cellOverlap(vec2(position) - 1.0, begin, end) * 0.25;
      support += cellOverlap(vec2(position), begin, end) * 0.5;
      support += cellOverlap(vec2(position) + 1.0, begin, end) * 0.25;
      float weight = support.x * support.y;
      if (weight > 0.0) {
        vec3 color = mirrorFetch(sourceTexture, position).rgb;
        filtered += (extractHighlights ? thresholdColor(color) : color) * weight;
      }
    }
  }
  gl_FragColor = vec4(filtered / (footprint.x * footprint.y), 0.0);
}
`;
