import { getSubstrateHostSurface } from "../runtime/substrateHostSurface.js";


import { SB_GATES, SB_MAX_CLOSURES_PER_PIXEL } from "../sbMaterialContract.js"
import { createReferenceLayeredTree, createReferenceSlabTree } from "../sbMaterialTreeCore.js"
import { materialTreeFingerprint } from "../sbTreeSerializationCore.js"
import {
	compileMaterialTopology,
	describeCompiledTopology,
	evaluateTopologyBudget,
	collectBlendCandidates,
	topologyOrderProblems,
	closureFeatures,
	SB_CLOSURE_FEATURES,
} from "../sbTopologyCompilerCore.js"
import {
	SB_MATERIAL_FAMILIES,
	SB_DEFAULT_MATERIAL_FAMILY,
	createTopologyDescriptor,
	topologySignature,
	topologySignatureHash,
	createProgramKeyRegistry,
} from "../sbTopologySignatureCore.js"
import {
	runTopologyPermutationBattery,
	createPrunedBranchTree,
	createBaselineTree,
	SB_TOPOLOGY_PERMUTATION_BATTERY,
} from "../sbTopologyPermutationBattery.js"

const PHASE_ID = "SB-F6"
const FLAG_ID = "SubstrateTopologyCompiler"
const PASS_NAME = "materialTopologyResolve"
const TELEMETRY_SOURCE = "sbPhaseF6TopologyCompiler"

const REFERENCE_EXPECTED_CLOSURES = 4
const REFERENCE_EXPECTED_DEPTH = 3
const PRUNED_TREE_EXPECTED_CLOSURES = 1


export function evaluateTopologyCompilerGate(options = {}) {
	const materialFamily = options.materialFamily ?? SB_DEFAULT_MATERIAL_FAMILY
	const compileOptions = { tier: options.tier, materialFamily }
	const problems = []

	const reference = compileMaterialTopology(createBaselineTree(), compileOptions)
	for (const refusal of reference.refusals) {
		problems.push(`arvore de referencia recusada em ${refusal.path}: ${refusal.reason}`)
	}
	if (reference.budget.closureCount !== REFERENCE_EXPECTED_CLOSURES) {
		problems.push(
			`a referencia deveria compilar ${REFERENCE_EXPECTED_CLOSURES} closures e compilou ${reference.budget.closureCount}`,
		)
	}
	if (reference.treeSummary?.depth !== REFERENCE_EXPECTED_DEPTH) {
		problems.push(`a referencia deveria ter ${REFERENCE_EXPECTED_DEPTH} niveis e tem ${reference.treeSummary?.depth}`)
	}
	if (reference.orderProblems.length > 0) problems.push(...reference.orderProblems)


	const recompiled = compileMaterialTopology(createBaselineTree(), compileOptions)
	const stableSignature = recompiled.signature === reference.signature
	const stableDescriptor = topologySignature(recompiled.descriptor) === topologySignature(reference.descriptor)
	if (!stableSignature) problems.push("a assinatura mudou entre duas execucoes da mesma arvore")
	if (!stableDescriptor) problems.push("o descritor de topologia mudou entre duas execucoes da mesma arvore")

	const battery = runTopologyPermutationBattery(compileOptions)
	if (!battery.ok) problems.push(...battery.problems)


	const pruned = compileMaterialTopology(createPrunedBranchTree(), compileOptions)
	if (pruned.budget.closureCount !== PRUNED_TREE_EXPECTED_CLOSURES) {
		problems.push(
			`o ramo com peso zero deveria deixar ${PRUNED_TREE_EXPECTED_CLOSURES} closure e deixou ${pruned.budget.closureCount}`,
		)
	}
	if (pruned.prunedBranches.length === 0) problems.push("o ramo com peso zero nao foi reportado como podado")


	const programRegistry = createProgramKeyRegistry()
	for (const family of SB_MATERIAL_FAMILIES) {
		for (const signatureHash of battery.distinctSignatureHashes) programRegistry.register(family, signatureHash)
	}
	const programReport = programRegistry.report(SB_GATES.maxProgramsPerMaterialFamily)
	for (const family of programReport.overBudgetFamilies) {
		problems.push(
			`a familia "${family.materialFamily}" ganhou ${family.programCount} programas e o teto e ${family.ceiling}`,
		)
	}

	return {
		ok: problems.length === 0,
		problems,
		reference: {
			ok: reference.ok,
			closureCount: reference.budget.closureCount,
			byteCount: reference.budget.byteCount,
			closureCeiling: reference.budget.closureCeiling,
			byteCeiling: reference.budget.byteCeiling,
			withinBudget: reference.budget.withinBudget,
			requiresSimplification: reference.requiresSimplification,
			simplifiable: reference.simplifiable,
			blendCandidateCount: reference.blendCandidates.length,
			depth: reference.treeSummary?.depth ?? null,
			signatureHash: reference.signatureHash,
			programKey: reference.programKey,
		},
		stability: { signature: stableSignature, descriptor: stableDescriptor },
		battery: {
			ok: battery.ok,
			total: battery.total,
			matchedCount: battery.matchedCount,
			sameSignatureCount: battery.sameSignatureCount,
			distinctSignatureCount: battery.distinctSignatureCount,
		},
		pruning: {
			closureCount: pruned.budget.closureCount,
			prunedCount: pruned.prunedBranches.length,
		},
		programs: programReport,
	}
}


