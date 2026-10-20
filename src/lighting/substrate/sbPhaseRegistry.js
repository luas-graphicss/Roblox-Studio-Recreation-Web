import { SB_PHASE_MANIFEST, phaseEntry } from "./sbPhaseManifest.js"
import { sbQa } from "./support/src/lab/labTelemetry.js"

const PHASE_STATES = { pending: "pending", loaded: "loaded", failed: "failed" }
const MISSING_MODULE_HINTS = ["Failed to fetch dynamically imported module", "Cannot find module", "404", "NetworkError", "Failed to load"]

const phaseStatesById = new Map(
	SB_PHASE_MANIFEST.map((phase) => [
		phase.id,
		{ id: phase.id, block: phase.block, wave: phase.wave, title: phase.title, pass: phase.pass ?? null, state: PHASE_STATES.pending, detail: "arquivo da fase ainda nao existe" },
	]),
)

function looksLikeMissingModule(message) {
	return MISSING_MODULE_HINTS.some((hint) => message.includes(hint))
}

function recordState(phaseId, state, detail) {
	const entry = phaseStatesById.get(phaseId)
	if (!entry) return null
	entry.state = state
	entry.detail = detail ?? null
	sbQa.phase(phaseId, state, detail ?? null)
	return entry
}


export async function loadPhase(phaseId, installContext) {
	const manifestEntry = phaseEntry(phaseId)
	if (!manifestEntry) {
		sbQa.error("sbPhaseRegistry", "fase fora do manifesto: " + phaseId)
		return null
	}

	if (manifestEntry.pendingReason) return recordState(phaseId, PHASE_STATES.pending, manifestEntry.pendingReason)

	let phaseModule = null
	try {
		phaseModule = await manifestEntry.load()
	} catch (error) {
		const message = error?.message ?? String(error)
		if (looksLikeMissingModule(message)) {
			return recordState(phaseId, PHASE_STATES.pending, "arquivo da fase ainda nao existe")
		}
		return recordState(phaseId, PHASE_STATES.failed, "falha ao importar: " + message)
	}

	if (typeof phaseModule.installPhase !== "function") {
		return recordState(phaseId, PHASE_STATES.failed, "a fase nao exporta installPhase")
	}
	if (phaseModule.PHASE_ID && phaseModule.PHASE_ID !== phaseId) {
		return recordState(phaseId, PHASE_STATES.failed, "PHASE_ID divergente: " + phaseModule.PHASE_ID)
	}

	try {
		const installResult = await phaseModule.installPhase(installContext)
		const detail = installResult?.summary ?? "instalada"
		return recordState(phaseId, PHASE_STATES.loaded, detail)
	} catch (error) {
		return recordState(phaseId, PHASE_STATES.failed, "installPhase lancou: " + (error?.message ?? error))
	}
}


export async function loadAllPhases(installContext) {
	for (const phase of SB_PHASE_MANIFEST) {
		await loadPhase(phase.id, installContext)
	}
	return phaseSummary()
}

export async function reloadPhase(phaseId, installContext) {
	recordState(phaseId, PHASE_STATES.pending, "recarregando")
	return loadPhase(phaseId, installContext)
}

export function listPhases() {
	return Array.from(phaseStatesById.values()).map((entry) => ({ ...entry }))
}

export function phaseSummary() {
	const all = listPhases()
	const countByState = { pending: 0, loaded: 0, failed: 0 }
	for (const entry of all) countByState[entry.state] += 1
	return {
		total: all.length,
		...countByState,
		failedPhases: all.filter((entry) => entry.state === PHASE_STATES.failed).map((entry) => ({ id: entry.id, detail: entry.detail })),
		loadedPhases: all.filter((entry) => entry.state === PHASE_STATES.loaded).map((entry) => entry.id),
	}
}

export { PHASE_STATES }
