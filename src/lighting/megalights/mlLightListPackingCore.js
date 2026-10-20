export const LIGHT_INDICES_PER_TEXEL = 4;
export const DEFAULT_MAXIMUM_LIGHTS_PER_CELL = 32;
export const DEFAULT_PACKED_TEXTURE_WIDTH = 128;
export const BYTES_PER_RGBA_FLOAT_TEXEL = 16;
export const EMPTY_CELL_FIRST_ENTRY_INDEX = 0;


export const LIGHT_GRID_TEXEL_LAYOUT = Object.freeze({
  cellTable: Object.freeze({
    r: "firstEntryIndex",
    g: "cellLightCount",
    b: "reservedForCoarseCellIndex",
    a: "reservedForCellFlags",
  }),
  indexList: Object.freeze({
    r: "lightIndex0",
    g: "lightIndex1",
    b: "lightIndex2",
    a: "lightIndex3",
  }),
});

function positiveInteger(value, fallback) {
  const asInteger = Math.floor(Number(value));
  return Number.isFinite(asInteger) && asInteger > 0 ? asInteger : fallback;
}


export function packLightGrid(request) {
  const lightIndicesByCell = Array.isArray(request && request.lightIndicesByCell)
    ? request.lightIndicesByCell
    : [];
  const cellCount = positiveInteger(request && request.cellCount, lightIndicesByCell.length || 1);
  const maximumLightsPerCell = positiveInteger(
    request && request.maximumLightsPerCell,
    DEFAULT_MAXIMUM_LIGHTS_PER_CELL,
  );
  const textureWidth = positiveInteger(request && request.textureWidth, DEFAULT_PACKED_TEXTURE_WIDTH);

  let entryCount = 0;
  let droppedLightCount = 0;
  let saturatedCellCount = 0;
  for (let cellIndex = 0; cellIndex < cellCount; cellIndex++) {
    const cellLightIndices = lightIndicesByCell[cellIndex] || [];
    const keptCount = Math.min(cellLightIndices.length, maximumLightsPerCell);
    entryCount += keptCount;
    if (cellLightIndices.length > keptCount) {
      saturatedCellCount++;
      droppedLightCount += cellLightIndices.length - keptCount;
    }
  }

  const indexListTexelCount = Math.ceil(entryCount / LIGHT_INDICES_PER_TEXEL);
  const totalTexelCount = cellCount + indexListTexelCount;
  const textureHeight = Math.max(1, Math.ceil(totalTexelCount / textureWidth));
  const texture = new Float32Array(textureWidth * textureHeight * 4);

  let nextEntryIndex = 0;
  for (let cellIndex = 0; cellIndex < cellCount; cellIndex++) {
    const cellLightIndices = lightIndicesByCell[cellIndex] || [];
    const keptCount = Math.min(cellLightIndices.length, maximumLightsPerCell);
    const cellTableOffset = cellIndex * 4;
    texture[cellTableOffset] = keptCount > 0 ? nextEntryIndex : EMPTY_CELL_FIRST_ENTRY_INDEX;
    texture[cellTableOffset + 1] = keptCount;

    for (let entry = 0; entry < keptCount; entry++) {
      const entryIndex = nextEntryIndex + entry;
      const texelIndex = cellCount + Math.floor(entryIndex / LIGHT_INDICES_PER_TEXEL);
      const channelIndex = entryIndex % LIGHT_INDICES_PER_TEXEL;
      texture[texelIndex * 4 + channelIndex] = cellLightIndices[entry];
    }
    nextEntryIndex += keptCount;
  }

  return {
    texture,
    textureWidth,
    textureHeight,
    cellCount,
    indexListTexelOffset: cellCount,
    indexListTexelCount,
    entryCount,
    maximumLightsPerCell,
    droppedLightCount,
    saturatedCellCount,
    layout: LIGHT_GRID_TEXEL_LAYOUT,
  };
}


export function readLightGridCellHeader(packed, cellIndex) {
  if (!packed || cellIndex < 0 || cellIndex >= packed.cellCount) return null;
  const cellTableOffset = cellIndex * 4;
  return {
    firstEntryIndex: packed.texture[cellTableOffset],
    cellLightCount: packed.texture[cellTableOffset + 1],
  };
}

export function readLightGridCell(packed, cellIndex) {
  const header = readLightGridCellHeader(packed, cellIndex);
  if (!header) return [];
  const lightIndices = [];
  for (let entry = 0; entry < header.cellLightCount; entry++) {
    const entryIndex = header.firstEntryIndex + entry;
    const texelIndex = packed.indexListTexelOffset + Math.floor(entryIndex / LIGHT_INDICES_PER_TEXEL);
    const channelIndex = entryIndex % LIGHT_INDICES_PER_TEXEL;
    lightIndices.push(packed.texture[texelIndex * 4 + channelIndex]);
  }
  return lightIndices;
}

export function unpackLightGrid(packed) {
  const lightIndicesByCell = new Array(packed.cellCount);
  for (let cellIndex = 0; cellIndex < packed.cellCount; cellIndex++) {
    lightIndicesByCell[cellIndex] = readLightGridCell(packed, cellIndex);
  }
  return lightIndicesByCell;
}


export function lightGridMemoryReport(packed) {
  const packedBytes = packed.texture.length * Float32Array.BYTES_PER_ELEMENT;
  const unpackedFixedCapacityBytes =
    packed.cellCount * packed.maximumLightsPerCell * BYTES_PER_RGBA_FLOAT_TEXEL;
  const unpackedOneIndexPerTexelBytes = (packed.cellCount + packed.entryCount) * BYTES_PER_RGBA_FLOAT_TEXEL;
  return {
    packedBytes,
    unpackedFixedCapacityBytes,
    unpackedOneIndexPerTexelBytes,
    fixedCapacityRatio: unpackedFixedCapacityBytes > 0 ? packedBytes / unpackedFixedCapacityBytes : 1,
    oneIndexPerTexelRatio:
      unpackedOneIndexPerTexelBytes > 0 ? packedBytes / unpackedOneIndexPerTexelBytes : 1,
    entryCount: packed.entryCount,
    droppedLightCount: packed.droppedLightCount,
    saturatedCellCount: packed.saturatedCellCount,
  };
}
