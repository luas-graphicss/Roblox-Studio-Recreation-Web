import {
	MSM_DIELECTRIC_NORMAL_REFLECTANCE,
	MSM_SPECULAR_BOOST_CEILING,
	MSM_SPECULAR_MINIMUM_COSINE,
	MSM_SPECULAR_MIRROR_ARGUMENT_ORDER,
	MSM_SPECULAR_PHASE_ID,
	MSM_SPECULAR_ROUGHNESS_FLOOR,
} from "./msmSpecularBoostCore.js";
import { MSM_IRRADIANCE_QUANTIZATION_LEVELS } from "./msmImportanceCore.js";


import { toGlslFloatLiteral } from "./msmNormalFromDepthGlsl.js";


export const MSM_SPECULAR_BOOST_FUNCTIONS = Object.freeze([
	"msmSpecularRoughness",
	"msmSpecularShininess",
	"msmNormalIncidenceReflectance",
	"msmSchlickFresnel",
	"msmSpecularLobeOverLambert",
	"msmSpecularBoostFromScalars",
]);


export const MSM_SPECULAR_BOOST_CONSTANTS = Object.freeze([
	"MSM_SPECULAR_ROUGHNESS_FLOOR",
	"MSM_SPECULAR_BOOST_CEILING",
	"MSM_DIELECTRIC_NORMAL_REFLECTANCE",
	"MSM_SPECULAR_MINIMUM_COSINE",
	"MSM_SPECULAR_IRRADIANCE_QUANTIZATION_STEP",
	"MSM_SPECULAR_BOOST_THRESHOLD",
]);


export const MSM_SPECULAR_TEXTURE_UNIT_COST = 0;


export const MSM_SPECULAR_HOST_INPUTS = Object.freeze([
	Object.freeze({ argument: "normalDotHalf", provider: "the pass: normal of MSM-F5 against the half vector of the sample" }),
	Object.freeze({ argument: "viewDotHalf", provider: "the pass: view direction against the half vector" }),
	Object.freeze({ argument: "normalDotView", provider: "the pass: normal of MSM-F5 against the view direction" }),
	Object.freeze({ argument: "normalDotLight", provider: "MSM-F13: the same cosine the importance already computed" }),
	Object.freeze({ argument: "roughness", provider: "the material patch of MSM-F24, or the uniform of mode A" }),
	Object.freeze({ argument: "specularStrength", provider: "the material patch of MSM-F24, or the uniform of mode A" }),
	Object.freeze({ argument: "specularEnabled", provider: "the tier policy of MSM-F25, as a uniform: 0 on micro and lite" }),
]);


export const MSM_SPECULAR_UNIFORM_NAMES = Object.freeze({
	enabled: "uMsmSpecularEnabled",
	strength: "uMsmSpecularStrength",
	roughness: "uMsmSpecularRoughness",
});

function glslSignature(functionName, argumentNames) {
	const declaredArguments = argumentNames.map(function declareFloat(argumentName) {
		return "const in float " + argumentName;
	});
	return "float " + functionName + "( " + declaredArguments.join(", ") + " ) {";
}










