import { SB_OPERATORS } from "./sbOperatorCatalog.js"
import { sanitizeSlabParameters, slabParameterNames, slabParameterSchema } from "./sbSlabParametersCore.js"


export const SB_BLEND_WEIGHT_FLOOR = 1e-6

export const SB_BLEND_MODES = Object.freeze({
	energySum: "energySum",
	weightedMean: "weightedMean",
	varianceMean: "varianceMean",
	circularMean: "circularMean",
	dominantChoice: "dominantChoice",
})

const MODES = SB_BLEND_MODES


const BLEND_MODE_BY_PARAMETER = Object.freeze({
	albedo: MODES.energySum,
	f0: MODES.energySum,
	emissive: MODES.energySum,
	roughness: MODES.varianceMean,
	secondRoughness: MODES.varianceMean,
	fuzzRoughness: MODES.varianceMean,
	glintRoughness: MODES.varianceMean,
	anisotropyRotation: MODES.circularMean,
	specularProfileIndex: MODES.dominantChoice,
})


const ENERGY_PARAMETER_NAMES = Object.freeze(
	Object.keys(BLEND_MODE_BY_PARAMETER).filter((name) => BLEND_MODE_BY_PARAMETER[name] === MODES.energySum),
)


const TINTED_PARAMETER_NAMES = Object.freeze(["albedo", "f0", "fuzzColor", "emissive"])

const VERTICAL_LAYERING = "verticalLayering"
const HORIZONTAL_MIXING = "horizontalMixing"
const WEIGHT_OPERATOR = "weight"
const BOTTOM_CHILD_INDEX = 1
const CHANNEL_COUNT = 3
const CHANNEL_INDEXES = Object.freeze([0, 1, 2])
const LUMINANCE_WEIGHTS = Object.freeze([0.2126, 0.7152, 0.0722])
const NEUTRAL_TINT = Object.freeze([1, 1, 1])
const DEFAULT_MIXING_WEIGHT = 0.5
const MAX_REPORTED_PARAMETERS = 6

function isFiniteNumber(value) {
	return typeof value === "number" && Number.isFinite(value)
}

function toFraction(rawValue, fallback) {
	if (!isFiniteNumber(rawValue)) return fallback
	return Math.min(1, Math.max(0, rawValue))
}

function toColorChannels(rawColor) {
	if (!Array.isArray(rawColor) || rawColor.length !== CHANNEL_COUNT) return NEUTRAL_TINT.slice()
	return rawColor.map((channel) => (isFiniteNumber(channel) ? Math.max(0, channel) : 1))
}

function channelMean(color) {
	return (color[0] + color[1] + color[2]) / CHANNEL_COUNT
}

function luminanceOf(color) {
	return CHANNEL_INDEXES.reduce((total, index) => total + color[index] * LUMINANCE_WEIGHTS[index], 0)
}

function isChannelValue(value) {
	return Array.isArray(value)
}

export function blendModeFor(parameterName) {
	return BLEND_MODE_BY_PARAMETER[parameterName] ?? MODES.weightedMean
}


export function isCatalogedOperator(operatorName) {
	return Object.prototype.hasOwnProperty.call(SB_OPERATORS, operatorName)
}


export function operatorParametersOf(node) {
	if (node === null || typeof node !== "object") return {}
	if (node.parameters === null || typeof node.parameters !== "object") return node
	return { ...node, ...node.parameters }
}


export function slabReflectedEnergy(parameters) {
	const slab = sanitizeSlabParameters(parameters)
	const fuzzEnergy = slab.fuzzAmount * luminanceOf(slab.fuzzColor)
	const visibleEnergy = luminanceOf(slab.albedo) + luminanceOf(slab.f0) + fuzzEnergy + luminanceOf(slab.emissive)
	return Math.max(SB_BLEND_WEIGHT_FLOOR, visibleEnergy * slab.opacity)
}

function unattenuatedVisibility(parameters, childCount) {
	return new Array(childCount).fill(1)
}


function verticalLayeringVisibility(parameters) {
	const coverage = toFraction(parameters.coverage, 1)
	const transmittance = toFraction(channelMean(toColorChannels(parameters.transmittanceColor)), 1)
	return [coverage, 1 - coverage + coverage * transmittance]
}

function horizontalMixingVisibility(parameters) {
	const weight = toFraction(parameters.weight, DEFAULT_MIXING_WEIGHT)
	return [weight, 1 - weight]
}

function weightOperatorVisibility(parameters, childCount) {
	return new Array(childCount).fill(toFraction(parameters.weight, 1))
}

const CHILD_VISIBILITY_BY_OPERATOR = Object.freeze({
	[VERTICAL_LAYERING]: verticalLayeringVisibility,
	[HORIZONTAL_MIXING]: horizontalMixingVisibility,
	[WEIGHT_OPERATOR]: weightOperatorVisibility,
})


