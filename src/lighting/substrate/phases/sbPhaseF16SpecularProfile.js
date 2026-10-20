import { getSubstrateHostSurface } from "../runtime/substrateHostSurface.js";


import { patchOrderFor } from "../sbMaterialContract.js"
import {
	SB_SPECULAR_PROFILE_NEUTRAL_INDEX,
	describeSpecularProfileCatalog,
	findSpecularProfileCatalogProblems,
	resolveSpecularProfileIndex,
	specularProfileAt,
	specularProfileCount,
} from "../sbSpecularProfileCatalog.js"
import {
	SB_SPECULAR_PROFILE_CLOSURE_BYTES,
	SB_SPECULAR_PROFILE_TEXTURE_UNITS,
	buildSpecularProfileAtlas,
	compareSpecularProfiles,
	describeSpecularProfileLut,
	findSpecularProfileEncodingProblems,
	sampleSpecularProfileGain,
} from "../sbSpecularProfileCore.js"
import {
	SB_SPECULAR_PROFILE_APPLICATION,
	SB_SPECULAR_PROFILE_DECLARATIONS,
	SB_SPECULAR_PROFILE_INDEX_UNIFORM_NAME,
	SB_SPECULAR_PROFILE_SAMPLER_UNIFORM_NAME,
} from "../sbSpecularProfileGlsl.js"

export const PHASE_ID = "SB-F16"
export const PASS_NAME = "specularProfileAtlas"

const SPECULAR_PROFILE_FLAG = Object.freeze({
	id: "SubstrateSpecularProfile",
	owner: PHASE_ID,
	description: "LUT de resposta especular por angulo de vista e de luz, trocavel em runtime",
	defaultsByTier: Object.freeze({ fraco: false, medio: false, forte: false }),
})


const DECLARATION_ANCHOR = "common"
const APPLICATION_ANCHOR = "lightsFragmentEnd"
const DECLARATION_PATCH_ID = "sbF16SpecularProfileDeclarations"
const APPLICATION_PATCH_ID = "sbF16SpecularProfileApplication"


const TARGET_MATERIAL_PATHS = Object.freeze(["standard", "poolPhong", "physical", "terreno", "skinned"])


const DEFAULT_SELECTED_PROFILE_INDEX = specularProfileCount() > 1 ? 1 : SB_SPECULAR_PROFILE_NEUTRAL_INDEX

const PATCH_UNIFORM_NAMES = Object.freeze([
	SB_SPECULAR_PROFILE_SAMPLER_UNIFORM_NAME,
	SB_SPECULAR_PROFILE_INDEX_UNIFORM_NAME,
])

function resolvePatchOrder(contract) {
	const contractPatchOrderFor = contract?.patchOrderFor ?? patchOrderFor
	return contractPatchOrderFor(PHASE_ID)
}


function createSpecularProfileAtlasUploader(atlas) {
	let texture = null
	let uploadedSignature = null

	function createTexture(three) {
		const created = new three.DataTexture(atlas.data, atlas.width, atlas.height, three.RGBAFormat, three.UnsignedByteType)
		created.name = "sbSpecularProfileAtlas"
		created.magFilter = three.LinearFilter
		created.minFilter = three.LinearFilter
		created.wrapS = three.ClampToEdgeWrapping
		created.wrapT = three.ClampToEdgeWrapping
		created.generateMipmaps = false
		created.flipY = false

		if (three.NoColorSpace !== undefined) created.colorSpace = three.NoColorSpace
		created.needsUpdate = true
		return created
	}

	return {
		ensureUploaded(three) {
			if (!three || !three.DataTexture) return { uploaded: false, reason: "three indisponivel", texture }
			if (texture && uploadedSignature === atlas.signature) return { uploaded: false, reason: "atlas ja enviado", texture }
			if (texture) texture.dispose()
			texture = createTexture(three)
			uploadedSignature = atlas.signature
			return { uploaded: true, reason: "atlas enviado", texture }
		},
		texture() {
			return texture
		},
		uploadedSignature() {
			return uploadedSignature
		},
	}
}


