import { buildNormalFromDepthGlsl, MSM_NORMAL_FROM_DEPTH_UNIFORMS } from './msmNormalFromDepthGlsl.js';
import { buildTemporalGlsl, MSM_TEMPORAL_UNIFORMS } from './msmTemporalGlsl.js';
import { buildMsmHistoryFallbackGlsl } from './msmHistoryFallbackGlsl.js';
import { buildSpatialFilterGlsl } from './msmSpatialFilterGlsl.js';
import { buildMsmMomentStorageGlsl } from './msmMomentStorageCore.js';
import { buildMsmSampleAddressGlsl, MSM_SAMPLE_ADDRESS_UNIFORMS } from './msmSampleAddressGlsl.js';

const declarations = specs => specs.map(({ name, glslType }) => 'uniform ' + glslType + ' ' + name + ';').join('\n');
const scene = ['precision highp float;', 'varying vec2 vUv;', '#include <packing>',
  declarations(MSM_NORMAL_FROM_DEPTH_UNIFORMS), buildNormalFromDepthGlsl(),
  declarations(MSM_SAMPLE_ADDRESS_UNIFORMS), buildMsmSampleAddressGlsl()].join('\n');
const temporal = [scene, declarations(MSM_TEMPORAL_UNIFORMS),
  'uniform float uMsmHistoryValid;', 'uniform float uMsmCoarseHistoryValid;',
  'uniform mat4 uMsmPreviousViewFromCurrentView;', 'uniform vec3 uMsmSignalLuminance;',
  'uniform sampler2D tMsmPreviousMoments;', 'uniform sampler2D tMsmTemporalResult;',
  buildTemporalGlsl(), buildMsmHistoryFallbackGlsl(), buildMsmMomentStorageGlsl(),
  `vec3 msmSampleViewPosition(vec2 uv) {
    float sampleDepth = texture2D(tMsmIrradianceCurrent, uv).a;
    return msmSamplePositionFromDepth(uv, sampleDepth);
  }`,
  `float msmGeometryConfidence(vec3 position, vec3 reprojection, float historyDepth) {
    float expectedDepth = -(uMsmPreviousViewFromCurrentView * vec4(position, 1.0)).z;
    float depthError = abs(expectedDepth - historyDepth) / max(expectedDepth, 0.0001);
    return reprojection.z * uMsmHistoryValid * step(depthError, 0.02);
  }`,
].join('\n');

export function buildMsmTemporalPassShader() {
  return temporal + `
void main() {
  vec3 position = msmSampleViewPosition(vUv);
  if (msmIsSkyViewDepth(-position.z)) { gl_FragColor = vec4(0.0, 0.0, 0.0, -position.z); return; }
  vec3 centre;
  vec3 minimumValue;
  vec3 maximumValue;
  msmSampleCurrentNeighbourhood(vUv, centre, minimumValue, maximumValue);
  vec3 reprojection = msmReprojectToPreviousUv(position);
  vec4 history = texture2D(tMsmIrradianceHistory, reprojection.xy);
  float confidence = msmGeometryConfidence(position, reprojection, history.a);
  vec3 prior = msmHistoryCoarsePrior(tMsmIrradianceHistory, reprojection.xy);
  float luminance = max(dot(maximumValue, uMsmSignalLuminance), 0.0);
  vec3 resolved = msmResolvedHistory(history.rgb, confidence, prior,
    uMsmCoarseHistoryValid * reprojection.z, minimumValue, maximumValue, luminance);
  resolved = clamp(resolved, minimumValue, maximumValue);
  vec3 sampleValue = msmFireflyClampedSample(centre, maximumValue, luminance);
  float alpha = uMsmHistoryValid > 0.5 ? max(uMsmTemporalAlpha, (1.0 - confidence) * 0.5) : 1.0;
  gl_FragColor = vec4(mix(resolved, sampleValue, alpha), -position.z);
}`;
}

export function buildMsmMomentPassShader() {
  return temporal + `
void main() {
  vec3 position = msmSampleViewPosition(vUv);
  vec3 reprojection = msmReprojectToPreviousUv(position);
  float historyDepth = texture2D(tMsmIrradianceHistory, reprojection.xy).a;
  float confidence = msmGeometryConfidence(position, reprojection, historyDepth);
  float alpha = uMsmHistoryValid > 0.5 ? max(uMsmTemporalAlpha, (1.0 - confidence) * 0.5) : 1.0;
  vec2 oldMoments = msmDecodeMoments(texture2D(tMsmPreviousMoments, reprojection.xy).rg);
  float current = max(dot(texture2D(tMsmIrradianceCurrent, vUv).rgb, uMsmSignalLuminance), 0.0);
  float mean = max(dot(texture2D(tMsmTemporalResult, vUv).rgb, uMsmSignalLuminance), 0.0);
  float secondMoment = mix(oldMoments.y, current * current, alpha);
  gl_FragColor = vec4(msmEncodeMoments(vec2(mean, max(mean * mean, secondMoment))), 0.0, 1.0);
}`;
}

export function buildMsmSpatialPassShader() {
  return [scene,
    'vec3 msmDecodeStoredIrradiance(vec3 value) { return value; }',
    buildMsmMomentStorageGlsl(),
    buildSpatialFilterGlsl({ logMoments: true, storedSampleDepth: true }),
    `void main() {
      float sampleDepth = texture2D(tMsmSpatialSource, vUv).a;
      vec3 position = msmSamplePositionFromDepth(vUv, sampleDepth);
      vec3 normal = msmViewNormalFromDepth(msmRuntimeSampleUv(vUv), position);
      vec3 value = msmSpatialFilterPixel(vUv, position, normal);
      gl_FragColor = vec4(value, -position.z);
    }`,
  ].join('\n');
}
