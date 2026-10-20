import {
	MSM_HISTORY_STORAGE_FLOAT,
	MSM_HISTORY_STORAGE_UNSIGNED_BYTE,
	MSM_STORED_CHANNEL_FLOOR,
	isHistoryStorageMode,
} from "./msmHistoryStorageCore.js";
import {
	MSM_NEIGHBOURHOOD_BOX_INITIAL_MAXIMUM,
	MSM_NEIGHBOURHOOD_BOX_INITIAL_MINIMUM,
	MSM_NEIGHBOURHOOD_RADIUS,
} from "./msmNeighbourhoodClampCore.js";
import { toGlslFloatLiteral } from "./msmNormalFromDepthGlsl.js";
import {
	MSM_REPROJECTION_MATRIX_UNIFORM_NAME,
	MSM_REPROJECTION_MINIMUM_CLIP_W,
} from "./msmTemporalReprojectionCore.js";

export const MSM_TEMPORAL_GLSL_OWNER = "MSM-F26";


export const MSM_TEMPORAL_CURRENT_SAMPLER_NAME = "tMsmIrradianceCurrent";
export const MSM_TEMPORAL_HISTORY_SAMPLER_NAME = "tMsmIrradianceHistory";
export const MSM_TEMPORAL_TEXEL_UNIFORM_NAME = "uMsmIrradianceTexel";
export const MSM_TEMPORAL_ALPHA_UNIFORM_NAME = "uMsmTemporalAlpha";
export const MSM_TEMPORAL_GLOBAL_SCALE_UNIFORM_NAME = "uMsmHistoryGlobalScale";


export const MSM_TEMPORAL_UNIFORMS = Object.freeze([
	Object.freeze({
		name: MSM_TEMPORAL_CURRENT_SAMPLER_NAME,
		glslType: "sampler2D",
		carries: "irradiance the sampling pass wrote THIS frame, at reduced resolution",
	}),
	Object.freeze({
		name: MSM_TEMPORAL_HISTORY_SAMPLER_NAME,
		glslType: "sampler2D",
		carries: "the accumulated history of the PREVIOUS frame, read side of the ping pong",
	}),
	Object.freeze({
		name: MSM_TEMPORAL_TEXEL_UNIFORM_NAME,
		glslType: "vec2",
		carries: "one texel of the reduced buffer, in uv - the step of the 3x3 walk",
	}),
	Object.freeze({
		name: MSM_REPROJECTION_MATRIX_UNIFORM_NAME,
		glslType: "mat4",
		carries: "previous view projection times the inverse of the current view (ADR-1)",
	}),
	Object.freeze({
		name: MSM_TEMPORAL_ALPHA_UNIFORM_NAME,
		glslType: "float",
		carries: "weight of the current frame, 0 freezes and 1 discards the history (MSM-F27)",
	}),
]);


export const MSM_TEMPORAL_BYTE_STORAGE_UNIFORMS = Object.freeze([
	Object.freeze({
		name: MSM_TEMPORAL_GLOBAL_SCALE_UNIFORM_NAME,
		glslType: "float",
		carries: "ceiling of representable irradiance for the RGBA8 fallback of section 5.1",
	}),
]);


export function msmTemporalUniformsFor(storageMode) {
	const isByteStorage = storageMode === MSM_HISTORY_STORAGE_UNSIGNED_BYTE;
	return Object.freeze(isByteStorage ? MSM_TEMPORAL_UNIFORMS.concat(MSM_TEMPORAL_BYTE_STORAGE_UNIFORMS) : MSM_TEMPORAL_UNIFORMS.slice());
}


export const MSM_TEMPORAL_REQUIRED_FUNCTIONS = Object.freeze(["msmIsSkyViewDepth"]);


export const MSM_TEMPORAL_FUNCTIONS = Object.freeze([
	"msmDecodeStoredIrradiance",
	"msmEncodeStoredIrradiance",
	"msmReprojectToPreviousUv",
	"msmSampleCurrentNeighbourhood",
	"msmTemporalAccumulate",
]);


export const MSM_TEMPORAL_SAMPLER_COUNT = 2;


export const MSM_TEMPORAL_GLUE_CONTRACT = Object.freeze({
	ownerPhase: "MSM-F22",
	historyMustNotAliasCurrent: true,
	discardHistoryOnResize: true,
	swapAfterPass: true,
	readSideFrozenForWholeFrame: true,
	note: "read side frozen for the frame, write side private, one swap at the end of P2",
});

