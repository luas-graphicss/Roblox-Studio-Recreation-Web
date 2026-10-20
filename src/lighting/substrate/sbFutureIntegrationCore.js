import { SB_GATES, SB_TIER_NAMES, patchOrderFor, tierDefaults } from "./sbMaterialContract.js"
import { SB_MATERIAL_FAMILIES } from "./sbTopologySignatureCore.js"

export const SB_FUTURE_INTEGRATION_PHASE_ID = "SB-F33"
export const SB_FUTURE_INTEGRATION_FLAG_ID = "SubstrateFutureIntegration"
export const SB_FUTURE_INTEGRATION_ANCHOR_ID = "common"
export const SB_FUTURE_INTEGRATION_PATCH_ROLE = "futureIntegrationBranchGate"
export const SB_FALLBACK_TIER_NAME = "forte"


export const SB_INTEGRATION_MODES = Object.freeze({ substrate: "substrate", legacy: "legacy" })


export const SB_RENDER_BRANCHES = Object.freeze({
	individualPiece: Object.freeze({
		id: "individualPiece",
		label: "peca individual",
		engineCallSite: "src/viewport/lightingRender.js -- ramificacao da peca individual",
		materialPaths: Object.freeze(["standard", "physical", "terreno", "skinned"]),
		patchSubSlot: 0,
	}),
	instancedPool: Object.freeze({
		id: "instancedPool",
		label: "pool instanciado",
		engineCallSite: "src/viewport/lightingRender.js -- ramificacao do pool instanciado",
		materialPaths: Object.freeze(["poolPhong"]),
		patchSubSlot: 1,
	}),
})

export const SB_RENDER_BRANCH_IDS = Object.freeze(Object.keys(SB_RENDER_BRANCHES))


export const SB_RENDER_TECHNOLOGIES = Object.freeze({
	webgl2: Object.freeze({
		id: "webgl2",
		substrateCapable: true,
		why: "WebGL2: textura de dados e GLSL ES 3.00 existem, o buffer de material da SB-F8 cabe",
	}),
	webgl1: Object.freeze({
		id: "webgl1",
		substrateCapable: false,
		why: "WebGL1: sem o buffer de material da SB-F8 nao ha onde guardar closure, e o Substrate seria mais um uniform do material-lite",
	}),
	software: Object.freeze({
		id: "software",
		substrateCapable: false,
		why: "rasterizador de software: nao ha orcamento de quadro para tres closures por pixel",
	}),
	unknown: Object.freeze({
		id: "unknown",
		substrateCapable: false,
		why: "tecnologia nao identificada: o gate nega por padrao em vez de apostar",
	}),
})

export const SB_RENDER_TECHNOLOGY_IDS = Object.freeze(Object.keys(SB_RENDER_TECHNOLOGIES))
export const SB_DEFAULT_RENDER_TECHNOLOGY_ID = "unknown"


export const SB_GATE_DOOR_IDS = Object.freeze(["safeMode", "technology", "flagVeto", "branchCoverage", "tier"])


export const SB_BRANCH_PARITY_MINIMUM_SSIM = SB_GATES.branchParityMinimumSsim


export const SB_LEGACY_MATERIAL_LITE = Object.freeze({
	owner: SB_FUTURE_INTEGRATION_PHASE_ID,
	engineModules: Object.freeze(["src/lighting/materialFeaturesCore.js", "src/viewport/materialFeatures.js"]),
	why: "e o caminho vivo hoje e a referencia do teste de flag OFF",
})

export function branchEntry(branchId) {
	return SB_RENDER_BRANCHES[branchId] ?? null
}

export function materialPathsForBranch(branchId) {
	return [...(branchEntry(branchId)?.materialPaths ?? [])]
}

export function branchIdForMaterialPath(materialPath) {
	for (const branchId of SB_RENDER_BRANCH_IDS) {
		if (SB_RENDER_BRANCHES[branchId].materialPaths.includes(materialPath)) return branchId
	}
	return null
}

export function coveredMaterialPaths() {
	return SB_RENDER_BRANCH_IDS.flatMap((branchId) => materialPathsForBranch(branchId))
}


