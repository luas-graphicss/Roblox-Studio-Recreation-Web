export const VISIBLE_LIGHT_LIST_CHANNELS = Object.freeze({
  r: "lightIndex",
  g: "tileContributionWeight",
  b: "needsShadowTrace",
  a: "lightShapeIndex",
});

export const CHANNELS_PER_TEXEL = 4;
export const TEXELS_PER_GUIDED_LIGHT = 1;
export const EMPTY_LIGHT_INDEX = -1;
export const SHADOW_TRACE_REQUIRED = 1;
export const SHADOW_TRACE_NOT_REQUIRED = 0;

function normalizeGeometry(request) {
  const source = request || {};
  return {
    tileCountX: Math.max(1, Math.floor(Number(source.tileCountX) || 1)),
    tileCountY: Math.max(1, Math.floor(Number(source.tileCountY) || 1)),
    maxLightsPerTile: Math.max(1, Math.floor(Number(source.maxLightsPerTile) || 1)),
  };
}


export function visibleLightListTextureSize(geometry) {
  const grid = normalizeGeometry(geometry);
  const width = grid.tileCountX * grid.maxLightsPerTile;
  const height = grid.tileCountY;
  return {
    width,
    height,
    texelCount: width * height,
    floatCount: width * height * CHANNELS_PER_TEXEL,
  };
}

export function createVisibleLightListTexels(geometry) {
  const size = visibleLightListTextureSize(geometry);
  const texels = new Float32Array(size.floatCount);
  clearVisibleLightListTexels(texels);
  return texels;
}

export function clearVisibleLightListTexels(texels) {
  for (let offset = 0; offset < texels.length; offset += CHANNELS_PER_TEXEL) {
    texels[offset] = EMPTY_LIGHT_INDEX;
    texels[offset + 1] = 0;
    texels[offset + 2] = SHADOW_TRACE_NOT_REQUIRED;
    texels[offset + 3] = 0;
  }
  return texels;
}


export function slotTexelIndex(location) {
  const source = location || {};
  const tileCountX = Math.max(1, Math.floor(Number(source.tileCountX) || 1));
  const maxLightsPerTile = Math.max(1, Math.floor(Number(source.maxLightsPerTile) || 1));
  const tileX = Math.floor(Number(source.tileX));
  const tileY = Math.floor(Number(source.tileY));
  const slotIndex = Math.floor(Number(source.slotIndex));
  if (!(tileX >= 0) || !(tileY >= 0) || !(slotIndex >= 0)) return -1;
  if (tileX >= tileCountX || slotIndex >= maxLightsPerTile) return -1;
  const rowWidth = tileCountX * maxLightsPerTile;
  return tileY * rowWidth + tileX * maxLightsPerTile + slotIndex;
}


export function encodeVisibleLightLists(request) {
  const source = request || {};
  const geometry = normalizeGeometry(source);
  const destination = source.destination || createVisibleLightListTexels(geometry);
  const readTileList = typeof source.readTileList === "function" ? source.readTileList : null;

  let filledSlotCount = 0;
  let refusedEntryCount = 0;

  for (let tileY = 0; tileY < geometry.tileCountY; tileY++) {
    for (let tileX = 0; tileX < geometry.tileCountX; tileX++) {
      const entries = (readTileList ? readTileList(tileX, tileY) : null) || [];
      if (entries.length > geometry.maxLightsPerTile) {


        refusedEntryCount += entries.length - geometry.maxLightsPerTile;
      }
      for (let slotIndex = 0; slotIndex < geometry.maxLightsPerTile; slotIndex++) {
        const texelIndex = slotTexelIndex({
          tileX,
          tileY,
          slotIndex,
          tileCountX: geometry.tileCountX,
          maxLightsPerTile: geometry.maxLightsPerTile,
        });
        const offset = texelIndex * CHANNELS_PER_TEXEL;
        const entry = slotIndex < entries.length ? entries[slotIndex] : null;
        if (!entry) {
          destination[offset] = EMPTY_LIGHT_INDEX;
          destination[offset + 1] = 0;
          destination[offset + 2] = SHADOW_TRACE_NOT_REQUIRED;
          destination[offset + 3] = 0;
          continue;
        }
        destination[offset] = entry.lightIndex;
        destination[offset + 1] = entry.weight;
        destination[offset + 2] = entry.needsShadowTrace ? SHADOW_TRACE_REQUIRED : SHADOW_TRACE_NOT_REQUIRED;
        destination[offset + 3] = entry.shapeIndex || 0;
        filledSlotCount++;
      }
    }
  }

  return { destination, geometry, filledSlotCount, refusedEntryCount };
}


export function decodeVisibleLightList(request) {
  const source = request || {};
  const geometry = normalizeGeometry(source);
  const texels = source.texels;
  const entries = [];
  if (!texels) return entries;
  for (let slotIndex = 0; slotIndex < geometry.maxLightsPerTile; slotIndex++) {
    const texelIndex = slotTexelIndex({
      tileX: source.tileX,
      tileY: source.tileY,
      slotIndex,
      tileCountX: geometry.tileCountX,
      maxLightsPerTile: geometry.maxLightsPerTile,
    });
    if (texelIndex < 0) continue;
    const offset = texelIndex * CHANNELS_PER_TEXEL;
    const lightIndex = texels[offset];
    if (!(lightIndex >= 0)) continue;
    entries.push({
      lightIndex,
      weight: texels[offset + 1],
      needsShadowTrace: texels[offset + 2] >= SHADOW_TRACE_REQUIRED,
      shapeIndex: texels[offset + 3],
    });
  }
  return entries;
}
