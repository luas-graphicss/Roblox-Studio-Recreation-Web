import { SB_GATES, SB_MAX_CLOSURES_PER_PIXEL } from "./sbMaterialContract.js"
import { SB_REFUSAL_CODES, describeRefusal } from "./sbOperatorRefusals.js"
import { SB_SHADING_CLASSES } from "./sbMaterialTreeCore.js"
import { sanitizeSlabParameters } from "./sbSlabParametersCore.js"
import { normalizeNormal } from "./sbNormalBlendCore.js"

export const SB_ADD_OPERATOR_NAME = "add"
export const SB_WEIGHT_OPERATOR_NAME = "weight"


const LUMINANCE_WEIGHTS = Object.freeze([0.2126, 0.7152, 0.0722])

const RELATIVE_DEVIATION_FLOOR = 1e-6

function isFiniteNumber(value) {
	return typeof value === "number" && Number.isFinite(value)
}

function clampUnitInterval(value) {
	if (!isFiniteNumber(value)) return 0
	if (0 > value) return 0
	if (value > 1) return 1
	return value
}

function colorLuminance(color) {
	if (!Array.isArray(color)) return 0
	const red = isFiniteNumber(color[0]) ? color[0] : 0
	const green = isFiniteNumber(color[1]) ? color[1] : 0
	const blue = isFiniteNumber(color[2]) ? color[2] : 0
	return red * LUMINANCE_WEIGHTS[0] + green * LUMINANCE_WEIGHTS[1] + blue * LUMINANCE_WEIGHTS[2]
}

export function isClosure(value) {
	return Boolean(value) && typeof value === "object" && Array.isArray(value.normal) && isFiniteNumber(value.weight)
}

export function isBranch(value) {
	return Boolean(value) && typeof value === "object" && Array.isArray(value.closures)
}


export function createClosure(definition = {}) {
	const {
		weight = 1,
		slab = null,
		normal = [0, 0, 1],
		label = null,
		shadingClass = SB_SHADING_CLASSES.lit,
	} = definition
	return {
		weight: clampUnitInterval(weight),
		slab: sanitizeSlabParameters(slab),
		normal: normalizeNormal(normal),
		label,
		shadingClass,
	}
}

export function createBranch(closures = []) {
	return { closures: (Array.isArray(closures) ? closures : []).filter(isClosure) }
}

export function branchClosures(branch) {
	return isBranch(branch) ? branch.closures : []
}

export function branchClosureCount(branch) {
	return branchClosures(branch).length
}

export function branchShadingClasses(branch) {
	return Array.from(new Set(branchClosures(branch).map((closure) => closure.shadingClass))).sort()
}


export function slabReferenceEnergy(slab) {
	const specularAtNormalIncidence = clampUnitInterval(colorLuminance(slab?.f0))
	const diffuseAlbedo = clampUnitInterval(colorLuminance(slab?.albedo))
	return clampUnitInterval(specularAtNormalIncidence + (1 - specularAtNormalIncidence) * diffuseAlbedo)
}

export function closureEnergy(closure, slabEnergyOf = slabReferenceEnergy) {
	if (!isClosure(closure)) return 0
	return closure.weight * slabEnergyOf(closure.slab)
}

export function branchEnergy(branch, options = {}) {
	const slabEnergyOf = options.slabEnergyOf ?? slabReferenceEnergy
	return branchClosures(branch).reduce((total, closure) => total + closureEnergy(closure, slabEnergyOf), 0)
}


export function scaleClosureWeights(closures, factor) {
	return closures.map((closure) => ({ ...closure, weight: closure.weight * factor }))
}


export function pruneZeroWeightClosures(closures) {
	return closures.filter((closure) => 0 !== closure.weight)
}


export function canonicalBranchText(branch) {
	return JSON.stringify(branchClosures(branch))
}

export function branchesAreIdentical(leftBranch, rightBranch) {
	return canonicalBranchText(leftBranch) === canonicalBranchText(rightBranch)
}

export function relativeEnergyDeviation(measuredEnergy, expectedEnergy) {
	const scale = Math.max(Math.abs(expectedEnergy), RELATIVE_DEVIATION_FLOOR)
	return Math.abs(measuredEnergy - expectedEnergy) / scale
}

function refuse(operatorName, code, detail) {
	return { ok: false, branch: null, refusal: describeRefusal(operatorName, code, detail) }
}


export function applyWeightOperator(branch, weight) {
	if (!isBranch(branch)) {
		return refuse(SB_WEIGHT_OPERATOR_NAME, SB_REFUSAL_CODES.missingOperand, "o operando nao e um ramo avaliado")
	}
	if (!isFiniteNumber(weight) || 0 > weight || weight > 1) {
		return refuse(SB_WEIGHT_OPERATOR_NAME, SB_REFUSAL_CODES.parameterOutOfRange, `peso ${weight}`)
	}
	const closures = pruneZeroWeightClosures(scaleClosureWeights(branchClosures(branch), weight))
	return { ok: true, branch: { closures }, refusal: null, operator: SB_WEIGHT_OPERATOR_NAME, weight }
}


export function applyAddOperator(leftBranch, rightBranch, options = {}) {
	const closureCeiling = options.closureCeiling ?? SB_MAX_CLOSURES_PER_PIXEL
	if (!isBranch(leftBranch) || !isBranch(rightBranch)) {
		return refuse(SB_ADD_OPERATOR_NAME, SB_REFUSAL_CODES.missingOperand, "um dos operandos nao e um ramo avaliado")
	}

	const shadingClasses = Array.from(
		new Set([...branchShadingClasses(leftBranch), ...branchShadingClasses(rightBranch)]),
	)
	if (shadingClasses.length > 1) {
		return refuse(SB_ADD_OPERATOR_NAME, SB_REFUSAL_CODES.domainMismatch, `classes somadas: ${shadingClasses.join(" + ")}`)
	}

	const closures = pruneZeroWeightClosures([...branchClosures(leftBranch), ...branchClosures(rightBranch)])
	if (closures.length > closureCeiling) {
		return refuse(
			SB_ADD_OPERATOR_NAME,
			SB_REFUSAL_CODES.budgetExceeded,
			`${closures.length} closures para um teto de ${closureCeiling}`,
		)
	}
	return { ok: true, branch: { closures }, refusal: null, operator: SB_ADD_OPERATOR_NAME, closureCeiling }
}

