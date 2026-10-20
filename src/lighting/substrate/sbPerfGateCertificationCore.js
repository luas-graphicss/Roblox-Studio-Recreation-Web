import { SB_TIER_NAMES } from "./sbMaterialContract.js"
import {
	buildDispatchPlan,
	closureKindCost,
	createStubClosureList,
	tierClosureCeiling,
} from "./sbClosureDispatchCore.js"
import { costPerClosureFromSamples, dispatchPlanCost } from "./sbClosureCostModelCore.js"
import {
	SB_MATERIAL_FAMILIES,
	createTopologyDescriptor,
	topologySignature,
	topologySignatureHash,
} from "./sbTopologySignatureCore.js"
import { PERF_GATE_PHASE_ID, evaluatePerfGates, summarizeFrameSamples } from "./sbPerfGateCore.js"


export const SB_CERTIFICATION_PIXEL_COUNT = 1920 * 1080
export const SB_CERTIFICATION_FRAMES_PER_SECOND = 60

const SURFACE_SHADING_CLASS = "surface"
const SLAB_KIND = "slab"
const HAIR_KIND = "hair"


function slabClosure(input) {
	return {
		bsdf: SLAB_KIND,
		layerIndex: input?.layerIndex ?? 0,
		closureCost: closureKindCost(SLAB_KIND),
		features: input?.features ?? [],
		coveredBy: input?.coveredBy ?? null,
		label: input?.label ?? "slab",
		path: input?.path ?? "root",
		roughness: input?.roughness ?? 0.4,
		albedo: input?.albedo ?? [0.5, 0.5, 0.5],
	}
}

function verticalLayeringOperator(depth) {
	return { operator: "verticalLayering", closureMath: "coverage", depth }
}

function horizontalMixingOperator(depth) {
	return { operator: "horizontalMixing", closureMath: "weightedSum", depth }
}


export function referenceTopologies() {
	return [
		{
			id: "singleSlab",
			label: "slab unico",
			topology: {
				shadingClass: SURFACE_SHADING_CLASS,
				closures: [slabClosure({ label: "base", path: "root/base" })],
				operators: [],
			},
		},
		{
			id: "twoLayerStack",
			label: "dois slabs empilhados",
			topology: {
				shadingClass: SURFACE_SHADING_CLASS,
				closures: [
					slabClosure({ layerIndex: 0, coveredBy: "coat", label: "base", path: "root/base" }),
					slabClosure({ layerIndex: 1, label: "coat", path: "root/coat" }),
				],
				operators: [verticalLayeringOperator(1)],
			},
		},
		{
			id: "threeLayerStack",
			label: "tres slabs empilhados",
			topology: {
				shadingClass: SURFACE_SHADING_CLASS,
				closures: [
					slabClosure({ layerIndex: 0, coveredBy: "middle", label: "base", path: "root/base" }),
					slabClosure({ layerIndex: 1, coveredBy: "coat", label: "middle", path: "root/middle" }),
					slabClosure({ layerIndex: 2, label: "coat", path: "root/coat" }),
				],
				operators: [verticalLayeringOperator(1), verticalLayeringOperator(2)],
			},
		},
		{
			id: "fuzzSlab",
			label: "slab com fuzz",
			topology: {
				shadingClass: SURFACE_SHADING_CLASS,
				closures: [slabClosure({ features: ["fuzz"], label: "tecido", path: "root/tecido" })],
				operators: [],
			},
		},
		{
			id: "horizontalMix",
			label: "mistura horizontal de dois slabs",
			topology: {
				shadingClass: SURFACE_SHADING_CLASS,
				closures: [
					slabClosure({ layerIndex: 0, label: "esquerda", path: "root/esquerda" }),
					slabClosure({ layerIndex: 0, label: "direita", path: "root/direita" }),
				],
				operators: [horizontalMixingOperator(1)],
			},
		},
		{
			id: "hairFiber",
			label: "fibra de cabelo",
			topology: {
				shadingClass: SURFACE_SHADING_CLASS,
				closures: [
					{
						bsdf: HAIR_KIND,
						layerIndex: 0,
						closureCost: closureKindCost(HAIR_KIND),
						features: [],
						coveredBy: null,
						label: "fibra",
						path: "root/fibra",
					},
				],
				operators: [],
			},
		},
	]
}


export function referencePermutations() {
	const permutations = []
	for (const materialFamily of SB_MATERIAL_FAMILIES) {
		for (const topologyEntry of referenceTopologies()) {
			permutations.push({
				id: materialFamily + ":" + topologyEntry.id,
				label: topologyEntry.label + " em " + materialFamily,
				materialFamily,
				topology: topologyEntry.topology,
			})
		}
	}
	return permutations
}


