export const LIGHT_FUNCTION_INTERIOR_SIZE = 128;
export const LIGHT_FUNCTION_GUTTER = 8;
export const LIGHT_FUNCTION_CELL_PITCH = LIGHT_FUNCTION_INTERIOR_SIZE + LIGHT_FUNCTION_GUTTER * 2;
export const LIGHT_FUNCTION_GRID = 9;
export const LIGHT_FUNCTION_ATLAS_SIZE = LIGHT_FUNCTION_CELL_PITCH * LIGHT_FUNCTION_GRID;
export const LIGHT_FUNCTION_SLOT_COUNT = LIGHT_FUNCTION_GRID * LIGHT_FUNCTION_GRID;
export const LIGHT_FUNCTION_NEUTRAL_SLOT = 0;
export const LIGHT_FUNCTION_FIRST_CONTENT_SLOT = 1;
export const LIGHT_FUNCTION_CONTENT_SLOT_CAPACITY = LIGHT_FUNCTION_SLOT_COUNT - 1;
export const LIGHT_FUNCTION_CHANNEL_COUNT = 4;                                          


export const LIGHT_FUNCTION_SAFE_MIP_LEVEL_COUNT = Math.floor(Math.log2(LIGHT_FUNCTION_GUTTER)) + 1;

export const LIGHT_FUNCTION_CHANNEL_INDEX = Object.freeze({ red: 0, green: 1, blue: 2, alpha: 3 });


export const LIGHT_FUNCTION_SAMPLE_OFFSET = 1;
export const LIGHT_FUNCTION_SAMPLE_SPAN = LIGHT_FUNCTION_INTERIOR_SIZE - 2;

export function isValidSlot(slot) {
  return Number.isInteger(slot) && slot >= 0 && slot < LIGHT_FUNCTION_SLOT_COUNT;
}

function requireValidSlot(slot) {
  if (!isValidSlot(slot)) throw new Error("ML-F6: slot out of range: " + String(slot));
  return slot;
}

function requireSafeMipLevel(mipLevel) {
  const level = mipLevel | 0;
  if (level < 0 || level >= LIGHT_FUNCTION_SAFE_MIP_LEVEL_COUNT) {
    throw new Error("ML-F6: mip level " + String(mipLevel) + " is outside the gutter-safe chain");
  }
  return level;
}

export function interiorSizeAtMip(mipLevel) {
  return LIGHT_FUNCTION_INTERIOR_SIZE >> requireSafeMipLevel(mipLevel);
}

export function gutterAtMip(mipLevel) {
  return LIGHT_FUNCTION_GUTTER >> requireSafeMipLevel(mipLevel);
}

export function cellPitchAtMip(mipLevel) {
  return LIGHT_FUNCTION_CELL_PITCH >> requireSafeMipLevel(mipLevel);
}

export function atlasSizeAtMip(mipLevel) {
  return LIGHT_FUNCTION_ATLAS_SIZE >> requireSafeMipLevel(mipLevel);
}

export function slotColumn(slot) {
  return requireValidSlot(slot) % LIGHT_FUNCTION_GRID;
}

export function slotRow(slot) {
  return Math.floor(requireValidSlot(slot) / LIGHT_FUNCTION_GRID);
}


export function slotInteriorOrigin(slot, mipLevel = 0) {
  const pitch = cellPitchAtMip(mipLevel);
  const gutter = gutterAtMip(mipLevel);
  return { x: slotColumn(slot) * pitch + gutter, y: slotRow(slot) * pitch + gutter };
}


export function slotInteriorUvRect(slot, mipLevel = 0) {
  const origin = slotInteriorOrigin(slot, mipLevel);
  const size = interiorSizeAtMip(mipLevel);
  const atlasSize = atlasSizeAtMip(mipLevel);
  return {
    minU: origin.x / atlasSize,
    minV: origin.y / atlasSize,
    maxU: (origin.x + size) / atlasSize,
    maxV: (origin.y + size) / atlasSize,
  };
}

function texelOffset(x, y, atlasSize) {
  return (y * atlasSize + x) * LIGHT_FUNCTION_CHANNEL_COUNT;
}

export function createAtlasPixels(mipLevel = 0) {
  const atlasSize = atlasSizeAtMip(mipLevel);
  return new Uint8Array(atlasSize * atlasSize * LIGHT_FUNCTION_CHANNEL_COUNT);
}

export function atlasByteLengthWithMipChain() {
  let total = 0;
  for (let level = 0; level < LIGHT_FUNCTION_SAFE_MIP_LEVEL_COUNT; level++) {
    const atlasSize = atlasSizeAtMip(level);
    total += atlasSize * atlasSize * LIGHT_FUNCTION_CHANNEL_COUNT;
  }
  return total;
}

