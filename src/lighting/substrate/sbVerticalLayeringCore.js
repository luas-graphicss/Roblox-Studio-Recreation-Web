import {
	SB_GATES,
	SB_MAX_CLOSURES_PER_PIXEL,
	SB_MAX_TREE_DEPTH,
	SB_SLAB_PAYLOAD_FIELD_SOURCES,
	tierDefaults,
} from "./sbMaterialContract.js"
import { SB_CLOSURE_LAYOUTS } from "./sbClosureLayouts.js"
import { SB_STRUCTURAL_PARAMETER_RANGES } from "./sbTreeParameterRanges.js"
import { SB_OPERATORS } from "./sbOperatorCatalog.js"
import { SB_OPERATOR_REFUSALS, SB_REFUSAL_CODES, describeRefusal } from "./sbOperatorRefusals.js"
import { SB_BSDF_KINDS, bsdfClosureCost, supportsLayering } from "./sbBsdfCatalog.js"
import {
	layerPathLength,
	layerTransmittance,
	meanChannel,
	sanitizeThickness,
	sanitizeTransmittanceColor,
	sanitizeViewCosine,
} from "./sbLayerTransmittanceCore.js"

export const SB_VERTICAL_LAYERING_OPERATOR = "verticalLayering"
export const SB_VERTICAL_LAYERING_OWNER = "SB-F18"
export const SB_SLAB_BSDF_KIND = "slab"
export const SB_LAYERING_OPERAND_NAMES = Object.freeze(["top", "bottom"])
export const SB_LAYERING_PARAMETER_NAMES = Object.freeze(
	(SB_OPERATORS[SB_VERTICAL_LAYERING_OPERATOR]?.parameters ?? []).slice(),
)


export const SB_NEUTRAL_LAYER = Object.freeze({
	coverage: 1,
	thickness: 0,
	transmittanceColor: Object.freeze([1, 1, 1]),
})

const RADIANCE_CHANNEL_COUNT = 3
const ENERGY_TOLERANCE = 1e-12
const COVERAGE_PROBE_STEP = 0.1
const THICKNESS_PROBE_STEP = 1

