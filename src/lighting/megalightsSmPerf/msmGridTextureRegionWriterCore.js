import {
	MSM_GRID_BYTES_PER_TEXEL,
	MSM_GRID_ENTRIES_PER_TEXEL,
	encodeHeaderTexel,
	encodeLightSlot,
	isUsableWorldGridLayout,
	resolveDefaultListTexelOffset,
	resolveHeaderTexelIndex,
	resolveListTexelIndex,
	resolveTexelByteOffset,
} from "../megalightsSm/msmWorldGridLayout.js"

export const MSM_GRID_REGION_WRITER_PHASE_ID = "MSM-PERF-O1"


export const MSM_GRID_REGION_WRITER_REFUSALS = Object.freeze({
	LAYOUT_MISSING: "grid-layout-missing-or-sanitized",
	CELL_READER_MISSING: "cell-reader-missing",
	TEXTURE_TOO_SMALL: "texture-data-too-small",
	CELL_ADDRESS_REFUSED: "cell-address-refused-by-layout",
})


export const MSM_GRID_REGION_WRITER_READER_FUNCTIONS = Object.freeze([
	"cellLightCount",
	"cellLightDemand",
	"readCellLights",
])

function hasEveryReaderFunction(candidateReader) {
	if (!candidateReader || typeof candidateReader !== "object") return false
	for (const functionName of MSM_GRID_REGION_WRITER_READER_FUNCTIONS) {
		if (typeof candidateReader[functionName] !== "function") return false
	}
	return true
}

function createEmptyRowRange() {
	return { firstRow: -1, lastRow: -1, rowCount: 0 }
}

function resetRowRange(rowRange) {
	rowRange.firstRow = -1
	rowRange.lastRow = -1
	rowRange.rowCount = 0
}

function growRowRange(rowRange, row) {
	if (rowRange.firstRow === -1) {
		rowRange.firstRow = row
		rowRange.lastRow = row
	} else {
		if (rowRange.firstRow > row) rowRange.firstRow = row
		if (row > rowRange.lastRow) rowRange.lastRow = row
	}
	rowRange.rowCount = rowRange.lastRow - rowRange.firstRow + 1
}

function freezeRowRange(rowRange) {
	return Object.freeze({
		firstRow: rowRange.firstRow,
		lastRow: rowRange.lastRow,
		rowCount: rowRange.rowCount,
	})
}