export function fillSlotSolid(pixels, slot, rgba, mipLevel = 0) {
  const atlasSize = atlasSizeAtMip(mipLevel);
  const pitch = cellPitchAtMip(mipLevel);
  const cellX = slotColumn(slot) * pitch;
  const cellY = slotRow(slot) * pitch;
  for (let y = 0; y < pitch; y++) {
    for (let x = 0; x < pitch; x++) {
      const at = texelOffset(cellX + x, cellY + y, atlasSize);
      pixels[at] = rgba[0];
      pixels[at + 1] = rgba[1];
      pixels[at + 2] = rgba[2];
      pixels[at + 3] = rgba[3];
    }
  }
  return pixels;
}


export function writeMonochromeCellIntoSlot(pixels, slot, cell, mipLevel = 0) {
  const size = interiorSizeAtMip(mipLevel);
  if (!cell || cell.length !== size * size) {
    throw new Error("ML-F6: monochrome cell must have " + String(size * size) + " texels");
  }
  const atlasSize = atlasSizeAtMip(mipLevel);
  const origin = slotInteriorOrigin(slot, mipLevel);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const value = cell[y * size + x];
      const at = texelOffset(origin.x + x, origin.y + y, atlasSize);
      pixels[at] = value;
      pixels[at + 1] = value;
      pixels[at + 2] = value;
      pixels[at + 3] = 255;
    }
  }
  fillSlotGutter(pixels, slot, mipLevel);
  return pixels;
}


export function writeColorCellIntoSlot(pixels, slot, cellRgba, mipLevel = 0) {
  const size = interiorSizeAtMip(mipLevel);
  if (!cellRgba || cellRgba.length !== size * size * LIGHT_FUNCTION_CHANNEL_COUNT) {
    throw new Error("ML-F6: color cell must have " + String(size * size * 4) + " bytes");
  }
  const atlasSize = atlasSizeAtMip(mipLevel);
  const origin = slotInteriorOrigin(slot, mipLevel);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const from = (y * size + x) * LIGHT_FUNCTION_CHANNEL_COUNT;
      const at = texelOffset(origin.x + x, origin.y + y, atlasSize);
      pixels[at] = cellRgba[from];
      pixels[at + 1] = cellRgba[from + 1];
      pixels[at + 2] = cellRgba[from + 2];
      pixels[at + 3] = cellRgba[from + 3];
    }
  }
  fillSlotGutter(pixels, slot, mipLevel);
  return pixels;
}


export function fillSlotGutter(pixels, slot, mipLevel = 0) {
  const atlasSize = atlasSizeAtMip(mipLevel);
  const pitch = cellPitchAtMip(mipLevel);
  const gutter = gutterAtMip(mipLevel);
  const size = interiorSizeAtMip(mipLevel);
  const cellX = slotColumn(slot) * pitch;
  const cellY = slotRow(slot) * pitch;
  const origin = { x: cellX + gutter, y: cellY + gutter };
  for (let y = 0; y < pitch; y++) {
    for (let x = 0; x < pitch; x++) {
      const insideX = x >= gutter && x < gutter + size;
      const insideY = y >= gutter && y < gutter + size;
      if (insideX && insideY) continue;
      const nearestX = Math.min(Math.max(x - gutter, 0), size - 1);
      const nearestY = Math.min(Math.max(y - gutter, 0), size - 1);
      const from = texelOffset(origin.x + nearestX, origin.y + nearestY, atlasSize);
      const at = texelOffset(cellX + x, cellY + y, atlasSize);
      pixels[at] = pixels[from];
      pixels[at + 1] = pixels[from + 1];
      pixels[at + 2] = pixels[from + 2];
      pixels[at + 3] = pixels[from + 3];
    }
  }
  return pixels;
}

export function readInteriorTexel(pixels, slot, x, y, channel = 0, mipLevel = 0) {
  const size = interiorSizeAtMip(mipLevel);
  const atlasSize = atlasSizeAtMip(mipLevel);
  const origin = slotInteriorOrigin(slot, mipLevel);
  const clampedX = Math.min(Math.max(x | 0, 0), size - 1);
  const clampedY = Math.min(Math.max(y | 0, 0), size - 1);
  return pixels[texelOffset(origin.x + clampedX, origin.y + clampedY, atlasSize) + channel];
}


export function readCellTexel(pixels, slot, x, y, channel = 0, mipLevel = 0) {
  const size = interiorSizeAtMip(mipLevel);
  const gutter = gutterAtMip(mipLevel);
  const atlasSize = atlasSizeAtMip(mipLevel);
  const origin = slotInteriorOrigin(slot, mipLevel);
  const clampedX = Math.min(Math.max(x | 0, -gutter), size - 1 + gutter);
  const clampedY = Math.min(Math.max(y | 0, -gutter), size - 1 + gutter);
  return pixels[texelOffset(origin.x + clampedX, origin.y + clampedY, atlasSize) + channel];
}


