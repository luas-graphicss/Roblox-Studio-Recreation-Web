import { SB_GATES, SB_TIER_NAMES, tierBytesPerPixel, tierDefaults } from "./sbMaterialContract.js"
import { resolveTierName, tierClosureCeiling } from "./sbClosureDispatchCore.js"
import {
	SB_DEFAULT_MATERIAL_FAMILY,
	createProgramKeyRegistry,
	createTopologyDescriptor,
	isKnownMaterialFamily,
	topologySignature,
	topologySignatureHash,
} from "./sbTopologySignatureCore.js"

export const PERF_GATE_PHASE_ID = "SB-F36"


export const SB_PERF_GATE_IDS = Object.freeze({
	closureScaling: "closureScaling",
	programCensus: "programCensus",
	idleOverhead: "idleOverhead",
	materialBufferBandwidth: "materialBufferBandwidth",
})


export const SB_PERF_VERDICTS = Object.freeze({
	pass: "pass",
	fail: "fail",
	unmeasured: "unmeasured",
	notApplicable: "notApplicable",
})


export const SB_PERF_NUMBER_SOURCES = Object.freeze({
	measured: "medido",
	projected: "projetado",
	missing: "sem medicao",
})

export const SB_BYTES_PER_MEGABYTE = 1024 * 1024


export const SB_FRAME_SAMPLE_MILLISECONDS_CEILING = 1000

function formatMilliseconds(value) {
	return Number.isFinite(value) ? value.toFixed(3) : "sem numero"
}


export function tierFrameBudgetMilliseconds(tierName) {
	const budgetMilliseconds = tierDefaults(resolveTierName(tierName)).frameBudgetMilliseconds
	return Number.isFinite(budgetMilliseconds) ? budgetMilliseconds : null
}


export function tierStartsOnLegacy(tierName) {
	return tierDefaults(resolveTierName(tierName)).substrateEnabled !== true
}


export function closureCountsForTier(tierName) {
	const closureCeiling = tierClosureCeiling(tierName)
	const closureCounts = []
	for (let closureCount = 1; closureCeiling >= closureCount; closureCount += 1) {
		closureCounts.push(closureCount)
	}
	return closureCounts
}

function byTier(readValue) {
	return Object.fromEntries(SB_TIER_NAMES.map((tierName) => [tierName, readValue(tierName)]))
}


export function perfGateCeilings() {
	return {
		phaseId: PERF_GATE_PHASE_ID,
		frameBudgetMillisecondsByTier: byTier(tierFrameBudgetMilliseconds),
		closureCeilingByTier: byTier(tierClosureCeiling),
		bytesPerPixelCeilingByTier: byTier(tierBytesPerPixel),
		startsOnLegacyByTier: byTier(tierStartsOnLegacy),
		maxProgramsPerMaterialFamily: SB_GATES.maxProgramsPerMaterialFamily,
		maxIdleOverheadMilliseconds: SB_GATES.maxIdleOverheadMilliseconds,
	}
}


function usableFrameSamples(rawSamples) {
	if (!Array.isArray(rawSamples)) return []
	return rawSamples
		.map((sample) => ({
			closureCount: Number(sample?.closureCount),
			milliseconds: Number(sample?.milliseconds),
		}))
		.filter((sample) => Number.isInteger(sample.closureCount) && sample.closureCount > 0)
		.filter((sample) => Number.isFinite(sample.milliseconds) && sample.milliseconds > 0)
		.filter((sample) => SB_FRAME_SAMPLE_MILLISECONDS_CEILING > sample.milliseconds)
}


export function summarizeFrameSamples(rawSamples) {
	const samples = usableFrameSamples(rawSamples)
	const millisecondsByClosureCount = new Map()
	for (const sample of samples) {
		const millisecondsList = millisecondsByClosureCount.get(sample.closureCount) ?? []
		millisecondsList.push(sample.milliseconds)
		millisecondsByClosureCount.set(sample.closureCount, millisecondsList)
	}
	const byClosureCount = Array.from(millisecondsByClosureCount.entries())
		.sort((left, right) => left[0] - right[0])
		.map(([closureCount, millisecondsList]) => ({
			closureCount,
			sampleCount: millisecondsList.length,
			meanMilliseconds: millisecondsList.reduce((total, value) => total + value, 0) / millisecondsList.length,
			worstMilliseconds: millisecondsList.reduce((worst, value) => (value > worst ? value : worst), 0),
		}))
	const offeredSampleCount = Array.isArray(rawSamples) ? rawSamples.length : 0
	return {
		sampleCount: samples.length,
		refusedSampleCount: offeredSampleCount - samples.length,
		byClosureCount,
	}
}


