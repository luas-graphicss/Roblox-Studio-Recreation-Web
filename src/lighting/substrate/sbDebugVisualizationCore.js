import { SB_BYTES_PER_PIXEL_CEILING, SB_MAX_CLOSURES_PER_PIXEL } from "./sbMaterialContract.js"
import {
	DEFAULT_CLOSURE_KIND,
	buildDispatchPlan,
	createStubClosureList,
	resolveTierName,
	tierClosureCeiling,
} from "./sbClosureDispatchCore.js"

export const DEBUG_VISUALIZATION_PHASE_ID = "SB-F35"


export const SB_DEBUG_MODE_IDS = {
	off: "off",
	materialCount: "materialCount",
	bytesPerPixel: "bytesPerPixel",
	closureInspector: "closureInspector",
}


export const SB_DEBUG_MODES = Object.freeze([
	Object.freeze({
		id: SB_DEBUG_MODE_IDS.off,
		code: 0,
		title: "debug desligado",
		readoutKind: "none",
		paintsPixel: false,
	}),
	Object.freeze({
		id: SB_DEBUG_MODE_IDS.materialCount,
		code: 1,
		title: "material por pixel",
		readoutKind: "closureCount",
		paintsPixel: true,
	}),
	Object.freeze({
		id: SB_DEBUG_MODE_IDS.bytesPerPixel,
		code: 2,
		title: "bytes por pixel",
		readoutKind: "bytesPerPixel",
		paintsPixel: true,
	}),
	Object.freeze({
		id: SB_DEBUG_MODE_IDS.closureInspector,
		code: 3,
		title: "inspetor de closures",
		readoutKind: "closureList",
		paintsPixel: false,
	}),
])


export const SB_DEBUG_RAMP_STOPS = Object.freeze([
	Object.freeze([0.05, 0.2, 0.65]),
	Object.freeze([0.1, 0.65, 0.3]),
	Object.freeze([0.95, 0.8, 0.15]),
	Object.freeze([0.85, 0.15, 0.1]),
])

export function debugModeIds() {
	return SB_DEBUG_MODES.map((mode) => mode.id)
}

export function debugModeEntry(modeId) {
	return SB_DEBUG_MODES.find((mode) => mode.id === modeId) ?? null
}

export function isKnownDebugMode(modeId) {
	return debugModeEntry(modeId) !== null
}

export function debugModeCode(modeId) {
	return debugModeEntry(modeId)?.code ?? null
}

export function debugModeFromCode(modeCode) {
	return SB_DEBUG_MODES.find((mode) => mode.code === modeCode)?.id ?? null
}

export function clampUnitRatio(rawRatio) {
	if (!Number.isFinite(rawRatio)) return 0
	if (0 > rawRatio) return 0
	if (rawRatio > 1) return 1
	return rawRatio
}


export function debugRampColor(rawRatio) {
	const lastStopIndex = SB_DEBUG_RAMP_STOPS.length - 1
	const scaledRatio = clampUnitRatio(rawRatio) * lastStopIndex
	const lowerStopIndex = Math.min(Math.floor(scaledRatio), lastStopIndex - 1)
	const blend = scaledRatio - lowerStopIndex
	const lowerStop = SB_DEBUG_RAMP_STOPS[lowerStopIndex]


	if (blend === 0) return [...lowerStop]
	if (blend === 1) return [...SB_DEBUG_RAMP_STOPS[lowerStopIndex + 1]]
	const upperStop = SB_DEBUG_RAMP_STOPS[lowerStopIndex + 1]
	return lowerStop.map((channelValue, channel) => channelValue + (upperStop[channel] - channelValue) * blend)
}


export function buildPixelDispatchPlan(input) {
	const tierName = resolveTierName(input?.tierName)
	const closures = Array.isArray(input?.closures)
		? input.closures
		: createStubClosureList({ closureCount: tierClosureCeiling(tierName), kind: DEFAULT_CLOSURE_KIND })
	return buildDispatchPlan({ closures, tierName })
}


export function measureClosureCount(plan) {
	const closureCount = Number.isInteger(plan?.dispatchedCount) ? plan.dispatchedCount : 0
	const tierCeiling = Number.isInteger(plan?.closureCeiling) ? plan.closureCeiling : 0
	const ratio = clampUnitRatio(closureCount / SB_MAX_CLOSURES_PER_PIXEL)
	return {
		modeId: SB_DEBUG_MODE_IDS.materialCount,
		closureCount,
		requestedCount: Number.isInteger(plan?.requestedCount) ? plan.requestedCount : 0,
		droppedCount: Number.isInteger(plan?.droppedCount) ? plan.droppedCount : 0,
		tierCeiling,
		contractCeiling: SB_MAX_CLOSURES_PER_PIXEL,
		withinTierCeiling: tierCeiling >= closureCount,
		ratio,
		color: debugRampColor(ratio),
	}
}


