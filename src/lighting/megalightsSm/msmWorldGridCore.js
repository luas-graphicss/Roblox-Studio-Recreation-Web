import {
	MSM_GRID_BYTES_PER_TEXEL,
	MSM_GRID_ENTRIES_PER_TEXEL,
	MSM_GRID_MAX_LIGHT_COUNT,
	createWorldGridLayout,
	decodeLightSlot,
	describeWorldGridLayout,
	encodeHeaderTexel,
	encodeLightSlot,
	isUsableWorldGridLayout,
	resolveCellIndex,
	resolveDefaultListTexelOffset,
	resolveHeaderTexelIndex,
	resolveListTexelIndex,
	resolveTexelByteOffset,
} from "./msmWorldGridLayout.js"
import { MSM_GRID_LAYOUT_CEILING } from "./msmPipelineContract.js"

export const MSM_WORLD_GRID_PHASE_ID = "MSM-F8"


export const MSM_WORLD_GRID_REBUILD_MODE = Object.freeze({
	NONE: "none",
	NEW_CELLS: "new-cells",
	ALL_CELLS: "all-cells",
})


export const MSM_WORLD_GRID_REFUSALS = Object.freeze({
	NOT_CONFIGURED: "grid-not-configured",
	CAMERA_POSITION_MISSING: "camera-position-missing",
	ANCHOR_MISSING: "anchor-missing",
	TEXTURE_TOO_SMALL: "texture-data-too-small",
})


export const MSM_WORLD_GRID_READER_ARGUMENT_ORDER = "readLightSphere(lightRecord, targetSphere)"


export const MSM_WORLD_GRID_LIGHT_FIELDS = Object.freeze(["positionX", "positionY", "positionZ", "range"])


export const MSM_WORLD_GRID_SATURATION_REPORT_LIMIT = 32


function readFiniteNumber(value) {
	if (typeof value === "number") return Number.isFinite(value) ? value : null
	if (typeof value !== "string" || value.trim() === "") return null
	const parsed = Number(value)
	return Number.isFinite(parsed) ? parsed : null
}

function firstFiniteNumber(candidateA, candidateB, candidateC) {
	const valueA = readFiniteNumber(candidateA)
	if (valueA !== null) return valueA
	const valueB = readFiniteNumber(candidateB)
	if (valueB !== null) return valueB
	return readFiniteNumber(candidateC)
}


export function readLightSphere(lightRecord, targetSphere) {
	if (!lightRecord || typeof lightRecord !== "object") return false
	const position = lightRecord.position && typeof lightRecord.position === "object" ? lightRecord.position : null
	const positionX = firstFiniteNumber(lightRecord.positionX, position ? position.x : null)
	const positionY = firstFiniteNumber(lightRecord.positionY, position ? position.y : null)
	const positionZ = firstFiniteNumber(lightRecord.positionZ, position ? position.z : null)
	const range = firstFiniteNumber(lightRecord.range, lightRecord.radius, lightRecord.influenceRadius)
	if (positionX === null || positionY === null || positionZ === null) return false
	if (range === null || !(range >= 0)) return false
	targetSphere.positionX = positionX
	targetSphere.positionY = positionY
	targetSphere.positionZ = positionZ
	targetSphere.range = range
	return true
}


export function resolveWorldGridConfiguration(tierPolicy) {
	const policy = tierPolicy && typeof tierPolicy === "object" ? tierPolicy : {}
	const worldGrid = policy.worldGrid && typeof policy.worldGrid === "object" ? policy.worldGrid : {}
	return Object.freeze({
		layout: createWorldGridLayout({
			cellsX: worldGrid.cellsX,
			cellsY: worldGrid.cellsY,
			cellsZ: worldGrid.cellsZ,
			maxListsPerCell: worldGrid.listsPerCell,
		}),
		cellSizeStuds: readFiniteNumber(worldGrid.cellStuds),
	})
}

function readWorldPosition(candidate) {
	if (!candidate || typeof candidate !== "object") return null
	const positionX = readFiniteNumber(candidate.x)
	const positionY = readFiniteNumber(candidate.y)
	const positionZ = readFiniteNumber(candidate.z)
	if (positionX === null || positionY === null || positionZ === null) return null
	return { positionX, positionY, positionZ }
}