export function buildSpecularBoostGlsl() {
	const mirror = MSM_SPECULAR_MIRROR_ARGUMENT_ORDER;

	return [
		"// " + MSM_SPECULAR_PHASE_ID + ": specular weight of ONE sample, ALU only, no fetch, no branch.",
		"// GENERATED from msmSpecularBoostCore.js - do not hand edit this text.",
		"const float MSM_SPECULAR_ROUGHNESS_FLOOR = " + toGlslFloatLiteral(MSM_SPECULAR_ROUGHNESS_FLOOR) + ";",
		"const float MSM_SPECULAR_BOOST_CEILING = " + toGlslFloatLiteral(MSM_SPECULAR_BOOST_CEILING) + ";",
		"const float MSM_DIELECTRIC_NORMAL_REFLECTANCE = " + toGlslFloatLiteral(MSM_DIELECTRIC_NORMAL_REFLECTANCE) + ";",
		"const float MSM_SPECULAR_MINIMUM_COSINE = " + toGlslFloatLiteral(MSM_SPECULAR_MINIMUM_COSINE) + ";",
		"const float MSM_SPECULAR_IRRADIANCE_QUANTIZATION_STEP = " +
			toGlslFloatLiteral(1) +
			" / " +
			toGlslFloatLiteral(MSM_IRRADIANCE_QUANTIZATION_LEVELS) +
			";",
		"// Derived, never authored: half a bit of the RGBA8 irradiance buffer.",
		"const float MSM_SPECULAR_BOOST_THRESHOLD = MSM_SPECULAR_IRRADIANCE_QUANTIZATION_STEP / " +
			toGlslFloatLiteral(2) +
			";",
		"",
		glslSignature("msmSpecularRoughness", mirror.msmSpecularRoughness.argumentNames),
		"\treturn clamp( roughness, MSM_SPECULAR_ROUGHNESS_FLOOR, " + toGlslFloatLiteral(1) + " );",
		"}",
		"",
		glslSignature("msmSpecularShininess", mirror.msmSpecularShininess.argumentNames),
		"\tfloat clampedRoughness = msmSpecularRoughness( roughness );",
		"\tfloat squaredRoughness = clampedRoughness * clampedRoughness;",
		"\treturn " +
			toGlslFloatLiteral(2) +
			" / ( squaredRoughness * squaredRoughness ) - " +
			toGlslFloatLiteral(2) +
			";",
		"}",
		"",
		glslSignature("msmNormalIncidenceReflectance", mirror.msmNormalIncidenceReflectance.argumentNames),
		"\tfloat strength = clamp( specularStrength, " + toGlslFloatLiteral(0) + ", " + toGlslFloatLiteral(1) + " );",
		"\treturn MSM_DIELECTRIC_NORMAL_REFLECTANCE + ( " +
			toGlslFloatLiteral(1) +
			" - MSM_DIELECTRIC_NORMAL_REFLECTANCE ) * strength;",
		"}",
		"",
		glslSignature("msmSchlickFresnel", mirror.msmSchlickFresnel.argumentNames),
		"\tfloat grazing = clamp( " +
			toGlslFloatLiteral(1) +
			" - viewDotHalf, " +
			toGlslFloatLiteral(0) +
			", " +
			toGlslFloatLiteral(1) +
			" );",
		"\tfloat grazingSquared = grazing * grazing;",
		"\treturn normalIncidenceReflectance + ( " +
			toGlslFloatLiteral(1) +
			" - normalIncidenceReflectance ) * grazingSquared * grazingSquared * grazing;",
		"}",
		"",
		glslSignature("msmSpecularLobeOverLambert", mirror.msmSpecularLobeOverLambert.argumentNames),
		"\tfloat shininess = msmSpecularShininess( roughness );",
		"\tfloat alignment = clamp( normalDotHalf, " + toGlslFloatLiteral(0) + ", " + toGlslFloatLiteral(1) + " );",
		"\treturn ( shininess + " +
			toGlslFloatLiteral(2) +
			" ) / " +
			toGlslFloatLiteral(8) +
			" * pow( alignment, shininess );",
		"}",
		"",
		"// Branchless by construction: the cost of a sample may not depend on the pixel.",
		glslSignature("msmSpecularBoostFromScalars", mirror.msmSpecularBoostFromScalars.argumentNames),
		"\tfloat enabled = clamp( specularEnabled, " + toGlslFloatLiteral(0) + ", " + toGlslFloatLiteral(1) + " );",
		"\tfloat facingLight = step( MSM_SPECULAR_MINIMUM_COSINE, normalDotLight );",
		"\tfloat facingView = step( MSM_SPECULAR_MINIMUM_COSINE, normalDotView );",
		"\tfloat fresnel = msmSchlickFresnel( viewDotHalf, msmNormalIncidenceReflectance( specularStrength ) );",
		"\tfloat cappedBoost = min( fresnel * msmSpecularLobeOverLambert( normalDotHalf, roughness ), MSM_SPECULAR_BOOST_CEILING );",
		"\tfloat gatedBoost = cappedBoost * enabled * facingLight * facingView;",
		"\treturn step( MSM_SPECULAR_BOOST_THRESHOLD, gatedBoost ) * gatedBoost;",
		"}",
		"",
	].join("\n");
}
