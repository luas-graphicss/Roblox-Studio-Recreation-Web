import {
	MSM_GRID_LOOKUP_UNIFORMS,
	buildGridLookupGlsl,
} from "./msmGridLookupGlsl.js";
import { buildImportanceGlsl } from "./msmImportanceGlsl.js";
import {
	MSM_NORMAL_FROM_DEPTH_REQUIRED_INCLUDES,
	MSM_NORMAL_FROM_DEPTH_UNIFORMS,
	buildNormalFromDepthGlsl,
	toGlslFloatLiteral,
} from "./msmNormalFromDepthGlsl.js";
import {
	MSM_SAMPLE_SELECT_UNIFORMS,
	buildSampleSelectGlsl,
} from "./msmSampleSelectGlsl.js";
import { buildSampleShadingGlsl } from "./msmSampleShadingGlsl.js";
import {
	MSM_SCREEN_TRACE_UNIFORMS,
	buildScreenTraceGlsl,
} from "./msmScreenTraceGlsl.js";
import {
	MSM_BLUE_NOISE_CHANNEL_COUNT,
	MSM_BLUE_NOISE_TILE_SIZE,
	MSM_BLUE_NOISE_VALUE_LEVEL_COUNT,
} from "./msmBlueNoiseDescriptorCore.js";
import { MSM_RUNTIME_SAMPLE_UNIFORMS, buildMsmRuntimeVisibilityGlsl, buildMsmRuntimeSelectionGlsl } from './msmRuntimeSamplingGlsl.js';
import {
	MSM_LIGHT_LUMINANCE_WEIGHTS,
	MSM_LIGHT_RECORD_TEXEL_ORDER,
} from "./msmLightRecordCore.js";
import { MSM_GRID_MAX_LIGHT_COUNT } from "./msmWorldGridLayout.js";
import { MSM_OVERFLOW_UNIFORMS, buildMsmOverflowSamplingGlsl } from './msmOverflowSamplingGlsl.js';


export const MSM_SAMPLE_PASS_PROGRAM_ID = "msm-sample";


export const MSM_LIGHT_RECORD_TEXEL_COUNT = MSM_LIGHT_RECORD_TEXEL_ORDER.length;


export const MSM_LIGHT_DATA_TEXTURE_WIDTH = MSM_GRID_MAX_LIGHT_COUNT * MSM_LIGHT_RECORD_TEXEL_COUNT;


export const MSM_LIGHT_DATA_TEXTURE_HEIGHT = 1;


export const MSM_BLUE_NOISE_FETCH_TO_UNIT_SCALE =
	(MSM_BLUE_NOISE_VALUE_LEVEL_COUNT - 1) / MSM_BLUE_NOISE_VALUE_LEVEL_COUNT;


export const MSM_SAMPLE_PASS_HOST_UNIFORMS = Object.freeze([
	Object.freeze({ name: 'uMsmOutputMode', glslType: 'float' }),
	Object.freeze({ name: 'uMsmShadowStrength', glslType: 'float' }),
	Object.freeze({
		name: "tMsmLightData",
		glslType: "sampler2D",
		carries: "the light records of MSM-F6, four texels per light, one row",
	}),
	Object.freeze({
		name: "uMsmLightDataTexel",
		glslType: "vec2",
		carries: "one texel of the light data texture, in uv",
	}),
	Object.freeze({
		name: "tMsmBlueNoise",
		glslType: "sampler2D",
		carries: "the STBN-lite volume of MSM-F11, vertical atlas, NEAREST and repeat",
	}),
	Object.freeze({
		name: "uMsmBlueNoiseTexel",
		glslType: "vec2",
		carries: "one texel of that atlas, in uv",
	}),
	Object.freeze({
		name: "uMsmBlueNoiseSlice",
		glslType: "float",
		carries: "slice this frame reads, already wrapped by blueNoiseSliceForFrame",
	}),
	Object.freeze({
		name: "uMsmViewToWorld",
		glslType: "mat4",
		carries: "camera matrixWorld: the shading point reaches the world grid with it",
	}),
	Object.freeze({
		name: "uMsmWorldToView",
		glslType: "mat4",
		carries: "camera matrixWorldInverse: the light reaches the screen march with it",
	}),
	Object.freeze({
		name: "uMsmMaximumTraceDistance",
		glslType: "float",
		carries: "ceiling of the march length in view units, so a far lamp cannot buy a longer ray",
	}),
]);