export function projectedFrameMilliseconds(costMeasurement, closureCount) {
	if (costMeasurement?.measured !== true) return null
	if (!Number.isInteger(closureCount) || 1 > closureCount) return null
	const projectedMilliseconds =
		costMeasurement.baselineMilliseconds + costMeasurement.perClosureMilliseconds * closureCount
	return Number.isFinite(projectedMilliseconds) ? projectedMilliseconds : null
}


export function evaluateClosureScalingGate(input) {
	const tierName = resolveTierName(input?.tierName)
	const budgetMilliseconds = tierFrameBudgetMilliseconds(tierName)
	const costMeasurement = input?.costMeasurement ?? null
	const sampleSummary = summarizeFrameSamples(input?.samples)

	const byClosureCount = closureCountsForTier(tierName).map((closureCount) => {
		const measured = sampleSummary.byClosureCount.find((entry) => entry.closureCount === closureCount) ?? null
		const projectedMilliseconds = projectedFrameMilliseconds(costMeasurement, closureCount)
		const milliseconds = measured === null ? projectedMilliseconds : measured.worstMilliseconds
		const source =
			measured !== null
				? SB_PERF_NUMBER_SOURCES.measured
				: projectedMilliseconds === null
					? SB_PERF_NUMBER_SOURCES.missing
					: SB_PERF_NUMBER_SOURCES.projected
		return {
			closureCount,
			source,
			sampleCount: measured?.sampleCount ?? 0,
			meanMilliseconds: measured?.meanMilliseconds ?? null,
			milliseconds,
			headroomMilliseconds: milliseconds === null ? null : budgetMilliseconds - milliseconds,
			withinBudget: milliseconds === null ? null : budgetMilliseconds >= milliseconds,
		}
	})

	const overBudget = byClosureCount.filter((entry) => entry.withinBudget === false)
	const withoutNumber = byClosureCount.filter((entry) => entry.milliseconds === null)
	const worstEntry = byClosureCount
		.filter((entry) => entry.milliseconds !== null)
		.reduce((worst, entry) => (worst === null || entry.milliseconds > worst.milliseconds ? entry : worst), null)

	let verdict = SB_PERF_VERDICTS.pass
	let reason = null
	if (overBudget.length > 0) {
		verdict = SB_PERF_VERDICTS.fail
		reason =
			"tier " +
			tierName +
			": " +
			overBudget.length +
			" contagem(ns) de closure acima do orcamento de " +
			formatMilliseconds(budgetMilliseconds) +
			" ms, pior caso " +
			worstEntry.closureCount +
			" closure(s) em " +
			formatMilliseconds(worstEntry.milliseconds) +
			" ms"
	} else if (withoutNumber.length > 0) {
		verdict = SB_PERF_VERDICTS.unmeasured
		const missingCounts = withoutNumber.map((entry) => entry.closureCount).join(", ")
		const legacyHint = tierStartsOnLegacy(tierName)
			? " (tier nasce no legado: so mede com a flag forcada)"
			: ""
		reason =
			"tier " +
			tierName +
			" sem numero para " +
			withoutNumber.length +
			" contagem(ns) de closure: " +
			missingCounts +
			" -- " +
			(costMeasurement?.reason ?? "nenhuma amostra de quadro chegou") +
			legacyHint
	}

	return {
		gateId: SB_PERF_GATE_IDS.closureScaling,
		tierName,
		budgetMilliseconds,
		closureCeiling: tierClosureCeiling(tierName),
		startsOnLegacy: tierStartsOnLegacy(tierName),
		byClosureCount,
		sampleCount: sampleSummary.sampleCount,
		refusedSampleCount: sampleSummary.refusedSampleCount,
		worstClosureCount: worstEntry?.closureCount ?? null,
		worstMilliseconds: worstEntry?.milliseconds ?? null,
		perClosureMilliseconds: costMeasurement?.measured === true ? costMeasurement.perClosureMilliseconds : null,
		verdict,
		reason,
	}
}