export function sampleSlotBilinear(pixels, slot, u, v, channel = 0, mipLevel = 0) {
  const levelScale = Math.pow(2, requireSafeMipLevel(mipLevel));
  const clampedU = Math.min(Math.max(u, 0), 1);
  const clampedV = Math.min(Math.max(v, 0), 1);
  const centerU = (LIGHT_FUNCTION_SAMPLE_OFFSET + LIGHT_FUNCTION_SAMPLE_SPAN * clampedU) / levelScale - 0.5;
  const centerV = (LIGHT_FUNCTION_SAMPLE_OFFSET + LIGHT_FUNCTION_SAMPLE_SPAN * clampedV) / levelScale - 0.5;
  const x0 = Math.floor(centerU);
  const y0 = Math.floor(centerV);
  const fractionX = centerU - x0;
  const fractionY = centerV - y0;
  const topLeft = readCellTexel(pixels, slot, x0, y0, channel, mipLevel);
  const topRight = readCellTexel(pixels, slot, x0 + 1, y0, channel, mipLevel);
  const bottomLeft = readCellTexel(pixels, slot, x0, y0 + 1, channel, mipLevel);
  const bottomRight = readCellTexel(pixels, slot, x0 + 1, y0 + 1, channel, mipLevel);
  const top = topLeft * (1 - fractionX) + topRight * fractionX;
  const bottom = bottomLeft * (1 - fractionX) + bottomRight * fractionX;
  return (top * (1 - fractionY) + bottom * fractionY) / 255;
}

export function sampleSlotColorBilinear(pixels, slot, u, v, mipLevel = 0) {
  return {
    red: sampleSlotBilinear(pixels, slot, u, v, LIGHT_FUNCTION_CHANNEL_INDEX.red, mipLevel),
    green: sampleSlotBilinear(pixels, slot, u, v, LIGHT_FUNCTION_CHANNEL_INDEX.green, mipLevel),
    blue: sampleSlotBilinear(pixels, slot, u, v, LIGHT_FUNCTION_CHANNEL_INDEX.blue, mipLevel),
    alpha: sampleSlotBilinear(pixels, slot, u, v, LIGHT_FUNCTION_CHANNEL_INDEX.alpha, mipLevel),
  };
}


export function buildSlotSafeMipChain(basePixels) {
  const chain = [];
  let previous = basePixels;
  for (let level = 1; level < LIGHT_FUNCTION_SAFE_MIP_LEVEL_COUNT; level++) {
    const size = interiorSizeAtMip(level);
    const atlasSize = atlasSizeAtMip(level);
    const previousAtlasSize = atlasSizeAtMip(level - 1);
    const pixels = createAtlasPixels(level);
    for (let slot = 0; slot < LIGHT_FUNCTION_SLOT_COUNT; slot++) {
      const origin = slotInteriorOrigin(slot, level);
      const previousOrigin = slotInteriorOrigin(slot, level - 1);
      for (let y = 0; y < size; y++) {
        for (let x = 0; x < size; x++) {
          const at = texelOffset(origin.x + x, origin.y + y, atlasSize);
          for (let channel = 0; channel < LIGHT_FUNCTION_CHANNEL_COUNT; channel++) {
            const a = previous[texelOffset(previousOrigin.x + x * 2, previousOrigin.y + y * 2, previousAtlasSize) + channel];
            const b = previous[texelOffset(previousOrigin.x + x * 2 + 1, previousOrigin.y + y * 2, previousAtlasSize) + channel];
            const c = previous[texelOffset(previousOrigin.x + x * 2, previousOrigin.y + y * 2 + 1, previousAtlasSize) + channel];
            const d = previous[texelOffset(previousOrigin.x + x * 2 + 1, previousOrigin.y + y * 2 + 1, previousAtlasSize) + channel];
            pixels[at + channel] = Math.round((a + b + c + d) / 4);
          }
        }
      }
      fillSlotGutter(pixels, slot, level);
    }
    chain.push({ mipLevel: level, width: atlasSize, height: atlasSize, pixels });
    previous = pixels;
  }
  return chain;
}


export function mipLevelForProjectedFootprint(projectedTexelCount) {
  const projected = Number(projectedTexelCount);
  if (!Number.isFinite(projected) || projected >= LIGHT_FUNCTION_INTERIOR_SIZE) return 0;
  if (projected <= 0) return LIGHT_FUNCTION_SAFE_MIP_LEVEL_COUNT - 1;
  const level = Math.round(Math.log2(LIGHT_FUNCTION_INTERIOR_SIZE / projected));
  return Math.min(Math.max(level, 0), LIGHT_FUNCTION_SAFE_MIP_LEVEL_COUNT - 1);
}

export function describeAtlasGeometry() {
  return {
    interiorSize: LIGHT_FUNCTION_INTERIOR_SIZE,
    gutter: LIGHT_FUNCTION_GUTTER,
    cellPitch: LIGHT_FUNCTION_CELL_PITCH,
    grid: LIGHT_FUNCTION_GRID,
    atlasSize: LIGHT_FUNCTION_ATLAS_SIZE,
    slotCount: LIGHT_FUNCTION_SLOT_COUNT,
    contentSlotCapacity: LIGHT_FUNCTION_CONTENT_SLOT_CAPACITY,
    neutralSlot: LIGHT_FUNCTION_NEUTRAL_SLOT,
    safeMipLevelCount: LIGHT_FUNCTION_SAFE_MIP_LEVEL_COUNT,
    textureUnits: 1,
    byteLengthWithMipChain: atlasByteLengthWithMipChain(),
  };
}
