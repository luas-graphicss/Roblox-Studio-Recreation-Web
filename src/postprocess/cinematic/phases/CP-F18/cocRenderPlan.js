import { COC_LIMITS } from "./cocContract.js";
import { requirePixelSize, requirePositiveGpuFloat } from "./cocValidation.js";
import { resolveCocCamera } from "./cocCamera.js";

export function createCocRenderPlan(frame, cameraState, settings) {
  const renderSize = requirePixelSize(frame.renderSize, "renderSize");
  const outputSize = requirePixelSize(frame.outputSize, "outputSize");
  const camera = resolveCocCamera(cameraState);
  const crop = settings.outputCropUv ?? camera.outputCropUv;
  const outputPerRenderPixel = [outputSize.width / (renderSize.width * crop.width), outputSize.height / (renderSize.height * crop.height)];
  const renderPixelsPerSensorMm = [renderSize.width / (camera.activeWidthMm * camera.overscan * camera.squeezeFactor), renderSize.height / (camera.activeHeightMm * camera.overscan)];
  const outputPixelsPerSensorMm = renderPixelsPerSensorMm.map((value, axis) => value * outputPerRenderPixel[axis]);
  for (const value of [...outputPerRenderPixel, ...renderPixelsPerSensorMm, ...outputPixelsPerSensorMm]) requirePositiveGpuFloat(value, "CoC pixel scale");
  const maxOutputPixelsPerSensorMm = Math.max(...outputPixelsPerSensorMm);
  const renderRadiusPerOutputRadius = outputPixelsPerSensorMm.map((value, axis) => value / maxOutputPixelsPerSensorMm / outputPerRenderPixel[axis]);
  const reducedSize = Object.freeze({ width: Math.ceil(renderSize.width / settings.downsampleFactor), height: Math.ceil(renderSize.height / settings.downsampleFactor) });
  const tileExtent = settings.downsampleFactor * settings.tileSize;
  const tileGridSize = Object.freeze({ width: Math.ceil(reducedSize.width / settings.tileSize), height: Math.ceil(reducedSize.height / settings.tileSize) });
  const maxRenderRadius = Math.max(...outputPerRenderPixel.map((scale) => settings.maxRadiusOutputPixels / scale));
  const dilationReach = settings.maxRadiusOutputPixels === 0 ? 0 : Math.ceil(maxRenderRadius / tileExtent) + 1;
  if (maxRenderRadius > 32752) throw new RangeError("CoC render radius exceeds the declared FP16-safe range");
  if (dilationReach > COC_LIMITS.maxDilationTiles) throw new RangeError("CoC dilation exceeds its explicit tile-search budget; reduce the radius or increase tileSize");
  const estimatedTargetBytes = 8 * (renderSize.width * renderSize.height + 4 * reducedSize.width * reducedSize.height + 3 * tileGridSize.width * tileGridSize.height);
  return Object.freeze({
    settings, camera, optics: camera.optics, renderSize, outputSize, reducedSize, tileGridSize, crop,
    maxOutputPixelsPerSensorMm,
    renderRadiusPerOutputRadius: Object.freeze(renderRadiusPerOutputRadius),
    renderPixelsPerSensorMm: Object.freeze(renderPixelsPerSensorMm),
    outputPixelsPerSensorMm: Object.freeze(outputPixelsPerSensorMm),
    outputPerRenderPixel: Object.freeze(outputPerRenderPixel),
    tileExtentRenderPixels: tileExtent,
    dilationReach,
    estimatedTargetBytes,
    drawCount: 8,
    radiusUnits: "render-pixels",
    radiusConvention: "radius-not-diameter; negative-near-positive-far",
    anamorphicPolicy: "horizontal-radius-divided-by-squeeze-once; diaphragm-must-not-repeat",
    temporalPolicy: "stateless-current-frame; CP-F20-owns-history",
    referenceVerified: false
  });
}
