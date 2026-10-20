export const MSM_GRID_TEXTURE_WIDTH = 128;


export const MSM_GRID_BYTES_PER_TEXEL = 4;
export const MSM_GRID_ENTRIES_PER_TEXEL = 4;


export const MSM_GRID_LIGHT_INDEX_BITS = 8;
export const MSM_GRID_EMPTY_SLOT = 0;
export const MSM_GRID_MAX_LIGHT_COUNT = 255;


export const MSM_GRID_MAX_LISTS_PER_CELL = 12;


export const MSM_GRID_HEADER_OFFSET_BITS = 16;
export const MSM_GRID_MAX_LIST_TEXEL_OFFSET = 65535;


export const MSM_GRID_SATURATED_FLAG = 1;


export const MSM_GRID_HEADER_CHANNELS = Object.freeze([
  "listTexelOffsetLow",
  "listTexelOffsetHigh",
  "listCount",
  "flags",
]);

function isIndexInRange(value, count) {
  return Number.isFinite(value) && value >= 0 && count > value;
}

function sanitizeCellCount(value, name, problems) {
  const parsed = Math.floor(Number(value));
  if (!(parsed >= 1)) {
    problems.push(name + " inválido (" + String(value) + ") — assumindo 1");
    return 1;
  }
  return parsed;
}

function sanitizeListsPerCell(value, problems) {
  const parsed = Math.floor(Number(value));
  if (!(parsed >= 1)) {
    problems.push("maxListsPerCell inválido (" + String(value) + ") — assumindo 1");
    return 1;
  }
  if (parsed > MSM_GRID_MAX_LISTS_PER_CELL) {
    problems.push(
      "maxListsPerCell " + parsed + " acima do teto de codificação " + MSM_GRID_MAX_LISTS_PER_CELL + " — truncado",
    );
    return MSM_GRID_MAX_LISTS_PER_CELL;
  }
  return parsed;
}


export function createWorldGridLayout(dimensions) {
  const source = dimensions && typeof dimensions === "object" ? dimensions : {};
  const problems = [];
  const cellsX = sanitizeCellCount(source.cellsX, "cellsX", problems);
  const cellsY = sanitizeCellCount(source.cellsY, "cellsY", problems);
  const cellsZ = sanitizeCellCount(source.cellsZ, "cellsZ", problems);
  const maxListsPerCell = sanitizeListsPerCell(source.maxListsPerCell, problems);

  const cellCount = cellsX * cellsY * cellsZ;
  const listTexelsPerCell = Math.ceil(maxListsPerCell / MSM_GRID_ENTRIES_PER_TEXEL);
  const headerTexelIndex = 0;
  const headerTexelCount = cellCount;
  const listTexelIndex = headerTexelCount;
  const listTexelCount = cellCount * listTexelsPerCell;
  const texelCount = headerTexelCount + listTexelCount;
  const textureWidth = MSM_GRID_TEXTURE_WIDTH;
  const textureHeight = Math.ceil(texelCount / textureWidth);
  const allocatedTexelCount = textureWidth * textureHeight;
  const byteSize = allocatedTexelCount * MSM_GRID_BYTES_PER_TEXEL;
  const highestListTexelOffset = listTexelCount > 0 ? listTexelCount - 1 : 0;
  const withinOffsetBudget = MSM_GRID_MAX_LIST_TEXEL_OFFSET >= highestListTexelOffset;

  if (!withinOffsetBudget) {
    problems.push(
      "região de listas com " + listTexelCount + " texeis não cabe nos " + MSM_GRID_HEADER_OFFSET_BITS + " bits de offset",
    );
  }

  return Object.freeze({
    cellsX,
    cellsY,
    cellsZ,
    cellCount,
    maxListsPerCell,
    listTexelsPerCell,
    headerTexelIndex,
    headerTexelCount,
    listTexelIndex,
    listTexelCount,
    texelCount,
    textureWidth,
    textureHeight,
    allocatedTexelCount,
    byteSize,
    withinOffsetBudget,
    problems: Object.freeze(problems.slice()),
  });
}


export function isUsableWorldGridLayout(layout) {
  return !!layout && Array.isArray(layout.problems) && layout.problems.length === 0;
}


export function resolveCellIndex(layout, cellX, cellY, cellZ) {
  if (!layout) return -1;
  const x = Math.floor(Number(cellX));
  const y = Math.floor(Number(cellY));
  const z = Math.floor(Number(cellZ));
  if (!isIndexInRange(x, layout.cellsX)) return -1;
  if (!isIndexInRange(y, layout.cellsY)) return -1;
  if (!isIndexInRange(z, layout.cellsZ)) return -1;
  return x + layout.cellsX * (y + layout.cellsY * z);
}


