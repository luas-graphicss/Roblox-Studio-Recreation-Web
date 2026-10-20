import { getSubstrateHostSurface } from "../runtime/substrateHostSurface.js";


import {
	SB_DOMAIN_GLSL_ANCHOR,
	SB_DOMAIN_UNIFORM_NAMES,
	domainGlsl,
	domainGlslProblems,
	domainGlslUniformNames,
} from "../sbDomainGlsl.js"
import {
	SB_LIGHT_FUNCTION_DOMAIN,
	SB_POST_PROCESS_DOMAIN,
	SB_UNLIT_DOMAIN,
	SB_VOLUME_DOMAIN,
	createReferenceDomainTree,
	createRefusedDomainTree,
	describeMaterialDomains,
	findDomainBsdfParameters,
	materialDomainNames,
	materialDomainProblems,
	materialDomainRule,
	maximumDomainClosureBytes,
	runDomainRefusalBattery,
	validateMaterialDomain,
} from "../sbMaterialDomainCore.js"
import {
	SB_VOLUME_BSDF_KIND,
	SB_VOLUME_DEFAULT_PARAMETERS,
	volumeClosurePayload,
	volumeEnergyProblems,
} from "../sbVolumeBsdfCore.js"
import {
	SB_LIGHT_FUNCTION_DEFAULTS,
	SB_POST_PROCESS_DEFAULTS,
	SB_UNLIT_BSDF_KIND,
	SB_UNLIT_DEFAULT_PARAMETERS,
	lightFunctionPayload,
	postProcessPayload,
	unlitClosurePayload,
	unlitDomainProblems,
} from "../sbUnlitDomainCore.js"

export const PHASE_ID = "SB-F27"

const TELEMETRY_SOURCE = "sbPhaseF27MaterialDomains"

export const SB_DOMAIN_FLAG_IDS = Object.freeze({
	[SB_VOLUME_DOMAIN]: "SubstrateDomainVolume",
	[SB_UNLIT_DOMAIN]: "SubstrateDomainUnlit",
	[SB_LIGHT_FUNCTION_DOMAIN]: "SubstrateDomainLightFunction",
	[SB_POST_PROCESS_DOMAIN]: "SubstrateDomainPostProcess",
})


const DOMAIN_PATCH_SUB_SLOTS = Object.freeze({
	[SB_VOLUME_DOMAIN]: 0,
	[SB_UNLIT_DOMAIN]: 1,
	[SB_LIGHT_FUNCTION_DOMAIN]: 2,
	[SB_POST_PROCESS_DOMAIN]: 3,
})

const DOMAIN_FLAG_DEFAULTS_BY_TIER = Object.freeze({ fraco: false, medio: false, forte: false })

function createPhaseSettings() {
	return {
		ringFrequency: SB_LIGHT_FUNCTION_DEFAULTS.ringFrequency,
		saturation: SB_POST_PROCESS_DEFAULTS.saturation,
	}
}


function domainUniformValues(domainName, rawRootNode, phaseSettings) {
	if (domainName === SB_VOLUME_DOMAIN) {
		const authored = findDomainBsdfParameters(rawRootNode, SB_VOLUME_BSDF_KIND) ?? SB_VOLUME_DEFAULT_PARAMETERS
		const payload = volumeClosurePayload(authored)
		return {
			[SB_DOMAIN_UNIFORM_NAMES.volumeExtinction]: [...payload.extinction],
			[SB_DOMAIN_UNIFORM_NAMES.volumeScattering]: [...payload.scattering],
		}
	}

	const authoredUnlit = findDomainBsdfParameters(rawRootNode, SB_UNLIT_BSDF_KIND) ?? SB_UNLIT_DEFAULT_PARAMETERS
	const unlit = unlitClosurePayload(authoredUnlit)

	if (domainName === SB_UNLIT_DOMAIN) {
		return { [SB_DOMAIN_UNIFORM_NAMES.unlitColor]: [...unlit.color, unlit.opacity] }
	}
	if (domainName === SB_LIGHT_FUNCTION_DOMAIN) {
		const mask = lightFunctionPayload({
			maskColor: unlit.color,
			ringFrequency: phaseSettings.ringFrequency,
		})
		return { [SB_DOMAIN_UNIFORM_NAMES.lightFunctionMask]: [...mask.maskColor, mask.ringFrequency] }
	}
	if (domainName === SB_POST_PROCESS_DOMAIN) {
		const grade = postProcessPayload({ tint: unlit.color, saturation: phaseSettings.saturation })
		return { [SB_DOMAIN_UNIFORM_NAMES.postProcessGrade]: [...grade.tint, grade.saturation] }
	}
	return {}
}