export function branchCoverageProblems() {
	const problems = []
	const covered = coveredMaterialPaths()

	for (const materialFamily of SB_MATERIAL_FAMILIES) {
		if (!covered.includes(materialFamily)) {
			problems.push("familia de material sem ramificacao dona: " + materialFamily)
		}
	}

	const seenMaterialPaths = new Set()
	for (const materialPath of covered) {
		if (!SB_MATERIAL_FAMILIES.includes(materialPath)) {
			problems.push("ramificacao cita familia que a engine nao tem: " + materialPath)
		}
		if (seenMaterialPaths.has(materialPath)) {
			problems.push("familia de material em duas ramificacoes: " + materialPath)
		}
		seenMaterialPaths.add(materialPath)
	}

	return problems
}

export function technologyEntry(technologyId) {
	if (Object.prototype.hasOwnProperty.call(SB_RENDER_TECHNOLOGIES, String(technologyId))) {
		return SB_RENDER_TECHNOLOGIES[technologyId]
	}
	return SB_RENDER_TECHNOLOGIES[SB_DEFAULT_RENDER_TECHNOLOGY_ID]
}

export function normalizeTechnologyId(technologyId) {
	return technologyEntry(technologyId).id
}

export function isSubstrateCapableTechnology(technologyId) {
	return technologyEntry(technologyId).substrateCapable === true
}


export function technologyFromRendererCapabilities(capabilities) {
	if (!capabilities || typeof capabilities !== "object") return SB_DEFAULT_RENDER_TECHNOLOGY_ID
	if (capabilities.isWebGL2 === true) return "webgl2"
	if (capabilities.isWebGL2 === false) return "webgl1"
	return SB_DEFAULT_RENDER_TECHNOLOGY_ID
}

function normalizeTierName(tierName) {
	return SB_TIER_NAMES.includes(tierName) ? tierName : SB_FALLBACK_TIER_NAME
}

function normalizeFlagOverride(rawOverride) {
	if (rawOverride === true) return true
	if (rawOverride === false) return false
	return null
}







export function flagModeFor(rawOverride, tierWantsSubstrate) {
	const override = normalizeFlagOverride(rawOverride)
	if (override === true) return "forced"
	if (override === false) return "vetoed"
	return tierWantsSubstrate ? "auto-on" : "auto-off"
}

function gateDoor(id, passed, reason) {
	return { id, passed, reason }
}

function normalizeCoveredBranchIds(rawCoveredBranchIds) {
	if (!Array.isArray(rawCoveredBranchIds)) return []
	return SB_RENDER_BRANCH_IDS.filter((branchId) => rawCoveredBranchIds.includes(branchId))
}


export function resolveFutureIntegrationGate(request = {}) {
	const tierName = normalizeTierName(request.tier)
	const technologyId = normalizeTechnologyId(request.technology)
	const safeMode = request.safeMode === true
	const flagOverride = normalizeFlagOverride(request.flagOverride)
	const coveredBranchIds = normalizeCoveredBranchIds(request.coveredBranchIds)
	const missingBranchIds = SB_RENDER_BRANCH_IDS.filter((branchId) => !coveredBranchIds.includes(branchId))
	const tierWantsSubstrate = tierDefaults(tierName).substrateEnabled === true

	const doors = [
		gateDoor(
			"safeMode",
			!safeMode,
			safeMode ? "modo seguro ligado: a resposta e o legado" : "modo seguro desligado",
		),
		gateDoor("technology", isSubstrateCapableTechnology(technologyId), technologyEntry(technologyId).why),
		gateDoor(
			"flagVeto",
			flagOverride !== false,
			flagOverride === false ? "flag " + SB_FUTURE_INTEGRATION_FLAG_ID + " vetada pelo operador" : "sem veto de flag",
		),
		gateDoor(
			"branchCoverage",
			missingBranchIds.length === 0,
			missingBranchIds.length === 0
				? "as " + SB_RENDER_BRANCH_IDS.length + " ramificacoes receberam o mesmo patch"
				: "ramificacao sem patch: " + missingBranchIds.join(", ") + " -- meia costura vai para o legado",
		),
		gateDoor(
			"tier",
			flagOverride === true || tierWantsSubstrate,
			tierWantsSubstrate
				? "o tier " + tierName + " liga o Substrate por contrato"
				: "o tier " + tierName + " nasce no legado por contrato",
		),
	]

	const closedDoor = doors.find((door) => door.passed !== true) ?? null
	const mode = closedDoor ? SB_INTEGRATION_MODES.legacy : SB_INTEGRATION_MODES.substrate

	return {
		phaseId: SB_FUTURE_INTEGRATION_PHASE_ID,
		mode,
		substrateActive: mode === SB_INTEGRATION_MODES.substrate,
		tier: tierName,
		technology: technologyId,
		safeMode,
		flagOverride,
		flagMode: flagModeFor(flagOverride, tierWantsSubstrate),
		coveredBranchIds,
		missingBranchIds,
		doors,
		closedDoorId: closedDoor?.id ?? null,
		reason: closedDoor ? closedDoor.reason : "as " + doors.length + " portas do gate estao abertas",
	}
}


