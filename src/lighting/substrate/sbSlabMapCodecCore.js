import {
	SB_SLAB_MAP_CHANNELS,
	fallbackPayloadFields,
	slabMapSlot,
	slabMapSlotNames,
	slabMapSlotsForTier,
} from "./sbSlabMapPlanCore.js"
import { SB_CHANNEL_MAX_BYTE, dequantizeChannel, metalnessToF0, quantizeChannel } from "./sbMapPackingCore.js"
import {
	createDefaultSlabParameters,
	sanitizeSlabParameters,
	slabParameterNames,
	slabParameterSchema,
} from "./sbSlabParametersCore.js"
import { SB_GATES, SB_TIER_NAMES } from "./sbMaterialContract.js"


export const SB_SLAB_MAP_CHANNEL_HALF_STEP = 0.5 / SB_CHANNEL_MAX_BYTE


export const SB_SLAB_MAP_DERIVED_ERROR_TOLERANCE = 2 * SB_SLAB_MAP_CHANNEL_HALF_STEP


export const SB_SLAB_MAP_UNIT_NORMAL_TOLERANCE = 1e-6


export const SB_SLAB_MAP_REFUSAL_CODES = Object.freeze({
	unknownSlot: "unknownSlabMapSlot",
	slotNotResidentInTier: "slabMapSlotNotResidentInTier",
	malformedTexel: "malformedSlabMapTexel",
})

export const SB_SLAB_MAP_FALLBACK_REASONS = Object.freeze({
	noResidentSlot: "nenhum slot residente neste tier alimenta o campo",
	missingTexel: "o slot residente nao recebeu texel",
	malformedTexel: "o texel do slot residente nao tem os quatro bytes rgba",
})


export const SB_SLAB_MAP_NON_AUTHORED_RANGES = Object.freeze({
	normal: Object.freeze({
		minimum: -1,
		maximum: 1,
		componentCount: 3,
		defaultValue: Object.freeze([0, 0, 1]),
		why: "normal e campo de geometria com producer SB-F28 no contrato: x e y viajam com sinal e z e reconstruido no destino",
	}),
	metalness: Object.freeze({
		minimum: 0,
		maximum: 1,
		componentCount: 1,
		defaultValue: 0,
		why: "canal do ORM do glTF; nao e campo do payload, e a ENTRADA da derivacao metalnessToF0",
	}),
	ambientOcclusion: Object.freeze({
		minimum: 0,
		maximum: 1,
		componentCount: 1,
		defaultValue: 1,
		why: "a oclusao multiplica a irradiancia indireta e pertence ao IL-F10, nao ao payload do slab",
	}),
})


export const SB_SLAB_MAP_DERIVATIONS = Object.freeze({
	metalnessToF0: Object.freeze({
		sourceField: "metalness",
		targetField: "f0",
		why: "F0 sai do fluxo metalness do glTF: dieletrico com metalness 0, albedo com metalness 1 (mesma conta do IL-F10)",
	}),
})

const BATTERY_SEED = 20260928
const BATTERY_MINIMUM_NORMAL_Z = 0.15

function isFiniteNumber(value) {
	return typeof value === "number" && Number.isFinite(value)
}

function clampToRange(value, minimum, maximum) {
	return Math.min(maximum, Math.max(minimum, value))
}

function strongestTierName() {
	return SB_TIER_NAMES[SB_TIER_NAMES.length - 1]
}

function resolveTierName(tierName) {
	return SB_TIER_NAMES.includes(tierName) ? tierName : strongestTierName()
}


export function slabMapFieldRange(fieldName) {
	const schema = slabParameterSchema(fieldName)
	if (schema) {
		return {
			field: fieldName,
			minimum: schema.minimum,
			maximum: schema.maximum,
			componentCount: schema.encoding.channelCount,
			authoredBySlabParameters: true,
		}
	}
	const declared = SB_SLAB_MAP_NON_AUTHORED_RANGES[fieldName]
	if (!declared) return null
	return {
		field: fieldName,
		minimum: declared.minimum,
		maximum: declared.maximum,
		componentCount: declared.componentCount,
		authoredBySlabParameters: false,
	}
}


export function slabMapFieldDefault(fieldName) {
	const schema = slabParameterSchema(fieldName)
	if (schema) return Array.isArray(schema.defaultValue) ? schema.defaultValue.slice() : schema.defaultValue
	const declared = SB_SLAB_MAP_NON_AUTHORED_RANGES[fieldName]
	if (!declared) return null
	return Array.isArray(declared.defaultValue) ? declared.defaultValue.slice() : declared.defaultValue
}






