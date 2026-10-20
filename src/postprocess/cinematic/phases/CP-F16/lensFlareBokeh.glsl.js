import { LENS_FLARE_SAMPLING_GLSL } from "./lensFlareSampling.glsl.js";

export const LENS_FLARE_BOKEH_UPLOAD_FRAGMENT = `
uniform float maskWeights[81];
uniform int maskWidth;
void main() {
  int index = int(gl_FragCoord.y) * maskWidth + int(gl_FragCoord.x);
  gl_FragColor = vec4(maskWeights[index], 0.0, 0.0, 0.0);
}
`;

export const LENS_FLARE_BOKEH_FRAGMENT = `
uniform sampler2D sourceTexture;
uniform sampler2D bokehTexture;
uniform vec2 sourceSize;
uniform float radiusPixels;
varying vec2 vUv;
${LENS_FLARE_SAMPLING_GLSL}
void main() {
  if (radiusPixels == 0.0) {
    gl_FragColor = texelFetch(sourceTexture, ivec2(gl_FragCoord.xy), 0);
    return;
  }
  ivec2 maskSize = textureSize(bokehTexture, 0);
  vec2 center = vec2(maskSize - 1) * 0.5;
  vec3 radiance = vec3(0.0);
  float normalization = 0.0;
  float invalid = 0.0;
  for (int y = 0; y < 9; y++) {
    if (y >= maskSize.y) break;
    for (int x = 0; x < 9; x++) {
      if (x >= maskSize.x) break;
      float weight = texelFetch(bokehTexture, ivec2(x, y), 0).r;
      if (weight <= 0.0) continue;
      vec2 offset = (vec2(x, y) - center) / max(center, vec2(1.0));
      vec4 sampleValue = flareSample(sourceTexture, vUv - offset * radiusPixels / sourceSize);
      radiance += sampleValue.rgb * weight;
      normalization += weight;
      invalid = max(invalid, sampleValue.a);
    }
  }
  gl_FragColor = flareBound(radiance / max(normalization, 0.000001), invalid);
}
`;
