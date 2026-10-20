import { SB_GATES, SB_MAX_CLOSURES_PER_PIXEL, tierDefaults } from "./sbMaterialContract.js"
import { SB_REFUSAL_CODES, describeRefusal } from "./sbOperatorRefusals.js"
import { sanitizeSlabParameters, slabParameterNames, slabParameterSchema } from "./sbSlabParametersCore.js"
import { SB_NORMAL_BLEND_MODES, blendNormals } from "./sbNormalBlendCore.js"
import {
	branchClosureCount,
	branchClosures,
	branchEnergy,
	branchShadingClasses,
	branchesAreIdentical,
	createBranch,
	createClosure,
	createReferenceAlgebraBranches,
	isBranch,
	pruneZeroWeightClosures,
	relativeEnergyDeviation,
	scaleClosureWeights,
	slabReferenceEnergy,
} from "./sbOperatorAlgebraCore.js"

export const SB_HORIZONTAL_MIXING_OPERATOR_NAME = "horizontalMixing"
export const SB_MIXING_MODES = Object.freeze({ sum: "sum", blend: "blend" })


const MINIMUM_SOLVABLE_ENERGY = 1e-9

function isFiniteNumber(value) {
	return typeof value === "number" && Number.isFinite(value)
}

function clampUnitInterval(value) {
	if (!isFiniteNumber(value)) return 0
	if (0 > value) return 0
	if (value > 1) return 1
	return value
}

function refuse(code, detail) {
	return { ok: false, branch: null, report: null, refusal: describeRefusal(SB_HORIZONTAL_MIXING_OPERATOR_NAME, code, detail) }
}


export function resolveClosureCeiling(options = {}) {
	if (isFiniteNumber(options.closureCeiling)) return options.closureCeiling
	const tierCeiling = options.tier ? tierDefaults(options.tier)?.closuresPerPixel : null
	return isFiniteNumber(tierCeiling) ? tierCeiling : SB_MAX_CLOSURES_PER_PIXEL
}





export function resolveMixingMode(firstBranch, secondBranch, options = {}) {
	if (options.mode) return options.mode
	const combinedClosureCount = branchClosureCount(firstBranch) + branchClosureCount(secondBranch)
	return combinedClosureCount > resolveClosureCeiling(options) ? SB_MIXING_MODES.blend : SB_MIXING_MODES.sum
}

function weightedEntries(firstBranch, secondBranch, weight) {
	return [
		...scaleClosureWeights(branchClosures(firstBranch), 1 - weight),
		...scaleClosureWeights(branchClosures(secondBranch), weight),
	]
}

function averageParameterValue(entries, parameterName, totalWeight) {
	if (slabParameterSchema(parameterName)?.integer) return entries.reduce((dominant, entry) => entry.weight > dominant.weight ? entry : dominant, entries[0])?.slab?.[parameterName]
	const sampleValue = entries.find((entry) => undefined !== entry.slab?.[parameterName])?.slab?.[parameterName]
	if (Array.isArray(sampleValue)) {
		return sampleValue.map(
			(_, componentIndex) =>
				entries.reduce(
					(total, entry) => total + entry.weight * (entry.slab?.[parameterName]?.[componentIndex] ?? 0),
					0,
				) / totalWeight,
		)
	}
	if (isFiniteNumber(sampleValue)) {
		return entries.reduce((total, entry) => total + entry.weight * (entry.slab?.[parameterName] ?? 0), 0) / totalWeight
	}
	return sampleValue
}


function blendEntrySlabs(entries, totalWeight) {
	if (MINIMUM_SOLVABLE_ENERGY > totalWeight) return sanitizeSlabParameters(entries[0]?.slab ?? null)
	const blendedSlab = {}
	for (const parameterName of slabParameterNames()) {
		blendedSlab[parameterName] = averageParameterValue(entries, parameterName, totalWeight)
	}
	return sanitizeSlabParameters(blendedSlab)
}


