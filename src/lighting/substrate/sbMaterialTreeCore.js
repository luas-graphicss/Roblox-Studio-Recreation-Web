import { SB_SLAB_PARAMETER_NAMES } from "./authoring/sbAuthoringLimits.js"
import { normalizeScalarF90 } from "./sbSlabF90Compatibility.js"
import { SB_CLOSURE_LAYOUTS } from "./sbClosureLayouts.js"
import { SB_BSDF_KINDS } from "./sbBsdfCatalog.js"
import { SB_OPERATORS } from "./sbOperatorCatalog.js"


export const SB_MATERIAL_TREE_FORMAT = "sbMaterialTree"
export const SB_MATERIAL_TREE_FORMAT_VERSION = 1

export const SB_NODE_TYPES = { bsdf: "bsdf", operator: "operator" }
export const SB_ROOT_PATH = "root"
export const SB_SLAB_BSDF_KIND = "slab"


export const SB_LAYER_CHILD_INDEX = { top: 0, bottom: 1 }
export const SB_MIXING_CHILD_INDEX = { first: 0, second: 1 }


export const SB_TREE_WALK_DEPTH_LIMIT = 64


export const SB_SHADING_CLASSES = { lit: "lit", unlit: "unlit", volume: "volume" }

const SHADING_CLASS_BY_BSDF_KIND = {
	slab: SB_SHADING_CLASSES.lit,
	hair: SB_SHADING_CLASSES.lit,
	eye: SB_SHADING_CLASSES.lit,
	singleLayerWater: SB_SHADING_CLASSES.lit,
	volume: SB_SHADING_CLASSES.volume,
	unlit: SB_SHADING_CLASSES.unlit,
}


const OPERATOR_ONLY_PARAMETER_NAMES = ["coverage", "thickness", "transmittanceColor", "weight"]


export const SB_TREE_ANOMALIES = {
	missingRoot: "missingRoot",
	unknownNodeType: "unknownNodeType",
	cycle: "cycle",
	depthLimit: "depthLimit",
}

export function isBsdfNode(node) {
	return Boolean(node) && typeof node === "object" && node.type === SB_NODE_TYPES.bsdf
}

export function isOperatorNode(node) {
	return Boolean(node) && typeof node === "object" && node.type === SB_NODE_TYPES.operator
}

export function isMaterialTreeNode(node) {
	return isBsdfNode(node) || isOperatorNode(node)
}

export function nodeChildren(node) {
	if (!isOperatorNode(node) || !Array.isArray(node.children)) return []
	return node.children
}

export function isKnownBsdfKind(bsdfKind) {
	return Boolean(SB_BSDF_KINDS[bsdfKind])
}

export function isKnownOperator(operatorName) {
	return Boolean(SB_OPERATORS[operatorName])
}

export function bsdfShadingClass(bsdfKind) {
	return SHADING_CLASS_BY_BSDF_KIND[bsdfKind] ?? null
}


export function bsdfParameterNames(bsdfKind) {
	if (bsdfKind === SB_SLAB_BSDF_KIND) return [...SB_SLAB_PARAMETER_NAMES]
	const layout = SB_CLOSURE_LAYOUTS[bsdfKind]
	if (!layout) return []
	return layout.payload
		.map((field) => field.name)
		.filter((parameterName) => !OPERATOR_ONLY_PARAMETER_NAMES.includes(parameterName))
}

export function operatorParameterNames(operatorName) {
	return [...(SB_OPERATORS[operatorName]?.parameters ?? [])]
}

export function createBsdfNode(definition) {
	const { bsdf = SB_SLAB_BSDF_KIND, parameters = {}, label = null } = definition ?? {}
	const normalizedParameters = { ...parameters }
	if (bsdf === SB_SLAB_BSDF_KIND && Object.hasOwn(parameters, "f90")) normalizedParameters.f90 = normalizeScalarF90(parameters.f90)
	return { type: SB_NODE_TYPES.bsdf, bsdf, label, parameters: normalizedParameters }
}


export function createSlabNode(parameters, options) {
	return createBsdfNode({ bsdf: SB_SLAB_BSDF_KIND, parameters, label: options?.label ?? null })
}

