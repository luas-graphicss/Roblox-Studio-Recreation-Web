import { RECONSTRUCTION_SAMPLING_SHADER } from "./reconstructionSamplingShader.js";

export const TEMPORAL_SHARPEN_FRAGMENT = `
precision highp float;
varying vec2 vUv;
uniform sampler2D resolvedTexture;
uniform vec2 outputSize;
uniform float sharpening;
${RECONSTRUCTION_SAMPLING_SHADER}
void main() {
  vec2 centerPixel = floor(vUv * outputSize);
  vec4 center = texture2D(resolvedTexture, pixelUv(centerPixel, outputSize));
  vec3 left = texture2D(resolvedTexture, pixelUv(centerPixel + vec2(-1.0, 0.0), outputSize)).rgb;
  vec3 right = texture2D(resolvedTexture, pixelUv(centerPixel + vec2(1.0, 0.0), outputSize)).rgb;
  vec3 lower = texture2D(resolvedTexture, pixelUv(centerPixel + vec2(0.0, -1.0), outputSize)).rgb;
  vec3 upper = texture2D(resolvedTexture, pixelUv(centerPixel + vec2(0.0, 1.0), outputSize)).rgb;
  vec3 minimumColor = min(center.rgb, min(min(left, right), min(lower, upper)));
  vec3 maximumColor = max(center.rgb, max(max(left, right), max(lower, upper)));
  vec3 detail = center.rgb - (left + right + lower + upper) * 0.25;
  gl_FragColor = vec4(clamp(center.rgb + detail * sharpening, minimumColor, maximumColor), center.a);
}
`;
