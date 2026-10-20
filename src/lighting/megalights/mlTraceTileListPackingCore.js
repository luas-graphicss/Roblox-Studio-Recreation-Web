import { MGL_BUFFER_LAYOUTS } from "./mlBufferLayouts.js";

export const FLOATS_PER_TRACE_TILE = 4;


export const TRACE_TILE_LIST_ROW_WIDTH = 256;

const FALLBACK_CHANNEL_ORDER = ["tileX", "tileY", "tileClassIndex", "sampleCount"];

function channelOrderFromContract() {
  const layout = MGL_BUFFER_LAYOUTS && MGL_BUFFER_LAYOUTS.traceTileList;
  const texel = layout && Array.isArray(layout.texels) ? layout.texels[0] : null;
  if (!texel) return FALLBACK_CHANNEL_ORDER.slice();
  const order = ["r", "g", "b", "a"]
    .map((channel) => texel[channel])
    .filter((channelName) => typeof channelName === "string");
  return order.length === FLOATS_PER_TRACE_TILE ? order : FALLBACK_CHANNEL_ORDER.slice();
}

export const TRACE_TILE_LIST_CHANNEL_ORDER = Object.freeze(channelOrderFromContract());


export function traceTileListTextureSize(tileCount, rowWidth) {
  const width = Math.max(1, Math.floor(Number(rowWidth) || TRACE_TILE_LIST_ROW_WIDTH));
  const count = Math.max(0, Math.floor(Number(tileCount) || 0));
  const height = Math.max(1, Math.ceil(count / width));
  const texelCount = width * height;
  return { width, height, texelCount, floatCount: texelCount * FLOATS_PER_TRACE_TILE };
}


export function packTraceTileList(tiles, textureSize) {
  const list = Array.isArray(tiles) ? tiles : [];
  const size = textureSize && textureSize.floatCount ? textureSize : traceTileListTextureSize(list.length);
  const data = new Float32Array(size.floatCount);
  const writtenCount = Math.min(list.length, size.texelCount);

  for (let position = 0; position < writtenCount; position++) {
    const tile = list[position] || {};
    const base = position * FLOATS_PER_TRACE_TILE;
    for (let channel = 0; channel < TRACE_TILE_LIST_CHANNEL_ORDER.length; channel++) {
      data[base + channel] = Number(tile[TRACE_TILE_LIST_CHANNEL_ORDER[channel]]) || 0;
    }
  }

  return {
    data,
    width: size.width,
    height: size.height,
    tileCount: writtenCount,
    capacity: size.texelCount,
    droppedTileCount: list.length - writtenCount,
    channelOrder: TRACE_TILE_LIST_CHANNEL_ORDER,
  };
}


export function unpackTraceTileList(data, tileCount) {
  const floats = data || [];
  const available = Math.floor((floats.length || 0) / FLOATS_PER_TRACE_TILE);
  const count = Math.min(Math.max(0, Math.floor(Number(tileCount) || 0)), available);
  const tiles = [];
  for (let position = 0; position < count; position++) {
    const base = position * FLOATS_PER_TRACE_TILE;
    const tile = {};
    for (let channel = 0; channel < TRACE_TILE_LIST_CHANNEL_ORDER.length; channel++) {
      tile[TRACE_TILE_LIST_CHANNEL_ORDER[channel]] = floats[base + channel];
    }
    tiles.push(tile);
  }
  return tiles;
}

export function traceTileListMemoryReport(packed) {
  const capacity = Math.max(1, Number(packed && packed.capacity) || 1);
  const tileCount = Math.max(0, Number(packed && packed.tileCount) || 0);
  return {
    tileCount,
    capacity,
    bytes: capacity * FLOATS_PER_TRACE_TILE * 4,
    occupancyRatio: tileCount / capacity,
    droppedTileCount: Math.max(0, Number(packed && packed.droppedTileCount) || 0),
  };
}
