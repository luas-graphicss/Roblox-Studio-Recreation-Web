import {
	SB_BYTES_PER_PIXEL_CEILING,
	SB_CLOSURE_BYTES_CEILING,
	SB_GATES,
	SB_MAX_CLOSURES_PER_PIXEL,
	SB_TIER_NAMES,
	slabClosureBytes,
	tierBytesPerPixel,
	tierDefaults,
} from "./sbMaterialContract.js"
import { tierClosureCeiling } from "./sbClosureDispatchCore.js"
import {
	createSimplificationStressTopology,
	describeTopology,
	simplificationBudgetFor,
	simplifyTopology,
} from "./sbSimplificationPolicyCore.js"

export const BUDGET_PHASE_ID = "SB-F34"


export const SB_CLOSURE_BUDGET_UNIFORM_NAME = "uSbClosureBudget"


export const SB_LEGACY_CLOSURE_BUDGET = 1


export const SB_HIGH_QUALITY_TIER_NAME = SB_TIER_NAMES[SB_TIER_NAMES.length - 1]


export const SB_HIGH_SHEEN_QUALITY = "high"

const FALLBACK_TIER_NAME = SB_HIGH_QUALITY_TIER_NAME


export const SB_BUDGET_REFUSAL_CODES = Object.freeze({
	unknownTier: "unknownTier",
	governorVetoed: "governorVetoed",
	substrateDisabledOnTier: "substrateDisabledOnTier",
	closureCeilingExceeded: "closureCeilingExceeded",
	closureBytesCeilingExceeded: "closureBytesCeilingExceeded",
	bytesPerPixelCeilingExceeded: "bytesPerPixelCeilingExceeded",
	depthCeilingExceeded: "depthCeilingExceeded",
})

function createRefusal(code, message) {
	return { code, message }
}

function resolveTierNameOrFallback(tierName) {
	return SB_TIER_NAMES.includes(tierName) ? tierName : FALLBACK_TIER_NAME
}


export function featureQualityFor(tierName) {
	const defaults = tierDefaults(resolveTierNameOrFallback(tierName))
	return Object.freeze({
		glints: defaults.glints === true,
		sheenQuality: defaults.sheenQuality,
		sheenHighQuality: defaults.sheenQuality === SB_HIGH_SHEEN_QUALITY,
		roughRefraction: defaults.roughRefraction === true,
		subsurfaceMode: defaults.subsurfaceMode,
		translucencyMode: defaults.translucencyMode,
		debugVisualization: defaults.debugVisualization === true,
	})
}


export function highQualityFeatureProblems() {
	const problems = []
	for (const tierName of SB_TIER_NAMES) {
		const quality = featureQualityFor(tierName)
		if (tierName === SB_HIGH_QUALITY_TIER_NAME) {
			if (!quality.glints) {
				problems.push("tier " + tierName + ": glints desligados no tier que tem de liga-los")
			}
			if (!quality.sheenHighQuality) {
				problems.push("tier " + tierName + ": sheen fora da qualidade alta no tier que tem de liga-la")
			}
			continue
		}
		if (quality.glints) {
			problems.push("tier " + tierName + ": glints ligados fora do tier " + SB_HIGH_QUALITY_TIER_NAME)
		}
		if (quality.sheenHighQuality) {
			problems.push("tier " + tierName + ": sheen de qualidade alta fora do tier " + SB_HIGH_QUALITY_TIER_NAME)
		}
	}
	return problems
}


export function resolveTierBudget(tierName) {
	const tierKnown = SB_TIER_NAMES.includes(tierName)
	const resolvedTierName = resolveTierNameOrFallback(tierName)
	const defaults = tierDefaults(resolvedTierName)
	const simplificationBudget = simplificationBudgetFor(resolvedTierName)
	const substrateEnabled = defaults.substrateEnabled === true
	const closureCeiling = tierClosureCeiling(resolvedTierName)
	return {
		phaseId: BUDGET_PHASE_ID,
		tier: resolvedTierName,
		requestedTier: tierName ?? null,
		tierKnown,
		substrateEnabled,
		legacyPath: !substrateEnabled,
		closureCeiling,
		closureBudgetUniformValue: substrateEnabled ? closureCeiling : SB_LEGACY_CLOSURE_BUDGET,
		closureBytes: slabClosureBytes(),
		closureBytesCeiling: simplificationBudget.closureBytesCeiling,
		bytesPerPixelCeiling: simplificationBudget.bytesPerPixelCeiling,
		tierBytesPerPixel: tierBytesPerPixel(resolvedTierName),
		depthCeiling: simplificationBudget.depthCeiling,
		simplificationPolicy: simplificationBudget.policy,
		frameBudgetMilliseconds: defaults.frameBudgetMilliseconds,
		warmupSpikeCeilingMilliseconds: SB_GATES.maxWarmupSpikeMilliseconds,
		featureQuality: featureQualityFor(resolvedTierName),
	}
}

