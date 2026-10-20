import { createMaterialTexture } from "../sbMaterialTexture.js"
import { patchOrderFor } from "../sbMaterialContract.js"
import {
	SB_MATERIAL_BUFFER_TEXTURE_UNITS,
	SB_MATERIAL_BUFFER_UNIFORMS,
	closureRecordStrideBytes,
	describeMaterialBufferSummary,
	findMaterialBufferProblems,
	writeMaterialBuffer,
} from "../sbMaterialBufferCore.js"
import {
	SB_MATERIAL_BUFFER_PATCH_ANCHOR,
	describeMaterialBufferGlsl,
	sbMaterialBufferDeclarations,
	sbMaterialBufferPatchCode,
} from "../sbMaterialBufferGlsl.js"

export const PHASE_ID = "SB-F8"

const FLAG_ID = "SubstrateMaterialBuffer"
const PATCH_ID = "sb-f8-material-buffer"
const PASS_NAME = "materialBufferUpload"

const FLAG_DEFINITION = Object.freeze({
	id: FLAG_ID,
	owner: PHASE_ID,
	description: "Liga o buffer de material quantizado (textura de dados com os registros de closure).",
	defaultsByTier: Object.freeze({ fraco: false, medio: true, forte: true }),
})







function closureRecordsFrom(passContext) {
	const fromContext = passContext?.closures ?? passContext?.substrateTopology?.closures ?? passContext?.topology?.closures
	if (Array.isArray(fromContext) && fromContext.length > 0) return fromContext
	return [{ kind: "slab", header: { closureCount: 1, layerIndex: 0 }, parameters: {} }]
}

function createMaterialBufferUpload(patch, telemetry, THREE, materialRuntime) {
	const upload = THREE?.DataTexture ? createMaterialTexture(THREE) : null
	return function uploadMaterialBuffer(passContext) {
		if (materialRuntime) return materialRuntime.uploadFrame(passContext)
		try {
			const buffer = writeMaterialBuffer(closureRecordsFrom(passContext))
			if (upload) patch?.setUniform?.(SB_MATERIAL_BUFFER_UNIFORMS.buffer, upload.upload(buffer))
			patch?.setUniform?.(SB_MATERIAL_BUFFER_UNIFORMS.size, [buffer.width, buffer.height])
			telemetry?.closures?.({
				owner: PHASE_ID,
				closureCount: buffer.closureCount,
				strideBytes: buffer.strideBytes,
				byteLength: buffer.byteLength,
				textureWidth: buffer.width,
				textureHeight: buffer.height,
			})
			if (passContext) passContext.materialBuffer = buffer
			return passContext
		} catch (error) {
			telemetry?.error?.(PHASE_ID, "falha ao gravar o buffer de material: " + error.message)
			return null
		}
	}
}

function registerUniforms(patch) {
	if (patch?.registerUniform === undefined) return []
	patch.registerUniform(SB_MATERIAL_BUFFER_UNIFORMS.buffer, { owner: PHASE_ID, value: null })
	patch.registerUniform(SB_MATERIAL_BUFFER_UNIFORMS.size, { owner: PHASE_ID, value: [1, 1] })
	return Object.values(SB_MATERIAL_BUFFER_UNIFORMS)
}

function registerReaderPatch(patch) {
	if (patch?.registerPatch === undefined) return { accepted: false, reason: "bancada sem costurador de patch" }
	return patch.registerPatch({
		id: PATCH_ID,
		owner: PHASE_ID,
		anchor: SB_MATERIAL_BUFFER_PATCH_ANCHOR,
		order: patchOrderFor(PHASE_ID),
		flagId: FLAG_ID,
		declarations: sbMaterialBufferDeclarations(),
		code: sbMaterialBufferPatchCode(),
		uniforms: Object.values(SB_MATERIAL_BUFFER_UNIFORMS),
	})
}


export function installPhase(installContext = {}) {
	const { flags, patch, passes, telemetry } = installContext
	try {
		const problems = findMaterialBufferProblems()
		const summary = describeMaterialBufferSummary()

		flags?.registerFlag?.(FLAG_DEFINITION)
		const uniformNames = registerUniforms(patch)
		const patchResult = registerReaderPatch(patch)
		const passResult = passes?.registerPass?.(PASS_NAME, {
			owner: PHASE_ID,
			execute: createMaterialBufferUpload(patch, telemetry, installContext.THREE ?? installContext.bench?.THREE, installContext.materialRuntime),
		})

		telemetry?.textureUnit?.(PHASE_ID, SB_MATERIAL_BUFFER_TEXTURE_UNITS)
		telemetry?.closureBytes?.(PHASE_ID, closureRecordStrideBytes())
		problems.forEach((problem) => telemetry?.error?.(PHASE_ID, problem))

		return {
			summary: {
				flagId: FLAG_ID,
				patchOrder: patchOrderFor(PHASE_ID),
				patchAccepted: patchResult?.accepted ?? false,
				patchReason: patchResult?.reason ?? null,
				passAccepted: passResult?.accepted ?? false,
				passName: PASS_NAME,
				uniforms: uniformNames,
				textureUnits: SB_MATERIAL_BUFFER_TEXTURE_UNITS,
				recordBytes: summary.budget.recordBytes,
				strideBytes: summary.budget.strideBytes,
				paddingBytes: summary.budget.paddingBytes,
				headroomBytes: summary.budget.headroomBytes,
				fieldCount: summary.fieldCount,
				glsl: describeMaterialBufferGlsl(),
				problems,
			},
		}
	} catch (error) {
		telemetry?.error?.(PHASE_ID, "instalacao falhou: " + error.message)
		return { summary: { flagId: FLAG_ID, problems: ["instalacao falhou: " + error.message] } }
	}
}
