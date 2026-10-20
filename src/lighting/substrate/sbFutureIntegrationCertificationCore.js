import { SB_TIER_NAMES, tierDefaults } from "./sbMaterialContract.js"
import {
	SB_FUTURE_INTEGRATION_FLAG_ID,
	SB_FUTURE_INTEGRATION_PHASE_ID,
	SB_INTEGRATION_MODES,
	SB_RENDER_BRANCH_IDS,
	SB_RENDER_TECHNOLOGY_IDS,
	branchCoverageProblems,
	createBranchPatchPlan,
	evaluateBranchPixelParity,
	evaluateBranchRoleParity,
	evaluateBranchTextParity,
	isSubstrateCapableTechnology,
	materialPathsForBranch,
	resolveFutureIntegrationGate,
	resolveLegacyMaterialLiteRetirement,
	rolesByBranchFromPlan,
} from "./sbFutureIntegrationCore.js"
import {
	SB_FUTURE_INTEGRATION_CODE,
	SB_FUTURE_INTEGRATION_DECLARATIONS_BY_BRANCH,
	futureIntegrationGlslProblems,
} from "./sbFutureIntegrationGlsl.js"


export const SB_CERTIFICATION_TIER_NAME = "forte"


export const SB_CERTIFICATION_FLAG_OVERRIDES = Object.freeze([null, true, false])


export function createPatchHarnessDouble() {
	const patchesById = new Map()
	const reservedSlotsByKey = new Map()
	const flagOverridesById = new Map()
	let programGeneration = 0

	function isFlagActive(flagId, tierName) {
		if (flagOverridesById.has(flagId)) return flagOverridesById.get(flagId) === true
		return tierDefaults(tierName).substrateEnabled === true
	}

	return {
		registerPatch(request) {
			const slotKey = request.anchor + ":" + request.order
			const slotOwnerId = reservedSlotsByKey.get(slotKey)
			if (slotOwnerId && slotOwnerId !== request.id) {
				return { accepted: false, reason: "ordem ja reservada por " + slotOwnerId }
			}
			reservedSlotsByKey.set(slotKey, request.id)
			patchesById.set(request.id, { ...request })
			programGeneration += 1
			return { accepted: true, id: request.id }
		},

		checkAnchor(three, anchorId) {
			const chunkSource = three?.ShaderChunk?.[anchorId]
			const present = typeof chunkSource === "string" && chunkSource.length > 0
			return { anchorId, present, reason: present ? null : "chunk ausente: " + anchorId }
		},

		setFlag(flagId, overrideValue) {
			if (overrideValue === null || overrideValue === undefined) flagOverridesById.delete(flagId)
			else flagOverridesById.set(flagId, overrideValue === true)
			return flagId
		},

		flagState(flagId, tierName) {
			return {
				id: flagId,
				on: isFlagActive(flagId, tierName),
				override: flagOverridesById.has(flagId) ? flagOverridesById.get(flagId) : null,
			}
		},

		healMaterials() {
			programGeneration += 1
			return { healed: patchesById.size, generation: programGeneration }
		},


		activePatchIds(materialPath, tierName) {
			return [...patchesById.values()]
				.filter((patch) => patch.materialPaths.includes(materialPath))
				.filter((patch) => (patch.flagId ? isFlagActive(patch.flagId, tierName) : true))
				.sort((left, right) => left.order - right.order)
				.map((patch) => patch.id)
		},

		programGeneration() {
			return programGeneration
		},
	}
}

export function certificationBranchPatchPlan() {
	return createBranchPatchPlan({ declarationsByBranch: SB_FUTURE_INTEGRATION_DECLARATIONS_BY_BRANCH })
}

function activePatchIdsByBranch(harness, tierName) {
	const activeByBranch = {}
	for (const branchId of SB_RENDER_BRANCH_IDS) {
		const materialPath = materialPathsForBranch(branchId)[0] ?? null
		activeByBranch[branchId] = materialPath ? harness.activePatchIds(materialPath, tierName) : []
	}
	return activeByBranch
}

