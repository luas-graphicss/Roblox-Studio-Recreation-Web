import { SB_MAX_TREE_DEPTH, SB_MAX_SLABS_PER_TREE } from "./authoring/sbAuthoringLimits.js"
import { SB_REFUSAL_CODES } from "./sbOperatorRefusals.js"
import { operatorArity } from "./sbOperatorCatalog.js"
import { supportsLayering } from "./sbBsdfCatalog.js"
import { SB_STRUCTURAL_PARAMETER_RANGES } from "./sbTreeParameterRanges.js"
import {
	SB_ROOT_PATH,
	SB_SLAB_BSDF_KIND,
	SB_LAYER_CHILD_INDEX,
	SB_TREE_ANOMALIES,
	isBsdfNode,
	isOperatorNode,
	isKnownBsdfKind,
	isKnownOperator,
	bsdfParameterNames,
	operatorParameterNames,
	normalizeMaterialTree,
	collectMaterialTreeNodes,
	materialTreeDepth,
	materialTreeShadingClass,
} from "./sbMaterialTreeCore.js"


const VERTICAL_LAYERING_OPERATOR = "verticalLayering"


const ANOMALY_TO_REFUSAL = Object.freeze({
	[SB_TREE_ANOMALIES.missingRoot]: {
		code: SB_REFUSAL_CODES.missingOperand,
		reason: "a arvore nao tem raiz aproveitavel",
	},
	[SB_TREE_ANOMALIES.unknownNodeType]: {
		code: SB_REFUSAL_CODES.unsupportedChild,
		reason: "no de tipo desconhecido foi descartado da arvore",
	},
	[SB_TREE_ANOMALIES.cycle]: {
		code: SB_REFUSAL_CODES.cycleDetected,
		reason: "a arvore aponta para um no que ja esta acima dela",
	},
	[SB_TREE_ANOMALIES.depthLimit]: {
		code: SB_REFUSAL_CODES.treeTooDeep,
		reason: "a arvore passou do limite de caminhada em profundidade",
	},
})


function anomalyKind(anomaly) {
	if (typeof anomaly === "string") return anomaly
	return anomaly?.anomaly ?? anomaly?.kind ?? null
}

function anomalyPath(anomaly) {
	return (typeof anomaly === "string" ? null : anomaly?.path) ?? SB_ROOT_PATH
}

function createRefusal({ code, path, node, reason, detail }) {
	return {
		code,
		path: path ?? node?.path ?? SB_ROOT_PATH,
		bsdf: node && isBsdfNode(node) ? node.bsdf : null,
		operator: node && isOperatorNode(node) ? node.operator : null,
		reason,
		detail: detail ?? null,
	}
}

function describeRange(range) {
	return `${range.minimum}..${range.maximum}`
}


function parameterProblem(value, range) {
	if (range.componentCount === 1) {
		if (typeof value !== "number" || !Number.isFinite(value)) return "sem um numero finito"
		if (range.minimum > value || value > range.maximum) return `fora da faixa ${describeRange(range)}`
		return null
	}
	if (!Array.isArray(value) || value.length !== range.componentCount) {
		return `sem os ${range.componentCount} componentes numericos esperados`
	}
	for (const component of value) {
		if (typeof component !== "number" || !Number.isFinite(component)) return "com componente nao numerico"
		if (range.minimum > component || component > range.maximum) {
			return `com componente fora da faixa ${describeRange(range)}`
		}
	}
	return null
}

function collectParameterRefusals(node, allowedNames, parameterRanges) {
	const refusals = []
	const parameters = node.parameters ?? {}
	for (const parameterName of Object.keys(parameters)) {
		if (!allowedNames.includes(parameterName)) {
			refusals.push(
				createRefusal({
					code: SB_REFUSAL_CODES.parameterOutOfRange,
					node,
					reason: `o parametro "${parameterName}" nao existe no contrato deste no`,
					detail: `aceitos: ${allowedNames.join(", ")}`,
				}),
			)
			continue
		}
		const range = parameterRanges[parameterName]
		if (!range) continue
		const problem = parameterProblem(parameters[parameterName], range)
		if (problem) {
			refusals.push(
				createRefusal({
					code: SB_REFUSAL_CODES.parameterOutOfRange,
					node,
					reason: `o parametro "${parameterName}" esta ${problem}`,
					detail: JSON.stringify(parameters[parameterName] ?? null),
				}),
			)
		}
	}
	return refusals
}

function collectBsdfRefusals(node, parameterRanges) {
	if (!isKnownBsdfKind(node.bsdf)) {
		return [
			createRefusal({
				code: SB_REFUSAL_CODES.unsupportedChild,
				node,
				reason: `o BSDF "${node.bsdf}" nao esta no catalogo`,
			}),
		]
	}
	return collectParameterRefusals(node, bsdfParameterNames(node.bsdf), parameterRanges)
}

function collectArityRefusals(node) {
	const expectedArity = operatorArity(node.operator)
	const childCount = node.children?.length ?? 0
	if (expectedArity > childCount) {
		return [
			createRefusal({
				code: SB_REFUSAL_CODES.missingOperand,
				node,
				reason: `o operador "${node.operator}" precisa de ${expectedArity} operando(s) e recebeu ${childCount}`,
			}),
		]
	}
	if (childCount > expectedArity) {
		return [
			createRefusal({
				code: SB_REFUSAL_CODES.unsupportedChild,
				node,
				reason: `o operador "${node.operator}" aceita ${expectedArity} operando(s) e recebeu ${childCount}`,
			}),
		]
	}
	return []
}


