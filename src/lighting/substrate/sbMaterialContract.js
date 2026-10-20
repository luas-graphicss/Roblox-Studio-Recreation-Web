import { SB_MAX_TREE_DEPTH, SB_MAX_SLABS_PER_TREE, SB_SLAB_PARAMETER_NAMES } from "./authoring/sbAuthoringLimits.js"

import {
	SB_CLOSURE_LAYOUTS,
	closureLayoutBytes,
	closurePayloadFieldNames,
	closureLayoutProblems,
} from "./sbClosureLayouts.js"
import {
	SB_UNIFORM_NAMES,
	uniformNamingProblems,
	samplerUniformNames,
	uniformTextureUnitConsumer,
	samplerUniformsWithoutTextureUnitConsumer,
	declaredTextureUnitConsumers,
} from "./sbUniformNames.js"
import { SB_OPERATOR_REFUSALS, SB_TREE_REFUSALS, refusalCodeProblems } from "./sbOperatorRefusals.js"

function deepFreeze(value) {
	if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value
	Object.freeze(value)
	Object.values(value).forEach(deepFreeze)
	return value
}

function isDeeplyFrozen(value) {
	if (value === null || typeof value !== "object") return true
	if (!Object.isFrozen(value)) return false
	return Object.values(value).every(isDeeplyFrozen)
}

export const SB_CONTRACT_VERSION = 1
export const SB_CONTRACT_FROZEN_BY = "SB-F2"
export const SB_TIER_NAMES = ["fraco", "medio", "forte"]


export { SB_MAX_TREE_DEPTH, SB_MAX_SLABS_PER_TREE } from "./authoring/sbAuthoringLimits.js"
export const SB_MAX_CLOSURES_PER_PIXEL = 3
export const SB_CLOSURE_BYTES_CEILING = 64
export const SB_BYTES_PER_PIXEL_CEILING = SB_MAX_CLOSURES_PER_PIXEL * SB_CLOSURE_BYTES_CEILING


export const SB_TEXTURE_UNIT_CEILING = 16


export const SB_ENGINE_TEXTURE_OWNER = "engine"
export const SB_ENGINE_OWNED_TEXTURE_CONSUMERS = ["engineLtc"]










export const SB_RESERVED_TEXTURE_UNITS = {
	engineLtc: 2,
	materialBuffer: 1,
	slabMaps: 6,
	sheenLtc: 1,
	glintLut: 1,
	specularProfile: 1,
	subsurface: 1,
	translucency: 1,
	decalBuffer: 1,
}

export const SB_TEXTURE_UNIT_OWNERS = {
	engineLtc: SB_ENGINE_TEXTURE_OWNER,
	materialBuffer: "SB-F8",
	slabMaps: "SB-F28",
	sheenLtc: "SB-F13",
	glintLut: "SB-F15",
	specularProfile: "SB-F16",
	subsurface: "SB-F21",
	translucency: "SB-F23",
	decalBuffer: "SB-F29",
}


export { SB_SLAB_PARAMETER_NAMES } from "./authoring/sbAuthoringLimits.js"


export const SB_SLAB_PAYLOAD_FIELD_SOURCES = {
	normal: { source: "geometry", producer: "SB-F28", why: "vem do mapa de normal do slab, nao do painel de autoria" },
	tangent: { source: "geometry", producer: "SB-F11", why: "frame tangente derivado da malha para a anisotropia" },
	coverage: { source: "operator", producer: "SB-F18", why: "parametro do operador verticalLayering" },
	thickness: { source: "operator", producer: "SB-F18", why: "parametro do operador verticalLayering" },
	transmittanceColor: { source: "operator", producer: "SB-F18", why: "parametro do operador verticalLayering" },
}


export const SB_PATCH_ORDER = {
	"SB-F8": 80,
	"SB-F9": 90,
	"SB-F10": 100,
	"SB-F11": 110,
	"SB-F12": 120,
	"SB-F13": 130,
	"SB-F14": 140,
	"SB-F15": 150,
	"SB-F16": 160,
	"SB-F17": 170,
	"SB-F18": 180,
	"SB-F19": 190,
	"SB-F20": 200,
	"SB-F21": 210,
	"SB-F22": 220,
	"SB-F23": 230,
	"SB-F24": 240,
	"SB-F25": 250,
	"SB-F26": 260,
	"SB-F27": 270,
	"SB-F28": 280,
	"SB-F29": 290,
	"SB-F31": 310,
	"SB-F32": 320,
	"SB-F33": 330,
	"SB-F35": 350,
}


export const SB_PATCH_ORDER_BAND_SIZE = 10


