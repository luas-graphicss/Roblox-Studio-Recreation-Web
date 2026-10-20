import {
	SB_MAX_CLOSURES_PER_PIXEL,
	SB_CLOSURE_BYTES_CEILING,
	SB_BYTES_PER_PIXEL_CEILING,
	tierDefaults,
} from "./sbMaterialContract.js"
import { closureLayoutBytes } from "./sbClosureLayouts.js"
import { SB_REFUSAL_CODES } from "./sbOperatorRefusals.js"
import { SB_CLOSURE_MATH, operatorClosureMath } from "./sbOperatorCatalog.js"
import { bsdfClosureCost } from "./sbBsdfCatalog.js"
import {
	SB_ROOT_PATH,
	SB_LAYER_CHILD_INDEX,
	SB_MIXING_CHILD_INDEX,
	isBsdfNode,
	isOperatorNode,
	nodeChildren,
} from "./sbMaterialTreeCore.js"
import { validateMaterialTree } from "./sbMaterialTreeValidation.js"
import {
	SB_DEFAULT_MATERIAL_FAMILY,
	createTopologyDescriptor,
	topologySignature,
	topologySignatureHash,
	createProgramKey,
} from "./sbTopologySignatureCore.js"


export const SB_TOPOLOGY_FORMAT = "sbTopology"
export const SB_TOPOLOGY_FORMAT_VERSION = 1


const DEFAULT_TIER = "forte"


const ROOT_WEIGHT = 1
const ROOT_LAYER_INDEX = 0
const ROOT_DEPTH = 1


export const SB_NEGLIGIBLE_WEIGHT = 1e-4

const VERTICAL_LAYERING_OPERATOR = "verticalLayering"
const HORIZONTAL_MIXING_OPERATOR = "horizontalMixing"
const WEIGHT_OPERATOR = "weight"


const DEFAULT_COVERAGE = 1
const DEFAULT_THICKNESS = 0
const DEFAULT_MIXING_WEIGHT = 0.5
const DEFAULT_BRANCH_WEIGHT = 1








export const SB_CLOSURE_FEATURES = Object.freeze({
	anisotropy: "anisotropy",
	emissive: "emissive",
	fuzz: "fuzz",
	glints: "glints",
	secondLobe: "secondLobe",
	specularProfile: "specularProfile",
	subsurface: "subsurface",
	thinFilm: "thinFilm",
	transparency: "transparency",
})

function isFiniteNumber(value) {
	return typeof value === "number" && Number.isFinite(value)
}

function isPositive(value) {
	return isFiniteNumber(value) && value > 0
}

function isNonZero(value) {
	return isFiniteNumber(value) && value !== 0
}

function hasPositiveComponent(value) {
	if (Array.isArray(value)) return value.some((component) => isPositive(component))
	return isPositive(value)
}


function isPartiallyTransparent(value) {
	return isFiniteNumber(value) && 1 > value
}


const FEATURE_ACTIVATION = Object.freeze([
	{ feature: SB_CLOSURE_FEATURES.anisotropy, isActive: (parameters) => isNonZero(parameters.anisotropy) },
	{ feature: SB_CLOSURE_FEATURES.emissive, isActive: (parameters) => hasPositiveComponent(parameters.emissive) },
	{ feature: SB_CLOSURE_FEATURES.fuzz, isActive: (parameters) => isPositive(parameters.fuzzAmount) },
	{ feature: SB_CLOSURE_FEATURES.glints, isActive: (parameters) => isPositive(parameters.glintDensity) },
	{ feature: SB_CLOSURE_FEATURES.secondLobe, isActive: (parameters) => isPositive(parameters.secondRoughnessWeight) },
	{
		feature: SB_CLOSURE_FEATURES.specularProfile,
		isActive: (parameters) => isPositive(parameters.specularProfileIndex),
	},
	{
		feature: SB_CLOSURE_FEATURES.subsurface,
		isActive: (parameters) => hasPositiveComponent(parameters.subsurfaceMeanFreePath),
	},
	{
		feature: SB_CLOSURE_FEATURES.thinFilm,
		isActive: (parameters) => isPositive(parameters.thinFilmThicknessNanometers),
	},
	{ feature: SB_CLOSURE_FEATURES.transparency, isActive: (parameters) => isPartiallyTransparent(parameters.opacity) },
])


