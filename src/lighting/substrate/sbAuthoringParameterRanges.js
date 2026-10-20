import { SB_STRUCTURAL_PARAMETER_RANGES } from "./sbTreeParameterRanges.js"
import { normalizeScalarF90 } from "./sbSlabF90Compatibility.js"
import { describeSlabParameters, slabParameterNames, slabParameterSchema } from "./authoring/sbSlabParameterSchema.js"


export const SB_AUTHORING_OPERATOR_PARAMETER_NAMES = Object.freeze([
	"coverage",
	"thickness",
	"transmittanceColor",
	"weight",
])

function createRange(componentCount, minimum, maximum, integer = false) {
	const range = { componentCount, minimum, maximum }
	if (integer) range.integer = true
	return Object.freeze(range)
}

function slabParameterRanges() {
	const ranges = {}
	for (const schema of describeSlabParameters()) {
		ranges[schema.name] = createRange(schema.encoding.channelCount, schema.minimum, schema.maximum, schema.integer === true)
	}
	return ranges
}

function operatorParameterRanges() {
	const ranges = {}
	for (const parameterName of SB_AUTHORING_OPERATOR_PARAMETER_NAMES) {
		const structural = SB_STRUCTURAL_PARAMETER_RANGES[parameterName]
		if (!structural) continue
		ranges[parameterName] = createRange(structural.componentCount, structural.minimum, structural.maximum)
	}
	return ranges
}


export const SB_AUTHORING_PARAMETER_RANGES = Object.freeze({
	...operatorParameterRanges(),
	...slabParameterRanges(),
})

export function authoringRangeFor(parameterName) {
	return SB_AUTHORING_PARAMETER_RANGES[parameterName] ?? null
}


export function describeValueRangeRefusal(parameterName, value) {
	const range = authoringRangeFor(parameterName)
	if (!range) return null
	const canonical = parameterName === "f90" ? normalizeScalarF90(value) : value
	const components = Array.isArray(canonical) ? canonical : [canonical]
	if (range.componentCount === 1 && Array.isArray(canonical)) return `${parameterName}: expected a scalar`
	if (range.componentCount > 1 && (!Array.isArray(canonical) || components.length !== range.componentCount)) return `${parameterName}: expected ${range.componentCount} components`
	for (const component of components) {
		if (typeof component !== "number" || !Number.isFinite(component)) {
			return parameterName + ": valor autorado nao numerico (" + String(component) + ")"
		}
		if (range.integer === true && !Number.isInteger(component)) return parameterName + ": expected an integer"
		if (component >= range.minimum && range.maximum >= component) continue
		return parameterName + ": " + component + " fora da faixa " + range.minimum + ".." + range.maximum
	}
	return null
}


export function findAuthoringRangeProblems() {
	const problems = []
	for (const parameterName of slabParameterNames()) {
		const range = authoringRangeFor(parameterName)
		const schema = slabParameterSchema(parameterName)
		if (!range) {
			problems.push("parametro de slab sem faixa de autoria: " + parameterName)
			continue
		}
		if (range.componentCount !== schema.encoding.channelCount) {
			problems.push(
				parameterName +
					": a autoria pede " +
					range.componentCount +
					" componente(s) e a SB-F4 congelou " +
					schema.encoding.channelCount,
			)
		}
		if ((range.integer === true) !== (schema.integer === true)) problems.push(parameterName + ": integer constraint differs from the shared schema")
		if (range.minimum !== schema.minimum || range.maximum !== schema.maximum) {
			problems.push(parameterName + ": a faixa de autoria divergiu da faixa congelada pela SB-F4")
		}
	}
	for (const parameterName of SB_AUTHORING_OPERATOR_PARAMETER_NAMES) {
		if (!authoringRangeFor(parameterName)) {
			problems.push("parametro de operador sem faixa de autoria: " + parameterName)
		}
	}
	return problems
}

export function describeAuthoringRanges() {
	return {
		parameterCount: Object.keys(SB_AUTHORING_PARAMETER_RANGES).length,
		slabParameterCount: slabParameterNames().length,
		operatorParameterNames: [...SB_AUTHORING_OPERATOR_PARAMETER_NAMES],
		ranges: SB_AUTHORING_PARAMETER_RANGES,
		problems: findAuthoringRangeProblems(),
	}
}
