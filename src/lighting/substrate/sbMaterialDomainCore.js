import { SB_MATERIAL_DOMAINS, bsdfClosureCost } from "./sbBsdfCatalog.js"
import { closureLayoutBytes } from "./sbClosureLayouts.js"
import {
	SB_CLOSURE_BYTES_CEILING,
	SB_MAX_CLOSURES_PER_PIXEL,
	tierDefaults,
} from "./sbMaterialContract.js"
import { operatorNames } from "./sbOperatorCatalog.js"
import { SB_REFUSAL_CODES } from "./sbOperatorRefusals.js"
import { SB_STRUCTURAL_PARAMETER_RANGES } from "./sbTreeParameterRanges.js"
import {
	SB_ROOT_PATH,
	SB_SHADING_CLASSES,
	bsdfShadingClass,
	collectMaterialTreeNodes,
	createBsdfNode,
	createOperatorNode,
	createReferenceLayeredTree,
	isBsdfNode,
	isOperatorNode,
} from "./sbMaterialTreeCore.js"
import { validateMaterialTree } from "./sbMaterialTreeValidation.js"
import {
	SB_VOLUME_BSDF_KIND,
	SB_VOLUME_DEFAULT_PARAMETERS,
	SB_VOLUME_PARAMETER_RANGES,
} from "./sbVolumeBsdfCore.js"
import {
	SB_LIGHT_FUNCTION_DEFAULTS,
	SB_POST_PROCESS_DEFAULTS,
	SB_UNLIT_BSDF_KIND,
	SB_UNLIT_DEFAULT_PARAMETERS,
} from "./sbUnlitDomainCore.js"

export const SB_MATERIAL_DOMAIN_OWNER = "SB-F27"

export const SB_VOLUME_DOMAIN = "volume"
export const SB_UNLIT_DOMAIN = "unlit"
export const SB_LIGHT_FUNCTION_DOMAIN = "lightFunction"
export const SB_POST_PROCESS_DOMAIN = "postProcess"

const SURFACE_CATALOG_DOMAIN = "surface"

const UNLIT_FAMILY_BSDF_KINDS = Object.freeze([SB_UNLIT_BSDF_KIND])

export const SB_DOMAIN_RULES = Object.freeze({
	[SB_VOLUME_DOMAIN]: Object.freeze({
		label: "Volume",
		catalogDomain: SB_VOLUME_DOMAIN,
		shadingClass: SB_SHADING_CLASSES.volume,
		bsdfKinds: Object.freeze([SB_VOLUME_BSDF_KIND]),
		operators: Object.freeze(["add", "weight"]),
		evaluatesLighting: true,
		maximumClosures: 1,
		closureLayoutKind: SB_VOLUME_BSDF_KIND,
		description: "nevoa e nuvem; recebe luz e nao aceita camadas",
	}),
	[SB_UNLIT_DOMAIN]: Object.freeze({
		label: "Unlit",
		catalogDomain: SURFACE_CATALOG_DOMAIN,
		shadingClass: SB_SHADING_CLASSES.unlit,
		bsdfKinds: UNLIT_FAMILY_BSDF_KINDS,
		operators: Object.freeze(["add", "weight", "horizontalMixing"]),
		evaluatesLighting: false,
		maximumClosures: 1,
		closureLayoutKind: SB_UNLIT_BSDF_KIND,
		description: "cor autorada que substitui a iluminacao inteira",
	}),
	[SB_LIGHT_FUNCTION_DOMAIN]: Object.freeze({
		label: "Light function",
		catalogDomain: SB_LIGHT_FUNCTION_DOMAIN,
		shadingClass: SB_SHADING_CLASSES.unlit,
		bsdfKinds: UNLIT_FAMILY_BSDF_KINDS,
		operators: Object.freeze(["weight"]),
		evaluatesLighting: false,
		maximumClosures: 1,
		closureLayoutKind: SB_UNLIT_BSDF_KIND,
		description: "mascara projetada por uma luz; nao recebe luz, ela modula luz",
	}),
	[SB_POST_PROCESS_DOMAIN]: Object.freeze({
		label: "Post process",
		catalogDomain: SB_POST_PROCESS_DOMAIN,
		shadingClass: SB_SHADING_CLASSES.unlit,
		bsdfKinds: UNLIT_FAMILY_BSDF_KINDS,
		operators: Object.freeze(["weight", "horizontalMixing"]),
		evaluatesLighting: false,
		maximumClosures: 1,
		closureLayoutKind: SB_UNLIT_BSDF_KIND,
		description: "grade de cor aplicada na imagem final",
	}),
})

