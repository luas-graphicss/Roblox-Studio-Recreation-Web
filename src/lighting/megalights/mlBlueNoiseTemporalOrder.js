function cyclicDistance(first, second, count) {
	const straight = Math.abs(first - second);
	return Math.min(straight, count - straight);
}


export function maximallySeparatedCycleOrder(count) {
	const positionCount = Math.max(1, Math.floor(count));
	const order = new Int32Array(positionCount);
	const isChosen = new Uint8Array(positionCount);
	isChosen[0] = 1;

	for (let placed = 1; placed < positionCount; placed++) {
		const lastChosen = order[placed - 1];
		let bestPosition = -1;
		let bestNearestDistance = -1;
		let bestDistanceToLast = -1;

		for (let candidate = 0; candidate < positionCount; candidate++) {
			if (isChosen[candidate]) continue;
			let nearestDistance = positionCount;
			for (let other = 0; other < positionCount; other++) {
				if (!isChosen[other]) continue;
				const distance = cyclicDistance(candidate, other, positionCount);
				if (distance < nearestDistance) nearestDistance = distance;
			}
			const distanceToLast = cyclicDistance(candidate, lastChosen, positionCount);
			const isBetter =
				nearestDistance > bestNearestDistance ||
				(nearestDistance === bestNearestDistance && distanceToLast > bestDistanceToLast);
			if (isBetter) {
				bestNearestDistance = nearestDistance;
				bestDistanceToLast = distanceToLast;
				bestPosition = candidate;
			}
		}

		order[placed] = bestPosition;
		isChosen[bestPosition] = 1;
	}

	return order;
}


export function createTemporalBandOrder(sliceCount) {
	const count = Math.max(1, Math.floor(sliceCount));
	const bandPhaseBySlice = maximallySeparatedCycleOrder(count);
	const sliceByBandPhase = new Int32Array(count);
	for (let sliceIndex = 0; sliceIndex < count; sliceIndex++) sliceByBandPhase[bandPhaseBySlice[sliceIndex]] = sliceIndex;

	function wrap(value) {
		return ((value % count) + count) % count;
	}

	return Object.freeze({
		sliceCount: count,
		bandCount: count,
		bandPhaseBySlice,

		bandAt(sliceIndex, groupIndex) {
			return wrap(bandPhaseBySlice[wrap(sliceIndex)] + groupIndex);
		},

		groupHostedBy(sliceIndex, bandIndex) {
			return wrap(bandIndex - bandPhaseBySlice[wrap(sliceIndex)]);
		},

		sliceHosting(bandIndex, groupIndex) {
			return sliceByBandPhase[wrap(bandIndex - groupIndex)];
		},
	});
}


export function bandSequenceForGroup(bandOrder, groupIndex) {
	const sequence = new Int32Array(bandOrder.sliceCount);
	for (let sliceIndex = 0; sliceIndex < bandOrder.sliceCount; sliceIndex++) {
		sequence[sliceIndex] = bandOrder.bandAt(sliceIndex, groupIndex);
	}
	return sequence;
}