export function createGridTextureRegionWriter(options) {
	const settings = options && typeof options === "object" ? options : {}
	const layout = settings.layout
	const cellReader = settings.cellReader

	const layoutIsUsable = isUsableWorldGridLayout(layout)
	const readerIsUsable = hasEveryReaderFunction(cellReader)
	const supported = layoutIsUsable && readerIsUsable

	const listStride = layoutIsUsable ? layout.maxListsPerCell : 0
	const listTexelsPerCell = layoutIsUsable ? layout.listTexelsPerCell : 0
	const entriesPerCell = listTexelsPerCell * MSM_GRID_ENTRIES_PER_TEXEL
	const texelsPerCell = layoutIsUsable ? 1 + listTexelsPerCell : 0
	const fullGridTexelCost = layoutIsUsable ? layout.cellCount * texelsPerCell : 0
	const textureRowCount = layoutIsUsable ? layout.textureHeight : 0


	const cellLightIndices = new Int32Array(listStride > 0 ? listStride : 1)

	const headerRowRange = createEmptyRowRange()
	const listRowRange = createEmptyRowRange()

	const totals = {
		publishes: 0,
		refusedPublishes: 0,
		writtenCells: 0,
		writtenTexels: 0,
		skippedCells: 0,
	}

	let writtenCellCount = 0
	let writtenTexelCount = 0
	let skippedCellCount = 0

	function startPublish() {
		writtenCellCount = 0
		writtenTexelCount = 0
		skippedCellCount = 0
		resetRowRange(headerRowRange)
		resetRowRange(listRowRange)
	}


	function writeCellBytes(textureData, cellIndex) {
		const headerTexelIndex = resolveHeaderTexelIndex(layout, cellIndex)
		const listTexelOffset = resolveDefaultListTexelOffset(layout, cellIndex)
		if (headerTexelIndex === -1 || listTexelOffset === -1) return false

		const listTexelIndex = resolveListTexelIndex(layout, listTexelOffset)
		const headerByteBase = resolveTexelByteOffset(layout, headerTexelIndex)
		if (listTexelIndex === -1 || headerByteBase === -1) return false

		const listCount = Number(cellReader.cellLightCount(cellIndex)) || 0
		const lightDemand = Number(cellReader.cellLightDemand(cellIndex)) || 0
		cellReader.readCellLights(cellIndex, cellLightIndices)

		const headerBytes = encodeHeaderTexel({
			listTexelOffset,
			listCount,
			saturated: lightDemand > listCount,
		})
		for (let channel = 0; MSM_GRID_BYTES_PER_TEXEL > channel; channel += 1) {
			textureData[headerByteBase + channel] = headerBytes[channel]
		}
		growRowRange(headerRowRange, Math.floor(headerTexelIndex / layout.textureWidth))


		for (let listTexel = 0; listTexelsPerCell > listTexel; listTexel += 1) {
			const texelIndex = listTexelIndex + listTexel
			const listByteBase = resolveTexelByteOffset(layout, texelIndex)
			if (listByteBase === -1) return false
			const entryBase = listTexel * MSM_GRID_ENTRIES_PER_TEXEL
			for (let channel = 0; MSM_GRID_ENTRIES_PER_TEXEL > channel; channel += 1) {
				const entry = entryBase + channel
				const carriesLight = listCount > entry && listStride > entry
				textureData[listByteBase + channel] = carriesLight
					? encodeLightSlot(cellLightIndices[entry])
					: 0
			}
			growRowRange(listRowRange, Math.floor(texelIndex / layout.textureWidth))
		}

		writtenTexelCount += texelsPerCell
		writtenCellCount += 1
		return true
	}

	function refusedPublish(refusedReason) {
		totals.refusedPublishes += 1
		return Object.freeze({
			phase: MSM_GRID_REGION_WRITER_PHASE_ID,
			ok: false,
			refusedReason,
			writtenCellCount,
			skippedCellCount,
			writtenTexelCount,
			fullGridTexelCost,
			headerRows: freezeRowRange(headerRowRange),
			listRows: freezeRowRange(listRowRange),
			touchedRowCount: headerRowRange.rowCount + listRowRange.rowCount,
			textureRowCount,
		})
	}

	function finishPublish() {
		totals.publishes += 1
		totals.writtenCells += writtenCellCount
		totals.writtenTexels += writtenTexelCount
		totals.skippedCells += skippedCellCount
		return Object.freeze({
			phase: MSM_GRID_REGION_WRITER_PHASE_ID,
			ok: true,
			refusedReason: null,
			writtenCellCount,
			skippedCellCount,
			writtenTexelCount,
			fullGridTexelCost,
			headerRows: freezeRowRange(headerRowRange),
			listRows: freezeRowRange(listRowRange),
			touchedRowCount: headerRowRange.rowCount + listRowRange.rowCount,
			textureRowCount,
		})
	}

	function refuseBeforeWriting(textureData) {
		if (!layoutIsUsable) return MSM_GRID_REGION_WRITER_REFUSALS.LAYOUT_MISSING
		if (!readerIsUsable) return MSM_GRID_REGION_WRITER_REFUSALS.CELL_READER_MISSING
		if (!textureData || !(textureData.length >= layout.byteSize)) {
			return MSM_GRID_REGION_WRITER_REFUSALS.TEXTURE_TOO_SMALL
		}
		return null
	}


	function writeCells(textureData, cellIndices) {
		startPublish()
		const earlyRefusal = refuseBeforeWriting(textureData)
		if (earlyRefusal) return refusedPublish(earlyRefusal)

		const requestedCells = Array.isArray(cellIndices) ? cellIndices : []
		for (const candidate of requestedCells) {
			const cellIndex = Math.floor(Number(candidate))
			const isInsideGrid = Number.isFinite(cellIndex) && cellIndex >= 0 && layout.cellCount > cellIndex
			if (!isInsideGrid) {
				skippedCellCount += 1
				continue
			}
			if (!writeCellBytes(textureData, cellIndex)) {
				return refusedPublish(MSM_GRID_REGION_WRITER_REFUSALS.CELL_ADDRESS_REFUSED)
			}
		}
		return finishPublish()
	}


	function writeEveryCell(textureData) {
		startPublish()
		const earlyRefusal = refuseBeforeWriting(textureData)
		if (earlyRefusal) return refusedPublish(earlyRefusal)

		for (let cellIndex = 0; layout.cellCount > cellIndex; cellIndex += 1) {
			if (!writeCellBytes(textureData, cellIndex)) {
				return refusedPublish(MSM_GRID_REGION_WRITER_REFUSALS.CELL_ADDRESS_REFUSED)
			}
		}
		return finishPublish()
	}


	function describe() {
		const fullCostOfEveryPublish = totals.publishes * fullGridTexelCost
		return Object.freeze({
			phase: MSM_GRID_REGION_WRITER_PHASE_ID,
			supported,
			layoutUsable: layoutIsUsable,
			readerUsable: readerIsUsable,
			cellCount: layoutIsUsable ? layout.cellCount : 0,
			listStride,
			listTexelsPerCell,
			entriesPerCell,
			texelsPerCell,
			fullGridTexelCost,
			textureRowCount,
			savedTexels: Math.max(0, fullCostOfEveryPublish - totals.writtenTexels),
			totals: Object.freeze(Object.assign({}, totals)),
		})
	}

	return Object.freeze({
		phase: MSM_GRID_REGION_WRITER_PHASE_ID,
		supported,
		writeCells,
		writeEveryCell,
		describe,
	})
}