function blendEntryNormals(entries, options = {}) {
	const normalBlendMode = options.normalBlendMode ?? SB_NORMAL_BLEND_MODES.spherical
	let accumulatedWeight = 0
	let accumulatedNormal = null
	for (const entry of entries) {
		if (0 === entry.weight) continue
		if (!accumulatedNormal) {
			accumulatedNormal = entry.normal
			accumulatedWeight = entry.weight
			continue
		}
		const nextWeight = accumulatedWeight + entry.weight
		const stepWeight = 0 === nextWeight ? 0 : entry.weight / nextWeight
		accumulatedNormal = blendNormals(accumulatedNormal, entry.normal, stepWeight, { mode: normalBlendMode })
		accumulatedWeight = nextWeight
	}
	return accumulatedNormal ?? entries[0]?.normal ?? [0, 0, 1]
}


export function blendSlabParameters(firstSlab, secondSlab, weight) {
	const blendWeight = clampUnitInterval(weight)
	if (0 === blendWeight) return sanitizeSlabParameters(firstSlab)
	if (1 === blendWeight) return sanitizeSlabParameters(secondSlab)
	const entries = [
		{ weight: 1 - blendWeight, slab: sanitizeSlabParameters(firstSlab) },
		{ weight: blendWeight, slab: sanitizeSlabParameters(secondSlab) },
	]
	return blendEntrySlabs(entries, 1)
}

function mixBySum(entries, targetEnergy, slabEnergyOf) {
	const closures = pruneZeroWeightClosures(entries)
	const branch = { closures }
	const mixedEnergy = branchEnergy(branch, { slabEnergyOf })
	return {
		branch,
		report: {
			mode: SB_MIXING_MODES.sum,
			closureCount: closures.length,
			targetEnergy,
			mixedEnergy,
			energyDeviation: relativeEnergyDeviation(mixedEnergy, targetEnergy),
			uncorrectedEnergy: mixedEnergy,
			uncorrectedEnergyDeviation: relativeEnergyDeviation(mixedEnergy, targetEnergy),
			energyCompensation: 1,
			weightWasClamped: false,
		},
	}
}

function mixByBlend(entries, targetEnergy, slabEnergyOf, options) {
	const totalWeight = entries.reduce((total, entry) => total + entry.weight, 0)
	if (0 === entries.length || MINIMUM_SOLVABLE_ENERGY > totalWeight) {
		return mixBySum(entries, targetEnergy, slabEnergyOf)
	}

	const blendedSlab = blendEntrySlabs(entries, totalWeight)
	const blendedNormal = blendEntryNormals(entries, options)
	const blendedSlabEnergy = slabEnergyOf(blendedSlab)
	const uncorrectedEnergy = totalWeight * blendedSlabEnergy


	const solvedWeight =
		MINIMUM_SOLVABLE_ENERGY > blendedSlabEnergy ? totalWeight : targetEnergy / blendedSlabEnergy

	const mixedWeight = Math.max(0, solvedWeight)
	const mergedClosure = {
		weight: mixedWeight,
		slab: blendedSlab,
		normal: blendedNormal,
		label: options.label ?? "horizontalMixingBlend",
		shadingClass: entries[0].shadingClass,
	}
	const branch = { closures: pruneZeroWeightClosures([mergedClosure]) }
	const mixedEnergy = branchEnergy(branch, { slabEnergyOf })

	return {
		branch,
		report: {
			mode: SB_MIXING_MODES.blend,
			closureCount: branchClosureCount(branch),
			targetEnergy,
			mixedEnergy,
			energyDeviation: relativeEnergyDeviation(mixedEnergy, targetEnergy),
			uncorrectedEnergy,
			uncorrectedEnergyDeviation: relativeEnergyDeviation(uncorrectedEnergy, targetEnergy),
			energyCompensation: MINIMUM_SOLVABLE_ENERGY > totalWeight ? 1 : mixedWeight / totalWeight,
			weightWasClamped: mixedWeight !== solvedWeight,
		},
	}
}


