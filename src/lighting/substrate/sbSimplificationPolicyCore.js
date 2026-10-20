import {
	SB_BYTES_PER_PIXEL_CEILING,
	SB_CLOSURE_BYTES_CEILING,
	SB_MAX_CLOSURES_PER_PIXEL,
	SB_MAX_SLABS_PER_TREE,
	SB_MAX_TREE_DEPTH,
	SB_TIER_NAMES,
	slabClosureBytes,
	tierBytesPerPixel,
	tierDefaults,
} from "./sbMaterialContract.js"
import {
	SB_BLEND_WEIGHT_FLOOR,
	applyClosureTint,
	blendClosures,
	multiplyTints,
	operatorChildTints,
	operatorChildVisibility,
	scaleClosureEnergy,
	slabReflectedEnergy,
} from "./sbParameterBlendingCore.js"
import { sanitizeSlabParameters } from "./sbSlabParametersCore.js"


export const SB_SIMPLIFICATION_POLICIES = Object.freeze({
	conservative: Object.freeze({
		name: "conservative",
		collapseToSingleClosure: false,
		negligibleContributionRatio: 0,
		description: "colapsa somente o que o teto do tier exige",
	}),
	balanced: Object.freeze({
		name: "balanced",
		collapseToSingleClosure: false,
		negligibleContributionRatio: 0.02,
		description: "colapsa o teto e as irmas que somem na imagem",
	}),
	aggressive: Object.freeze({
		name: "aggressive",
		collapseToSingleClosure: true,
		negligibleContributionRatio: 0.15,
		description: "colapsa a arvore inteira em uma closure",
	}),
})


export const SB_COLLAPSE_REASONS = Object.freeze({
	closureCeiling: "closureCeiling",
	depthCeiling: "depthCeiling",
	negligibleSibling: "negligibleSibling",
})

const ROOT_PATH = "root"
const CHILD_KEYS = Object.freeze(["top", "bottom"])
const NEUTRAL_TINT = Object.freeze([1, 1, 1])
const DEFAULT_TIER = SB_TIER_NAMES[SB_TIER_NAMES.length - 1]


const MAX_COLLAPSE_STEPS = SB_MAX_SLABS_PER_TREE * 2


const FALLBACK_TIER_DEFAULTS = Object.freeze({
	closuresPerPixel: SB_MAX_CLOSURES_PER_PIXEL,
	closureBytes: SB_CLOSURE_BYTES_CEILING,
	simplification: SB_SIMPLIFICATION_POLICIES.conservative.name,
	substrateEnabled: false,
})


function isOperatorNode(node) {
	return node !== null && typeof node === "object" && typeof node.operator === "string"
}

function usesChildrenArray(node) {
	return Array.isArray(node.children)
}

function childrenOf(node) {
	const children = usesChildrenArray(node) ? node.children : CHILD_KEYS.map((key) => node[key])
	return children.filter((child) => child !== null && child !== undefined)
}

function childKeyOf(node, index) {
	if (usesChildrenArray(node)) return String(index)
	return CHILD_KEYS[index] ?? String(index)
}

function childPathOf(node, path, index) {
	return path + "." + childKeyOf(node, index)
}

function withChildren(node, children) {
	if (usesChildrenArray(node)) return { ...node, children }
	const [top, bottom] = children
	return { ...node, top, bottom }
}


function slabParametersOf(node) {
	if (node === null || typeof node !== "object") return {}
	if (node.parameters === null || typeof node.parameters !== "object") return node
	return node.parameters
}


function foldUnaryOperators(node) {
	if (!isOperatorNode(node)) return sanitizeSlabParameters(slabParametersOf(node))
	const children = childrenOf(node).map(foldUnaryOperators)
	if (children.length === 0) return sanitizeSlabParameters({})
	if (children.length === 1) {
		if (isOperatorNode(children[0])) return withChildren(node, children)
		const [visibility] = operatorChildVisibility(node, 1)
		return scaleClosureEnergy(children[0], visibility)
	}
	return withChildren(node, children)
}