function totalActivePatchIds(activeByBranch) {
	return Object.values(activeByBranch).reduce((total, patchIds) => total + patchIds.length, 0)
}


export function measureGateMatrix() {
	const rows = []
	for (const tierName of SB_TIER_NAMES) {
		for (const technologyId of SB_RENDER_TECHNOLOGY_IDS) {
			for (const safeMode of [false, true]) {
				for (const flagOverride of SB_CERTIFICATION_FLAG_OVERRIDES) {
					const gate = resolveFutureIntegrationGate({
						tier: tierName,
						technology: technologyId,
						safeMode,
						flagOverride,
						coveredBranchIds: SB_RENDER_BRANCH_IDS,
					})
					rows.push({
						tier: tierName,
						technology: technologyId,
						safeMode,
						flagOverride,
						mode: gate.mode,
						flagMode: gate.flagMode,
						closedDoorId: gate.closedDoorId,
						reason: gate.reason,
					})
				}
			}
		}
	}

	const substrateRows = rows.filter((row) => row.mode === SB_INTEGRATION_MODES.substrate)
	return {
		rows,
		rowCount: rows.length,
		substrateRowCount: substrateRows.length,
		legacyRowCount: rows.length - substrateRows.length,
		weakTierSubstrateRowCount: rows.filter(
			(row) => row.tier === "fraco" && row.flagOverride === null && row.mode === SB_INTEGRATION_MODES.substrate,
		).length,
		problems: gateMatrixProblems(rows),
	}
}

function describeGateRow(row) {
	return (
		"tier " +
		row.tier +
		", tecnologia " +
		row.technology +
		", modo seguro " +
		row.safeMode +
		", flag " +
		String(row.flagOverride)
	)
}

export function gateMatrixProblems(rows) {
	const problems = []
	const legacy = SB_INTEGRATION_MODES.legacy

	for (const row of rows) {
		if (row.safeMode && row.mode !== legacy) {
			problems.push("modo seguro nao voltou ao legado: " + describeGateRow(row))
		}
		if (!isSubstrateCapableTechnology(row.technology) && row.mode !== legacy) {
			problems.push("tecnologia incapaz ligou o Substrate: " + describeGateRow(row))
		}
		if (row.flagOverride === false && row.mode !== legacy) {
			problems.push("veto de flag ignorado: " + describeGateRow(row))
		}
		if (row.tier === "fraco" && row.flagOverride === null && row.mode !== legacy) {
			problems.push("tier fraco nao nasceu no legado: " + describeGateRow(row))
		}
	}

	if (rows.every((row) => row.mode === legacy)) {
		problems.push("nenhuma combinacao liga o Substrate: o gate ficaria fechado para sempre")
	}

	return problems
}