export const SB_PASS_OWNERS = {
	materialTopologyResolve: "SB-F6",
	materialBufferUpload: "SB-F8",
	closureDispatchPrepare: "SB-F9",
	glintNoisePrepare: "SB-F15",
	specularProfileAtlas: "SB-F16",
	opaqueRoughRefraction: "SB-F19",
	subsurfaceScattering: "SB-F21",
	translucencyResolve: "SB-F23",
	lightingBridge: "SB-F31",
	debugVisualization: "SB-F35",
}


export const SB_PHASE_ID_PATTERN = /^SB-F([1-9]|[12][0-9]|3[0-7])$/


export const SB_TIER_DEFAULTS = {
	fraco: {
		substrateEnabled: false,
		closuresPerPixel: 1,
		closureBytes: 32,
		roughRefraction: false,
		glints: false,
		sheenQuality: "low",
		subsurfaceMode: "wrap",
		translucencyMode: "weightedBlended",
		simplification: "aggressive",
		debugVisualization: false,
		pixelRatio: 1,
		shadowMapSize: 512,
		frameBudgetMilliseconds: 16.6,
	},
	medio: {
		substrateEnabled: true,
		closuresPerPixel: 2,
		closureBytes: 48,
		roughRefraction: true,
		glints: false,
		sheenQuality: "low",
		subsurfaceMode: "screenSpace",
		translucencyMode: "sortedPixels",
		simplification: "balanced",
		debugVisualization: false,
		pixelRatio: 1.5,
		shadowMapSize: 1024,
		frameBudgetMilliseconds: 12,
	},
	forte: {
		substrateEnabled: true,
		closuresPerPixel: 3,
		closureBytes: 64,
		roughRefraction: true,
		glints: true,
		sheenQuality: "high",
		subsurfaceMode: "screenSpace",
		translucencyMode: "sortedPixels",
		simplification: "conservative",
		debugVisualization: true,
		pixelRatio: 2,
		shadowMapSize: 2048,
		frameBudgetMilliseconds: 8,
	},
}


export const SB_GATES = {
	flagOffMinimumSsim: 0.99999,
	parityMinimumSsim: 0.99,
	branchParityMinimumSsim: 0.999,
	maxEnergyDeviation: 0.05,
	maxMixingEnergyDeviation: 0.01,
	maxOperatorAlgebraEnergyDeviation: 0.01,
	maxDualLobeEnergyDeviation: 0.02,
	maxSheenEnergyDeviation: 0.03,
	maxClosureLightingEnergyDeviation: 0.03,
	maxReferenceEnergyDeviation: 0.02,
	maxPhotometryDeviation: 0.01,
	maxWaterAbsorptionDeviation: 0.05,
	minimumCoatDarkening: 0.05,
	anisotropyPoseMinimumSsim: 0.999,
	furnaceMinimum: 0.98,
	furnaceMaximum: 1.02,
	maxSimplificationDeltaE76: 2,
	maxThinFilmDeltaE76: 3,
	maxQuantizationErrorPerChannel: 1 / 255,
	maxTransmittanceAbsoluteError: 1e-3,
	maxDiffusionProfileDeviation: 0.05,
	maxGlintTemporalVariance: 0.02,
	maxFireflyLuminanceRatio: 0.001,
	maxProgramsPerMaterialFamily: 8,
	maxWarmupSpikeMilliseconds: 12,
	maxIdleOverheadMilliseconds: 0.5,
	blindRoundMinimumConfusionRate: 0.7,
	blindRoundMinimumEvaluators: 3,
	legacyConversionMinimumSsim: 0.99,
}


const ENERGY_DEVIATION_GATE_NAMES = [
	"maxMixingEnergyDeviation",
	"maxOperatorAlgebraEnergyDeviation",
	"maxDualLobeEnergyDeviation",
	"maxSheenEnergyDeviation",
	"maxClosureLightingEnergyDeviation",
	"maxReferenceEnergyDeviation",
	"maxPhotometryDeviation",
	"maxWaterAbsorptionDeviation",
	"maxDiffusionProfileDeviation",
]

export function tierDefaults(tierName) {
	return SB_TIER_DEFAULTS[tierName] ?? SB_TIER_DEFAULTS.medio
}

export function totalReservedTextureUnits() {
	return Object.values(SB_RESERVED_TEXTURE_UNITS).reduce((total, units) => total + units, 0)
}

export function textureUnitHeadroom() {
	return SB_TEXTURE_UNIT_CEILING - totalReservedTextureUnits()
}


