import { DIAPHRAGM_SHADER_FUNCTIONS } from "./diaphragmShaderFunctions.js";
export const DIAPHRAGM_NORMALIZATION_SHADER = `${DIAPHRAGM_SHADER_FUNCTIONS}
void main() {
  ivec2 pixel = ivec2(gl_FragCoord.xy);
  if (!validInput(pixel)) { gl_FragColor = vec4(-1.0, 0.0, 0.0, 1.0); return; }
  float radius = abs(texelFetch(signedCoc, pixel, 0).r);
  ivec2 extent = radius == 0.0 ? ivec2(0) : ivec2(ceil((radius + 0.5) * apertureScale));
  float totalWeight = 0.0;
  for (int y = -extent.y; y <= extent.y; y++) {
    for (int x = -extent.x; x <= extent.x; x++) totalWeight += footprintWeight(ivec2(x, y), radius);
  }
  gl_FragColor = vec4(1.0 / max(totalWeight, 0.000001), 0.0, 0.0, 1.0);
}
`;
