export const COC_REDUCTION_FRAGMENT = `
varying vec2 vUv;
uniform sampler2D sourceCoc;
uniform sampler2D sourceColor;
uniform vec2 sourceSize;
uniform vec2 outputPerRenderPixel;
uniform int downsampleFactor;
uniform int outputKind;
uniform int alphaMode;
uniform float focusThresholdOutputPixels;
uniform float smallRadiusOutputPixels;
void main() {
  ivec2 blockOrigin = ivec2(gl_FragCoord.xy) * downsampleFactor;
  vec2 nearRadii = vec2(0.0);
  vec2 farRadii = vec2(0.0);
  vec4 nearColor = vec4(0.0);
  vec4 farColor = vec4(0.0);
  float coverageMaximum = 0.0;
  float nearWeight = 0.0;
  float farWeight = 0.0;
  float sampleCount = 0.0;
  int flags = 0;
  for (int offsetY = 0; offsetY < 4; offsetY++) {
    for (int offsetX = 0; offsetX < 4; offsetX++) {
      if (offsetX >= downsampleFactor || offsetY >= downsampleFactor) continue;
      ivec2 sourcePixel = blockOrigin + ivec2(offsetX, offsetY);
      if (any(greaterThanEqual(sourcePixel, ivec2(sourceSize)))) continue;
      sampleCount += 1.0;
      vec2 uv = (vec2(sourcePixel) + 0.5) / sourceSize;
      vec4 coc = texture2D(sourceCoc, uv);
      vec4 color = texture2D(sourceColor, uv);
      if (coc.a < 0.5 || any(isnan(color)) || any(isinf(color)) || any(greaterThan(abs(color.rgb), vec3(65504.0)))) {
        flags |= 64;
        continue;
      }
      if (coc.a > 2.5) continue;
      float alpha = alphaMode == 2 ? 1.0 : color.a;
      if (alpha < 0.0 || alpha > 1.0) {
        flags |= 64;
        continue;
      }
      if (alpha == 0.0) continue;
      float geometricWeight = coc.a > 1.5 ? 1.0 : coc.b;
      float weight = geometricWeight * alpha;
      if (weight == 0.0) continue;
      float outputRadius = max(abs(coc.r) * outputPerRenderPixel.x, abs(coc.g) * outputPerRenderPixel.y);
      bool nearSample = coc.r < 0.0 || coc.g < 0.0;
      if (coc.a > 1.5) flags |= 32;
      if (outputRadius <= focusThresholdOutputPixels) flags |= 1;
      else {
        flags |= outputRadius <= smallRadiusOutputPixels ? 2 : 4;
        flags |= nearSample ? 8 : 16;
      }
      vec3 premultiplied = color.rgb * (alphaMode == 1 ? geometricWeight : weight);
      coverageMaximum = max(coverageMaximum, geometricWeight);
      if (nearSample) {
        nearRadii = min(nearRadii, coc.rg);
        nearColor += vec4(premultiplied, weight);
        nearWeight += weight;
      } else {
        farRadii = max(farRadii, coc.rg);
        farColor += vec4(premultiplied, weight);
        farWeight += weight;
      }
    }
  }
  float normalization = 1.0 / max(sampleCount, 1.0);
  if (outputKind == 0) gl_FragColor = vec4(nearRadii, farRadii);
  else if (outputKind == 1) gl_FragColor = nearColor * normalization;
  else if (outputKind == 2) gl_FragColor = farColor * normalization;
  else gl_FragColor = vec4(float(flags), coverageMaximum, nearWeight * normalization, farWeight * normalization);
}
`;