export function describeTierBudgets() {
	return SB_TIER_NAMES.map((tierName) => resolveTierBudget(tierName))
}


export function closureBudgetUniformValue(tierName, governorActive = true) {
	if (governorActive !== true) return SB_LEGACY_CLOSURE_BUDGET
	return resolveTierBudget(tierName).closureBudgetUniformValue
}


export function createOversizedGateTopology() {
	return createSimplificationStressTopology()
}


export function admitTopology(request = {}) {
	const governorActive = request.governorActive !== false
	const budget = resolveTierBudget(request.tierName)
	const requested = describeTopology(request.topology)
	const simplification = simplifyTopology({ topology: request.topology, tier: budget.tier })
	const simplified = simplification.simplified
	const refusals = []

	if (!budget.tierKnown) {
		refusals.push(
			createRefusal(
				SB_BUDGET_REFUSAL_CODES.unknownTier,
				"tier desconhecido (" + String(request.tierName) + "): o governador nao inventa permissao e cai no teto de " + budget.tier,
			),
		)
	}
	if (!governorActive) {
		refusals.push(
			createRefusal(
				SB_BUDGET_REFUSAL_CODES.governorVetoed,
				"governador vetado por flag: o orcamento entregue e o do legado (" + SB_LEGACY_CLOSURE_BUDGET + " closure)",
			),
		)
	}
	if (!budget.substrateEnabled) {
		refusals.push(
			createRefusal(
				SB_BUDGET_REFUSAL_CODES.substrateDisabledOnTier,
				"tier " + budget.tier + ": o contrato desliga o Substrate neste tier, entao a topologia fica no legado",
			),
		)
	}
	if (simplified.closureCount > budget.closureCeiling) {
		refusals.push(
			createRefusal(
				SB_BUDGET_REFUSAL_CODES.closureCeilingExceeded,
				"tier " + budget.tier + ": " + simplified.closureCount + " closures depois de simplificar, acima do teto " + budget.closureCeiling,
			),
		)
	}
	if (budget.closureBytes > budget.closureBytesCeiling) {
		refusals.push(
			createRefusal(
				SB_BUDGET_REFUSAL_CODES.closureBytesCeilingExceeded,
				"tier " + budget.tier + ": a closure de slab ocupa " + budget.closureBytes + " B e o tier reserva " + budget.closureBytesCeiling + " B",
			),
		)
	}
	if (simplified.bytesPerPixel > budget.bytesPerPixelCeiling) {
		refusals.push(
			createRefusal(
				SB_BUDGET_REFUSAL_CODES.bytesPerPixelCeilingExceeded,
				"tier " + budget.tier + ": " + simplified.bytesPerPixel + " B por pixel, acima do teto " + budget.bytesPerPixelCeiling + " B",
			),
		)
	}
	if (simplified.depth > budget.depthCeiling) {
		refusals.push(
			createRefusal(
				SB_BUDGET_REFUSAL_CODES.depthCeilingExceeded,
				"tier " + budget.tier + ": profundidade " + simplified.depth + ", acima do teto " + budget.depthCeiling,
			),
		)
	}

	const admitted = refusals.length === 0
	return {
		phaseId: BUDGET_PHASE_ID,
		tier: budget.tier,
		governorActive,
		budget,
		requested,
		simplified,
		simplificationPolicy: simplification.policy,
		simplificationLoss: simplification.loss,
		admitted,
		closureCountForShader: admitted ? simplified.closureCount : 0,
		bytesPerPixelForShader: admitted ? simplified.bytesPerPixel : 0,
		closureBudgetUniformValue: admitted ? budget.closureBudgetUniformValue : SB_LEGACY_CLOSURE_BUDGET,
		refusals,
		refusalCodes: refusals.map((refusal) => refusal.code),
	}
}