export const MSM_SAMPLE_PASS_UNIFORMS = Object.freeze([
	...MSM_NORMAL_FROM_DEPTH_UNIFORMS,
	...MSM_GRID_LOOKUP_UNIFORMS,
	...MSM_SAMPLE_SELECT_UNIFORMS,
	...MSM_SCREEN_TRACE_UNIFORMS,
	...MSM_SAMPLE_PASS_HOST_UNIFORMS,
	...MSM_RUNTIME_SAMPLE_UNIFORMS,
	...MSM_OVERFLOW_UNIFORMS,
]);


export const MSM_SAMPLE_PASS_HOST_FUNCTIONS = Object.freeze([
	"msmLightRecordTexel",
	"msmCandidateLightIndex",
	"msmCandidateUniform",
	"msmCandidateWeight",
	"msmCandidateChromaticity",
	"msmSampleVisibility",
]);


export const MSM_SAMPLE_PASS_REQUIRED_INCLUDES = Object.freeze([
	"common",
	...MSM_NORMAL_FROM_DEPTH_REQUIRED_INCLUDES,
	"lights_pars_begin",
]);


function declareUniform(uniform) {
	const arrayMatch = /^(.*?)\s*\[\s*(\d+)\s*\]$/.exec(uniform.glslType);
	if (arrayMatch) return "uniform " + arrayMatch[1] + " " + uniform.name + "[" + arrayMatch[2] + "];";
	return "uniform " + uniform.glslType + " " + uniform.name + ";";
}


function luminanceWeightsGlsl() {
	const weights = MSM_LIGHT_LUMINANCE_WEIGHTS || {};
	const red = Number.isFinite(weights.red) ? weights.red : weights[0];
	const green = Number.isFinite(weights.green) ? weights.green : weights[1];
	const blue = Number.isFinite(weights.blue) ? weights.blue : weights[2];
	return (
		"vec3(" +
		toGlslFloatLiteral(red) +
		", " +
		toGlslFloatLiteral(green) +
		", " +
		toGlslFloatLiteral(blue) +
		")"
	);
}