export function materialDomainNames() {
	return Object.keys(SB_DOMAIN_RULES)
}

export function materialDomainRule(domainName) {
	return SB_DOMAIN_RULES[domainName] ?? null
}


export function materialDomainOwner(domainName) {
	const catalogEntry = SB_MATERIAL_DOMAINS[domainName]
	if (catalogEntry && catalogEntry.owner) return catalogEntry.owner
	if (materialDomainRule(domainName)) return SB_MATERIAL_DOMAIN_OWNER
	return null
}





export function materialDomainParameterRanges(domainName) {
	if (domainName === SB_VOLUME_DOMAIN) {
		return { ...SB_STRUCTURAL_PARAMETER_RANGES, ...SB_VOLUME_PARAMETER_RANGES }
	}
	return { ...SB_STRUCTURAL_PARAMETER_RANGES }
}

export function materialDomainClosureBytes(domainName) {
	const rule = materialDomainRule(domainName)
	if (!rule) return 0
	return closureLayoutBytes(rule.closureLayoutKind) ?? 0
}

export function maximumDomainClosureBytes() {
	return materialDomainNames().reduce((maximumBytes, domainName) => {
		const bytes = materialDomainClosureBytes(domainName)
		return bytes > maximumBytes ? bytes : maximumBytes
	}, 0)
}

function domainClosureBudget(rule, tierName) {
	const tierBudget = tierDefaults(tierName)?.closuresPerPixel ?? SB_MAX_CLOSURES_PER_PIXEL
	return rule.maximumClosures > tierBudget ? tierBudget : rule.maximumClosures
}

function domainRefusal({ code, domain, path, bsdf, operator, reason, detail }) {
	return {
		code,
		domain: domain ?? null,
		path: path ?? SB_ROOT_PATH,
		bsdf: bsdf ?? null,
		operator: operator ?? null,
		reason,
		detail: detail ?? null,
	}
}

function withDomain(domainName, refusal) {
	return domainRefusal({
		code: refusal.code,
		domain: domainName,
		path: refusal.path,
		bsdf: refusal.bsdf,
		operator: refusal.operator,
		reason: refusal.reason,
		detail: refusal.detail,
	})
}

function foreignDomainReason(domainName) {
	const owner = materialDomainOwner(domainName)
	const supported = materialDomainNames().join(", ")
	if (owner && owner !== SB_MATERIAL_DOMAIN_OWNER) {
		return 'o dominio "' + String(domainName) + '" pertence a ' + owner + ", nao a " + SB_MATERIAL_DOMAIN_OWNER + "; aqui compilam apenas " + supported
	}
	return 'dominio desconhecido "' + String(domainName) + '"; ' + SB_MATERIAL_DOMAIN_OWNER + " compila apenas " + supported
}

function describeFailure(failure) {
	if (!failure) return "erro desconhecido"
	if (typeof failure === "string") return failure
	return failure.message ?? String(failure)
}

function ensureRefusal(refusals, domainName) {
	if (refusals.length > 0) return refusals
	return [
		domainRefusal({
			code: SB_REFUSAL_CODES.missingOperand,
			domain: domainName,
			reason: 'o dominio "' + String(domainName) + '" nao recebeu arvore alguma para compilar',
		}),
	]
}


