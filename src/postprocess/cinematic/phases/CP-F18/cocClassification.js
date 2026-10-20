import { COC_FLAGS, COC_SAMPLE_STATUS } from "./cocContract.js";
import { requireNumber } from "./cocValidation.js";

export function classifyCocSample({ radiusX, radiusY, status, coverage, alpha = 1 }, plan) {
  if (status === COC_SAMPLE_STATUS.invalid || ![radiusX, radiusY, coverage, alpha].every(Number.isFinite) || coverage < 0 || coverage > 1 || alpha < 0 || alpha > 1) return COC_FLAGS.invalid;
  if (status === COC_SAMPLE_STATUS.excluded || alpha === 0) return 0;
  if (![COC_SAMPLE_STATUS.surface, COC_SAMPLE_STATUS.sky].includes(status)) return COC_FLAGS.invalid;
  const radiusOutput = Math.max(Math.abs(radiusX) * plan.outputPerRenderPixel[0], Math.abs(radiusY) * plan.outputPerRenderPixel[1]);
  let flags = status === COC_SAMPLE_STATUS.sky ? COC_FLAGS.sky : 0;
  if (radiusOutput <= plan.settings.focusThresholdOutputPixels) return flags | COC_FLAGS.focus;
  flags |= radiusOutput <= plan.settings.smallRadiusOutputPixels ? COC_FLAGS.small : COC_FLAGS.large;
  return flags | (radiusX < 0 || radiusY < 0 ? COC_FLAGS.near : COC_FLAGS.far);
}

export function tileInfluenceReaches(sourceTile, targetTile, radiusRenderPixels, tileExtentRenderPixels) {
  requireNumber(radiusRenderPixels, "radiusRenderPixels", 0);
  requireNumber(tileExtentRenderPixels, "tileExtentRenderPixels", Number.MIN_VALUE);
  if (radiusRenderPixels === 0) return sourceTile[0] === targetTile[0] && sourceTile[1] === targetTile[1];
  return sourceTile.every((coordinate, axis) => Math.max(0, Math.abs(coordinate - targetTile[axis]) - 1) * tileExtentRenderPixels <= radiusRenderPixels);
}