export function evaluateMaterialDomainsGate() {
	const battery = runDomainRefusalBattery()
	const problems = [
		...battery.problems,
		...materialDomainProblems(),
		...domainGlslProblems(),
		...volumeEnergyProblems(SB_VOLUME_DEFAULT_PARAMETERS),
		...unlitDomainProblems(),
	]

	for (const domainName of materialDomainNames()) {
		if (!domainGlsl(domainName)) {
			problems.push('o dominio "' + domainName + '" nao tem trecho de GLSL, logo nao compilaria nada')
		}
		if (!SB_DOMAIN_FLAG_IDS[domainName]) {
			problems.push('o dominio "' + domainName + '" nao tem flag propria, e flag desligada precisa significar codigo nao compilado')
		}
		if (typeof DOMAIN_PATCH_SUB_SLOTS[domainName] !== "number") {
			problems.push('o dominio "' + domainName + '" nao tem sub-slot de patch reservado')
		}
	}

	return { ok: problems.length === 0, problems, battery }
}

function registerDomainFlags(installContext, problems) {
	const registerFlag = installContext?.flags?.registerFlag
	const flagIds = {}
	if (typeof registerFlag !== "function") {
		problems.push("a bancada nao expos flags.registerFlag: os quatro dominios ficariam sem interruptor")
		return flagIds
	}
	for (const domainName of materialDomainNames()) {
		const flagId = SB_DOMAIN_FLAG_IDS[domainName]
		const rule = materialDomainRule(domainName)
		registerFlag({
			id: flagId,
			owner: PHASE_ID,
			description: "Dominio de material " + domainName + ": " + (rule?.description ?? ""),
			defaultsByTier: { ...DOMAIN_FLAG_DEFAULTS_BY_TIER },
		})
		flagIds[domainName] = flagId
	}
	return flagIds
}

function registerDomainUniforms(installContext, phaseSettings, problems) {
	const registerUniform = installContext?.patch?.registerUniform
	const uniformNames = []
	if (typeof registerUniform !== "function") {
		problems.push("a bancada nao expos patch.registerUniform: os dominios nao teriam como receber valor")
		return uniformNames
	}
	for (const domainName of materialDomainNames()) {
		const values = domainUniformValues(domainName, createReferenceDomainTree(domainName), phaseSettings)
		for (const [uniformName, value] of Object.entries(values)) {
			registerUniform(uniformName, { owner: PHASE_ID, value })
			uniformNames.push(uniformName)
		}
	}
	return uniformNames
}

function buildPatchUniformMap(domainName) {
	const uniforms = {}
	for (const uniformName of domainGlslUniformNames(domainName)) {
		uniforms[uniformName] = uniformName
	}
	return uniforms
}

function registerDomainPatches(installContext, problems) {
	const registerPatch = installContext?.patch?.registerPatch
	const orders = {}
	let refusedCount = 0
	if (typeof registerPatch !== "function") {
		problems.push("a bancada nao expos patch.registerPatch: nenhum dominio seria costurado no shader")
		return { orders, refusedCount }
	}

	for (const domainName of materialDomainNames()) {
		const subSlot = DOMAIN_PATCH_SUB_SLOTS[domainName]
		const order = installContext?.contract?.patchOrderFor?.(PHASE_ID, subSlot) ?? null
		orders[domainName] = order
		if (typeof order !== "number") {
			refusedCount += 1
			problems.push('o contrato nao deu ordem de patch ao dominio "' + domainName + '" no sub-slot ' + subSlot)
			continue
		}
		const snippet = domainGlsl(domainName)
		const result = registerPatch({
			id: PHASE_ID + ":" + domainName,
			owner: PHASE_ID,
			anchor: SB_DOMAIN_GLSL_ANCHOR,
			order,
			flagId: SB_DOMAIN_FLAG_IDS[domainName],
			declarations: snippet.declarations,
			code: snippet.code,
			uniforms: buildPatchUniformMap(domainName),
		})
		if (result?.accepted === false) {
			refusedCount += 1
			problems.push('o patch do dominio "' + domainName + '" foi recusado: ' + (result?.reason ?? "sem motivo"))
		}
	}

	return { orders, refusedCount }
}

function currentTierName(installContext) {
	return installContext?.bench?.tier?.() ?? null
}

function firstRefusalReason(refusals) {
	return refusals?.[0]?.reason ?? "sem motivo registrado"
}

function activeDomains(installContext) {
	const tierName = currentTierName(installContext)
	const active = materialDomainNames().filter(
		(domainName) => installContext?.flags?.isFlagActive?.(SB_DOMAIN_FLAG_IDS[domainName], tierName) === true,
	)
	return { tierName, active, conflict: active.length > 1 }
}

function applyDomainUniforms(installContext, phaseSettings, domainName, rawRootNode) {
	const setUniform = installContext?.patch?.setUniform
	const values = domainUniformValues(domainName, rawRootNode, phaseSettings)
	if (typeof setUniform !== "function") return { applied: false, values }
	for (const [uniformName, value] of Object.entries(values)) {
		setUniform(uniformName, value)
	}
	return { applied: true, values }
}


