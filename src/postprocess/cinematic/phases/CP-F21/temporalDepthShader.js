import { RECONSTRUCTION_SAMPLING_SHADER } from "./reconstructionSamplingShader.js";

export const TEMPORAL_DEPTH_FRAGMENT = `
precision highp float;
varying vec2 vUv;
uniform sampler2D depthTexture;
uniform sampler2D rejectionTexture;
uniform vec2 renderSize;
uniform vec2 jitterPixels;
uniform vec2 depthPlanes;
uniform bool orthographicDepth;
uniform bool inputDepthLinear;
${RECONSTRUCTION_SAMPLING_SHADER}
void main() {
  vec2 sourceUv = pixelUv(floor(vUv * renderSize + jitterPixels), renderSize);
  float depth = linearDepth(texture2D(depthTexture, sourceUv).r, depthPlanes, orthographicDepth, inputDepthLinear);
  if (!finiteScalar(depth) || depth < depthPlanes.x || depth > depthPlanes.y * 1.0001) depth = depthPlanes.y;
  if (texture2D(rejectionTexture, vUv).a > 0.5) depth = 0.0;
  gl_FragColor = vec4(depth, 0.0, 0.0, 1.0);
}
`;
