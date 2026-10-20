const EPSILON = 1e-6


export const SB_EYE_CORNEA_IOR = 1.376


export const SB_EYE_OUTER_IOR = 1


export const SB_EYE_LIMBUS_START = 0.62


export const SB_EYE_PUPIL_SOFTNESS = 0.06


export const SB_EYE_MINIMUM_CORNEA_ROUGHNESS = 0.005


export const SB_EYE_ENERGY_CEILING = 1


export const SB_EYE_GATE_VIEW_COSINES = Object.freeze([1, 0.94, 0.82, 0.66, 0.45, 0.2])


export const SB_EYE_MINIMUM_VISIBLE_PARALLAX = 0.25


export const SB_EYE_UNIFORM_COMPONENTS = Object.freeze(["irisDepth", "pupilRadius", "corneaRoughness", "limbusDarkening"])

export const SB_EYE_PARAMETER_RANGES = Object.freeze({
	irisDepth: Object.freeze({ minimum: 0.02, maximum: 0.6 }),
	pupilRadius: Object.freeze({ minimum: 0.05, maximum: 0.6 }),
	corneaRoughness: Object.freeze({ minimum: SB_EYE_MINIMUM_CORNEA_ROUGHNESS, maximum: 0.4 }),
	corneaIor: Object.freeze({ minimum: 1.05, maximum: 1.6 }),
	limbusDarkening: Object.freeze({ minimum: 0, maximum: 1 }),
})


export function defaultEyeParameters() {
	return {
		irisColor: [0.24, 0.32, 0.42],
		irisDepth: 0.12,
		pupilRadius: 0.22,
		corneaRoughness: 0.02,
		corneaIor: SB_EYE_CORNEA_IOR,
		limbusDarkening: 0.65,
	}
}

function clampNumber(value, minimum, maximum) {
	if (value > maximum) return maximum
	if (minimum > value) return minimum
	return value
}

function numberOrFallback(value, fallback) {
	return Number.isFinite(value) ? value : fallback
}

function clampToRange(value, range) {
	return clampNumber(value, range.minimum, range.maximum)
}

function smoothstep(edgeStart, edgeEnd, value) {
	const span = edgeEnd - edgeStart
	if (EPSILON > Math.abs(span)) return value > edgeStart ? 1 : 0
	const normalized = clampNumber((value - edgeStart) / span, 0, 1)
	return normalized * normalized * (3 - 2 * normalized)
}

function sanitizeColor(rawColor, fallbackColor) {
	const source = Array.isArray(rawColor) ? rawColor : []
	return fallbackColor.map((fallbackChannel, channelIndex) =>
		clampNumber(numberOrFallback(source[channelIndex], fallbackChannel), 0, 1),
	)
}

function sanitizeNormal(rawNormal) {
	const source = Array.isArray(rawNormal) ? rawNormal : []
	const axes = [0, 1, 2].map((axisIndex) => numberOrFallback(source[axisIndex], axisIndex === 2 ? 1 : 0))
	const length = Math.sqrt(axes.reduce((total, axis) => total + axis * axis, 0))
	if (EPSILON > length) return [0, 0, 1]
	return axes.map((axis) => axis / length)
}


export function sanitizeEyeParameters(rawParameters) {
	const defaults = defaultEyeParameters()
	const source = rawParameters ?? {}
	return {
		irisColor: sanitizeColor(source.irisColor, defaults.irisColor),
		irisDepth: clampToRange(numberOrFallback(source.irisDepth, defaults.irisDepth), SB_EYE_PARAMETER_RANGES.irisDepth),
		pupilRadius: clampToRange(numberOrFallback(source.pupilRadius, defaults.pupilRadius), SB_EYE_PARAMETER_RANGES.pupilRadius),
		corneaRoughness: clampToRange(
			numberOrFallback(source.corneaRoughness, defaults.corneaRoughness),
			SB_EYE_PARAMETER_RANGES.corneaRoughness,
		),
		corneaIor: clampToRange(numberOrFallback(source.corneaIor, defaults.corneaIor), SB_EYE_PARAMETER_RANGES.corneaIor),
		limbusDarkening: clampToRange(
			numberOrFallback(source.limbusDarkening, defaults.limbusDarkening),
			SB_EYE_PARAMETER_RANGES.limbusDarkening,
		),
	}
}


