import { closurePayloadFieldNames } from "./sbClosureLayouts.js"
import { SB_TIER_NAMES, SB_RESERVED_TEXTURE_UNITS } from "./sbMaterialContract.js"

function deepFreeze(value) {
	if (value === null || typeof value !== "object" || Object.isFrozen(value)) return value
	Object.freeze(value)
	Object.values(value).forEach(deepFreeze)
	return value
}


export const SB_SLAB_MAP_SLOT_PREFIX = "slab"


export const SB_SLAB_MAP_CHANNELS = ["r", "g", "b", "a"]


export const SB_SLAB_MAP_TEXTURE_CONSUMER = "slabMaps"


export const SB_SLAB_MAP_COLOR_SPACES = ["srgb", "linear"]


const SLOT_DEFINITIONS = {
	slabBaseColor: {
		reusedEngineSlot: "map",
		colorSpace: "srgb",
		residentTiers: ["medio", "forte"],
		why: "albedo e opacidade sao os dois campos que todo slab autora",
		channels: [
			{ channel: "r", target: "albedo", component: 0 },
			{ channel: "g", target: "albedo", component: 1 },
			{ channel: "b", target: "albedo", component: 2 },
			{ channel: "a", target: "opacity", component: 0 },
		],
	},

	slabOrm: {
		reusedEngineSlot: "ormMap",
		colorSpace: "linear",
		residentTiers: ["medio", "forte"],
		why: "packing ORM do glTF, ja detectado pelo IL-F10 quando roughness e metalness apontam para o mesmo asset",
		channels: [
			{
				channel: "r",
				target: null,
				role: "ambientOcclusion",
				why: "multiplica a irradiancia indireta e pertence ao IL-F10, nao e campo do payload do slab",
			},
			{ channel: "g", target: "roughness", component: 0 },
			{ channel: "b", target: "f0", component: 0, derivation: "metalnessToF0" },
			{ channel: "a", target: "f90", component: 0 },
		],
	},

	slabNormalAnisotropy: {
		reusedEngineSlot: "normalMap",
		colorSpace: "linear",
		residentTiers: ["medio", "forte"],
		why: "normal em duas componentes com z reconstruido, sobrando dois canais para a anisotropia",
		channels: [
			{ channel: "r", target: "normal", component: 0 },
			{ channel: "g", target: "normal", component: 1 },
			{ channel: "b", target: "anisotropy", component: 0 },
			{ channel: "a", target: "anisotropyRotation", component: 0 },
		],
	},

	slabFeatures: {
		reusedEngineSlot: "iridescenceMap",
		colorSpace: "linear",
		residentTiers: ["medio", "forte"],
		why: "quatro escalares de feature que nunca precisam de cor: filme fino e glints",
		channels: [
			{ channel: "r", target: "thinFilmThicknessNanometers", component: 0 },
			{ channel: "g", target: "thinFilmIor", component: 0 },
			{ channel: "b", target: "glintDensity", component: 0 },
			{ channel: "a", target: "glintRoughness", component: 0 },
		],
	},

	slabFuzz: {
		reusedEngineSlot: "sheenColorMap",
		colorSpace: "srgb",
		residentTiers: ["forte"],
		why: "cor de fuzz e cor de verdade, entao precisa de slot proprio em sRGB",
		channels: [
			{ channel: "r", target: "fuzzColor", component: 0 },
			{ channel: "g", target: "fuzzColor", component: 1 },
			{ channel: "b", target: "fuzzColor", component: 2 },
			{ channel: "a", target: "fuzzAmount", component: 0 },
		],
	},

	slabTransmission: {
		reusedEngineSlot: "thicknessMap",
		colorSpace: "linear",
		residentTiers: ["forte"],
		why: "caminho livre medio e por canal, entao ocupa rgb, e a fase do meio sobra no alpha",
		channels: [
			{ channel: "r", target: "subsurfaceMeanFreePath", component: 0 },
			{ channel: "g", target: "subsurfaceMeanFreePath", component: 1 },
			{ channel: "b", target: "subsurfaceMeanFreePath", component: 2 },
			{ channel: "a", target: "subsurfacePhase", component: 0 },
		],
	},
}

export const SB_SLAB_MAP_SLOTS = SLOT_DEFINITIONS








export const SB_SLAB_MAP_UNMAPPED_FIELDS = {
	emissive: "os 28 canais pedidos nao cabem nas 6 unidades reservadas; emissive fica autorado no buffer de material (SB-F8)",
	fuzzRoughness: "sobrou fora dos 24 canais; segue autorado, e o mapa de fuzz cobre cor e quantidade",
	secondRoughness: "segundo lobo especular e entrega da SB-F12, que autora o valor sem mapa",
	secondRoughnessWeight: "segundo lobo especular e entrega da SB-F12, que autora o valor sem mapa",
	specularProfileIndex: "e um seletor de perfil, nao um valor de textura (producer SB-F16 pelo contrato)",
	tangent: "pelo contrato o producer de tangent e a SB-F11, nao esta fase",
	coverage: "parametro do operador verticalLayering (producer SB-F18 pelo contrato)",
	thickness: "parametro do operador verticalLayering (producer SB-F18 pelo contrato)",
	transmittanceColor: "parametro do operador verticalLayering (producer SB-F18 pelo contrato)",
}