export function closureFeatures(parameters) {
	const source = parameters && typeof parameters === "object" ? parameters : {}
	return FEATURE_ACTIVATION.filter((entry) => entry.isActive(source))
		.map((entry) => entry.feature)
		.sort()
}

function createCompilerRefusal({ code, path, bsdf, operator, reason, detail }) {
	return {
		code,
		path: path ?? SB_ROOT_PATH,
		bsdf: bsdf ?? null,
		operator: operator ?? null,
		reason,
		detail: detail ?? null,
	}
}

function createRootBranch() {
	return { weight: ROOT_WEIGHT, layerIndex: ROOT_LAYER_INDEX, depth: ROOT_DEPTH, coveredBy: null }
}

function descendBranch(branch, weightFactor, layerIndexOffset, coveredBy) {
	return {
		weight: branch.weight * weightFactor,
		layerIndex: branch.layerIndex + layerIndexOffset,
		depth: branch.depth + 1,
		coveredBy: coveredBy ?? null,
	}
}

function readOperatorWeight(operatorNode, defaultValue) {
	const value = operatorNode.parameters?.weight
	return isFiniteNumber(value) ? value : defaultValue
}


function readLayer(operatorNode) {
	const parameters = operatorNode.parameters ?? {}
	return {
		path: operatorNode.path ?? SB_ROOT_PATH,
		coverage: isFiniteNumber(parameters.coverage) ? parameters.coverage : DEFAULT_COVERAGE,
		thickness: isFiniteNumber(parameters.thickness) ? parameters.thickness : DEFAULT_THICKNESS,
		transmittanceColor: Array.isArray(parameters.transmittanceColor) ? [...parameters.transmittanceColor] : null,
	}
}


function childBranches(operatorNode, branch) {
	const children = nodeChildren(operatorNode)

	if (operatorNode.operator === VERTICAL_LAYERING_OPERATOR) {
		const layer = readLayer(operatorNode)
		return [
			{ node: children[SB_LAYER_CHILD_INDEX.top], branch: descendBranch(branch, 1, 0, branch.coveredBy) },
			{ node: children[SB_LAYER_CHILD_INDEX.bottom], branch: descendBranch(branch, 1, 1, layer) },
		].filter((entry) => Boolean(entry.node))
	}

	if (operatorNode.operator === HORIZONTAL_MIXING_OPERATOR) {
		const secondShare = readOperatorWeight(operatorNode, DEFAULT_MIXING_WEIGHT)
		return [
			{
				node: children[SB_MIXING_CHILD_INDEX.first],
				branch: descendBranch(branch, 1 - secondShare, 0, branch.coveredBy),
			},
			{
				node: children[SB_MIXING_CHILD_INDEX.second],
				branch: descendBranch(branch, secondShare, 0, branch.coveredBy),
			},
		].filter((entry) => Boolean(entry.node))
	}

	if (operatorNode.operator === WEIGHT_OPERATOR) {
		const branchShare = readOperatorWeight(operatorNode, DEFAULT_BRANCH_WEIGHT)
		return children
			.filter(Boolean)
			.map((childNode) => ({ node: childNode, branch: descendBranch(branch, branchShare, 0, branch.coveredBy) }))
	}

	return children
		.filter(Boolean)
		.map((childNode) => ({ node: childNode, branch: descendBranch(branch, 1, 0, branch.coveredBy) }))
}


