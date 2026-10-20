import { MGL_GUIDING_TILE_SIZE } from "./mlPipelineContract.js";

export const GUIDING_NEIGHBOUR_COUNT = 4;


export const GUIDING_NEIGHBOUR_OFFSETS = Object.freeze([
  Object.freeze({ offsetX: 0, offsetY: 0 }),
  Object.freeze({ offsetX: 1, offsetY: 0 }),
  Object.freeze({ offsetX: 0, offsetY: 1 }),
  Object.freeze({ offsetX: 1, offsetY: 1 }),
]);

function normalizeRequest(request) {
  const source = request || {};
  return {
    pixelX: Number(source.pixelX) || 0,
    pixelY: Number(source.pixelY) || 0,
    tileSize: Math.max(1, Math.floor(Number(source.tileSize) || MGL_GUIDING_TILE_SIZE)),
    tileCountX: Math.max(1, Math.floor(Number(source.tileCountX) || 1)),
    tileCountY: Math.max(1, Math.floor(Number(source.tileCountY) || 1)),
  };
}

function clampTileIndex(tileIndex, tileCount) {
  if (tileIndex < 0) return 0;
  if (tileIndex > tileCount - 1) return tileCount - 1;
  return tileIndex;
}


export function continuousTileCoordinate(pixelPosition, tileSize) {
  const size = Math.max(1, Math.floor(Number(tileSize) || MGL_GUIDING_TILE_SIZE));
  return (Number(pixelPosition) + 0.5) / size - 0.5;
}










export function bilinearTileNeighbourhood(request) {
  const input = normalizeRequest(request);
  const continuousX = continuousTileCoordinate(input.pixelX, input.tileSize);
  const continuousY = continuousTileCoordinate(input.pixelY, input.tileSize);
  const baseTileX = Math.floor(continuousX);
  const baseTileY = Math.floor(continuousY);
  const fractionX = continuousX - baseTileX;
  const fractionY = continuousY - baseTileY;

  const weights = [
    (1 - fractionX) * (1 - fractionY),
    fractionX * (1 - fractionY),
    (1 - fractionX) * fractionY,
    fractionX * fractionY,
  ];

  const mergedByTileKey = new Map();
  let weightSum = 0;
  for (let index = 0; index < GUIDING_NEIGHBOUR_COUNT; index++) {
    const weight = weights[index];
    if (!(weight > 0)) continue;
    const offsets = GUIDING_NEIGHBOUR_OFFSETS[index];
    const tileX = clampTileIndex(baseTileX + offsets.offsetX, input.tileCountX);
    const tileY = clampTileIndex(baseTileY + offsets.offsetY, input.tileCountY);
    const tileKey = tileY * input.tileCountX + tileX;
    const existing = mergedByTileKey.get(tileKey);
    if (existing) existing.weight += weight;
    else mergedByTileKey.set(tileKey, { tileX, tileY, weight });
    weightSum += weight;
  }

  const neighbours = Array.from(mergedByTileKey.values());
  if (weightSum > 0 && Math.abs(weightSum - 1) > 1e-12) {
    neighbours.forEach((neighbour) => {
      neighbour.weight /= weightSum;
    });
  }

  return { continuousX, continuousY, fractionX, fractionY, neighbours };
}


export function hardGuidingTile(request) {
  const input = normalizeRequest(request);
  return {
    tileX: clampTileIndex(Math.floor(input.pixelX / input.tileSize), input.tileCountX),
    tileY: clampTileIndex(Math.floor(input.pixelY / input.tileSize), input.tileCountY),
  };
}


export function selectGuidingTileStochastically(request) {
  const neighbourhood = bilinearTileNeighbourhood(request);
  const neighbours = neighbourhood.neighbours;
  const rawRandomValue = Number((request || {}).randomValue);


  const randomValue = isFinite(rawRandomValue) ? Math.min(0.9999999, Math.max(0, rawRandomValue)) : 0;

  let cumulativeWeight = 0;
  for (let index = 0; index < neighbours.length; index++) {
    cumulativeWeight += neighbours[index].weight;
    if (randomValue < cumulativeWeight || index === neighbours.length - 1) {
      return {
        tileX: neighbours[index].tileX,
        tileY: neighbours[index].tileY,
        weight: neighbours[index].weight,
        neighbourIndex: index,
        neighbours,
      };
    }
  }


  return { tileX: 0, tileY: 0, weight: 0, neighbourIndex: -1, neighbours };
}


export function expectedTileValue(request) {
  const source = request || {};
  const valueOfTile = typeof source.valueOfTile === "function" ? source.valueOfTile : null;
  if (!valueOfTile) return 0;
  const neighbourhood = bilinearTileNeighbourhood(source);
  let expectedValue = 0;
  neighbourhood.neighbours.forEach((neighbour) => {
    expectedValue += neighbour.weight * Number(valueOfTile(neighbour.tileX, neighbour.tileY) || 0);
  });
  return expectedValue;
}
