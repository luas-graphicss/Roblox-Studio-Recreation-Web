import { resolveUpsampledPixel } from "./mlStochasticUpsampleCore.js";
import { downsampledResolution } from "./mlUpsampleNeighborhoodCore.js";
import { createUpsampleStats } from "./mlUpsampleStatsCore.js";
import { UPSAMPLE_TAP_SOURCE } from "./mlUpsampleFallbackCore.js";

function readRadianceTriple(value) {
  if (!value) return null;
  if (Array.isArray(value)) {
    if (!(value.length >= 3)) return null;
    return [Number(value[0]) || 0, Number(value[1]) || 0, Number(value[2]) || 0];
  }
  return [Number(value.r) || 0, Number(value.g) || 0, Number(value.b) || 0];
}


export function upsampleFrame(request) {
  const settings = request || {};
  const resolution = downsampledResolution({
    fullWidth: settings.fullWidth,
    fullHeight: settings.fullHeight,
    downsampleFactor: settings.downsampleFactor,
  });
  const fullWidth = resolution.fullWidth;
  const fullHeight = resolution.fullHeight;
  const stats = settings.stats || createUpsampleStats();
  const collectRadiance = settings.collectRadiance === true;
  const radiance = collectRadiance ? new Float32Array(fullWidth * fullHeight * 3) : null;

  const readCenterGeometry =
    typeof settings.readCenterGeometry === "function" ? settings.readCenterGeometry : () => null;
  const readTapGeometry = typeof settings.readTapGeometry === "function" ? settings.readTapGeometry : () => null;
  const readTapRadiance = typeof settings.readTapRadiance === "function" ? settings.readTapRadiance : () => null;
  const readHistory = typeof settings.readHistory === "function" ? settings.readHistory : () => null;
  const randomValueAt = typeof settings.randomValueAt === "function" ? settings.randomValueAt : () => 0.5;

  for (let pixelY = 0; pixelY !== fullHeight; pixelY++) {
    for (let pixelX = 0; pixelX !== fullWidth; pixelX++) {
      const centerGeometry = readCenterGeometry(pixelX, pixelY) || {};
      const history = readHistory(pixelX, pixelY) || null;
      const pixelResolution = resolveUpsampledPixel({
        pixelX,
        pixelY,
        downsampleFactor: resolution.downsampleFactor,
        downsampledWidth: resolution.width,
        downsampledHeight: resolution.height,
        centerDepth: centerGeometry.depth,
        centerNormal: centerGeometry.normal,
        readNeighborGeometry: readTapGeometry,
        randomValue: randomValueAt(pixelX, pixelY),
        history,
        edgeStopping: settings.edgeStopping,
      });
      stats.record(pixelResolution);

      if (!radiance) continue;
      const writeOffset = (pixelY * fullWidth + pixelX) * 3;
      let value = null;
      if (pixelResolution.source === UPSAMPLE_TAP_SOURCE.history) {
        value = readRadianceTriple(history ? history.radiance : null);
      } else if (pixelResolution.neighbor) {
        value = readRadianceTriple(readTapRadiance(pixelResolution.neighbor.x, pixelResolution.neighbor.y));
      }
      if (!value) continue;
      radiance[writeOffset] = value[0];
      radiance[writeOffset + 1] = value[1];
      radiance[writeOffset + 2] = value[2];
    }
  }

  return {
    fullWidth,
    fullHeight,
    downsampleFactor: resolution.downsampleFactor,
    downsampledWidth: resolution.width,
    downsampledHeight: resolution.height,
    radiance,
    stats: stats.snapshot(),
  };
}


export function radianceToCapture(frameResult) {
  const width = frameResult.fullWidth;
  const height = frameResult.fullHeight;
  const radiance = frameResult.radiance;
  const pixels = new Uint8ClampedArray(width * height * 4);
  if (!radiance) return { width, height, pixels };
  for (let pixelIndex = 0; pixelIndex !== width * height; pixelIndex++) {
    const readOffset = pixelIndex * 3;
    const writeOffset = pixelIndex * 4;
    pixels[writeOffset] = Math.round(Math.min(1, Math.max(0, radiance[readOffset])) * 255);
    pixels[writeOffset + 1] = Math.round(Math.min(1, Math.max(0, radiance[readOffset + 1])) * 255);
    pixels[writeOffset + 2] = Math.round(Math.min(1, Math.max(0, radiance[readOffset + 2])) * 255);
    pixels[writeOffset + 3] = 255;
  }
  return { width, height, pixels };
}
