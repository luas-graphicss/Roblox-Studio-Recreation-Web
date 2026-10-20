import { describeLegacyConversion } from "../sbLegacyConversionCore.js"
import { describeSlabParametersSummary, mappedClosureBytes } from "../sbSlabParametersCore.js"

export const PHASE_ID = "SB-F4"

const SLAB_PARAMETERS_FLAG = Object.freeze({
	id: "SubstrateSlabParameters",
	owner: PHASE_ID,
	description: "schema de parametros do slab e conversao dos materiais do motor legado",
	defaultsByTier: Object.freeze({ fraco: false, medio: true, forte: true }),
})


const TEXTURE_UNITS_USED = 0

export function installPhase(installContext = {}) {
	const { flags, telemetry } = installContext
	const parameters = describeSlabParametersSummary()
	const conversion = describeLegacyConversion()
	const problems = [
		...parameters.coverageProblems,
		...parameters.quantizationProblems,
		...conversion.problems,
	]
	try {
		flags?.registerFlag?.(SLAB_PARAMETERS_FLAG)
		telemetry?.closureBytes?.(PHASE_ID, mappedClosureBytes())
		telemetry?.textureUnit?.(PHASE_ID, TEXTURE_UNITS_USED)
		problems.forEach((problem) => telemetry?.error?.(PHASE_ID, problem))
	} catch (installError) {
		telemetry?.error?.(PHASE_ID, `falha ao instalar: ${installError && installError.message}`)
	}
	return {
		summary: {
			phaseId: PHASE_ID,
			flagId: SLAB_PARAMETERS_FLAG.id,
			parameterCount: parameters.parameterCount,
			mappedParameterCount: parameters.mappedParameterCount,
			parametersOutsideClosure: parameters.outsideClosure,
			closureBytes: parameters.budget.totalBytes,
			closureHeadroom: parameters.budget.headroom,
			legacyMaterialCount: conversion.materialCount,
			legacyLayeredCount: conversion.layeredCount,
			problems,
		},
	}
}