export function censusProgramKeys(permutations) {
	const registry = createProgramKeyRegistry()
	const entries = []
	const problems = []

	for (const permutation of Array.isArray(permutations) ? permutations : []) {
		const declaredFamily = permutation?.materialFamily
		const familyIsKnown = isKnownMaterialFamily(declaredFamily)
		const materialFamily = familyIsKnown ? declaredFamily : SB_DEFAULT_MATERIAL_FAMILY
		if (!familyIsKnown) {
			problems.push(
				"familia de material desconhecida: " +
					String(declaredFamily) +
					" (contada em " +
					SB_DEFAULT_MATERIAL_FAMILY +
					")",
			)
		}
		const descriptor = createTopologyDescriptor(permutation?.topology)
		const signatureHash = topologySignatureHash(topologySignature(descriptor))
		const registration = registry.register(materialFamily, signatureHash)
		entries.push({
			id: permutation?.id ?? null,
			label: permutation?.label ?? null,
			materialFamily,
			signatureHash,
			programKey: registration.programKey,
			alreadyKnown: registration.alreadyKnown,
		})
	}

	return {
		entries,
		problems,
		distinctProgramCount: new Set(entries.map((entry) => entry.programKey)).size,
		report: registry.report(SB_GATES.maxProgramsPerMaterialFamily),
	}
}


export function evaluateProgramCensusGate(input) {
	const census = censusProgramKeys(input?.permutations)
	const ceiling = census.report.ceiling
	const familyEntries = Object.entries(census.report.countsByFamily)
	const worstFamilyEntry = familyEntries.reduce(
		(worst, entry) => (worst === null || entry[1] > worst[1] ? entry : worst),
		null,
	)

	let verdict = SB_PERF_VERDICTS.pass
	let reason = null
	if (census.entries.length === 0) {
		verdict = SB_PERF_VERDICTS.unmeasured
		reason = "nenhuma permutacao foi apresentada ao censo"
	} else if (!census.report.ok) {
		verdict = SB_PERF_VERDICTS.fail
		reason =
			"familia(s) acima do teto de " +
			ceiling +
			" programas: " +
			census.report.overBudgetFamilies
				.map((family) => family.materialFamily + " com " + family.programCount)
				.join(", ")
	} else if (census.problems.length > 0) {
		verdict = SB_PERF_VERDICTS.fail
		reason = census.problems[0]
	}

	return {
		gateId: SB_PERF_GATE_IDS.programCensus,
		ceiling,
		permutationCount: census.entries.length,
		distinctProgramCount: census.distinctProgramCount,
		familyCount: census.report.familyCount,
		countsByFamily: census.report.countsByFamily,
		overBudgetFamilies: census.report.overBudgetFamilies,
		worstFamily:
			worstFamilyEntry === null ? null : { materialFamily: worstFamilyEntry[0], programCount: worstFamilyEntry[1] },
		entries: census.entries,
		problems: census.problems,
		verdict,
		reason,
	}
}


export function evaluateIdleOverheadGate(input) {
	const ceilingMilliseconds = SB_GATES.maxIdleOverheadMilliseconds
	const flagsOffMilliseconds = Number(input?.flagsOffMilliseconds)
	const legacyBaselineMilliseconds = Number(input?.legacyBaselineMilliseconds)
	const bothMeasured =
		Number.isFinite(flagsOffMilliseconds) &&
		flagsOffMilliseconds > 0 &&
		Number.isFinite(legacyBaselineMilliseconds) &&
		legacyBaselineMilliseconds > 0

	if (!bothMeasured) {
		return {
			gateId: SB_PERF_GATE_IDS.idleOverhead,
			ceilingMilliseconds,
			flagsOffMilliseconds: null,
			legacyBaselineMilliseconds: null,
			overheadMilliseconds: null,
			headroomMilliseconds: null,
			verdict: SB_PERF_VERDICTS.unmeasured,
			reason:
				"faltam os dois numeros medidos: ms por quadro no legado e ms por quadro com todas as flags desligadas",
		}
	}

	const overheadMilliseconds = flagsOffMilliseconds - legacyBaselineMilliseconds
	const withinCeiling = ceilingMilliseconds >= overheadMilliseconds
	return {
		gateId: SB_PERF_GATE_IDS.idleOverhead,
		ceilingMilliseconds,
		flagsOffMilliseconds,
		legacyBaselineMilliseconds,
		overheadMilliseconds,
		headroomMilliseconds: ceilingMilliseconds - overheadMilliseconds,
		verdict: withinCeiling ? SB_PERF_VERDICTS.pass : SB_PERF_VERDICTS.fail,
		reason: withinCeiling
			? null
			: "overhead ocioso de " +
				formatMilliseconds(overheadMilliseconds) +
				" ms passou do teto de " +
				formatMilliseconds(ceilingMilliseconds) +
				" ms",
	}
}


