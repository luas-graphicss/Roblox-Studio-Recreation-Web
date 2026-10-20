import { getSubstrateHostSurface } from "../runtime/substrateHostSurface.js";


import * as THREE from "three"

import { SB_GATES, patchOrderFor } from "../sbMaterialContract.js"
import {
	SB_FUZZ_SHEEN_QUALITY_LEVELS,
	SB_SHEEN_MINIMUM_ROUGHNESS,
	certifyFuzzSheenEnergy,
	certifyFuzzSheenGrazing,
	fuzzQualityCode,
	measureFuzzSheenQualityCost,
	normalizeFuzzParameters,
	packFuzzColorToFloat,
} from "../sbFuzzSheenCore.js"
import {
	buildSheenLtcTable,
	sampleSheenLtcTable,
	sheenLtcTableChecksum,
	sheenLtcTableTexturePayload,
} from "../sbSheenLtcTableCore.js"
import {
	SB_FUZZ_SHEEN_ANCHORS,
	SB_FUZZ_UNIFORM_NAME,
	SB_SHEEN_LTC_UNIFORM_NAME,
	buildFuzzSheenGlsl,
} from "../sbFuzzSheenGlsl.js"

export const PHASE_ID = "SB-F13"
export const FLAG_ID = "SubstrateFuzzSheen"

const DECLARATIONS_PATCH_ID = "sbF13FuzzSheenDeclarations"
const APPLICATION_PATCH_ID = "sbF13FuzzSheenApplication"
const DECLARATIONS_SUB_SLOT = 0
const APPLICATION_SUB_SLOT = 1


const PHYSICAL_MATERIAL_PATHS = Object.freeze(["standard", "physical", "terreno", "skinned"])

const FLAG_DEFAULTS_BY_TIER = Object.freeze({ fraco: false, medio: true, forte: true })
const TEXTURE_UNITS_USED = 1
const CLOSURE_BYTES_ADDED = 12
const FALLBACK_TIER_NAME = "forte"
const FRAME_STAGE_NAME = "beforeMaterials"
const FRAME_STAGE_ID = "sbF13FuzzSheenQuality"


const INSTALL_CERTIFICATION_POLAR_STEPS = 64
const INSTALL_CERTIFICATION_AZIMUTH_STEPS = 64

function createSheenLtcTexture(payload) {
	const texture = new THREE.DataTexture(payload.data, payload.width, payload.height, THREE.RGBAFormat, THREE.FloatType)
	texture.minFilter = THREE.LinearFilter
	texture.magFilter = THREE.LinearFilter
	texture.wrapS = THREE.ClampToEdgeWrapping
	texture.wrapT = THREE.ClampToEdgeWrapping
	texture.generateMipmaps = false
	texture.colorSpace = THREE.NoColorSpace
	texture.needsUpdate = true
	return texture
}


function inspectAnchors(installContext) {
	const checkAnchor = installContext?.patch?.checkAnchor
	if (typeof checkAnchor !== "function") {
		const reason = "ancora nao verificada: bancada sem checkAnchor"
		return {
			declarations: { anchorId: SB_FUZZ_SHEEN_ANCHORS.declarations, present: null, reason },
			application: { anchorId: SB_FUZZ_SHEEN_ANCHORS.application, present: null, reason },
		}
	}
	return {
		declarations: checkAnchor(THREE, SB_FUZZ_SHEEN_ANCHORS.declarations),
		application: checkAnchor(THREE, SB_FUZZ_SHEEN_ANCHORS.application),
	}
}

function registerPhaseFlag(installContext) {
	const registerFlag = installContext?.flags?.registerFlag
	if (typeof registerFlag !== "function") return { registered: false }
	registerFlag({
		id: FLAG_ID,
		owner: PHASE_ID,
		description: "Lobo aditivo de fuzz/sheen com tabela LTC e dois niveis de qualidade.",
		defaultsByTier: FLAG_DEFAULTS_BY_TIER,
	})
	return { registered: true }
}


function registerFuzzUniform(installContext) {
	const registerUniform = installContext?.patch?.registerUniform
	if (typeof registerUniform !== "function") return null
	const holder = registerUniform(SB_FUZZ_UNIFORM_NAME, { owner: PHASE_ID, value: new THREE.Vector4(0, 0, 0, 0) })
	return holder?.value instanceof THREE.Vector4 ? holder.value : null
}

function registerSheenLtcUniform(installContext, texture) {
	const registerUniform = installContext?.patch?.registerUniform
	if (typeof registerUniform !== "function") return false
	registerUniform(SB_SHEEN_LTC_UNIFORM_NAME, { owner: PHASE_ID, value: texture })
	return true
}