function selectDomain(installContext, phaseSettings, domainName, rawRootNode) {
	const tree = rawRootNode ?? createReferenceDomainTree(domainName)
	const validation = validateMaterialDomain(domainName, tree, { tierName: currentTierName(installContext) })
	if (validation.ok !== true) {
		return {
			applied: false,
			domain: domainName ?? null,
			reason: firstRefusalReason(validation.refusals),
			refusals: validation.refusals,
		}
	}

	const setFlag = installContext?.flags?.setFlag
	if (typeof setFlag !== "function") {
		return { applied: false, domain: domainName, reason: "a bancada nao expos flags.setFlag", refusals: [] }
	}
	for (const candidate of materialDomainNames()) {
		setFlag(SB_DOMAIN_FLAG_IDS[candidate], candidate === domainName ? true : null)
	}

	const uniforms = applyDomainUniforms(installContext, phaseSettings, domainName, tree)
	installContext?.patch?.healMaterials?.()
	return {
		applied: true,
		domain: domainName,
		summary: validation.summary,
		uniforms: uniforms.values,
		flagId: SB_DOMAIN_FLAG_IDS[domainName],
	}
}


function clearDomains(installContext) {
	const setFlag = installContext?.flags?.setFlag
	if (typeof setFlag !== "function") {
		return { cleared: false, reason: "a bancada nao expos flags.setFlag" }
	}
	for (const domainName of materialDomainNames()) {
		setFlag(SB_DOMAIN_FLAG_IDS[domainName], null)
	}
	installContext?.patch?.healMaterials?.()
	return { cleared: true, domains: materialDomainNames() }
}

function createConsoleSurface(installContext, phaseSettings) {
	return {
		list: () => materialDomainNames(),
		describe: () => describeMaterialDomains(),
		rule: (domainName) => materialDomainRule(domainName),
		reference: (domainName) => createReferenceDomainTree(domainName),
		refusedExample: (domainName) => createRefusedDomainTree(domainName),
		validate: (domainName, rawRootNode) =>
			validateMaterialDomain(domainName, rawRootNode ?? createReferenceDomainTree(domainName), {
				tierName: currentTierName(installContext),
			}),
		refusalBattery: () => runDomainRefusalBattery({ tierName: currentTierName(installContext) }),
		gate: () => evaluateMaterialDomainsGate(),
		flagIds: () => ({ ...SB_DOMAIN_FLAG_IDS }),
		active: () => activeDomains(installContext),
		select: (domainName, rawRootNode) => selectDomain(installContext, phaseSettings, domainName, rawRootNode),
		clear: () => clearDomains(installContext),
		settings: () => ({ ...phaseSettings }),
		tune: (nextSettings) => {
			const authored = nextSettings ?? {}
			if (typeof authored.ringFrequency === "number") phaseSettings.ringFrequency = authored.ringFrequency
			if (typeof authored.saturation === "number") phaseSettings.saturation = authored.saturation
			for (const domainName of [SB_LIGHT_FUNCTION_DOMAIN, SB_POST_PROCESS_DOMAIN]) {
				applyDomainUniforms(installContext, phaseSettings, domainName, createReferenceDomainTree(domainName))
			}
			return { ...phaseSettings }
		},
	}
}

function publishConsoleSurface(installContext, phaseSettings) {
	if (typeof window === "undefined" || !getSubstrateHostSurface()) return false
	getSubstrateHostSurface().materialDomains = createConsoleSurface(installContext, phaseSettings)
	return true
}

export function installPhase(installContext) {
	const gate = evaluateMaterialDomainsGate()
	const problems = [...gate.problems]
	const phaseSettings = createPhaseSettings()

	const flagIds = registerDomainFlags(installContext, problems)
	const uniformNames = registerDomainUniforms(installContext, phaseSettings, problems)
	const patches = registerDomainPatches(installContext, problems)
	const closureBytes = maximumDomainClosureBytes()

	installContext?.telemetry?.closureBytes?.(PHASE_ID, closureBytes)
	for (const problem of problems) {
		installContext?.telemetry?.error?.(TELEMETRY_SOURCE, problem)
	}

	const consolePublished = publishConsoleSurface(installContext, phaseSettings)

	return {
		summary: {
			phaseId: PHASE_ID,
			domains: materialDomainNames(),
			flagIds,
			patchAnchor: SB_DOMAIN_GLSL_ANCHOR,
			patchOrders: patches.orders,
			refusedPatches: patches.refusedCount,
			uniformNames,
			closureBytes,
			gateOk: gate.ok,
			acceptedReferenceTrees: gate.battery.acceptedCount,
			refusedInputs: gate.battery.refusedCount,
			problems,
			consolePublished,
		},
	}
}
