import {
	SB_ROOT_PATH,
	SB_SLAB_BSDF_KIND,
	bsdfParameterNames,
	collectMaterialTreeNodes,
	createOperatorNode,
	createSlabNode,
	describeMaterialTree,
	isBsdfNode,
	isOperatorNode,
	nodeChildren,
	normalizeMaterialTree,
	operatorParameterNames,
} from "./sbMaterialTreeCore.js"
import { validateMaterialTree } from "./sbMaterialTreeValidation.js"
import { sanitizeSlabParameters } from "./authoring/sbSlabParameterValues.js"
import { slabParameterNames } from "./authoring/sbSlabParameterSchema.js"
import { SB_AUTHORING_PARAMETER_RANGES, describeValueRangeRefusal } from "./sbAuthoringParameterRanges.js"
import { SB_AUTO_VALUE, isAutoValue } from "./authoring/sbAutoValue.js"

export const SB_VERTICAL_LAYERING_OPERATOR = "verticalLayering"
export const SB_HORIZONTAL_MIXING_OPERATOR = "horizontalMixing"


export const SB_AUTHORING_OPERATOR_DEFAULTS = Object.freeze({
	[SB_VERTICAL_LAYERING_OPERATOR]: Object.freeze({
		coverage: 1,
		thickness: 0.02,
		transmittanceColor: Object.freeze([1, 1, 1]),
	}),
	[SB_HORIZONTAL_MIXING_OPERATOR]: Object.freeze({ weight: 0.5 }),
})

function copyValue(value) {
	return Array.isArray(value) ? [...value] : value
}

function copyParameters(parameters) {
	const copied = {}
	for (const parameterName of Object.keys(parameters ?? {})) {
		copied[parameterName] = copyValue(parameters[parameterName])
	}
	return copied
}

function operatorDefaultsFor(operatorName) {
	return copyParameters(SB_AUTHORING_OPERATOR_DEFAULTS[operatorName] ?? {})
}


export function describeRefusal(refusal) {
	const place = refusal.path ?? SB_ROOT_PATH
	return place + ": " + refusal.reason + " [" + refusal.code + "]"
}

function refuseEdit(reason) {
	return { ok: false, root: null, refusals: [reason], validation: null }
}


export function normalizeAuthoringGraph(rawRootNode) {
	const normalization = normalizeMaterialTree(rawRootNode)
	return { ok: Boolean(normalization.root), root: normalization.root, anomalies: normalization.anomalies }
}


export function createAutoSlabGraph() {
	const parameters = {}
	for (const parameterName of slabParameterNames()) parameters[parameterName] = SB_AUTO_VALUE
	return createSlabNode(parameters, { label: "autoSlab" })
}


export function acceptsAutoValue(node) {
	return isBsdfNode(node) && node.bsdf === SB_SLAB_BSDF_KIND
}


export function resolveAutoParameters(rootNode) {
	if (isBsdfNode(rootNode)) {
		if (rootNode.bsdf !== SB_SLAB_BSDF_KIND) return { ...rootNode, parameters: copyParameters(rootNode.parameters) }
		return { ...rootNode, parameters: sanitizeSlabParameters(rootNode.parameters) }
	}
	if (!isOperatorNode(rootNode)) return rootNode
	return {
		...rootNode,
		parameters: copyParameters(rootNode.parameters),
		children: nodeChildren(rootNode).map((childNode) => resolveAutoParameters(childNode)),
	}
}


export function authoredAutoParameters(rootNode) {
	const { nodes } = collectMaterialTreeNodes(rootNode)
	const entries = []
	for (const visit of nodes) {
		const parameters = visit.node.parameters ?? {}
		for (const parameterName of Object.keys(parameters).sort()) {
			if (isAutoValue(parameters[parameterName])) entries.push({ path: visit.path, parameterName })
		}
	}
	return entries
}


export const SB_AUTHORED_RANGE_REFUSAL_CODE = "authoredParameterOutOfRange"