export function futureIntegrationGateSignature(request = {}) {
	return [
		normalizeTierName(request.tier),
		normalizeTechnologyId(request.technology),
		request.safeMode === true ? "safe" : "live",
		String(normalizeFlagOverride(request.flagOverride)),
		normalizeCoveredBranchIds(request.coveredBranchIds).join("+"),
	].join("|")
}

export function branchPatchId(branchId) {
	return "sbFutureIntegration" + String(branchId).charAt(0).toUpperCase() + String(branchId).slice(1)
}


export function createBranchPatchPlan(options = {}) {
	const declarationsByBranch = options.declarationsByBranch ?? {}
	const flagId = options.flagId ?? SB_FUTURE_INTEGRATION_FLAG_ID
	const anchorId = options.anchorId ?? SB_FUTURE_INTEGRATION_ANCHOR_ID
	const entries = []
	const refusals = []

	for (const branchId of SB_RENDER_BRANCH_IDS) {
		const branch = SB_RENDER_BRANCHES[branchId]
		const order = patchOrderFor(SB_FUTURE_INTEGRATION_PHASE_ID, branch.patchSubSlot)
		const declarations = declarationsByBranch[branchId]
		if (!Number.isInteger(order)) {
			refusals.push("o contrato nao reservou ordem para a ramificacao " + branchId)
			continue
		}
		if (typeof declarations !== "string" || declarations.length === 0) {
			refusals.push("ramificacao sem GLSL declarado: " + branchId)
			continue
		}
		entries.push({
			branchId,
			branchLabel: branch.label,
			role: SB_FUTURE_INTEGRATION_PATCH_ROLE,
			patchId: branchPatchId(branchId),
			owner: SB_FUTURE_INTEGRATION_PHASE_ID,
			anchor: anchorId,
			order,
			flagId,
			materialPaths: materialPathsForBranch(branchId),
			declarations,
		})
	}

	const orders = entries.map((entry) => entry.order)
	if (new Set(orders).size !== orders.length) {
		refusals.push("duas ramificacoes com a mesma ordem de patch: " + orders.join(", ") + " -- elas se anulariam em silencio")
	}

	return {
		phaseId: SB_FUTURE_INTEGRATION_PHASE_ID,
		anchorId,
		flagId,
		entries,
		orders,
		refusals,
		complete: refusals.length === 0 && entries.length === SB_RENDER_BRANCH_IDS.length,
	}
}

export function rolesByBranchFromPlan(plan) {
	const rolesByBranch = {}
	for (const entry of plan?.entries ?? []) {
		rolesByBranch[entry.branchId] = [...(rolesByBranch[entry.branchId] ?? []), entry.role]
	}
	return rolesByBranch
}

export const SB_BRANCH_SELECTOR_MACRO = "SB_RENDER_BRANCH"
export const SB_BRANCH_SELECTOR_LINE_PREFIX = "#define " + SB_BRANCH_SELECTOR_MACRO + " "


export function sharedBranchDeclarations(declarations) {
	return String(declarations ?? "")
		.split("\n")
		.filter((line) => !line.trimStart().startsWith(SB_BRANCH_SELECTOR_LINE_PREFIX))
		.join("\n")
}






export function evaluateBranchTextParity(options = {}) {
	const declarationsByBranch = options.declarationsByBranch ?? {}
	const sharedTexts = SB_RENDER_BRANCH_IDS.map((branchId) => ({
		branchId,
		sharedText: sharedBranchDeclarations(declarationsByBranch[branchId]),
	}))
	const reference = sharedTexts[0] ?? { branchId: null, sharedText: "" }
	const divergentBranchIds = sharedTexts
		.filter((entry) => entry.sharedText !== reference.sharedText)
		.map((entry) => entry.branchId)
	const emptyBranchIds = sharedTexts.filter((entry) => entry.sharedText.trim().length === 0).map((entry) => entry.branchId)

	return {
		identical: divergentBranchIds.length === 0 && emptyBranchIds.length === 0,
		referenceBranchId: reference.branchId,
		sharedTextLength: reference.sharedText.length,
		branchCount: sharedTexts.length,
		divergentBranchIds,
		emptyBranchIds,
	}
}