export function slabMapSlotNames() {
	return Object.keys(SLOT_DEFINITIONS)
}


export function slabMapSlot(slotName) {
	return SLOT_DEFINITIONS[slotName] ?? null
}

export function slabMapSlotChannels(slotName) {
	const slot = slabMapSlot(slotName)
	if (!slot) return []
	return slot.channels.map((entry) => entry.channel)
}


export function slabMapSlotsForTier(tierName) {
	return slabMapSlotNames().filter((slotName) => SLOT_DEFINITIONS[slotName].residentTiers.includes(tierName))
}


export function residentTextureUnitsForTier(tierName) {
	return slabMapSlotsForTier(tierName).length
}


export function textureUnitIndexForTier(tierName, slotName) {
	const index = slabMapSlotsForTier(tierName).indexOf(slotName)
	return 0 > index ? null : index
}


export function mappedPayloadFields(tierName) {
	const fields = new Set()
	for (const slotName of slabMapSlotsForTier(tierName)) {
		for (const entry of SLOT_DEFINITIONS[slotName].channels) {
			if (entry.target) fields.add(entry.target)
		}
	}
	return [...fields].sort()
}







export function fallbackPayloadFields(tierName) {
	const mapped = new Set(mappedPayloadFields(tierName))
	return closurePayloadFieldNames("slab")
		.filter((fieldName) => !mapped.has(fieldName))
		.sort()
}


export function declaredChannelCount() {
	return slabMapSlotNames().reduce((total, slotName) => total + SLOT_DEFINITIONS[slotName].channels.length, 0)
}


export function residentChannelCountForTier(tierName) {
	return residentTextureUnitsForTier(tierName) * SB_SLAB_MAP_CHANNELS.length
}

function slotShapeProblems(slotName) {
	const problems = []
	const slot = SLOT_DEFINITIONS[slotName]
	const label = 'slot "' + slotName + '"'

	if (!slotName.startsWith(SB_SLAB_MAP_SLOT_PREFIX)) {
		problems.push(label + " nao comeca com o prefixo " + SB_SLAB_MAP_SLOT_PREFIX)
	}
	if (!slot.reusedEngineSlot) {
		problems.push(label + " nao diz qual slot do IL-F10 ele reusa")
	}
	if (!slot.why) {
		problems.push(label + " nao explica por que existe")
	}
	if (!SB_SLAB_MAP_COLOR_SPACES.includes(slot.colorSpace)) {
		problems.push(label + " declara colorSpace invalido: " + slot.colorSpace)
	}
	if (slot.residentTiers.length === 0) {
		problems.push(label + " nao e residente em nenhum tier, logo nunca seria amostrado")
	}
	for (const tierName of slot.residentTiers) {
		if (!SB_TIER_NAMES.includes(tierName)) {
			problems.push(label + " declara residencia em tier inexistente: " + tierName)
		}
	}

	const channelNames = slot.channels.map((entry) => entry.channel)
	if (channelNames.join("") !== SB_SLAB_MAP_CHANNELS.join("")) {
		problems.push(label + " nao declara exatamente os canais rgba na ordem: " + channelNames.join(""))
	}

	return problems
}

function channelTargetProblems(slotName) {
	const problems = []
	const payloadFields = new Set(closurePayloadFieldNames("slab"))

	for (const entry of SLOT_DEFINITIONS[slotName].channels) {
		const label = 'canal "' + slotName + "." + entry.channel + '"'

		if (!entry.target) {
			if (!entry.role) problems.push(label + " nao alimenta campo do payload e nao declara um papel")
			if (!entry.why) problems.push(label + " nao alimenta campo do payload e nao explica o motivo")
			continue
		}
		if (!payloadFields.has(entry.target)) {
			problems.push(label + ' aponta campo que nao existe no payload do slab: "' + entry.target + '"')
		}
		if (!Number.isInteger(entry.component) || 0 > entry.component) {
			problems.push(label + " tem componente invalida do campo de destino")
		}
	}

	return problems
}


function doubleAuthorityProblems() {
	const problems = []

	for (const tierName of SB_TIER_NAMES) {
		const slotByField = new Map()
		for (const slotName of slabMapSlotsForTier(tierName)) {
			for (const entry of SLOT_DEFINITIONS[slotName].channels) {
				if (!entry.target) continue
				const fieldKey = entry.target + ":" + entry.component
				const previousSlot = slotByField.get(fieldKey)
				if (previousSlot && previousSlot !== slotName) {
					problems.push(
						"no tier " + tierName + ' o campo "' + fieldKey + '" e alimentado por "' + previousSlot + '" e por "' + slotName + '"',
					)
				}
				slotByField.set(fieldKey, slotName)
			}
		}
	}

	return problems
}

