import { createEnergyExtremaSearch } from "./msmEnergyExtremaSearchCore.js";


export const MSM_ENERGY_KERNEL_SIGMA = 1.9;


export function energyKernelRadiusFor(tileSize, sigma) {
	const safeSigma = Number.isFinite(sigma) && sigma > 0 ? sigma : MSM_ENERGY_KERNEL_SIGMA;
	const threeSigma = Math.ceil(safeSigma * 3);
	const halfTile = Math.floor(tileSize / 2);
	return Math.max(1, Math.min(threeSigma, halfTile));
}

function buildKernelWeights(kernelRadius, sigma) {
	const kernelSide = kernelRadius * 2 + 1;
	const weights = new Float64Array(kernelSide * kernelSide);
	const twiceSigmaSquared = 2 * sigma * sigma;
	for (let offsetY = -kernelRadius; offsetY <= kernelRadius; offsetY += 1) {
		for (let offsetX = -kernelRadius; offsetX <= kernelRadius; offsetX += 1) {
			const squaredDistance = offsetX * offsetX + offsetY * offsetY;
			weights[(offsetY + kernelRadius) * kernelSide + (offsetX + kernelRadius)] = Math.exp(
				-squaredDistance / twiceSigmaSquared,
			);
		}
	}
	return weights;
}


export function createToroidalEnergyField(options) {
	const source = options && typeof options === "object" ? options : {};
	const tileSize = Math.floor(Number(source.tileSize));
	if (!(tileSize >= 4)) throw new Error("createToroidalEnergyField: tileSize has to be at least 4");
	const sigma = Number.isFinite(source.sigma) && source.sigma > 0 ? Number(source.sigma) : MSM_ENERGY_KERNEL_SIGMA;
	const kernelRadius = energyKernelRadiusFor(tileSize, sigma);
	const kernelSide = kernelRadius * 2 + 1;
	const kernelWeights = buildKernelWeights(kernelRadius, sigma);
	const pixelCount = tileSize * tileSize;
	const energy = new Float64Array(pixelCount);
	const occupied = new Uint8Array(pixelCount);
	const extremaSearch = createEnergyExtremaSearch({ tileSize, energy, occupied });
	let occupiedTotal = 0;

	function stampKernel(index, sign) {



		extremaSearch.markStaleAround(index, kernelRadius);
		const centerY = Math.floor(index / tileSize);
		const centerX = index - centerY * tileSize;
		for (let offsetY = -kernelRadius; offsetY <= kernelRadius; offsetY += 1) {
			let wrappedY = centerY + offsetY;
			if (wrappedY < 0) wrappedY += tileSize;
			else if (wrappedY >= tileSize) wrappedY -= tileSize;
			const rowOffset = wrappedY * tileSize;
			const kernelRowOffset = (offsetY + kernelRadius) * kernelSide;
			for (let offsetX = -kernelRadius; offsetX <= kernelRadius; offsetX += 1) {
				let wrappedX = centerX + offsetX;
				if (wrappedX < 0) wrappedX += tileSize;
				else if (wrappedX >= tileSize) wrappedX -= tileSize;
				energy[rowOffset + wrappedX] += sign * kernelWeights[kernelRowOffset + (offsetX + kernelRadius)];
			}
		}
	}

	function place(index) {
		if (!(index >= 0 && index < pixelCount) || occupied[index] === 1) return false;
		occupied[index] = 1;
		occupiedTotal += 1;
		stampKernel(index, 1);
		return true;
	}

	function remove(index) {
		if (!(index >= 0 && index < pixelCount) || occupied[index] === 0) return false;
		occupied[index] = 0;
		occupiedTotal -= 1;
		stampKernel(index, -1);
		return true;
	}


	function tightestClusterIndex() {
		return extremaSearch.tightestClusterIndex();
	}


	function largestVoidIndex() {
		return extremaSearch.largestVoidIndex();
	}

	function clear() {
		energy.fill(0);
		occupied.fill(0);
		occupiedTotal = 0;
		extremaSearch.markAllStale();
	}

	function snapshotOccupied() {
		return occupied.slice();
	}

	function restoreOccupied(snapshot) {
		clear();
		if (!snapshot) return 0;
		for (let index = 0; index < pixelCount; index += 1) {
			if (snapshot[index] === 1) place(index);
		}
		return occupiedTotal;
	}

	return Object.freeze({
		tileSize,
		pixelCount,
		sigma,
		kernelRadius,
		place,
		remove,
		clear,
		snapshotOccupied,
		restoreOccupied,
		tightestClusterIndex,
		largestVoidIndex,
		isOccupied: (index) => occupied[index] === 1,
		energyAt: (index) => energy[index],
		occupiedCount: () => occupiedTotal,
	});
}