export function applyHorizontalMixing(firstBranch, secondBranch, weight, options = {}) {
	if (!isBranch(firstBranch) || !isBranch(secondBranch)) {
		return refuse(SB_REFUSAL_CODES.missingOperand, "um dos lados nao e um ramo avaliado")
	}
	if (!isFiniteNumber(weight) || 0 > weight || weight > 1) {
		return refuse(SB_REFUSAL_CODES.parameterOutOfRange, `peso ${weight}`)
	}

	const firstShadingClasses = branchShadingClasses(firstBranch)
	const secondShadingClasses = branchShadingClasses(secondBranch)
	const combinedShadingClasses = Array.from(new Set([...firstShadingClasses, ...secondShadingClasses]))
	if (combinedShadingClasses.length > 1) {
		return refuse(SB_REFUSAL_CODES.domainMismatch, `dominios misturados: ${combinedShadingClasses.join(" + ")}`)
	}

	const closureCeiling = resolveClosureCeiling(options)
	if (1 > closureCeiling) {
		return refuse(SB_REFUSAL_CODES.budgetExceeded, `teto de ${closureCeiling} closure nao cabe nem a fusao`)
	}


	if (0 === weight) {
		return { ok: true, branch: firstBranch, report: extremeReport(firstBranch, weight, options), refusal: null }
	}
	if (1 === weight) {
		return { ok: true, branch: secondBranch, report: extremeReport(secondBranch, weight, options), refusal: null }
	}

	const slabEnergyOf = options.slabEnergyOf ?? slabReferenceEnergy
	const targetEnergy =
		(1 - weight) * branchEnergy(firstBranch, { slabEnergyOf }) + weight * branchEnergy(secondBranch, { slabEnergyOf })
	const entries = weightedEntries(firstBranch, secondBranch, weight)
	const mode = resolveMixingMode(firstBranch, secondBranch, options)
	const mixed =
		mode === SB_MIXING_MODES.blend
			? mixByBlend(entries, targetEnergy, slabEnergyOf, options)
			: mixBySum(entries, targetEnergy, slabEnergyOf)

	return {
		ok: true,
		branch: mixed.branch,
		report: { ...mixed.report, weight, closureCeiling },
		refusal: null,
	}
}

function extremeReport(branch, weight, options) {
	const slabEnergyOf = options.slabEnergyOf ?? slabReferenceEnergy
	const energy = branchEnergy(branch, { slabEnergyOf })
	return {
		mode: SB_MIXING_MODES.sum,
		weight,
		closureCeiling: resolveClosureCeiling(options),
		closureCount: branchClosureCount(branch),
		targetEnergy: energy,
		mixedEnergy: energy,
		energyDeviation: 0,
		uncorrectedEnergy: energy,
		uncorrectedEnergyDeviation: 0,
		energyCompensation: 1,
		weightWasClamped: false,
		passthrough: true,
	}
}


export function createReferenceMixingBranches() {
	const { redMetal, roughPlastic, paleCloth } = createReferenceAlgebraBranches()
	const layeredCloth = createBranch([
		...branchClosures(paleCloth),
		createClosure({
			weight: 0.5,
			label: "clearCoat",
			slab: { albedo: [0.02, 0.02, 0.02], f0: [0.08, 0.08, 0.08], roughness: 0.08 },
			normal: [0.2, 0.1, 0.97],
		}),
	])
	return { redMetal, roughPlastic, paleCloth, layeredCloth }
}