export function createWorldGrid(options) {
	const settings = options && typeof options === "object" ? options : {}

	const ceilingCellCount = MSM_GRID_LAYOUT_CEILING.cellCount
	const ceilingListStride = MSM_GRID_LAYOUT_CEILING.maxListsPerCell
	const ceilingCellsPerAxis = Math.max(
		MSM_GRID_LAYOUT_CEILING.cellsX,
		MSM_GRID_LAYOUT_CEILING.cellsY,
		MSM_GRID_LAYOUT_CEILING.cellsZ,
	)


	const cellLightDemands = new Uint16Array(ceilingCellCount)
	const cellListCounts = new Uint8Array(ceilingCellCount)
	const cellLightSlots = new Uint8Array(ceilingCellCount * ceilingListStride)
	const pendingCellFlags = new Uint8Array(ceilingCellCount)
	const pendingCellIndices = new Int32Array(ceilingCellCount)


	const lightMinOffsetX = new Int32Array(MSM_GRID_MAX_LIGHT_COUNT)
	const lightMinOffsetY = new Int32Array(MSM_GRID_MAX_LIGHT_COUNT)
	const lightMinOffsetZ = new Int32Array(MSM_GRID_MAX_LIGHT_COUNT)
	const lightMaxOffsetX = new Int32Array(MSM_GRID_MAX_LIGHT_COUNT)
	const lightMaxOffsetY = new Int32Array(MSM_GRID_MAX_LIGHT_COUNT)
	const lightMaxOffsetZ = new Int32Array(MSM_GRID_MAX_LIGHT_COUNT)
	const lightEncodedSlots = new Uint8Array(MSM_GRID_MAX_LIGHT_COUNT)


	const ringCoordinatesX = new Int32Array(ceilingCellsPerAxis)
	const ringCoordinatesY = new Int32Array(ceilingCellsPerAxis)
	const ringCoordinatesZ = new Int32Array(ceilingCellsPerAxis)

	const scratchSphere = { positionX: 0, positionY: 0, positionZ: 0, range: 0 }

	const allocatedBufferBytes =
		cellLightDemands.byteLength +
		cellListCounts.byteLength +
		cellLightSlots.byteLength +
		pendingCellFlags.byteLength +
		pendingCellIndices.byteLength +
		lightMinOffsetX.byteLength * 6 +
		lightEncodedSlots.byteLength +
		ringCoordinatesX.byteLength * 3

	const readSphere = typeof settings.readLightSphere === "function" ? settings.readLightSphere : readLightSphere

	const totals = {
		anchorDecisions: 0,
		anchorShifts: 0,
		rebuilds: 0,
		skippedRebuilds: 0,
		fullRebuilds: 0,
		partialRebuilds: 0,
		rebuiltCells: 0,
		storedEntries: 0,
		droppedEntries: 0,
		saturatedCells: 0,
		lightsOutsideWindow: 0,
		rejectedLights: 0,
		textureWrites: 0,
	}

	let activeLayout = null
	let activeListStride = 0
	let cellSizeStuds = 0
	let configurationProblems = Object.freeze([])
	let anchorCellX = 0
	let anchorCellY = 0
	let anchorCellZ = 0
	let hasAnchor = false
	let pendingCellCount = 0
	let preparedLightCount = 0
	let lastRebuild = null

	function isConfigured() {
		return activeLayout !== null && cellSizeStuds > 0
	}

	function ringCoordinateOf(worldCell, cellCount) {
		const wrapped = worldCell % cellCount
		return wrapped >= 0 ? wrapped : wrapped + cellCount
	}

	function refreshRingCoordinates() {
		for (let offset = 0; activeLayout.cellsX > offset; offset += 1) {
			ringCoordinatesX[offset] = ringCoordinateOf(anchorCellX + offset, activeLayout.cellsX)
		}
		for (let offset = 0; activeLayout.cellsY > offset; offset += 1) {
			ringCoordinatesY[offset] = ringCoordinateOf(anchorCellY + offset, activeLayout.cellsY)
		}
		for (let offset = 0; activeLayout.cellsZ > offset; offset += 1) {
			ringCoordinatesZ[offset] = ringCoordinateOf(anchorCellZ + offset, activeLayout.cellsZ)
		}
	}

	function clearCell(cellIndex) {
		cellLightDemands[cellIndex] = 0
		cellListCounts[cellIndex] = 0
	}


	function markCellPending(cellIndex) {
		if (pendingCellFlags[cellIndex] === 1) return false
		pendingCellFlags[cellIndex] = 1
		pendingCellIndices[pendingCellCount] = cellIndex
		pendingCellCount += 1
		clearCell(cellIndex)
		return true
	}

	function markEveryCellPending() {
		const cellCount = activeLayout.cellCount
		cellLightDemands.fill(0, 0, cellCount)
		cellListCounts.fill(0, 0, cellCount)
		pendingCellFlags.fill(1, 0, cellCount)
		for (let cellIndex = 0; cellCount > cellIndex; cellIndex += 1) pendingCellIndices[cellIndex] = cellIndex
		pendingCellCount = cellCount
		return pendingCellCount
	}

	function markWindowBoxPending(minOffsetX, maxOffsetX, minOffsetY, maxOffsetY, minOffsetZ, maxOffsetZ) {
		const strideY = activeLayout.cellsX
		const strideZ = activeLayout.cellsX * activeLayout.cellsY
		for (let offsetZ = minOffsetZ; maxOffsetZ >= offsetZ; offsetZ += 1) {
			const planeBase = ringCoordinatesZ[offsetZ] * strideZ
			for (let offsetY = minOffsetY; maxOffsetY >= offsetY; offsetY += 1) {
				const rowBase = planeBase + ringCoordinatesY[offsetY] * strideY
				for (let offsetX = minOffsetX; maxOffsetX >= offsetX; offsetX += 1) {
					markCellPending(rowBase + ringCoordinatesX[offsetX])
				}
			}
		}
	}


	function markEnteredCellsPending(shiftX, shiftY, shiftZ) {
		const lastOffsetX = activeLayout.cellsX - 1
		const lastOffsetY = activeLayout.cellsY - 1
		const lastOffsetZ = activeLayout.cellsZ - 1

		const enteredMinX = shiftX > 0 ? activeLayout.cellsX - shiftX : 0
		const enteredMaxX = shiftX > 0 ? lastOffsetX : -shiftX - 1
		const sharedMinX = shiftX > 0 ? 0 : -shiftX
		const sharedMaxX = shiftX > 0 ? activeLayout.cellsX - shiftX - 1 : lastOffsetX

		const enteredMinY = shiftY > 0 ? activeLayout.cellsY - shiftY : 0
		const enteredMaxY = shiftY > 0 ? lastOffsetY : -shiftY - 1
		const sharedMinY = shiftY > 0 ? 0 : -shiftY
		const sharedMaxY = shiftY > 0 ? activeLayout.cellsY - shiftY - 1 : lastOffsetY

		const enteredMinZ = shiftZ > 0 ? activeLayout.cellsZ - shiftZ : 0
		const enteredMaxZ = shiftZ > 0 ? lastOffsetZ : -shiftZ - 1

		if (shiftX !== 0) {
			markWindowBoxPending(enteredMinX, enteredMaxX, 0, lastOffsetY, 0, lastOffsetZ)
		}
		if (shiftY !== 0) {
			markWindowBoxPending(sharedMinX, sharedMaxX, enteredMinY, enteredMaxY, 0, lastOffsetZ)
		}
		if (shiftZ !== 0) {
			markWindowBoxPending(sharedMinX, sharedMaxX, sharedMinY, sharedMaxY, enteredMinZ, enteredMaxZ)
		}
	}

	function anchorCellForAxis(cameraCoordinate, cellCount) {
		return Math.floor(cameraCoordinate / cellSizeStuds) - Math.floor(cellCount / 2)
	}

	function anchorResult(anchorChanged, rebuildMode, shiftX, shiftY, shiftZ) {
		return Object.freeze({
			phase: MSM_WORLD_GRID_PHASE_ID,
			ok: true,
			anchorChanged,
			rebuildMode,
			shift: Object.freeze({ x: shiftX, y: shiftY, z: shiftZ }),
			anchorCell: Object.freeze({ x: anchorCellX, y: anchorCellY, z: anchorCellZ }),
			pendingCellCount,
		})
	}

	function refusedAnchorResult(reason) {
		return Object.freeze({
			phase: MSM_WORLD_GRID_PHASE_ID,
			ok: false,
			refusedReason: reason,
			anchorChanged: false,
			rebuildMode: MSM_WORLD_GRID_REBUILD_MODE.NONE,
			shift: Object.freeze({ x: 0, y: 0, z: 0 }),
			anchorCell: hasAnchor ? Object.freeze({ x: anchorCellX, y: anchorCellY, z: anchorCellZ }) : null,
			pendingCellCount,
		})
	}


	function anchorToCamera(cameraPosition) {
		if (!isConfigured()) return refusedAnchorResult(MSM_WORLD_GRID_REFUSALS.NOT_CONFIGURED)
		const position = readWorldPosition(cameraPosition)
		if (!position) return refusedAnchorResult(MSM_WORLD_GRID_REFUSALS.CAMERA_POSITION_MISSING)

		totals.anchorDecisions += 1
		const nextAnchorCellX = anchorCellForAxis(position.positionX, activeLayout.cellsX)
		const nextAnchorCellY = anchorCellForAxis(position.positionY, activeLayout.cellsY)
		const nextAnchorCellZ = anchorCellForAxis(position.positionZ, activeLayout.cellsZ)

		if (!hasAnchor) {
			anchorCellX = nextAnchorCellX
			anchorCellY = nextAnchorCellY
			anchorCellZ = nextAnchorCellZ
			hasAnchor = true
			totals.anchorShifts += 1
			refreshRingCoordinates()
			markEveryCellPending()
			return anchorResult(true, MSM_WORLD_GRID_REBUILD_MODE.ALL_CELLS, 0, 0, 0)
		}

		const shiftX = nextAnchorCellX - anchorCellX
		const shiftY = nextAnchorCellY - anchorCellY
		const shiftZ = nextAnchorCellZ - anchorCellZ
		if (shiftX === 0 && shiftY === 0 && shiftZ === 0) {
			return anchorResult(false, MSM_WORLD_GRID_REBUILD_MODE.NONE, 0, 0, 0)
		}

		anchorCellX = nextAnchorCellX
		anchorCellY = nextAnchorCellY
		anchorCellZ = nextAnchorCellZ
		totals.anchorShifts += 1
		refreshRingCoordinates()

		const windowJumpedAway =
			Math.abs(shiftX) >= activeLayout.cellsX ||
			Math.abs(shiftY) >= activeLayout.cellsY ||
			Math.abs(shiftZ) >= activeLayout.cellsZ
		if (windowJumpedAway) {
			markEveryCellPending()
			return anchorResult(true, MSM_WORLD_GRID_REBUILD_MODE.ALL_CELLS, shiftX, shiftY, shiftZ)
		}

		markEnteredCellsPending(shiftX, shiftY, shiftZ)
		return anchorResult(true, MSM_WORLD_GRID_REBUILD_MODE.NEW_CELLS, shiftX, shiftY, shiftZ)
	}


	function prepareLights(lightRecords) {
		const records = Array.isArray(lightRecords) ? lightRecords : []
		const readableCount = MSM_GRID_MAX_LIGHT_COUNT > records.length ? records.length : MSM_GRID_MAX_LIGHT_COUNT
		let rejectedLights = records.length - readableCount
		let lightsOutsideWindow = 0
		const cellsX = activeLayout.cellsX
		const cellsY = activeLayout.cellsY
		const cellsZ = activeLayout.cellsZ
		preparedLightCount = 0

		for (let recordIndex = 0; readableCount > recordIndex; recordIndex += 1) {
			if (!readSphere(records[recordIndex], scratchSphere)) {
				rejectedLights += 1
				continue
			}
			const lightRange = scratchSphere.range
			const unclampedMinOffsetX = Math.floor((scratchSphere.positionX - lightRange) / cellSizeStuds) - anchorCellX
			const unclampedMaxOffsetX = Math.floor((scratchSphere.positionX + lightRange) / cellSizeStuds) - anchorCellX
			const unclampedMinOffsetY = Math.floor((scratchSphere.positionY - lightRange) / cellSizeStuds) - anchorCellY
			const unclampedMaxOffsetY = Math.floor((scratchSphere.positionY + lightRange) / cellSizeStuds) - anchorCellY
			const unclampedMinOffsetZ = Math.floor((scratchSphere.positionZ - lightRange) / cellSizeStuds) - anchorCellZ
			const unclampedMaxOffsetZ = Math.floor((scratchSphere.positionZ + lightRange) / cellSizeStuds) - anchorCellZ
			const minOffsetX = unclampedMinOffsetX >= 0 ? unclampedMinOffsetX : 0
			const maxOffsetX = cellsX > unclampedMaxOffsetX ? unclampedMaxOffsetX : cellsX - 1
			const minOffsetY = unclampedMinOffsetY >= 0 ? unclampedMinOffsetY : 0
			const maxOffsetY = cellsY > unclampedMaxOffsetY ? unclampedMaxOffsetY : cellsY - 1
			const minOffsetZ = unclampedMinOffsetZ >= 0 ? unclampedMinOffsetZ : 0
			const maxOffsetZ = cellsZ > unclampedMaxOffsetZ ? unclampedMaxOffsetZ : cellsZ - 1
			const touchesWindow = maxOffsetX >= minOffsetX && maxOffsetY >= minOffsetY && maxOffsetZ >= minOffsetZ
			if (!touchesWindow) {
				lightsOutsideWindow += 1
				continue
			}
			lightMinOffsetX[preparedLightCount] = minOffsetX
			lightMaxOffsetX[preparedLightCount] = maxOffsetX
			lightMinOffsetY[preparedLightCount] = minOffsetY
			lightMaxOffsetY[preparedLightCount] = maxOffsetY
			lightMinOffsetZ[preparedLightCount] = minOffsetZ
			lightMaxOffsetZ[preparedLightCount] = maxOffsetZ
			lightEncodedSlots[preparedLightCount] = encodeLightSlot(recordIndex)
			preparedLightCount += 1
		}

		return { rejectedLights, lightsOutsideWindow, readableCount }
	}


	function scatterPendingCellLights() {
		const strideY = activeLayout.cellsX
		const strideZ = activeLayout.cellsX * activeLayout.cellsY
		const listStride = activeListStride
		const allCellsPending = pendingCellCount === activeLayout.cellCount
		for (let lightIndex = 0; preparedLightCount > lightIndex; lightIndex += 1) {
			const encodedSlot = lightEncodedSlots[lightIndex]
			const minOffsetX = lightMinOffsetX[lightIndex]
			const maxOffsetX = lightMaxOffsetX[lightIndex]
			const minOffsetY = lightMinOffsetY[lightIndex]
			const maxOffsetY = lightMaxOffsetY[lightIndex]
			const maxOffsetZ = lightMaxOffsetZ[lightIndex]
			for (let offsetZ = lightMinOffsetZ[lightIndex]; maxOffsetZ >= offsetZ; offsetZ += 1) {
				const planeBase = ringCoordinatesZ[offsetZ] * strideZ
				for (let offsetY = minOffsetY; maxOffsetY >= offsetY; offsetY += 1) {
					const rowBase = planeBase + ringCoordinatesY[offsetY] * strideY
					for (let offsetX = minOffsetX; maxOffsetX >= offsetX; offsetX += 1) {
						const cellIndex = rowBase + ringCoordinatesX[offsetX]
						if (!allCellsPending && pendingCellFlags[cellIndex] !== 1) continue
						const demand = cellLightDemands[cellIndex] + 1
						cellLightDemands[cellIndex] = demand
						if (listStride >= demand) {
							cellLightSlots[cellIndex * listStride + demand - 1] = encodedSlot
						}
					}
				}
			}
		}
	}


	function planPendingCellLists() {
		const maxListsPerCell = activeLayout.maxListsPerCell
		let storedEntries = 0
		let droppedEntries = 0
		let saturatedCells = 0
		for (let pending = 0; pendingCellCount > pending; pending += 1) {
			const cellIndex = pendingCellIndices[pending]
			const demand = cellLightDemands[cellIndex]
			const stored = maxListsPerCell > demand ? demand : maxListsPerCell
			cellListCounts[cellIndex] = stored
			storedEntries += stored
			if (demand > stored) {
				droppedEntries += demand - stored
				saturatedCells += 1
			}
		}
		return { storedEntries, droppedEntries, saturatedCells }
	}

	function clearPendingCells() {
		if (pendingCellCount === activeLayout.cellCount) {
			pendingCellFlags.fill(0, 0, pendingCellCount)
		} else {
			for (let pending = 0; pendingCellCount > pending; pending += 1) {
				pendingCellFlags[pendingCellIndices[pending]] = 0
			}
		}
		pendingCellCount = 0
	}

	function refusedRebuildResult(reason) {
		return Object.freeze({
			phase: MSM_WORLD_GRID_PHASE_ID,
			ok: false,
			refusedReason: reason,
			rebuiltCellCount: 0,
			storedEntryCount: 0,
			droppedEntryCount: 0,
			saturatedCellCount: 0,
			lightCount: 0,
			lightsOutsideWindow: 0,
			rejectedLightCount: 0,
		})
	}


	function rebuildPendingCells(lightRecords) {
		if (!isConfigured()) return refusedRebuildResult(MSM_WORLD_GRID_REFUSALS.NOT_CONFIGURED)
		if (!hasAnchor) return refusedRebuildResult(MSM_WORLD_GRID_REFUSALS.ANCHOR_MISSING)

		const rebuiltCellCount = pendingCellCount
		if (rebuiltCellCount === 0) {
			totals.skippedRebuilds += 1
			lastRebuild = Object.freeze({
				phase: MSM_WORLD_GRID_PHASE_ID,
				ok: true,
				rebuildMode: MSM_WORLD_GRID_REBUILD_MODE.NONE,
				rebuiltCellCount: 0,
				storedEntryCount: 0,
				droppedEntryCount: 0,
				saturatedCellCount: 0,
				lightCount: 0,
				lightsOutsideWindow: 0,
				rejectedLightCount: 0,
			})
			return lastRebuild
		}

		const preparation = prepareLights(lightRecords)
		scatterPendingCellLights()
		const plan = planPendingCellLists()
		clearPendingCells()

		const isFullRebuild = activeLayout.cellCount === rebuiltCellCount
		totals.rebuilds += 1
		if (isFullRebuild) totals.fullRebuilds += 1
		else totals.partialRebuilds += 1
		totals.rebuiltCells += rebuiltCellCount
		totals.storedEntries += plan.storedEntries
		totals.droppedEntries += plan.droppedEntries
		totals.saturatedCells += plan.saturatedCells
		totals.lightsOutsideWindow += preparation.lightsOutsideWindow
		totals.rejectedLights += preparation.rejectedLights

		lastRebuild = Object.freeze({
			phase: MSM_WORLD_GRID_PHASE_ID,
			ok: true,
			rebuildMode: isFullRebuild
				? MSM_WORLD_GRID_REBUILD_MODE.ALL_CELLS
				: MSM_WORLD_GRID_REBUILD_MODE.NEW_CELLS,
			rebuiltCellCount,
			storedEntryCount: plan.storedEntries,
			droppedEntryCount: plan.droppedEntries,
			saturatedCellCount: plan.saturatedCells,
			lightCount: preparedLightCount,
			lightsOutsideWindow: preparation.lightsOutsideWindow,
			rejectedLightCount: preparation.rejectedLights,
		})
		return lastRebuild
	}

	function rebuildEveryCell(lightRecords) {
		if (!isConfigured()) return refusedRebuildResult(MSM_WORLD_GRID_REFUSALS.NOT_CONFIGURED)
		if (!hasAnchor) return refusedRebuildResult(MSM_WORLD_GRID_REFUSALS.ANCHOR_MISSING)
		markEveryCellPending()
		return rebuildPendingCells(lightRecords)
	}


	function markCellsPending(cellIndices) {
		if (!isConfigured() || !Array.isArray(cellIndices)) return 0
		let markedCount = 0
		for (const candidate of cellIndices) {
			const cellIndex = Math.floor(Number(candidate))
			if (!Number.isFinite(cellIndex) || !(cellIndex >= 0) || !(activeLayout.cellCount > cellIndex)) continue
			if (markCellPending(cellIndex)) markedCount += 1
		}
		return markedCount
	}

	function isCellIndexInsideGrid(cellIndex) {
		return isConfigured() && Number.isFinite(cellIndex) && cellIndex >= 0 && activeLayout.cellCount > cellIndex
	}

	function cellLightCount(cellIndex) {
		return isCellIndexInsideGrid(cellIndex) ? cellListCounts[cellIndex] : 0
	}

	function cellLightDemand(cellIndex) {
		return isCellIndexInsideGrid(cellIndex) ? cellLightDemands[cellIndex] : 0
	}

	function isCellSaturated(cellIndex) {
		if (!isCellIndexInsideGrid(cellIndex)) return false
		return cellLightDemands[cellIndex] > cellListCounts[cellIndex]
	}


	function readCellLights(cellIndex, targetLightIndices) {
		if (!isCellIndexInsideGrid(cellIndex) || !targetLightIndices) return 0
		const listBase = cellIndex * activeListStride
		const listCount = cellListCounts[cellIndex]
		for (let entry = 0; listCount > entry; entry += 1) {
			targetLightIndices[entry] = decodeLightSlot(cellLightSlots[listBase + entry])
		}
		return listCount
	}


	function listCellLights(cellIndex) {
		const lightIndices = []
		if (!isCellIndexInsideGrid(cellIndex)) return lightIndices
		const listBase = cellIndex * activeListStride
		const listCount = cellListCounts[cellIndex]
		for (let entry = 0; listCount > entry; entry += 1) {
			lightIndices.push(decodeLightSlot(cellLightSlots[listBase + entry]))
		}
		return lightIndices
	}


	function resolveWindowOffsetCellIndex(offsetX, offsetY, offsetZ) {
		if (!isConfigured() || !hasAnchor) return -1
		if (!(offsetX >= 0) || !(activeLayout.cellsX > offsetX)) return -1
		if (!(offsetY >= 0) || !(activeLayout.cellsY > offsetY)) return -1
		if (!(offsetZ >= 0) || !(activeLayout.cellsZ > offsetZ)) return -1
		return resolveCellIndex(
			activeLayout,
			ringCoordinatesX[offsetX],
			ringCoordinatesY[offsetY],
			ringCoordinatesZ[offsetZ],
		)
	}


	function resolveWorldPositionCellIndex(worldPosition) {
		if (!isConfigured() || !hasAnchor) return -1
		const position = readWorldPosition(worldPosition)
		if (!position) return -1
		return resolveWindowOffsetCellIndex(
			Math.floor(position.positionX / cellSizeStuds) - anchorCellX,
			Math.floor(position.positionY / cellSizeStuds) - anchorCellY,
			Math.floor(position.positionZ / cellSizeStuds) - anchorCellZ,
		)
	}


	function writeTexture(textureData) {
		if (!isConfigured()) {
			return Object.freeze({ ok: false, refusedReason: MSM_WORLD_GRID_REFUSALS.NOT_CONFIGURED, cellCount: 0 })
		}
		if (!textureData || !(textureData.length >= activeLayout.byteSize)) {
			return Object.freeze({ ok: false, refusedReason: MSM_WORLD_GRID_REFUSALS.TEXTURE_TOO_SMALL, cellCount: 0 })
		}

		const entriesPerCell = activeLayout.listTexelsPerCell * MSM_GRID_ENTRIES_PER_TEXEL
		for (let cellIndex = 0; activeLayout.cellCount > cellIndex; cellIndex += 1) {
			const listTexelOffset = resolveDefaultListTexelOffset(activeLayout, cellIndex)
			const listTexelIndex = resolveListTexelIndex(activeLayout, listTexelOffset)
			const listCount = cellListCounts[cellIndex]
			const listBase = cellIndex * activeListStride

			const headerBytes = encodeHeaderTexel({
				listTexelOffset,
				listCount,
				saturated: cellLightDemands[cellIndex] > listCount,
			})
			const headerByteBase = resolveTexelByteOffset(activeLayout, resolveHeaderTexelIndex(activeLayout, cellIndex))
			for (let channel = 0; MSM_GRID_BYTES_PER_TEXEL > channel; channel += 1) {
				textureData[headerByteBase + channel] = headerBytes[channel]
			}

			for (let entry = 0; entriesPerCell > entry; entry += 1) {
				const listByteBase = resolveTexelByteOffset(
					activeLayout,
					listTexelIndex + Math.floor(entry / MSM_GRID_ENTRIES_PER_TEXEL),
				)
				const carriesLight = listCount > entry && activeListStride > entry
				textureData[listByteBase + (entry % MSM_GRID_ENTRIES_PER_TEXEL)] = carriesLight
					? cellLightSlots[listBase + entry]
					: 0
			}
		}

		totals.textureWrites += 1
		return Object.freeze({ ok: true, cellCount: activeLayout.cellCount, byteLength: activeLayout.byteSize })
	}


	function configure(configuration) {
		const request = configuration && typeof configuration === "object" ? configuration : {}
		const layout = request.layout
		const nextCellSizeStuds = readFiniteNumber(request.cellSizeStuds)
		const problems = []

		if (!layout || !isUsableWorldGridLayout(layout)) problems.push("grid layout is missing or was sanitized")
		if (nextCellSizeStuds === null || !(nextCellSizeStuds > 0)) problems.push("cellSizeStuds must be a positive number")
		if (layout && layout.cellCount > ceilingCellCount) problems.push("cell count above the allocated ceiling")
		if (layout && layout.maxListsPerCell > ceilingListStride) problems.push("lists per cell above the allocated ceiling")
		if (layout && Math.max(layout.cellsX, layout.cellsY, layout.cellsZ) > ceilingCellsPerAxis) {
			problems.push("cells on one axis above the allocated ceiling")
		}

		configurationProblems = Object.freeze(problems.slice())
		if (problems.length > 0) return Object.freeze({ ok: false, problems: configurationProblems })

		activeLayout = layout
		activeListStride = layout.maxListsPerCell
		cellSizeStuds = nextCellSizeStuds
		pendingCellFlags.fill(0)
		pendingCellCount = 0
		cellLightDemands.fill(0)
		cellListCounts.fill(0)
		hasAnchor = false
		lastRebuild = null
		preparedLightCount = 0
		return Object.freeze({ ok: true, problems: configurationProblems })
	}


	function countSaturatedCells() {
		if (!isConfigured()) return 0
		let saturatedCellCount = 0
		for (let cellIndex = 0; activeLayout.cellCount > cellIndex; cellIndex += 1) {
			if (cellLightDemands[cellIndex] > cellListCounts[cellIndex]) saturatedCellCount += 1
		}
		return saturatedCellCount
	}


	function listSaturatedCells(reportLimit) {
		const requestedLimit = Math.floor(Number(reportLimit))
		const limit = requestedLimit >= 0 ? requestedLimit : MSM_WORLD_GRID_SATURATION_REPORT_LIMIT
		const saturatedCells = []
		if (!isConfigured()) return saturatedCells
		for (let cellIndex = 0; activeLayout.cellCount > cellIndex; cellIndex += 1) {
			if (limit === saturatedCells.length) break
			const demand = cellLightDemands[cellIndex]
			const listCount = cellListCounts[cellIndex]
			if (!(demand > listCount)) continue
			saturatedCells.push(Object.freeze({ cellIndex, listCount, demand, droppedCount: demand - listCount }))
		}
		return saturatedCells
	}


	function listWindowLightIndices() {
		const lightIndices = []
		for (let light = 0; preparedLightCount > light; light += 1) {
			lightIndices.push(decodeLightSlot(lightEncodedSlots[light]))
		}
		return lightIndices
	}


	function describe() {
		const saturatedCellCount = countSaturatedCells()
		const saturatedCells = listSaturatedCells(MSM_WORLD_GRID_SATURATION_REPORT_LIMIT)
		return Object.freeze({
			phase: MSM_WORLD_GRID_PHASE_ID,
			configured: isConfigured(),
			configurationProblems,
			layout: activeLayout ? Object.freeze(describeWorldGridLayout(activeLayout)) : null,
			cellSizeStuds,
			anchorCell: hasAnchor ? Object.freeze({ x: anchorCellX, y: anchorCellY, z: anchorCellZ }) : null,
			pendingCellCount,
			windowLightCount: preparedLightCount,
			allocatedBufferBytes,
			saturatedCellCount,
			saturatedCells: Object.freeze(saturatedCells),
			saturationReportTruncated: saturatedCellCount > saturatedCells.length,
			lastRebuild,
			totals: Object.freeze(Object.assign({}, totals)),
		})
	}

	return Object.freeze({
		phase: MSM_WORLD_GRID_PHASE_ID,
		configure,
		anchorToCamera,
		markCellsPending,
		rebuildPendingCells,
		rebuildEveryCell,
		writeTexture,
		cellLightCount,
		cellLightDemand,
		isCellSaturated,
		readCellLights,
		listCellLights,
		listWindowLightIndices,
		resolveWindowOffsetCellIndex,
		resolveWorldPositionCellIndex,
		countSaturatedCells,
		listSaturatedCells,
		describe,
	})
}
