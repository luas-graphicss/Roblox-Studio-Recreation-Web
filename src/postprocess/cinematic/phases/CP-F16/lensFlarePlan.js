import { isLensFlareActive } from "./lensFlareSettings.js";
import { HALO_SAMPLES } from "./lensFlareContract.js";

export function createLensFlarePlan(width, height, settings, maximumTextureSize) {
  if (![width, height, maximumTextureSize].every((value) => Number.isInteger(value) && value > 0) || width > maximumTextureSize || height > maximumTextureSize) throw new RangeError("Invalid lens flare extent or device texture limit");
  const active = isLensFlareActive(settings);
  const workingWidth = active ? Math.ceil(width / settings.resolutionDivisor) : 1;
  const workingHeight = active ? Math.ceil(height / settings.resolutionDivisor) : 1;
  const pixelCount = width * height;
  const workingPixels = workingWidth * workingHeight;
  const bokehPixels = settings.bokehShape.width * settings.bokehShape.height;
  const ghostWeight = settings.ghosts.reduce((sum, ghost) => sum + ghost.weight, 0);
  return Object.freeze({
    active, width, height, workingWidth, workingHeight,
    bokehRadiusPixels: width * settings.bokehSizePercent / 200,
    haloRadiusPixels: width * settings.haloRadiusPercent / 100,
    featureNormalization: 1 / Math.max(ghostWeight + settings.haloIntensity, 1),
    targetBytes: active ? pixelCount * 20 + workingPixels * 24 + bokehPixels * 8 : pixelCount * 12 + 8,
    workingTargetCount: active ? 3 : 0,
    drawCalls: active ? 6 : 3,
    assetUploadDraws: active ? 1 : 0,
    maximumBokehTaps: bokehPixels,
    maximumFeatureSamples: settings.ghosts.length * 3 + (settings.haloIntensity > 0 ? HALO_SAMPLES * 3 : 0),
    accounting: "declared-target-bytes-per-view-including-shared-bokeh",
    boundaryPolicy: "zero-extension-no-wrap",
    resolutionPolicy: settings.resolutionDivisor === 1 ? "full-resolution" : "explicit-area-reduction",
    timingCertification: "not-production-timing"
  });
}
