import { SB_RESERVED_TEXTURE_UNITS } from "./sbMaterialContract.js"
import { SB_SLAB_MAP_TEXTURE_CONSUMER, slabMapSlot, slabMapSlotNames, slabMapSlotsForTier } from "./sbSlabMapPlanCore.js"
import { buildSlabMapRuntimeGlsl, slabMapSamplerName } from "./sbSlabMapGlsl.js"

export const SB_SLAB_MAP_MATERIAL_DATA_KEY = "sbSlabMaps"
export const SB_SLAB_MAP_ENGINE_REUSED_SLOT = "slabBaseColor"
export const SB_SLAB_MAP_RUNTIME_TIERS = Object.freeze(["fraco", "medio", "forte"])

export const SB_SLAB_MAP_REFUSALS = Object.freeze({
	unknownSlot: "unknownSlot",
	notResident: "notResident",
	notTexture: "notTexture",
	engineOwnedSlot: "engineOwnedSlot",
	overReserve: "overReserve",
})

export function slabMapRuntimeSlots(tierName) {
	return slabMapSlotsForTier(tierName).filter((slotName) => slotName !== SB_SLAB_MAP_ENGINE_REUSED_SLOT)
}

export function slabMapRuntimeCeiling(tierName) {
	const reserved = SB_RESERVED_TEXTURE_UNITS[SB_SLAB_MAP_TEXTURE_CONSUMER] ?? 0
	return Math.min(reserved, slabMapRuntimeSlots(tierName).length)
}

export function slabMapSamplerNames(tierName) {
	return slabMapRuntimeSlots(tierName).map((slotName) => slabMapSamplerName(slotName))
}

export function slabMapAllSamplerNames() {
	return slabMapSlotNames().filter((slotName) => slotName !== SB_SLAB_MAP_ENGINE_REUSED_SLOT).map((slotName) => slabMapSamplerName(slotName))
}

function isTexture(candidate) {
	return Boolean(candidate) && "object" === typeof candidate && candidate.isTexture === true
}

export function resolveMaterialSlabMaps(materialData, tierName) {
	const authored = materialData?.[SB_SLAB_MAP_MATERIAL_DATA_KEY]
	const resident = slabMapRuntimeSlots(tierName)
	const ceiling = slabMapRuntimeCeiling(tierName)
	const bound = []
	const refusals = []
	const textures = new Map()
	if (authored && "object" === typeof authored) {
		for (const slotName of Object.keys(authored)) {
			const texture = authored[slotName]
			if (!slabMapSlotNames().includes(slotName)) {
				refusals.push({ slot: slotName, code: SB_SLAB_MAP_REFUSALS.unknownSlot })
				continue
			}
			if (SB_SLAB_MAP_ENGINE_REUSED_SLOT === slotName) {
				refusals.push({ slot: slotName, code: SB_SLAB_MAP_REFUSALS.engineOwnedSlot })
				continue
			}
			if (!isTexture(texture)) {
				refusals.push({ slot: slotName, code: SB_SLAB_MAP_REFUSALS.notTexture })
				continue
			}
			if (!resident.includes(slotName)) {
				refusals.push({ slot: slotName, code: SB_SLAB_MAP_REFUSALS.notResident })
				continue
			}
			if (bound.length >= ceiling) {
				refusals.push({ slot: slotName, code: SB_SLAB_MAP_REFUSALS.overReserve })
				continue
			}
			bound.push(slotName)
			textures.set(slotName, texture)
		}
	}
	const ordered = slabMapSlotNames().filter((slotName) => bound.includes(slotName))
	return { tier: tierName, resident, bound: ordered, refusals, textures, units: ordered.length, ceiling, key: ordered.join("+") }
}

export function bindSlabMapUniforms({ THREE, materialData, tierName, uniforms }) {
	const resolution = resolveMaterialSlabMaps(materialData, tierName)
	for (const samplerName of slabMapAllSamplerNames()) {
		if (!uniforms[samplerName]) uniforms[samplerName] = { value: null }
		uniforms[samplerName].value = null
	}
	for (const slotName of resolution.bound) {
		const texture = resolution.textures.get(slotName)
		if (THREE) {
			const wanted = "srgb" === slabMapSlot(slotName).colorSpace ? THREE.SRGBColorSpace : THREE.LinearSRGBColorSpace
			if (texture.colorSpace !== wanted) {
				texture.colorSpace = wanted
				texture.needsUpdate = true
			}
		}
		uniforms[slabMapSamplerName(slotName)].value = texture
	}
	return resolution
}

export function slabMapRuntimeProblems() {
	const problems = []
	const reserved = SB_RESERVED_TEXTURE_UNITS[SB_SLAB_MAP_TEXTURE_CONSUMER] ?? 0
	for (const tierName of SB_SLAB_MAP_RUNTIME_TIERS) {
		const slots = slabMapRuntimeSlots(tierName)
		if (slots.length > reserved) problems.push("o tier " + tierName + " tem " + slots.length + " slots amarraveis e a reserva slabMaps e de " + reserved)
		const glsl = buildSlabMapRuntimeGlsl({ boundSlots: slots, availableFields: ["albedo", "f0", "f90", "roughness", "anisotropy", "anisotropyRotation", "fuzzColor", "fuzzAmount", "subsurfaceMeanFreePath", "subsurfacePhase", "thinFilmThicknessNanometers", "thinFilmIor", "glintDensity", "glintRoughness"] })
		if (glsl.samplers.length !== slots.length) problems.push("o tier " + tierName + " declarou " + glsl.samplers.length + " samplers para " + slots.length + " slots")
		for (const sampler of glsl.samplers) {
			if (!glsl.apply.includes("texture2D( " + sampler + ",")) problems.push("o sampler " + sampler + " foi declarado e nao amostrado")
		}
	}
	const names = slabMapAllSamplerNames()
	if (new Set(names).size !== names.length) problems.push("nomes de sampler repetidos entre slots")
	return problems
}

export function describeSlabMapRuntime() {
	const tiers = {}
	for (const tierName of SB_SLAB_MAP_RUNTIME_TIERS) {
		tiers[tierName] = { slots: slabMapRuntimeSlots(tierName), samplers: slabMapSamplerNames(tierName), ceiling: slabMapRuntimeCeiling(tierName) }
	}
	return {
		materialDataKey: SB_SLAB_MAP_MATERIAL_DATA_KEY,
		engineReusedSlot: SB_SLAB_MAP_ENGINE_REUSED_SLOT,
		samplers: slabMapAllSamplerNames(),
		refusals: SB_SLAB_MAP_REFUSALS,
		tiers,
	}
}
