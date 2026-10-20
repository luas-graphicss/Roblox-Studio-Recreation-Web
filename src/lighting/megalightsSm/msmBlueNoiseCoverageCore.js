import {
	MSM_BLUE_NOISE_CHANNEL_COUNT,
	MSM_BLUE_NOISE_PIXELS_PER_SLICE,
	MSM_BLUE_NOISE_SLICE_COUNT,
	MSM_BLUE_NOISE_TILE_SIZE,
	MSM_BLUE_NOISE_VALUE_LEVEL_COUNT,
	blueNoiseUnitValueFromByte,
	readBlueNoiseByte,
} from "./msmBlueNoiseDescriptorCore.js";


export const MSM_BLUE_NOISE_STRATUM_COUNT = MSM_BLUE_NOISE_SLICE_COUNT;
export const MSM_BLUE_NOISE_STRATUM_WIDTH = MSM_BLUE_NOISE_VALUE_LEVEL_COUNT / MSM_BLUE_NOISE_STRATUM_COUNT;

export const MSM_BLUE_NOISE_COVERAGE_GATE = Object.freeze({

	requiredStratumVisits: 1,

	requiredDistinctValuesPerPixel: MSM_BLUE_NOISE_SLICE_COUNT,


	maximumTemporalMeanDeviation: 1 / 16,

	maximumIdenticalTexelFraction: 0,

	maximumChannelCorrelation: 0.15,
});


export function stratumOfByte(byteValue) {
	const clamped = Math.min(MSM_BLUE_NOISE_VALUE_LEVEL_COUNT - 1, Math.max(0, Math.floor(byteValue)));
	return Math.floor(clamped / MSM_BLUE_NOISE_STRATUM_WIDTH);
}


export function evaluateTemporalCoverage(request) {
	const source = request && typeof request === "object" ? request : {};
	const gate = source.gate && typeof source.gate === "object" ? source.gate : MSM_BLUE_NOISE_COVERAGE_GATE;
	const bytes = source.bytes;
	const channelIndex = Math.floor(Number(source.channelIndex)) || 0;
	const problems = [];

	const stratumVisits = new Int32Array(MSM_BLUE_NOISE_STRATUM_COUNT);
	const seenValues = new Uint8Array(MSM_BLUE_NOISE_VALUE_LEVEL_COUNT);
	let minimumStratumVisits = Number.POSITIVE_INFINITY;
	let maximumStratumVisits = 0;
	let minimumDistinctValues = MSM_BLUE_NOISE_SLICE_COUNT;
	let worstTemporalMeanDeviation = 0;
	let pixelCount = 0;

	for (let tileY = 0; tileY < MSM_BLUE_NOISE_TILE_SIZE; tileY += 1) {
		for (let tileX = 0; tileX < MSM_BLUE_NOISE_TILE_SIZE; tileX += 1) {
			stratumVisits.fill(0);
			seenValues.fill(0);
			let distinctValues = 0;
			let unitValueTotal = 0;
			for (let sliceIndex = 0; sliceIndex < MSM_BLUE_NOISE_SLICE_COUNT; sliceIndex += 1) {
				const storedByte = readBlueNoiseByte(bytes, tileX, tileY, sliceIndex, channelIndex);
				stratumVisits[stratumOfByte(storedByte)] += 1;
				if (seenValues[storedByte] === 0) {
					seenValues[storedByte] = 1;
					distinctValues += 1;
				}
				unitValueTotal += blueNoiseUnitValueFromByte(storedByte);
			}
			for (let stratum = 0; stratum < MSM_BLUE_NOISE_STRATUM_COUNT; stratum += 1) {
				if (stratumVisits[stratum] < minimumStratumVisits) minimumStratumVisits = stratumVisits[stratum];
				if (stratumVisits[stratum] > maximumStratumVisits) maximumStratumVisits = stratumVisits[stratum];
			}
			if (distinctValues < minimumDistinctValues) minimumDistinctValues = distinctValues;
			const meanDeviation = Math.abs(unitValueTotal / MSM_BLUE_NOISE_SLICE_COUNT - 0.5);
			if (meanDeviation > worstTemporalMeanDeviation) worstTemporalMeanDeviation = meanDeviation;
			pixelCount += 1;
		}
	}

	if (minimumStratumVisits !== gate.requiredStratumVisits || maximumStratumVisits !== gate.requiredStratumVisits) {
		problems.push(
			"stratum visits per pixel range from " +
				minimumStratumVisits +
				" to " +
				maximumStratumVisits +
				", the gate demands exactly " +
				gate.requiredStratumVisits,
		);
	}
	if (minimumDistinctValues < gate.requiredDistinctValuesPerPixel) {
		problems.push(
			"a pixel repeats a value inside the cycle: " +
				minimumDistinctValues +
				" distinct values out of " +
				gate.requiredDistinctValuesPerPixel,
		);
	}
	if (!(worstTemporalMeanDeviation <= gate.maximumTemporalMeanDeviation)) {
		problems.push(
			"the mean of a pixel over the cycle drifts " +
				worstTemporalMeanDeviation.toFixed(4) +
				" from 0.5, above the gate " +
				gate.maximumTemporalMeanDeviation.toFixed(4),
		);
	}

	return {
		pass: problems.length === 0,
		channelIndex,
		pixelCount,
		minimumStratumVisits: minimumStratumVisits === Number.POSITIVE_INFINITY ? 0 : minimumStratumVisits,
		maximumStratumVisits,
		minimumDistinctValues,
		worstTemporalMeanDeviation,
		problems,
	};
}


