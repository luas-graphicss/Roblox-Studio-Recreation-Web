import { getSubstrateHostSurface } from "../runtime/substrateHostSurface.js";


import { SB_GATES, SB_TIER_NAMES, patchOrderFor, tierDefaults } from "../sbMaterialContract.js"
import { SB_GLINT_DEFAULT_SEED } from "../sbGlintCore.js"
import { SB_GLINT_BASE_CELL_SIZE, SB_GLINT_LOD_LEVEL_COUNT, resolveGlintLod } from "../sbGlintLodCore.js"
import { SB_GLINT_LUT_HEIGHT, SB_GLINT_LUT_WIDTH, buildGlintLutData } from "../sbGlintLutCore.js"
import {
	SB_GLINT_APPLY_GLSL,
	SB_GLINT_PARS_GLSL,
	SB_GLINT_UNIFORM_DECLARATIONS_GLSL,
	glintGlslReport,
} from "../sbGlintGlsl.js"
import { certifyGlintModel } from "../sbGlintCertificationCore.js"
import { SB_SLAB_PRESETS } from "../support/src/lab/labSlabPresets.js"

export const PHASE_ID = "SB-F15"
export const GLINT_FLAG_ID = "SubstrateGlints"
export const GLINT_PARS_PATCH_ID = "sb-f15-glint-pars"
export const GLINT_APPLY_PATCH_ID = "sb-f15-glint-apply"
export const GLINT_PASS_NAME = "glintNoisePrepare"
export const GLINT_UNIFORM_NAME = "uSbGlint"
export const GLINT_LUT_UNIFORM_NAME = "uSbGlintLut"
export const GLINT_TEXTURE_UNIT_CONSUMER = "glintLut"
export const GLINT_PARS_ANCHOR = "lightsPhysicalPars"
export const GLINT_APPLY_ANCHOR = "lightsFragmentEnd"


export const GLINT_CLOSURE_BYTES = 3


export const GLINT_TEXTURE_UNIT_COUNT = 1


export const GLINT_MATERIAL_PATHS = Object.freeze(["standard", "physical", "terreno", "skinned"])


const DEFAULT_GLINT_ROUGHNESS = 0.05


const SHADER_SEED_MODULUS = 997

const glintSettings = {
	glintDensity: 0,
	glintRoughness: DEFAULT_GLINT_ROUGHNESS,
	seed: SB_GLINT_DEFAULT_SEED,
}

let glintPatchApi = null
let glintLutTexture = null
let glintUniformNeedsUpload = true

function resolveThree(installContext) {
	const benchThree = installContext?.bench?.THREE ?? null
	if (benchThree) return benchThree
	if (typeof window === "undefined") return null
	return getSubstrateHostSurface()?.internals?.THREE ?? null
}

function formatNumber(value, digits) {
	const numericValue = Number(value)
	return Number.isFinite(numericValue) ? numericValue.toFixed(digits) : "n/d"
}


export function glintFlagDefaultsByTier(contract) {
	const tierNames = contract?.SB_TIER_NAMES ?? SB_TIER_NAMES
	const resolveTierDefaults = contract?.tierDefaults ?? tierDefaults
	const defaultsByTier = {}
	for (const tierName of tierNames) {
		defaultsByTier[tierName] = Boolean(resolveTierDefaults(tierName)?.glints)
	}
	return defaultsByTier
}

function shaderSeed() {
	return (glintSettings.seed % SHADER_SEED_MODULUS) + 0.5
}

function registerGlintFlag(installContext, contract) {
	const defaultsByTier = glintFlagDefaultsByTier(contract)
	installContext?.flags?.registerFlag?.({
		id: GLINT_FLAG_ID,
		owner: PHASE_ID,
		description: "cintilancia de microfacetas por densidade, com LOD multiescala",
		defaultsByTier,
	})
	return { flagId: GLINT_FLAG_ID, defaultsByTier }
}

function registerGlintUniforms(installContext) {
	installContext?.patch?.registerUniform?.(GLINT_UNIFORM_NAME, {
		owner: PHASE_ID,
		value: [glintSettings.glintDensity, glintSettings.glintRoughness, shaderSeed()],
	})
	installContext?.patch?.registerUniform?.(GLINT_LUT_UNIFORM_NAME, { owner: PHASE_ID, value: null })
	return { uniformNames: [GLINT_UNIFORM_NAME, GLINT_LUT_UNIFORM_NAME] }
}


function checkGlintAnchors(installContext) {
	const three = resolveThree(installContext)
	const reports = [GLINT_PARS_ANCHOR, GLINT_APPLY_ANCHOR].map(
		(anchorId) =>
			installContext?.patch?.checkAnchor?.(three, anchorId) ?? { anchorId, present: false, reason: "patch api ausente" },
	)
	const missing = reports.filter((report) => !report.present)
	return {
		ok: missing.length === 0,
		reports,
		missingAnchorIds: missing.map((report) => report.anchorId),
		missingReasons: missing.map((report) => `${report.anchorId}: ${report.reason}`),
	}
}

