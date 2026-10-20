import {
	closeParityLine,
	openParityLines,
	parityLedgerLine,
	parityLedgerLines,
	parityLedgerSummary,
	parityLinesForPhase,
	phaseCompletionState,
	reopenParityLine,
} from "../sbParityLedgerCore.js"
import { divergenceReport, fiveNineResidues, referenceSourcesProblems, resolveResidue } from "../sbReferenceSourcesCore.js"

export const PHASE_ID = "SB-F1"


const PARITY_LEDGER_GLOBAL_NAME = "__sbParityLedger"


const TEXTURE_UNITS_USED = 0
const CLOSURE_BYTES_USED = 0

function reportProblems(telemetry, problems) {
	if (!telemetry?.error) return
	for (const problem of problems) telemetry.error(PHASE_ID, problem)
}

function declareZeroBudget(telemetry) {
	telemetry?.textureUnit?.(PHASE_ID, TEXTURE_UNITS_USED)
	telemetry?.closureBytes?.(PHASE_ID, CLOSURE_BYTES_USED)
}


function publishConsoleApi() {
	if (typeof window === "undefined") return false
	window[PARITY_LEDGER_GLOBAL_NAME] = {
		lines: () => parityLedgerLines(),
		line: (lineId) => parityLedgerLine(lineId),
		forPhase: (phaseId) => parityLinesForPhase(phaseId),
		open: () => openParityLines(),
		summary: () => parityLedgerSummary(),
		close: (lineId, proof) => closeParityLine(lineId, proof),
		reopen: (lineId) => reopenParityLine(lineId),
		phaseDone: (phaseId) => phaseCompletionState(phaseId),
		divergences: () => divergenceReport(),
		residues: () => fiveNineResidues(),
		resolveResidue: (residueId, resolution) => resolveResidue(residueId, resolution),
	}
	return true
}

export function installPhase(installContext) {
	const telemetry = installContext?.telemetry ?? null

	const summary = parityLedgerSummary()
	const report = divergenceReport()
	const problems = [...summary.problems, ...referenceSourcesProblems()]

	reportProblems(telemetry, problems)
	declareZeroBudget(telemetry)
	const consolePublished = publishConsoleApi()

	if (problems.length > 0) {
		return { summary: "ledger com " + problems.length + " problema(s), o primeiro: " + problems[0] }
	}

	return {
		summary:
			"ledger de paridade: " +
			summary.total +
			" linhas (" +
			summary.open +
			" abertas, " +
			summary.closed +
			" fechadas), " +
			summary.phasesCovered +
			" fases cobertas, " +
			report.unverified +
			" residuos 5.9 por verificar" +
			(consolePublished ? ", console em window." + PARITY_LEDGER_GLOBAL_NAME : ""),
	}
}