function flattenMaterialTree(rootNode) {
	const closures = []
	const operators = []
	const prunedBranches = []
	const refusals = []

	function appendClosure(bsdfNode, branch) {
		const path = bsdfNode.path ?? SB_ROOT_PATH
		if (SB_NEGLIGIBLE_WEIGHT > Math.abs(branch.weight)) {
			prunedBranches.push({
				path,
				bsdf: bsdfNode.bsdf ?? null,
				label: bsdfNode.label ?? null,
				weight: branch.weight,
				reason: "peso desprezivel: o ramo nao muda a imagem",
			})
			return
		}
		const bytes = closureLayoutBytes(bsdfNode.bsdf)
		if (bytes === null || bytes === undefined) {
			refusals.push(
				createCompilerRefusal({
					code: SB_REFUSAL_CODES.unsupportedChild,
					path,
					bsdf: bsdfNode.bsdf ?? null,
					reason: `o BSDF "${bsdfNode.bsdf}" nao tem layout de closure declarado`,
					detail: "sem layout nao ha bytes para orcar",
				}),
			)
			return
		}
		closures.push({
			index: closures.length,
			bsdf: bsdfNode.bsdf,
			path,
			label: bsdfNode.label ?? null,
			layerIndex: branch.layerIndex,
			weight: branch.weight,
			closureCost: bsdfClosureCost(bsdfNode.bsdf) ?? 0,
			bytes,
			features: closureFeatures(bsdfNode.parameters),
			coveredBy: branch.coveredBy,
			parameters: bsdfNode.parameters ?? {},
		})
	}

	function descend(node, branch) {
		if (isBsdfNode(node)) {
			appendClosure(node, branch)
			return
		}
		if (!isOperatorNode(node)) return
		operators.push({
			operator: node.operator,
			path: node.path ?? SB_ROOT_PATH,
			label: node.label ?? null,
			depth: branch.depth,
			closureMath: operatorClosureMath(node.operator) ?? null,
		})
		for (const child of childBranches(node, branch)) descend(child.node, child.branch)
	}

	descend(rootNode, createRootBranch())
	return { closures, operators, prunedBranches, refusals }
}


export function evaluateTopologyBudget(closures, tierName) {
	const defaults = tierDefaults(tierName) ?? {}
	const tierClosuresPerPixel = isFiniteNumber(defaults.closuresPerPixel)
		? defaults.closuresPerPixel
		: SB_MAX_CLOSURES_PER_PIXEL
	const tierClosureBytes = isFiniteNumber(defaults.closureBytes) ? defaults.closureBytes : SB_CLOSURE_BYTES_CEILING

	const closureCount = closures.reduce((total, closure) => total + closure.closureCost, 0)
	const byteCount = closures.reduce((total, closure) => total + closure.bytes, 0)
	const closureCeiling = Math.min(tierClosuresPerPixel, SB_MAX_CLOSURES_PER_PIXEL)
	const byteCeiling = Math.min(tierClosuresPerPixel * tierClosureBytes, SB_BYTES_PER_PIXEL_CEILING)
	const closuresOverBudget = Math.max(0, closureCount - closureCeiling)
	const bytesOverBudget = Math.max(0, byteCount - byteCeiling)
	const oversizedClosures = closures
		.filter((closure) => closure.bytes > SB_CLOSURE_BYTES_CEILING)
		.map((closure) => ({ index: closure.index, bsdf: closure.bsdf, bytes: closure.bytes }))

	return {
		tier: tierName,
		closureCount,
		closureCeiling,
		closuresOverBudget,
		byteCount,
		byteCeiling,
		bytesOverBudget,
		closureBytesCeiling: SB_CLOSURE_BYTES_CEILING,
		oversizedClosures,
		withinBudget: closuresOverBudget === 0 && bytesOverBudget === 0 && oversizedClosures.length === 0,
	}
}

function closureIndexesUnder(closures, pathPrefix) {
	return closures
		.filter((closure) => closure.path === pathPrefix || closure.path.startsWith(pathPrefix + "/"))
		.map((closure) => closure.index)
}


export function collectBlendCandidates(operators, closures) {
	return operators
		.filter((entry) => entry.closureMath === SB_CLOSURE_MATH.sumOrBlend)
		.map((entry) => ({
			operator: entry.operator,
			path: entry.path,
			firstSide: closureIndexesUnder(closures, entry.path + "/" + SB_MIXING_CHILD_INDEX.first),
			secondSide: closureIndexesUnder(closures, entry.path + "/" + SB_MIXING_CHILD_INDEX.second),
		}))
		.filter((candidate) => candidate.firstSide.length > 0 && candidate.secondSide.length > 0)
}


export function topologyOrderProblems(closures) {
	const problems = []
	closures.forEach((closure, position) => {
		if (closure.index !== position) {
			problems.push(`closure na posicao ${position} carrega o indice ${closure.index}`)
		}
		if (!closure.coveredBy) return
		const hasCoveringClosureBefore = closures
			.slice(0, position)
			.some((earlier) => closure.layerIndex > earlier.layerIndex)
		if (!hasCoveringClosureBefore) {
			problems.push(`closure ${closure.index} (${closure.path}) esta coberta e nao tem topo antes dela`)
		}
	})
	return problems
}

