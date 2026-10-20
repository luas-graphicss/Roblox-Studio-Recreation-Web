import { DIAPHRAGM_SHADER_FUNCTIONS } from "./diaphragmShaderFunctions.js";
export const DIAPHRAGM_GATHER_SHADER = `${DIAPHRAGM_SHADER_FUNCTIONS}
uniform ivec2 gatherExtent;
uniform int gatherNear;
void main() {
  ivec2 receiverPixel = ivec2(gl_FragCoord.xy);
  vec4 receiverSurface = texelFetch(surfaceData, receiverPixel, 0);
  float receiverCoc = texelFetch(signedCoc, receiverPixel, 0).r;
  float receiverValidity = texelFetch(kernelNormalization, receiverPixel, 0).r;
  float sharpCoverage = receiverValidity > 0.0 ? (1.0 - smoothstep(0.0, focusProtectionRadius, abs(receiverCoc))) * receiverSurface.g : 0.0;
  vec3 radianceSum = vec3(0.0);
  float coverageSum = 0.0;
  for (int y = -gatherExtent.y; y <= gatherExtent.y; y++) {
    for (int x = -gatherExtent.x; x <= gatherExtent.x; x++) {
      ivec2 offset = ivec2(x, y);
      ivec2 sourcePixel = receiverPixel + offset;
      if (!insideSource(sourcePixel)) continue;
      float reciprocalWeight = texelFetch(kernelNormalization, sourcePixel, 0).r;
      if (reciprocalWeight <= 0.0) continue;
      float coc = texelFetch(signedCoc, sourcePixel, 0).r;
      if ((coc < 0.0) != (gatherNear == 1)) continue;
      float footprint = footprintWeight(-offset, abs(coc)) * reciprocalWeight;
      if (footprint <= 0.0) continue;
      vec4 surface = texelFetch(surfaceData, sourcePixel, 0);
      float visibility = 1.0 - fartherThan(surface, receiverSurface) * sharpCoverage;
      float weight = footprint * surface.g * visibility;
      radianceSum += straightColor(texelFetch(sourceColor, sourcePixel, 0)) * weight;
      coverageSum += weight;
    }
  }
  gl_FragColor = vec4(coverageSum > 0.0 ? radianceSum / coverageSum : vec3(0.0), clamp(coverageSum, 0.0, 1.0));
}
`;