export function resolveCellCoordinates(layout, cellIndex) {
  const index = Math.floor(Number(cellIndex));
  if (!layout || !isIndexInRange(index, layout.cellCount)) return null;
  const cellX = index % layout.cellsX;
  const remainder = Math.floor(index / layout.cellsX);
  const cellY = remainder % layout.cellsY;
  const cellZ = Math.floor(remainder / layout.cellsY);
  return { cellX, cellY, cellZ };
}


export function resolveHeaderTexelIndex(layout, cellIndex) {
  const index = Math.floor(Number(cellIndex));
  if (!layout || !isIndexInRange(index, layout.cellCount)) return -1;
  return layout.headerTexelIndex + index;
}


export function resolveDefaultListTexelOffset(layout, cellIndex) {
  const index = Math.floor(Number(cellIndex));
  if (!layout || !isIndexInRange(index, layout.cellCount)) return -1;
  return index * layout.listTexelsPerCell;
}


export function resolveListTexelIndex(layout, listTexelOffset) {
  const offset = Math.floor(Number(listTexelOffset));
  if (!layout || !isIndexInRange(offset, layout.listTexelCount)) return -1;
  return layout.listTexelIndex + offset;
}


export function resolveTexelCoordinates(layout, texelIndex) {
  const index = Math.floor(Number(texelIndex));
  if (!layout || !isIndexInRange(index, layout.allocatedTexelCount)) return null;
  return { x: index % layout.textureWidth, y: Math.floor(index / layout.textureWidth) };
}


export function resolveTexelByteOffset(layout, texelIndex) {
  const index = Math.floor(Number(texelIndex));
  if (!layout || !isIndexInRange(index, layout.allocatedTexelCount)) return -1;
  return index * MSM_GRID_BYTES_PER_TEXEL;
}


export function encodeLightSlot(lightIndex) {
  const index = Math.floor(Number(lightIndex));
  if (!isIndexInRange(index, MSM_GRID_MAX_LIGHT_COUNT)) return MSM_GRID_EMPTY_SLOT;
  return index + 1;
}


export function decodeLightSlot(slot) {
  const value = Math.floor(Number(slot));
  if (!Number.isFinite(value) || !(value >= 1) || value > MSM_GRID_MAX_LIGHT_COUNT) return -1;
  return value - 1;
}

function clampListTexelOffset(value) {
  const parsed = Math.floor(Number(value));
  if (!(parsed >= 0)) return 0;
  if (parsed > MSM_GRID_MAX_LIST_TEXEL_OFFSET) return MSM_GRID_MAX_LIST_TEXEL_OFFSET;
  return parsed;
}

function clampListCount(value) {
  const parsed = Math.floor(Number(value));
  if (!(parsed >= 0)) return 0;
  if (parsed > MSM_GRID_MAX_LISTS_PER_CELL) return MSM_GRID_MAX_LISTS_PER_CELL;
  return parsed;
}


export function encodeHeaderTexel(header) {
  const source = header && typeof header === "object" ? header : {};
  const listTexelOffset = clampListTexelOffset(source.listTexelOffset);
  const listCount = clampListCount(source.listCount);
  const flags = source.saturated ? MSM_GRID_SATURATED_FLAG : 0;
  return Uint8Array.of(listTexelOffset & 0xff, (listTexelOffset >> 8) & 0xff, listCount, flags);
}


export function decodeHeaderTexel(textureData, byteOffset) {
  const bytes = textureData || [];
  const base = Math.max(0, Math.floor(Number(byteOffset)) || 0);
  const low = Number(bytes[base]) || 0;
  const high = Number(bytes[base + 1]) || 0;
  return {
    listTexelOffset: low + (high << 8),
    listCount: Number(bytes[base + 2]) || 0,
    saturated: ((Number(bytes[base + 3]) || 0) & MSM_GRID_SATURATED_FLAG) !== 0,
  };
}


export function encodeListTexel(lightIndices) {
  const source = Array.isArray(lightIndices) ? lightIndices : [];
  const texel = new Uint8Array(MSM_GRID_ENTRIES_PER_TEXEL);
  for (let entry = 0; MSM_GRID_ENTRIES_PER_TEXEL > entry; entry += 1) {
    texel[entry] = encodeLightSlot(source[entry]);
  }
  return texel;
}


