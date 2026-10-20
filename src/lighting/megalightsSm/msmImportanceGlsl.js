import { FALLOFF_BLEND_UNIFORM } from "../llFalloffShader.js";
import { SPOT_CONE_MIX_UNIFORM } from "../llSpotConeContract.js";
import { MSM_LIGHT_RECORD_TEXEL_ORDER } from "./msmLightRecordCore.js";
import {
	MSM_COSINE_WRAP,
	MSM_FALLOFF_DECAY_EXPONENT,
	MSM_IMPORTANCE_MIRROR_ARGUMENT_ORDER,
	MSM_IMPORTANCE_PHASE_ID,
	MSM_IRRADIANCE_QUANTIZATION_LEVELS,
	MSM_MAX_LIGHTS_PER_CELL,
	MSM_MINIMUM_DISTANCE_TO_LIGHT,
} from "./msmImportanceCore.js";


import { toGlslFloatLiteral } from "./msmNormalFromDepthGlsl.js";


export const MSM_IMPORTANCE_FUNCTIONS = Object.freeze([
	"msmWrappedCosine",
	"msmImportanceWeightFromTerms",
	"msmImportanceIsAboveThreshold",
	"msmImportanceFromScalars",
	"msmSampleImportance",
]);


export const MSM_IMPORTANCE_CONSTANTS = Object.freeze([
	"MSM_COSINE_WRAP",
	"MSM_MINIMUM_DISTANCE_TO_LIGHT",
	"MSM_FALLOFF_DECAY_EXPONENT",
	"MSM_IRRADIANCE_QUANTIZATION_STEP",
	"MSM_MAX_LIGHTS_PER_CELL",
	"MSM_IMPORTANCE_THRESHOLD",
]);


export const MSM_IMPORTANCE_REQUIRED_HOUSE_FUNCTIONS = Object.freeze([
	Object.freeze({
		name: "getDistanceAttenuation",
		signature: "float getDistanceAttenuation(const in float lightDistance, const in float cutoffDistance, const in float decayExponent)",
		owner: "LL-F2",
		chunk: "lights_pars_begin",
		runtimeUniform: FALLOFF_BLEND_UNIFORM,
		carries: "legacy three falloff at 0, Unreal falloff at 1, mixed in between",
	}),
	Object.freeze({
		name: "getSpotAttenuation",
		signature: "float getSpotAttenuation(const in float coneCosine, const in float penumbraCosine, const in float angleCosine)",
		owner: "LL-F5",
		chunk: "lights_pars_begin",
		runtimeUniform: SPOT_CONE_MIX_UNIFORM,
		carries: "legacy smoothstep cone at 0, Unreal squared ramp at 1, mixed in between",
	}),
]);


export const MSM_IMPORTANCE_TEXTURE_UNIT_COST = 0;








export const MSM_CANDIDATE_WEIGHT_BRIDGE = Object.freeze({
	hostFunctionName: "msmCandidateWeight",
	hostSignature: "float msmCandidateWeight(const in int candidateSlot)",
	declaredBy: "MSM-F14, msmSampleSelectGlsl.js, MSM_SAMPLE_SELECT_HOST_FUNCTIONS",
	arithmeticOwner: MSM_IMPORTANCE_PHASE_ID,
	completedBy: "the pass wiring: it owns the light data fetch and the shading point",
	body: "return msmSampleImportance( surfacePosition, surfaceNormal, lightPosition, lightRange, lightLuminance, lightDirection, cosInner, cosOuter, isSpotLight );",
	recordTexelOrder: MSM_LIGHT_RECORD_TEXEL_ORDER,
	note: "isSpotLight is the typeCode of MSM-F6: 0.0 point, 1.0 spot. A point record carries cosOuter = cosInner = -1, a degenerate span that must never reach the cone curve - the branch on isSpotLight is what keeps it out.",
});

function glslCall(functionName, mirrorEntry) {
	return functionName + "( " + mirrorEntry.glslCallArguments.join(", ") + " )";
}

function glslSignature(returnType, functionName, argumentNames) {
	const declaredArguments = argumentNames.map(function declareFloat(argumentName) {
		return "const in float " + argumentName;
	});
	return returnType + " " + functionName + "( " + declaredArguments.join(", ") + " ) {";
}











