export const DEFAULT_MINIMUM_TILE_ENERGY = 1e-4;
export const DEFAULT_MAX_TILES_PER_LIGHT = 4096;

export const CONTRIBUTION_SOURCE = Object.freeze({
  lightSampleBuffer: "lightSampleGeneration",
  screenFootprintEstimate: "screenFootprintEstimate",
  none: "none",
});

function tileCentrePixel(tileIndex, tileSize) {
  return tileIndex * tileSize + tileSize * 0.5;
}


export function estimateTileContributions(request) {
  const source = request || {};
  const screenLights = Array.isArray(source.screenLights) ? source.screenLights : [];
  const tileSize = Math.max(1, Math.floor(Number(source.tileSize) || 8));
  const tileCountX = Math.max(1, Math.floor(Number(source.tileCountX) || 1));
  const tileCountY = Math.max(1, Math.floor(Number(source.tileCountY) || 1));
  const minimumTileEnergy =
    source.minimumTileEnergy === undefined ? DEFAULT_MINIMUM_TILE_ENERGY : Number(source.minimumTileEnergy);
  const maximumTilesPerLight = Math.max(
    1,
    Math.floor(Number(source.maximumTilesPerLight) || DEFAULT_MAX_TILES_PER_LIGHT),
  );

  const observations = [];
  let clampedLightCount = 0;
  let skippedLightCount = 0;

  screenLights.forEach((light) => {
    const energy = Number(light && light.energy);
    const screenRadius = Number(light && light.screenRadius);
    const lightIndex = Math.floor(Number(light && light.lightIndex));
    if (!(lightIndex >= 0) || !isFinite(energy) || !(energy > 0) || !isFinite(screenRadius) || !(screenRadius > 0)) {
      skippedLightCount++;
      return;
    }

    const firstTileX = Math.max(0, Math.floor((light.screenX - screenRadius) / tileSize));
    const lastTileX = Math.min(tileCountX - 1, Math.floor((light.screenX + screenRadius) / tileSize));
    const firstTileY = Math.max(0, Math.floor((light.screenY - screenRadius) / tileSize));
    const lastTileY = Math.min(tileCountY - 1, Math.floor((light.screenY + screenRadius) / tileSize));
    if (lastTileX < firstTileX || lastTileY < firstTileY) {
      skippedLightCount++;
      return;
    }

    const tilesInFootprint = (lastTileX - firstTileX + 1) * (lastTileY - firstTileY + 1);


    const tileStride = tilesInFootprint > maximumTilesPerLight
      ? Math.ceil(Math.sqrt(tilesInFootprint / maximumTilesPerLight))
      : 1;
    if (tileStride > 1) clampedLightCount++;

    for (let tileY = firstTileY; tileY <= lastTileY; tileY += tileStride) {
      for (let tileX = firstTileX; tileX <= lastTileX; tileX += tileStride) {
        const distanceX = tileCentrePixel(tileX, tileSize) - light.screenX;
        const distanceY = tileCentrePixel(tileY, tileSize) - light.screenY;
        const normalizedDistance = Math.sqrt(distanceX * distanceX + distanceY * distanceY) / screenRadius;
        if (normalizedDistance >= 1) continue;
        const falloff = (1 - normalizedDistance) * (1 - normalizedDistance);
        const tileEnergy = energy * falloff;
        if (tileEnergy < minimumTileEnergy) continue;
        observations.push({
          tileX,
          tileY,
          lightIndex,
          energy: tileEnergy,
          needsShadowTrace: !!light.needsShadowTrace,
          shapeIndex: Math.max(0, Math.floor(Number(light.shapeIndex) || 0)),
        });
      }
    }
  });

  return { observations, clampedLightCount, skippedLightCount };
}