function createFuzzUniformWriter(options) {
	const { uniformValue, readTierQuality } = options
	let parameters = normalizeFuzzParameters({
		fuzzAmount: 0,
		fuzzRoughness: SB_SHEEN_MINIMUM_ROUGHNESS,
		fuzzColor: [1, 1, 1],
	})
	let quality = readTierQuality()

	function write() {
		if (!uniformValue) return false
		uniformValue.set(
			parameters.fuzzAmount,
			parameters.fuzzRoughness,
			packFuzzColorToFloat(parameters.fuzzColor),
			fuzzQualityCode(quality),
		)
		return true
	}

	write()

	return {
		read() {
			return { ...parameters, fuzzColor: [...parameters.fuzzColor], quality }
		},


		set(nextParameters) {
			parameters = normalizeFuzzParameters({ ...parameters, ...nextParameters })
			if (SB_FUZZ_SHEEN_QUALITY_LEVELS.includes(nextParameters?.quality)) quality = nextParameters.quality
			write()
			return this.read()
		},


		syncQualityWithTier() {
			const tierQuality = readTierQuality()
			if (tierQuality === quality) return quality
			quality = tierQuality
			write()
			return quality
		},
	}
}

function createTierQualityReader(installContext, contract) {
	return () => {
		const tierName = installContext?.bench?.tier?.() ?? FALLBACK_TIER_NAME
		const tierQuality = contract?.tierDefaults?.(tierName)?.sheenQuality
		return SB_FUZZ_SHEEN_QUALITY_LEVELS.includes(tierQuality) ? tierQuality : SB_FUZZ_SHEEN_QUALITY_LEVELS[0]
	}
}

function registerPhasePatches(installContext, options) {
	const registerPatch = installContext?.patch?.registerPatch
	if (typeof registerPatch !== "function") {
		return { accepted: [], refused: [{ id: "todos", reason: "bancada sem registerPatch" }] }
	}

	const patchUniforms = {
		[SB_FUZZ_UNIFORM_NAME]: SB_FUZZ_UNIFORM_NAME,
		[SB_SHEEN_LTC_UNIFORM_NAME]: SB_SHEEN_LTC_UNIFORM_NAME,
	}
	const definitions = [
		{
			id: DECLARATIONS_PATCH_ID,
			anchor: SB_FUZZ_SHEEN_ANCHORS.declarations,
			subSlot: DECLARATIONS_SUB_SLOT,
			code: options.glsl.declarationsCode,
			anchorState: options.anchors.declarations,
		},
		{
			id: APPLICATION_PATCH_ID,
			anchor: SB_FUZZ_SHEEN_ANCHORS.application,
			subSlot: APPLICATION_SUB_SLOT,
			code: options.glsl.applicationCode,
			anchorState: options.anchors.application,
		},
	]

	const accepted = []
	const refused = []
	for (const definition of definitions) {
		const order = options.resolvePatchOrder(PHASE_ID, definition.subSlot)
		const entry = { id: definition.id, anchor: definition.anchor, order }
		if (typeof order !== "number") {
			refused.push({ ...entry, reason: "o contrato nao reserva ordem no sub-slot " + definition.subSlot })
			continue
		}
		if (definition.anchorState?.present === false) {
			refused.push({ ...entry, reason: "ancora ausente: " + (definition.anchorState.reason ?? definition.anchor) })
			continue
		}
		const result = registerPatch({
			id: definition.id,
			owner: PHASE_ID,
			anchor: definition.anchor,
			order,
			flagId: FLAG_ID,
			code: definition.code,
			materialPaths: PHYSICAL_MATERIAL_PATHS,
			uniforms: patchUniforms,
		})
		if (result?.accepted) accepted.push(entry)
		else refused.push({ ...entry, reason: result?.reason ?? "recusa sem motivo declarado" })
	}
	return { accepted, refused }
}

function declareBudget(installContext) {
	const telemetry = installContext?.telemetry
	telemetry?.textureUnit?.(PHASE_ID, TEXTURE_UNITS_USED)
	telemetry?.closureBytes?.(PHASE_ID, CLOSURE_BYTES_ADDED)
}

function reportProblems(installContext, refused, certifications) {
	const telemetry = installContext?.telemetry
	for (const problem of refused) {
		telemetry?.error?.(PHASE_ID, "patch recusado: " + problem.id + " (" + problem.reason + ")")
	}
	if (!certifications.energy.ok) {
		telemetry?.error?.(PHASE_ID, "portao de energia aberto: desvio " + certifications.energy.worstDeviation.toFixed(6))
	}
	if (!certifications.grazing.ok) {
		telemetry?.error?.(PHASE_ID, "portao de grazing aberto: " + certifications.grazing.failures.length + " amostras invalidas")
	}
	if (!certifications.cost.ok) {
		telemetry?.error?.(PHASE_ID, "portao de custo aberto: razao " + certifications.cost.costRatio.toFixed(4))
	}
}

function registerQualitySync(installContext, uniformWriter) {
	const register = installContext?.frameStages?.registerFrameStage
	if (typeof register !== "function") return { accepted: false, reason: "bancada sem estagios de frame" }
	return register(FRAME_STAGE_NAME, {
		id: FRAME_STAGE_ID,
		owner: PHASE_ID,
		run: () => uniformWriter.syncQualityWithTier(),
	})
}

function publishConsoleApi(consoleApi) {
	const lab = typeof window === "undefined" ? null : getSubstrateHostSurface()
	if (!lab) return false
	lab.fuzzSheen = consoleApi
	return true
}