function isPlainObject(value) {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isUsableNumber(value) {
	return typeof value === "number" && Number.isFinite(value)
}

function refuse(code, detail) {
	return describeRefusal(SB_VERTICAL_LAYERING_OPERATOR, code, detail)
}

export function isVerticalLayeringNode(node) {
	return isPlainObject(node) && node.operator === SB_VERTICAL_LAYERING_OPERATOR
}


export function layeringOperandsOf(node) {
	if (!isPlainObject(node)) return { top: null, bottom: null }
	if (isPlainObject(node.top) || isPlainObject(node.bottom)) {
		return {
			top: isPlainObject(node.top) ? node.top : null,
			bottom: isPlainObject(node.bottom) ? node.bottom : null,
		}
	}
	const operands = Array.isArray(node.operands)
		? node.operands
		: Array.isArray(node.children)
			? node.children
			: []
	return {
		top: isPlainObject(operands[0]) ? operands[0] : null,
		bottom: isPlainObject(operands[1]) ? operands[1] : null,
	}
}


export function layerParametersOf(node) {
	const ownKeys = isPlainObject(node) ? node : {}
	const nestedKeys = isPlainObject(ownKeys.parameters) ? ownKeys.parameters : {}
	const readParameter = (name) => (ownKeys[name] === undefined ? nestedKeys[name] : ownKeys[name])
	return {
		coverage: readParameter("coverage"),
		thickness: readParameter("thickness"),
		transmittanceColor: readParameter("transmittanceColor"),
	}
}

function sanitizeCoverage(coverage) {
	if (!isUsableNumber(coverage)) return SB_NEUTRAL_LAYER.coverage
	if (0 > coverage) return 0
	if (coverage > 1) return 1
	return coverage
}


export function sanitizeLayer(layer) {
	const source = isPlainObject(layer) ? layer : {}
	return {
		coverage: sanitizeCoverage(source.coverage),
		thickness: sanitizeThickness(source.thickness),
		transmittanceColor: sanitizeTransmittanceColor(source.transmittanceColor),
	}
}

function isScalarInRange(value, range) {
	if (!isUsableNumber(value)) return false
	if (range.minimum > value) return false
	if (value > range.maximum) return false
	return true
}

function isColorInRange(value, range) {
	if (!Array.isArray(value)) return false
	if (value.length !== range.componentCount) return false
	return value.every((channel) => isScalarInRange(channel, range))
}

function rangeLabel(range) {
	return range.minimum + ".." + range.maximum
}


export function findLayerParameterRefusal(layerParameters) {
	const { coverage, thickness, transmittanceColor } = layerParameters ?? {}
	const coverageRange = SB_STRUCTURAL_PARAMETER_RANGES.coverage
	const thicknessRange = SB_STRUCTURAL_PARAMETER_RANGES.thickness
	const colorRange = SB_STRUCTURAL_PARAMETER_RANGES.transmittanceColor

	if (coverage !== undefined && !isScalarInRange(coverage, coverageRange)) {
		return refuse(SB_REFUSAL_CODES.parameterOutOfRange, "coverage = " + coverage + " fora de " + rangeLabel(coverageRange))
	}
	if (thickness !== undefined && !isScalarInRange(thickness, thicknessRange)) {
		return refuse(SB_REFUSAL_CODES.parameterOutOfRange, "thickness = " + thickness + " fora de " + rangeLabel(thicknessRange))
	}
	if (transmittanceColor !== undefined && !isColorInRange(transmittanceColor, colorRange)) {
		return refuse(
			SB_REFUSAL_CODES.parameterOutOfRange,
			"transmittanceColor precisa de " + colorRange.componentCount + " canais em " + rangeLabel(colorRange),
		)
	}
	return null
}


export function bsdfKindOf(operand) {
	if (!isPlainObject(operand)) return null
	if (typeof operand.bsdf === "string") return operand.bsdf
	if (typeof operand.kind === "string" && operand.kind in SB_BSDF_KINDS) return operand.kind
	if (typeof operand.operator === "string") return null
	return SB_SLAB_BSDF_KIND
}

function countClosures(operand, remainingDepth) {
	if (0 > remainingDepth) return 0
	if (isVerticalLayeringNode(operand)) {
		const { top, bottom } = layeringOperandsOf(operand)
		return countClosures(top, remainingDepth - 1) + countClosures(bottom, remainingDepth - 1)
	}
	const kind = bsdfKindOf(operand)
	if (!kind) return 0
	return bsdfClosureCost(kind) ?? 0
}


export function closureCountOf(node) {
	return countClosures(node, SB_MAX_TREE_DEPTH)
}

function findBottomRefusal(bottom, remainingDepth) {
	if (isVerticalLayeringNode(bottom)) return findLayeringRefusal(bottom, remainingDepth - 1)
	const kind = bsdfKindOf(bottom)
	if (!kind) {
		return refuse(
			SB_REFUSAL_CODES.unsupportedChild,
			"embaixo veio o operador " + bottom.operator + ", que nao e desta fase",
		)
	}
	if (!supportsLayering(kind)) {
		return refuse(SB_REFUSAL_CODES.unsupportedChild, "a camada de baixo e " + kind + ", que nao aceita camada em cima")
	}
	return null
}

function findLayeringRefusal(node, remainingDepth) {
	if (0 > remainingDepth) {
		return refuse(
			SB_REFUSAL_CODES.unsupportedChild,
			"pilha de camadas mais funda que o teto de " + SB_MAX_TREE_DEPTH + " do contrato; profundidade quem recusa e a SB-F3",
		)
	}

	const { top, bottom } = layeringOperandsOf(node)
	if (!top || !bottom) {
		const missing = !top && !bottom ? "top e bottom" : !top ? "top" : "bottom"
		return refuse(SB_REFUSAL_CODES.missingOperand, "faltou o operando " + missing + " no verticalLayering")
	}

	const topKind = bsdfKindOf(top)
	if (topKind !== SB_SLAB_BSDF_KIND) {
		return refuse(
			SB_REFUSAL_CODES.unsupportedChild,
			"a camada de cima e " + (topKind ?? "um no de operador") + ", e so slab pode ficar por cima",
		)
	}

	return findBottomRefusal(bottom, remainingDepth)
}


export function findOperandRefusal(node) {
	return findLayeringRefusal(node, SB_MAX_TREE_DEPTH)
}


export function closureBudgetForTier(tierName) {
	const defaults = tierDefaults(tierName)
	return Math.min(defaults.closuresPerPixel, SB_MAX_CLOSURES_PER_PIXEL)
}


export function bottomAttenuationFor(layer, viewCosine) {
	const sanitized = sanitizeLayer(layer)
	const transmittance = layerTransmittance({
		transmittanceColor: sanitized.transmittanceColor,
		thickness: sanitized.thickness,
		viewCosine,
	})
	return transmittance.map((channel) => 1 - sanitized.coverage + sanitized.coverage * channel)
}


export function coatDarkeningOf(layer, viewCosine) {
	return 1 - meanChannel(bottomAttenuationFor(layer, viewCosine))
}


export function meetsCoatDarkeningGate(layer, options) {
	const gates = options?.gates ?? SB_GATES
	const darkening = coatDarkeningOf(layer, options?.viewCosine)
	return {
		darkening,
		minimum: gates.minimumCoatDarkening,
		pass: darkening >= gates.minimumCoatDarkening,
	}
}

function sanitizeRadiance(radiance) {
	const sanitized = []
	for (let channelIndex = 0; RADIANCE_CHANNEL_COUNT > channelIndex; channelIndex += 1) {
		const channel = Array.isArray(radiance) ? radiance[channelIndex] : undefined
		sanitized.push(isUsableNumber(channel) && channel > 0 ? channel : 0)
	}
	return sanitized
}


export function combineLayeredRadiance(request) {
	const layer = sanitizeLayer(request?.layer)
	const attenuation = bottomAttenuationFor(layer, request?.viewCosine)
	const topRadiance = sanitizeRadiance(request?.topRadiance)
	const bottomRadiance = sanitizeRadiance(request?.bottomRadiance)
	return attenuation.map(
		(channel, channelIndex) => layer.coverage * topRadiance[channelIndex] + channel * bottomRadiance[channelIndex],
	)
}


export function findLayeringEnergyProblems(request) {
	const layer = sanitizeLayer(request?.layer)
	const viewCosine = sanitizeViewCosine(request?.viewCosine)
	const problems = []

	const attenuation = bottomAttenuationFor(layer, viewCosine)
	const transmittance = layerTransmittance({
		transmittanceColor: layer.transmittanceColor,
		thickness: layer.thickness,
		viewCosine,
	})
	const thicker = bottomAttenuationFor({ ...layer, thickness: layer.thickness + THICKNESS_PROBE_STEP }, viewCosine)
	const moreCoverage = bottomAttenuationFor(
		{ ...layer, coverage: Math.min(layer.coverage + COVERAGE_PROBE_STEP, 1) },
		viewCosine,
	)

	attenuation.forEach((channel, channelIndex) => {
		if (!isUsableNumber(channel)) {
			problems.push("atenuacao nao numerica no canal " + channelIndex)
			return
		}
		if (0 > channel || channel > 1) {
			problems.push("atenuacao fora de 0..1 no canal " + channelIndex + ": " + channel)
		}
		if (transmittance[channelIndex] > channel + ENERGY_TOLERANCE) {
			problems.push("atenuacao abaixo da transmitancia no canal " + channelIndex)
		}
		if (thicker[channelIndex] > channel + ENERGY_TOLERANCE) {
			problems.push("camada mais grossa clareou o que esta embaixo no canal " + channelIndex)
		}
		if (moreCoverage[channelIndex] > channel + ENERGY_TOLERANCE) {
			problems.push("mais cobertura clareou o que esta embaixo no canal " + channelIndex)
		}
	})

	return problems
}


export function verticalLayeringPayloadFieldNames() {
	return Object.keys(SB_SLAB_PAYLOAD_FIELD_SOURCES).filter(
		(fieldName) => SB_SLAB_PAYLOAD_FIELD_SOURCES[fieldName].producer === SB_VERTICAL_LAYERING_OWNER,
	)
}


export function verticalLayeringPayloadBytes() {
	const payload = SB_CLOSURE_LAYOUTS[SB_SLAB_BSDF_KIND]?.payload ?? []
	return verticalLayeringPayloadFieldNames().reduce((total, fieldName) => {
		const field = payload.find((candidate) => candidate.name === fieldName)
		return total + (field?.bytes ?? 0)
	}, 0)
}


export function findVerticalLayeringContractProblems() {
	const problems = []
	const operator = SB_OPERATORS[SB_VERTICAL_LAYERING_OPERATOR]
	const refusals = SB_OPERATOR_REFUSALS[SB_VERTICAL_LAYERING_OPERATOR]

	if (!operator) problems.push("operador ausente do catalogo: " + SB_VERTICAL_LAYERING_OPERATOR)
	if (!refusals) problems.push("operador sem recusas catalogadas: " + SB_VERTICAL_LAYERING_OPERATOR)
	if (operator && operator.owner !== SB_VERTICAL_LAYERING_OWNER) {
		problems.push("dono do operador no catalogo e " + operator.owner)
	}
	if (refusals && refusals.owner !== SB_VERTICAL_LAYERING_OWNER) {
		problems.push("dono das recusas e " + refusals.owner)
	}
	if (operator && operator.arity !== SB_LAYERING_OPERAND_NAMES.length) {
		problems.push("aridade do catalogo e " + operator.arity + " e a fase nomeia " + SB_LAYERING_OPERAND_NAMES.length + " operandos")
	}

	const catalogParameters = SB_LAYERING_PARAMETER_NAMES.slice().sort().join(",")
	const payloadParameters = verticalLayeringPayloadFieldNames().slice().sort().join(",")
	if (catalogParameters !== payloadParameters) {
		problems.push("parametros do catalogo (" + catalogParameters + ") diferentes dos campos do payload (" + payloadParameters + ")")
	}

	for (const parameterName of SB_LAYERING_PARAMETER_NAMES) {
		if (!SB_STRUCTURAL_PARAMETER_RANGES[parameterName]) {
			problems.push("parametro sem faixa estrutural declarada: " + parameterName)
		}
	}
	if (!(SB_GATES.minimumCoatDarkening > 0)) problems.push("contrato sem portao de escurecimento")
	if (!(SB_GATES.maxTransmittanceAbsoluteError > 0)) problems.push("contrato sem portao de erro de transmitancia")

	return problems
}


export function evaluateVerticalLayering(request) {
	const node = request?.node
	if (!isVerticalLayeringNode(node)) {
		return {
			accepted: false,
			refusal: refuse(SB_REFUSAL_CODES.missingOperand, "no sem o operador " + SB_VERTICAL_LAYERING_OPERATOR),
		}
	}

	const authoredParameters = layerParametersOf(node)
	const parameterRefusal = findLayerParameterRefusal(authoredParameters)
	if (parameterRefusal) return { accepted: false, refusal: parameterRefusal }

	const operandRefusal = findOperandRefusal(node)
	if (operandRefusal) return { accepted: false, refusal: operandRefusal }

	const layer = sanitizeLayer(authoredParameters)
	const viewCosine = sanitizeViewCosine(request?.viewCosine)
	const closureBudget = Number.isInteger(request?.closureBudget) ? request.closureBudget : SB_MAX_CLOSURES_PER_PIXEL
	const closureCount = closureCountOf(node)
	const transmittance = layerTransmittance({
		transmittanceColor: layer.transmittanceColor,
		thickness: layer.thickness,
		viewCosine,
	})
	const bottomAttenuation = bottomAttenuationFor(layer, viewCosine)

	return {
		accepted: true,
		operator: SB_VERTICAL_LAYERING_OPERATOR,
		owner: SB_VERTICAL_LAYERING_OWNER,
		closureMath: SB_OPERATORS[SB_VERTICAL_LAYERING_OPERATOR]?.closureMath,
		layer,
		viewCosine,
		pathLength: layerPathLength(layer.thickness, viewCosine),
		transmittance,
		bottomAttenuation,
		bottomDarkening: 1 - meanChannel(bottomAttenuation),
		topWeight: layer.coverage,
		closureCount,
		closureBudget,
		fitsBudget: closureBudget >= closureCount,
		energyProblems: findLayeringEnergyProblems({ layer, viewCosine }),
	}
}


export function describeVerticalLayering() {
	return {
		operator: SB_VERTICAL_LAYERING_OPERATOR,
		owner: SB_VERTICAL_LAYERING_OWNER,
		arity: SB_OPERATORS[SB_VERTICAL_LAYERING_OPERATOR]?.arity,
		closureMath: SB_OPERATORS[SB_VERTICAL_LAYERING_OPERATOR]?.closureMath,
		operands: SB_LAYERING_OPERAND_NAMES.slice(),
		parameters: SB_LAYERING_PARAMETER_NAMES.slice(),
		payloadFields: verticalLayeringPayloadFieldNames(),
		payloadBytes: verticalLayeringPayloadBytes(),
		closureBudgetByTier: {
			fraco: closureBudgetForTier("fraco"),
			medio: closureBudgetForTier("medio"),
			forte: closureBudgetForTier("forte"),
		},
		gates: {
			minimumCoatDarkening: SB_GATES.minimumCoatDarkening,
			maxTransmittanceAbsoluteError: SB_GATES.maxTransmittanceAbsoluteError,
		},
		declaredResidues: [
			"nao soma o lobo especular da camada de cima nem a divisao de Fresnel: e da SB-F10 e da SB-F31",
			"nao recusa por orcamento de closures: o contrato nao catalogou budgetExceeded para este operador",
			"quem pode ficar embaixo sai de supportsLayering no catalogo de BSDF, nao de uma lista escrita a mao",
		],
	}
}