export function buildImportanceGlsl() {
	const mirror = MSM_IMPORTANCE_MIRROR_ARGUMENT_ORDER;
	const distanceFalloffCall = glslCall("getDistanceAttenuation", mirror.msmDistanceFalloff);
	const spotConeCall = glslCall("getSpotAttenuation", mirror.msmSpotConeAttenuation);
	const weightFromTermsCall = glslCall("msmImportanceWeightFromTerms", mirror.msmImportanceWeightFromTerms);
	const fromScalarsCall = glslCall("msmImportanceFromScalars", mirror.msmImportanceFromScalars);

	return [
		"// MSM-F13: importance weight of one candidate light, ALU only, no fetch.",
		"// GENERATED from msmImportanceCore.js - do not hand edit this text.",
		"const float MSM_COSINE_WRAP = " + toGlslFloatLiteral(MSM_COSINE_WRAP) + ";",
		"const float MSM_MINIMUM_DISTANCE_TO_LIGHT = " + toGlslFloatLiteral(MSM_MINIMUM_DISTANCE_TO_LIGHT) + ";",
		"const float MSM_FALLOFF_DECAY_EXPONENT = " + toGlslFloatLiteral(MSM_FALLOFF_DECAY_EXPONENT) + ";",
		"const float MSM_IRRADIANCE_QUANTIZATION_STEP = " +
			toGlslFloatLiteral(1) +
			" / " +
			toGlslFloatLiteral(MSM_IRRADIANCE_QUANTIZATION_LEVELS) +
			";",
		"const float MSM_MAX_LIGHTS_PER_CELL = " + toGlslFloatLiteral(MSM_MAX_LIGHTS_PER_CELL) + ";",
		"// Derived, never authored: half a bit of the buffer, split across a full cell.",
		"const float MSM_IMPORTANCE_THRESHOLD = MSM_IRRADIANCE_QUANTIZATION_STEP / " +
			toGlslFloatLiteral(2) +
			" / MSM_MAX_LIGHTS_PER_CELL;",
		"",
		glslSignature("float", "msmWrappedCosine", mirror.msmWrappedCosine.glslArgumentNames),
		"\treturn clamp( normalDotLight + MSM_COSINE_WRAP, " +
			toGlslFloatLiteral(0) +
			", " +
			toGlslFloatLiteral(1) +
			" );",
		"}",
		"",
		glslSignature("float", "msmImportanceWeightFromTerms", mirror.msmImportanceWeightFromTerms.glslArgumentNames),
		"\treturn lightLuminance * distanceFalloff * wrappedCosine * coneAttenuation;",
		"}",
		"",
		glslSignature("bool", "msmImportanceIsAboveThreshold", mirror.msmImportanceIsAboveThreshold.glslArgumentNames),
		"\treturn importanceWeight >= MSM_IMPORTANCE_THRESHOLD;",
		"}",
		"",
		"// Every DECISION of the phase, scalars only and in the order the JS core",
		"// runs them, which is what makes the mirror provable line by line.",
		glslSignature("float", "msmImportanceFromScalars", mirror.msmImportanceFromScalars.glslArgumentNames),
		"\tfloat wrappedCosine = msmWrappedCosine( normalDotLight );",
		"\tif ( wrappedCosine <= " + toGlslFloatLiteral(0) + " ) return " + toGlslFloatLiteral(0) + ";",
		"\tfloat distanceFalloff = " + distanceFalloffCall + ";",
		"\tif ( distanceFalloff <= " + toGlslFloatLiteral(0) + " ) return " + toGlslFloatLiteral(0) + ";",
		"\tfloat coneAttenuation = " + toGlslFloatLiteral(1) + ";",
		"\tif ( isSpotLight > " + toGlslFloatLiteral(0.5) + " ) coneAttenuation = " + spotConeCall + ";",
		"\tif ( coneAttenuation <= " + toGlslFloatLiteral(0) + " ) return " + toGlslFloatLiteral(0) + ";",
		"\tif ( lightLuminance <= " + toGlslFloatLiteral(0) + " ) return " + toGlslFloatLiteral(0) + ";",
		"\tfloat importanceWeight = " + weightFromTermsCall + ";",
		"\treturn msmImportanceIsAboveThreshold( importanceWeight ) ? importanceWeight : " +
			toGlslFloatLiteral(0) +
			";",
		"}",
		"",
		"// Vector plumbing, three lines, then the scalar chain above. The axis cosine",
		"// is NEGATED because MSM-F6 stores the direction the spot POINTS AT.",
		"float msmSampleImportance( const in vec3 surfacePosition, const in vec3 surfaceNormal, const in vec3 lightPosition, const in float lightRange, const in float lightLuminance, const in vec3 lightDirection, const in float cosInner, const in float cosOuter, const in float isSpotLight ) {",
		"\tvec3 surfaceToLight = lightPosition - surfacePosition;",
		"\tfloat distanceToLight = max( length( surfaceToLight ), MSM_MINIMUM_DISTANCE_TO_LIGHT );",
		"\tvec3 directionToLight = surfaceToLight / distanceToLight;",
		"\treturn " + fromScalarsCall + ";",
		"}",
		"",
	].join("\n");
}