export function corneaFresnelAtNormalIncidence(corneaIor = SB_EYE_CORNEA_IOR) {
	const ratio = (corneaIor - SB_EYE_OUTER_IOR) / (corneaIor + SB_EYE_OUTER_IOR)
	return ratio * ratio
}


export function corneaFresnel(cosThetaView, corneaIor = SB_EYE_CORNEA_IOR) {
	const cosine = clampNumber(numberOrFallback(cosThetaView, 0), 0, 1)
	const reflectanceAtNormal = corneaFresnelAtNormalIncidence(corneaIor)
	return reflectanceAtNormal + (1 - reflectanceAtNormal) * Math.pow(1 - cosine, 5)
}

function viewSine(cosThetaView) {
	const cosine = clampNumber(numberOrFallback(cosThetaView, 0), 0, 1)
	return Math.sqrt(Math.max(0, 1 - cosine * cosine))
}


export function refractedViewCosine(cosThetaView, corneaIor = SB_EYE_CORNEA_IOR) {
	const sineRefracted = (viewSine(cosThetaView) * SB_EYE_OUTER_IOR) / corneaIor
	return Math.sqrt(Math.max(EPSILON, 1 - sineRefracted * sineRefracted))
}


export function refractedTangent(cosThetaView, corneaIor = SB_EYE_CORNEA_IOR) {
	const sineRefracted = (viewSine(cosThetaView) * SB_EYE_OUTER_IOR) / corneaIor
	return sineRefracted / refractedViewCosine(cosThetaView, corneaIor)
}


export function flatTangent(cosThetaView) {
	const cosine = clampNumber(numberOrFallback(cosThetaView, 0), EPSILON, 1)
	return viewSine(cosine) / cosine
}


export function refractedParallaxOffset(irisDepth, cosThetaView, corneaIor = SB_EYE_CORNEA_IOR) {
	return irisDepth * refractedTangent(cosThetaView, corneaIor)
}


export function flatParallaxOffset(irisDepth, cosThetaView) {
	return irisDepth * flatTangent(cosThetaView)
}


export function maximumParallaxOffset(irisDepth, corneaIor = SB_EYE_CORNEA_IOR) {
	return irisDepth * refractedTangent(0, corneaIor)
}


export function pupilMask(irisRadius, pupilRadius) {
	const radius = clampNumber(numberOrFallback(irisRadius, 0), 0, 1)
	const pupil = clampToRange(numberOrFallback(pupilRadius, 0), SB_EYE_PARAMETER_RANGES.pupilRadius)
	return smoothstep(pupil, pupil + SB_EYE_PUPIL_SOFTNESS, radius)
}


export function limbusWeight(irisRadius, limbusDarkening) {
	const radius = clampNumber(numberOrFallback(irisRadius, 0), 0, 1)
	const amount = clampNumber(numberOrFallback(limbusDarkening, 0), 0, 1)
	return 1 - amount * smoothstep(SB_EYE_LIMBUS_START, 1, radius)
}


export function parallaxShiftedRadius(irisRadius, eyeParameters, cosThetaView) {
	const parameters = sanitizeEyeParameters(eyeParameters)
	const radius = clampNumber(numberOrFallback(irisRadius, 0), 0, 1)
	const offset = refractedParallaxOffset(parameters.irisDepth, cosThetaView, parameters.corneaIor)
	return clampNumber(radius - offset, 0, 1)
}