export function measureBytesPerPixel(plan) {
	const bytesPerPixel = Number.isFinite(plan?.bytesPerPixel) ? plan.bytesPerPixel : 0
	const tierCeiling = Number.isFinite(plan?.byteCeiling) ? plan.byteCeiling : 0
	const ratio = clampUnitRatio(bytesPerPixel / SB_BYTES_PER_PIXEL_CEILING)
	return {
		modeId: SB_DEBUG_MODE_IDS.bytesPerPixel,
		bytesPerPixel,
		tierCeiling,
		contractCeiling: SB_BYTES_PER_PIXEL_CEILING,
		headroomBytes: tierCeiling - bytesPerPixel,
		withinTierCeiling: tierCeiling >= bytesPerPixel,
		ratio,
		color: debugRampColor(ratio),
	}
}


export function inspectPixelClosures(plan) {
	const dispatched = Array.isArray(plan?.dispatched) ? plan.dispatched : []
	const dropped = Array.isArray(plan?.dropped) ? plan.dropped : []
	const totalBytes = dispatched.reduce(
		(total, closure) => total + (Number.isFinite(closure?.bytes) ? closure.bytes : 0),
		0,
	)
	const rows = dispatched.map((closure) => ({
		slot: closure.slot,
		kind: closure.kind,
		label: closure.label,
		layerIndex: closure.layerIndex,
		weight: closure.weight,
		bytes: closure.bytes,
		byteShare: totalBytes === 0 ? 0 : closure.bytes / totalBytes,
		closureCost: closure.closureCost,
	}))
	return {
		modeId: SB_DEBUG_MODE_IDS.closureInspector,
		rowCount: rows.length,
		rows,
		totalBytes,
		droppedRows: dropped.map((closure) => ({
			kind: closure.kind,
			label: closure.label,
			weight: closure.weight,
			dropReason: closure.dropReason,
		})),
	}
}

function readoutForMode(modeEntry, measurements) {
	if (modeEntry.readoutKind === "closureCount") return measurements.materialCount
	if (modeEntry.readoutKind === "bytesPerPixel") return measurements.bytes
	if (modeEntry.readoutKind === "closureList") return measurements.inspector
	return null
}


export function evaluateDebugVisualization(input) {
	const requestedModeId = typeof input?.modeId === "string" ? input.modeId : SB_DEBUG_MODE_IDS.off
	const problems = []
	let modeEntry = debugModeEntry(requestedModeId)
	if (modeEntry === null) {
		problems.push("modo de debug desconhecido: " + requestedModeId)
		modeEntry = debugModeEntry(SB_DEBUG_MODE_IDS.off)
	}
	const plan = buildPixelDispatchPlan(input)
	const measurements = {
		materialCount: measureClosureCount(plan),
		bytes: measureBytesPerPixel(plan),
		inspector: inspectPixelClosures(plan),
	}
	const readout = readoutForMode(modeEntry, measurements)
	const paintsPixel = modeEntry.paintsPixel === true
	return {
		phaseId: DEBUG_VISUALIZATION_PHASE_ID,
		modeId: modeEntry.id,
		modeCode: modeEntry.code,
		modeTitle: modeEntry.title,
		tier: plan.tier,
		paintsPixel,
		ratio: paintsPixel ? readout.ratio : null,
		color: paintsPixel ? readout.color : null,
		readout,
		materialCount: measurements.materialCount,
		bytes: measurements.bytes,
		inspector: measurements.inspector,
		plan,
		problems: [...problems, ...plan.problems],
	}
}


export function debugVisualizationSignature(input) {
	const modeId = isKnownDebugMode(input?.modeId) ? input.modeId : SB_DEBUG_MODE_IDS.off
	const tierName = resolveTierName(input?.tierName)
	const closures = Array.isArray(input?.closures) ? input.closures : null
	const closureParts =
		closures === null
			? ["stub"]
			: closures.map((closure) => (closure?.kind ?? "") + ":" + (closure?.weight ?? ""))
	return modeId + "|" + tierName + "|" + closureParts.join("+")
}


export function describeDebugVisualization(input) {
	const evaluation = evaluateDebugVisualization(input)
	return {
		phaseId: evaluation.phaseId,
		modeId: evaluation.modeId,
		modeCode: evaluation.modeCode,
		modeTitle: evaluation.modeTitle,
		tier: evaluation.tier,
		closureCount: evaluation.materialCount.closureCount,
		closureCeiling: evaluation.materialCount.tierCeiling,
		bytesPerPixel: evaluation.bytes.bytesPerPixel,
		byteCeiling: evaluation.bytes.tierCeiling,
		inspectedRowCount: evaluation.inspector.rowCount,
		paintsPixel: evaluation.paintsPixel,
		ratio: evaluation.ratio,
		problems: evaluation.problems,
	}
}
