import { LENS_FLARE_SAMPLING_GLSL } from "./lensFlareSampling.glsl.js";

export const LENS_FLARE_GLARE_FRAGMENT = `
uniform sampler2D sourceTexture;
uniform float intensity;
uniform vec3 tint;
uniform float exposureRatio;
varying vec2 vUv;
${LENS_FLARE_SAMPLING_GLSL}
void main() {
  vec4 glare = flareSample(sourceTexture, vUv);
  gl_FragColor = flareBound(glare.rgb * tint * intensity * exposureRatio, glare.a);
}
`;

export const LENS_FLARE_COMPOSITION_FRAGMENT = `
uniform sampler2D sourceTexture;
uniform sampler2D glareTexture;
uniform bool flareEnabled;
uniform bool diagnosticOnly;
varying vec2 vUv;
${LENS_FLARE_SAMPLING_GLSL}
void main() {
  vec4 source = texelFetch(sourceTexture, ivec2(gl_FragCoord.xy), 0);
  if (!flareEnabled) { gl_FragColor = diagnosticOnly ? vec4(0.0) : source; return; }
  vec4 glare = texelFetch(glareTexture, ivec2(gl_FragCoord.xy), 0);
  vec4 boundedSource = flareBound(source.rgb, any(isnan(source)) || any(isinf(source)) ? 1.0 : 0.0);
  vec4 composed = flareBound(boundedSource.rgb + glare.rgb, max(boundedSource.a, glare.a));
  float coverage = isnan(source.a) || isinf(source.a) ? 0.0 : source.a;
  gl_FragColor = diagnosticOnly ? vec4(composed.a, boundedSource.a, glare.a, 1.0) : vec4(composed.rgb, coverage);
}
`;
