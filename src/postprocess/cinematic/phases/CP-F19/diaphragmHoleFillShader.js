import { DIAPHRAGM_SHADER_FUNCTIONS } from "./diaphragmShaderFunctions.js";
export const DIAPHRAGM_HOLE_FILL_SHADER = `${DIAPHRAGM_SHADER_FUNCTIONS}
uniform sampler2D farLayer;
uniform sampler2D nearLayer;
uniform int holeFillExtent;
void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  vec4 farSample = texelFetch(farLayer, pixel, 0);
  float nearCoverage = texelFetch(nearLayer, pixel, 0).a;
  if (farSample.a > 0.000001 || alphaMode != 0 || nearCoverage >= 0.9999) { gl_FragColor = farSample; return; }
  vec4 receiver = texelFetch(surfaceData, pixel, 0);
  vec3 filledRadiance = vec3(0.0);
  float totalWeight = 0.0;
  for (int y = -holeFillExtent; y <= holeFillExtent; y++) {
    for (int x = -holeFillExtent; x <= holeFillExtent; x++) {
      ivec2 candidatePixel = pixel + ivec2(x, y);
      if (!insideSource(candidatePixel)) continue;
      vec4 candidate = texelFetch(farLayer, candidatePixel, 0);
      vec4 surface = texelFetch(surfaceData, candidatePixel, 0);
      float coc = texelFetch(signedCoc, candidatePixel, 0).r;
      if (candidate.a <= 0.000001 || coc < 0.0 || surface.a != 1.0) continue;
      if (surface.b == 0.0 && receiver.b == 0.0 && surface.r + depthTolerance < receiver.r) continue;
      float weight = candidate.a / (1.0 + float(x * x + y * y));
      filledRadiance += candidate.rgb * weight;
      totalWeight += weight;
    }
  }
  gl_FragColor = totalWeight > 0.0 ? vec4(filledRadiance / totalWeight, 0.5) : vec4(straightColor(texelFetch(sourceColor, pixel, 0)), -1.0);
}
`;