function createSpecularProfileSelector(patch) {
	let selectedProfileIndex = DEFAULT_SELECTED_PROFILE_INDEX

	function describeSelection() {
		const profile = specularProfileAt(selectedProfileIndex)
		return {
			index: selectedProfileIndex,
			id: profile?.id ?? null,
			label: profile?.label ?? null,
			neutral: selectedProfileIndex === SB_SPECULAR_PROFILE_NEUTRAL_INDEX,
		}
	}

	return {
		index() {
			return selectedProfileIndex
		},
		current: describeSelection,
		select(profileIdOrIndex) {
			selectedProfileIndex = resolveSpecularProfileIndex(profileIdOrIndex)
			patch?.setUniform?.(SB_SPECULAR_PROFILE_INDEX_UNIFORM_NAME, selectedProfileIndex)
			return describeSelection()
		},
	}
}


function findInstallRefusal(three, patch, anchorReport) {
	if (!three) return "three indisponivel: a bancada nao expos bench.THREE"
	if (!patch?.registerPatch || !patch?.registerUniform) return "harness de patch indisponivel"

	for (const anchorId of [DECLARATION_ANCHOR, APPLICATION_ANCHOR]) {
		anchorReport[anchorId] = patch.checkAnchor?.(three, anchorId) ?? {
			anchorId,
			present: false,
			reason: "checkAnchor indisponivel",
		}
	}
	const missingAnchors = Object.values(anchorReport).filter((anchor) => !anchor.present)
	if (missingAnchors.length === 0) return null
	return "ancora ausente: " + missingAnchors.map((anchor) => anchor.anchorId + " (" + anchor.reason + ")").join(", ")
}

function createSpecularProfileConsole(atlas, selector) {
	return {
		list: () => describeSpecularProfileCatalog(),
		current: () => selector.current(),
		select: (profileIdOrIndex) => selector.select(profileIdOrIndex),
		lut: () => describeSpecularProfileLut(atlas),
		sample: (cosThetaView, cosThetaLight, profileIdOrIndex) =>
			sampleSpecularProfileGain(
				atlas,
				resolveSpecularProfileIndex(profileIdOrIndex ?? selector.index()),
				cosThetaView,
				cosThetaLight,
			),
		compare: (leftProfile, rightProfile) =>
			compareSpecularProfiles(
				atlas,
				resolveSpecularProfileIndex(leftProfile),
				resolveSpecularProfileIndex(rightProfile ?? SB_SPECULAR_PROFILE_NEUTRAL_INDEX),
			),
	}
}

function publishSpecularProfileConsole(consoleApi) {
	if (typeof window === "undefined" || !getSubstrateHostSurface()) return false
	getSubstrateHostSurface().specularProfile = consoleApi
	return true
}