export function slabMapChannelDestination(slotName, channelName) {
	const slot = slabMapSlot(slotName)
	if (!slot) return null
	const entry = slot.channels.find((candidate) => candidate.channel === channelName)
	if (!entry) return null
	if (entry.derivation) {
		const derivation = SB_SLAB_MAP_DERIVATIONS[entry.derivation]
		if (!derivation) return null
		return {
			kind: "derivationInput",
			field: derivation.sourceField,
			component: 0,
			derivation: entry.derivation,
			target: entry.target,
		}
	}
	if (entry.target) {
		return { kind: "payloadField", field: entry.target, component: entry.component, derivation: null, target: entry.target }
	}
	if (entry.role) {
		return { kind: "engineChannelRole", field: entry.role, component: 0, derivation: null, target: null }
	}
	return null
}

function encodeRangedValue(value, range) {
	const width = range.maximum - range.minimum
	if (!(width > 0) || !isFiniteNumber(value)) return quantizeChannel(0)
	return quantizeChannel((value - range.minimum) / width)
}

function decodeRangedByte(encodedByte, range) {
	return range.minimum + dequantizeChannel(encodedByte) * (range.maximum - range.minimum)
}


export function reconstructSlabMapNormal(tangentSpaceX, tangentSpaceY) {
	const x = clampToRange(isFiniteNumber(tangentSpaceX) ? tangentSpaceX : 0, -1, 1)
	const y = clampToRange(isFiniteNumber(tangentSpaceY) ? tangentSpaceY : 0, -1, 1)
	const reconstructedZ = Math.sqrt(Math.max(0, 1 - (x * x + y * y)))
	const length = Math.sqrt(x * x + y * y + reconstructedZ * reconstructedZ)
	if (SB_SLAB_MAP_UNIT_NORMAL_TOLERANCE > length) return [...SB_SLAB_MAP_NON_AUTHORED_RANGES.normal.defaultValue]
	return [x / length, y / length, reconstructedZ / length]
}


export function deriveSlabMapF0(metalness, albedo) {
	const channels = Array.isArray(albedo) ? albedo : [albedo, albedo, albedo]
	return [0, 1, 2].map((component) => metalnessToF0(metalness, channels[component]))
}

function createDefaultSlabMapSurface() {
	return {
		normal: [...SB_SLAB_MAP_NON_AUTHORED_RANGES.normal.defaultValue],
		metalness: SB_SLAB_MAP_NON_AUTHORED_RANGES.metalness.defaultValue,
		ambientOcclusion: SB_SLAB_MAP_NON_AUTHORED_RANGES.ambientOcclusion.defaultValue,
	}
}


export function createDefaultSlabMapSource() {
	return { parameters: createDefaultSlabParameters(), ...createDefaultSlabMapSurface() }
}

function readSourceComponent(source, range, component) {
	const container = range.authoredBySlabParameters ? source?.parameters?.[range.field] : source?.[range.field]
	const fallback = slabMapFieldDefault(range.field)
	const value = range.componentCount > 1 && Array.isArray(container) ? container[component] : container
	if (isFiniteNumber(value)) return value
	return Array.isArray(fallback) ? fallback[component] : fallback
}

function readDecodedComponent(decoded, range, component) {
	const container = range.authoredBySlabParameters ? decoded?.parameters?.[range.field] : decoded?.surface?.[range.field]
	if (range.componentCount > 1 && Array.isArray(container)) return container[component]
	return container
}

function writeResolvedComponent(resolved, range, component, value) {
	const holder = range.authoredBySlabParameters ? resolved.parameters : resolved.surface
	if (1 >= range.componentCount) {
		holder[range.field] = value
		return
	}
	const channels = Array.isArray(holder[range.field]) ? holder[range.field].slice() : [0, 0, 0]
	channels[component] = value
	holder[range.field] = channels
}

function isUsableTexel(texel) {
	if (!Array.isArray(texel) || texel.length !== SB_SLAB_MAP_CHANNELS.length) return false
	return texel.every((encodedByte) => isFiniteNumber(encodedByte))
}

function cloneParameters(parameters) {
	const source = parameters === null || typeof parameters !== "object" ? createDefaultSlabParameters() : parameters
	const cloned = {}
	for (const [name, value] of Object.entries(source)) cloned[name] = Array.isArray(value) ? value.slice() : value
	return cloned
}


export function slabMapSlotPayloadFields(slotName) {
	const slot = slabMapSlot(slotName)
	if (!slot) return []
	const fields = new Set()
	for (const entry of slot.channels) {
		if (entry.target) fields.add(entry.target)
	}
	return [...fields]
}