export function validateMaterialDomain(domainName, rawRootNode, options = {}) {
	try {
		const rule = materialDomainRule(domainName)
		if (!rule) {
			return {
				ok: false,
				domain: domainName ?? null,
				refusals: [
					domainRefusal({
						code: SB_REFUSAL_CODES.domainMismatch,
						domain: domainName ?? null,
						reason: foreignDomainReason(domainName),
						detail: { requestedDomain: domainName ?? null, owner: materialDomainOwner(domainName) },
					}),
				],
				summary: null,
			}
		}

		const structural = validateMaterialTree(rawRootNode, {
			parameterRanges: materialDomainParameterRanges(domainName),
			maximumDepth: options.maximumDepth,
			maximumSlabs: options.maximumSlabs,
		})
		const refusals = (structural.refusals ?? []).map((refusal) => withDomain(domainName, refusal))
		if (!structural.tree) {
			return { ok: false, domain: domainName, refusals: ensureRefusal(refusals, domainName), summary: null }
		}

		const collected = collectMaterialTreeNodes(structural.tree)
		const closureBudget = domainClosureBudget(rule, options.tierName)
		let closureCost = 0
		let closureBytes = 0

		for (const entry of collected.nodes) {
			const node = entry.node
			if (isBsdfNode(node)) {
				if (!rule.bsdfKinds.includes(node.bsdf)) {
					refusals.push(
						domainRefusal({
							code: SB_REFUSAL_CODES.domainMismatch,
							domain: domainName,
							path: entry.path,
							bsdf: node.bsdf,
							reason: 'o BSDF "' + String(node.bsdf) + '" nao pertence ao dominio "' + domainName + '"; aceitos: ' + rule.bsdfKinds.join(", "),
						}),
					)
					continue
				}
				closureCost += bsdfClosureCost(node.bsdf) ?? 0
				const nodeBytes = closureLayoutBytes(node.bsdf) ?? 0
				if (nodeBytes > closureBytes) closureBytes = nodeBytes
				continue
			}
			if (isOperatorNode(node) && !rule.operators.includes(node.operator)) {
				refusals.push(
					domainRefusal({
						code: SB_REFUSAL_CODES.unsupportedChild,
						domain: domainName,
						path: entry.path,
						operator: node.operator,
						reason: 'o operador "' + String(node.operator) + '" nao pertence ao dominio "' + domainName + '"; aceitos: ' + rule.operators.join(", "),
					}),
				)
			}
		}

		if (closureCost > closureBudget) {
			refusals.push(
				domainRefusal({
					code: SB_REFUSAL_CODES.budgetExceeded,
					domain: domainName,
					reason: 'o dominio "' + domainName + '" pediu ' + closureCost + ' closure(s) por pixel e o orcamento e ' + closureBudget,
					detail: { closureCost, closureBudget, tierName: options.tierName ?? null },
				}),
			)
		}

		const shadingClass = structural.summary?.shadingClass ?? null
		if (shadingClass && shadingClass !== rule.shadingClass) {
			refusals.push(
				domainRefusal({
					code: SB_REFUSAL_CODES.domainMismatch,
					domain: domainName,
					reason: 'a arvore tem classe de sombreamento "' + shadingClass + '" e o dominio "' + domainName + '" exige "' + rule.shadingClass + '"',
					detail: { shadingClass, expectedShadingClass: rule.shadingClass },
				}),
			)
		}

		return {
			ok: refusals.length === 0,
			domain: domainName,
			refusals,
			summary: {
				domain: domainName,
				catalogDomain: rule.catalogDomain,
				shadingClass,
				nodeCount: collected.nodes.length,
				closureCost,
				closureBudget,
				closureBytes,
				evaluatesLighting: rule.evaluatesLighting,
				refusalCount: refusals.length,
			},
		}
	} catch (failure) {
		return {
			ok: false,
			domain: domainName ?? null,
			refusals: [
				domainRefusal({
					code: SB_REFUSAL_CODES.domainMismatch,
					domain: domainName ?? null,
					reason: "a arvore do dominio nao pode ser lida: " + describeFailure(failure),
				}),
			],
			summary: null,
		}
	}
}

export function isMaterialDomainAccepted(domainName, rawRootNode, options = {}) {
	return validateMaterialDomain(domainName, rawRootNode, options).ok === true
}

function createUnlitLeaf(emissiveColor, label) {
	return createBsdfNode({
		bsdf: SB_UNLIT_BSDF_KIND,
		parameters: {
			emissive: [...emissiveColor],
			opacity: SB_UNLIT_DEFAULT_PARAMETERS.opacity,
		},
		label,
	})
}


export function createReferenceDomainTree(domainName) {
	if (domainName === SB_VOLUME_DOMAIN) {
		return createBsdfNode({
			bsdf: SB_VOLUME_BSDF_KIND,
			parameters: { ...SB_VOLUME_DEFAULT_PARAMETERS },
			label: "groundFog",
		})
	}
	if (domainName === SB_UNLIT_DOMAIN) {
		return createUnlitLeaf(SB_UNLIT_DEFAULT_PARAMETERS.emissive, "hologramPanel")
	}
	if (domainName === SB_LIGHT_FUNCTION_DOMAIN) {
		return createOperatorNode({
			operator: "weight",
			parameters: { weight: 0.8 },
			children: [createUnlitLeaf(SB_LIGHT_FUNCTION_DEFAULTS.maskColor, "projectedMask")],
			label: "lightFunctionMask",
		})
	}
	if (domainName === SB_POST_PROCESS_DOMAIN) {
		return createOperatorNode({
			operator: "horizontalMixing",
			parameters: { weight: 0.5 },
			children: [
				createUnlitLeaf(SB_POST_PROCESS_DEFAULTS.tint, "gradeWarm"),
				createUnlitLeaf([0.95, 1, 1.06], "gradeCool"),
			],
			label: "postProcessGrade",
		})
	}
	return null
}


