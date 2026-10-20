import { getSubstrateHostSurface } from "../runtime/substrateHostSurface.js";


import { SB_GATES } from "../sbMaterialContract.js"
import {
	SB_NORMAL_BLEND_MODES,
	describeOppositeNormalBlend,
	findNormalBlendProblems,
} from "../sbNormalBlendCore.js"
import { describeOperatorAlgebra, findOperatorAlgebraProblems } from "../sbOperatorAlgebraCore.js"
import {
	SB_MIXING_MODES,
	applyHorizontalMixing,
	createReferenceMixingBranches,
	describeHorizontalMixing,
	findHorizontalMixingProblems,
} from "../sbHorizontalMixingCore.js"

export const PHASE_ID = "SB-F20"
export const FLAG_ID = "substrateHorizontalMixing"

const ENERGY_SWEEP_SAMPLE_COUNT = 11

function worstMixingEnergyDeviation(mode, branches) {
	let worstDeviation = 0
	for (let sampleIndex = 0; ENERGY_SWEEP_SAMPLE_COUNT > sampleIndex; sampleIndex += 1) {
		const weight = sampleIndex / (ENERGY_SWEEP_SAMPLE_COUNT - 1)
		const mixed = applyHorizontalMixing(branches.redMetal, branches.roughPlastic, weight, { mode })
		if (!mixed.ok) return Number.POSITIVE_INFINITY
		worstDeviation = Math.max(worstDeviation, mixed.report.energyDeviation)
	}
	return worstDeviation
}

function worstUncorrectedBlendDeviation(branches) {
	let worstDeviation = 0
	for (let sampleIndex = 0; ENERGY_SWEEP_SAMPLE_COUNT > sampleIndex; sampleIndex += 1) {
		const weight = sampleIndex / (ENERGY_SWEEP_SAMPLE_COUNT - 1)
		const mixed = applyHorizontalMixing(branches.redMetal, branches.roughPlastic, weight, {
			mode: SB_MIXING_MODES.blend,
		})
		if (!mixed.ok) continue
		worstDeviation = Math.max(worstDeviation, mixed.report.uncorrectedEnergyDeviation)
	}
	return worstDeviation
}


export function evaluateHorizontalMixingGate(options = {}) {
	const branches = options.branches ?? createReferenceMixingBranches()
	const normalBlendProblems = [
		...findNormalBlendProblems({ mode: SB_NORMAL_BLEND_MODES.spherical }),
		...findNormalBlendProblems({ mode: SB_NORMAL_BLEND_MODES.spherical, firstNormal: [0, 0, 1], secondNormal: [0, 0, -1] }),
		...findNormalBlendProblems({ mode: SB_NORMAL_BLEND_MODES.linear, firstNormal: [0, 0, 1], secondNormal: [0.6, 0, 0.8] }),
	]
	const algebraProblems = findOperatorAlgebraProblems({ ...options, branches })
	const mixingProblems = findHorizontalMixingProblems({ ...options, branches })
	const problems = [...normalBlendProblems, ...algebraProblems, ...mixingProblems]

	return {
		phaseId: PHASE_ID,
		ok: 0 === problems.length,
		problems,
		gates: {
			mixingEnergy: {
				limit: SB_GATES.maxMixingEnergyDeviation,
				worstDeviationInSumMode: worstMixingEnergyDeviation(SB_MIXING_MODES.sum, branches),
				worstDeviationInBlendMode: worstMixingEnergyDeviation(SB_MIXING_MODES.blend, branches),
				worstDeviationWithoutEnergySolve: worstUncorrectedBlendDeviation(branches),
			},
			operatorAlgebra: {
				limit: SB_GATES.maxOperatorAlgebraEnergyDeviation,
				associativityLevels: 3,
				problemCount: algebraProblems.length,
			},
			normalBlend: {
				problemCount: normalBlendProblems.length,
				oppositeNormals: describeOppositeNormalBlend(),
			},
		},
	}
}


export function createConsoleSurface() {
	return {
		phaseId: PHASE_ID,
		flagId: FLAG_ID,
		gate: () => evaluateHorizontalMixingGate(),
		mixing: (options) => describeHorizontalMixing(options),
		algebra: (options) => describeOperatorAlgebra(options),
		normals: (options) => findNormalBlendProblems(options),
		mix: (firstBranch, secondBranch, weight, options) =>
			applyHorizontalMixing(firstBranch, secondBranch, weight, options),
		branches: () => createReferenceMixingBranches(),
	}
}

function publishConsoleSurface() {
	const lab = typeof globalThis === "undefined" ? null : getSubstrateHostSurface()
	if (!lab) return false
	lab.horizontalMixing = createConsoleSurface()
	return true
}


export function installPhase(installContext = {}) {
	const { flags, telemetry } = installContext
	try {
		flags?.registerFlag({
			id: FLAG_ID,
			owner: PHASE_ID,
			description:
				"Horizontal mixing, Add e Weight: funde dois ramos por peso com blend esferico de normais e energia preservada.",
			defaultsByTier: { fraco: false, medio: true, forte: true },
		})
		telemetry?.closureBytes(PHASE_ID, 0)
		telemetry?.textureUnit(PHASE_ID, 0)

		const gate = evaluateHorizontalMixingGate()
		if (!gate.ok) {
			for (const problem of gate.problems) telemetry?.error(PHASE_ID, problem)
		}
		const consolePublished = publishConsoleSurface()
		const worstBlendDeviation = gate.gates.mixingEnergy.worstDeviationInBlendMode

		return {
			phaseId: PHASE_ID,
			ok: gate.ok,
			flagId: FLAG_ID,
			closureBytes: 0,
			textureUnits: 0,
			consolePublished,
			gate,
			summary: gate.ok
				? `SB-F20 ok: mistura, Add e Weight provados; pior desvio de energia no blend ${worstBlendDeviation.toExponential(2)} contra o teto ${SB_GATES.maxMixingEnergyDeviation}.`
				: `SB-F20 com ${gate.problems.length} problema(s): ${gate.problems[0]}`,
		}
	} catch (error) {
		const message = error?.message ?? String(error)
		telemetry?.error(PHASE_ID, `falha ao instalar: ${message}`)
		return {
			phaseId: PHASE_ID,
			ok: false,
			flagId: FLAG_ID,
			closureBytes: 0,
			textureUnits: 0,
			consolePublished: false,
			gate: null,
			summary: `SB-F20 nao instalou: ${message}`,
		}
	}
}
