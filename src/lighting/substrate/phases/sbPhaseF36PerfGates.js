import { getSubstrateHostSurface } from "../runtime/substrateHostSurface.js";


import { SB_TIER_NAMES, patchOrderFor, tierDefaults } from "../sbMaterialContract.js"
import { resolveTierName } from "../sbClosureDispatchCore.js"
import {
	SB_PERF_GATE_IDS,
	SB_PERF_VERDICTS,
	evaluateProgramCensusGate,
	perfGateCeilings,
	summarizeFrameSamples,
	tierFrameBudgetMilliseconds,
} from "../sbPerfGateCore.js"
import {
	certifyPerfGates,
	referenceDispatchCostByTier,
	referencePermutations,
} from "../sbPerfGateCertificationCore.js"

export const PHASE_ID = "SB-F36"
export const FLAG_ID = "SubstratePerfGates"
export const FRAME_STAGE_NAME = "afterRender"
export const FRAME_STAGE_ID = "sbPerfGateSampling"
export const GLSL_PATCH_COUNT = 0
export const TEXTURE_UNITS_CONSUMED_BY_PHASE = 0
export const CLOSURE_BYTES_ADDED_BY_PHASE = 0
export const MAX_SAMPLES_PER_TIER = 240
export const MILLISECONDS_PER_SECOND = 1000

const CONSOLE_SURFACE_NAME = "perfGates"
const FALLBACK_TIER_NAME = "forte"


function flagDefaultsByTier() {
	const defaults = {}
	for (const tierName of SB_TIER_NAMES) {
		defaults[tierName] = Boolean(tierDefaults(tierName)?.substrateEnabled)
	}
	return defaults
}

function benchTierName(installContext) {
	const readTier = installContext?.bench?.tier
	const tierName = typeof readTier === "function" ? readTier() : null
	return typeof tierName === "string" ? tierName : FALLBACK_TIER_NAME
}

function samplingIsActive(installContext) {
	const isFlagActive = installContext?.flags?.isFlagActive
	if (typeof isFlagActive !== "function") return false
	return isFlagActive(FLAG_ID, benchTierName(installContext)) === true
}


function frameMillisecondsFrom(frameContext) {
	const publishedMilliseconds = Number(frameContext?.frameMilliseconds)
	if (Number.isFinite(publishedMilliseconds) && publishedMilliseconds > 0) return publishedMilliseconds
	const deltaSeconds = Number(frameContext?.deltaSeconds)
	if (Number.isFinite(deltaSeconds) && deltaSeconds > 0) return deltaSeconds * MILLISECONDS_PER_SECOND
	return null
}


function closureCountFrom(frameContext) {
	const publishedCounts = [
		frameContext?.closurePlan?.dispatchedCount,
		frameContext?.substrateClosureCount,
		Array.isArray(frameContext?.closures) ? frameContext.closures.length : null,
	]
	for (const publishedCount of publishedCounts) {
		const closureCount = Number(publishedCount)
		if (Number.isInteger(closureCount) && closureCount > 0) return closureCount
	}
	return null
}