function buildStorageGlsl(storageMode) {
	if (storageMode === MSM_HISTORY_STORAGE_UNSIGNED_BYTE) {
		return `
                                                                              
                                                                            
vec3 msmDecodeStoredIrradiance(const in vec3 storedIrradiance) {
  return storedIrradiance * storedIrradiance * ${MSM_TEMPORAL_GLOBAL_SCALE_UNIFORM_NAME};
}

vec3 msmEncodeStoredIrradiance(const in vec3 linearIrradiance) {
  return sqrt(clamp(linearIrradiance / ${MSM_TEMPORAL_GLOBAL_SCALE_UNIFORM_NAME}, 0.0, 1.0));
}
`;
	}
	return `
                                                                              
                                                                              
vec3 msmDecodeStoredIrradiance(const in vec3 storedIrradiance) {
  return storedIrradiance;
}

vec3 msmEncodeStoredIrradiance(const in vec3 linearIrradiance) {
  return max(linearIrradiance, vec3(${toGlslFloatLiteral(MSM_STORED_CHANNEL_FLOOR)}));
}
`;
}


export function buildTemporalGlsl(request) {
	const source = request && typeof request === "object" ? request : {};
	const storageMode = isHistoryStorageMode(source.storageMode) ? source.storageMode : MSM_HISTORY_STORAGE_FLOAT;
	const neighbourhoodRadius = MSM_NEIGHBOURHOOD_RADIUS;

	return `
                                                                          
${buildStorageGlsl(storageMode)}
                                                                               
                                                                          
                                                                               
                                                                                
                                                                 
vec3 msmReprojectToPreviousUv(const in vec3 currentViewPosition) {
  vec4 previousClipPosition = ${MSM_REPROJECTION_MATRIX_UNIFORM_NAME} * vec4(currentViewPosition, 1.0);
  float isInFrontOfCamera = previousClipPosition.w > 0.0 ? 1.0 : 0.0;
                                                                            
                                                                     
  float safeClipW = max(previousClipPosition.w, ${toGlslFloatLiteral(MSM_REPROJECTION_MINIMUM_CLIP_W)});
  vec2 previousUv = previousClipPosition.xy / safeClipW * 0.5 + 0.5;
  vec2 insideScreen = step(vec2(0.0), previousUv) * step(previousUv, vec2(1.0));
  float hasSurface = msmIsSkyViewDepth(-currentViewPosition.z) ? 0.0 : 1.0;
  return vec3(previousUv, isInFrontOfCamera * insideScreen.x * insideScreen.y * hasSurface);
}

                                                                           
                                                                          
                                                                              
void msmSampleCurrentNeighbourhood(const in vec2 uv, out vec3 storedCentre, out vec3 storedMinimum, out vec3 storedMaximum) {
  storedCentre = vec3(0.0);
  storedMinimum = vec3(${toGlslFloatLiteral(MSM_NEIGHBOURHOOD_BOX_INITIAL_MINIMUM)});
  storedMaximum = vec3(${toGlslFloatLiteral(MSM_NEIGHBOURHOOD_BOX_INITIAL_MAXIMUM)});
  for (int offsetY = -${neighbourhoodRadius}; offsetY <= ${neighbourhoodRadius}; offsetY++) {
    for (int offsetX = -${neighbourhoodRadius}; offsetX <= ${neighbourhoodRadius}; offsetX++) {
      vec2 tapOffset = vec2(float(offsetX), float(offsetY));
      vec3 tapStored = texture2D(${MSM_TEMPORAL_CURRENT_SAMPLER_NAME}, uv + ${MSM_TEMPORAL_TEXEL_UNIFORM_NAME} * tapOffset).rgb;
      float centreWeight = (1.0 - abs(tapOffset.x)) * (1.0 - abs(tapOffset.y));
      storedCentre += tapStored * centreWeight;
      storedMinimum = min(storedMinimum, tapStored);
      storedMaximum = max(storedMaximum, tapStored);
    }
  }
}

                                                                         
vec3 msmTemporalAccumulate(const in vec2 uv, const in vec3 currentViewPosition, const in float currentFrameAlpha) {
  vec3 storedCentre;
  vec3 storedMinimum;
  vec3 storedMaximum;
  msmSampleCurrentNeighbourhood(uv, storedCentre, storedMinimum, storedMaximum);

  vec3 reprojection = msmReprojectToPreviousUv(currentViewPosition);
                                                                             
                                                                                
                                                       
  vec3 storedHistory = texture2D(${MSM_TEMPORAL_HISTORY_SAMPLER_NAME}, reprojection.xy).rgb;

                                                                             
                                                                             
                                                                     
  vec3 clampedHistory = clamp(storedHistory, storedMinimum, storedMaximum);

                                                                              
                                                               
  float historyWeight = reprojection.z * (1.0 - clamp(currentFrameAlpha, 0.0, 1.0));
  vec3 blendedIrradiance = mix(msmDecodeStoredIrradiance(storedCentre), msmDecodeStoredIrradiance(clampedHistory), historyWeight);
  return msmEncodeStoredIrradiance(blendedIrradiance);
}
`;
}