function multiComponentProblems() {
	const problems = []

	for (const slotName of slabMapSlotNames()) {
		const componentsByTarget = new Map()
		for (const entry of SLOT_DEFINITIONS[slotName].channels) {
			if (!entry.target) continue
			const components = componentsByTarget.get(entry.target) ?? []
			components.push(entry.component)
			componentsByTarget.set(entry.target, components)
		}
		for (const [target, components] of componentsByTarget.entries()) {
			const sorted = components.slice().sort((left, right) => left - right)
			const expected = sorted.map((unused, offset) => offset)
			if (sorted.join(",") !== expected.join(",")) {
				problems.push(
					'em "' + slotName + '" o campo "' + target + '" usa componentes ' + sorted.join(",") + " em vez de " + expected.join(","),
				)
			}
		}
	}

	return problems
}

function residencyProblems() {
	const problems = []
	const reservedUnits = SB_RESERVED_TEXTURE_UNITS[SB_SLAB_MAP_TEXTURE_CONSUMER]

	if (!Number.isInteger(reservedUnits)) {
		problems.push("o contrato nao reserva unidades para o consumidor " + SB_SLAB_MAP_TEXTURE_CONSUMER)
		return problems
	}

	for (const tierName of SB_TIER_NAMES) {
		const residentUnits = residentTextureUnitsForTier(tierName)
		if (residentUnits > reservedUnits) {
			problems.push(
				"o tier " + tierName + " deixa " + residentUnits + " texturas residentes, acima da reserva de " + reservedUnits,
			)
		}
	}

	if (residentTextureUnitsForTier("fraco") !== 0) {
		problems.push("o tier fraco nao pode ter mapa residente: no fraco a fase nasce desligada")
	}

	return problems
}


function unmappedFieldProblems() {
	const problems = []
	const payloadFields = new Set(closurePayloadFieldNames("slab"))
	const mappedOnStrongestTier = new Set(mappedPayloadFields("forte"))

	for (const fieldName of payloadFields) {
		if (mappedOnStrongestTier.has(fieldName)) continue
		if (!(fieldName in SB_SLAB_MAP_UNMAPPED_FIELDS)) {
			problems.push("campo do payload sem mapa e sem motivo declarado: " + fieldName)
		}
	}

	for (const fieldName of Object.keys(SB_SLAB_MAP_UNMAPPED_FIELDS)) {
		if (!payloadFields.has(fieldName)) {
			problems.push("motivo declarado para campo que nao existe no payload do slab: " + fieldName)
		}
		if (mappedOnStrongestTier.has(fieldName)) {
			problems.push("campo declarado como sem mapa, mas algum slot o alimenta: " + fieldName)
		}
	}

	return problems
}


export function slabMapPlanProblems() {
	const problems = []

	for (const slotName of slabMapSlotNames()) {
		problems.push(...slotShapeProblems(slotName))
		problems.push(...channelTargetProblems(slotName))
	}

	problems.push(...multiComponentProblems())
	problems.push(...doubleAuthorityProblems())
	problems.push(...residencyProblems())
	problems.push(...unmappedFieldProblems())

	return problems
}

export function describeSlabMapPlan() {
	return {
		slotCount: slabMapSlotNames().length,
		declaredChannelCount: declaredChannelCount(),
		reservedTextureUnits: SB_RESERVED_TEXTURE_UNITS[SB_SLAB_MAP_TEXTURE_CONSUMER] ?? null,
		slots: slabMapSlotNames().map((slotName) => ({
			slot: slotName,
			reusedEngineSlot: SLOT_DEFINITIONS[slotName].reusedEngineSlot,
			colorSpace: SLOT_DEFINITIONS[slotName].colorSpace,
			residentTiers: [...SLOT_DEFINITIONS[slotName].residentTiers],
			channels: SLOT_DEFINITIONS[slotName].channels.map((entry) => ({
				channel: entry.channel,
				target: entry.target,
				role: entry.role ?? null,
				derivation: entry.derivation ?? null,
			})),
		})),
		byTier: Object.fromEntries(
			SB_TIER_NAMES.map((tierName) => [
				tierName,
				{
					residentSlots: slabMapSlotsForTier(tierName),
					residentTextureUnits: residentTextureUnitsForTier(tierName),
					residentChannels: residentChannelCountForTier(tierName),
					mappedPayloadFields: mappedPayloadFields(tierName),
					fallbackPayloadFields: fallbackPayloadFields(tierName),
				},
			]),
		),
		unmappedFields: SB_SLAB_MAP_UNMAPPED_FIELDS,
		problems: slabMapPlanProblems(),
	}
}

deepFreeze(SB_SLAB_MAP_CHANNELS)
deepFreeze(SB_SLAB_MAP_COLOR_SPACES)
deepFreeze(SLOT_DEFINITIONS)
deepFreeze(SB_SLAB_MAP_UNMAPPED_FIELDS)
