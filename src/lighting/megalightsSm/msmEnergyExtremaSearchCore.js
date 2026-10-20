export function extremaBlockSideFor(tileSize, requestedBlockSide) {
	const tileSide = Math.floor(Number(tileSize));
	if (!(tileSide >= 1)) return 1;
	const requested = Math.floor(Number(requestedBlockSide));
	if (Number.isFinite(requested) && requested >= 1) return Math.min(requested, tileSide);
	return Math.max(1, Math.min(tileSide, Math.round(Math.sqrt(tileSide))));
}


export function createEnergyExtremaSearch(options) {
	const source = options && typeof options === "object" ? options : {};
	const tileSize = Math.floor(Number(source.tileSize));
	if (!(tileSize >= 1)) throw new Error("createEnergyExtremaSearch: tileSize has to be at least 1");
	const pixelCount = tileSize * tileSize;
	const energy = source.energy;
	const occupied = source.occupied;
	if (!energy || energy.length !== pixelCount) {
		throw new Error("createEnergyExtremaSearch: energy has to hold tileSize * tileSize entries");
	}
	if (!occupied || occupied.length !== pixelCount) {
		throw new Error("createEnergyExtremaSearch: occupied has to hold tileSize * tileSize entries");
	}

	const blockSide = extremaBlockSideFor(tileSize, source.blockSide);
	const blocksPerAxis = Math.ceil(tileSize / blockSide);
	const blockCount = blocksPerAxis * blocksPerAxis;


	const blockMaxEnergy = new Float64Array(blockCount);
	const blockMaxIndex = new Int32Array(blockCount);
	const blockMinEnergy = new Float64Array(blockCount);
	const blockMinIndex = new Int32Array(blockCount);
	const blockIsStale = new Uint8Array(blockCount);
	blockIsStale.fill(1);


	const staleBlockRows = new Int32Array(blocksPerAxis + 1);
	const staleBlockColumns = new Int32Array(blocksPerAxis + 1);


	function collectAxisBlocks(target, first, length) {
		if (length >= tileSize) {
			for (let block = 0; block < blocksPerAxis; block += 1) target[block] = block;
			return blocksPerAxis;
		}
		let count = 0;
		let cursor = first;
		let remaining = length;
		while (remaining > 0) {
			const block = Math.floor(cursor / blockSide);
			target[count] = block;
			count += 1;


			const nextBlockFirst = Math.min((block + 1) * blockSide, tileSize);
			const step = Math.min(nextBlockFirst - cursor, remaining);
			cursor += step;
			if (cursor >= tileSize) cursor -= tileSize;
			remaining -= step;
		}
		return count;
	}


	function refreshBlock(blockIndex) {
		const blockRow = Math.floor(blockIndex / blocksPerAxis);
		const blockColumn = blockIndex - blockRow * blocksPerAxis;
		const firstY = blockRow * blockSide;
		const lastY = Math.min(firstY + blockSide, tileSize);
		const firstX = blockColumn * blockSide;
		const lastX = Math.min(firstX + blockSide, tileSize);
		let maxIndex = -1;
		let maxEnergy = -Infinity;
		let minIndex = -1;
		let minEnergy = Infinity;


		for (let y = firstY; y < lastY; y += 1) {
			const rowOffset = y * tileSize;
			for (let x = firstX; x < lastX; x += 1) {
				const index = rowOffset + x;
				const value = energy[index];
				if (occupied[index] === 1) {
					if (value > maxEnergy) {
						maxEnergy = value;
						maxIndex = index;
					}
				} else if (value < minEnergy) {
					minEnergy = value;
					minIndex = index;
				}
			}
		}
		blockMaxEnergy[blockIndex] = maxEnergy;
		blockMaxIndex[blockIndex] = maxIndex;
		blockMinEnergy[blockIndex] = minEnergy;
		blockMinIndex[blockIndex] = minIndex;
		blockIsStale[blockIndex] = 0;
	}


	function markAllStale() {
		blockIsStale.fill(1);
	}


	function markStaleAround(centerIndex, radius) {
		if (!(centerIndex >= 0 && centerIndex < pixelCount)) return;
		const windowSide = Math.max(0, Math.floor(Number(radius))) * 2 + 1;
		if (windowSide >= tileSize) {
			markAllStale();
			return;
		}
		const halfWindow = (windowSide - 1) / 2;
		const centerY = Math.floor(centerIndex / tileSize);
		const centerX = centerIndex - centerY * tileSize;
		let firstY = centerY - halfWindow;
		if (firstY < 0) firstY += tileSize;
		let firstX = centerX - halfWindow;
		if (firstX < 0) firstX += tileSize;
		const rowCount = collectAxisBlocks(staleBlockRows, firstY, windowSide);
		const columnCount = collectAxisBlocks(staleBlockColumns, firstX, windowSide);
		for (let row = 0; row < rowCount; row += 1) {
			const blockRowOffset = staleBlockRows[row] * blocksPerAxis;
			for (let column = 0; column < columnCount; column += 1) {
				blockIsStale[blockRowOffset + staleBlockColumns[column]] = 1;
			}
		}
	}


	function tightestClusterIndex() {
		let bestIndex = -1;
		let bestEnergy = -Infinity;
		for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
			if (blockIsStale[blockIndex] === 1) refreshBlock(blockIndex);
			const candidateIndex = blockMaxIndex[blockIndex];
			if (candidateIndex < 0) continue;
			const candidateEnergy = blockMaxEnergy[blockIndex];
			if (
				bestIndex < 0 ||
				candidateEnergy > bestEnergy ||
				(candidateEnergy === bestEnergy && candidateIndex < bestIndex)
			) {
				bestEnergy = candidateEnergy;
				bestIndex = candidateIndex;
			}
		}
		return bestIndex;
	}


	function largestVoidIndex() {
		let bestIndex = -1;
		let bestEnergy = Infinity;
		for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
			if (blockIsStale[blockIndex] === 1) refreshBlock(blockIndex);
			const candidateIndex = blockMinIndex[blockIndex];
			if (candidateIndex < 0) continue;
			const candidateEnergy = blockMinEnergy[blockIndex];
			if (
				bestIndex < 0 ||
				candidateEnergy < bestEnergy ||
				(candidateEnergy === bestEnergy && candidateIndex < bestIndex)
			) {
				bestEnergy = candidateEnergy;
				bestIndex = candidateIndex;
			}
		}
		return bestIndex;
	}


	function staleBlockCount() {
		let total = 0;
		for (let blockIndex = 0; blockIndex < blockCount; blockIndex += 1) {
			if (blockIsStale[blockIndex] === 1) total += 1;
		}
		return total;
	}

	return Object.freeze({
		tileSize,
		pixelCount,
		blockSide,
		blocksPerAxis,
		blockCount,
		markStaleAround,
		markAllStale,
		tightestClusterIndex,
		largestVoidIndex,
		staleBlockCount,
	});
}
