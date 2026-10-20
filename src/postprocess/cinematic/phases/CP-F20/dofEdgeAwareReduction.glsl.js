import { DOF_SAMPLING_GLSL } from "./dofSampling.glsl.js";
export const DOF_EDGE_REDUCTION_FRAGMENT = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uSource;
uniform sampler2D uGuide;
uniform vec2 uSize;
uniform vec2 uReducedSize;
uniform vec3 uTolerances;
uniform float uRelativeCoc;
uniform int uScale;
uniform bool uWriteGuide;
${DOF_SAMPLING_GLSL}
void main() {
  vec2 basePixel = floor(gl_FragCoord.xy) * float(uScale);
  vec4 anchor = vec4(1000.0, 0.0, 0.0, 0.0);
  for (int y = 0; y < 4; y++) {
    for (int x = 0; x < 4; x++) {
      if (x >= uScale || y >= uScale) continue;
      vec2 pixel = basePixel + vec2(float(x), float(y));
      if (any(greaterThanEqual(pixel, uSize))) continue;
      vec4 guide = texture2D(uGuide, pixelUv(pixel, uSize));
      if (validGuide(guide) && guide.b > 0.0 && guide.r < anchor.r) anchor = guide;
    }
  }
  vec4 colorTotal = vec4(0.0);
  vec2 guideTotal = vec2(0.0);
  float totalWeight = 0.0;
  for (int y = 0; y < 4; y++) {
    for (int x = 0; x < 4; x++) {
      if (x >= uScale || y >= uScale) continue;
      vec2 pixel = basePixel + vec2(float(x), float(y));
      if (any(greaterThanEqual(pixel, uSize))) continue;
      vec2 uv = pixelUv(pixel, uSize);
      vec4 guide = texture2D(uGuide, uv);
      vec4 color = texture2D(uSource, uv);
      if (compatibleGuides(anchor, guide, uTolerances, uRelativeCoc) && finiteColor(color)) {
        colorTotal += color;
        guideTotal += guide.gb;
        totalWeight += 1.0;
      }
    }
  }
  if (totalWeight == 0.0) { gl_FragColor = vec4(0.0); return; }
  gl_FragColor = uWriteGuide ? vec4(anchor.r, guideTotal / totalWeight, 1.0) : colorTotal / totalWeight;
}
`;
