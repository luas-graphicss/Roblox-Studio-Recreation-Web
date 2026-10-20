import { getSubstrateHostSurface } from "../runtime/substrateHostSurface.js";


import { SB_TIER_NAMES, patchOrderFor, tierDefaults } from "../sbMaterialContract.js"
import { resolveTierName } from "../sbClosureDispatchCore.js"
import {
	SB_CLOSURE_BUDGET_UNIFORM_NAME,
	SB_LEGACY_CLOSURE_BUDGET,
	admitTopology,
	closureBudgetUniformValue,
	createOversizedGateTopology,
	describeTierBudgetGovernor,
	describeTierBudgets,
	evaluateTierBudgetGate,
	findTierBudgetProblems,
	resolveTierBudget,
} from "../sbTierBudgetCore.js"
import { describeWarmupPlan, evaluateWarmupGate } from "../sbWarmupPlanCore.js"
import { SB_WARMUP_EVIDENCE_ID, SB_WARMUP_FRAME_STAGE, SB_WARMUP_FRAME_STAGE_ID, createWarmupRuntime, describeWarmupHost } from "../sbWarmupRuntime.js"

export const PHASE_ID = "SB-F34"
export const TIER_BUDGET_FLAG_ID = "SubstrateTierBudget"
export const TIER_BUDGET_FRAME_STAGE = "beforeMaterials"
export const TIER_BUDGET_FRAME_STAGE_ID = "sbF34TierBudget"
export const SB_TIER_BUDGET_TEXTURE_UNITS = 0
export const SB_TIER_BUDGET_CLOSURE_BYTES = 0
export const WARMUP_FRAME_STAGE = SB_WARMUP_FRAME_STAGE
export const WARMUP_FRAME_STAGE_ID = SB_WARMUP_FRAME_STAGE_ID
const FALLBACK_TIER_NAME = "forte"

export { evaluateTierBudgetGate, evaluateWarmupGate }


export function flagDefaultsByTier() {
	const defaults = {}
	for (const tierName of SB_TIER_NAMES) {
		defaults[tierName] = tierDefaults(tierName)?.substrateEnabled === true
	}
	return defaults
}

function cacheKeyFor(tierName, governorActive) {
	return tierName + "|" + (governorActive ? "on" : "off")
}


const budgetReportsByCacheKey = new Map()

function budgetReportFor(tierName, governorActive) {
	const cacheKey = cacheKeyFor(tierName, governorActive)
	const cachedReport = budgetReportsByCacheKey.get(cacheKey)
	if (cachedReport) return cachedReport

	const budget = resolveTierBudget(tierName)
	const report = Object.freeze({
		phaseId: PHASE_ID,
		tier: budget.tier,
		governorActive,
		legacyPath: budget.legacyPath || !governorActive,
		closureCeiling: budget.closureCeiling,
		closureBudgetUniformValue: closureBudgetUniformValue(tierName, governorActive),
		closureBytes: budget.closureBytes,
		closureBytesCeiling: budget.closureBytesCeiling,
		bytesPerPixelCeiling: budget.bytesPerPixelCeiling,
		depthCeiling: budget.depthCeiling,
		simplificationPolicy: budget.simplificationPolicy,
		featureQuality: budget.featureQuality,
		frameBudgetMilliseconds: budget.frameBudgetMilliseconds,
		warmupSpikeCeilingMilliseconds: budget.warmupSpikeCeilingMilliseconds,

		admit: (topology) => admitTopology({ topology, tierName: budget.tier, governorActive }),
	})
	budgetReportsByCacheKey.set(cacheKey, report)
	return report
}

function resolveTierNameFromBench(installContext) {
	const benchTier = installContext?.bench?.tier
	const rawTier = typeof benchTier === "function" ? benchTier() : null
	return resolveTierName(rawTier ?? FALLBACK_TIER_NAME)
}


function isGovernorActive(installContext, tierName) {
	const isFlagActive = installContext?.flags?.isFlagActive
	if (typeof isFlagActive !== "function") return true
	return isFlagActive(TIER_BUDGET_FLAG_ID, tierName) === true
}

function registerBudgetFlag(installContext, refusals) {
	const registerFlag = installContext?.flags?.registerFlag
	if (typeof registerFlag !== "function") {
		refusals.push("bancada sem registerFlag: a flag " + TIER_BUDGET_FLAG_ID + " nao existe")
		return false
	}
	registerFlag({
		id: TIER_BUDGET_FLAG_ID,
		owner: PHASE_ID,
		description: "Governa closures e bytes por pixel de cada tier e admite topologia no shader (SB-F34)",
		defaultsByTier: flagDefaultsByTier(),
	})
	return true
}