export function measureSafeModeStrip() {
	const harness = createPatchHarnessDouble()
	const plan = certificationBranchPatchPlan()
	const problems = [...plan.refusals]

	for (const entry of plan.entries) {
		const registration = harness.registerPatch({
			id: entry.patchId,
			owner: entry.owner,
			anchor: entry.anchor,
			order: entry.order,
			flagId: entry.flagId,
			materialPaths: entry.materialPaths,
			declarations: entry.declarations,
		})
		if (registration.accepted !== true) {
			problems.push("o duble recusou " + entry.patchId + ": " + registration.reason)
		}
	}

	const activeBefore = activePatchIdsByBranch(harness, SB_CERTIFICATION_TIER_NAME)
	const generationBefore = harness.programGeneration()

	harness.setFlag(SB_FUTURE_INTEGRATION_FLAG_ID, false)
	const generationAfterStrip = harness.healMaterials().generation
	const activeAfterStrip = activePatchIdsByBranch(harness, SB_CERTIFICATION_TIER_NAME)

	harness.setFlag(SB_FUTURE_INTEGRATION_FLAG_ID, null)
	const generationAfterRestore = harness.healMaterials().generation
	const activeAfterRestore = activePatchIdsByBranch(harness, SB_CERTIFICATION_TIER_NAME)

	const activeCountBefore = totalActivePatchIds(activeBefore)
	const activeCountAfterStrip = totalActivePatchIds(activeAfterStrip)
	const activeCountAfterRestore = totalActivePatchIds(activeAfterRestore)

	if (activeCountBefore !== SB_RENDER_BRANCH_IDS.length) {
		problems.push(
			"antes do strip o conjunto ativo deveria ter " +
				SB_RENDER_BRANCH_IDS.length +
				" patch, tem " +
				activeCountBefore,
		)
	}
	if (activeCountAfterStrip !== 0) {
		problems.push("o modo seguro deixou " + activeCountAfterStrip + " patch ativo: nao e legado byte a byte")
	}
	if (generationBefore >= generationAfterStrip) {
		problems.push("o strip nao invalidou o programa: geracao ficou em " + generationAfterStrip)
	}
	if (generationAfterStrip >= generationAfterRestore) {
		problems.push("a volta do modo seguro nao invalidou o programa: geracao " + generationAfterRestore)
	}
	if (activeCountAfterRestore !== activeCountBefore) {
		problems.push("sair do modo seguro nao devolveu o conjunto ativo: " + activeCountAfterRestore)
	}

	return {
		tier: SB_CERTIFICATION_TIER_NAME,
		activeBefore,
		activeAfterStrip,
		activeAfterRestore,
		activeCountBefore,
		activeCountAfterStrip,
		activeCountAfterRestore,
		generationBefore,
		generationAfterStrip,
		generationAfterRestore,
		strippedToLegacy: activeCountAfterStrip === 0,
		programInvalidated: generationAfterStrip > generationBefore,
		restoredAfterSafeMode: activeCountAfterRestore === activeCountBefore,
		problems,
	}
}


export function certifyFutureIntegration(options = {}) {
	const plan = certificationBranchPatchPlan()
	const coverageProblems = branchCoverageProblems()
	const glslProblems = futureIntegrationGlslProblems()
	const textParity = evaluateBranchTextParity({ declarationsByBranch: SB_FUTURE_INTEGRATION_DECLARATIONS_BY_BRANCH })
	const roleParity = evaluateBranchRoleParity({ rolesByBranch: rolesByBranchFromPlan(plan) })
	const gateMatrix = measureGateMatrix()
	const safeModeStrip = measureSafeModeStrip()
	const pixelParity = evaluateBranchPixelParity(options.pixelParity ?? {})
	const legacyMaterialLite = resolveLegacyMaterialLiteRetirement({ pixelParity })

	const problems = [
		...coverageProblems,
		...glslProblems,
		...plan.refusals,
		...gateMatrix.problems,
		...safeModeStrip.problems,
	]
	if (!textParity.identical) {
		problems.push("as ramificacoes recebem textos diferentes: " + textParity.divergentBranchIds.join(", "))
	}
	if (!roleParity.balanced) {
		problems.push("papel de patch sem par nas duas ramificacoes: " + JSON.stringify(roleParity.missingByBranch))
	}
	if (SB_FUTURE_INTEGRATION_CODE.length > 0) {
		problems.push("a fase passou a escrever dentro do main sem revisao")
	}

	const pendingGates = pixelParity.pending ? ["branchPixelParity"] : []

	return {
		phaseId: SB_FUTURE_INTEGRATION_PHASE_ID,
		ok: problems.length === 0,
		problems,
		pendingGates,
		branchCount: SB_RENDER_BRANCH_IDS.length,
		patchOrders: plan.orders,
		planComplete: plan.complete,
		textParity,
		roleParity,
		gateMatrix: {
			rowCount: gateMatrix.rowCount,
			substrateRowCount: gateMatrix.substrateRowCount,
			legacyRowCount: gateMatrix.legacyRowCount,
			weakTierSubstrateRowCount: gateMatrix.weakTierSubstrateRowCount,
		},
		safeModeStrip,
		pixelParity,
		legacyMaterialLite,
	}
}