export function evaluateEyeBsdf(options = {}) {
	const parameters = sanitizeEyeParameters(options.eye)
	const cosine = clampNumber(numberOrFallback(options.cosThetaView, 1), 0, 1)
	const radius = clampNumber(numberOrFallback(options.irisRadius, 0), 0, 1)
	const corneaReflectance = corneaFresnel(cosine, parameters.corneaIor)
	const shiftedRadius = parallaxShiftedRadius(radius, parameters, cosine)
	const irisVisibility = pupilMask(shiftedRadius, parameters.pupilRadius) * limbusWeight(radius, parameters.limbusDarkening)
	const transmittance = 1 - corneaReflectance
	const irisScale = transmittance * irisVisibility
	return {
		cosThetaView: cosine,
		irisRadius: radius,
		shiftedRadius,
		corneaReflectance,
		transmittance,
		irisVisibility,
		irisRadiance: parameters.irisColor.map((channel) => channel * irisScale),
		energy: corneaReflectance + irisScale * Math.max(...parameters.irisColor),
	}
}


export function measureParallaxStability(eyeParameters, viewCosines = SB_EYE_GATE_VIEW_COSINES) {
	const parameters = sanitizeEyeParameters(eyeParameters)
	const sortedCosines = viewCosines.slice().sort((left, right) => right - left)
	const samples = sortedCosines.map((cosine) => {
		const refractedOffset = refractedParallaxOffset(parameters.irisDepth, cosine, parameters.corneaIor)
		return {
			cosThetaView: cosine,
			refractedOffset,
			flatOffset: flatParallaxOffset(parameters.irisDepth, cosine),
			offsetPerIrisDepth: refractedOffset / parameters.irisDepth,
			refractedCosine: refractedViewCosine(cosine, parameters.corneaIor),
		}
	})

	const offsetCeiling = maximumParallaxOffset(parameters.irisDepth, parameters.corneaIor)
	const inversions = []
	let finite = true
	let monotonic = true
	let bendsInward = true
	let bounded = true

	for (let sampleIndex = 0; samples.length > sampleIndex; sampleIndex += 1) {
		const sample = samples[sampleIndex]
		if (!Number.isFinite(sample.refractedOffset) || 0 > sample.refractedOffset) {
			finite = false
			inversions.push({ cosThetaView: sample.cosThetaView, reason: "deslocamento invalido" })
		}
		if (sample.refractedOffset > sample.flatOffset + EPSILON) {
			bendsInward = false
			inversions.push({ cosThetaView: sample.cosThetaView, reason: "refracao desviou para fora da normal" })
		}
		if (sample.refractedOffset > offsetCeiling + EPSILON) {
			bounded = false
			inversions.push({ cosThetaView: sample.cosThetaView, reason: "deslocamento acima do teto refratado" })
		}
		if (sampleIndex > 0 && samples[sampleIndex - 1].refractedOffset > sample.refractedOffset + EPSILON) {
			monotonic = false
			inversions.push({ cosThetaView: sample.cosThetaView, reason: "deslocamento encolheu com o angulo" })
		}
	}

	const grazingSample = samples[samples.length - 1]
	return {
		angleCount: samples.length,
		samples,
		inversions,
		inversionCount: inversions.length,
		finite,
		monotonic,
		bendsInward,
		bounded,
		offsetCeiling,
		minimumOffsetPerIrisDepth: samples[0].offsetPerIrisDepth,
		maximumOffsetPerIrisDepth: grazingSample.offsetPerIrisDepth,
		refractionVisible: grazingSample.offsetPerIrisDepth > SB_EYE_MINIMUM_VISIBLE_PARALLAX,
		stable: 0 === inversions.length,
	}
}