export function encodeSlabMapTexels(tierName, source) {
	const resolvedTier = resolveTierName(tierName)
	const texelsBySlot = {}
	for (const slotName of slabMapSlotsForTier(resolvedTier)) {
		texelsBySlot[slotName] = SB_SLAB_MAP_CHANNELS.map((channelName) => {
			const destination = slabMapChannelDestination(slotName, channelName)
			if (!destination) return 0
			const range = slabMapFieldRange(destination.field)
			if (!range) return 0
			return encodeRangedValue(readSourceComponent(source, range, destination.component), range)
		})
	}
	return texelsBySlot
}


export function decodeSlabMapTexels(options = {}) {
	const tierName = resolveTierName(options.tier)
	const texelsBySlot = options.texelsBySlot === null || typeof options.texelsBySlot !== "object" ? {} : options.texelsBySlot
	const residentSlots = slabMapSlotsForTier(tierName)
	const resolved = { parameters: cloneParameters(options.authoredParameters), surface: createDefaultSlabMapSurface() }
	const refusals = []
	const usedSlots = []
	const mappedFields = new Set()
	const decodedDestinations = new Set()
	const fallbackFields = []

	for (const slotName of Object.keys(texelsBySlot)) {
		if (!slabMapSlot(slotName)) {
			refusals.push({
				code: SB_SLAB_MAP_REFUSAL_CODES.unknownSlot,
				slot: slotName,
				reason: 'slot fora do plano de mapas do slab: "' + slotName + '"',
			})
			continue
		}
		if (!residentSlots.includes(slotName)) {
			refusals.push({
				code: SB_SLAB_MAP_REFUSAL_CODES.slotNotResidentInTier,
				slot: slotName,
				reason: 'o slot "' + slotName + '" nao e residente no tier ' + tierName,
			})
		}
	}

	for (const slotName of residentSlots) {
		const texel = texelsBySlot[slotName]
		if (texel === undefined) {
			for (const fieldName of slabMapSlotPayloadFields(slotName)) {
				fallbackFields.push({ field: fieldName, slot: slotName, reason: SB_SLAB_MAP_FALLBACK_REASONS.missingTexel })
			}
			continue
		}
		if (!isUsableTexel(texel)) {
			refusals.push({
				code: SB_SLAB_MAP_REFUSAL_CODES.malformedTexel,
				slot: slotName,
				reason: 'o texel do slot "' + slotName + '" nao tem os ' + SB_SLAB_MAP_CHANNELS.length + " bytes rgba",
			})
			for (const fieldName of slabMapSlotPayloadFields(slotName)) {
				fallbackFields.push({ field: fieldName, slot: slotName, reason: SB_SLAB_MAP_FALLBACK_REASONS.malformedTexel })
			}
			continue
		}

		usedSlots.push(slotName)
		SB_SLAB_MAP_CHANNELS.forEach((channelName, channelIndex) => {
			const destination = slabMapChannelDestination(slotName, channelName)
			if (!destination) return
			const range = slabMapFieldRange(destination.field)
			if (!range) return
			writeResolvedComponent(resolved, range, destination.component, decodeRangedByte(texel[channelIndex], range))
			decodedDestinations.add(destination.field)
			if (destination.target) mappedFields.add(destination.target)
		})
	}

	if (decodedDestinations.has("normal")) {
		resolved.surface.normal = reconstructSlabMapNormal(resolved.surface.normal[0], resolved.surface.normal[1])
	}
	const f0Derivation = SB_SLAB_MAP_DERIVATIONS.metalnessToF0
	if (decodedDestinations.has(f0Derivation.sourceField)) {
		resolved.parameters[f0Derivation.targetField] = deriveSlabMapF0(resolved.surface.metalness, resolved.parameters.albedo)
	}

	for (const fieldName of fallbackPayloadFields(tierName)) {
		fallbackFields.push({ field: fieldName, slot: null, reason: SB_SLAB_MAP_FALLBACK_REASONS.noResidentSlot })
	}

	return {
		tier: tierName,
		parameters: resolved.parameters,
		surface: resolved.surface,
		mappedFields: [...mappedFields].sort(),
		fallbackFields,
		refusals,
		usedSlots,
	}
}

function createLinearCongruentialGenerator(seed) {
	let state = seed % 2147483647
	if (1 > state) state += 2147483646
	return function nextRandom() {
		state = (state * 16807) % 2147483647
		return (state - 1) / 2147483646
	}
}


