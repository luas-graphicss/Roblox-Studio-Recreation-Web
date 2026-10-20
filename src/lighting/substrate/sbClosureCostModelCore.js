import { closureKindBytes, closureKindCost } from "./sbClosureDispatchCore.js"

export const SB_COST_SAMPLE_MINIMUM = 2
export const SB_COST_METHOD = "regressao linear sobre (closures, ms por frame)"


export function closureCostUnits(kind) {
	return {
		kind,
		closureCost: closureKindCost(kind),
		bytes: closureKindBytes(kind),
	}
}

function countClosuresByKind(dispatchedClosures) {
	const countsByKind = new Map()
	for (const closure of dispatchedClosures) {
		countsByKind.set(closure.kind, (countsByKind.get(closure.kind) ?? 0) + 1)
	}
	return countsByKind
}


export function dispatchPlanCost(plan) {
	const dispatchedClosures = Array.isArray(plan?.dispatched) ? plan.dispatched : []
	const byKind = []
	for (const [kind, closureCount] of countClosuresByKind(dispatchedClosures)) {
		byKind.push({ ...closureCostUnits(kind), closureCount })
	}
	return {
		closureCount: dispatchedClosures.length,
		closureCostSum: dispatchedClosures.reduce((total, closure) => total + closureKindCost(closure.kind), 0),
		bytesPerPixel: dispatchedClosures.reduce((total, closure) => total + closureKindBytes(closure.kind), 0),
		byteCeiling: Number.isFinite(plan?.byteCeiling) ? plan.byteCeiling : 0,
		withinByteCeiling: plan?.withinByteCeiling === true,
		byKind,
	}
}

export function emptyCostMeasurement(reason) {
	return {
		measured: false,
		perClosureMilliseconds: null,
		baselineMilliseconds: null,
		sampleCount: 0,
		samples: [],
		method: SB_COST_METHOD,
		reason: typeof reason === "string" ? reason : "custo por closure ainda nao medido",
	}
}

function usableSamples(rawSamples) {
	if (!Array.isArray(rawSamples)) return []
	return rawSamples
		.map((sample) => ({
			closureCount: Number(sample?.closureCount),
			milliseconds: Number(sample?.milliseconds),
		}))
		.filter((sample) => Number.isInteger(sample.closureCount) && sample.closureCount > 0)
		.filter((sample) => Number.isFinite(sample.milliseconds) && sample.milliseconds >= 0)
}

function averageOf(values) {
	return values.reduce((total, value) => total + value, 0) / values.length
}


export function costPerClosureFromSamples(rawSamples) {
	const samples = usableSamples(rawSamples)
	if (SB_COST_SAMPLE_MINIMUM > samples.length) {
		return emptyCostMeasurement("faltam amostras: " + samples.length + " de " + SB_COST_SAMPLE_MINIMUM + " utilizaveis")
	}

	const averageClosureCount = averageOf(samples.map((sample) => sample.closureCount))
	const averageMilliseconds = averageOf(samples.map((sample) => sample.milliseconds))

	let covariance = 0
	let variance = 0
	for (const sample of samples) {
		const closureCountDeviation = sample.closureCount - averageClosureCount
		covariance += closureCountDeviation * (sample.milliseconds - averageMilliseconds)
		variance += closureCountDeviation * closureCountDeviation
	}
	if (variance === 0) {
		return emptyCostMeasurement("todas as amostras usaram a mesma quantidade de closures")
	}

	const perClosureMilliseconds = covariance / variance
	return {
		measured: true,
		perClosureMilliseconds,
		baselineMilliseconds: averageMilliseconds - perClosureMilliseconds * averageClosureCount,
		sampleCount: samples.length,
		samples,
		method: SB_COST_METHOD,
		reason: null,
	}
}


export function buildCostReport(input) {
	return {
		declared: dispatchPlanCost(input?.plan),
		measured: costPerClosureFromSamples(input?.samples),
	}
}

export function isCostMeasured(costReport) {
	return costReport?.measured?.measured === true
}