function createRefusedTopology({ refusals, tierName, materialFamily }) {
	return {
		ok: false,
		format: SB_TOPOLOGY_FORMAT,
		version: SB_TOPOLOGY_FORMAT_VERSION,
		tier: tierName,
		materialFamily,
		shadingClass: null,
		closures: [],
		operators: [],
		prunedBranches: [],
		budget: evaluateTopologyBudget([], tierName),
		blendCandidates: [],
		requiresSimplification: false,
		orderProblems: [],
		descriptor: null,
		signature: null,
		signatureHash: null,
		programKey: null,
		refusals,
	}
}


export function compileMaterialTopology(rawRootNode, options = {}) {
	const tierName = options.tier ?? DEFAULT_TIER
	const materialFamily = options.materialFamily ?? SB_DEFAULT_MATERIAL_FAMILY
	try {
		const validation = validateMaterialTree(rawRootNode, options.validationOptions ?? {})
		if (!validation.ok || !validation.tree) {
			return createRefusedTopology({ refusals: validation.refusals, tierName, materialFamily })
		}

		const flattened = flattenMaterialTree(validation.tree)
		const closures = flattened.closures
		const shadingClass = validation.summary?.shadingClass ?? null
		const budget = evaluateTopologyBudget(closures, tierName)
		const blendCandidates = collectBlendCandidates(flattened.operators, closures)
		const orderProblems = topologyOrderProblems(closures)
		const descriptor = createTopologyDescriptor({ closures, operators: flattened.operators, shadingClass })
		const signature = topologySignature(descriptor)
		const signatureHash = topologySignatureHash(signature)

		return {
			ok: flattened.refusals.length === 0,
			format: SB_TOPOLOGY_FORMAT,
			version: SB_TOPOLOGY_FORMAT_VERSION,
			tier: tierName,
			materialFamily,
			shadingClass,
			closures,
			operators: flattened.operators,
			prunedBranches: flattened.prunedBranches,
			budget,
			blendCandidates,

			requiresSimplification: budget.withinBudget === false,
			simplifiable: blendCandidates.length > 0,
			orderProblems,
			descriptor,
			signature,
			signatureHash,
			programKey: createProgramKey(materialFamily, signatureHash),
			refusals: flattened.refusals,
			treeSummary: validation.summary,
		}
	} catch (error) {
		return createRefusedTopology({
			refusals: [
				createCompilerRefusal({
					code: SB_REFUSAL_CODES.unsupportedChild,
					reason: "o compilador de topologia nao conseguiu achatar esta arvore",
					detail: error?.message ?? String(error),
				}),
			],
			tierName,
			materialFamily,
		})
	}
}


export function describeCompiledTopology(compiledTopology) {
	if (!compiledTopology) return null
	return {
		ok: compiledTopology.ok,
		tier: compiledTopology.tier,
		materialFamily: compiledTopology.materialFamily,
		shadingClass: compiledTopology.shadingClass,
		signatureHash: compiledTopology.signatureHash,
		programKey: compiledTopology.programKey,
		closureCount: compiledTopology.budget.closureCount,
		closureCeiling: compiledTopology.budget.closureCeiling,
		byteCount: compiledTopology.budget.byteCount,
		byteCeiling: compiledTopology.budget.byteCeiling,
		withinBudget: compiledTopology.budget.withinBudget,
		requiresSimplification: compiledTopology.requiresSimplification,
		simplifiable: compiledTopology.simplifiable,
		blendCandidateCount: compiledTopology.blendCandidates.length,
		prunedCount: compiledTopology.prunedBranches.length,
		refusalCount: compiledTopology.refusals.length,
		orderProblems: compiledTopology.orderProblems,
		closures: compiledTopology.closures.map((closure) => ({
			index: closure.index,
			bsdf: closure.bsdf,
			label: closure.label,
			layerIndex: closure.layerIndex,
			weight: closure.weight,
			bytes: closure.bytes,
			covered: Boolean(closure.coveredBy),
			features: closure.features,
		})),
	}
}
