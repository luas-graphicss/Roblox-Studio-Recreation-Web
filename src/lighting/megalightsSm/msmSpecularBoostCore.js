import { saturate } from "../llFalloffCore.js";
import { MSM_IRRADIANCE_QUANTIZATION_STEP, MSM_MIRROR_ERROR_BUDGET } from "./msmImportanceCore.js";
import { MSM_SPECULAR_MODE, MSM_SPECULAR_PHASE_ID } from "./msmSpecularTierPolicyCore.js";

export { MSM_SPECULAR_PHASE_ID };


export const MSM_SPECULAR_ROUGHNESS_FLOOR = 0.25;


export const MSM_SPECULAR_BOOST_CEILING = 4;


export const MSM_DIELECTRIC_NORMAL_REFLECTANCE = 0.04;


export const MSM_SPECULAR_MINIMUM_COSINE = 0.0001;


export const MSM_SPECULAR_BOOST_THRESHOLD = MSM_IRRADIANCE_QUANTIZATION_STEP / 2;


export const MSM_SPECULAR_MIRROR_ERROR_BUDGET = MSM_MIRROR_ERROR_BUDGET;


export const MSM_SPECULAR_REFUSAL = Object.freeze({
	INVALID_INPUT: "invalidInput",
	TIER_WITHOUT_SPECULAR: "tierWithoutSpecular",
	BEHIND_SURFACE: "behindSurface",
	BEHIND_VIEW: "behindView",
	DEGENERATE_HALF_VECTOR: "degenerateHalfVector",
	BELOW_THRESHOLD: "belowThreshold",
});


export const MSM_SPECULAR_MIRROR_ARGUMENT_ORDER = Object.freeze({
	msmSpecularRoughness: Object.freeze({
		argumentNames: Object.freeze(["roughness"]),
		sameArgumentOrder: true,
		note: "the floor of the pass, applied before anything else reads the roughness",
	}),
	msmSpecularShininess: Object.freeze({
		argumentNames: Object.freeze(["roughness"]),
		sameArgumentOrder: true,
		note: "2 / roughness^4 - 2, the usual roughness to Blinn-Phong exponent map",
	}),
	msmNormalIncidenceReflectance: Object.freeze({
		argumentNames: Object.freeze(["specularStrength"]),
		sameArgumentOrder: true,
		note: "0 is a dielectric (0.04), 1 is a metal (1.0) - one knob, no G-buffer",
	}),
	msmSchlickFresnel: Object.freeze({
		argumentNames: Object.freeze(["viewDotHalf", "normalIncidenceReflectance"]),
		sameArgumentOrder: true,
		note: "Schlick with the fifth power written as square * square * one",
	}),
	msmSpecularLobeOverLambert: Object.freeze({
		argumentNames: Object.freeze(["normalDotHalf", "roughness"]),
		sameArgumentOrder: true,
		note: "normalized Blinn-Phong divided by the Lambert lobe, so PI cancels",
	}),
	msmSpecularBoostFromScalars: Object.freeze({
		argumentNames: Object.freeze([
			"normalDotHalf",
			"viewDotHalf",
			"normalDotView",
			"normalDotLight",
			"roughness",
			"specularStrength",
			"specularEnabled",
		]),
		sameArgumentOrder: true,
		note: "branchless on purpose: the cost of a sample may not depend on the pixel",
	}),
});

function isFiniteNumber(value) {
	return typeof value === "number" && Number.isFinite(value);
}

function isFiniteVector(value) {
	return Boolean(value) && isFiniteNumber(value.x) && isFiniteNumber(value.y) && isFiniteNumber(value.z);
}


export function msmSpecularRoughness(roughness) {
	const clampedRoughness = Math.min(Math.max(roughness, MSM_SPECULAR_ROUGHNESS_FLOOR), 1);
	return clampedRoughness;
}


