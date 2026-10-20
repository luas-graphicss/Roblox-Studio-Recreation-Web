import { buildAtlasVisibilityGlsl, MSM_ATLAS_VISIBILITY_UNIFORMS } from './msmAtlasVisibilityGlsl.js';
import { buildMsmProxyOcclusionGlsl, msmProxyUniformSpecs } from './msmProxyOcclusionGlsl.js';
import { buildSpecularBoostGlsl } from './msmSpecularBoostGlsl.js';
import { MSM_FAIRNESS_SAMPLE_SHARE, MSM_FAIRNESS_PERIOD_FRAMES, MSM_FAIRNESS_CELL_PHASE_STRIDE,
  MSM_FAIRNESS_FRESH_LIGHT_DEADLINE_FRAMES, MSM_FAIRNESS_STRONG_WEIGHT_SHARE } from './msmFairnessCursorCore.js';
import { MSM_LIGHT_FLAG, MSM_LIGHT_TYPE_CODE } from './msmLightRecordCore.js';
import { buildMsmSampleAddressGlsl } from './msmSampleAddressGlsl.js';
import { buildMsmFairnessMixtureGlsl } from './msmFairnessMixtureCore.js';
import { toGlslFloatLiteral as number } from './msmNormalFromDepthGlsl.js';

export const MSM_RUNTIME_SAMPLE_UNIFORMS = Object.freeze([
  ...MSM_ATLAS_VISIBILITY_UNIFORMS.filter(spec => spec.name !== 'uMsmViewToWorld'),
  ...msmProxyUniformSpecs().map(spec => ({ ...spec, glslType: spec.glslType + '[' + spec.arrayLength + ']' })),
  ...['uMsmProxyOn', 'uMsmScreenTraceOn', 'uMsmFrameIndex', 'uMsmSampleDivisor', 'uMsmFairnessOn',
    'uMsmFreshLightIndex', 'uMsmFreshLightAge', 'uMsmSpecularEnabled', 'uMsmSpecularStrength',
    'uMsmSpecularRoughness'].map(name => ({ name, glslType: 'float' })),
  { name: 'uMsmFullResolution', glslType: 'vec2' },
]);

export function buildMsmRuntimeVisibilityGlsl() {
  return [buildAtlasVisibilityGlsl(), buildMsmProxyOcclusionGlsl({ declareUniforms: false }),
    buildSpecularBoostGlsl(), `
float msmCubeFaceIndex(vec3 direction) {
  vec3 magnitude = abs(direction);
  if (magnitude.x >= magnitude.y && magnitude.x >= magnitude.z) return direction.x >= 0.0 ? 0.0 : 1.0;
  if (magnitude.y >= magnitude.z) return direction.y >= 0.0 ? 2.0 : 3.0;
  return direction.z >= 0.0 ? 4.0 : 5.0;
}
float msmRuntimeVisibility(vec3 lightWorldPosition, vec4 coneAndType, float randomValue,
    vec3 surfaceViewPosition, vec3 surfaceWorldPosition) {
  if (mod(floor(coneAndType.w / ${number(MSM_LIGHT_FLAG.CASTS_SHADOW)}), 2.0) < 0.5) return 1.0;
  float row = coneAndType.y;
  if (row >= 0.0 && coneAndType.z == ${number(MSM_LIGHT_TYPE_CODE.point)}) row += msmCubeFaceIndex(surfaceWorldPosition - lightWorldPosition);
  float atlasVisibility = msmAtlasVisibility(row, surfaceViewPosition);
  if (atlasVisibility >= 0.0) return atlasVisibility;
  vec3 lightViewPosition = (uMsmWorldToView * vec4(lightWorldPosition, 1.0)).xyz;
  vec4 clip = uMsmProjection * vec4(lightViewPosition, 1.0);
  bool lightOnScreen = clip.w > 0.0 && abs(clip.x) <= clip.w && abs(clip.y) <= clip.w;
  if (uMsmScreenTraceOn > 0.5 && lightOnScreen) {
    vec3 segment = lightViewPosition - surfaceViewPosition;
    float distanceToLight = length(segment);
    return msmScreenTraceVisibility(surfaceViewPosition, segment / max(distanceToLight, 0.0001),
      min(distanceToLight, uMsmMaximumTraceDistance), randomValue);
  }
  if (uMsmProxyOn > 0.5) return msmProxyVisibility(surfaceWorldPosition, lightWorldPosition);
  return 1.0;
}
float msmRuntimeSpecularWeight(vec3 position, vec3 normal, vec3 lightPosition) {
  vec3 toLight = normalize(lightPosition - position);
  vec3 toView = normalize(uMsmViewToWorld[3].xyz - position);
  vec3 halfVector = normalize(toLight + toView);
  return msmSpecularBoostFromScalars(dot(normal, halfVector), dot(toView, halfVector),
    dot(normal, toView), dot(normal, toLight), uMsmSpecularRoughness,
    uMsmSpecularStrength, uMsmSpecularEnabled);
}`].join('\n');
}