export function createSlabMapSourceBattery(sourceCount = 8) {
	const nextRandom = createLinearCongruentialGenerator(BATTERY_SEED)
	const battery = []

	for (let sourceIndex = 0; sourceCount > sourceIndex; sourceIndex += 1) {
		const rawParameters = {}
		for (const parameterName of slabParameterNames()) {
			const schema = slabParameterSchema(parameterName)
			const pickValue = () => schema.minimum + nextRandom() * (schema.maximum - schema.minimum)
			rawParameters[parameterName] =
				schema.encoding.channelCount > 1 ? [pickValue(), pickValue(), pickValue()] : pickValue()
		}

		const azimuth = nextRandom() * 2 * Math.PI
		const normalZ = BATTERY_MINIMUM_NORMAL_Z + nextRandom() * (1 - BATTERY_MINIMUM_NORMAL_Z)
		const radius = Math.sqrt(Math.max(0, 1 - normalZ * normalZ))

		battery.push({
			id: "slabMapSource" + sourceIndex,
			parameters: sanitizeSlabParameters(rawParameters),
			normal: [radius * Math.cos(azimuth), radius * Math.sin(azimuth), normalZ],
			metalness: nextRandom(),
			ambientOcclusion: nextRandom(),
		})
	}

	return battery
}


export function measureSlabMapRoundTrip(options = {}) {
	const tierName = resolveTierName(options.tier)
	const source = options.source ?? createDefaultSlabMapSource()
	const texelsBySlot = encodeSlabMapTexels(tierName, source)
	const decoded = decodeSlabMapTexels({ tier: tierName, texelsBySlot, authoredParameters: source.parameters })
	const measurements = []
	let directWorstNormalizedError = 0
	let directWorstFieldName = null

	for (const slotName of slabMapSlotsForTier(tierName)) {
		SB_SLAB_MAP_CHANNELS.forEach((channelName) => {
			const destination = slabMapChannelDestination(slotName, channelName)
			if (!destination) return
			const range = slabMapFieldRange(destination.field)
			if (!range) return
			const expected = readSourceComponent(source, range, destination.component)
			const restored = readDecodedComponent(decoded, range, destination.component)
			const width = range.maximum - range.minimum
			const absoluteError = Math.abs(restored - expected)
			const normalizedError = width > 0 ? absoluteError / width : 0
			measurements.push({
				slot: slotName,
				channel: channelName,
				field: destination.field,
				component: destination.component,
				expected,
				restored,
				absoluteError,
				normalizedError,
			})
			if (normalizedError > directWorstNormalizedError) {
				directWorstNormalizedError = normalizedError
				directWorstFieldName = destination.field + "." + destination.component
			}
		})
	}

	let derivedWorstNormalizedError = 0
	let derivedWorstFieldName = null
	if (decoded.mappedFields.includes(SB_SLAB_MAP_DERIVATIONS.metalnessToF0.targetField)) {
		const f0Range = slabMapFieldRange("f0")
		const f0Width = f0Range.maximum - f0Range.minimum
		const expectedF0 = deriveSlabMapF0(source.metalness, source.parameters.albedo)
		expectedF0.forEach((expected, component) => {
			const normalizedError = Math.abs(decoded.parameters.f0[component] - expected) / f0Width
			if (normalizedError > derivedWorstNormalizedError) {
				derivedWorstNormalizedError = normalizedError
				derivedWorstFieldName = "f0." + component
			}
		})
	}

	const decodedNormal = decoded.surface.normal
	const normalLength = Math.sqrt(
		decodedNormal[0] * decodedNormal[0] + decodedNormal[1] * decodedNormal[1] + decodedNormal[2] * decodedNormal[2],
	)
	const normalIsUnit = SB_SLAB_MAP_UNIT_NORMAL_TOLERANCE >= Math.abs(1 - normalLength)
	const reconstructedNormalAbsoluteError = Math.abs(decodedNormal[2] - readSourceComponent(source, slabMapFieldRange("normal"), 2))
	const directGate = SB_GATES.maxQuantizationErrorPerChannel

	return {
		tier: tierName,
		slotCount: slabMapSlotsForTier(tierName).length,
		channelCount: measurements.length,
		directGate,
		directWorstNormalizedError,
		directWorstFieldName,
		derivedGate: SB_SLAB_MAP_DERIVED_ERROR_TOLERANCE,
		derivedWorstNormalizedError,
		derivedWorstFieldName,
		reconstructedNormalAbsoluteError,
		normalIsUnit,
		mappedFields: decoded.mappedFields,
		ok:
			directGate >= directWorstNormalizedError &&
			SB_SLAB_MAP_DERIVED_ERROR_TOLERANCE >= derivedWorstNormalizedError &&
			normalIsUnit,
		measurements,
	}
}