export function createPerfSampleRecorder(installContext) {
	const samplesByTier = new Map()
	const state = {
		recordedSampleCount: 0,
		skippedFrameCount: 0,
		framesWithoutClosureCount: 0,
		framesWithoutMilliseconds: 0,
		lastSample: null,
	}

	function record(rawSample) {
		const closureCount = Number(rawSample?.closureCount)
		const milliseconds = Number(rawSample?.milliseconds)
		if (!Number.isInteger(closureCount) || 1 > closureCount) {
			return { accepted: false, reason: "closureCount tem de ser inteiro positivo" }
		}
		if (!Number.isFinite(milliseconds) || 0 >= milliseconds) {
			return { accepted: false, reason: "milliseconds tem de ser positivo" }
		}
		const tierName = resolveTierName(rawSample?.tierName)
		const samples = samplesByTier.get(tierName) ?? []
		samples.push({ closureCount, milliseconds })
		if (samples.length > MAX_SAMPLES_PER_TIER) {
			samples.splice(0, samples.length - MAX_SAMPLES_PER_TIER)
		}
		samplesByTier.set(tierName, samples)
		state.recordedSampleCount += 1
		state.lastSample = { tierName, closureCount, milliseconds }
		return { accepted: true, tierName, closureCount, milliseconds, sampleCount: samples.length }
	}

	function run(frameContext) {
		if (!samplingIsActive(installContext)) {
			state.skippedFrameCount += 1
			return null
		}
		const closureCount = closureCountFrom(frameContext)
		if (closureCount === null) {
			state.skippedFrameCount += 1
			state.framesWithoutClosureCount += 1
			return null
		}
		const milliseconds = frameMillisecondsFrom(frameContext)
		if (milliseconds === null) {
			state.skippedFrameCount += 1
			state.framesWithoutMilliseconds += 1
			return null
		}
		return record({ tierName: benchTierName(installContext), closureCount, milliseconds })
	}

	function samplesByTierName() {
		return Object.fromEntries(Array.from(samplesByTier.entries()).map(([tierName, samples]) => [tierName, [...samples]]))
	}

	function summaryByTierName() {
		return Object.fromEntries(
			Array.from(samplesByTier.entries()).map(([tierName, samples]) => [tierName, summarizeFrameSamples(samples)]),
		)
	}

	function reset() {
		samplesByTier.clear()
		state.recordedSampleCount = 0
		state.skippedFrameCount = 0
		state.framesWithoutClosureCount = 0
		state.framesWithoutMilliseconds = 0
		state.lastSample = null
		return state
	}

	return { state, record, run, samplesByTierName, summaryByTierName, reset }
}


export function createIdleOverheadLedger() {
	const state = { measurement: null }

	function set(input) {
		const flagsOffMilliseconds = Number(input?.flagsOffMilliseconds)
		const legacyBaselineMilliseconds = Number(input?.legacyBaselineMilliseconds)
		if (!Number.isFinite(flagsOffMilliseconds) || 0 >= flagsOffMilliseconds) {
			return { accepted: false, reason: "flagsOffMilliseconds tem de ser medido e positivo" }
		}
		if (!Number.isFinite(legacyBaselineMilliseconds) || 0 >= legacyBaselineMilliseconds) {
			return { accepted: false, reason: "legacyBaselineMilliseconds tem de ser medido e positivo" }
		}
		state.measurement = { flagsOffMilliseconds, legacyBaselineMilliseconds }
		return {
			accepted: true,
			...state.measurement,
			overheadMilliseconds: flagsOffMilliseconds - legacyBaselineMilliseconds,
		}
	}

	function clear() {
		state.measurement = null
		return state
	}

	return { state, set, clear, get: () => state.measurement }
}


export function createPerfGateConsoleSurface(installContext, recorder, idleOverheadLedger) {
	function certify() {
		return certifyPerfGates({
			frameSamplesByTier: recorder.samplesByTierName(),
			idleOverhead: idleOverheadLedger.get(),
		})
	}

	return {
		owner: PHASE_ID,
		flagId: FLAG_ID,
		gateIds: { ...SB_PERF_GATE_IDS },
		glslPatchCount: GLSL_PATCH_COUNT,
		reservedPatchOrder: patchOrderFor(PHASE_ID, 0),
		ceilings: () => perfGateCeilings(),
		dispatchByTier: () => referenceDispatchCostByTier(),
		census: () => evaluateProgramCensusGate({ permutations: referencePermutations() }),
		certify,
		record: (sample) => recorder.record(sample),
		samples: () => recorder.samplesByTierName(),
		sampleSummary: () => recorder.summaryByTierName(),
		frameState: () => ({ ...recorder.state }),
		resetSamples: () => recorder.reset(),
		idleOverhead: (measurement) =>
			measurement === undefined ? idleOverheadLedger.get() : idleOverheadLedger.set(measurement),
		clearIdleOverhead: () => idleOverheadLedger.clear(),
		isActive: () => samplingIsActive(installContext),
	}
}


function publishConsoleSurface(consoleSurface) {
	const lab = getSubstrateHostSurface()
	if (!lab || typeof lab !== "object") return false
	lab[CONSOLE_SURFACE_NAME] = consoleSurface
	return true
}

function registerPerfGateFlag(installContext, refusals) {
	const registerFlag = installContext?.flags?.registerFlag
	if (typeof registerFlag !== "function") {
		refusals.push("bancada sem flags.registerFlag: a fase ficou sem chave de ignicao")
		return null
	}
	return registerFlag({
		id: FLAG_ID,
		owner: PHASE_ID,
		description: "Coleta amostras de quadro para os portoes de performance. Nao muda um pixel.",
		defaultsByTier: flagDefaultsByTier(),
	})
}

