import {
	MSM_ESTIMATOR_HOST_FUNCTIONS,
	MSM_FULL_VISIBILITY,
	MSM_NO_VISIBILITY,
} from "./msmEstimatorCore.js";


import { toGlslFloatLiteral } from "./msmNormalFromDepthGlsl.js";
import { MSM_SAMPLE_SELECT_STRUCT_NAME } from "./msmSampleSelectGlsl.js";


export const MSM_SAMPLE_SHADING_PHASE_ID = "MSM-F21";


export const MSM_SAMPLE_SHADING_UNIFORMS = Object.freeze([]);


export const MSM_SAMPLE_SHADING_BORROWED_UNIFORMS = Object.freeze([
	Object.freeze({
		name: "uMsmStreamCount",
		glslType: "float",
		owner: "MSM-F14",
		carries: "samples per pixel of the tier: 1.0, or 2.0 on medium",
	}),
]);


export const MSM_SAMPLE_SHADING_HOST_FUNCTIONS = MSM_ESTIMATOR_HOST_FUNCTIONS;


export const MSM_SAMPLE_SHADING_REQUIRED_STRUCTS = Object.freeze([
	Object.freeze({ name: MSM_SAMPLE_SELECT_STRUCT_NAME, owner: "MSM-F14" }),
]);


export const MSM_SAMPLE_SHADING_FUNCTIONS = Object.freeze([
	"msmClampVisibility",
	"msmEstimatorChannel",
	"msmSampleIrradiance",
	"msmShadeReservoirStream",
	"msmShadeReservoir",
]);


export function buildSampleShadingGlsl() {
	return `
                                                                                     
                                                                                

                                                                           
                                                                         
float msmClampVisibility(const in float visibility) {
  return clamp(visibility, ${toGlslFloatLiteral(MSM_NO_VISIBILITY)}, ${toGlslFloatLiteral(MSM_FULL_VISIBILITY)});
}

                                                                              
                                                                           
                                                                             
                                      
float msmEstimatorChannel(const in float totalWeight, const in float chromaticityChannel, const in float visibility) {
  return totalWeight * chromaticityChannel * visibility;
}

vec3 msmSampleIrradiance(const in float totalWeight, const in vec3 chromaticity, const in float visibility) {
  float clampedVisibility = msmClampVisibility(visibility);
  return vec3(
    msmEstimatorChannel(totalWeight, chromaticity.r, clampedVisibility),
    msmEstimatorChannel(totalWeight, chromaticity.g, clampedVisibility),
    msmEstimatorChannel(totalWeight, chromaticity.b, clampedVisibility)
  );
}

                                                                               
                                                                                
                                              
vec3 msmShadeReservoirStream(const in float totalWeight, const in float pickedIndex) {
  int candidateSlot = int(max(pickedIndex, 0.0));
  vec3 chromaticity = msmCandidateChromaticity(candidateSlot);
  float visibility = msmSampleVisibility(candidateSlot);
  float shaded = step(0.0, pickedIndex);
  return msmSampleIrradiance(totalWeight, chromaticity, visibility) * shaded;
}

                                                                             
                                                                             
                                                                    
vec3 msmShadeReservoir(const in ${MSM_SAMPLE_SELECT_STRUCT_NAME} reservoir) {
  vec3 accumulated = msmShadeReservoirStream(reservoir.totalWeight, reservoir.pickedIndexStream0);
  float shadedStreamCount = step(0.0, reservoir.pickedIndexStream0);
  if (uMsmStreamCount > 1.0) {
    accumulated += msmShadeReservoirStream(reservoir.totalWeight, reservoir.pickedIndexStream1);
    shadedStreamCount += step(0.0, reservoir.pickedIndexStream1);
  }
  return shadedStreamCount > 0.0 ? accumulated / shadedStreamCount : vec3(0.0);
}
`;
}