export function patchOrderFor(phaseId, subSlot = 0) {
	const baseOrder = SB_PATCH_ORDER[phaseId]
	if (baseOrder === undefined) return null
	if (!Number.isInteger(subSlot) || 0 > subSlot) return null
	if (subSlot >= SB_PATCH_ORDER_BAND_SIZE) return null
	return baseOrder + subSlot
}

export function passOwner(passName) {
	return SB_PASS_OWNERS[passName] ?? null
}


export function slabClosureBytes() {
	return closureLayoutBytes("slab")
}

export function tierBytesPerPixel(tierName) {
	const defaults = tierDefaults(tierName)
	return defaults.closuresPerPixel * defaults.closureBytes
}


export function tierClosureHeadroomBytes(tierName) {
	return tierDefaults(tierName).closureBytes - slabClosureBytes()
}

export function bytesPerPixelByTier() {
	return Object.fromEntries(SB_TIER_NAMES.map((tierName) => [tierName, tierBytesPerPixel(tierName)]))
}

export function closureHeadroomBytesByTier() {
	return Object.fromEntries(SB_TIER_NAMES.map((tierName) => [tierName, tierClosureHeadroomBytes(tierName)]))
}

function textureUnitProblems() {
	const problems = []

	if (totalReservedTextureUnits() > SB_TEXTURE_UNIT_CEILING) {
		problems.push(
			"reserva de texturas estoura o teto: " + totalReservedTextureUnits() + " de " + SB_TEXTURE_UNIT_CEILING,
		)
	}

	for (const [consumerId, owner] of Object.entries(SB_TEXTURE_UNIT_OWNERS)) {
		if (!(consumerId in SB_RESERVED_TEXTURE_UNITS)) {
			problems.push("dono declarado para consumidor inexistente: " + consumerId + " (" + owner + ")")
		}
	}

	for (const consumerId of Object.keys(SB_RESERVED_TEXTURE_UNITS)) {
		if (!(consumerId in SB_TEXTURE_UNIT_OWNERS)) {
			problems.push("reserva de textura sem dono: " + consumerId)
		}
	}

	for (const uniformName of samplerUniformsWithoutTextureUnitConsumer()) {
		problems.push("uniform de textura sem consumidor declarado: " + uniformName)
	}

	for (const uniformName of samplerUniformNames()) {
		const consumerId = uniformTextureUnitConsumer(uniformName)
		if (consumerId && !(consumerId in SB_RESERVED_TEXTURE_UNITS)) {
			problems.push("uniform " + uniformName + " aponta consumidor sem reserva: " + consumerId)
		}
	}

	const usedConsumers = new Set(declaredTextureUnitConsumers())
	for (const consumerId of Object.keys(SB_RESERVED_TEXTURE_UNITS)) {
		if (SB_ENGINE_OWNED_TEXTURE_CONSUMERS.includes(consumerId)) continue
		if (!usedConsumers.has(consumerId)) {
			problems.push("reserva de textura que nenhum uniform consome: " + consumerId)
		}
	}

	return problems
}

function patchOrderProblems() {
	const problems = []
	const seenOrders = new Map()

	for (const [phaseId, order] of Object.entries(SB_PATCH_ORDER)) {
		if (seenOrders.has(order)) {
			problems.push("ordem de patch duplicada " + order + ": " + seenOrders.get(order) + " e " + phaseId)
		}
		seenOrders.set(order, phaseId)
	}

	const sortedOrders = Object.values(SB_PATCH_ORDER)
		.slice()
		.sort((left, right) => left - right)
	const gaps = sortedOrders.slice(1).map((order, offset) => order - sortedOrders[offset])
	for (const gap of gaps) {
		if (SB_PATCH_ORDER_BAND_SIZE > gap) {
			problems.push("faixas de ordem de patch encostadas: folga de apenas " + gap)
		}
	}

	return problems
}

function tierProblems() {
	const problems = []

	for (const tierName of SB_TIER_NAMES) {
		const defaults = SB_TIER_DEFAULTS[tierName]
		if (!defaults) {
			problems.push("tier sem defaults: " + tierName)
			continue
		}
		if (defaults.closuresPerPixel > SB_MAX_CLOSURES_PER_PIXEL) {
			problems.push("tier " + tierName + " pede mais closures que o teto")
		}
		if (defaults.closureBytes > SB_CLOSURE_BYTES_CEILING) {
			problems.push("tier " + tierName + " pede mais bytes por closure que o teto")
		}
		if (tierBytesPerPixel(tierName) > SB_BYTES_PER_PIXEL_CEILING) {
			problems.push(
				"tier " + tierName + " custa " + tierBytesPerPixel(tierName) + " bytes por pixel, acima do teto",
			)
		}
		if (defaults.substrateEnabled && slabClosureBytes() > defaults.closureBytes) {
			problems.push(
				"tier " +
					tierName +
					" liga o Substrate com " +
					defaults.closureBytes +
					" bytes por closure, mas um slab ocupa " +
					slabClosureBytes(),
			)
		}
	}

	if (SB_TIER_DEFAULTS.fraco.substrateEnabled) {
		problems.push("tier fraco nao pode nascer com o Substrate ligado")
	}

	return problems
}

