export const SB_UNLIT_BSDF_KIND = "unlit"


export const SB_UNLIT_PARAMETER_NAMES = Object.freeze(["emissive", "opacity"])


export const SB_LUMINANCE_WEIGHTS = Object.freeze([0.2126, 0.7152, 0.0722])


export const SB_MAXIMUM_EMISSIVE = 100000


export const SB_MAXIMUM_SATURATION = 2

export const SB_MINIMUM_RING_FREQUENCY = 0.001
export const SB_MAXIMUM_RING_FREQUENCY = 1

export const SB_UNLIT_DEFAULT_PARAMETERS = Object.freeze({
	emissive: Object.freeze([1.4, 0.82, 0.24]),
	opacity: 1,
})


export const SB_LIGHT_FUNCTION_DEFAULTS = Object.freeze({
	maskColor: Object.freeze([0.22, 0.55, 1]),
	ringFrequency: 0.075,
})


export const SB_POST_PROCESS_DEFAULTS = Object.freeze({
	tint: Object.freeze([1.08, 1, 0.9]),
	saturation: 0.35,
})

const NEUTRAL_TINT = Object.freeze([1, 1, 1])
const NEUTRAL_SATURATION = 1

function isFiniteNumber(value) {
	return typeof value === "number" && Number.isFinite(value)
}

function readScalar(value, fallback) {
	return isFiniteNumber(value) ? value : fallback
}

function readColor(value, fallback) {
	if (!Array.isArray(value) || value.length !== fallback.length) return [...fallback]
	return value.map((component, index) => (isFiniteNumber(component) ? component : fallback[index]))
}

function clamp(value, minimum, maximum) {
	if (minimum > value) return minimum
	if (value > maximum) return maximum
	return value
}

function isSameColor(color, other) {
	return color.every((component, index) => component === other[index])
}


export function unlitParameters(parameters) {
	const authored = parameters ?? {}
	return {
		emissive: readColor(authored.emissive, SB_UNLIT_DEFAULT_PARAMETERS.emissive),
		opacity: readScalar(authored.opacity, SB_UNLIT_DEFAULT_PARAMETERS.opacity),
	}
}


export function unlitClosurePayload(parameters) {
	const unlit = unlitParameters(parameters)
	return { color: unlit.emissive, opacity: clamp(unlit.opacity, 0, 1) }
}


export function unlitEnergyProblems(parameters) {
	const unlit = unlitParameters(parameters)
	const problems = []
	unlit.emissive.forEach((component, index) => {
		if (0 > component) problems.push(`emissao negativa no canal ${index}: cor emitida nao suga luz`)
		if (component > SB_MAXIMUM_EMISSIVE) problems.push(`emissao ${component} no canal ${index} passou do teto ${SB_MAXIMUM_EMISSIVE}`)
	})
	if (0 > unlit.opacity || unlit.opacity > 1) problems.push(`opacidade ${unlit.opacity} fora de 0..1`)
	return problems
}


export function relativeLuminance(color) {
	const rgb = readColor(color, [0, 0, 0])
	return rgb.reduce((total, component, index) => total + component * SB_LUMINANCE_WEIGHTS[index], 0)
}

export function lightFunctionSettings(settings) {
	const authored = settings ?? {}
	return {
		maskColor: readColor(authored.maskColor, SB_LIGHT_FUNCTION_DEFAULTS.maskColor),
		ringFrequency: readScalar(authored.ringFrequency, SB_LIGHT_FUNCTION_DEFAULTS.ringFrequency),
	}
}


export function lightFunctionPayload(settings) {
	const authored = lightFunctionSettings(settings)
	return {
		maskColor: authored.maskColor.map((component) => Math.max(0, component)),
		ringFrequency: clamp(authored.ringFrequency, SB_MINIMUM_RING_FREQUENCY, SB_MAXIMUM_RING_FREQUENCY),
	}
}


export function lightFunctionMaskAt(pixelRadius, settings) {
	const payload = lightFunctionPayload(settings)
	const radius = Math.max(0, readScalar(pixelRadius, 0))
	return 0.5 + 0.5 * Math.cos(radius * payload.ringFrequency)
}


export function lightFunctionAppliedColor(sourceColor, settings, pixelRadius) {
	const source = readColor(sourceColor, [0, 0, 0])
	const payload = lightFunctionPayload(settings)
	const mask = lightFunctionMaskAt(pixelRadius, settings)
	return source.map((component, index) => component * (1 + (payload.maskColor[index] - 1) * mask))
}

export function postProcessSettings(settings) {
	const authored = settings ?? {}
	return {
		tint: readColor(authored.tint, SB_POST_PROCESS_DEFAULTS.tint),
		saturation: readScalar(authored.saturation, SB_POST_PROCESS_DEFAULTS.saturation),
	}
}


export function postProcessPayload(settings) {
	const authored = postProcessSettings(settings)
	return {
		tint: authored.tint.map((component) => Math.max(0, component)),
		saturation: clamp(authored.saturation, 0, SB_MAXIMUM_SATURATION),
	}
}


export function postProcessAppliedColor(sourceColor, settings) {
	const source = readColor(sourceColor, [0, 0, 0])
	const payload = postProcessPayload(settings)
	const luminance = relativeLuminance(source)
	return source.map((component, index) => {
		const graded = luminance + (component - luminance) * payload.saturation
		return graded * payload.tint[index]
	})
}


export function unlitDomainProblems() {
	const problems = [...unlitEnergyProblems(SB_UNLIT_DEFAULT_PARAMETERS)]
	const luminanceSum = SB_LUMINANCE_WEIGHTS.reduce((total, weight) => total + weight, 0)
	if (Math.abs(luminanceSum - 1) > 1e-6) problems.push(`os pesos de luminancia somam ${luminanceSum} e deveriam somar 1`)

	const mask = lightFunctionPayload(SB_LIGHT_FUNCTION_DEFAULTS)
	if (mask.ringFrequency !== SB_LIGHT_FUNCTION_DEFAULTS.ringFrequency) {
		problems.push("a frequencia default da mascara caiu fora da faixa aceita")
	}
	const grade = postProcessPayload(SB_POST_PROCESS_DEFAULTS)
	if (grade.saturation !== SB_POST_PROCESS_DEFAULTS.saturation) {
		problems.push("a saturacao default da grade caiu fora da faixa aceita")
	}

	if (isSameColor(unlitClosurePayload(SB_UNLIT_DEFAULT_PARAMETERS).color, [0, 0, 0])) {
		problems.push("a cor unlit default e preta: ligar a flag nao mudaria a imagem e a prova de ignicao passaria vazia")
	}
	if (isSameColor(mask.maskColor, NEUTRAL_TINT)) {
		problems.push("a mascara default e branca: ligar a flag nao mudaria a imagem")
	}
	if (isSameColor(grade.tint, NEUTRAL_TINT) && grade.saturation === NEUTRAL_SATURATION) {
		problems.push("a grade default e neutra: ligar a flag nao mudaria a imagem")
	}
	return problems
}

export function describeUnlitDomains() {
	return {
		unlit: unlitClosurePayload(SB_UNLIT_DEFAULT_PARAMETERS),
		lightFunction: lightFunctionPayload(SB_LIGHT_FUNCTION_DEFAULTS),
		postProcess: postProcessPayload(SB_POST_PROCESS_DEFAULTS),
		luminanceWeights: [...SB_LUMINANCE_WEIGHTS],
		problems: unlitDomainProblems(),
	}
}
