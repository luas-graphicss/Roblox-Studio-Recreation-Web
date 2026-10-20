import { createToroidalEnergyField, MSM_ENERGY_KERNEL_SIGMA } from "./msmBlueNoiseEnergyFieldCore.js";


export const MSM_VOID_AND_CLUSTER_INITIAL_DENSITY = 0.1;


export const MSM_VOID_AND_CLUSTER_HOMOGENISE_GUARD_PER_PIXEL = 4;


function createDeterministicRandom(seed) {
	let state = seed >>> 0;
	return function nextUnitFloat() {
		state = (state + 0x9e3779b9) >>> 0;
		let mixed = state;
		mixed = (mixed ^ (mixed >>> 16)) >>> 0;
		mixed = Math.imul(mixed, 0x21f0aaad) >>> 0;
		mixed = (mixed ^ (mixed >>> 15)) >>> 0;
		mixed = Math.imul(mixed, 0x735a2d97) >>> 0;
		mixed = (mixed ^ (mixed >>> 15)) >>> 0;
		return mixed / 4294967296;
	};
}

function scatterPrototype(field, pointCount, seed) {
	const nextUnitFloat = createDeterministicRandom(seed);
	const attemptCeiling = field.pixelCount * 64;
	let placedCount = 0;
	let attempts = 0;
	while (placedCount < pointCount && attempts < attemptCeiling) {
		attempts += 1;
		const index = Math.min(field.pixelCount - 1, Math.floor(nextUnitFloat() * field.pixelCount));
		if (field.place(index)) placedCount += 1;
	}
	if (placedCount !== pointCount) {
		throw new Error("scatterPrototype: placed " + placedCount + " of " + pointCount + " prototype points");
	}
	return placedCount;
}

function homogenisePrototype(field, iterationCeiling) {
	let iterations = 0;
	while (iterations < iterationCeiling) {
		iterations += 1;
		const clusterIndex = field.tightestClusterIndex();
		if (clusterIndex < 0) break;
		field.remove(clusterIndex);
		const voidIndex = field.largestVoidIndex();
		if (voidIndex < 0 || voidIndex === clusterIndex) {
			field.place(clusterIndex);
			break;
		}
		field.place(voidIndex);
	}
	return iterations;
}


function assertRankPermutation(ranks, pixelCount) {
	const seen = new Uint8Array(pixelCount);
	for (let index = 0; index < pixelCount; index += 1) {
		const rank = ranks[index];
		if (!(rank >= 0 && rank < pixelCount)) throw new Error("void and cluster: rank out of range at texel " + index);
		if (seen[rank] === 1) throw new Error("void and cluster: rank " + rank + " used twice");
		seen[rank] = 1;
	}
}


export function buildVoidAndClusterRankMask(options) {
	const source = options && typeof options === "object" ? options : {};
	const sigma = Number.isFinite(source.sigma) && source.sigma > 0 ? Number(source.sigma) : MSM_ENERGY_KERNEL_SIGMA;
	const field = createToroidalEnergyField({ tileSize: source.tileSize, sigma });
	const pixelCount = field.pixelCount;
	const requestedDensity = Number(source.initialDensity);
	const density =
		Number.isFinite(requestedDensity) && requestedDensity > 0 && requestedDensity < 1
			? requestedDensity
			: MSM_VOID_AND_CLUSTER_INITIAL_DENSITY;
	const prototypeCount = Math.max(1, Math.min(pixelCount - 1, Math.round(pixelCount * density)));
	const seed = (Math.floor(Number(source.seed)) || 1) >>> 0;

	scatterPrototype(field, prototypeCount, seed);
	const homogeniseIterations = homogenisePrototype(field, pixelCount * MSM_VOID_AND_CLUSTER_HOMOGENISE_GUARD_PER_PIXEL);
	const prototype = field.snapshotOccupied();
	const ranks = new Int32Array(pixelCount).fill(-1);



	let descendingRank = prototypeCount - 1;
	while (field.occupiedCount() > 0) {
		const clusterIndex = field.tightestClusterIndex();
		field.remove(clusterIndex);
		ranks[clusterIndex] = descendingRank;
		descendingRank -= 1;
	}


	field.restoreOccupied(prototype);
	let ascendingRank = prototypeCount;
	while (field.occupiedCount() < pixelCount) {
		const voidIndex = field.largestVoidIndex();
		field.place(voidIndex);
		ranks[voidIndex] = ascendingRank;
		ascendingRank += 1;
	}

	assertRankPermutation(ranks, pixelCount);

	return Object.freeze({
		ranks,
		tileSize: field.tileSize,
		pixelCount,
		prototypeCount,
		homogeniseIterations,
		sigma: field.sigma,
		kernelRadius: field.kernelRadius,
		seed,
	});
}