function buildHostFunctionsGlsl() {
	const texelsPerLight = MSM_LIGHT_RECORD_TEXEL_COUNT;
	const tileSize = toGlslFloatLiteral(MSM_BLUE_NOISE_TILE_SIZE);
	const fetchToUnit = toGlslFloatLiteral(MSM_BLUE_NOISE_FETCH_TO_UNIT_SCALE);

	return `
                                                                                 
                                                                              
                                                                        
MsmGridCursor msmActiveGridCursor;
vec3 msmShadingWorldPosition;
vec3 msmShadingWorldNormal;
vec3 msmShadingViewPosition;
float msmFreshCandidateSlot = -1.0;
float msmFreshCandidateWeight = 0.0;
float msmFairnessCandidateSlot = -1.0;
float msmFairnessCandidateWeight = 0.0;
bool msmUsesOverflowPool = false;
float msmOverflowOffset = 0.0;

                                                                               
                                                                          
vec4 msmLightRecordTexel(const in int lightSlot, const in int texelOffset) {
  float column = float(lightSlot * ${texelsPerLight} + texelOffset);
  return texture2D(tMsmLightData, vec2((column + 0.5) * uMsmLightDataTexel.x, 0.5));
}

                                                                           
float msmCandidateLightIndex(const in int candidateSlot) {
  if (msmUsesOverflowPool) return msmOverflowLightIndexAt(msmOverflowOffset, candidateSlot);
  return msmGridLookupLightIndexAt(msmActiveGridCursor, candidateSlot);
}

                                                                                
                                                                                
                                                                            
                                                                              
                                                                              
                                                                            
                                        
float msmBlueNoiseChannelOf(const in vec4 noiseTexel, const in int channelIndex) {
  if (channelIndex >= 3) return noiseTexel.a;
  if (channelIndex >= 2) return noiseTexel.b;
  if (channelIndex >= 1) return noiseTexel.g;
  return noiseTexel.r;
}

float msmCandidateUniform(const in int candidateSlot) {
  float group = floor(float(candidateSlot) / ${toGlslFloatLiteral(MSM_BLUE_NOISE_CHANNEL_COUNT)});
  vec2 tileCoordinate = mod(floor(gl_FragCoord.xy) + vec2(group * 17.0, group * 29.0), vec2(${tileSize}));
  float atlasRow = uMsmBlueNoiseSlice * ${tileSize} + tileCoordinate.y;
  vec2 noiseUv = (vec2(tileCoordinate.x, atlasRow) + vec2(0.5)) * uMsmBlueNoiseTexel;
  vec4 noiseTexel = texture2D(tMsmBlueNoise, noiseUv);
  int channelIndex = candidateSlot - ${MSM_BLUE_NOISE_CHANNEL_COUNT} * (candidateSlot / ${MSM_BLUE_NOISE_CHANNEL_COUNT});
  return msmBlueNoiseChannelOf(noiseTexel, channelIndex) * ${fetchToUnit}
    + ${toGlslFloatLiteral(0.5 / MSM_BLUE_NOISE_VALUE_LEVEL_COUNT)};
}

                                                                              
                                                                             
float msmCandidateWeight(const in int candidateSlot) {
  float lightIndex = msmCandidateLightIndex(candidateSlot);
  if (0.0 > lightIndex) return 0.0;
  int lightSlot = int(lightIndex);
  vec4 positionAndRange = msmLightRecordTexel(lightSlot, 0);
  vec4 chromaticityAndLuminance = msmLightRecordTexel(lightSlot, 1);
  vec4 directionAndCosOuter = msmLightRecordTexel(lightSlot, 2);
  vec4 coneAndType = msmLightRecordTexel(lightSlot, 3);
  float weight = msmSampleImportance(
    msmShadingWorldPosition,
    msmShadingWorldNormal,
    positionAndRange.xyz,
    positionAndRange.w,
    chromaticityAndLuminance.w,
    directionAndCosOuter.xyz,
    coneAndType.x,
    directionAndCosOuter.w,
    coneAndType.z
  );
  weight *= 1.0 + msmRuntimeSpecularWeight(msmShadingWorldPosition, msmShadingWorldNormal, positionAndRange.xyz);
                                                                        
                                                                               
  if (msmUsesOverflowPool) weight /= max(msmOverflowInclusionPdf(lightIndex), 0.000001);
  if (float(candidateSlot) == msmFairnessCandidateSlot) msmFairnessCandidateWeight = weight;
  if (lightIndex == uMsmFreshLightIndex) {
    msmFreshCandidateSlot = float(candidateSlot);
    msmFreshCandidateWeight = weight;
  }
  return weight;
}

                                                                       
                                                                       
                                                                  
vec3 msmCandidateChromaticity(const in int candidateSlot) {
  float lightIndex = msmCandidateLightIndex(candidateSlot);
  if (0.0 > lightIndex) return vec3(0.0);
  vec3 chromaticity = msmLightRecordTexel(int(lightIndex), 1).rgb;
  if (uMsmOutputMode < 0.5) return chromaticity;
  vec3 surfaceToLight = msmLightRecordTexel(int(lightIndex), 0).xyz - msmShadingWorldPosition;
  vec3 directionToLight = surfaceToLight / max(length(surfaceToLight), MSM_MINIMUM_DISTANCE_TO_LIGHT);
  float normalDotLight = dot(msmShadingWorldNormal, directionToLight);
  float proposalCosine = msmWrappedCosine(normalDotLight);
  return chromaticity * max(normalDotLight, 0.0) / max(proposalCosine, 0.000001);
}

                                                                               
                                                                            
                                                                            
                                                                        
                                                                     
float msmSampleVisibility(const in int candidateSlot) {
  float lightIndex = msmCandidateLightIndex(candidateSlot);
  if (0.0 > lightIndex) return 1.0;
  vec3 lightWorldPosition = msmLightRecordTexel(int(lightIndex), 0).xyz;
  vec4 coneAndType = msmLightRecordTexel(int(lightIndex), 3);
  return mix(1.0, msmRuntimeVisibility(lightWorldPosition, coneAndType,
    msmCandidateUniform(candidateSlot), msmShadingViewPosition, msmShadingWorldPosition), uMsmShadowStrength);
}
`;
}







