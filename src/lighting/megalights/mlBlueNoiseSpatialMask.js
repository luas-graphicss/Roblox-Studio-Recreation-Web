import { pixelsPerSliceOf } from "./mlBlueNoiseDescriptor.js";
import { createEnergyField, createTieBreakers } from "./mlBlueNoiseEnergyField.js";


const MASK_TIE_BREAKER_SEED_MIX = 0x1b873593;

export function createSpatialMaskBuilder(options) {
	const descriptor = options.descriptor;
	const kernel = options.kernel;
	const pixelCount = pixelsPerSliceOf(descriptor);
	const energyField = createEnergyField(descriptor, kernel);
	const tieBreakers = createTieBreakers(pixelCount, ((options.seed || 0) ^ MASK_TIE_BREAKER_SEED_MIX) >>> 0);
	const ranks = new Int32Array(pixelCount).fill(-1);


	const candidatePixels = new Int32Array(pixelCount);
	let candidateCount = pixelCount;
	let assignedRankCount = 0;

	for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex++) candidatePixels[pixelIndex] = pixelIndex;

	function leastCrowdedCandidatePosition() {
		const firstPixelIndex = candidatePixels[0];
		let bestPosition = 0;
		let bestScore = energyField.values[firstPixelIndex] + tieBreakers[firstPixelIndex];
		for (let position = 1; position < candidateCount; position++) {
			const pixelIndex = candidatePixels[position];
			const score = energyField.values[pixelIndex] + tieBreakers[pixelIndex];
			if (score < bestScore) {
				bestScore = score;
				bestPosition = position;
			}
		}
		return bestPosition;
	}

	function rankCandidateAt(position) {
		const pixelIndex = candidatePixels[position];
		candidateCount--;
		candidatePixels[position] = candidatePixels[candidateCount];
		ranks[pixelIndex] = assignedRankCount;
		assignedRankCount++;
		energyField.addSampleAt(pixelIndex);
	}

	return {
		pixelCount,
		isComplete() {
			return assignedRankCount >= pixelCount;
		},
		progress() {
			return assignedRankCount / pixelCount;
		},
		ranks() {
			return ranks;
		},
		step(workUnitBudget) {
			const budget = workUnitBudget > 0 ? workUnitBudget : 1;
			let consumedUnits = 0;
			while (assignedRankCount < pixelCount && consumedUnits < budget) {
				consumedUnits += candidateCount + kernel.tapCount;
				rankCandidateAt(leastCrowdedCandidatePosition());
			}
			return consumedUnits;
		},
	};
}


export function spatialGroupsOf(ranks, groupCount) {
	const pixelCount = ranks.length;
	const groups = new Uint8Array(pixelCount);
	for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex++) {
		groups[pixelIndex] = Math.min(groupCount - 1, Math.floor((ranks[pixelIndex] * groupCount) / pixelCount));
	}
	return groups;
}


export function groupPixelLists(groups, groupCount) {
	const pixelCount = groups.length;
	const sizes = new Int32Array(groupCount);
	for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex++) sizes[groups[pixelIndex]]++;
	const lists = [];
	for (let groupIndex = 0; groupIndex < groupCount; groupIndex++) lists.push(new Int32Array(sizes[groupIndex]));
	const writtenPerGroup = new Int32Array(groupCount);
	for (let pixelIndex = 0; pixelIndex < pixelCount; pixelIndex++) {
		const groupIndex = groups[pixelIndex];
		lists[groupIndex][writtenPerGroup[groupIndex]] = pixelIndex;
		writtenPerGroup[groupIndex]++;
	}
	return lists;
}