function registerGlintPatches(installContext, contract) {
	const resolvePatchOrder = contract?.patchOrderFor ?? patchOrderFor
	const definitions = [
		{
			id: GLINT_PARS_PATCH_ID,
			owner: PHASE_ID,
			anchor: GLINT_PARS_ANCHOR,
			order: resolvePatchOrder(PHASE_ID, 0),
			flagId: GLINT_FLAG_ID,
			declarations: SB_GLINT_UNIFORM_DECLARATIONS_GLSL,
			code: SB_GLINT_PARS_GLSL,
			materialPaths: [...GLINT_MATERIAL_PATHS],
			uniforms: { uSbGlint: GLINT_UNIFORM_NAME, uSbGlintLut: GLINT_LUT_UNIFORM_NAME },
		},
		{
			id: GLINT_APPLY_PATCH_ID,
			owner: PHASE_ID,
			anchor: GLINT_APPLY_ANCHOR,
			order: resolvePatchOrder(PHASE_ID, 1),
			flagId: GLINT_FLAG_ID,
			code: SB_GLINT_APPLY_GLSL,
			materialPaths: [...GLINT_MATERIAL_PATHS],
			uniforms: { uSbGlint: GLINT_UNIFORM_NAME, uSbGlintLut: GLINT_LUT_UNIFORM_NAME },
		},
	]
	const results = definitions.map((definition) => ({
		id: definition.id,
		anchor: definition.anchor,
		order: definition.order,
		...(installContext?.patch?.registerPatch?.(definition) ?? { accepted: false, reason: "patch api ausente" }),
	}))
	const refused = results.filter((result) => !result.accepted)
	return {
		results,
		acceptedIds: results.filter((result) => result.accepted).map((result) => result.id),
		refusedReasons: refused.map((result) => `${result.id}: ${result.reason}`),
		ok: refused.length === 0,
	}
}


function ensureGlintLutTexture(three) {
	if (glintLutTexture) return { created: false, ready: true, width: SB_GLINT_LUT_WIDTH, height: SB_GLINT_LUT_HEIGHT }
	if (!three?.DataTexture) return { created: false, ready: false, reason: "three indisponivel na instalacao" }
	const lut = buildGlintLutData()
	const texture = new three.DataTexture(lut.data, lut.width, lut.height, three.RGBAFormat, three.UnsignedByteType)
	texture.name = "sbGlintLut"
	texture.minFilter = three.NearestFilter
	texture.magFilter = three.NearestFilter
	texture.wrapS = three.ClampToEdgeWrapping
	texture.wrapT = three.ClampToEdgeWrapping
	texture.generateMipmaps = false
	if (three.NoColorSpace !== undefined) texture.colorSpace = three.NoColorSpace
	texture.needsUpdate = true
	glintLutTexture = texture
	glintPatchApi?.setUniform?.(GLINT_LUT_UNIFORM_NAME, texture)
	return { created: true, ready: true, width: lut.width, height: lut.height, byteLength: lut.byteLength }
}


function synchronizeGlintUniform() {
	if (!glintUniformNeedsUpload) return false
	const uploaded = glintPatchApi?.setUniform?.(GLINT_UNIFORM_NAME, [
		glintSettings.glintDensity,
		glintSettings.glintRoughness,
		shaderSeed(),
	])
	glintUniformNeedsUpload = false
	return Boolean(uploaded)
}

function registerGlintPass(installContext) {
	const result = installContext?.passes?.registerPass?.(GLINT_PASS_NAME, {
		owner: PHASE_ID,
		execute: (frameContext) => {
			ensureGlintLutTexture(frameContext?.THREE ?? resolveThree(installContext))
			synchronizeGlintUniform()
		},
	})
	return { passName: GLINT_PASS_NAME, ...(result ?? { accepted: false, reason: "pass api ausente" }) }
}

function reportBudget(installContext) {
	installContext?.telemetry?.textureUnit?.(GLINT_TEXTURE_UNIT_CONSUMER, GLINT_TEXTURE_UNIT_COUNT)
	installContext?.telemetry?.closureBytes?.(PHASE_ID, GLINT_CLOSURE_BYTES)
	return { textureUnits: GLINT_TEXTURE_UNIT_COUNT, closureBytes: GLINT_CLOSURE_BYTES }
}

function applyDensity(value) {
	const numericValue = Number(value)
	glintSettings.glintDensity = Number.isFinite(numericValue) && numericValue > 0 ? numericValue : 0
	glintUniformNeedsUpload = true
	return { ...glintSettings }
}

function applyRoughness(value) {
	const numericValue = Number(value)
	glintSettings.glintRoughness = Number.isFinite(numericValue) ? Math.min(Math.max(numericValue, 0), 1) : DEFAULT_GLINT_ROUGHNESS
	glintUniformNeedsUpload = true
	return { ...glintSettings }
}