export function createOperatorNode(definition) {
	const { operator = null, parameters = {}, children = [], label = null } = definition ?? {}
	return {
		type: SB_NODE_TYPES.operator,
		operator,
		label,
		parameters: { ...parameters },
		children: Array.isArray(children) ? [...children] : [],
	}
}

function describeRawNodeType(node) {
	if (node === null || node === undefined) return "ausente"
	if (typeof node !== "object") return typeof node
	return "type=" + String(node.type)
}

function normalizeParameters(parameters) {
	if (!parameters || typeof parameters !== "object") return {}
	const normalized = {}
	for (const parameterName of Object.keys(parameters).sort()) {
		const value = parameterName === "f90" ? normalizeScalarF90(parameters[parameterName]) : parameters[parameterName]
		normalized[parameterName] = Array.isArray(value) ? [...value] : value
	}
	return normalized
}


function normalizeNode(node, path, depth, ancestorNodes, anomalies) {
	if (ancestorNodes.includes(node)) {
		anomalies.push({ anomaly: SB_TREE_ANOMALIES.cycle, path, detail: describeRawNodeType(node) })
		return null
	}
	if (depth > SB_TREE_WALK_DEPTH_LIMIT) {
		anomalies.push({ anomaly: SB_TREE_ANOMALIES.depthLimit, path, detail: "profundidade " + depth })
		return null
	}
	if (isBsdfNode(node)) {
		return {
			type: SB_NODE_TYPES.bsdf,
			path,
			bsdf: node.bsdf ?? null,
			label: node.label ?? null,
			parameters: normalizeParameters(node.parameters),
		}
	}
	if (isOperatorNode(node)) {
		const nextAncestors = [...ancestorNodes, node]
		const children = nodeChildren(node)
			.map((childNode, childIndex) =>
				normalizeNode(childNode, path + "/" + childIndex, depth + 1, nextAncestors, anomalies),
			)
			.filter((childNode) => Boolean(childNode))
		return {
			type: SB_NODE_TYPES.operator,
			path,
			operator: node.operator ?? null,
			label: node.label ?? null,
			parameters: normalizeParameters(node.parameters),
			children,
		}
	}
	anomalies.push({ anomaly: SB_TREE_ANOMALIES.unknownNodeType, path, detail: describeRawNodeType(node) })
	return null
}


export function normalizeMaterialTree(rawRootNode) {
	const anomalies = []
	if (!isMaterialTreeNode(rawRootNode)) {
		anomalies.push({
			anomaly: isMaterialTreeNode(rawRootNode) ? SB_TREE_ANOMALIES.unknownNodeType : SB_TREE_ANOMALIES.missingRoot,
			path: SB_ROOT_PATH,
			detail: describeRawNodeType(rawRootNode),
		})
		return { ok: false, root: null, anomalies }
	}
	const root = normalizeNode(rawRootNode, SB_ROOT_PATH, 1, [], anomalies)
	return { ok: Boolean(root) && anomalies.length === 0, root, anomalies }
}


export function walkMaterialTree(rootNode, visitNode) {
	const anomalies = []

	function descend(node, path, depth, ancestorNodes) {
		if (ancestorNodes.includes(node)) {
			anomalies.push({ anomaly: SB_TREE_ANOMALIES.cycle, path })
			return
		}
		if (depth > SB_TREE_WALK_DEPTH_LIMIT) {
			anomalies.push({ anomaly: SB_TREE_ANOMALIES.depthLimit, path })
			return
		}
		if (!isMaterialTreeNode(node)) {
			anomalies.push({ anomaly: SB_TREE_ANOMALIES.unknownNodeType, path, detail: describeRawNodeType(node) })
			return
		}
		visitNode({ node, path: node.path ?? path, depth })
		const nextAncestors = [...ancestorNodes, node]
		nodeChildren(node).forEach((childNode, childIndex) => {
			descend(childNode, path + "/" + childIndex, depth + 1, nextAncestors)
		})
	}

	if (!rootNode) return { anomalies: [{ anomaly: SB_TREE_ANOMALIES.missingRoot, path: SB_ROOT_PATH }] }
	descend(rootNode, SB_ROOT_PATH, 1, [])
	return { anomalies }
}

export function collectMaterialTreeNodes(rootNode) {
	const nodes = []
	const walk = walkMaterialTree(rootNode, (visit) => nodes.push(visit))
	return { nodes, anomalies: walk.anomalies }
}