export function evaluateSlicePairSeparation(request) {
	const source = request && typeof request === "object" ? request : {};
	const gate = source.gate && typeof source.gate === "object" ? source.gate : MSM_BLUE_NOISE_COVERAGE_GATE;
	const bytes = source.bytes;
	const channelIndex = Math.floor(Number(source.channelIndex)) || 0;
	const problems = [];

	let worstIdenticalTexelFraction = 0;
	let worstPair = null;
	let pairCount = 0;

	for (let firstSlice = 0; firstSlice < MSM_BLUE_NOISE_SLICE_COUNT; firstSlice += 1) {
		for (let secondSlice = firstSlice + 1; secondSlice < MSM_BLUE_NOISE_SLICE_COUNT; secondSlice += 1) {
			pairCount += 1;
			let identicalTexels = 0;
			for (let tileY = 0; tileY < MSM_BLUE_NOISE_TILE_SIZE; tileY += 1) {
				for (let tileX = 0; tileX < MSM_BLUE_NOISE_TILE_SIZE; tileX += 1) {
					const firstByte = readBlueNoiseByte(bytes, tileX, tileY, firstSlice, channelIndex);
					const secondByte = readBlueNoiseByte(bytes, tileX, tileY, secondSlice, channelIndex);
					if (firstByte === secondByte) identicalTexels += 1;
				}
			}
			const identicalFraction = identicalTexels / MSM_BLUE_NOISE_PIXELS_PER_SLICE;
			if (identicalFraction > worstIdenticalTexelFraction) {
				worstIdenticalTexelFraction = identicalFraction;
				worstPair = { firstSlice, secondSlice, identicalTexels };
			}
		}
	}

	if (!(worstIdenticalTexelFraction <= gate.maximumIdenticalTexelFraction)) {
		problems.push(
			"slices " +
				(worstPair ? worstPair.firstSlice + " and " + worstPair.secondSlice : "?") +
				" share " +
				(worstIdenticalTexelFraction * 100).toFixed(2) +
				"% of their texels, above the gate " +
				gate.maximumIdenticalTexelFraction,
		);
	}

	return {
		pass: problems.length === 0,
		channelIndex,
		pairCount,
		worstIdenticalTexelFraction,
		worstPair,
		problems,
	};
}

function pearsonCorrelation(firstSamples, secondSamples) {
	const sampleCount = firstSamples.length;
	if (sampleCount === 0) return 0;
	let firstTotal = 0;
	let secondTotal = 0;
	for (let index = 0; index < sampleCount; index += 1) {
		firstTotal += firstSamples[index];
		secondTotal += secondSamples[index];
	}
	const firstMean = firstTotal / sampleCount;
	const secondMean = secondTotal / sampleCount;
	let covariance = 0;
	let firstVariance = 0;
	let secondVariance = 0;
	for (let index = 0; index < sampleCount; index += 1) {
		const firstDelta = firstSamples[index] - firstMean;
		const secondDelta = secondSamples[index] - secondMean;
		covariance += firstDelta * secondDelta;
		firstVariance += firstDelta * firstDelta;
		secondVariance += secondDelta * secondDelta;
	}
	const denominator = Math.sqrt(firstVariance * secondVariance);
	return denominator > 0 ? covariance / denominator : 0;
}


export function evaluateChannelIndependence(request) {
	const source = request && typeof request === "object" ? request : {};
	const gate = source.gate && typeof source.gate === "object" ? source.gate : MSM_BLUE_NOISE_COVERAGE_GATE;
	const bytes = source.bytes;
	const problems = [];

	const sampleCount = MSM_BLUE_NOISE_PIXELS_PER_SLICE * MSM_BLUE_NOISE_SLICE_COUNT;
	const channelSamples = [];
	for (let channelIndex = 0; channelIndex < MSM_BLUE_NOISE_CHANNEL_COUNT; channelIndex += 1) {
		const samples = new Float64Array(sampleCount);
		let writeIndex = 0;
		for (let sliceIndex = 0; sliceIndex < MSM_BLUE_NOISE_SLICE_COUNT; sliceIndex += 1) {
			for (let tileY = 0; tileY < MSM_BLUE_NOISE_TILE_SIZE; tileY += 1) {
				for (let tileX = 0; tileX < MSM_BLUE_NOISE_TILE_SIZE; tileX += 1) {
					samples[writeIndex] = readBlueNoiseByte(bytes, tileX, tileY, sliceIndex, channelIndex);
					writeIndex += 1;
				}
			}
		}
		channelSamples.push(samples);
	}

	let worstAbsoluteCorrelation = 0;
	let worstPair = null;
	let pairCount = 0;
	for (let firstChannel = 0; firstChannel < MSM_BLUE_NOISE_CHANNEL_COUNT; firstChannel += 1) {
		for (let secondChannel = firstChannel + 1; secondChannel < MSM_BLUE_NOISE_CHANNEL_COUNT; secondChannel += 1) {
			pairCount += 1;
			const correlation = pearsonCorrelation(channelSamples[firstChannel], channelSamples[secondChannel]);
			if (Math.abs(correlation) > worstAbsoluteCorrelation) {
				worstAbsoluteCorrelation = Math.abs(correlation);
				worstPair = { firstChannel, secondChannel, correlation };
			}
		}
	}

	if (!(worstAbsoluteCorrelation <= gate.maximumChannelCorrelation)) {
		problems.push(
			"channels " +
				(worstPair ? worstPair.firstChannel + " and " + worstPair.secondChannel : "?") +
				" correlate at " +
				worstAbsoluteCorrelation.toFixed(4) +
				", above the gate " +
				gate.maximumChannelCorrelation,
		);
	}

	return {
		pass: problems.length === 0,
		pairCount,
		sampleCount,
		worstAbsoluteCorrelation,
		worstPair,
		problems,
	};
}
