import { SB_FUTURE_INTEGRATION_FLAG_ID, SB_FUTURE_INTEGRATION_PHASE_ID } from "./sbFutureIntegrationCore.js"

export function createPatchRegistryBridge(options = {}) {
	const patchApi = options.patchApi ?? null
	const flagsApi = options.flagsApi ?? null
	const three = options.three ?? null
	const flagId = options.flagId ?? SB_FUTURE_INTEGRATION_FLAG_ID
	const owner = options.owner ?? SB_FUTURE_INTEGRATION_PHASE_ID

	const state = {
		owner,
		flagId,
		safeMode: false,
		safeModeReason: null,
		programGeneration: 0,
		healCount: 0,
		anchorCheckCount: 0,
		registeredPatchIds: [],
		registeredBranchIds: [],
		coveredBranchIds: [],
		refusals: [],
	}

	function report() {
		return {
			owner: state.owner,
			flagId: state.flagId,
			accepted: state.safeMode !== true && state.registeredBranchIds.length > 0,
			safeMode: state.safeMode,
			safeModeReason: state.safeModeReason,
			registeredPatchIds: [...state.registeredPatchIds],
			registeredBranchIds: [...state.registeredBranchIds],
			coveredBranchIds: [...state.coveredBranchIds],
			refusals: [...state.refusals],
			programGeneration: state.programGeneration,
			healCount: state.healCount,
			anchorCheckCount: state.anchorCheckCount,
		}
	}


	function heal() {
		state.healCount += 1
		const healMaterials = patchApi?.healMaterials
		if (typeof healMaterials !== "function") {
			state.programGeneration += 1
			return { healedMaterialCount: null, programGeneration: state.programGeneration, harnessHealed: false }
		}
		const healResult = healMaterials()
		state.programGeneration = Number.isInteger(healResult?.generation)
			? healResult.generation
			: state.programGeneration + 1
		return {
			healedMaterialCount: healResult?.healed ?? null,
			programGeneration: state.programGeneration,
			harnessHealed: true,
		}
	}

	function setFlagOverride(overrideValue) {
		const setFlag = flagsApi?.setFlag
		if (typeof setFlag !== "function") return false
		setFlag(flagId, overrideValue)
		return true
	}

	function enterSafeMode(reason) {
		state.safeMode = true
		state.safeModeReason = reason ?? "modo seguro pedido sem motivo declarado"
		state.coveredBranchIds = []
		const flagVetoed = setFlagOverride(false)
		const healed = heal()
		return {
			safeMode: true,
			reason: state.safeModeReason,
			flagVetoed,
			programGeneration: healed.programGeneration,
		}
	}

	function leaveSafeMode() {
		state.safeMode = false
		state.safeModeReason = null
		state.coveredBranchIds = [...state.registeredBranchIds]
		const flagRestoredToAuto = setFlagOverride(null)
		const healed = heal()
		return {
			safeMode: false,
			flagRestoredToAuto,
			coveredBranchIds: [...state.coveredBranchIds],
			programGeneration: healed.programGeneration,
		}
	}


	function anchorReport(anchorId) {
		state.anchorCheckCount += 1
		const checkAnchor = patchApi?.checkAnchor
		if (typeof checkAnchor !== "function") {
			return { anchorId, present: false, reason: "bancada sem checkAnchor" }
		}
		const anchorCheck = checkAnchor(three, anchorId)
		return {
			anchorId,
			present: anchorCheck?.present === true,
			reason: anchorCheck?.reason ?? null,
		}
	}


	function registerBranchPlan(plan) {
		state.refusals = []
		state.registeredPatchIds = []
		state.registeredBranchIds = []
		state.coveredBranchIds = []

		if (plan?.complete !== true) {
			for (const refusal of plan?.refusals ?? []) state.refusals.push(refusal)
			if (state.refusals.length === 0) state.refusals.push("plano de patch vazio")
			enterSafeMode("plano incompleto: " + state.refusals[0])
			return report()
		}

		const anchorIds = [...new Set(plan.entries.map((entry) => entry.anchor))]
		const missingAnchors = anchorIds
			.map((anchorId) => anchorReport(anchorId))
			.filter((anchorCheck) => anchorCheck.present !== true)
		if (missingAnchors.length > 0) {
			for (const missingAnchor of missingAnchors) {
				state.refusals.push(
					"ancora ausente: " + missingAnchor.anchorId + " (" + (missingAnchor.reason ?? "assinatura nao encontrada") + ")",
				)
			}
			enterSafeMode("nenhum patch registrado: " + state.refusals[0])
			return report()
		}

		const registerPatch = patchApi?.registerPatch
		if (typeof registerPatch !== "function") {
			state.refusals.push("bancada sem registerPatch: nenhum GLSL costurado")
			enterSafeMode(state.refusals[0])
			return report()
		}

		for (const entry of plan.entries) {
			const registration = registerPatch({
				id: entry.patchId,
				owner: entry.owner ?? owner,
				anchor: entry.anchor,
				order: entry.order,
				flagId: entry.flagId,
				materialPaths: [...entry.materialPaths],
				declarations: entry.declarations,
			})
			if (registration?.accepted === true) {
				state.registeredPatchIds.push(entry.patchId)
				state.registeredBranchIds.push(entry.branchId)
				continue
			}
			state.refusals.push(
				"patch recusado na ramificacao " + entry.branchId + ": " + (registration?.reason ?? "sem motivo declarado"),
			)
		}

		if (state.refusals.length > 0 || state.registeredBranchIds.length !== plan.entries.length) {
			enterSafeMode("as duas ramificacoes ou nenhuma: " + (state.refusals[0] ?? "ramificacao sem patch"))
			return report()
		}

		state.safeMode = false
		state.safeModeReason = null
		state.coveredBranchIds = [...state.registeredBranchIds]
		heal()
		return report()
	}

	return {
		state,
		anchorReport,
		registerBranchPlan,
		enterSafeMode,
		leaveSafeMode,
		heal,
		report,
		isSafeMode: () => state.safeMode === true,
		programGeneration: () => state.programGeneration,
		coveredBranchIds: () => [...state.coveredBranchIds],
	}
}
