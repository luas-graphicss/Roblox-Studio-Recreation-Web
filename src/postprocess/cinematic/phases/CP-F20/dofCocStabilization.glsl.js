import { DOF_SAMPLING_GLSL } from "./dofSampling.glsl.js";
export const DOF_COC_STABILIZATION_FRAGMENT = `
precision highp float;
varying vec2 vUv;
uniform sampler2D uCoc;
uniform sampler2D uDepth;
uniform sampler2D uCoverage;
uniform sampler2D uVelocity;
uniform sampler2D uReactive;
uniform sampler2D uPreviousGuide;
uniform vec2 uSize;
uniform vec2 uFullSize;
uniform vec2 uJitterDelta;
uniform vec3 uTolerances;
uniform float uRelativeCoc;
uniform float uMaximumCoc;
uniform float uMaximumMotion;
uniform float uCocHistoryWeight;
uniform bool uHistoryAllowed;
${DOF_SAMPLING_GLSL}
void main() {
  vec2 currentUv = gl_FragCoord.xy / uSize;
  float depth = texture2D(uDepth, currentUv).r;
  float coc = texture2D(uCoc, currentUv).r;
  float coverage = texture2D(uCoverage, currentUv).r;
  bool valid = finiteValue(depth) && depth > 0.0 && depth <= 1.0e20 && finiteValue(coc) && abs(coc) <= uMaximumCoc && finiteValue(coverage) && coverage >= 0.0 && coverage <= 1.0;
  if (!valid) { gl_FragColor = vec4(0.0); return; }
  vec4 guide = vec4(log2(max(depth, 1.0e-20)), coc, coverage, 1.0);
  vec4 velocity = texture2D(uVelocity, currentUv);
  vec2 previousUv = reprojectUv(currentUv, velocity.rg, uSize, uFullSize, uJitterDelta);
  float reactive = texture2D(uReactive, currentUv).r;
  if (uHistoryAllowed && validMotion(velocity, uFullSize, uMaximumMotion) && insidePixelBounds(previousUv, uSize) && finiteValue(reactive) && reactive >= 0.0 && reactive < 1.0) {
    vec4 previousGuide = texture2D(uPreviousGuide, previousUv);
    if (compatibleGuides(guide, previousGuide, uTolerances, uRelativeCoc)) guide.g = mix(coc, previousGuide.g, uCocHistoryWeight * (1.0 - reactive));
  }
  gl_FragColor = guide;
}
`;