export function evaluateMaterialBufferBandwidthGate(input) {
	const tierName = resolveTierName(input?.tierName)
	const ceilingBytesPerPixel = tierBytesPerPixel(tierName)
	const bytesPerPixel = Number(input?.bytesPerPixel)
	const pixelCount = Number(input?.pixelCount)
	const framesPerSecond = Number(input?.framesPerSecond)
	const bandwidthIsDerivable =
		Number.isFinite(bytesPerPixel) &&
		bytesPerPixel > 0 &&
		Number.isFinite(pixelCount) &&
		pixelCount > 0 &&
		Number.isFinite(framesPerSecond) &&
		framesPerSecond > 0
	const megabytesPerSecond = bandwidthIsDerivable
		? (bytesPerPixel * pixelCount * framesPerSecond) / SB_BYTES_PER_MEGABYTE
		: null

	const baseReport = {
		gateId: SB_PERF_GATE_IDS.materialBufferBandwidth,
		tierName,
		ceilingBytesPerPixel,
		bytesPerPixel: Number.isFinite(bytesPerPixel) ? bytesPerPixel : null,
		pixelCount: bandwidthIsDerivable ? pixelCount : null,
		framesPerSecond: bandwidthIsDerivable ? framesPerSecond : null,
		megabytesPerSecond,
		bandwidthCeilingDeclaredByContract: false,
	}

	if (tierStartsOnLegacy(tierName)) {
		return {
			...baseReport,
			headroomBytesPerPixel: null,
			verdict: SB_PERF_VERDICTS.notApplicable,
			reason:
				"tier " +
				tierName +
				" nasce no legado: nenhum byte de buffer de material do Substrate sobe neste tier",
		}
	}

	if (!Number.isFinite(bytesPerPixel) || 0 >= bytesPerPixel) {
		return {
			...baseReport,
			headroomBytesPerPixel: null,
			verdict: SB_PERF_VERDICTS.unmeasured,
			reason: "tier " + tierName + " sem bytes por pixel do plano de despacho",
		}
	}

	const withinCeiling = ceilingBytesPerPixel >= bytesPerPixel
	return {
		...baseReport,
		headroomBytesPerPixel: ceilingBytesPerPixel - bytesPerPixel,
		verdict: withinCeiling ? SB_PERF_VERDICTS.pass : SB_PERF_VERDICTS.fail,
		reason: withinCeiling
			? null
			: "tier " +
				tierName +
				": " +
				bytesPerPixel +
				" bytes por pixel passaram do teto de " +
				ceilingBytesPerPixel,
	}
}

function gateLabel(gate) {
	return gate.tierName ? gate.gateId + " (" + gate.tierName + ")" : gate.gateId
}


export function evaluatePerfGates(input) {
	const frameSamplesByTier = input?.frameSamplesByTier ?? {}
	const costMeasurementByTier = input?.costMeasurementByTier ?? {}
	const bytesPerPixelByTier = input?.bytesPerPixelByTier ?? {}

	const closureScaling = SB_TIER_NAMES.map((tierName) =>
		evaluateClosureScalingGate({
			tierName,
			samples: frameSamplesByTier[tierName],
			costMeasurement: costMeasurementByTier[tierName] ?? input?.costMeasurement ?? null,
		}),
	)
	const programCensus = evaluateProgramCensusGate({ permutations: input?.permutations })
	const idleOverhead = evaluateIdleOverheadGate(input?.idleOverhead)
	const materialBufferBandwidth = SB_TIER_NAMES.map((tierName) =>
		evaluateMaterialBufferBandwidthGate({
			tierName,
			bytesPerPixel: bytesPerPixelByTier[tierName],
			pixelCount: input?.pixelCount,
			framesPerSecond: input?.framesPerSecond,
		}),
	)

	const gates = [...closureScaling, programCensus, idleOverhead, ...materialBufferBandwidth]
	const failedGates = gates.filter((gate) => gate.verdict === SB_PERF_VERDICTS.fail)
	const unmeasuredGates = gates.filter((gate) => gate.verdict === SB_PERF_VERDICTS.unmeasured)

	return {
		phaseId: PERF_GATE_PHASE_ID,
		ceilings: perfGateCeilings(),
		closureScaling,
		programCensus,
		idleOverhead,
		materialBufferBandwidth,
		gates,
		ok: failedGates.length === 0,
		complete: failedGates.length === 0 && unmeasuredGates.length === 0,
		problems: failedGates.map((gate) => gateLabel(gate) + ": " + (gate.reason ?? "reprovado sem motivo escrito")),
		pending: unmeasuredGates.map((gate) => gateLabel(gate) + ": " + (gate.reason ?? "sem medicao")),
	}
}