export function materialTreeDepth(rootNode) {
	return collectMaterialTreeNodes(rootNode).nodes.reduce((deepest, entry) => Math.max(deepest, entry.depth), 0)
}

function uniqueSorted(values) {
	return Array.from(new Set(values.filter((value) => value !== null && value !== undefined))).sort()
}


export function materialTreeShadingClass(rootNode) {
	const mismatches = []

	function resolve(node) {
		if (isBsdfNode(node)) return bsdfShadingClass(node.bsdf)
		if (!isOperatorNode(node)) return null
		const childClasses = uniqueSorted(nodeChildren(node).map((childNode) => resolve(childNode)))
		if (childClasses.length > 1) {
			mismatches.push({ path: node.path ?? null, operator: node.operator ?? null, classes: childClasses })
		}
		return childClasses[0] ?? null
	}

	return { shadingClass: resolve(rootNode), mismatches }
}


export function describeMaterialTree(rawRootNode) {
	const normalization = normalizeMaterialTree(rawRootNode)
	if (!normalization.root) {
		return {
			ok: false,
			depth: 0,
			nodeCount: 0,
			bsdfCount: 0,
			operatorCount: 0,
			slabCount: 0,
			bsdfKinds: [],
			operators: [],
			shadingClass: null,
			shadingMismatches: [],
			anomalies: normalization.anomalies,
		}
	}
	const { nodes } = collectMaterialTreeNodes(normalization.root)
	const bsdfEntries = nodes.filter((entry) => isBsdfNode(entry.node))
	const operatorEntries = nodes.filter((entry) => isOperatorNode(entry.node))
	const shading = materialTreeShadingClass(normalization.root)
	return {
		ok: normalization.ok,
		depth: nodes.reduce((deepest, entry) => Math.max(deepest, entry.depth), 0),
		nodeCount: nodes.length,
		bsdfCount: bsdfEntries.length,
		operatorCount: operatorEntries.length,
		slabCount: bsdfEntries.filter((entry) => entry.node.bsdf === SB_SLAB_BSDF_KIND).length,
		bsdfKinds: uniqueSorted(bsdfEntries.map((entry) => entry.node.bsdf)),
		operators: uniqueSorted(operatorEntries.map((entry) => entry.node.operator)),
		shadingClass: shading.shadingClass,
		shadingMismatches: shading.mismatches,
		anomalies: normalization.anomalies,
	}
}

function referenceSlab(overrides, label) {
	return createSlabNode(
		{
			albedo: [0.8, 0.8, 0.8],
			f0: [0.04, 0.04, 0.04],
			f90: [1, 1, 1],
			roughness: 0.4,
			opacity: 1,
			...overrides,
		},
		{ label },
	)
}


export function createReferenceSlabTree() {
	return referenceSlab({ albedo: [0.72, 0.72, 0.74], roughness: 0.3 }, "dielectricReference")
}


export function createReferenceLayeredTree() {
	return createOperatorNode({
		operator: "horizontalMixing",
		label: "carPaintMixedWithWornPlastic",
		parameters: { weight: 0.35 },
		children: [
			createOperatorNode({
				operator: "verticalLayering",
				label: "clearCoatOverMetallicBase",
				parameters: { coverage: 1, thickness: 0.08, transmittanceColor: [0.95, 0.92, 0.9] },
				children: [
					referenceSlab({ albedo: [0, 0, 0], f0: [0.05, 0.05, 0.05], roughness: 0.06 }, "clearCoat"),
					referenceSlab(
						{ albedo: [0.44, 0.03, 0.06], f0: [0.6, 0.58, 0.56], roughness: 0.28 },
						"metallicBase",
					),
				],
			}),
			createOperatorNode({
				operator: "verticalLayering",
				label: "oilFilmOverPaintedPlastic",
				parameters: { coverage: 0.6, thickness: 0.02, transmittanceColor: [1, 0.98, 0.96] },
				children: [
					referenceSlab(
						{ albedo: [0, 0, 0], roughness: 0.18, thinFilmThicknessNanometers: 380, thinFilmIor: 1.33 },
						"oilFilm",
					),
					referenceSlab({ albedo: [0.18, 0.19, 0.2], roughness: 0.52 }, "paintedPlastic"),
				],
			}),
		],
	})
}