export function operatorChildVisibility(operatorNode, childCount = 2) {
	const resolveVisibility = CHILD_VISIBILITY_BY_OPERATOR[operatorNode?.operator] ?? unattenuatedVisibility
	const visibility = resolveVisibility(operatorParametersOf(operatorNode), childCount)
	if (visibility.length !== childCount) return unattenuatedVisibility(null, childCount)
	return visibility.map((factor) => (isFiniteNumber(factor) ? Math.max(0, factor) : 0))
}


export function transmittanceTintOf(transmittanceColor) {
	const color = toColorChannels(transmittanceColor)
	const mean = channelMean(color)
	if (SB_BLEND_WEIGHT_FLOOR > mean) return NEUTRAL_TINT.slice()
	return color.map((channel) => channel / mean)
}


export function operatorChildTints(operatorNode, childCount = 2) {
	const tints = new Array(childCount).fill(null).map(() => NEUTRAL_TINT.slice())
	if (operatorNode?.operator !== VERTICAL_LAYERING) return tints
	if (childCount > BOTTOM_CHILD_INDEX) {
		tints[BOTTOM_CHILD_INDEX] = transmittanceTintOf(operatorParametersOf(operatorNode).transmittanceColor)
	}
	return tints
}

export function multiplyTints(left, right) {
	const first = toColorChannels(left)
	const second = toColorChannels(right)
	return CHANNEL_INDEXES.map((index) => first[index] * second[index])
}


export function applyClosureTint(parameters, tint) {
	const slab = sanitizeSlabParameters(parameters)
	const color = toColorChannels(tint)
	const tinted = { ...slab }
	TINTED_PARAMETER_NAMES.forEach((name) => {
		tinted[name] = CHANNEL_INDEXES.map((index) => slab[name][index] * color[index])
	})
	return sanitizeSlabParameters(tinted)
}


export function scaleClosureEnergy(parameters, factor) {
	const slab = sanitizeSlabParameters(parameters)
	const scale = isFiniteNumber(factor) ? Math.max(0, factor) : 1
	const scaled = { ...slab }
	ENERGY_PARAMETER_NAMES.forEach((name) => {
		scaled[name] = slab[name].map((channel) => channel * scale)
	})
	return sanitizeSlabParameters(scaled)
}

function normalizeBlendInputs(blendInputs) {
	const entries = Array.isArray(blendInputs) ? blendInputs.filter((entry) => entry !== null && entry !== undefined) : []
	return entries.map((entry) => {
		const parameters = sanitizeSlabParameters(entry.parameters ?? entry)
		const visibility = isFiniteNumber(entry.visibility) ? Math.max(0, entry.visibility) : 1
		return { parameters, visibility, contribution: visibility * slabReflectedEnergy(parameters) }
	})
}


export function normalizeBlendWeights(rawWeights) {
	const weights = rawWeights.map((weight) => (isFiniteNumber(weight) && weight > 0 ? weight : 0))
	if (weights.length === 0) return []
	const total = weights.reduce((sum, weight) => sum + weight, 0)
	if (SB_BLEND_WEIGHT_FLOOR > total) return weights.map(() => 1 / weights.length)
	return weights.map((weight) => weight / total)
}

function weightedMeanOf(values, weights) {
	if (isChannelValue(values[0])) {
		return CHANNEL_INDEXES.map((channel) =>
			values.reduce((total, value, index) => total + value[channel] * weights[index], 0),
		)
	}
	return values.reduce((total, value, index) => total + value * weights[index], 0)
}

function energySumOf(values, inputs) {
	if (isChannelValue(values[0])) {
		return CHANNEL_INDEXES.map((channel) =>
			values.reduce((total, value, index) => total + value[channel] * inputs[index].visibility, 0),
		)
	}
	return values.reduce((total, value, index) => total + value * inputs[index].visibility, 0)
}

function varianceMeanOf(values, weights) {
	const variance = values.reduce((total, value, index) => total + value * value * weights[index], 0)
	return Math.sqrt(Math.max(0, variance))
}

function circularMeanOf(values, weights, schema) {
	const period = schema.encoding.rangeWidth > 0 ? schema.encoding.rangeWidth : 1
	const turnsPerUnit = (2 * Math.PI) / period
	const angles = values.map((value) => (value - schema.minimum) * turnsPerUnit)
	const cosineSum = angles.reduce((total, angle, index) => total + Math.cos(angle) * weights[index], 0)
	const sineSum = angles.reduce((total, angle, index) => total + Math.sin(angle) * weights[index], 0)
	if (SB_BLEND_WEIGHT_FLOOR > Math.hypot(cosineSum, sineSum)) return schema.defaultValue
	const blendedAngle = Math.atan2(sineSum, cosineSum) / turnsPerUnit
	return schema.minimum + (blendedAngle >= 0 ? blendedAngle : blendedAngle + period)
}