export function buildMsmRuntimeSelectionGlsl() {
  return `
${buildMsmSampleAddressGlsl()}

${buildMsmFairnessMixtureGlsl()}
float msmRuntimeFairnessCursor() {
  float count = min(float(uMsmCandidateCount), msmActiveGridCursor.lightCount);
  return mod(floor(uMsmFrameIndex / ${number(MSM_FAIRNESS_PERIOD_FRAMES)})
    + max(msmActiveGridCursor.cellIndex, 0.0) * ${number(MSM_FAIRNESS_CELL_PHASE_STRIDE)}, max(count, 1.0));
}
vec3 msmShadeFairStream(MsmReservoir reservoir, float importancePick, float importanceWeight, float stream) {
  float count = min(float(uMsmCandidateCount), msmActiveGridCursor.lightCount);
  if (count < 1.0 || reservoir.totalWeight <= 0.0) return vec3(0.0);
  float cursor = msmFairnessCandidateSlot;
  float cursorWeight = msmFairnessCandidateWeight;
  bool promoted = msmFreshCandidateSlot >= 0.0 && uMsmFreshLightAge < ${number(MSM_FAIRNESS_FRESH_LIGHT_DEADLINE_FRAMES)}
    && msmFreshCandidateWeight >= reservoir.totalWeight * ${number(MSM_FAIRNESS_STRONG_WEIGHT_SHARE)};
  if (promoted) { cursor = msmFreshCandidateSlot; cursorWeight = msmFreshCandidateWeight; }
  vec2 seat = mod(floor(gl_FragCoord.xy), 2.0);
  float duty = seat.y < 0.5 ? seat.x * 2.0 : 3.0 - seat.x * 2.0;
  float pick = importancePick;
  float weight = importanceWeight;
  if (mod(duty + uMsmFrameIndex + stream, ${number(MSM_FAIRNESS_PERIOD_FRAMES)}) < 0.5) {
    if (cursorWeight > 0.0) { pick = cursor; weight = cursorWeight; }
  }
                                                                                    
                                                              
  float pdf = msmFairnessProposalPdf(weight, reservoir.totalWeight, pick, cursor, cursorWeight);
  return msmShadeReservoirStream(pdf > 0.0 ? weight / pdf : 0.0, pick);
}
vec3 msmShadeRuntimeReservoir(MsmReservoir reservoir) {
  if (uMsmFairnessOn < 0.5) return msmShadeReservoir(reservoir);
  vec3 result = msmShadeFairStream(reservoir, reservoir.pickedIndexStream0, reservoir.pickedWeightStream0, 0.0);
  if (uMsmStreamCount > 1.0) result = (result + msmShadeFairStream(reservoir,
    reservoir.pickedIndexStream1, reservoir.pickedWeightStream1, 1.0)) * 0.5;
  return result;
}`;
}