export function measureEyeEnergy(eyeParameters, viewCosines = SB_EYE_GATE_VIEW_COSINES, irisRadii = [0, 0.3, 0.7, 1]) {
	const parameters = sanitizeEyeParameters(eyeParameters)
	let worstEnergy = 0
	let worstAt = null
	for (const cosine of viewCosines) {
		for (const radius of irisRadii) {
			const evaluated = evaluateEyeBsdf({ eye: parameters, cosThetaView: cosine, irisRadius: radius })
			if (evaluated.energy > worstEnergy) {
				worstEnergy = evaluated.energy
				worstAt = { cosThetaView: cosine, irisRadius: radius }
			}
		}
	}
	return {
		worstEnergy,
		worstAt,
		ceiling: SB_EYE_ENERGY_CEILING,
		withinCeiling: SB_EYE_ENERGY_CEILING + EPSILON > worstEnergy,
		sampleCount: viewCosines.length * irisRadii.length,
	}
}


export function certifyEyeBsdf(options = {}) {
	const parameters = sanitizeEyeParameters(options.eye)
	const viewCosines = options.viewCosines ?? SB_EYE_GATE_VIEW_COSINES
	const parallax = measureParallaxStability(parameters, viewCosines)
	const energy = measureEyeEnergy(parameters, viewCosines)
	const problems = []

	if (SB_EYE_GATE_VIEW_COSINES.length > parallax.angleCount) {
		problems.push("o portao pede " + SB_EYE_GATE_VIEW_COSINES.length + " angulos, mediu " + parallax.angleCount)
	}
	if (!parallax.finite) problems.push("deslocamento invalido em algum angulo")
	if (!parallax.monotonic) problems.push("deslocamento encolheu com o angulo: inversao de parallax")
	if (!parallax.bendsInward) problems.push("refracao desviou para fora da normal")
	if (!parallax.bounded) problems.push("deslocamento acima do teto refratado")
	if (!parallax.refractionVisible) {
		problems.push(
			"refracao invisivel no angulo rasante: " +
				parallax.maximumOffsetPerIrisDepth.toFixed(3) +
				" x a profundidade da iris, minimo " +
				SB_EYE_MINIMUM_VISIBLE_PARALLAX,
		)
	}
	if (!energy.withinCeiling) problems.push("energia acima do teto: " + energy.worstEnergy.toFixed(4))

	return { ok: 0 === problems.length, problems, parameters, parallax, energy }
}


export function eyeClosurePayload(eyeParameters, normal = [0, 0, 1]) {
	const parameters = sanitizeEyeParameters(eyeParameters)
	return {
		irisColor: parameters.irisColor.slice(),
		irisDepth: parameters.irisDepth,
		pupilRadius: parameters.pupilRadius,
		corneaRoughness: parameters.corneaRoughness,
		corneaIor: parameters.corneaIor,
		limbusDarkening: parameters.limbusDarkening,
		normal: sanitizeNormal(normal),
	}
}


export function packEyeUniform(eyeParameters) {
	const parameters = sanitizeEyeParameters(eyeParameters)
	return SB_EYE_UNIFORM_COMPONENTS.map((componentName) => parameters[componentName])
}


export function describeEyeBsdf(eyeParameters) {
	const certification = certifyEyeBsdf({ eye: eyeParameters })
	return {
		owner: "SB-F25",
		closureKind: "eye",
		parameters: certification.parameters,
		uniform: {
			name: "uSbEye",
			components: SB_EYE_UNIFORM_COMPONENTS.slice(),
			value: packEyeUniform(certification.parameters),
		},
		parallax: {
			angleCount: certification.parallax.angleCount,
			minimumOffsetPerIrisDepth: certification.parallax.minimumOffsetPerIrisDepth,
			maximumOffsetPerIrisDepth: certification.parallax.maximumOffsetPerIrisDepth,
			inversionCount: certification.parallax.inversionCount,
			refractionVisible: certification.parallax.refractionVisible,
			stable: certification.parallax.stable,
		},
		energy: { worst: certification.energy.worstEnergy, ceiling: certification.energy.ceiling },
		ok: certification.ok,
		problems: certification.problems,
	}
}