function singleSlabBranch(label, slabOverrides, weight = 1) {
	return createBranch([createClosure({ weight, slab: slabOverrides, label })])
}


export function createReferenceAlgebraBranches() {
	return {
		redMetal: singleSlabBranch("redMetal", {
			albedo: [0, 0, 0],
			f0: [0.62, 0.18, 0.14],
			roughness: 0.24,
		}),
		roughPlastic: singleSlabBranch("roughPlastic", {
			albedo: [0.18, 0.2, 0.22],
			f0: [0.04, 0.04, 0.04],
			roughness: 0.62,
		}),
		paleCloth: singleSlabBranch("paleCloth", {
			albedo: [0.74, 0.7, 0.62],
			f0: [0.03, 0.03, 0.03],
			roughness: 0.88,
			fuzzAmount: 0.6,
		}),
	}
}


export function findOperatorAlgebraProblems(options = {}) {
	const tolerance = options.tolerance ?? SB_GATES.maxOperatorAlgebraEnergyDeviation
	const closureCeiling = options.closureCeiling ?? SB_MAX_CLOSURES_PER_PIXEL
	const { redMetal, roughPlastic, paleCloth } = options.branches ?? createReferenceAlgebraBranches()
	const problems = []
	const addOptions = { closureCeiling }

	const leftGrouped = applyAddOperator(applyAddOperator(redMetal, roughPlastic, addOptions).branch, paleCloth, addOptions)
	const rightGrouped = applyAddOperator(redMetal, applyAddOperator(roughPlastic, paleCloth, addOptions).branch, addOptions)
	if (!leftGrouped.ok || !rightGrouped.ok) {
		problems.push("a soma de 3 niveis foi recusada: " + (leftGrouped.refusal ?? rightGrouped.refusal)?.reason)
		return problems
	}
	if (!branchesAreIdentical(leftGrouped.branch, rightGrouped.branch)) {
		problems.push("Add nao e associativo em 3 niveis: as duas arvores dao listas de closure diferentes")
	}

	const summedEnergy = branchEnergy(leftGrouped.branch)
	const expectedEnergy = branchEnergy(redMetal) + branchEnergy(roughPlastic) + branchEnergy(paleCloth)
	const addDeviation = relativeEnergyDeviation(summedEnergy, expectedEnergy)
	if (addDeviation > tolerance) problems.push(`Add mexeu na energia: desvio relativo ${addDeviation}`)

	const firstWeight = 0.4
	const secondWeight = 0.25
	const nested = applyWeightOperator(applyWeightOperator(paleCloth, firstWeight).branch, secondWeight)
	const collapsed = applyWeightOperator(paleCloth, firstWeight * secondWeight)
	if (!nested.ok || !collapsed.ok) {
		problems.push("Weight aninhado foi recusado")
		return problems
	}
	const nestedDeviation = relativeEnergyDeviation(branchEnergy(nested.branch), branchEnergy(collapsed.branch))
	if (nestedDeviation > tolerance) {
		problems.push(`Weight aninhado nao vale o produto dos pesos: desvio relativo ${nestedDeviation}`)
	}

	const weightedSum = applyWeightOperator(applyAddOperator(redMetal, roughPlastic, addOptions).branch, firstWeight)
	const sumOfWeighted = applyAddOperator(
		applyWeightOperator(redMetal, firstWeight).branch,
		applyWeightOperator(roughPlastic, firstWeight).branch,
		addOptions,
	)
	if (!weightedSum.ok || !sumOfWeighted.ok) {
		problems.push("a distributiva de Weight sobre Add foi recusada")
		return problems
	}
	if (!branchesAreIdentical(weightedSum.branch, sumOfWeighted.branch)) {
		problems.push("Weight nao distribui sobre Add")
	}

	const identity = applyWeightOperator(paleCloth, 1)
	if (!identity.ok || !branchesAreIdentical(identity.branch, paleCloth)) {
		problems.push("peso 1 deveria ser identidade byte a byte")
	}

	const annihilator = applyWeightOperator(paleCloth, 0)
	if (!annihilator.ok || 0 !== branchClosureCount(annihilator.branch)) {
		problems.push("peso 0 deveria esvaziar o ramo e devolver o orcamento")
	}

	if (applyWeightOperator(paleCloth, -0.1).ok) problems.push("peso negativo deveria ser recusado")
	if (applyWeightOperator(paleCloth, 1.5).ok) problems.push("peso acima de 1 deveria ser recusado")

	return problems
}


export function describeOperatorAlgebra(options = {}) {
	const branches = options.branches ?? createReferenceAlgebraBranches()
	const problems = findOperatorAlgebraProblems({ ...options, branches })
	return {
		owner: "SB-F20",
		operators: [SB_ADD_OPERATOR_NAME, SB_WEIGHT_OPERATOR_NAME],
		tolerance: options.tolerance ?? SB_GATES.maxOperatorAlgebraEnergyDeviation,
		branchEnergies: Object.fromEntries(
			Object.entries(branches).map(([branchName, branch]) => [branchName, branchEnergy(branch)]),
		),
		ok: 0 === problems.length,
		problems,
	}
}
