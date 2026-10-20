import {
	SB_MINIMUM_ROUGHNESS,
	evaluateSlabBsdf,
	normalizeSlabForReference,
} from "./sbSlabBsdfReferenceCore.js"
import { sanitizeSlabParameters, slabParameterSchema } from "./sbSlabParametersCore.js"


export const SB_SECOND_LOBE_ROUGHNESS_PARAMETER = "secondRoughness"
export const SB_SECOND_LOBE_WEIGHT_PARAMETER = "secondRoughnessWeight"


export const SB_SECOND_LOBE_WEIGHT_PLAN_ALIAS = "lobeWeight"


export const SB_SECOND_LOBE_MINIMUM_ROUGHNESS = SB_MINIMUM_ROUGHNESS

const FULL_WEIGHT = 1
const NO_WEIGHT = 0

function mixTriplets(baseTriplet, secondTriplet, secondWeight) {
	const baseWeight = FULL_WEIGHT - secondWeight
	return [
		baseTriplet[0] * baseWeight + secondTriplet[0] * secondWeight,
		baseTriplet[1] * baseWeight + secondTriplet[1] * secondWeight,
		baseTriplet[2] * baseWeight + secondTriplet[2] * secondWeight,
	]
}

function sumTriplets(left, right) {
	return [left[0] + right[0], left[1] + right[1], left[2] + right[2]]
}


export function normalizeDualSpecularLobe(slab) {
	const sanitizedSlab = sanitizeSlabParameters(slab)
	const secondWeight = sanitizedSlab[SB_SECOND_LOBE_WEIGHT_PARAMETER]
	const baseSlab = normalizeSlabForReference(sanitizedSlab)
	const secondSlab = normalizeSlabForReference({
		...sanitizedSlab,
		roughness: sanitizedSlab[SB_SECOND_LOBE_ROUGHNESS_PARAMETER],
	})
	return {
		baseSlab,
		secondSlab,
		baseRoughness: baseSlab.roughness,
		secondRoughness: secondSlab.roughness,
		secondWeight,
		baseWeight: FULL_WEIGHT - secondWeight,
		isActive: secondWeight > NO_WEIGHT,
	}
}


export function evaluateDualSpecularLobeBsdf(options) {
	const lobes = options.normalizedLobes ?? normalizeDualSpecularLobe(options.slab)
	const viewDirection = options.viewDirection
	const lightDirection = options.lightDirection
	const baseBsdf = evaluateSlabBsdf({ normalizedSlab: lobes.baseSlab, viewDirection, lightDirection })

	if (!lobes.isActive) return baseBsdf
	const secondBsdf = evaluateSlabBsdf({ normalizedSlab: lobes.secondSlab, viewDirection, lightDirection })
	const specular = mixTriplets(baseBsdf.specular, secondBsdf.specular, lobes.secondWeight)
	return { diffuse: baseBsdf.diffuse, specular, total: sumTriplets(baseBsdf.diffuse, specular) }
}


export function secondLobeUniformValue(lobes) {
	return [lobes.secondRoughness, lobes.secondWeight]
}


export function describeDualSpecularLobe(lobes) {
	return {
		baseRoughness: lobes.baseRoughness,
		secondRoughness: lobes.secondRoughness,
		secondWeight: lobes.secondWeight,
		baseWeight: lobes.baseWeight,
		isActive: lobes.isActive,
		uniformValue: secondLobeUniformValue(lobes),
		weightPlanAlias: SB_SECOND_LOBE_WEIGHT_PLAN_ALIAS,
	}
}


export function findDualSpecularLobeContractProblems(reservedParameterNames) {
	const reserved = reservedParameterNames ?? []
	const problems = []
	for (const parameterName of [SB_SECOND_LOBE_ROUGHNESS_PARAMETER, SB_SECOND_LOBE_WEIGHT_PARAMETER]) {
		if (reserved.length > 0 && !reserved.includes(parameterName)) {
			problems.push(`o contrato nao reserva o parametro ${parameterName}`)
		}
		const schema = slabParameterSchema(parameterName)
		if (schema === null) {
			problems.push(`a SB-F4 nao descreve o parametro ${parameterName}`)
			continue
		}
		if (schema.closureField === null) {
			problems.push(`${parameterName} nao ocupa byte no registro de closure`)
		}
		if (schema.maximum !== FULL_WEIGHT) {
			problems.push(`${parameterName} deveria terminar em 1, e termina em ${schema.maximum}`)
		}
	}
	return problems
}