function closureBudgetProblems() {
	const problems = []
	for (const [kind, layout] of Object.entries(SB_CLOSURE_LAYOUTS)) {
		const bytes = closureLayoutBytes(kind)
		if (bytes > SB_CLOSURE_BYTES_CEILING) {
			problems.push("layout " + kind + " ocupa " + bytes + " bytes, acima do teto")
		}
		if (!layout.owner) problems.push("layout sem fase dona: " + kind)
	}
	return problems
}

function slabParameterProblems() {
	const problems = []
	const payloadFieldNames = closurePayloadFieldNames("slab")
	const payloadFields = new Set(payloadFieldNames)

	if (new Set(SB_SLAB_PARAMETER_NAMES).size !== SB_SLAB_PARAMETER_NAMES.length) {
		problems.push("parametro de slab duplicado")
	}

	for (const parameterName of SB_SLAB_PARAMETER_NAMES) {
		if (!payloadFields.has(parameterName)) {
			problems.push("parametro de slab sem campo no payload: " + parameterName)
		}
	}

	const authoredParameters = new Set(SB_SLAB_PARAMETER_NAMES)
	for (const fieldName of payloadFieldNames) {
		if (authoredParameters.has(fieldName)) continue
		if (!(fieldName in SB_SLAB_PAYLOAD_FIELD_SOURCES)) {
			problems.push("campo do payload do slab sem parametro nem origem declarada: " + fieldName)
		}
	}

	for (const fieldName of Object.keys(SB_SLAB_PAYLOAD_FIELD_SOURCES)) {
		if (!payloadFields.has(fieldName)) {
			problems.push("origem declarada para campo inexistente no slab: " + fieldName)
		}
		if (authoredParameters.has(fieldName)) {
			problems.push("campo declarado como nao autorado, mas esta na lista de parametros: " + fieldName)
		}
	}

	return problems
}


function ownerShapeProblems() {
	const problems = []
	const citedOwners = new Set([
		...Object.keys(SB_PATCH_ORDER),
		...Object.values(SB_PASS_OWNERS),
		...Object.values(SB_TEXTURE_UNIT_OWNERS),
		...Object.values(SB_UNIFORM_NAMES).map((entry) => entry.owner),
		...Object.values(SB_CLOSURE_LAYOUTS).map((layout) => layout.owner),
		...Object.values(SB_OPERATOR_REFUSALS).map((operator) => operator.owner),
		...Object.values(SB_SLAB_PAYLOAD_FIELD_SOURCES).map((field) => field.producer),
		SB_TREE_REFUSALS.owner,
	])

	for (const owner of citedOwners) {
		if (owner === SB_ENGINE_TEXTURE_OWNER) continue
		if (!SB_PHASE_ID_PATTERN.test(owner)) {
			problems.push("dono citado no contrato nao parece uma fase do Substrate: " + owner)
		}
	}

	return problems
}

function gateProblems() {
	const problems = []

	if (SB_GATES.parityMinimumSsim >= SB_GATES.flagOffMinimumSsim) {
		problems.push("o portao de flag OFF tem de ser o mais duro")
	}
	if (SB_GATES.furnaceMinimum >= 1 || 1 >= SB_GATES.furnaceMaximum) {
		problems.push("a faixa de furnace tem de conter 1")
	}
	if (SB_GATES.maxSimplificationDeltaE76 > SB_GATES.maxThinFilmDeltaE76) {
		problems.push("portoes de cor invertidos")
	}

	for (const gateName of ENERGY_DEVIATION_GATE_NAMES) {
		const value = SB_GATES[gateName]
		if (typeof value !== "number" || 0 >= value) {
			problems.push("portao de energia ausente ou nao positivo: " + gateName)
			continue
		}
		if (value > SB_GATES.maxEnergyDeviation) {
			problems.push("portao " + gateName + " e mais frouxo que o guarda-chuva maxEnergyDeviation")
		}
	}

	return problems
}