export function msmSpecularShininess(roughness) {
	const clampedRoughness = msmSpecularRoughness(roughness);
	const squaredRoughness = clampedRoughness * clampedRoughness;
	return 2 / (squaredRoughness * squaredRoughness) - 2;
}


export function msmNormalIncidenceReflectance(specularStrength) {
	const strength = saturate(specularStrength);
	return MSM_DIELECTRIC_NORMAL_REFLECTANCE + (1 - MSM_DIELECTRIC_NORMAL_REFLECTANCE) * strength;
}


export function msmSchlickFresnel(viewDotHalf, normalIncidenceReflectance) {
	const grazing = saturate(1 - viewDotHalf);
	const grazingSquared = grazing * grazing;
	return normalIncidenceReflectance + (1 - normalIncidenceReflectance) * grazingSquared * grazingSquared * grazing;
}


export function msmSpecularLobeOverLambert(normalDotHalf, roughness) {
	const shininess = msmSpecularShininess(roughness);
	const alignment = saturate(normalDotHalf);
	return ((shininess + 2) / 8) * Math.pow(alignment, shininess);
}


export function specularEnabledFromMode(specularMode) {
	return specularMode === MSM_SPECULAR_MODE.SCALAR_BOOST || specularMode === MSM_SPECULAR_MODE.MRP_LITE ? 1 : 0;
}


export function msmSpecularBoostFromScalars(
	normalDotHalf,
	viewDotHalf,
	normalDotView,
	normalDotLight,
	roughness,
	specularStrength,
	specularEnabled,
) {
	const enabled = saturate(specularEnabled);
	const facingLight = normalDotLight >= MSM_SPECULAR_MINIMUM_COSINE ? 1 : 0;
	const facingView = normalDotView >= MSM_SPECULAR_MINIMUM_COSINE ? 1 : 0;
	const fresnel = msmSchlickFresnel(viewDotHalf, msmNormalIncidenceReflectance(specularStrength));
	const cappedBoost = Math.min(fresnel * msmSpecularLobeOverLambert(normalDotHalf, roughness), MSM_SPECULAR_BOOST_CEILING);
	const gatedBoost = cappedBoost * enabled * facingLight * facingView;
	return gatedBoost >= MSM_SPECULAR_BOOST_THRESHOLD ? gatedBoost : 0;
}


export function explainSpecularBoost(
	normalDotHalf,
	viewDotHalf,
	normalDotView,
	normalDotLight,
	roughness,
	specularStrength,
	specularEnabled,
) {
	const weight = msmSpecularBoostFromScalars(
		normalDotHalf,
		viewDotHalf,
		normalDotView,
		normalDotLight,
		roughness,
		specularStrength,
		specularEnabled,
	);
	const fresnel = msmSchlickFresnel(viewDotHalf, msmNormalIncidenceReflectance(specularStrength));
	const rawBoost = fresnel * msmSpecularLobeOverLambert(normalDotHalf, roughness);
	const terms = {
		fresnel,
		shininess: msmSpecularShininess(roughness),
		clampedRoughness: msmSpecularRoughness(roughness),
		lobeOverLambert: msmSpecularLobeOverLambert(normalDotHalf, roughness),
		rawBoost,
	};
	const clamped = rawBoost > MSM_SPECULAR_BOOST_CEILING;

	let refusal = null;
	if (saturate(specularEnabled) === 0) refusal = MSM_SPECULAR_REFUSAL.TIER_WITHOUT_SPECULAR;
	else if (normalDotLight >= MSM_SPECULAR_MINIMUM_COSINE === false) refusal = MSM_SPECULAR_REFUSAL.BEHIND_SURFACE;
	else if (normalDotView >= MSM_SPECULAR_MINIMUM_COSINE === false) refusal = MSM_SPECULAR_REFUSAL.BEHIND_VIEW;
	else if (weight === 0) refusal = MSM_SPECULAR_REFUSAL.BELOW_THRESHOLD;

	return { accepted: weight > 0, weight, rawBoost, clamped, refusal, terms };
}