export function decodeListTexel(textureData, byteOffset) {
  const bytes = textureData || [];
  const base = Math.max(0, Math.floor(Number(byteOffset)) || 0);
  const lightIndices = [];
  for (let entry = 0; MSM_GRID_ENTRIES_PER_TEXEL > entry; entry += 1) {
    lightIndices.push(decodeLightSlot(bytes[base + entry]));
  }
  return lightIndices;
}


export function createGridTextureData(layout) {
  const byteSize = layout && layout.byteSize >= 0 ? layout.byteSize : 0;
  return new Uint8Array(byteSize);
}


export function writeCellList(textureData, layout, cellIndex, lightIndices, listTexelOffset) {
  const headerTexelIndex = resolveHeaderTexelIndex(layout, cellIndex);
  if (headerTexelIndex === -1) {
    return { ok: false, written: 0, saturated: false, listTexelOffset: -1 };
  }
  const requested = Array.isArray(lightIndices) ? lightIndices : [];
  const offset =
    listTexelOffset === undefined || listTexelOffset === null
      ? resolveDefaultListTexelOffset(layout, cellIndex)
      : Math.floor(Number(listTexelOffset));
  const listTexelIndex = resolveListTexelIndex(layout, offset);
  if (listTexelIndex === -1) {
    return { ok: false, written: 0, saturated: false, listTexelOffset: -1 };
  }

  const written = Math.min(requested.length, layout.maxListsPerCell);
  const saturated = requested.length > layout.maxListsPerCell;

  for (let texel = 0; layout.listTexelsPerCell > texel; texel += 1) {
    const entryBase = texel * MSM_GRID_ENTRIES_PER_TEXEL;
    const slice = requested.slice(entryBase, Math.min(entryBase + MSM_GRID_ENTRIES_PER_TEXEL, written));
    const bytes = encodeListTexel(slice);
    const byteBase = resolveTexelByteOffset(layout, listTexelIndex + texel);
    if (byteBase === -1) break;
    for (let entry = 0; MSM_GRID_ENTRIES_PER_TEXEL > entry; entry += 1) {
      textureData[byteBase + entry] = bytes[entry];
    }
  }

  const headerBytes = encodeHeaderTexel({ listTexelOffset: offset, listCount: written, saturated });
  const headerByteBase = resolveTexelByteOffset(layout, headerTexelIndex);
  for (let channel = 0; MSM_GRID_BYTES_PER_TEXEL > channel; channel += 1) {
    textureData[headerByteBase + channel] = headerBytes[channel];
  }

  return { ok: true, written, saturated, listTexelOffset: offset };
}


export function readCellList(textureData, layout, cellIndex) {
  const headerTexelIndex = resolveHeaderTexelIndex(layout, cellIndex);
  if (headerTexelIndex === -1) {
    return { ok: false, lightIndices: [], saturated: false, listTexelOffset: -1 };
  }
  const header = decodeHeaderTexel(textureData, resolveTexelByteOffset(layout, headerTexelIndex));
  const listTexelIndex = resolveListTexelIndex(layout, header.listTexelOffset);
  if (listTexelIndex === -1) {
    return { ok: false, lightIndices: [], saturated: header.saturated, listTexelOffset: header.listTexelOffset };
  }

  const lightIndices = [];
  const texelsToRead = Math.ceil(header.listCount / MSM_GRID_ENTRIES_PER_TEXEL);
  for (let texel = 0; texelsToRead > texel; texel += 1) {
    const byteBase = resolveTexelByteOffset(layout, listTexelIndex + texel);
    if (byteBase === -1) break;
    const entries = decodeListTexel(textureData, byteBase);
    for (const lightIndex of entries) {
      if (lightIndices.length === header.listCount) break;
      lightIndices.push(lightIndex);
    }
  }

  return {
    ok: true,
    lightIndices,
    saturated: header.saturated,
    listTexelOffset: header.listTexelOffset,
  };
}


export function describeWorldGridLayout(layout) {
  if (!layout) return null;
  return {
    cells: layout.cellsX + "x" + layout.cellsY + "x" + layout.cellsZ,
    cellCount: layout.cellCount,
    maxListsPerCell: layout.maxListsPerCell,
    texture: layout.textureWidth + "x" + layout.textureHeight,
    byteSize: layout.byteSize,
    usable: isUsableWorldGridLayout(layout),
    problems: layout.problems.slice(),
  };
}