export function installPhase(installContext = {}) {
	const { flags, patch, passes, telemetry, bench, contract } = installContext
	const selector = createSpecularProfileSelector(patch)
	const anchors = {}
	let consoleApi = null
	let lut = null
	let problems = []
	let patchOrder = null
	let refusalReason = null
	let passRegistered = false
	let consolePublished = false
	let installed = false

	try {
		const atlas = buildSpecularProfileAtlas()
		const uploader = createSpecularProfileAtlasUploader(atlas)
		lut = describeSpecularProfileLut(atlas)
		problems = [...findSpecularProfileCatalogProblems(), ...findSpecularProfileEncodingProblems(atlas)]
		patchOrder = resolvePatchOrder(contract)

		const three = bench?.THREE ?? null
		refusalReason = findInstallRefusal(three, patch, anchors)

		if (!refusalReason) {


			const initialUpload = uploader.ensureUploaded(three)
			flags?.registerFlag?.(SPECULAR_PROFILE_FLAG)
			patch.registerUniform(SB_SPECULAR_PROFILE_SAMPLER_UNIFORM_NAME, { owner: PHASE_ID, value: initialUpload.texture })
			patch.registerUniform(SB_SPECULAR_PROFILE_INDEX_UNIFORM_NAME, { owner: PHASE_ID, value: selector.index() })


			const declarationPatch = patch.registerPatch({
				id: DECLARATION_PATCH_ID,
				owner: PHASE_ID,
				anchor: DECLARATION_ANCHOR,
				order: patchOrder,
				flagId: SPECULAR_PROFILE_FLAG.id,
				declarations: SB_SPECULAR_PROFILE_DECLARATIONS,
				materialPaths: [...TARGET_MATERIAL_PATHS],
				uniforms: [...PATCH_UNIFORM_NAMES],
			})
			const applicationPatch = patch.registerPatch({
				id: APPLICATION_PATCH_ID,
				owner: PHASE_ID,
				anchor: APPLICATION_ANCHOR,
				order: patchOrder,
				flagId: SPECULAR_PROFILE_FLAG.id,
				code: SB_SPECULAR_PROFILE_APPLICATION,
				materialPaths: [...TARGET_MATERIAL_PATHS],
				uniforms: [...PATCH_UNIFORM_NAMES],
			})

			if (declarationPatch?.accepted && applicationPatch?.accepted) {

				const passResult = passes?.registerPass?.(PASS_NAME, {
					owner: PHASE_ID,
					execute: (passContext) => {
						const upload = uploader.ensureUploaded(passContext?.THREE ?? three)
						if (upload.uploaded && upload.texture) {
							patch.setUniform?.(SB_SPECULAR_PROFILE_SAMPLER_UNIFORM_NAME, upload.texture)
						}
						return passContext
					},
				})
				passRegistered = Boolean(passResult?.accepted)

				patch.healMaterials?.()
				installed = true
			} else {
				refusalReason = declarationPatch?.reason ?? applicationPatch?.reason ?? "patch recusado"
			}

			consoleApi = createSpecularProfileConsole(atlas, selector)
			consolePublished = publishSpecularProfileConsole(consoleApi)
		}

		telemetry?.textureUnit?.(PHASE_ID, installed ? SB_SPECULAR_PROFILE_TEXTURE_UNITS : 0)

		telemetry?.closureBytes?.(PHASE_ID, SB_SPECULAR_PROFILE_CLOSURE_BYTES)
		problems.forEach((problem) => telemetry?.error?.(PHASE_ID, problem))
		if (refusalReason) telemetry?.error?.(PHASE_ID, "fase sem runtime: " + refusalReason)
	} catch (installError) {
		refusalReason = "falha ao instalar: " + (installError && installError.message)
		telemetry?.error?.(PHASE_ID, refusalReason)
	}

	return {


		specularProfile: consoleApi,
		summary: {
			phaseId: PHASE_ID,
			flagId: SPECULAR_PROFILE_FLAG.id,
			installed,
			refusalReason,
			pass: PASS_NAME,
			passRegistered,
			consolePublished,
			patchOrder,
			anchors,
			materialPaths: [...TARGET_MATERIAL_PATHS],
			uniforms: [...PATCH_UNIFORM_NAMES],
			profileCount: specularProfileCount(),
			profiles: describeSpecularProfileCatalog(),
			selectedProfile: selector.current(),
			lut,
			textureUnits: installed ? SB_SPECULAR_PROFILE_TEXTURE_UNITS : 0,
			closureBytes: SB_SPECULAR_PROFILE_CLOSURE_BYTES,
			declaredResidues: [
				"SB-F10 engine direct lighting samples the LUT per punctual light; RectAreaLight uses its center direction, not integration over the emitting area",
				"environment and denoised MegaLights history retain a mirrored representative direction; per-light history reconstruction, integrated IBL response and native GPU reference coverage remain pending",
				"hosts without engine direct-light composition retain aggregate modulation; native Phong is not GGX parity",
			],
			problems,
		},
	}
}