export function referenceDispatchPlanForTier(tierName) {
	return buildDispatchPlan({
		tierName,
		closures: createStubClosureList({ closureCount: tierClosureCeiling(tierName), kind: SLAB_KIND }),
	})
}

export function referenceBytesPerPixelByTier() {
	return Object.fromEntries(
		SB_TIER_NAMES.map((tierName) => [tierName, referenceDispatchPlanForTier(tierName).bytesPerPixel]),
	)
}


export function referenceDispatchCostByTier() {
	return SB_TIER_NAMES.map((tierName) => {
		const plan = referenceDispatchPlanForTier(tierName)
		return {
			tierName,
			closureCeiling: plan.closureCeiling,
			bytesPerPixel: plan.bytesPerPixel,
			byteCeiling: plan.byteCeiling,
			withinByteCeiling: plan.withinByteCeiling,
			declaredCost: dispatchPlanCost(plan),
		}
	})
}


export function costPerClosureByTier(frameSamplesByTier) {
	return Object.fromEntries(
		SB_TIER_NAMES.map((tierName) => [tierName, costPerClosureFromSamples(frameSamplesByTier?.[tierName])]),
	)
}

function programKeyHashOf(topology) {
	return topologySignatureHash(topologySignature(createTopologyDescriptor(topology)))
}


export function certifyProgramKeyStability() {
	const [firstEntry, secondEntry] = referenceTopologies()
	const baseTopology = firstEntry.topology
	const valueMutatedTopology = {
		...baseTopology,
		closures: baseTopology.closures.map((closure) => ({
			...closure,
			roughness: 0.93,
			albedo: [0.02, 0.71, 0.13],
			label: "outro nome",
			path: "outro/endereco",
		})),
	}

	const baseHash = programKeyHashOf(baseTopology)
	const valueMutatedHash = programKeyHashOf(valueMutatedTopology)
	const structureMutatedHash = programKeyHashOf(secondEntry.topology)

	const problems = []
	if (valueMutatedHash !== baseHash) {
		problems.push(
			"valor autorado mudou a chave de programa: " + baseHash + " virou " + valueMutatedHash,
		)
	}
	if (structureMutatedHash === baseHash) {
		problems.push("estrutura diferente reaproveitou a chave " + baseHash)
	}

	const distinctHashes = new Set(referenceTopologies().map((entry) => programKeyHashOf(entry.topology)))
	if (distinctHashes.size !== referenceTopologies().length) {
		problems.push(
			"a bateria declara " +
				referenceTopologies().length +
				" formas, mas elas colapsam em " +
				distinctHashes.size +
				" chaves",
		)
	}

	return {
		ok: problems.length === 0,
		baseHash,
		valueMutatedHash,
		structureMutatedHash,
		distinctHashCount: distinctHashes.size,
		problems,
	}
}


export function certifyPerfGates(input = {}) {
	const frameSamplesByTier = input?.frameSamplesByTier ?? {}
	const costMeasurements = costPerClosureByTier(frameSamplesByTier)
	const gates = evaluatePerfGates({
		frameSamplesByTier,
		costMeasurementByTier: costMeasurements,
		bytesPerPixelByTier: referenceBytesPerPixelByTier(),
		permutations: referencePermutations(),
		idleOverhead: input?.idleOverhead ?? null,
		pixelCount: Number.isFinite(input?.pixelCount) ? input.pixelCount : SB_CERTIFICATION_PIXEL_COUNT,
		framesPerSecond: Number.isFinite(input?.framesPerSecond)
			? input.framesPerSecond
			: SB_CERTIFICATION_FRAMES_PER_SECOND,
	})
	const stability = certifyProgramKeyStability()
	const problems = [...gates.problems, ...stability.problems]

	return {
		phaseId: PERF_GATE_PHASE_ID,
		ok: problems.length === 0,
		complete: gates.complete && stability.ok,
		gates,
		stability,
		topologyCount: referenceTopologies().length,
		familyCount: SB_MATERIAL_FAMILIES.length,
		permutationCount: referencePermutations().length,
		dispatchByTier: referenceDispatchCostByTier(),
		costPerClosureByTier: costMeasurements,
		sampleSummaryByTier: Object.fromEntries(
			SB_TIER_NAMES.map((tierName) => [tierName, summarizeFrameSamples(frameSamplesByTier?.[tierName])]),
		),
		pending: gates.pending,
		problems,
	}
}