function blendParameterValue(parameterName, inputs, contributionWeights) {
	const schema = slabParameterSchema(parameterName)
	const values = inputs.map((input) => input.parameters[parameterName])
	const mode = blendModeFor(parameterName)
	if (mode === MODES.dominantChoice) return values[contributionWeights.indexOf(Math.max(...contributionWeights))]
	if (mode === MODES.energySum) return energySumOf(values, inputs)
	if (mode === MODES.varianceMean) return varianceMeanOf(values, contributionWeights)
	if (mode === MODES.circularMean) return circularMeanOf(values, contributionWeights, schema)
	return weightedMeanOf(values, contributionWeights)
}


export function blendSlabParameters(blendInputs) {
	const inputs = normalizeBlendInputs(blendInputs)
	if (inputs.length === 0) return sanitizeSlabParameters({})
	const contributionWeights = normalizeBlendWeights(inputs.map((input) => input.contribution))
	const blended = {}
	slabParameterNames().forEach((name) => {
		blended[name] = blendParameterValue(name, inputs, contributionWeights)
	})
	return sanitizeSlabParameters(blended)
}

function parameterDistance(left, right) {
	if (isChannelValue(left)) return Math.max(...left.map((channel, index) => Math.abs(channel - right[index])))
	return Math.abs(left - right)
}


function describeParameterLoss(parameterName, inputs, contributionWeights, blendedValue) {
	const schema = slabParameterSchema(parameterName)
	const rangeWidth = schema.encoding.rangeWidth > 0 ? schema.encoding.rangeWidth : 1
	const values = inputs.map((input) => input.parameters[parameterName])
	const mode = blendModeFor(parameterName)
	if (mode === MODES.dominantChoice) return {name:parameterName,mode,clamped:false,relativeDelta:values.reduce((loss,value,index) => loss + (value === blendedValue ? 0 : contributionWeights[index]), 0)}
	if (mode === MODES.energySum) {
		const clampedBy = parameterDistance(energySumOf(values, inputs), blendedValue)
		return {
			name: parameterName,
			mode,
			clamped: clampedBy > SB_BLEND_WEIGHT_FLOOR,
			relativeDelta: clampedBy / rangeWidth,
		}
	}
	const spread = values.reduce(
		(total, value, index) => total + parameterDistance(value, blendedValue) * contributionWeights[index],
		0,
	)
	return { name: parameterName, mode, clamped: false, relativeDelta: spread / rangeWidth }
}


export function describeBlendLoss(blendInputs, blendedParameters) {
	const inputs = normalizeBlendInputs(blendInputs)
	const contributionWeights = normalizeBlendWeights(inputs.map((input) => input.contribution))
	const blended = sanitizeSlabParameters(blendedParameters)
	const parameterNames = slabParameterNames()
	const byParameter = parameterNames
		.map((name) => describeParameterLoss(name, inputs, contributionWeights, blended[name]))
		.filter((entry) => entry.relativeDelta > 0)
		.sort((left, right) => right.relativeDelta - left.relativeDelta || (left.name < right.name ? -1 : 1))
	const energyBefore = inputs.reduce((total, input) => total + input.contribution, 0)
	const energyAfter = slabReflectedEnergy(blended)
	const deltas = byParameter.map((entry) => entry.relativeDelta)
	return {
		inputCount: inputs.length,
		visibility: inputs.map((input) => input.visibility),
		contributionWeights,
		clampedParameters: byParameter.filter((entry) => entry.clamped).map((entry) => entry.name),
		worstParameter: byParameter.length === 0 ? null : byParameter[0].name,
		maxRelativeDelta: deltas.length === 0 ? 0 : deltas[0],
		meanRelativeDelta: deltas.reduce((total, delta) => total + delta, 0) / parameterNames.length,
		energyBefore,
		energyAfter,
		energyRelativeDelta:
			SB_BLEND_WEIGHT_FLOOR > energyBefore ? 0 : Math.abs(energyAfter - energyBefore) / energyBefore,
		byParameter: byParameter.slice(0, MAX_REPORTED_PARAMETERS),
	}
}


export function blendClosures(blendInputs) {
	const parameters = blendSlabParameters(blendInputs)
	return { parameters, loss: describeBlendLoss(blendInputs, parameters) }
}


export function describeParameterBlending() {
	const modeByParameter = {}
	slabParameterNames().forEach((name) => {
		modeByParameter[name] = blendModeFor(name)
	})
	return {
		parameterCount: slabParameterNames().length,
		modes: Object.values(MODES),
		energyParameters: ENERGY_PARAMETER_NAMES.slice(),
		tintedParameters: TINTED_PARAMETER_NAMES.slice(),
		modeByParameter,
	}
}
