export const SB_RADIANCE_CHANNEL_COUNT = 3
export const SB_ACCUMULATOR_CHANNELS = ["diffuse", "specular"]

function sanitizeChannelValue(value) {
	return Number.isFinite(value) ? value : 0
}

function sanitizeRadianceChannel(rawChannel) {
	const channel = []
	for (let index = 0; SB_RADIANCE_CHANNEL_COUNT > index; index += 1) {
		const rawValue = Array.isArray(rawChannel) ? rawChannel[index] : rawChannel
		channel.push(sanitizeChannelValue(rawValue))
	}
	return channel
}


export function sanitizeRadiance(rawRadiance) {
	return {
		diffuse: sanitizeRadianceChannel(rawRadiance?.diffuse),
		specular: sanitizeRadianceChannel(rawRadiance?.specular),
	}
}

export function createClosureAccumulator() {
	return {
		diffuse: [0, 0, 0],
		specular: [0, 0, 0],
		evaluatedCount: 0,
		weightSum: 0,
		evaluationFailures: 0,
	}
}


export function accumulateClosureRadiance(accumulator, closure, rawRadiance) {
	const radiance = sanitizeRadiance(rawRadiance)
	const weight = Number.isFinite(closure?.weight) ? closure.weight : 1
	for (let index = 0; SB_RADIANCE_CHANNEL_COUNT > index; index += 1) {
		accumulator.diffuse[index] += radiance.diffuse[index] * weight
		accumulator.specular[index] += radiance.specular[index] * weight
	}
	accumulator.evaluatedCount += 1
	accumulator.weightSum += weight
	return accumulator
}

function evaluateClosureSafely(evaluateClosure, closure) {
	if (typeof evaluateClosure !== "function") return null
	try {
		return evaluateClosure(closure)
	} catch (error) {
		return null
	}
}


export function accumulateDispatchPlan(input) {
	const accumulator = createClosureAccumulator()
	const dispatchedClosures = Array.isArray(input?.plan?.dispatched) ? input.plan.dispatched : []
	for (const closure of dispatchedClosures) {
		const radiance = evaluateClosureSafely(input?.evaluateClosure, closure)
		if (radiance === null) {
			accumulator.evaluationFailures += 1
			continue
		}
		accumulateClosureRadiance(accumulator, closure, radiance)
	}
	return accumulator
}


export function evaluateLegacyClosurePath(input) {
	const radiance = evaluateClosureSafely(input?.evaluateClosure, input?.closure)
	return sanitizeRadiance(radiance)
}

function radianceOf(candidate) {
	return {
		diffuse: sanitizeRadianceChannel(candidate?.diffuse),
		specular: sanitizeRadianceChannel(candidate?.specular),
	}
}


export function radianceDifference(left, right) {
	const leftRadiance = radianceOf(left)
	const rightRadiance = radianceOf(right)
	let worstDifference = 0
	for (const channelName of SB_ACCUMULATOR_CHANNELS) {
		for (let index = 0; SB_RADIANCE_CHANNEL_COUNT > index; index += 1) {
			const difference = Math.abs(leftRadiance[channelName][index] - rightRadiance[channelName][index])
			if (difference > worstDifference) worstDifference = difference
		}
	}
	return worstDifference
}


export function isBitIdenticalRadiance(left, right) {
	return radianceDifference(left, right) === 0
}
