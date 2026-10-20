import {
	MSM_GRID_BYTES_PER_TEXEL,
	MSM_GRID_ENTRIES_PER_TEXEL,
	MSM_GRID_MAX_LISTS_PER_CELL,
	decodeHeaderTexel,
	decodeLightSlot,
	decodeListTexel,
	resolveCellIndex,
	resolveHeaderTexelIndex,
	resolveListTexelIndex,
	resolveTexelByteOffset,
} from "./msmWorldGridLayout.js";

import { MSM_FAR_LIST_CAPACITY } from "./msmFarListCore.js";


export const MSM_GRID_LOOKUP_SOURCE = Object.freeze({
	GRID_CELL: "grid-cell",
	FAR_LIST: "far-list",
	NONE: "none",
});


export const MSM_GRID_LOOKUP_REASON = Object.freeze({
	CELL_LIST: "cellList",
	EMPTY_CELL: "emptyCell",
	FAR_LIST: "farList",
	FAR_LIST_EMPTY: "farListEmpty",
	FAR_LIST_OUTSIDE_ALLOCATION: "farListOutsideAllocation",
	CELL_LIST_OUTSIDE_REGION: "cellListOutsideRegion",
	UNUSABLE_TARGET: "unusableTarget",
});


export const MSM_GRID_LOOKUP_ENTRY_CEILING = MSM_GRID_MAX_LISTS_PER_CELL;


export const MSM_GRID_LOOKUP_LIST_TEXEL_CEILING = Math.ceil(
	MSM_GRID_MAX_LISTS_PER_CELL / MSM_GRID_ENTRIES_PER_TEXEL,
);


export const MSM_GRID_BOUNDS_COMPARISONS = 6;


export const MSM_GRID_LOOKUP_MIRROR = Object.freeze([
	Object.freeze({
		jsName: "msmGridCellCoordinatesAt",
		glslName: "msmGridCellCoordinatesAt",
		argumentOrder: Object.freeze(["worldPosition", "gridOriginWorld", "inverseCellSize"]),
		uniformArguments: Object.freeze(["gridOriginWorld", "inverseCellSize"]),
	}),
	Object.freeze({
		jsName: "msmGridCellIsInside",
		glslName: "msmGridCellIsInside",
		argumentOrder: Object.freeze(["cellCoordinates", "cellCounts"]),
		uniformArguments: Object.freeze(["cellCounts"]),
	}),
	Object.freeze({
		jsName: "msmGridCellIndexFrom",
		glslName: "msmGridCellIndexFrom",
		argumentOrder: Object.freeze(["cellCoordinates", "cellCounts"]),
		uniformArguments: Object.freeze(["cellCounts"]),
	}),
	Object.freeze({
		jsName: "msmGridLookupAt",
		glslName: "msmGridLookupBegin",
		argumentOrder: Object.freeze(["worldPosition", "target"]),
		uniformArguments: Object.freeze(["target"]),
	}),
]);

function toFloat32(value) {
	return Math.fround(Number(value));
}

function toVector3(value) {
	if (Array.isArray(value)) {
		return { x: Number(value[0]), y: Number(value[1]), z: Number(value[2]) };
	}
	const source = value && typeof value === "object" ? value : {};
	return { x: Number(source.x), y: Number(source.y), z: Number(source.z) };
}

function toNonNegativeInteger(value) {
	const parsed = Math.floor(Number(value));
	return parsed >= 0 ? parsed : 0;
}


function cellCoordinateOf(worldComponent, originComponent, inverseCellSize) {
	const offset = toFloat32(toFloat32(worldComponent) - toFloat32(originComponent));
	return Math.floor(toFloat32(offset * inverseCellSize));
}


export function msmGridCellCoordinatesAt(worldPosition, gridOriginWorld, inverseCellSize) {
	const position = toVector3(worldPosition);
	const origin = toVector3(gridOriginWorld);
	const scale = toFloat32(inverseCellSize);
	return {
		cellX: cellCoordinateOf(position.x, origin.x, scale),
		cellY: cellCoordinateOf(position.y, origin.y, scale),
		cellZ: cellCoordinateOf(position.z, origin.z, scale),
	};
}


export function msmGridCellIsInside(cellCoordinates, cellCounts) {
	if (!cellCoordinates || !cellCounts) return false;
	if (!(cellCoordinates.cellX >= 0) || !(cellCounts.cellsX > cellCoordinates.cellX)) return false;
	if (!(cellCoordinates.cellY >= 0) || !(cellCounts.cellsY > cellCoordinates.cellY)) return false;
	return cellCoordinates.cellZ >= 0 && cellCounts.cellsZ > cellCoordinates.cellZ;
}


export function msmGridCellIndexFrom(cellCoordinates, cellCounts) {
	if (!cellCoordinates) return -1;
	return resolveCellIndex(cellCounts, cellCoordinates.cellX, cellCoordinates.cellY, cellCoordinates.cellZ);
}