export function findAuthoredRangeRefusals(rootNode) {
	const { nodes } = collectMaterialTreeNodes(rootNode)
	const refusals = []
	for (const visit of nodes) {
		const parameters = visit.node.parameters ?? {}
		for (const parameterName of Object.keys(parameters).sort()) {
			const value = parameters[parameterName]
			if (isAutoValue(value)) continue
			const reason = describeValueRangeRefusal(parameterName, value)
			if (reason) refusals.push({ path: visit.path, reason, code: SB_AUTHORED_RANGE_REFUSAL_CODE })
		}
	}
	return refusals
}


export function validateAuthoringGraph(rootNode) {
	const authoredRefusals = findAuthoredRangeRefusals(rootNode)
	const validation = validateMaterialTree(resolveAutoParameters(rootNode), {
		parameterRanges: SB_AUTHORING_PARAMETER_RANGES,
	})
	const refusals = [...authoredRefusals, ...validation.refusals]
	return {
		...validation,
		ok: validation.ok && refusals.length === 0,
		refusals,
		autoParameters: authoredAutoParameters(rootNode),
	}
}

function acceptEdit(rawRootNode) {
	const normalization = normalizeAuthoringGraph(rawRootNode)
	if (!normalization.ok) return refuseEdit("a edicao deixaria a arvore sem raiz aproveitavel")
	const validation = validateAuthoringGraph(normalization.root)
	if (!validation.ok) {
		return { ok: false, root: null, refusals: validation.refusals.map(describeRefusal), validation }
	}
	return { ok: true, root: normalization.root, refusals: [], validation }
}

function findVisit(rootNode, path) {
	const { nodes } = collectMaterialTreeNodes(rootNode)
	return nodes.find((visit) => visit.path === path) ?? null
}

function replaceAtPath(node, path, createReplacement) {
	if (node.path === path) return createReplacement(node)
	if (!isOperatorNode(node)) return node
	return {
		...node,
		children: nodeChildren(node).map((childNode) => replaceAtPath(childNode, path, createReplacement)),
	}
}

function parentPathOf(path) {
	const separatorIndex = String(path).lastIndexOf("/")
	return separatorIndex > 0 ? String(path).slice(0, separatorIndex) : null
}

function allowedParameterNames(node) {
	if (isBsdfNode(node)) return bsdfParameterNames(node.bsdf)
	if (isOperatorNode(node)) return operatorParameterNames(node.operator)
	return []
}


export function setNodeParameter(rootNode, request = {}) {
	const { path, parameterName, value } = request
	const normalization = normalizeAuthoringGraph(rootNode)
	if (!normalization.ok) return refuseEdit("a arvore de entrada nao tem raiz aproveitavel")
	const visit = findVisit(normalization.root, path)
	if (!visit) return refuseEdit("caminho inexistente na arvore: " + String(path))
	const allowedNames = allowedParameterNames(visit.node)
	if (!allowedNames.includes(parameterName)) {
		return refuseEdit(
			'o parametro "' + String(parameterName) + '" nao pertence a este no; aceitos: ' + allowedNames.join(", "),
		)
	}
	if (isAutoValue(value) && !acceptsAutoValue(visit.node)) {
		return refuseEdit(
			"AUTO so existe onde a SB-F4 declara default, isto e, em parametro de slab; " +
				String(parameterName) +
				" precisa de valor explicito",
		)
	}
	const nextRoot = replaceAtPath(normalization.root, path, (node) => ({
		...node,
		parameters: { ...copyParameters(node.parameters), [parameterName]: copyValue(value) },
	}))
	return acceptEdit(nextRoot)
}