function collectLayeringRefusals(node) {
	if (node.operator !== VERTICAL_LAYERING_OPERATOR) return []
	const refusals = []
	const children = node.children ?? []
	const topNode = children[SB_LAYER_CHILD_INDEX.top]
	const bottomNode = children[SB_LAYER_CHILD_INDEX.bottom]
	if (topNode && (!isBsdfNode(topNode) || topNode.bsdf !== SB_SLAB_BSDF_KIND)) {
		refusals.push(
			createRefusal({
				code: SB_REFUSAL_CODES.unsupportedChild,
				node: topNode,
				reason: "a camada de cima do empilhamento vertical precisa ser um slab",
				detail: `operador: ${node.operator}`,
			}),
		)
	}
	if (bottomNode && isBsdfNode(bottomNode) && supportsLayering(bottomNode.bsdf) === false) {
		refusals.push(
			createRefusal({
				code: SB_REFUSAL_CODES.unsupportedChild,
				node: bottomNode,
				reason: `o BSDF "${bottomNode.bsdf}" nao aceita ficar embaixo de uma camada`,
				detail: `operador: ${node.operator}`,
			}),
		)
	}
	return refusals
}

function collectOperatorRefusals(node, parameterRanges) {
	if (!isKnownOperator(node.operator)) {
		return [
			createRefusal({
				code: SB_REFUSAL_CODES.unsupportedChild,
				node,
				reason: `o operador "${node.operator}" nao esta no catalogo`,
			}),
		]
	}
	return [
		...collectArityRefusals(node),
		...collectLayeringRefusals(node),
		...collectParameterRefusals(node, operatorParameterNames(node.operator), parameterRanges),
	]
}

function collectAnomalyRefusals(anomalies) {
	const refusals = []
	for (const anomaly of anomalies ?? []) {
		const mapped = ANOMALY_TO_REFUSAL[anomalyKind(anomaly)]
		if (!mapped) continue
		refusals.push(
			createRefusal({
				code: mapped.code,
				path: anomalyPath(anomaly),
				reason: mapped.reason,
				detail: anomalyKind(anomaly),
			}),
		)
	}
	return refusals
}


export function validateMaterialTree(rawRootNode, options = {}) {
	const parameterRanges = options.parameterRanges ?? SB_STRUCTURAL_PARAMETER_RANGES
	const maximumDepth = options.maximumDepth ?? SB_MAX_TREE_DEPTH
	const maximumSlabs = options.maximumSlabs ?? SB_MAX_SLABS_PER_TREE
	try {
		const normalization = normalizeMaterialTree(rawRootNode)
		const refusals = collectAnomalyRefusals(normalization.anomalies)
		if (!normalization.root) {
			if (refusals.length === 0) {
				refusals.push(
					createRefusal({
						code: SB_REFUSAL_CODES.missingOperand,
						reason: "a arvore nao tem raiz aproveitavel",
					}),
				)
			}
			return { ok: false, refusals, tree: null, summary: null }
		}
		const collected = collectMaterialTreeNodes(normalization.root)
		let slabCount = 0
		for (const visit of collected.nodes) {
			const node = visit.node
			if (isBsdfNode(node)) {
				if (node.bsdf === SB_SLAB_BSDF_KIND) slabCount += 1
				refusals.push(...collectBsdfRefusals(node, parameterRanges))
				continue
			}
			if (isOperatorNode(node)) refusals.push(...collectOperatorRefusals(node, parameterRanges))
		}
		const depth = materialTreeDepth(normalization.root)
		if (depth > maximumDepth) {
			refusals.push(
				createRefusal({
					code: SB_REFUSAL_CODES.treeTooDeep,
					reason: `a arvore tem ${depth} niveis e o teto do contrato e ${maximumDepth}`,
				}),
			)
		}
		if (slabCount > maximumSlabs) {
			refusals.push(
				createRefusal({
					code: SB_REFUSAL_CODES.tooManySlabs,
					reason: `a arvore tem ${slabCount} slabs e o teto do contrato e ${maximumSlabs}`,
				}),
			)
		}
		const shading = materialTreeShadingClass(normalization.root)
		for (const mismatch of shading.mismatches ?? []) {
			refusals.push(
				createRefusal({
					code: SB_REFUSAL_CODES.domainMismatch,
					path: mismatch.path,
					reason: `o operador "${mismatch.operator}" recebeu operandos de classes de sombreamento diferentes`,
					detail: (mismatch.classes ?? []).join(" + "),
				}),
			)
		}
		return {
			ok: refusals.length === 0,
			refusals,
			tree: normalization.root,
			summary: {
				depth,
				nodeCount: collected.nodes.length,
				slabCount,
				shadingClass: shading.shadingClass,
				refusalCount: refusals.length,
			},
		}
	} catch (error) {
		return {
			ok: false,
			refusals: [
				createRefusal({
					code: SB_REFUSAL_CODES.unsupportedChild,
					reason: "a validacao nao conseguiu inspecionar esta arvore",
					detail: error?.message ?? String(error),
				}),
			],
			tree: null,
			summary: null,
		}
	}
}


export function isMaterialTreeAccepted(rawRootNode, options = {}) {
	return validateMaterialTree(rawRootNode, options).ok === true
}
