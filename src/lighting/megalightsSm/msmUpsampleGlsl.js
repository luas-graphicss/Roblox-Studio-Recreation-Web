import {
	MSM_UPSAMPLE_BILATERAL_TAP_COUNT,
	MSM_UPSAMPLE_BILINEAR_TAP_COUNT,
	MSM_UPSAMPLE_MINIMUM_ACCEPTED_WEIGHT,
	MSM_UPSAMPLE_MINIMUM_VIEW_DEPTH,
	MSM_UPSAMPLE_OWNER,
} from "./msmUpsampleCore.js";
import { MSM_IRRADIANCE_HISTORY_BUFFER_ID } from "./msmPipelineContract.js";
import { toGlslFloatLiteral } from "./msmNormalFromDepthGlsl.js";


export const MSM_UPSAMPLE_SOURCE_BUFFER_ID = MSM_IRRADIANCE_HISTORY_BUFFER_ID;


export const MSM_UPSAMPLE_SAMPLER_COUNT = 1;
export const MSM_UPSAMPLE_NEW_TEXTURE_UNITS = 0;


export const MSM_UPSAMPLE_UNIFORMS = Object.freeze([
	Object.freeze({
		name: "tMsmUpsampleSource",
		type: "sampler2D",
		note:
			"reduced irradiance (" +
			MSM_UPSAMPLE_SOURCE_BUFFER_ID +
			"), already charged by the composite patch slot",
	}),
	Object.freeze({
		name: "uMsmUpsampleSourceResolution",
		type: "vec2",
		note: "width and height of the reduced buffer, in texels",
	}),
	Object.freeze({
		name: "uMsmUpsampleSourceTexel",
		type: "vec2",
		note: "one over the resolution: the size of one source texel in uv",
	}),
	Object.freeze({
		name: "uMsmUpsampleTapCount",
		type: "float",
		note: "the rung: 1 for the bilinear fetch, 4 for the bilateral taps",
	}),
	Object.freeze({
		name: "uMsmUpsampleRelativeDepthTolerance",
		type: "float",
		note: "accepted depth difference as a FRACTION of the destination depth",
	}),
]);


export const MSM_UPSAMPLE_REQUIRED_FUNCTIONS = Object.freeze(["msmViewDepthAt", "msmIsSkyViewDepth"]);


export const MSM_UPSAMPLE_FUNCTIONS = Object.freeze([
	"msmUpsampleTapUv",
	"msmUpsampleDepthWeight",
	"msmUpsampleIrradiance",
]);

let cachedChunk = null;
let cachedStoredDepthChunk = null;

function buildChunkText(storedDepth = false) {
	const minimumViewDepth = toGlslFloatLiteral(MSM_UPSAMPLE_MINIMUM_VIEW_DEPTH);
	const minimumAcceptedWeight = toGlslFloatLiteral(MSM_UPSAMPLE_MINIMUM_ACCEPTED_WEIGHT);
	const bilinearTapCount = toGlslFloatLiteral(MSM_UPSAMPLE_BILINEAR_TAP_COUNT);

	return `   ${(MSM_UPSAMPLE_OWNER, "")}                                                
                                                                                
                                                  

                                                                           
                                                                      
vec2 msmUpsampleTapUv(const in vec2 baseTexel, const in vec2 tapOffset) {
	vec2 halfTexel = uMsmUpsampleSourceTexel * 0.5;
	vec2 tapUv = (baseTexel + tapOffset + 0.5) * uMsmUpsampleSourceTexel;
	return clamp(tapUv, halfTexel, 1.0 - halfTexel);
}

                                                                              
                                                                                 
                                                                        
float msmUpsampleDepthWeight(const in float destinationViewDepth, const in float tapViewDepth) {
	float depthScale = max(destinationViewDepth, ${minimumViewDepth});
	float relativeDifference = abs(destinationViewDepth - tapViewDepth) / depthScale;
	float similarity = 1.0 - relativeDifference / uMsmUpsampleRelativeDepthTolerance;
	return msmIsSkyViewDepth(tapViewDepth) ? 0.0 : clamp(similarity, 0.0, 1.0);
}

vec3 msmUpsampleIrradiance(const in vec2 uv, const in float destinationViewDepth, const in vec3 historyIrradiance) {
	                                                                          
	                                                                         
	if (${bilinearTapCount} >= uMsmUpsampleTapCount) {
		return texture2D(tMsmUpsampleSource, uv).rgb;
	}

	vec2 sourceTexelCoordinate = uv * uMsmUpsampleSourceResolution - 0.5;
	vec2 baseTexel = floor(sourceTexelCoordinate);
	vec2 fraction = sourceTexelCoordinate - baseTexel;

	vec3 weightedIrradiance = vec3(0.0);
	float totalWeight = 0.0;

	                                                                            
	                                                                         
	                                                                           
	                                                                
	for (int tapIndex = 0; tapIndex < ${MSM_UPSAMPLE_BILATERAL_TAP_COUNT}; tapIndex++) {
		if (float(tapIndex) >= uMsmUpsampleTapCount) break;

		                                                                           
		                                                                            
		vec2 tapOffset = vec2(mod(float(tapIndex), 2.0), floor(float(tapIndex) * 0.5));
		vec2 tapUv = msmUpsampleTapUv(baseTexel, tapOffset);
		float bilinearWeight = mix(1.0 - fraction.x, fraction.x, tapOffset.x) * mix(1.0 - fraction.y, fraction.y, tapOffset.y);
		vec4 tapSignal = texture2D(tMsmUpsampleSource, tapUv);
		float tapWeight = bilinearWeight * msmUpsampleDepthWeight(destinationViewDepth, ${storedDepth ? 'tapSignal.a' : 'msmViewDepthAt(tapUv)'});

		weightedIrradiance += tapSignal.rgb * tapWeight;
		totalWeight += tapWeight;
	}

	                                                                           
	                                                                          
	                                                                           
	                                              
	if (totalWeight <= ${minimumAcceptedWeight}) {
		return historyIrradiance;
	}

	return weightedIrradiance / totalWeight;
}
`;
}





export function buildMsmUpsampleGlsl({ storedDepth = false } = {}) {
	if (storedDepth) {
		if (cachedStoredDepthChunk === null) cachedStoredDepthChunk = buildChunkText(true);
		return cachedStoredDepthChunk;
	}
	if (cachedChunk === null) cachedChunk = buildChunkText();
	return cachedChunk;
}