function describeInstall(state) {
	const { certifications, patches, flag, table, checksum, patchCount, consolePublished, quality } = state
	const measurements = [
		"tabela LTC " + table.viewCosineSteps + "x" + table.roughnessSteps + " (assinatura " + checksum + ")",
		"pior desvio de energia " +
			(certifications.energy.worstDeviation * 100).toFixed(3) +
			"% do albedo, portao " +
			(certifications.energy.tolerance * 100).toFixed(1) +
			"%, em " +
			certifications.energy.entries.length +
			" amostras das duas qualidades",
		"custo da qualidade baixa " +
			(certifications.cost.costRatio * 100).toFixed(1) +
			"% da alta (" +
			certifications.cost.lowTotalCost +
			" vs " +
			certifications.cost.highTotalCost +
			" operacoes ponderadas, portao " +
			(certifications.cost.gate * 100).toFixed(0) +
			"%)",
		certifications.grazing.ok ? "grazing sem NaN e sem energia negativa" : "grazing COM amostra invalida",
		"qualidade do tier: " + quality,
		patches.accepted.length + "/" + patchCount + " patches aceitos",
		flag.registered ? "flag " + FLAG_ID : "sem flag (bancada ausente)",
		TEXTURE_UNITS_USED + " unidade de textura e " + CLOSURE_BYTES_ADDED + " bytes de closure declarados",
	]
	if (consolePublished) measurements.push("__sbLab.fuzzSheen publicado")
	const gatesClosed = certifications.energy.ok && certifications.grazing.ok && certifications.cost.ok
	const headline = gatesClosed ? "fuzz/sheen certificado" : "PORTAO NAO FECHADO"
	const refusals =
		patches.refused.length === 0 ? "" : " | patches recusados: " + patches.refused.map((entry) => entry.id + " (" + entry.reason + ")").join(", ")
	return PHASE_ID + " " + headline + " (" + measurements.join(", ") + ")" + refusals
}


export function installPhase(installContext) {
	try {
		const contract = installContext?.contract ?? null
		const gates = contract?.SB_GATES ?? SB_GATES
		const resolvePatchOrder = contract?.patchOrderFor ?? patchOrderFor

		const flag = registerPhaseFlag(installContext)
		const table = buildSheenLtcTable({})
		const checksum = sheenLtcTableChecksum(table)
		const sampleTable = (viewCosine, sheenRoughness) => sampleSheenLtcTable(table, viewCosine, sheenRoughness)

		const texture = createSheenLtcTexture(sheenLtcTableTexturePayload(table))
		const uniformValue = registerFuzzUniform(installContext)
		const sheenLtcRegistered = registerSheenLtcUniform(installContext, texture)

		const readTierQuality = createTierQualityReader(installContext, contract)
		const uniformWriter = createFuzzUniformWriter({ uniformValue, readTierQuality })

		const glsl = buildFuzzSheenGlsl({
			viewCosineSteps: table.viewCosineSteps,
			roughnessSteps: table.roughnessSteps,
		})
		const anchors = inspectAnchors(installContext)
		const patches = registerPhasePatches(installContext, { glsl, anchors, resolvePatchOrder })
		const frameStage = registerQualitySync(installContext, uniformWriter)

		declareBudget(installContext)

		const certifications = {
			energy: certifyFuzzSheenEnergy({
				sampleTable,
				gates,
				polarSteps: INSTALL_CERTIFICATION_POLAR_STEPS,
				azimuthSteps: INSTALL_CERTIFICATION_AZIMUTH_STEPS,
			}),
			grazing: certifyFuzzSheenGrazing({ sampleTable }),
			cost: measureFuzzSheenQualityCost(glsl.sources),
		}
		reportProblems(installContext, patches.refused, certifications)

		const consoleApi = {
			flagId: FLAG_ID,
			table: () => ({ width: table.viewCosineSteps, height: table.roughnessSteps, checksum }),
			sample: (viewCosine, sheenRoughness) => sampleTable(viewCosine, sheenRoughness),
			read: () => uniformWriter.read(),
			set: (parameters) => uniformWriter.set(parameters),
			certify: () => certifyFuzzSheenEnergy({ sampleTable, gates }),
			grazing: () => certifyFuzzSheenGrazing({ sampleTable }),
			cost: () => measureFuzzSheenQualityCost(glsl.sources),
			glsl: () => glsl,
		}
		const consolePublished = publishConsoleApi(consoleApi)

		return {
			summary: describeInstall({
				certifications,
				patches,
				flag,
				table,
				checksum,
				patchCount: 2,
				consolePublished,
				quality: uniformWriter.read().quality,
			}),
			certifications,
			patches,
			frameStage,
			flagId: FLAG_ID,
			uniforms: { fuzz: Boolean(uniformValue), sheenLtc: sheenLtcRegistered },
		}
	} catch (installError) {
		const message = installError?.message ?? String(installError)
		installContext?.telemetry?.error?.(PHASE_ID, message)
		return { summary: PHASE_ID + " nao instalou: " + message, failed: true }
	}
}