function collectClosures(node, path, visibility, tint, depth, closures) {
	if (!isOperatorNode(node)) {
		const parameters = applyClosureTint(sanitizeSlabParameters(slabParametersOf(node)), tint)
		closures.push({
			path,
			depth,
			visibility,
			parameters,
			contribution: visibility * slabReflectedEnergy(parameters),
		})
		return
	}
	const children = childrenOf(node)
	const childVisibility = operatorChildVisibility(node, children.length)
	const childTints = operatorChildTints(node, children.length)
	children.forEach((child, index) => {
		collectClosures(
			child,
			childPathOf(node, path, index),
			visibility * childVisibility[index],
			multiplyTints(tint, childTints[index]),
			depth + 1,
			closures,
		)
	})
}


export function describeClosureWeights(topology) {
	const closures = []
	collectClosures(topology, ROOT_PATH, 1, NEUTRAL_TINT, 1, closures)
	const totalContribution = closures.reduce((total, closure) => total + closure.contribution, 0)
	return closures.map((closure) => ({
		...closure,
		contributionShare: SB_BLEND_WEIGHT_FLOOR > totalContribution ? 0 : closure.contribution / totalContribution,
	}))
}


export function describeTopology(topology) {
	const closures = describeClosureWeights(topology)
	const depth = closures.reduce((deepest, closure) => Math.max(deepest, closure.depth), 0)
	return {
		closureCount: closures.length,
		depth,
		bytesPerPixel: closures.length * slabClosureBytes(),
		closures,
	}
}

function topologyShapeOf(report) {
	return { closureCount: report.closureCount, depth: report.depth, bytesPerPixel: report.bytesPerPixel }
}

export function simplificationPolicyFor(policyName) {
	return SB_SIMPLIFICATION_POLICIES[policyName] ?? null
}


export function simplificationBudgetFor(tierName) {
	const tierKnown = SB_TIER_NAMES.includes(tierName)
	const defaults = tierKnown ? tierDefaults(tierName) : FALLBACK_TIER_DEFAULTS
	const policy = simplificationPolicyFor(defaults.simplification) ?? SB_SIMPLIFICATION_POLICIES.conservative
	const tierBytes = tierKnown ? tierBytesPerPixel(tierName) : SB_BYTES_PER_PIXEL_CEILING
	return {
		tier: tierName,
		tierKnown,
		policy: policy.name,
		closureCeiling: Math.max(1, Math.min(defaults.closuresPerPixel, SB_MAX_CLOSURES_PER_PIXEL)),
		closureBytesCeiling: Math.min(defaults.closureBytes, SB_CLOSURE_BYTES_CEILING),
		bytesPerPixelCeiling: Math.min(tierBytes, SB_BYTES_PER_PIXEL_CEILING),
		depthCeiling: SB_MAX_TREE_DEPTH,
		closureBytes: slabClosureBytes(),
		substrateEnabled: Boolean(defaults.substrateEnabled),
	}
}

export function describeSimplificationBudgets() {
	return SB_TIER_NAMES.map((tierName) => simplificationBudgetFor(tierName))
}


function collectCollapsibleNodes(node, path, candidates) {
	if (!isOperatorNode(node)) return
	const children = childrenOf(node)
	children.forEach((child, index) => collectCollapsibleNodes(child, childPathOf(node, path, index), candidates))
	const isSiblingPair = children.length > 1 && children.every((child) => !isOperatorNode(child))
	if (isSiblingPair) candidates.push({ path, node })
}


function describeCandidates(topology) {
	const candidates = []
	collectCollapsibleNodes(topology, ROOT_PATH, candidates)
	const closures = describeClosureWeights(topology)
	return candidates
		.map((candidate) => {
			const childClosures = closures.filter((closure) => closure.path.startsWith(candidate.path + "."))
			const shares = childClosures.map((closure) => closure.contributionShare)
			return {
				...candidate,
				depth: childClosures.reduce((deepest, closure) => Math.max(deepest, closure.depth), 0),
				weakestShare: shares.length === 0 ? 0 : Math.min(...shares),
			}
		})
		.sort((left, right) => left.weakestShare - right.weakestShare || (left.path < right.path ? -1 : 1))
}