function buildSamplePassMainGlsl() {
	return `
void main() {
  vec2 sampleUv = msmRuntimeSampleUv(vUv);
  float centreViewDepth = msmViewDepthAt(sampleUv);

                                                                               
                                                                              
                                                                               
                                                                           
                                                
  if (msmIsSkyViewDepth(centreViewDepth)) {
    gl_FragColor = vec4(0.0, 0.0, 0.0, min(centreViewDepth, 65504.0));
    return;
  }

  msmShadingViewPosition = msmViewPositionAt(sampleUv);
  vec3 viewNormal = msmViewNormalFromDepth(sampleUv, msmShadingViewPosition);
  msmShadingWorldPosition = (uMsmViewToWorld * vec4(msmShadingViewPosition, 1.0)).xyz;
  msmShadingWorldNormal = normalize((uMsmViewToWorld * vec4(viewNormal, 0.0)).xyz);

  msmActiveGridCursor = msmGridLookupBegin(msmShadingWorldPosition);
  msmUsesOverflowPool = msmActiveGridCursor.saturated;
  if (msmUsesOverflowPool) msmOverflowOffset = msmOverflowPageOffset();
  msmFairnessCandidateSlot = msmRuntimeFairnessCursor();
  MsmReservoir reservoir = msmSelectReservoirSamples();
  vec3 irradiance = msmShadeRuntimeReservoir(reservoir);

                                                                                
                                                                                
                                          
  float shadowedLuminance = dot(irradiance, MSM_SAMPLE_PASS_LUMINANCE_WEIGHTS);
  vec3 signal = uMsmOutputMode > 0.5 ? irradiance : vec3(shadowedLuminance, max(reservoir.totalWeight, 0.0), 0.0);
  gl_FragColor = vec4(clamp(signal, vec3(0.0), vec3(65504.0)), min(centreViewDepth, 65504.0));
}
`;
}


export function buildSamplePassVertexShader() {
	return [
		"varying vec2 vUv;",
		"void main() {",
		"\tvUv = uv;",
		"\tgl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
		"}",
	].join("\n");
}

let memoizedFragmentShader = null;










export function buildSamplePassFragmentShader() {
	if (memoizedFragmentShader !== null) return memoizedFragmentShader;

	memoizedFragmentShader = [
		"// MSM P1 (msm-sample). ASSEMBLED by",
		"// src/lighting/megalightsSm/msmSamplePassGlsl.js - do not edit by hand:",
		"// every line below is generated from the chunk builders of the phases.",
		"precision highp float;",
		"varying vec2 vUv;",
		"",
		...MSM_SAMPLE_PASS_REQUIRED_INCLUDES.map((chunkName) => "#include <" + chunkName + ">"),
		"",
		"// Uniform block, generated from MSM_SAMPLE_PASS_UNIFORMS.",
		...MSM_SAMPLE_PASS_UNIFORMS.map(declareUniform),
		"",
		"const vec3 MSM_SAMPLE_PASS_LUMINANCE_WEIGHTS = " + luminanceWeightsGlsl() + ";",
		"",
		buildNormalFromDepthGlsl(),
		buildGridLookupGlsl(),
		buildImportanceGlsl(),
		buildScreenTraceGlsl(),
		buildMsmRuntimeVisibilityGlsl(),
		buildMsmOverflowSamplingGlsl(),
		buildHostFunctionsGlsl(),
		buildSampleSelectGlsl(),
		buildSampleShadingGlsl(),
		buildMsmRuntimeSelectionGlsl(),
		buildSamplePassMainGlsl(),
	].join("\n");

	return memoizedFragmentShader;
}


export function describeSamplePassProgram() {
	return {
		programId: MSM_SAMPLE_PASS_PROGRAM_ID,
		generatedOnce: true,
		uniformNames: MSM_SAMPLE_PASS_UNIFORMS.map((uniform) => uniform.name),
		hostFunctions: MSM_SAMPLE_PASS_HOST_FUNCTIONS,
		requiredIncludes: MSM_SAMPLE_PASS_REQUIRED_INCLUDES,
		lightDataTextureWidth: MSM_LIGHT_DATA_TEXTURE_WIDTH,
		lightDataTextureHeight: MSM_LIGHT_DATA_TEXTURE_HEIGHT,
		texelsPerLight: MSM_LIGHT_RECORD_TEXEL_COUNT,
		visibilitySource: 'atlas -> on-screen trace -> conservative proxies -> visible',
		writesChannels: 'A: shadowed/total luminance; B: RGB irradiance; alpha: positive view depth',
	};
}