function createTopologyResolver(installContext) {
	let selectedTree = createReferenceLayeredTree()
	let selectedTreeRevision = 0
	let cacheKey = null
	let cachedTopology = null

	function compileSelectedTree(tierName, materialFamily) {
		const nextCacheKey = `${selectedTreeRevision}|${tierName}|${materialFamily}`
		if (cachedTopology && cacheKey === nextCacheKey) return cachedTopology
		const compiled = compileMaterialTopology(selectedTree, { tier: tierName, materialFamily })
		cacheKey = nextCacheKey
		cachedTopology = compiled
		const telemetry = installContext?.telemetry
		telemetry?.topology?.(describeCompiledTopology(compiled))
		for (const refusal of compiled.refusals) {
			telemetry?.error?.(TELEMETRY_SOURCE, `${refusal.path}: ${refusal.reason}`)
		}
		return compiled
	}

	return {
		select(rawRootNode) {
			selectedTree = rawRootNode
			selectedTreeRevision += 1
			cachedTopology = null
			return describeCompiledTopology(compileSelectedTree("forte", SB_DEFAULT_MATERIAL_FAMILY))
		},
		selectedFingerprint() {
			return materialTreeFingerprint(selectedTree)
		},
		resolve(tierName, materialFamily) {
			return compileSelectedTree(tierName ?? "forte", materialFamily ?? SB_DEFAULT_MATERIAL_FAMILY)
		},
		last() {
			return cachedTopology
		},
	}
}


function createConsoleSurface(resolver) {
	return {
		compile: compileMaterialTopology,
		describe: (rawRootNode, options) => describeCompiledTopology(compileMaterialTopology(rawRootNode, options)),
		reference: createBaselineTree,
		slabReference: createReferenceSlabTree,
		prunedReference: createPrunedBranchTree,
		budget: evaluateTopologyBudget,
		blendCandidates: collectBlendCandidates,
		orderProblems: topologyOrderProblems,
		features: closureFeatures,
		featureNames: () => Object.values(SB_CLOSURE_FEATURES),
		descriptor: createTopologyDescriptor,
		signature: topologySignature,
		signatureHash: topologySignatureHash,
		programRegistry: createProgramKeyRegistry,
		families: () => [...SB_MATERIAL_FAMILIES],
		permutationBattery: runTopologyPermutationBattery,
		permutationList: () =>
			SB_TOPOLOGY_PERMUTATION_BATTERY.map((entry) => ({
				id: entry.id,
				description: entry.description,
				expectSameSignature: entry.expectSameSignature,
			})),
		select: resolver.select,
		selected: resolver.selectedFingerprint,
		last: () => describeCompiledTopology(resolver.last()),
		gate: evaluateTopologyCompilerGate,
	}
}

function publishConsoleSurface(resolver) {
	if (typeof window === "undefined" || !getSubstrateHostSurface()) return false
	getSubstrateHostSurface().topologyCompiler = createConsoleSurface(resolver)
	return true
}


export function installPhase(installContext) {
	const gate = evaluateTopologyCompilerGate()
	const telemetry = installContext?.telemetry
	const resolver = createTopologyResolver(installContext)

	installContext?.flags?.registerFlag?.({
		id: FLAG_ID,
		owner: PHASE_ID,
		description: "Compilador de topologia: arvore em lista de closures, com assinatura de permutacao",
		defaultsByTier: { fraco: false, medio: true, forte: true },
	})

	const passRegistration = installContext?.passes?.registerPass?.(PASS_NAME, {
		owner: PHASE_ID,
		execute(passContext) {
			if (installContext?.materialRuntime) return installContext.materialRuntime.resolveFrame(passContext)
			const tierName = passContext?.tier
			const flagActive = installContext?.flags?.isFlagActive?.(FLAG_ID, tierName) !== false
			if (!flagActive) return passContext
			const materialFamily = installContext?.materials?.currentPath?.() ?? SB_DEFAULT_MATERIAL_FAMILY
			const topology = resolver.resolve(tierName, materialFamily)
			if (passContext) passContext.substrateTopology = topology
			return passContext
		},
	})


	resolver.resolve("forte", SB_DEFAULT_MATERIAL_FAMILY)

	for (const problem of gate.problems) telemetry?.error?.(TELEMETRY_SOURCE, problem)

	const consolePublished = publishConsoleSurface(resolver)

	return {
		summary: {
			phaseId: PHASE_ID,
			flagId: FLAG_ID,
			passName: PASS_NAME,
			passAccepted: passRegistration?.accepted ?? false,
			passRefusalReason: passRegistration?.reason ?? null,
			gateOk: gate.ok,
			closureCount: gate.reference.closureCount,
			byteCount: gate.reference.byteCount,
			closureCeiling: gate.reference.closureCeiling,
			byteCeiling: gate.reference.byteCeiling,
			maximumClosuresPerPixel: SB_MAX_CLOSURES_PER_PIXEL,
			requiresSimplification: gate.reference.requiresSimplification,
			blendCandidateCount: gate.reference.blendCandidateCount,
			signatureHash: gate.reference.signatureHash,
			programKey: gate.reference.programKey,
			permutationsChecked: gate.battery.total,
			permutationsMatched: gate.battery.matchedCount,
			programsPerFamily: gate.programs.countsByFamily,
			programCeiling: gate.programs.ceiling,
			problems: gate.problems,
			consolePublished,
		},
	}
}