export function contractSelfCheck() {
	const problems = [
		...textureUnitProblems(),
		...patchOrderProblems(),
		...tierProblems(),
		...closureBudgetProblems(),
		...closureLayoutProblems(),
		...slabParameterProblems(),
		...ownerShapeProblems(),
		...gateProblems(),
		...refusalCodeProblems(),
		...uniformNamingProblems().map((uniformName) => "uniform sem o prefixo do Substrate: " + uniformName),
	]

	for (const [passName, owner] of Object.entries(SB_PASS_OWNERS)) {
		if (!owner) problems.push("passe sem dono: " + passName)
	}

	return { ok: problems.length === 0, problems }
}


const FROZEN_STRUCTURES = {
	SB_TIER_NAMES,
	SB_RESERVED_TEXTURE_UNITS,
	SB_TEXTURE_UNIT_OWNERS,
	SB_SLAB_PARAMETER_NAMES,
	SB_SLAB_PAYLOAD_FIELD_SOURCES,
	SB_PATCH_ORDER,
	SB_PASS_OWNERS,
	SB_TIER_DEFAULTS,
	SB_GATES,
	SB_CLOSURE_LAYOUTS,
	SB_UNIFORM_NAMES,
	SB_OPERATOR_REFUSALS,
	SB_TREE_REFUSALS,
}


export function contractFreezeReport() {
	const unfrozenStructures = Object.entries(FROZEN_STRUCTURES)
		.filter(([, structure]) => !isDeeplyFrozen(structure))
		.map(([structureName]) => structureName)

	return {
		version: SB_CONTRACT_VERSION,
		frozenBy: SB_CONTRACT_FROZEN_BY,
		structureCount: Object.keys(FROZEN_STRUCTURES).length,
		frozen: unfrozenStructures.length === 0,
		unfrozenStructures,
	}
}

export function describeContract() {
	return {
		version: SB_CONTRACT_VERSION,
		frozenBy: SB_CONTRACT_FROZEN_BY,
		tiers: SB_TIER_NAMES,
		tierDefaults: SB_TIER_DEFAULTS,
		limits: {
			maxTreeDepth: SB_MAX_TREE_DEPTH,
			maxSlabsPerTree: SB_MAX_SLABS_PER_TREE,
			maxClosuresPerPixel: SB_MAX_CLOSURES_PER_PIXEL,
			closureBytesCeiling: SB_CLOSURE_BYTES_CEILING,
			bytesPerPixelCeiling: SB_BYTES_PER_PIXEL_CEILING,
			textureUnitCeiling: SB_TEXTURE_UNIT_CEILING,
		},
		textureUnits: {
			reserved: SB_RESERVED_TEXTURE_UNITS,
			owners: SB_TEXTURE_UNIT_OWNERS,
			total: totalReservedTextureUnits(),
			headroom: textureUnitHeadroom(),
		},
		closureBudget: {
			slabClosureBytes: slabClosureBytes(),
			bytesPerPixelByTier: bytesPerPixelByTier(),
			closureHeadroomBytesByTier: closureHeadroomBytesByTier(),
		},
		slabParameters: SB_SLAB_PARAMETER_NAMES,
		slabParameterCount: SB_SLAB_PARAMETER_NAMES.length,
		slabPayloadFieldSources: SB_SLAB_PAYLOAD_FIELD_SOURCES,
		closureLayouts: SB_CLOSURE_LAYOUTS,
		uniformNames: SB_UNIFORM_NAMES,
		operatorRefusals: SB_OPERATOR_REFUSALS,
		treeRefusals: SB_TREE_REFUSALS,
		patchOrder: SB_PATCH_ORDER,
		patchOrderBandSize: SB_PATCH_ORDER_BAND_SIZE,
		passOwners: SB_PASS_OWNERS,
		gates: SB_GATES,
		selfCheck: contractSelfCheck(),
		freeze: contractFreezeReport(),
	}
}

deepFreeze(SB_TIER_NAMES)
deepFreeze(SB_ENGINE_OWNED_TEXTURE_CONSUMERS)
deepFreeze(SB_RESERVED_TEXTURE_UNITS)
deepFreeze(SB_TEXTURE_UNIT_OWNERS)
deepFreeze(SB_SLAB_PARAMETER_NAMES)
deepFreeze(SB_SLAB_PAYLOAD_FIELD_SOURCES)
deepFreeze(SB_PATCH_ORDER)
deepFreeze(SB_PASS_OWNERS)
deepFreeze(SB_TIER_DEFAULTS)
deepFreeze(SB_GATES)

export { SB_CLOSURE_LAYOUTS, SB_UNIFORM_NAMES, SB_OPERATOR_REFUSALS, SB_TREE_REFUSALS }
