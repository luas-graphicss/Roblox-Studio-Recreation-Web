import {
	createOperatorNode,
	createSlabNode,
	isBsdfNode,
	isOperatorNode,
	nodeChildren,
	operatorParameterNames,
} from "./sbMaterialTreeCore.js"
import {
	canonicalJson,
	deserializeMaterialTree,
	materialTreeRoundTrip,
} from "./sbTreeSerializationCore.js"
import { convertLegacyMaterialToTopology } from "./authoring/sbLegacyMaterialConversion.js"
import { legacyMaterialNames } from "./sbLegacyMaterialTable.js"
import { authoredAutoParameters, describeRefusal, validateAuthoringGraph } from "./sbAuthoringGraphCore.js"


export const SB_LEGACY_CHILD_KEYS = Object.freeze(["top", "bottom"])

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

export function isLegacyOperatorNode(topology) {
	return topology !== null && typeof topology === "object" && typeof topology.operator === "string"
}


export function legacyTopologyToMaterialTree(topology) {
	if (!isLegacyOperatorNode(topology)) {
		if (topology === null || typeof topology !== "object") return null
		return createSlabNode(copyParameters(topology))
	}
	const parameters = {}
	for (const parameterName of operatorParameterNames(topology.operator)) {
		if (parameterName in topology) parameters[parameterName] = copyValue(topology[parameterName])
	}
	return createOperatorNode({
		operator: topology.operator,
		parameters,
		children: SB_LEGACY_CHILD_KEYS.map((childKey) => legacyTopologyToMaterialTree(topology[childKey] ?? null)),
	})
}


export function materialTreeToLegacyTopology(node) {
	if (isBsdfNode(node)) return copyParameters(node.parameters)
	if (!isOperatorNode(node)) return null
	const children = nodeChildren(node)
	return {
		operator: node.operator,
		...copyParameters(node.parameters),
		top: materialTreeToLegacyTopology(children[0] ?? null),
		bottom: materialTreeToLegacyTopology(children[1] ?? null),
	}
}


export function findLegacyTopologyExtraKeys(topology) {
	if (!isLegacyOperatorNode(topology)) return []
	const knownKeys = new Set(["operator", ...operatorParameterNames(topology.operator), ...SB_LEGACY_CHILD_KEYS])
	const extras = Object.keys(topology)
		.filter((key) => !knownKeys.has(key))
		.map((key) => topology.operator + "." + key)
	const childExtras = SB_LEGACY_CHILD_KEYS.flatMap((childKey) => findLegacyTopologyExtraKeys(topology[childKey]))
	return [...extras, ...childExtras]
}

function countTreeNodes(node) {
	if (!isOperatorNode(node)) return node === null ? 0 : 1
	return 1 + nodeChildren(node).reduce((total, childNode) => total + countTreeNodes(childNode), 0)
}


export function proveTreeRoundTrip(rootNode) {
	const roundTrip = materialTreeRoundTrip(rootNode)
	const authoredAuto = authoredAutoParameters(rootNode)
	const restored =
		typeof roundTrip.text === "string"
			? deserializeMaterialTree(roundTrip.text)
			: { ok: false, root: null, reason: roundTrip.reason ?? "a arvore nao serializou" }
	const restoredAuto = restored.ok ? authoredAutoParameters(restored.root) : []
	const autoPreserved = canonicalJson(authoredAuto) === canonicalJson(restoredAuto)
	const reasons = []
	if (!roundTrip.identical) reasons.push(roundTrip.reason ?? "o texto da volta divergiu do texto de ida")
	if (!restored.ok) reasons.push(restored.reason ?? "o texto nao voltou a ser arvore")
	if (!autoPreserved) reasons.push("AUTO nao sobreviveu a ida-e-volta do texto")
	return {
		ok: roundTrip.identical && restored.ok && autoPreserved,
		identical: roundTrip.identical,
		byteLength: roundTrip.byteLength,
		fingerprint: roundTrip.fingerprint,
		text: roundTrip.text,
		autoParameterCount: authoredAuto.length,
		autoPreserved,
		reason: reasons.length === 0 ? null : reasons.join(" | "),
	}
}


export function proveLegacyMaterialRoundTrip(request = {}) {
	const materialName = request.materialName
	const topology = convertLegacyMaterialToTopology(request)
	const tree = legacyTopologyToMaterialTree(topology)
	const treeRoundTrip = proveTreeRoundTrip(tree)
	const restored =
		typeof treeRoundTrip.text === "string"
			? deserializeMaterialTree(treeRoundTrip.text)
			: { ok: false, root: null, reason: treeRoundTrip.reason }
	const restoredTopology = restored.ok ? materialTreeToLegacyTopology(restored.root) : null
	const topologyIdentical = restored.ok && canonicalJson(topology) === canonicalJson(restoredTopology)
	const validation = validateAuthoringGraph(tree)
	const extraKeys = findLegacyTopologyExtraKeys(topology)
	const reasons = []
	if (!topologyIdentical) reasons.push("a topologia da volta divergiu da topologia de ida")
	if (treeRoundTrip.reason !== null) reasons.push(treeRoundTrip.reason)
	if (!validation.ok) reasons.push(validation.refusals.map(describeRefusal).join(" | "))
	if (extraKeys.length > 0) reasons.push("chave descartada na traducao: " + extraKeys.join(", "))
	return {
		materialName,
		ok: topologyIdentical && treeRoundTrip.ok && validation.ok && extraKeys.length === 0,
		topologyIdentical,
		textIdentical: treeRoundTrip.identical,
		layered: isLegacyOperatorNode(topology),
		nodeCount: countTreeNodes(tree),
		byteLength: treeRoundTrip.byteLength,
		fingerprint: treeRoundTrip.fingerprint,
		autoParameterCount: treeRoundTrip.autoParameterCount,
		refusalCount: validation.refusals.length,
		extraKeys,
		reason: reasons.length === 0 ? null : reasons.join(" | "),
	}
}


export function findLegacyInteropProblems(request = {}) {
	const problems = []
	const materialNames = legacyMaterialNames()
	if (materialNames.length === 0) problems.push("a tabela de materiais legados voltou vazia")
	for (const materialName of materialNames) {
		const proof = proveLegacyMaterialRoundTrip({ ...request, materialName })
		if (!proof.ok) problems.push(materialName + ": " + (proof.reason ?? "ida-e-volta reprovada sem motivo declarado"))
	}
	return problems
}


export function describeLegacyInterop(request = {}) {
	const proofs = legacyMaterialNames().map((materialName) => proveLegacyMaterialRoundTrip({ ...request, materialName }))
	const widest = proofs.reduce(
		(worst, proof) => (proof.byteLength > worst.byteLength ? proof : worst),
		proofs[0] ?? { materialName: null, byteLength: 0 },
	)
	return {
		materialCount: proofs.length,
		layeredCount: proofs.filter((proof) => proof.layered).length,
		losslessCount: proofs.filter((proof) => proof.ok).length,
		widestMaterialName: widest.materialName,
		widestByteLength: widest.byteLength,
		problems: findLegacyInteropProblems(request),
	}
}