function registerSamplingFrameStage(installContext, recorder, refusals) {
	const registerFrameStage = installContext?.frameStages?.registerFrameStage
	if (typeof registerFrameStage !== "function") {
		refusals.push("bancada sem frameStages.registerFrameStage: nenhuma amostra de quadro seria coletada")
		return null
	}
	const registration = registerFrameStage(FRAME_STAGE_NAME, {
		id: FRAME_STAGE_ID,
		owner: PHASE_ID,
		run: (frameContext) => recorder.run(frameContext),
	})
	if (registration?.accepted !== true) {
		refusals.push("estagio de frame recusado: " + (registration?.reason ?? "motivo nao informado"))
	}
	return registration
}


function declareBudget(installContext) {
	installContext?.telemetry?.closureBytes?.(PHASE_ID, CLOSURE_BYTES_ADDED_BY_PHASE)
	installContext?.telemetry?.textureUnit?.(PHASE_ID, TEXTURE_UNITS_CONSUMED_BY_PHASE)
}

function frameBudgetSummary() {
	return SB_TIER_NAMES.map((tierName) => tierFrameBudgetMilliseconds(tierName)).join("/")
}


function summarizeInstall(certification, refusals) {
	const census = certification.gates.programCensus
	const head =
		PHASE_ID +
		": " +
		census.distinctProgramCount +
		" programas em " +
		census.familyCount +
		" familias (pior familia " +
		(census.worstFamily?.programCount ?? 0) +
		" de " +
		census.ceiling +
		"), orcamento " +
		frameBudgetSummary() +
		" ms por tier, " +
		certification.pending.length +
		" portao(oes) sem medicao, " +
		GLSL_PATCH_COUNT +
		" patch de GLSL"
	if (refusals.length === 0) return head
	return head + " -- com " + refusals.length + " recusa(s), a primeira: " + refusals[0]
}








export function installPhase(installContext = {}) {
	const refusals = []
	try {
		const flag = registerPerfGateFlag(installContext, refusals)
		const recorder = createPerfSampleRecorder(installContext)
		const idleOverheadLedger = createIdleOverheadLedger()
		const frameStage = registerSamplingFrameStage(installContext, recorder, refusals)
		declareBudget(installContext)

		const certification = certifyPerfGates({
			frameSamplesByTier: recorder.samplesByTierName(),
			idleOverhead: idleOverheadLedger.get(),
		})
		for (const problem of certification.problems) {
			refusals.push("portao reprovado: " + problem)
		}

		const consoleSurface = createPerfGateConsoleSurface(installContext, recorder, idleOverheadLedger)
		const consolePublished = publishConsoleSurface(consoleSurface)

		for (const refusal of refusals) {
			installContext?.telemetry?.error?.(PHASE_ID, refusal)
		}

		return {
			phaseId: PHASE_ID,
			installed: refusals.length === 0,
			flagId: flag?.id ?? FLAG_ID,
			frameStageName: frameStage?.stageName ?? null,
			frameStageId: frameStage?.id ?? null,
			reservedPatchOrder: patchOrderFor(PHASE_ID, 0),
			glslPatchCount: GLSL_PATCH_COUNT,
			textureUnitsConsumed: TEXTURE_UNITS_CONSUMED_BY_PHASE,
			closureBytesAdded: CLOSURE_BYTES_ADDED_BY_PHASE,
			gatesOk: certification.ok,
			gatesComplete: certification.complete,
			permutationCount: certification.permutationCount,
			programCensusVerdict: certification.gates.programCensus.verdict,
			programKeyStable: certification.stability.ok,
			pending: certification.pending,
			consolePublished,
			consoleSurface,
			recorder,
			idleOverheadLedger,
			certification,
			refusals,
			summary: summarizeInstall(certification, refusals),
		}
	} catch (installError) {
		const message = "instalacao falhou: " + (installError?.message ?? String(installError))
		installContext?.telemetry?.error?.(PHASE_ID, message)
		return {
			phaseId: PHASE_ID,
			installed: false,
			verdicts: SB_PERF_VERDICTS,
			refusals: [...refusals, message],
			summary: PHASE_ID + " nao instalou: " + message,
		}
	}
}