export function createRefusedDomainTree(domainName) {
	if (domainName === SB_VOLUME_DOMAIN) {
		return createBsdfNode({
			bsdf: "slab",
			parameters: { albedo: [0.6, 0.6, 0.6], roughness: 0.4 },
			label: "slabPedidoNoVolume",
		})
	}
	if (domainName === SB_UNLIT_DOMAIN) {
		return createBsdfNode({
			bsdf: SB_VOLUME_BSDF_KIND,
			parameters: { ...SB_VOLUME_DEFAULT_PARAMETERS },
			label: "volumePedidoNoUnlit",
		})
	}
	if (domainName === SB_LIGHT_FUNCTION_DOMAIN) {
		return createOperatorNode({
			operator: "add",
			parameters: {},
			children: [
				createUnlitLeaf(SB_LIGHT_FUNCTION_DEFAULTS.maskColor, "maskA"),
				createUnlitLeaf(SB_LIGHT_FUNCTION_DEFAULTS.maskColor, "maskB"),
			],
			label: "addPedidoNaLightFunction",
		})
	}
	if (domainName === SB_POST_PROCESS_DOMAIN) {
		return createReferenceLayeredTree()
	}
	return null
}


export function findDomainBsdfParameters(rawRootNode, bsdfKind) {
	try {
		const structural = validateMaterialTree(rawRootNode, {})
		if (!structural.tree) return null
		const collected = collectMaterialTreeNodes(structural.tree)
		for (const entry of collected.nodes) {
			if (isBsdfNode(entry.node) && entry.node.bsdf === bsdfKind) {
				return entry.node.parameters ?? null
			}
		}
		return null
	} catch (failure) {
		return null
	}
}

const FOREIGN_DOMAIN_CASES = Object.freeze([SURFACE_CATALOG_DOMAIN, "decal", "madeUpDomain", null])

const BROKEN_TREE_CASES = Object.freeze([
	null,
	{},
	"volume",
	{ type: "operator", operator: "verticalLayering", children: [] },
])

function firstReason(refusals) {
	return refusals?.[0]?.reason ?? "sem motivo registrado"
}

function refusalQualityProblems(caseName, refusals) {
	const problems = []
	const knownCodes = Object.values(SB_REFUSAL_CODES)
	if (refusals.length > 0 === false) {
		problems.push("o caso " + caseName + " foi recusado sem registrar motivo nenhum")
		return problems
	}
	for (const refusal of refusals) {
		if (!knownCodes.includes(refusal.code)) {
			problems.push("o caso " + caseName + ' usou o codigo de recusa desconhecido "' + String(refusal.code) + '"')
		}
		const hasReason = typeof refusal.reason === "string" && refusal.reason.trim().length > 0
		if (!hasReason) {
			problems.push("o caso " + caseName + " recusou sem motivo legivel")
		}
	}
	return problems
}


export function runDomainRefusalBattery(options = {}) {
	const tierName = options.tierName ?? "forte"
	const cases = []
	const problems = []

	function record(caseName, expectation, result) {
		const accepted = result.ok === true
		const matches = expectation === "accepted" ? accepted : accepted === false
		cases.push({ name: caseName, expectation, accepted, matches, refusals: result.refusals ?? [] })
		if (!matches) {
			problems.push(
				expectation === "accepted"
					? "o caso " + caseName + " deveria ser aceito e foi recusado: " + firstReason(result.refusals)
					: "o caso " + caseName + " deveria ser recusado e foi aceito",
			)
			return
		}
		if (expectation === "refused") {
			problems.push(...refusalQualityProblems(caseName, result.refusals ?? []))
		}
	}

	for (const domainName of materialDomainNames()) {
		record(
			"reference:" + domainName,
			"accepted",
			validateMaterialDomain(domainName, createReferenceDomainTree(domainName), { tierName }),
		)
		record(
			"wrongTree:" + domainName,
			"refused",
			validateMaterialDomain(domainName, createRefusedDomainTree(domainName), { tierName }),
		)
	}

	for (const foreignDomain of FOREIGN_DOMAIN_CASES) {
		record(
			"foreignDomain:" + String(foreignDomain),
			"refused",
			validateMaterialDomain(foreignDomain, createReferenceDomainTree(SB_UNLIT_DOMAIN), { tierName }),
		)
	}

	BROKEN_TREE_CASES.forEach((brokenTree, caseIndex) => {
		record(
			"brokenTree:" + caseIndex,
			"refused",
			validateMaterialDomain(SB_VOLUME_DOMAIN, brokenTree, { tierName }),
		)
	})

	const acceptedCount = cases.filter((entry) => entry.accepted).length
	return {
		ok: problems.length === 0,
		tierName,
		total: cases.length,
		acceptedCount,
		refusedCount: cases.length - acceptedCount,
		problems,
		cases,
	}
}