export function insertVerticalLayer(rootNode, request = {}) {
	const { path = SB_ROOT_PATH, layerParameters = {}, topParameters = {}, label = null, topLabel = null } = request
	const normalization = normalizeAuthoringGraph(rootNode)
	if (!normalization.ok) return refuseEdit("a arvore de entrada nao tem raiz aproveitavel")
	if (!findVisit(normalization.root, path)) return refuseEdit("caminho inexistente na arvore: " + String(path))
	const nextRoot = replaceAtPath(normalization.root, path, (node) =>
		createOperatorNode({
			operator: SB_VERTICAL_LAYERING_OPERATOR,
			label,
			parameters: { ...operatorDefaultsFor(SB_VERTICAL_LAYERING_OPERATOR), ...copyParameters(layerParameters) },
			children: [createSlabNode(copyParameters(topParameters), { label: topLabel }), node],
		}),
	)
	return acceptEdit(nextRoot)
}


export function insertHorizontalMix(rootNode, request = {}) {
	const { path = SB_ROOT_PATH, mixParameters = {}, sideParameters = {}, label = null, sideLabel = null } = request
	const normalization = normalizeAuthoringGraph(rootNode)
	if (!normalization.ok) return refuseEdit("a arvore de entrada nao tem raiz aproveitavel")
	if (!findVisit(normalization.root, path)) return refuseEdit("caminho inexistente na arvore: " + String(path))
	const nextRoot = replaceAtPath(normalization.root, path, (node) =>
		createOperatorNode({
			operator: SB_HORIZONTAL_MIXING_OPERATOR,
			label,
			parameters: { ...operatorDefaultsFor(SB_HORIZONTAL_MIXING_OPERATOR), ...copyParameters(mixParameters) },
			children: [node, createSlabNode(copyParameters(sideParameters), { label: sideLabel })],
		}),
	)
	return acceptEdit(nextRoot)
}


export function removeNode(rootNode, request = {}) {
	const { path } = request
	const normalization = normalizeAuthoringGraph(rootNode)
	if (!normalization.ok) return refuseEdit("a arvore de entrada nao tem raiz aproveitavel")
	if (path === SB_ROOT_PATH) return refuseEdit("a raiz nao pode ser removida: um material precisa de pelo menos um no")
	if (!findVisit(normalization.root, path)) return refuseEdit("caminho inexistente na arvore: " + String(path))
	const parentPath = parentPathOf(path)
	const parentVisit = parentPath === null ? null : findVisit(normalization.root, parentPath)
	if (!parentVisit || !isOperatorNode(parentVisit.node)) {
		return refuseEdit("o no removido nao tem operador pai: nada a promover no lugar dele")
	}
	const survivors = nodeChildren(parentVisit.node).filter((childNode) => childNode.path !== path)
	if (survivors.length === 0) {
		return refuseEdit(
			'o operador "' + String(parentVisit.node.operator) + '" ficaria sem operando nenhum; remova o operador inteiro',
		)
	}
	const promoted = survivors[0]
	return acceptEdit(replaceAtPath(normalization.root, parentPath, () => promoted))
}


export function listAuthoringNodes(rootNode) {
	const { nodes } = collectMaterialTreeNodes(rootNode)
	return nodes.map((visit) => {
		const parameters = visit.node.parameters ?? {}
		return {
			path: visit.path,
			depth: visit.depth,
			kind: isOperatorNode(visit.node) ? "operator" : "bsdf",
			bsdf: isBsdfNode(visit.node) ? visit.node.bsdf : null,
			operator: isOperatorNode(visit.node) ? visit.node.operator : null,
			label: visit.node.label ?? null,
			parameterNames: allowedParameterNames(visit.node),
			autoParameterNames: Object.keys(parameters)
				.filter((parameterName) => isAutoValue(parameters[parameterName]))
				.sort(),
			acceptsAuto: acceptsAutoValue(visit.node),
		}
	})
}


export function describeAuthoringGraph(rootNode) {
	const validation = validateAuthoringGraph(rootNode)
	const structure = describeMaterialTree(rootNode)
	return {
		ok: validation.ok,
		nodeCount: structure.nodeCount,
		depth: structure.depth,
		slabCount: structure.slabCount,
		operators: structure.operators,
		shadingClass: structure.shadingClass,
		autoParameterCount: validation.autoParameters.length,
		refusals: validation.refusals.map(describeRefusal),
	}
}