export function msmGridStorageCellIndexFrom(cellCoordinates, cellCounts, ringOffset = [0, 0, 0]) {
	if (!msmGridCellIsInside(cellCoordinates, cellCounts)) return -1;
	const offset = toVector3(ringOffset);
	const wrap = (coordinate, shift, count) => {
		const shifted = toFloat32(toFloat32(coordinate) + toFloat32(shift));
		return shifted - count * Math.floor(shifted / count);
	};
	return msmGridCellIndexFrom({
		cellX: wrap(cellCoordinates.cellX, offset.x, cellCounts.cellsX),
		cellY: wrap(cellCoordinates.cellY, offset.y, cellCounts.cellsY),
		cellZ: wrap(cellCoordinates.cellZ, offset.z, cellCounts.cellsZ),
	}, cellCounts);
}

















function toFarListSlots(source) {
	const slots = new Array(MSM_FAR_LIST_CAPACITY);
	for (let slotIndex = 0; MSM_FAR_LIST_CAPACITY > slotIndex; slotIndex += 1) {
		const hasSlot = source && source.length > slotIndex;
		slots[slotIndex] = hasSlot ? toNonNegativeInteger(source[slotIndex]) : 0;
	}
	return Object.freeze(slots);
}


function countFilledFarListSlots(slots) {
	let filledCount = 0;
	for (let slotIndex = 0; slots.length > slotIndex; slotIndex += 1) {
		if (slots[slotIndex] >= 1) filledCount += 1;
	}
	return filledCount;
}

export function createGridLookupTarget(description) {
	const source = description && typeof description === "object" ? description : {};
	const problems = [];
	const layout = source.layout && typeof source.layout === "object" ? source.layout : null;
	if (!layout) problems.push("layout ausente: sem ele nao existe ordem de celula");
	if (layout && !(layout.cellCount >= 1)) problems.push("layout sem celulas");

	const textureData = source.textureData || null;
	if (!textureData || !(textureData.length >= MSM_GRID_BYTES_PER_TEXEL)) {
		problems.push("textureData ausente ou menor que um texel");
	}

	const ringOffset = toVector3(source.ringOffset == null ? [0, 0, 0] : source.ringOffset);
	if (![ringOffset.x, ringOffset.y, ringOffset.z].every(Number.isInteger)) {
		problems.push("ringOffset must contain finite integer cell coordinates");
	}
	const cellSizeWorld = toFloat32(source.cellSizeWorld);
	if (!(cellSizeWorld > 0)) problems.push("cellSizeWorld invalido (" + String(source.cellSizeWorld) + ")");

	const declaredAllocation = toNonNegativeInteger(
		source.allocatedTexelCount === undefined || source.allocatedTexelCount === null
			? layout && layout.allocatedTexelCount
			: source.allocatedTexelCount,
	);
	const allocatedTexelCount = declaredAllocation;
	if (layout && !(allocatedTexelCount >= layout.texelCount)) {
		problems.push("allocatedTexelCount menor que o layout do tier em uso");
	}


	const farListLightSlots = toFarListSlots(source.farListLightSlots);
	const declaredFarListCount =
		source.farListLightCount === undefined || source.farListLightCount === null
			? countFilledFarListSlots(farListLightSlots)
			: toNonNegativeInteger(source.farListLightCount);
	if (declaredFarListCount > MSM_FAR_LIST_CAPACITY) {
		problems.push(
			"farListLightCount " + declaredFarListCount + " acima da capacidade da MSM-F10 " + MSM_FAR_LIST_CAPACITY,
		);
	}
	const farListLightCount = Math.min(declaredFarListCount, MSM_FAR_LIST_CAPACITY);

	return Object.freeze({
		layout,
		textureData,
		gridOriginWorld: Object.freeze(toVector3(source.gridOriginWorld)),
		ringOffset: Object.freeze(ringOffset),
		cellSizeWorld,
		inverseCellSize: cellSizeWorld > 0 ? toFloat32(1 / cellSizeWorld) : 0,
		allocatedTexelCount,
		farListLightSlots,
		farListLightCount,
		problems: Object.freeze(problems.slice()),
		usable: problems.length === 0,
	});
}


function resolveAllocationByteOffset(target, texelIndex) {
	const index = Math.floor(Number(texelIndex));
	if (!(index >= 0) || !(target.allocatedTexelCount > index)) return -1;
	return index * MSM_GRID_BYTES_PER_TEXEL;
}

function createLookupCost() {
	return { textureFetches: 0, boundsComparisons: 0, listComparisons: 0 };
}

function frozenResult(fields) {
	const cost = fields.cost || createLookupCost();
	return Object.freeze({
		source: fields.source,
		reason: fields.reason,
		insideGrid: fields.insideGrid === true,
		usesFarList: fields.usesFarList === true,
		cellCoordinates: fields.cellCoordinates ? Object.freeze(fields.cellCoordinates) : null,
		cellIndex: fields.cellIndex === undefined ? -1 : fields.cellIndex,
		listTexelOffset: fields.listTexelOffset === undefined ? -1 : fields.listTexelOffset,
		listCount: fields.listCount === undefined ? 0 : fields.listCount,
		lightIndices: Object.freeze(fields.lightIndices ? fields.lightIndices.slice() : []),
		emptyEntryCount: fields.emptyEntryCount === undefined ? 0 : fields.emptyEntryCount,
		saturated: fields.saturated === true,
		cost: Object.freeze({ ...cost }),
	});
}