export function evaluateSpecularBoost(request) {
	const settings = request && typeof request === "object" ? request : {};
	const surfaceNormal = settings.surfaceNormal;
	const directionToLight = settings.directionToLight;
	const directionToView = settings.directionToView;

	const refused = function refused(refusal) {
		return { accepted: false, weight: 0, rawBoost: 0, clamped: false, refusal, terms: null };
	};

	if (!isFiniteVector(surfaceNormal) || !isFiniteVector(directionToLight) || !isFiniteVector(directionToView)) {
		return refused(MSM_SPECULAR_REFUSAL.INVALID_INPUT);
	}
	if (!isFiniteNumber(settings.roughness) || !isFiniteNumber(settings.specularStrength)) {
		return refused(MSM_SPECULAR_REFUSAL.INVALID_INPUT);
	}

	const specularEnabled = specularEnabledFromMode(settings.specularMode);
	if (specularEnabled === 0) return refused(MSM_SPECULAR_REFUSAL.TIER_WITHOUT_SPECULAR);

	const halfX = directionToLight.x + directionToView.x;
	const halfY = directionToLight.y + directionToView.y;
	const halfZ = directionToLight.z + directionToView.z;
	const halfLength = Math.sqrt(halfX * halfX + halfY * halfY + halfZ * halfZ);
	if (halfLength >= MSM_SPECULAR_MINIMUM_COSINE === false) {
		return refused(MSM_SPECULAR_REFUSAL.DEGENERATE_HALF_VECTOR);
	}

	const halfUnitX = halfX / halfLength;
	const halfUnitY = halfY / halfLength;
	const halfUnitZ = halfZ / halfLength;

	const normalDotHalf = surfaceNormal.x * halfUnitX + surfaceNormal.y * halfUnitY + surfaceNormal.z * halfUnitZ;
	const viewDotHalf = directionToView.x * halfUnitX + directionToView.y * halfUnitY + directionToView.z * halfUnitZ;
	const normalDotView =
		surfaceNormal.x * directionToView.x + surfaceNormal.y * directionToView.y + surfaceNormal.z * directionToView.z;
	const normalDotLight =
		surfaceNormal.x * directionToLight.x + surfaceNormal.y * directionToLight.y + surfaceNormal.z * directionToLight.z;

	return explainSpecularBoost(
		normalDotHalf,
		viewDotHalf,
		normalDotView,
		normalDotLight,
		settings.roughness,
		settings.specularStrength,
		specularEnabled,
	);
}


export function describeSpecularBoostContract() {
	return {
		phaseId: MSM_SPECULAR_PHASE_ID,
		formula: "fresnel * normalizedBlinnPhong( N.H, roughness ) / lambert",
		consumerFormula: "outgoing = irradiance * ( diffuseColor + weight * specularColor ) / PI",
		roughnessFloor: MSM_SPECULAR_ROUGHNESS_FLOOR,
		boostCeiling: MSM_SPECULAR_BOOST_CEILING,
		threshold: MSM_SPECULAR_BOOST_THRESHOLD,
		thresholdDerivation: "MSM-F13 quantization step / 2 - half a bit of the RGBA8 irradiance buffer",
		newTextureUnits: 0,
		extraSamplesPerPixel: 0,
		extraVisibilityTaps: 0,
		familyOf: "mlSpecWeightAt (lightClusterCore.js, frozen by section 2.2 - read as family, never imported nor edited)",
		declaredResidues: Object.freeze([
			"no G-buffer: roughness and specular strength are injected by the pass wiring",
			"roughness floor " + MSM_SPECULAR_ROUGHNESS_FLOOR + ": a mirror lobe at 1 sample per pixel is a firefly",
			"masking and shadowing folded into the normalization, as normalized Blinn-Phong always does",
		]),
	};
}