function collapseReasonFor(shape, budget, policy, targetClosureCount, candidates) {
	if (shape.closureCount > targetClosureCount) return SB_COLLAPSE_REASONS.closureCeiling
	if (shape.depth > budget.depthCeiling) return SB_COLLAPSE_REASONS.depthCeiling
	const hasNegligibleSibling = candidates.some(
		(candidate) => policy.negligibleContributionRatio > candidate.weakestShare,
	)
	return hasNegligibleSibling ? SB_COLLAPSE_REASONS.negligibleSibling : null
}

function chooseCandidate(candidates, reason) {
	if (candidates.length === 0) return null
	if (reason !== SB_COLLAPSE_REASONS.depthCeiling) return candidates[0]
	return candidates.reduce((deepest, candidate) => (candidate.depth > deepest.depth ? candidate : deepest), candidates[0])
}


function collapseCandidate(candidate) {
	const children = childrenOf(candidate.node)
	const childVisibility = operatorChildVisibility(candidate.node, children.length)
	const childTints = operatorChildTints(candidate.node, children.length)
	const blendInputs = children.map((child, index) => ({
		parameters: applyClosureTint(sanitizeSlabParameters(slabParametersOf(child)), childTints[index]),
		visibility: childVisibility[index],
	}))
	return blendClosures(blendInputs)
}

function replaceNodeAtPath(node, path, targetPath, replacement) {
	if (path === targetPath) return replacement
	if (!isOperatorNode(node)) return node
	const children = childrenOf(node).map((child, index) =>
		replaceNodeAtPath(child, childPathOf(node, path, index), targetPath, replacement),
	)
	return withChildren(node, children)
}

function findDeliveryRefusals(tierName, budget, simplified) {
	const refusals = []
	if (simplified.closureCount > budget.closureCeiling) {
		refusals.push(`tier ${tierName}: ${simplified.closureCount} closures acima do teto ${budget.closureCeiling}`)
	}
	if (simplified.depth > budget.depthCeiling) {
		refusals.push(`tier ${tierName}: profundidade ${simplified.depth} acima do teto ${budget.depthCeiling}`)
	}
	if (budget.closureBytes > budget.closureBytesCeiling) {
		refusals.push(
			`tier ${tierName}: a closure de slab ocupa ${budget.closureBytes} B e o tier reserva ${budget.closureBytesCeiling} B por closure`,
		)
	}
	if (simplified.bytesPerPixel > budget.bytesPerPixelCeiling) {
		refusals.push(
			`tier ${tierName}: ${simplified.bytesPerPixel} B por pixel acima do teto ${budget.bytesPerPixelCeiling} B`,
		)
	}
	if (!budget.substrateEnabled) {
		refusals.push(`tier ${tierName}: o contrato desliga o Substrate neste tier; a topologia nao vai para o shader`)
	}
	return refusals
}

function summarizeLoss(steps, original, simplified) {
	const deltas = steps.map((step) => step.loss.maxRelativeDelta)
	const energyDeltas = steps.map((step) => step.loss.energyRelativeDelta)
	const clamped = steps.reduce((names, step) => names.concat(step.loss.clampedParameters), [])
	const worst = steps.map((step) => step.loss.worstParameter).filter((name) => name !== null)
	return {
		blendCount: steps.length,
		closuresRemoved: original.closureCount - simplified.closureCount,
		maxRelativeDelta: deltas.length === 0 ? 0 : Math.max(...deltas),
		meanRelativeDelta: deltas.length === 0 ? 0 : deltas.reduce((total, delta) => total + delta, 0) / deltas.length,
		maxEnergyRelativeDelta: energyDeltas.length === 0 ? 0 : Math.max(...energyDeltas),
		clampedParameters: Array.from(new Set(clamped)).sort(),
		blendedParameters: Array.from(new Set(worst)).sort(),
		reasons: Array.from(new Set(steps.map((step) => step.reason))).sort(),
	}
}