function registerBudgetUniform(installContext, initialValue, refusals) {
	const registerUniform = installContext?.patch?.registerUniform
	if (typeof registerUniform !== "function") {
		refusals.push("bancada sem registerUniform: " + SB_CLOSURE_BUDGET_UNIFORM_NAME + " nao foi declarado")
		return false
	}
	registerUniform(SB_CLOSURE_BUDGET_UNIFORM_NAME, { owner: PHASE_ID, value: initialValue })
	return true
}

function reportTelemetry(installContext) {
	const telemetry = installContext?.telemetry
	if (typeof telemetry?.textureUnit === "function") {
		telemetry.textureUnit(PHASE_ID, SB_TIER_BUDGET_TEXTURE_UNITS)
	}
	if (typeof telemetry?.closureBytes === "function") {
		telemetry.closureBytes(PHASE_ID, SB_TIER_BUDGET_CLOSURE_BYTES)
	}
}

function publishConsoleApi(consoleApi) {
	if (typeof window === "undefined") return false
	const lab = getSubstrateHostSurface()
	if (!lab || typeof lab !== "object") return false
	lab.tierBudget = consoleApi
	return true
}


export function installPhase(installContext) {
	const refusals = []
	const installTierName = resolveTierNameFromBench(installContext)
	const governorActiveOnInstall = isGovernorActive(installContext, installTierName)
	const installReport = budgetReportFor(installTierName, governorActiveOnInstall)

	for (const problem of findTierBudgetProblems()) {
		refusals.push("orcamento por tier: " + problem)
	}

	const flagRegistered = registerBudgetFlag(installContext, refusals)
	const uniformRegistered = registerBudgetUniform(installContext, installReport.closureBudgetUniformValue, refusals)






	let appliedUniformCacheKey = uniformRegistered ? cacheKeyFor(installTierName, governorActiveOnInstall) : null

	function publishBudgetForFrame(frameContext) {
		const frameTierName = resolveTierName(frameContext?.tier ?? installTierName)
		const governorActive = isGovernorActive(installContext, frameTierName)
		const report = budgetReportFor(frameTierName, governorActive)
		if (frameContext && typeof frameContext === "object") frameContext.tierBudget = report

		const cacheKey = cacheKeyFor(frameTierName, governorActive)
		if (appliedUniformCacheKey !== cacheKey) {
			const setUniform = installContext?.patch?.setUniform
			if (typeof setUniform === "function") {
				setUniform(SB_CLOSURE_BUDGET_UNIFORM_NAME, report.closureBudgetUniformValue)
			}
			appliedUniformCacheKey = cacheKey
		}
		return report
	}

	let frameStageRegistered = false
	const registerFrameStage = installContext?.frameStages?.registerFrameStage
	if (typeof registerFrameStage === "function") {
		const result = registerFrameStage(TIER_BUDGET_FRAME_STAGE, {
			id: TIER_BUDGET_FRAME_STAGE_ID,
			owner: PHASE_ID,
			run: publishBudgetForFrame,
		})
		if (result?.accepted === false) {
			refusals.push(
				"estagio de quadro recusado: " + TIER_BUDGET_FRAME_STAGE_ID + " (" + (result.reason ?? "sem motivo declarado") + ")",
			)
		} else {
			frameStageRegistered = true
		}
	} else {
		refusals.push("bancada sem registerFrameStage: o orcamento nao chega ao quadro")
	}

	const warmupHost = describeWarmupHost(installContext?.bench)
	const warmupRuntime = warmupHost.ok
		? createWarmupRuntime({
				THREE: installContext?.THREE ?? installContext?.bench?.THREE,
				renderer: installContext.bench.renderer,
				scene: installContext?.scene ?? installContext?.bench?.scene ?? null,
				spikeCeilingMilliseconds: installReport.warmupSpikeCeilingMilliseconds,
			})
		: null
	let warmupEvidence = warmupRuntime ? warmupRuntime.evidence() : { phaseId: PHASE_ID, state: "unavailable", ready: false, refusals: [{ code: warmupHost.code, reason: warmupHost.reason }] }
	let warmupStageRegistered = false

	function frameMaterials(frameContext) {
		const entries = Array.isArray(frameContext?.substrateMaterials) ? frameContext.substrateMaterials : []
		return entries.map((entry) => entry?.material ?? entry).filter((material) => material && "object" === typeof material)
	}

	function warmupForFrame(frameContext) {
		if (!warmupRuntime) return
		const frameTierName = resolveTierName(frameContext?.tier ?? installTierName)
		const added = warmupRuntime.enqueue(frameMaterials(frameContext), frameTierName)
		const slice = warmupRuntime.runSlice(frameContext?.camera ?? installContext?.bench?.camera ?? null)
		if (added > 0 || slice) {
			warmupEvidence = warmupRuntime.evidence()
			const reportEvidence = getSubstrateHostSurface()?.screen?.reportEvidence
			if (typeof reportEvidence === "function") {
				reportEvidence(SB_WARMUP_EVIDENCE_ID, {
					state: warmupEvidence.state,
					compiled: warmupEvidence.compiledCount,
					pending: warmupEvidence.pendingCount,
					programsCreated: warmupEvidence.programsCreated,
					worstSliceMilliseconds: warmupEvidence.worstSliceMilliseconds,
					ceilingMilliseconds: warmupEvidence.ceilingMilliseconds,
					gateOk: warmupEvidence.gate?.ok ?? null,
				})
			}
		}
		if (frameContext && typeof frameContext === "object") frameContext.warmup = warmupEvidence
	}

	if (warmupRuntime && typeof registerFrameStage === "function") {
		const result = registerFrameStage(SB_WARMUP_FRAME_STAGE, { id: SB_WARMUP_FRAME_STAGE_ID, owner: PHASE_ID, run: warmupForFrame })
		if (result?.accepted === false) {
			refusals.push("estagio de warmup recusado: " + SB_WARMUP_FRAME_STAGE_ID + " (" + (result.reason ?? "sem motivo declarado") + ")")
		} else {
			warmupStageRegistered = true
		}
	}

	reportTelemetry(installContext)

	const telemetryError = installContext?.telemetry?.error
	if (refusals.length > 0 && typeof telemetryError === "function") {
		for (const refusal of refusals) telemetryError(PHASE_ID, refusal)
	}

	const consolePublished = publishConsoleApi({
		describe: () => describeTierBudgetGovernor(),
		budgets: () => describeTierBudgets(),
		current: () => publishBudgetForFrame(null),
		admit: (topology) =>
			admitTopology({
				topology: topology ?? createOversizedGateTopology(),
				tierName: resolveTierNameFromBench(installContext),
				governorActive: isGovernorActive(installContext, resolveTierNameFromBench(installContext)),
			}),
		gate: (input) => evaluateTierBudgetGate(input ?? {}),
		warmup: (input) => describeWarmupPlan(input ?? {}),
		warmupGate: (input) => (input ? evaluateWarmupGate(input) : warmupRuntime?.gate() ?? evaluateWarmupGate({})),
		warmupRuntime: () => (warmupRuntime ? warmupRuntime.evidence() : warmupEvidence),
		warmupReset: () => {
			warmupRuntime?.reset()
			warmupEvidence = warmupRuntime ? warmupRuntime.evidence() : warmupEvidence
			return warmupEvidence
		},
		problems: () => findTierBudgetProblems(),
		refusals: () => [...refusals],
	})

	return {
		phaseId: PHASE_ID,
		installed: refusals.length === 0,
		tierName: installTierName,
		governorActive: governorActiveOnInstall,
		flagId: TIER_BUDGET_FLAG_ID,
		flagRegistered,
		uniformName: SB_CLOSURE_BUDGET_UNIFORM_NAME,
		uniformRegistered,
		uniformValue: installReport.closureBudgetUniformValue,
		closureCeiling: installReport.closureCeiling,
		bytesPerPixelCeiling: installReport.bytesPerPixelCeiling,
		legacyClosureBudget: SB_LEGACY_CLOSURE_BUDGET,
		frameStage: TIER_BUDGET_FRAME_STAGE,
		frameStageId: TIER_BUDGET_FRAME_STAGE_ID,
		frameStageRegistered,
		warmupStage: SB_WARMUP_FRAME_STAGE,
		warmupStageId: SB_WARMUP_FRAME_STAGE_ID,
		warmupStageRegistered,
		warmupHost,
		warmupEvidence,

		patchOrder: patchOrderFor(PHASE_ID, 0),
		registeredPatchCount: 0,
		textureUnits: SB_TIER_BUDGET_TEXTURE_UNITS,
		closureBytes: SB_TIER_BUDGET_CLOSURE_BYTES,
		consolePublished,
		refusals,
	}
}