function applySeed(value) {
	const numericValue = Number(value)
	glintSettings.seed = Number.isFinite(numericValue) ? Math.trunc(Math.abs(numericValue)) : SB_GLINT_DEFAULT_SEED
	glintUniformNeedsUpload = true
	return { ...glintSettings }
}

function publishGlintConsole(context) {
	const lab = typeof window === "undefined" ? null : getSubstrateHostSurface()
	if (!lab) return { published: false }
	lab.glints = {
		settings: () => ({ ...glintSettings }),
		density: (value) => applyDensity(value),
		roughness: (value) => applyRoughness(value),
		seed: (value) => applySeed(value),
		preset: (presetId) => {
			const preset = SB_SLAB_PRESETS?.[presetId]
			if (!preset) return { applied: false, reason: `preset de slab desconhecido: ${presetId}` }
			applyDensity(preset.glintDensity)
			applyRoughness(preset.glintRoughness)
			return { applied: true, presetId, ...glintSettings }
		},
		certification: context.certification,
		certify: () => certifyGlintModel({ gates: context.gates }),
		lut: () => ({ ...context.lutReport, uniform: GLINT_LUT_UNIFORM_NAME }),
		glsl: () => glintGlslReport(),
		lod: (footprintArea) => resolveGlintLod({ footprintArea }),
		levelCount: SB_GLINT_LOD_LEVEL_COUNT,
		baseCellSize: SB_GLINT_BASE_CELL_SIZE,
	}
	return { published: true }
}


function describeInstallation(context) {
	const { certification, anchorReport, patchReport, passReport, lutReport } = context
	const aliasingRange = certification.aliasing.standardDeviationRange
	const measurements = [
		`${patchReport.acceptedIds.length} patches em ${GLINT_PARS_ANCHOR}+${GLINT_APPLY_ANCHOR}`,
		`passe ${GLINT_PASS_NAME} ${passReport.accepted ? "aceito" : "recusado"}`,
		`${SB_GLINT_LOD_LEVEL_COUNT} niveis, celula base ${SB_GLINT_BASE_CELL_SIZE}`,
		`variancia temporal ${formatNumber(certification.temporal.variance, 6)} <= ${certification.gates.maxGlintTemporalVariance}`,
		`energia ${formatNumber(certification.unbiasedness.worstDeviation, 4)} <= ${certification.gates.maxEnergyDeviation}`,
		`ruido por LOD ${formatNumber(aliasingRange[0], 2)}-${formatNumber(aliasingRange[1], 2)}`,
		`salto de blend ${formatNumber(certification.continuity.worstJump, 9)}`,
		`LUT ${lutReport.width ?? SB_GLINT_LUT_WIDTH}x${lutReport.height ?? SB_GLINT_LUT_HEIGHT} erro ${formatNumber(certification.lut.worstError, 4)}`,
		`densidade inicial ${glintSettings.glintDensity}`,
	]
	const problems = [...certification.problems, ...anchorReport.missingReasons, ...patchReport.refusedReasons]
	if (!passReport.accepted) problems.push(`passe recusado: ${passReport.reason}`)
	const headline = problems.length === 0 ? "glints com LOD certificados" : `PORTAO NAO FECHADO: ${problems.join(" | ")}`
	return `${PHASE_ID} ${headline} (${measurements.join(", ")})`
}

export function installPhase(installContext) {
	try {
		const contract = installContext?.contract ?? null
		const gates = contract?.SB_GATES ?? SB_GATES
		glintPatchApi = installContext?.patch ?? null
		const certification = certifyGlintModel({ gates })
		const flagReport = registerGlintFlag(installContext, contract)
		const uniformReport = registerGlintUniforms(installContext)
		const anchorReport = checkGlintAnchors(installContext)
		const patchReport = anchorReport.ok
			? registerGlintPatches(installContext, contract)
			: { results: [], acceptedIds: [], refusedReasons: [], ok: false }
		const lutReport = ensureGlintLutTexture(resolveThree(installContext))
		synchronizeGlintUniform()
		const passReport = registerGlintPass(installContext)
		const budgetReport = reportBudget(installContext)
		if (patchReport.acceptedIds.length > 0) installContext?.patch?.healMaterials?.()
		const consoleReport = publishGlintConsole({ gates, certification, lutReport })
		return {
			summary: describeInstallation({ certification, anchorReport, patchReport, passReport, lutReport }),
			certification,
			anchors: anchorReport,
			patches: patchReport,
			pass: passReport,
			flag: flagReport,
			uniforms: uniformReport,
			lut: lutReport,
			budget: budgetReport,
			console: consoleReport,
			settings: { ...glintSettings },
		}
	} catch (installError) {
		return { summary: `${PHASE_ID} nao instalou: ${installError?.message ?? String(installError)}` }
	}
}
