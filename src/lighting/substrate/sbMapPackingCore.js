import {
	SB_GATES,
	SB_RESERVED_TEXTURE_UNITS,
	SB_TEXTURE_UNIT_CEILING,
	SB_ENGINE_OWNED_TEXTURE_CONSUMERS,
} from "./sbMaterialContract.js"


export const SB_CHANNEL_LEVELS = 256


export const SB_CHANNEL_MAX_BYTE = SB_CHANNEL_LEVELS - 1


export const SB_DIELECTRIC_F0 = 0.04


export const SB_PACKED_CHANNEL_ORDER = ["r", "g", "b", "a"]

function clampUnit(value) {
	if (!Number.isFinite(value)) return 0
	if (value > 1) return 1
	if (0 > value) return 0
	return value
}


export function quantizeChannel(value) {
	return Math.round(clampUnit(value) * SB_CHANNEL_MAX_BYTE)
}


export function dequantizeChannel(encodedByte) {
	if (!Number.isFinite(encodedByte)) return 0
	const clamped = Math.min(Math.max(Math.round(encodedByte), 0), SB_CHANNEL_MAX_BYTE)
	return clamped / SB_CHANNEL_MAX_BYTE
}


export function channelRoundTripError(value) {
	return Math.abs(clampUnit(value) - dequantizeChannel(quantizeChannel(value)))
}


export function packChannels(channelValues) {
	return SB_PACKED_CHANNEL_ORDER.map((channelName) => quantizeChannel(channelValues?.[channelName] ?? 0))
}


export function unpackChannels(packedBytes) {
	const channelValues = {}
	SB_PACKED_CHANNEL_ORDER.forEach((channelName, offset) => {
		channelValues[channelName] = dequantizeChannel(packedBytes?.[offset] ?? 0)
	})
	return channelValues
}


export function packOrm(ormValues) {
	return packChannels({
		r: ormValues?.ambientOcclusion ?? 1,
		g: ormValues?.roughness ?? 1,
		b: ormValues?.metalness ?? 0,
		a: ormValues?.f90 ?? 1,
	})
}

export function unpackOrm(packedBytes) {
	const channelValues = unpackChannels(packedBytes)
	return {
		ambientOcclusion: channelValues.r,
		roughness: channelValues.g,
		metalness: channelValues.b,
		f90: channelValues.a,
	}
}


export function metalnessToF0(metalness, albedoChannel) {
	const weight = clampUnit(metalness)
	return SB_DIELECTRIC_F0 * (1 - weight) + clampUnit(albedoChannel) * weight
}


const ROUND_TRIP_SAMPLES = [0, 0.04, 0.1, 0.25, 1 / 3, 0.5, 0.7, 0.923, 0.999, 1]


export function ormPackingProof() {
	const tolerance = SB_GATES.maxQuantizationErrorPerChannel
	const measurements = []
	let worstError = 0

	for (const sample of ROUND_TRIP_SAMPLES) {
		const requested = {
			ambientOcclusion: sample,
			roughness: 1 - sample,
			metalness: sample,
			f90: 1 - sample,
		}
		const restored = unpackOrm(packOrm(requested))
		for (const fieldName of Object.keys(requested)) {
			const error = Math.abs(requested[fieldName] - restored[fieldName])
			if (error > worstError) worstError = error
			measurements.push({ sample, field: fieldName, requested: requested[fieldName], restored: restored[fieldName], error })
		}
	}

	return {
		ok: tolerance >= worstError,
		tolerance,
		worstError,
		sampleCount: ROUND_TRIP_SAMPLES.length,
		measurements,
	}
}


export function ormChannelOrderProof() {
	const restored = unpackOrm(packOrm({ ambientOcclusion: 1, roughness: 0, metalness: 1, f90: 0 }))
	const problems = []

	if (0.5 > restored.ambientOcclusion) problems.push("a oclusao nao voltou no canal r")
	if (restored.roughness > 0.5) problems.push("a rugosidade nao voltou no canal g")
	if (0.5 > restored.metalness) problems.push("a metalicidade nao voltou no canal b")
	if (restored.f90 > 0.5) problems.push("o f90 nao voltou no canal a")

	return { ok: problems.length === 0, problems, restored }
}


export function textureUnitBudget() {
	const reservations = Object.entries(SB_RESERVED_TEXTURE_UNITS).map(([consumerId, units]) => ({
		consumerId,
		units,
		engineOwned: SB_ENGINE_OWNED_TEXTURE_CONSUMERS.includes(consumerId),
	}))

	const totalUnits = reservations.reduce((total, entry) => total + entry.units, 0)
	const engineOwnedUnits = reservations
		.filter((entry) => entry.engineOwned)
		.reduce((total, entry) => total + entry.units, 0)

	return {
		ceiling: SB_TEXTURE_UNIT_CEILING,
		totalUnits,
		engineOwnedUnits,
		substrateUnits: totalUnits - engineOwnedUnits,
		headroom: SB_TEXTURE_UNIT_CEILING - totalUnits,
		withinCeiling: SB_TEXTURE_UNIT_CEILING >= totalUnits,
		engineLtcCounted: engineOwnedUnits > 0,
		reservations,
	}
}


export function mapPackingProblems() {
	const problems = []
	const budget = textureUnitBudget()

	if (!budget.withinCeiling) {
		problems.push("o orcamento de texturas estoura o teto: " + budget.totalUnits + " de " + budget.ceiling)
	}
	if (!budget.engineLtcCounted) {
		problems.push("o orcamento nao esta contando as unidades que a engine ja gastou com o LTC")
	}

	const roundTrip = ormPackingProof()
	if (!roundTrip.ok) {
		problems.push(
			"o round-trip do ORM erra " + roundTrip.worstError + ", acima do portao de " + roundTrip.tolerance,
		)
	}

	const channelOrder = ormChannelOrderProof()
	problems.push(...channelOrder.problems)

	if (dequantizeChannel(quantizeChannel(1)) !== 1) {
		problems.push("o valor 1 nao sobrevive ao round-trip, entao branco puro escureceria")
	}
	if (dequantizeChannel(quantizeChannel(0)) !== 0) {
		problems.push("o valor 0 nao sobrevive ao round-trip, entao preto puro clarearia")
	}
	if (metalnessToF0(0, 1) !== SB_DIELECTRIC_F0) {
		problems.push("metalness 0 tem de dar exatamente o F0 de dieletrico")
	}
	if (metalnessToF0(1, 1) !== 1) {
		problems.push("metalness 1 tem de levar o F0 ao albedo")
	}

	return problems
}

export function describeMapPacking() {
	return {
		channelLevels: SB_CHANNEL_LEVELS,
		dielectricF0: SB_DIELECTRIC_F0,
		channelOrder: SB_PACKED_CHANNEL_ORDER,
		quantizationGate: SB_GATES.maxQuantizationErrorPerChannel,
		budget: textureUnitBudget(),
		ormRoundTrip: (() => {
			const proof = ormPackingProof()
			return { ok: proof.ok, worstError: proof.worstError, tolerance: proof.tolerance }
		})(),
		ormChannelOrder: ormChannelOrderProof(),
		problems: mapPackingProblems(),
	}
}
