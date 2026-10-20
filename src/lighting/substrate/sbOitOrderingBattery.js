import { resolveSortedPixels } from "./sbOitSortedPixelsCore.js"
import { resolveWeightedBlended } from "./sbOitWeightedBlendedCore.js"

export const SB_ORDERING_BATTERY_ANGLES_DEGREES = [0, 60, 120, 180, 240, 300]
export const SB_ORDERING_BATTERY_BACKGROUND_COLOR = [0.06, 0.07, 0.09]


export const SB_ORDERING_BATTERY_PANES = [
	{
		id: "glassPaneA",
		rotationRadians: -0.9,
		center: [-0.62, 1.3, 0.55],
		color: [0.62, 0.86, 0.94],
		coverage: 0.34,
		transmittanceColor: [0.72, 0.94, 0.98],
		thickness: 0.9,
	},
	{
		id: "glassPaneB",
		rotationRadians: -0.3,
		center: [-0.21, 1.3, -0.35],
		color: [0.94, 0.72, 0.58],
		coverage: 0.28,
		transmittanceColor: [0.98, 0.78, 0.66],
		thickness: 1.2,
	},
	{
		id: "glassPaneC",
		rotationRadians: 0.3,
		center: [0.21, 1.3, 0.32],
		color: [0.7, 0.94, 0.68],
		coverage: 0.41,
		transmittanceColor: [0.74, 0.98, 0.7],
		thickness: 0.7,
	},
	{
		id: "glassPaneD",
		rotationRadians: 0.9,
		center: [0.62, 1.3, -0.58],
		color: [0.86, 0.7, 0.96],
		coverage: 0.22,
		transmittanceColor: [0.86, 0.7, 0.99],
		thickness: 1.5,
	},
]

const CAMERA_RADIUS = 6.6
const CAMERA_HEIGHT = 2.4
const PROBE_TARGET = [0, 1.3, 0]
const MINIMUM_FACING_COSINE = 0.05
const DEGREES_TO_RADIANS = Math.PI / 180
const CHANNEL_INDEXES = [0, 1, 2]

function subtractVectors(left, right) {
	return [left[0] - right[0], left[1] - right[1], left[2] - right[2]]
}

function dotProduct(left, right) {
	return left[0] * right[0] + left[1] * right[1] + left[2] * right[2]
}

function normalizeVector(vector) {
	const length = Math.hypot(vector[0], vector[1], vector[2])
	if (length === 0) return [0, 0, 1]
	return [vector[0] / length, vector[1] / length, vector[2] / length]
}

function paneNormal(pane) {
	return [Math.sin(pane.rotationRadians), 0, Math.cos(pane.rotationRadians)]
}


export function cameraRayForAngle(angleDegrees) {
	const angleRadians = angleDegrees * DEGREES_TO_RADIANS
	const origin = [CAMERA_RADIUS * Math.sin(angleRadians), CAMERA_HEIGHT, CAMERA_RADIUS * Math.cos(angleRadians)]
	return { origin, direction: normalizeVector(subtractVectors(PROBE_TARGET, origin)) }
}


export function intersectPaneWithRay(pane, ray) {
	const normal = paneNormal(pane)
	const facing = dotProduct(ray.direction, normal)
	if (MINIMUM_FACING_COSINE > Math.abs(facing)) return null
	const distance = dotProduct(subtractVectors(pane.center, ray.origin), normal) / facing
	if (0 >= distance) return null
	return { distance, facingCosine: Math.abs(facing) }
}

export function buildFragmentsForAngle(angleDegrees) {
	const ray = cameraRayForAngle(angleDegrees)
	const fragments = []
	for (const pane of SB_ORDERING_BATTERY_PANES) {
		const hit = intersectPaneWithRay(pane, ray)
		if (!hit) continue
		fragments.push({
			id: pane.id,
			depth: hit.distance,
			color: pane.color,
			coverage: pane.coverage,
			transmittanceColor: pane.transmittanceColor,
			thickness: pane.thickness,
			cosThetaView: hit.facingCosine,
		})
	}
	return fragments
}


export function expectedOrderForAngle(angleDegrees) {
	return buildFragmentsForAngle(angleDegrees)
		.map((fragment, index) => ({ id: fragment.id, depth: fragment.depth, index }))
		.sort((left, right) => (left.depth === right.depth ? left.index - right.index : right.depth - left.depth))
		.map((entry) => entry.id)
}

function worstChannelDifference(leftColor, rightColor) {
	return Math.max(...CHANNEL_INDEXES.map((channelIndex) => Math.abs(leftColor[channelIndex] - rightColor[channelIndex])))
}

function runOrderingBatteryAngle(angleDegrees, backgroundColor) {
	const fragments = buildFragmentsForAngle(angleDegrees)
	const expectedOrder = expectedOrderForAngle(angleDegrees)
	const sorted = resolveSortedPixels({ fragments, backgroundColor })
	const shuffled = resolveSortedPixels({ fragments: [...fragments].reverse(), backgroundColor })
	const weighted = resolveWeightedBlended({ fragments, backgroundColor })

	const orderCorrect = sorted.order === expectedOrder.join("|")
	const shuffleStable =
		shuffled.order === sorted.order &&
		shuffled.color.every((channel, channelIndex) => Object.is(channel, sorted.color[channelIndex]))

	return {
		angleDegrees,
		hitCount: fragments.length,
		expectedOrder,
		resolvedOrder: sorted.orderedIds,
		orderCorrect,
		shuffleStable,
		sortedColor: sorted.color,
		weightedColor: weighted.color,
		modeDifference: worstChannelDifference(weighted.color, sorted.color),
	}
}

export function runOrderingBattery(options) {
	const backgroundColor = options?.backgroundColor ?? SB_ORDERING_BATTERY_BACKGROUND_COLOR
	const angles = SB_ORDERING_BATTERY_ANGLES_DEGREES.map((angleDegrees) =>
		runOrderingBatteryAngle(angleDegrees, backgroundColor),
	)
	const distinctOrders = new Set(angles.map((angle) => angle.resolvedOrder.join("|")))

	return {
		paneCount: SB_ORDERING_BATTERY_PANES.length,
		angleCount: angles.length,
		angles,
		correctAngleCount: angles.filter((angle) => angle.orderCorrect).length,
		allOrdersCorrect: angles.every((angle) => angle.orderCorrect),
		allShufflesStable: angles.every((angle) => angle.shuffleStable),
		everyAngleHitsAllPanes: angles.every((angle) => angle.hitCount === SB_ORDERING_BATTERY_PANES.length),
		distinctOrderCount: distinctOrders.size,
		worstModeDifference: Math.max(...angles.map((angle) => angle.modeDifference)),
	}
}


export function compareTranslucencyModesOnBattery(options) {
	const battery = runOrderingBattery(options)
	return {
		worstModeDifference: battery.worstModeDifference,
		byAngle: battery.angles.map((angle) => ({
			angleDegrees: angle.angleDegrees,
			modeDifference: angle.modeDifference,
		})),
	}
}