export function simplifyTopology(request = {}) {
	const tierName = typeof request.tier === "string" ? request.tier : DEFAULT_TIER
	const budget = simplificationBudgetFor(tierName)
	const policy = simplificationPolicyFor(request.policy) ?? simplificationPolicyFor(budget.policy)
	const targetClosureCount = policy.collapseToSingleClosure ? 1 : budget.closureCeiling
	const original = describeTopology(request.topology)
	const steps = []
	let current = foldUnaryOperators(request.topology)
	while (MAX_COLLAPSE_STEPS > steps.length) {
		const candidates = describeCandidates(current)
		const reason = collapseReasonFor(describeTopology(current), budget, policy, targetClosureCount, candidates)
		if (reason === null) break
		const candidate = chooseCandidate(candidates, reason)
		if (candidate === null) break
		const blended = collapseCandidate(candidate)
		steps.push({ path: candidate.path, operator: candidate.node.operator, reason, loss: blended.loss })
		current = replaceNodeAtPath(current, ROOT_PATH, candidate.path, blended.parameters)
	}
	const simplified = describeTopology(current)
	const refusals = findDeliveryRefusals(tierName, budget, simplified)
	return {
		tier: tierName,
		policy: policy.name,
		budget,
		topology: current,
		closures: simplified.closures,
		original: topologyShapeOf(original),
		simplified: topologyShapeOf(simplified),
		steps,
		loss: summarizeLoss(steps, original, simplified),
		refusals,
		deliverable: refusals.length === 0,
	}
}


export function createSimplificationStressTopology() {
	const slabWith = (albedo, roughness) => sanitizeSlabParameters({ albedo, f0: [0.04, 0.04, 0.04], roughness })
	const layerOver = (top, bottom, transmittanceColor) => ({
		operator: "verticalLayering",
		coverage: 1,
		thickness: 0.02,
		transmittanceColor,
		top,
		bottom,
	})
	const mixOf = (top, bottom, weight) => ({ operator: "horizontalMixing", weight, top, bottom })
	return mixOf(
		layerOver(
			mixOf(slabWith([0.82, 0.8, 0.78], 0.35), slabWith([0.2, 0.22, 0.25], 0.6), 0.5),
			mixOf(slabWith([0.55, 0.5, 0.45], 0.25), slabWith([0.08, 0.09, 0.1], 0.8), 0.5),
			[0.9, 0.92, 0.95],
		),
		layerOver(
			mixOf(slabWith([0.4, 0.42, 0.44], 0.15), slabWith([0.6, 0.58, 0.5], 0.45), 0.5),
			mixOf(slabWith([0.12, 0.14, 0.16], 0.9), slabWith([0.7, 0.68, 0.66], 0.3), 0.5),
			[0.95, 0.9, 0.85],
		),
		0.5,
	)
}


export function findSimplificationProblems() {
	const problems = []
	const stressTopology = createSimplificationStressTopology()
	SB_TIER_NAMES.forEach((tierName) => {
		const declaredPolicy = tierDefaults(tierName).simplification
		if (simplificationPolicyFor(declaredPolicy) === null) {
			problems.push(`tier ${tierName}: politica de simplificacao desconhecida (${declaredPolicy})`)
		}
		const budget = simplificationBudgetFor(tierName)
		const result = simplifyTopology({ topology: stressTopology, tier: tierName })
		if (result.simplified.closureCount > budget.closureCeiling) {
			problems.push(
				`tier ${tierName}: a simplificacao parou em ${result.simplified.closureCount} closures, acima do teto ${budget.closureCeiling}`,
			)
		}
		if (result.simplified.depth > budget.depthCeiling) {
			problems.push(
				`tier ${tierName}: a simplificacao parou na profundidade ${result.simplified.depth}, acima do teto ${budget.depthCeiling}`,
			)
		}
	})
	return problems
}


export function describeSimplification(request = {}) {
	const topology = request.topology ?? createSimplificationStressTopology()
	return {
		budgets: describeSimplificationBudgets(),
		byTier: SB_TIER_NAMES.map((tierName) => {
			const result = simplifyTopology({ topology, tier: tierName })
			return {
				tier: tierName,
				policy: result.policy,
				original: result.original,
				simplified: result.simplified,
				blendCount: result.loss.blendCount,
				maxRelativeDelta: result.loss.maxRelativeDelta,
				deliverable: result.deliverable,
				refusals: result.refusals,
			}
		}),
		problems: findSimplificationProblems(),
	}
}