export function findTierBudgetProblems() {
	const problems = [...highQualityFeatureProblems()]

	for (const tierName of SB_TIER_NAMES) {
		const budget = resolveTierBudget(tierName)
		const simplificationCeiling = simplificationBudgetFor(tierName).closureCeiling
		if (budget.closureCeiling !== simplificationCeiling) {
			problems.push(
				"tier " + tierName + ": teto de closures divergente entre SB-F9 (" + budget.closureCeiling + ") e SB-F7 (" + simplificationCeiling + ")",
			)
		}
		if (budget.closureCeiling > SB_MAX_CLOSURES_PER_PIXEL) {
			problems.push("tier " + tierName + ": teto de closures acima do teto absoluto do contrato")
		}
		if (budget.closureBytesCeiling > SB_CLOSURE_BYTES_CEILING) {
			problems.push("tier " + tierName + ": bytes por closure acima do teto absoluto do contrato")
		}
		if (budget.tierBytesPerPixel > SB_BYTES_PER_PIXEL_CEILING) {
			problems.push("tier " + tierName + ": bytes por pixel acima do teto absoluto do contrato")
		}
		if (!Number.isFinite(budget.frameBudgetMilliseconds) || 0 >= budget.frameBudgetMilliseconds) {
			problems.push("tier " + tierName + ": orcamento de frame ausente ou nao positivo")
		}
	}

	const legacyTierBudget = resolveTierBudget(SB_TIER_NAMES[0])
	if (legacyTierBudget.substrateEnabled) {
		problems.push("o primeiro tier nao pode nascer com o Substrate ligado")
	}
	if (legacyTierBudget.closureBudgetUniformValue !== SB_LEGACY_CLOSURE_BUDGET) {
		problems.push("o tier legado tem de escrever " + SB_LEGACY_CLOSURE_BUDGET + " em " + SB_CLOSURE_BUDGET_UNIFORM_NAME)
	}
	if (!Number.isFinite(SB_GATES.maxWarmupSpikeMilliseconds) || 0 >= SB_GATES.maxWarmupSpikeMilliseconds) {
		problems.push("o contrato nao declara um teto de pico de warmup utilizavel")
	}

	return problems
}


export function evaluateTierBudgetGate(request = {}) {
	const topology = request.topology ?? createOversizedGateTopology()
	const problems = [...findTierBudgetProblems()]

	const byTier = SB_TIER_NAMES.map((tierName) => {
		const admission = admitTopology({ topology, tierName })
		if (admission.closureCountForShader > admission.budget.closureCeiling) {
			problems.push(
				"tier " + tierName + ": " + admission.closureCountForShader + " closures chegaram ao shader com teto " + admission.budget.closureCeiling,
			)
		}
		if (admission.bytesPerPixelForShader > admission.budget.bytesPerPixelCeiling) {
			problems.push(
				"tier " + tierName + ": " + admission.bytesPerPixelForShader + " B por pixel chegaram ao shader com teto " + admission.budget.bytesPerPixelCeiling,
			)
		}
		if (!admission.admitted && admission.refusals.length === 0) {
			problems.push("tier " + tierName + ": recusa sem motivo escrito")
		}
		return {
			tier: tierName,
			substrateEnabled: admission.budget.substrateEnabled,
			closureCeiling: admission.budget.closureCeiling,
			requestedClosureCount: admission.requested.closureCount,
			simplifiedClosureCount: admission.simplified.closureCount,
			closureCountForShader: admission.closureCountForShader,
			bytesPerPixelForShader: admission.bytesPerPixelForShader,
			closureBudgetUniformValue: admission.closureBudgetUniformValue,
			admitted: admission.admitted,
			refusalCodes: admission.refusalCodes,
		}
	})

	const legacyTier = byTier[0]
	if (legacyTier.admitted) {
		problems.push("o tier legado admitiu uma topologia de Substrate: a GPU fraca tem de ficar no legado")
	}
	if (legacyTier.closureCountForShader !== 0) {
		problems.push("o tier legado deixou " + legacyTier.closureCountForShader + " closures chegarem ao shader")
	}
	if (legacyTier.closureBudgetUniformValue !== SB_LEGACY_CLOSURE_BUDGET) {
		problems.push("o tier legado nao entregou o orcamento do legado no uniform")
	}


	const oversizedForEveryTier = byTier.every((entry) => entry.requestedClosureCount > entry.closureCeiling)
	if (!oversizedForEveryTier) {
		problems.push("a topologia do portao nao estoura o teto de todos os tiers: a prova passaria vazia")
	}

	return {
		phaseId: BUDGET_PHASE_ID,
		ok: problems.length === 0,
		requestedClosureCount: byTier[0].requestedClosureCount,
		oversizedForEveryTier,
		byTier,
		problems,
	}
}


export function describeTierBudgetGovernor(request = {}) {
	return {
		phaseId: BUDGET_PHASE_ID,
		uniformName: SB_CLOSURE_BUDGET_UNIFORM_NAME,
		highQualityTier: SB_HIGH_QUALITY_TIER_NAME,
		legacyClosureBudget: SB_LEGACY_CLOSURE_BUDGET,
		budgets: describeTierBudgets(),
		gate: evaluateTierBudgetGate(request),
	}
}
