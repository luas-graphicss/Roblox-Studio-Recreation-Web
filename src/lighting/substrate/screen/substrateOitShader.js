import { insertBeforeShaderMain, appendShaderMain } from './substrateShaderInsertion.js';

export function injectOitCapture(shader, uniforms, premultipliedAlpha = false) {
  Object.assign(shader.uniforms, uniforms);
  shader.vertexShader = insertBeforeShaderMain(shader.vertexShader, 'uniform float uSbCaptureRegion;\nflat varying float vSbCaptureRegion;');
  shader.vertexShader = appendShaderMain(shader.vertexShader, `
 vSbCaptureRegion = uSbCaptureRegion;
 #ifdef USE_INSTANCING
 vSbCaptureRegion += float(gl_InstanceID);
 #endif
`);
  shader.fragmentShader = insertBeforeShaderMain(shader.fragmentShader, `
uniform sampler2D uSbPeelOpaqueDepth;
uniform sampler2D uSbPeelPreviousRank;
flat varying float vSbCaptureRegion;
layout(location = 2) out highp vec4 sbPeelRank;
uniform vec2 uSbPeelInverseSize;
uniform int uSbPeelLayer;
uniform vec3 uSbPeelTransmission;
uniform float uSbPeelThickness;
layout(location = 1) out highp vec4 sbPeelThroughput;
`);
  const main = /void\s+main\s*\(\s*\)\s*\{/;
  shader.fragmentShader = shader.fragmentShader.replace(main, `void main() {
 vec2 sbPeelUv = gl_FragCoord.xy * uSbPeelInverseSize;
 float sbOpaqueDepth = texture2D(uSbPeelOpaqueDepth, sbPeelUv).r;
 if (gl_FragCoord.z >= sbOpaqueDepth) discard;
 if (uSbPeelLayer > 0) {
   vec2 previousRank = texture2D(uSbPeelPreviousRank, sbPeelUv).rg;
   if (previousRank.y < 0.5 || gl_FragCoord.z > previousRank.x || (gl_FragCoord.z == previousRank.x && vSbCaptureRegion >= previousRank.y)) discard;
 }
`);
  shader.fragmentShader = appendShaderMain(shader.fragmentShader, `
 sbPeelRank = vec4(gl_FragCoord.z, vSbCaptureRegion, 0.0, 1.0);
 float sbPeelCoverage = clamp(gl_FragColor.a, 0.0, 1.0);
 if (sbPeelCoverage <= 0.0) discard;
 float sbPeelCosine = max(abs(dot(normalize(normal), normalize(vViewPosition))), 0.001);
 vec3 sbPeelTransmissionColor = pow(max(clamp(uSbPeelTransmission, 0.0, 1.0), vec3(0.000001)), vec3(uSbPeelThickness / sbPeelCosine));
 sbPeelThroughput = vec4((1.0 - sbPeelCoverage) * sbPeelTransmissionColor, 1.0 - sbPeelCoverage);
 gl_FragColor = vec4(gl_FragColor.rgb * ${premultipliedAlpha ? '1.0' : 'sbPeelCoverage'}, sbPeelCoverage);
`);
}
