import { getSubstrateHostSurface } from "../runtime/substrateHostSurface.js";


import {
	createReferenceSlabTree,
	createReferenceLayeredTree,
	describeMaterialTree,
	normalizeMaterialTree,
} from "../sbMaterialTreeCore.js"
import { validateMaterialTree } from "../sbMaterialTreeValidation.js"
import {
	serializeMaterialTree,
	deserializeMaterialTree,
	materialTreeFingerprint,
	materialTreeRoundTrip,
} from "../sbTreeSerializationCore.js"
import { runInvalidTreeBattery } from "../sbInvalidTreeBattery.js"

const PHASE_ID = "SB-F3"
const FLAG_ID = "SubstrateMaterialTree"
const TELEMETRY_SOURCE = "sbPhaseF3MaterialTree"

const REFERENCE_TREE_EXPECTED_DEPTH = 3
const REFERENCE_TREE_EXPECTED_SLABS = 4
const MINIMUM_REFUSED_INPUTS = 12


export function evaluateMaterialTreeGate() {
	const referenceTree = createReferenceLayeredTree()
	const validation = validateMaterialTree(referenceTree)
	const roundTrip = materialTreeRoundTrip(referenceTree)
	const battery = runInvalidTreeBattery()
	const problems = []

	if (!validation.ok) {
		for (const refusal of validation.refusals) {
			problems.push(`arvore de referencia recusada em ${refusal.path}: ${refusal.reason}`)
		}
	}
	if (validation.summary?.depth !== REFERENCE_TREE_EXPECTED_DEPTH) {
		problems.push(
			`arvore de referencia deveria ter ${REFERENCE_TREE_EXPECTED_DEPTH} niveis e tem ${validation.summary?.depth}`,
		)
	}
	if (validation.summary?.slabCount !== REFERENCE_TREE_EXPECTED_SLABS) {
		problems.push(
			`arvore de referencia deveria ter ${REFERENCE_TREE_EXPECTED_SLABS} slabs e tem ${validation.summary?.slabCount}`,
		)
	}
	if (!roundTrip.ok) problems.push(`ida e volta pelo texto falhou: ${roundTrip.reason}`)
	else if (!roundTrip.identical) problems.push("ida e volta pelo texto devolveu uma arvore diferente")
	if (!battery.ok) problems.push(...battery.problems)
	if (MINIMUM_REFUSED_INPUTS > battery.refusedCount) {
		problems.push(
			`a bateria recusou ${battery.refusedCount} entradas e o portao pede ao menos ${MINIMUM_REFUSED_INPUTS}`,
		)
	}

	return {
		ok: problems.length === 0,
		problems,
		reference: {
			accepted: validation.ok,
			depth: validation.summary?.depth ?? null,
			slabCount: validation.summary?.slabCount ?? null,
			nodeCount: validation.summary?.nodeCount ?? null,
			shadingClass: validation.summary?.shadingClass ?? null,
		},
		roundTrip: {
			ok: roundTrip.ok,
			identical: roundTrip.identical,
			fingerprint: roundTrip.fingerprint ?? null,
			byteLength: roundTrip.byteLength ?? null,
		},
		battery: {
			ok: battery.ok,
			total: battery.total,
			refusedCount: battery.refusedCount,
		},
	}
}


function createConsoleSurface() {
	return {
		reference: createReferenceLayeredTree,
		slabReference: createReferenceSlabTree,
		describe: describeMaterialTree,
		normalize: normalizeMaterialTree,
		validate: validateMaterialTree,
		serialize: serializeMaterialTree,
		deserialize: deserializeMaterialTree,
		fingerprint: materialTreeFingerprint,
		roundTrip: materialTreeRoundTrip,
		refusalBattery: runInvalidTreeBattery,
		gate: evaluateMaterialTreeGate,
	}
}

function publishConsoleSurface() {
	if (typeof window === "undefined" || !getSubstrateHostSurface()) return false
	getSubstrateHostSurface().materialTree = createConsoleSurface()
	return true
}


export function installPhase(installContext) {
	const gate = evaluateMaterialTreeGate()
	const telemetry = installContext?.telemetry

	installContext?.flags?.registerFlag?.({
		id: FLAG_ID,
		owner: PHASE_ID,
		description: "IR da arvore de material: normalizacao, validacao e texto canonico",
		defaultsByTier: { fraco: false, medio: true, forte: true },
	})

	for (const problem of gate.problems) telemetry?.error?.(TELEMETRY_SOURCE, problem)

	const consolePublished = publishConsoleSurface()

	return {
		summary: {
			phaseId: PHASE_ID,
			flagId: FLAG_ID,
			gateOk: gate.ok,
			depth: gate.reference.depth,
			slabCount: gate.reference.slabCount,
			nodeCount: gate.reference.nodeCount,
			fingerprint: gate.roundTrip.fingerprint,
			invalidInputsRefused: gate.battery.refusedCount,
			invalidInputsTotal: gate.battery.total,
			problems: gate.problems,
			consolePublished,
		},
	}
}