export function findHorizontalMixingProblems(options = {}) {
	const tolerance = options.tolerance ?? SB_GATES.maxMixingEnergyDeviation
	const sampleCount = options.sampleCount ?? 11
	const branches = options.branches ?? createReferenceMixingBranches()
	const { redMetal, roughPlastic, layeredCloth } = branches
	const problems = []

	for (const mode of [SB_MIXING_MODES.sum, SB_MIXING_MODES.blend]) {
		for (let sampleIndex = 0; sampleCount > sampleIndex; sampleIndex += 1) {
			const weight = sampleIndex / (sampleCount - 1)
			const mixed = applyHorizontalMixing(redMetal, roughPlastic, weight, { ...options, mode })
			if (!mixed.ok) {
				problems.push(`mistura recusada no modo ${mode} com peso ${weight}: ${mixed.refusal?.reason}`)
				continue
			}
			if (mixed.report.energyDeviation > tolerance) {
				problems.push(
					`energia fora de faixa no modo ${mode} com peso ${weight}: desvio ${mixed.report.energyDeviation}`,
				)
			}
		}

		const atZero = applyHorizontalMixing(redMetal, roughPlastic, 0, { ...options, mode })
		const atOne = applyHorizontalMixing(redMetal, roughPlastic, 1, { ...options, mode })
		if (!atZero.ok || !branchesAreIdentical(atZero.branch, redMetal)) {
			problems.push(`peso 0 nao reproduziu o primeiro lado byte a byte no modo ${mode}`)
		}
		if (!atOne.ok || !branchesAreIdentical(atOne.branch, roughPlastic)) {
			problems.push(`peso 1 nao reproduziu o segundo lado byte a byte no modo ${mode}`)
		}
	}

	const tightCeiling = 1
	const squeezed = applyHorizontalMixing(layeredCloth, roughPlastic, 0.35, { closureCeiling: tightCeiling })
	if (!squeezed.ok) {
		problems.push(`a mistura apertada foi recusada em vez de fundir: ${squeezed.refusal?.reason}`)
	} else {
		if (SB_MIXING_MODES.blend !== squeezed.report.mode) {
			problems.push("o orcamento apertado deveria ter escolhido o modo blend")
		}
		if (squeezed.report.closureCount > tightCeiling) {
			problems.push(`a fusao devolveu ${squeezed.report.closureCount} closures para um teto de ${tightCeiling}`)
		}
		if (squeezed.report.energyDeviation > tolerance) {
			problems.push(`energia fora de faixa na mistura apertada: desvio ${squeezed.report.energyDeviation}`)
		}
	}

	if (applyHorizontalMixing(redMetal, roughPlastic, 1.4).ok) problems.push("peso acima de 1 deveria ser recusado")
	if (applyHorizontalMixing(redMetal, roughPlastic, -0.2).ok) problems.push("peso negativo deveria ser recusado")
	if (applyHorizontalMixing(null, roughPlastic, 0.5).ok) problems.push("lado ausente deveria ser recusado")

	const unlitBranch = createBranch([createClosure({ weight: 1, shadingClass: "unlit", label: "unlit" })])
	if (applyHorizontalMixing(redMetal, unlitBranch, 0.5).ok) {
		problems.push("dominios diferentes deveriam ser recusados")
	}

	return problems
}


export function describeHorizontalMixing(options = {}) {
	const branches = options.branches ?? createReferenceMixingBranches()
	const problems = findHorizontalMixingProblems({ ...options, branches })
	const sumSample = applyHorizontalMixing(branches.redMetal, branches.roughPlastic, 0.35, { ...options, mode: SB_MIXING_MODES.sum })
	const blendSample = applyHorizontalMixing(branches.redMetal, branches.roughPlastic, 0.35, { ...options, mode: SB_MIXING_MODES.blend })
	return {
		owner: "SB-F20",
		operator: SB_HORIZONTAL_MIXING_OPERATOR_NAME,
		tolerance: options.tolerance ?? SB_GATES.maxMixingEnergyDeviation,
		closureCeiling: resolveClosureCeiling(options),
		sumSample: sumSample.report,
		blendSample: blendSample.report,
		ok: 0 === problems.length,
		problems,
	}
}
