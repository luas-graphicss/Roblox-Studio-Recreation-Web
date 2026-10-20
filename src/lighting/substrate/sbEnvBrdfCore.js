export const SB_AVERAGE_FRESNEL_TAIL_WEIGHT = 1 / 21


export const SB_MINIMUM_WHITE_FURNACE_ALBEDO = 0.02


const MINIMUM_SHADOWING_DENOMINATOR = 1e-6


export const SB_WHITE_FURNACE_ALBEDO_COEFFICIENTS = Object.freeze([
	Object.freeze([0.1744330594, 0.5976678147, 14.42459188, -32.78694665, 17.98884052]),
	Object.freeze([-1.729990084, -5.45761951, -21.73357548, 68.47866124, -40.76661399]),
	Object.freeze([4.752083424, 9.740275334, -3.028875832, -38.53529225, 28.3221375]),
	Object.freeze([-2.502480839, -4.801208061, 9.768658266, 3.49959176, -6.358491114]),
])


export const SB_WHITE_FURNACE_FIT_MEASUREMENT = Object.freeze({
	referenceSeed: 20260905,
	referenceSampleCount: 2048,
	gridSize: 16,
	worstDeviationOnGateGrid: 0.0082,
	worstDeviationOnFullDomain: 0.0154,
	referenceNoiseAt256Samples: 0.0102,
})


export function smithShadowingVariable(cosThetaView, roughness) {
	const alpha = roughness * roughness
	const clampedCosine = Math.min(Math.max(cosThetaView, 0), 1)
	const sinTheta = Math.sqrt(Math.max(0, 1 - clampedCosine * clampedCosine))
	const smithA = clampedCosine / Math.max(alpha * sinTheta, MINIMUM_SHADOWING_DENOMINATOR)
	return 1 / (1 + smithA)
}


function evaluateAnglePolynomial(coefficients, shadowing) {
	let accumulated = coefficients[coefficients.length - 1]
	for (let index = coefficients.length - 2; index >= 0; index -= 1) {
		accumulated = accumulated * shadowing + coefficients[index]
	}
	return accumulated
}


export function whiteFurnaceMissingEnergy(cosThetaView, roughness) {
	const shadowing = smithShadowingVariable(cosThetaView, roughness)
	const rows = SB_WHITE_FURNACE_ALBEDO_COEFFICIENTS
	let accumulated = 0
	for (let index = rows.length - 1; index >= 0; index -= 1) {
		accumulated = accumulated * roughness + evaluateAnglePolynomial(rows[index], shadowing)
	}
	return accumulated * roughness
}


export function whiteFurnaceDirectionalAlbedo(cosThetaView, roughness) {
	const albedo = 1 - whiteFurnaceMissingEnergy(cosThetaView, roughness)
	if (!Number.isFinite(albedo)) return 1
	return Math.min(Math.max(albedo, SB_MINIMUM_WHITE_FURNACE_ALBEDO), 1)
}


export function averageFresnel(f0, f90) {
	return [
		f0[0] + (f90 - f0[0]) * SB_AVERAGE_FRESNEL_TAIL_WEIGHT,
		f0[1] + (f90 - f0[1]) * SB_AVERAGE_FRESNEL_TAIL_WEIGHT,
		f0[2] + (f90 - f0[2]) * SB_AVERAGE_FRESNEL_TAIL_WEIGHT,
	]
}


export function multiScatterEnergyScaleForChannel(whiteAlbedo, averageFresnelChannel) {
	const albedo = Math.min(Math.max(whiteAlbedo, SB_MINIMUM_WHITE_FURNACE_ALBEDO), 1)
	return 1 + (averageFresnelChannel * (1 - albedo)) / albedo
}


export function multiScatterEnergyScale(whiteAlbedo, averageFresnelValue) {
	return [
		multiScatterEnergyScaleForChannel(whiteAlbedo, averageFresnelValue[0]),
		multiScatterEnergyScaleForChannel(whiteAlbedo, averageFresnelValue[1]),
		multiScatterEnergyScaleForChannel(whiteAlbedo, averageFresnelValue[2]),
	]
}