export function evaluateBranchRoleParity(options = {}) {
	const rolesByBranch = options.rolesByBranch ?? {}
	const everyRole = new Set()
	for (const branchId of SB_RENDER_BRANCH_IDS) {
		for (const role of rolesByBranch[branchId] ?? []) everyRole.add(role)
	}

	const missingByBranch = {}
	for (const branchId of SB_RENDER_BRANCH_IDS) {
		const branchRoles = new Set(rolesByBranch[branchId] ?? [])
		const missingRoles = [...everyRole].filter((role) => !branchRoles.has(role)).sort()
		if (missingRoles.length > 0) missingByBranch[branchId] = missingRoles
	}

	return {
		balanced: Object.keys(missingByBranch).length === 0 && everyRole.size > 0,
		roles: [...everyRole].sort(),
		roleCount: everyRole.size,
		missingByBranch,
	}
}


export function evaluateBranchPixelParity(measurement = {}) {
	const measuredSsim = typeof measurement.ssim === "number" ? measurement.ssim : null
	if (measuredSsim === null) {
		return {
			ok: false,
			pending: true,
			gate: SB_BRANCH_PARITY_MINIMUM_SSIM,
			measured: null,
			reason: "sem medicao de pixel: peca x pool exige o projeto ativo na tela",
		}
	}
	const ok = measuredSsim >= SB_BRANCH_PARITY_MINIMUM_SSIM
	return {
		ok,
		pending: false,
		gate: SB_BRANCH_PARITY_MINIMUM_SSIM,
		measured: measuredSsim,
		reason: ok
			? "peca e pool com SSIM " + measuredSsim + ", dentro do portao " + SB_BRANCH_PARITY_MINIMUM_SSIM
			: "peca e pool divergem: SSIM " + measuredSsim + " abaixo do portao " + SB_BRANCH_PARITY_MINIMUM_SSIM,
	}
}







export function resolveLegacyMaterialLiteRetirement(request = {}) {
	const pixelParity = request.pixelParity ?? evaluateBranchPixelParity({})
	const blockers = []

	if (pixelParity.ok !== true) {
		blockers.push("portao de pixel peca x pool nao fechou: " + pixelParity.reason)
	}
	if (tierDefaults("fraco").substrateEnabled !== true) {
		blockers.push("o tier fraco fica no legado por contrato: sem o material-lite a GPU fraca fica sem caminho")
	}
	blockers.push("o modo seguro precisa de um caminho legado para onde voltar")

	return {
		...SB_LEGACY_MATERIAL_LITE,
		retired: blockers.length === 0,
		blockers,
	}
}

export function describeFutureIntegration(request = {}) {
	const plan = request.plan ?? null
	return {
		phaseId: SB_FUTURE_INTEGRATION_PHASE_ID,
		flagId: SB_FUTURE_INTEGRATION_FLAG_ID,
		anchorId: SB_FUTURE_INTEGRATION_ANCHOR_ID,
		branches: SB_RENDER_BRANCH_IDS.map((branchId) => ({
			...SB_RENDER_BRANCHES[branchId],
			materialPaths: materialPathsForBranch(branchId),
			patchId: branchPatchId(branchId),
			patchOrder: patchOrderFor(SB_FUTURE_INTEGRATION_PHASE_ID, SB_RENDER_BRANCHES[branchId].patchSubSlot),
		})),
		technologies: SB_RENDER_TECHNOLOGY_IDS.map((technologyId) => SB_RENDER_TECHNOLOGIES[technologyId]),
		gateDoorIds: [...SB_GATE_DOOR_IDS],
		branchPixelParityGate: SB_BRANCH_PARITY_MINIMUM_SSIM,
		materialFamilies: [...SB_MATERIAL_FAMILIES],
		coverageProblems: branchCoverageProblems(),
		legacyMaterialLite: resolveLegacyMaterialLiteRetirement(request),
		planComplete: plan?.complete ?? null,
	}
}