export function materialDomainProblems() {
	const problems = []
	const knownOperators = operatorNames()
	const knownShadingClasses = Object.values(SB_SHADING_CLASSES)

	for (const domainName of materialDomainNames()) {
		const rule = SB_DOMAIN_RULES[domainName]
		const label = 'a regra do dominio "' + domainName + '"'

		if (!SB_MATERIAL_DOMAINS[rule.catalogDomain]) {
			problems.push(label + ' aponta para o dominio de catalogo "' + rule.catalogDomain + '", que nao existe em SB_MATERIAL_DOMAINS')
		}
		if (!knownShadingClasses.includes(rule.shadingClass)) {
			problems.push(label + ' usa a classe de sombreamento "' + String(rule.shadingClass) + '", fora de SB_SHADING_CLASSES')
		}
		if (rule.bsdfKinds.length > 0 === false) {
			problems.push(label + " nao aceita BSDF nenhum, logo nao renderizaria nada")
		}
		for (const bsdfKind of rule.bsdfKinds) {
			if (bsdfClosureCost(bsdfKind) === null) {
				problems.push(label + ' aceita o BSDF "' + bsdfKind + '", que nao esta no catalogo')
			}
			const kindShadingClass = bsdfShadingClass(bsdfKind)
			if (kindShadingClass && kindShadingClass !== rule.shadingClass) {
				problems.push(label + ' aceita o BSDF "' + bsdfKind + '" de classe "' + kindShadingClass + '", incompativel com "' + rule.shadingClass + '"')
			}
		}
		for (const operatorName of rule.operators) {
			if (!knownOperators.includes(operatorName)) {
				problems.push(label + ' aceita o operador "' + operatorName + '", que nao esta no catalogo de operadores')
			}
		}
		const bytes = materialDomainClosureBytes(domainName)
		if (1 > bytes) {
			problems.push(label + ' nao tem layout de closure para "' + String(rule.closureLayoutKind) + '"')
		}
		if (bytes > SB_CLOSURE_BYTES_CEILING) {
			problems.push(label + " gasta " + bytes + " bytes por closure e o teto do contrato e " + SB_CLOSURE_BYTES_CEILING)
		}
		if (1 > rule.maximumClosures || rule.maximumClosures > SB_MAX_CLOSURES_PER_PIXEL) {
			problems.push(label + " pede " + rule.maximumClosures + " closure(s) por pixel, fora da faixa 1.." + SB_MAX_CLOSURES_PER_PIXEL)
		}
	}

	for (const [catalogDomain, catalogEntry] of Object.entries(SB_MATERIAL_DOMAINS)) {
		if (catalogEntry.owner !== SB_MATERIAL_DOMAIN_OWNER) continue
		const isCovered = materialDomainNames().some(
			(domainName) => SB_DOMAIN_RULES[domainName].catalogDomain === catalogDomain,
		)
		if (!isCovered) {
			problems.push('o dominio de catalogo "' + catalogDomain + '" pertence a ' + SB_MATERIAL_DOMAIN_OWNER + " e nao tem regra nesta fase")
		}
	}

	return problems
}

export function describeMaterialDomains() {
	return {
		owner: SB_MATERIAL_DOMAIN_OWNER,
		domains: materialDomainNames().map((domainName) => {
			const rule = SB_DOMAIN_RULES[domainName]
			return {
				domain: domainName,
				label: rule.label,
				catalogDomain: rule.catalogDomain,
				catalogOwner: materialDomainOwner(domainName),
				shadingClass: rule.shadingClass,
				bsdfKinds: [...rule.bsdfKinds],
				operators: [...rule.operators],
				evaluatesLighting: rule.evaluatesLighting,
				maximumClosures: rule.maximumClosures,
				closureBytes: materialDomainClosureBytes(domainName),
				description: rule.description,
			}
		}),
		maximumClosureBytes: maximumDomainClosureBytes(),
		closureBytesCeiling: SB_CLOSURE_BYTES_CEILING,
		problems: materialDomainProblems(),
	}
}