export function slabMapCodecProblems() {
	const problems = []

	for (const slotName of slabMapSlotNames()) {
		for (const channelName of SB_SLAB_MAP_CHANNELS) {
			const label = 'canal "' + slotName + "." + channelName + '"'
			const destination = slabMapChannelDestination(slotName, channelName)
			if (!destination) {
				problems.push(label + " nao tem destino resolvivel no codec")
				continue
			}
			if (!slabMapFieldRange(destination.field)) {
				problems.push(label + ' aponta o campo "' + destination.field + '" sem faixa declarada')
			}
			if (slabMapFieldDefault(destination.field) === null) {
				problems.push(label + ' aponta o campo "' + destination.field + '" sem valor de partida declarado')
			}
		}

		for (const entry of slabMapSlot(slotName).channels) {
			if (!entry.derivation) continue
			const derivation = SB_SLAB_MAP_DERIVATIONS[entry.derivation]
			if (!derivation) {
				problems.push('derivacao "' + entry.derivation + '" usada pelo plano e desconhecida no codec')
				continue
			}
			if (derivation.targetField !== entry.target) {
				problems.push(
					'a derivacao "' + entry.derivation + '" entrega ' + derivation.targetField + " e o plano pediu " + entry.target,
				)
			}
		}
	}

	const authored = createDefaultSlabParameters()
	const withoutTexels = decodeSlabMapTexels({ tier: strongestTierName(), authoredParameters: authored })
	for (const parameterName of slabParameterNames()) {
		if (JSON.stringify(withoutTexels.parameters[parameterName]) !== JSON.stringify(authored[parameterName])) {
			problems.push("sem texel nenhum o codec mexeu no parametro autorado: " + parameterName)
		}
	}
	if (0 !== withoutTexels.mappedFields.length) {
		problems.push("sem texel nenhum o codec declarou campo vindo de mapa")
	}

	const unknownSlotDecode = decodeSlabMapTexels({
		tier: strongestTierName(),
		texelsBySlot: { slabSlotThatDoesNotExist: [0, 0, 0, 0] },
	})
	if (unknownSlotDecode.refusals[0]?.code !== SB_SLAB_MAP_REFUSAL_CODES.unknownSlot) {
		problems.push("slot desconhecido nao virou recusa com codigo")
	}

	for (const tierName of SB_TIER_NAMES) {
		if (0 === slabMapSlotsForTier(tierName).length) continue
		for (const source of [createDefaultSlabMapSource(), ...createSlabMapSourceBattery(4)]) {
			const measurement = measureSlabMapRoundTrip({ tier: tierName, source })
			if (measurement.ok) continue
			problems.push(
				"a ida e volta no tier " +
					tierName +
					" erra " +
					measurement.directWorstNormalizedError +
					" em " +
					measurement.directWorstFieldName +
					" e " +
					measurement.derivedWorstNormalizedError +
					" no campo derivado",
			)
		}
	}

	return problems
}

export function describeSlabMapCodec() {
	const byTier = Object.fromEntries(
		SB_TIER_NAMES.map((tierName) => {
			if (0 === slabMapSlotsForTier(tierName).length) {
				return [tierName, { residentSlots: [], roundTrip: null }]
			}
			const measurement = measureSlabMapRoundTrip({ tier: tierName })
			return [
				tierName,
				{
					residentSlots: slabMapSlotsForTier(tierName),
					roundTrip: {
						ok: measurement.ok,
						directWorstNormalizedError: measurement.directWorstNormalizedError,
						directWorstFieldName: measurement.directWorstFieldName,
						derivedWorstNormalizedError: measurement.derivedWorstNormalizedError,
						reconstructedNormalAbsoluteError: measurement.reconstructedNormalAbsoluteError,
						normalIsUnit: measurement.normalIsUnit,
					},
				},
			]
		}),
	)

	return {
		channelHalfStep: SB_SLAB_MAP_CHANNEL_HALF_STEP,
		directGate: SB_GATES.maxQuantizationErrorPerChannel,
		derivedTolerance: SB_SLAB_MAP_DERIVED_ERROR_TOLERANCE,
		nonAuthoredRanges: SB_SLAB_MAP_NON_AUTHORED_RANGES,
		derivations: SB_SLAB_MAP_DERIVATIONS,
		refusalCodes: SB_SLAB_MAP_REFUSAL_CODES,
		byTier,
		problems: slabMapCodecProblems(),
	}
}
