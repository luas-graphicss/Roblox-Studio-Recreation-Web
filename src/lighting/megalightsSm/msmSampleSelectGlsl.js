import {
	MSM_RESERVOIR_EMPTY_PICK,
	MSM_RESERVOIR_MAX_CANDIDATES,
	MSM_RESERVOIR_STREAM_OFFSET,
} from "./msmReservoirCore.js";


import { toGlslFloatLiteral } from "./msmNormalFromDepthGlsl.js";


export const MSM_SAMPLE_SELECT_UNIFORMS = Object.freeze([
	Object.freeze({
		name: "uMsmCandidateCount",
		glslType: "int",
		carries: "how many slots of the cell list carry a light this frame",
	}),
	Object.freeze({
		name: "uMsmStreamCount",
		glslType: "float",
		carries: "samples per pixel of the tier: 1.0, or 2.0 on medium",
	}),
]);


export const MSM_SAMPLE_SELECT_HOST_FUNCTIONS = Object.freeze([
	Object.freeze({
		name: "msmCandidateWeight",
		signature: "float msmCandidateWeight(const in int candidateSlot)",
		owner: "MSM-F13",
		carries: "importance weight of the candidate, zero when it is below the threshold",
	}),
	Object.freeze({
		name: "msmCandidateUniform",
		signature: "float msmCandidateUniform(const in int candidateSlot)",
		owner: "MSM-F11",
		carries: "independent uniform per candidate on [0, 1), ALU only",
	}),
]);


export const MSM_SAMPLE_SELECT_FUNCTIONS = Object.freeze([
	"msmReservoirStreamUniform",
	"msmReservoirAccepts",
	"msmSelectReservoirSamples",
]);


export const MSM_SAMPLE_SELECT_STRUCT_NAME = "MsmReservoir";


export function buildSampleSelectGlsl() {
	return `
                                                                                    
struct ${MSM_SAMPLE_SELECT_STRUCT_NAME} {
  float totalWeight;
  float consideredCount;
  float pickedIndexStream0;
  float pickedWeightStream0;
  float pickedIndexStream1;
  float pickedWeightStream1;
};

                                                                               
                                                                               
                                                                
float msmReservoirStreamUniform(const in float baseUniform, const in float streamIndex) {
  return fract(baseUniform + streamIndex * ${toGlslFloatLiteral(MSM_RESERVOIR_STREAM_OFFSET)});
}

                                                                            
                                                                 
bool msmReservoirAccepts(const in float streamUniform, const in float candidateWeight, const in float runningWeightSum) {
  return candidateWeight >= streamUniform * runningWeightSum;
}

${MSM_SAMPLE_SELECT_STRUCT_NAME} msmSelectReservoirSamples() {
  ${MSM_SAMPLE_SELECT_STRUCT_NAME} reservoir = ${MSM_SAMPLE_SELECT_STRUCT_NAME}(0.0, 0.0, ${toGlslFloatLiteral(MSM_RESERVOIR_EMPTY_PICK)}, 0.0, ${toGlslFloatLiteral(MSM_RESERVOIR_EMPTY_PICK)}, 0.0);
  for (int candidateSlot = 0; candidateSlot < ${MSM_RESERVOIR_MAX_CANDIDATES}; candidateSlot++) {
    if (candidateSlot >= uMsmCandidateCount) break;
    float candidateWeight = msmCandidateWeight(candidateSlot);
    if (!(candidateWeight > 0.0)) continue;
    reservoir.totalWeight += candidateWeight;
    reservoir.consideredCount += 1.0;
    float baseUniform = msmCandidateUniform(candidateSlot);
    if (msmReservoirAccepts(msmReservoirStreamUniform(baseUniform, 0.0), candidateWeight, reservoir.totalWeight)) {
      reservoir.pickedIndexStream0 = float(candidateSlot);
      reservoir.pickedWeightStream0 = candidateWeight;
    }
    if (uMsmStreamCount > 1.0) {
      if (msmReservoirAccepts(msmReservoirStreamUniform(baseUniform, 1.0), candidateWeight, reservoir.totalWeight)) {
        reservoir.pickedIndexStream1 = float(candidateSlot);
        reservoir.pickedWeightStream1 = candidateWeight;
      }
    }
  }
  return reservoir;
}
`;
}