function readLightIndices(target, listTexelIndex, lightCount, cost) {
	const lightIndices = [];
	let emptyEntryCount = 0;
	const texelsToRead = Math.ceil(lightCount / MSM_GRID_ENTRIES_PER_TEXEL);
	for (let texel = 0; texelsToRead > texel; texel += 1) {
		const byteOffset = resolveAllocationByteOffset(target, listTexelIndex + texel);
		if (byteOffset === -1) break;
		cost.textureFetches += 1;
		const entries = decodeListTexel(target.textureData, byteOffset);
		for (const lightIndex of entries) {
			if (lightIndices.length === lightCount) break;
			cost.listComparisons += 1;
			lightIndices.push(lightIndex);
			if (lightIndex === -1) emptyEntryCount += 1;
		}
	}
	return { lightIndices, emptyEntryCount };
}


function readFarList(target, cellCoordinates, cost) {
	cost.listComparisons += 1;
	if (!(target.farListLightCount >= 1)) {
		return frozenResult({
			source: MSM_GRID_LOOKUP_SOURCE.FAR_LIST,
			reason: MSM_GRID_LOOKUP_REASON.FAR_LIST_EMPTY,
			usesFarList: true,
			cellCoordinates,
			cost,
		});
	}

	const lightIndices = [];
	let emptyEntryCount = 0;
	for (let entry = 0; target.farListLightCount > entry; entry += 1) {

		const lightIndex = decodeLightSlot(target.farListLightSlots[entry]);
		lightIndices.push(lightIndex);
		if (lightIndex === -1) emptyEntryCount += 1;
	}

	return frozenResult({
		source: MSM_GRID_LOOKUP_SOURCE.FAR_LIST,
		reason: MSM_GRID_LOOKUP_REASON.FAR_LIST,
		usesFarList: true,
		cellCoordinates,
		listCount: target.farListLightCount,
		lightIndices,
		emptyEntryCount,
		cost,
	});
}


export function msmGridLookupAt(worldPosition, target) {
	const cost = createLookupCost();
	if (!target || !target.usable) {
		return frozenResult({
			source: MSM_GRID_LOOKUP_SOURCE.NONE,
			reason: MSM_GRID_LOOKUP_REASON.UNUSABLE_TARGET,
			cost,
		});
	}

	const layout = target.layout;
	const cellCoordinates = msmGridCellCoordinatesAt(worldPosition, target.gridOriginWorld, target.inverseCellSize);
	cost.boundsComparisons = MSM_GRID_BOUNDS_COMPARISONS;
	if (!msmGridCellIsInside(cellCoordinates, layout)) {
		return readFarList(target, cellCoordinates, cost);
	}

	const cellIndex = msmGridStorageCellIndexFrom(cellCoordinates, layout, target.ringOffset);
	const headerByteOffset = resolveTexelByteOffset(layout, resolveHeaderTexelIndex(layout, cellIndex));
	const header = decodeHeaderTexel(target.textureData, headerByteOffset);
	cost.textureFetches += 1;
	cost.listComparisons += 1;
	if (!(header.listCount >= 1)) {
		return frozenResult({
			source: MSM_GRID_LOOKUP_SOURCE.GRID_CELL,
			reason: MSM_GRID_LOOKUP_REASON.EMPTY_CELL,
			insideGrid: true,
			cellCoordinates,
			cellIndex,
			listTexelOffset: header.listTexelOffset,
			saturated: header.saturated,
			cost,
		});
	}

	const listTexelIndex = resolveListTexelIndex(layout, header.listTexelOffset);
	if (listTexelIndex === -1) {
		return frozenResult({
			source: MSM_GRID_LOOKUP_SOURCE.NONE,
			reason: MSM_GRID_LOOKUP_REASON.CELL_LIST_OUTSIDE_REGION,
			insideGrid: true,
			cellCoordinates,
			cellIndex,
			listTexelOffset: header.listTexelOffset,
			saturated: header.saturated,
			cost,
		});
	}

	const listWalk = readLightIndices(target, listTexelIndex, header.listCount, cost);
	return frozenResult({
		source: MSM_GRID_LOOKUP_SOURCE.GRID_CELL,
		reason: MSM_GRID_LOOKUP_REASON.CELL_LIST,
		insideGrid: true,
		cellCoordinates,
		cellIndex,
		listTexelOffset: header.listTexelOffset,
		listCount: header.listCount,
		lightIndices: listWalk.lightIndices,
		emptyEntryCount: listWalk.emptyEntryCount,
		saturated: header.saturated,
		cost,
	});
}
