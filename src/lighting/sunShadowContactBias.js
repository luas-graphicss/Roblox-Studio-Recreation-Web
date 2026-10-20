export const ZERO_CONTACT_GAP_NORMAL_BIAS = 0;


export function sunShadowContactNormalBias({
  receiverPlaneBiasPerTapKernel = false,
  singleBiasedDepthEdgeKernel = false,
  fittedNormalBias = 0,
} = {}) {
  const antiAcneIsPaidInDepthSpace = receiverPlaneBiasPerTapKernel || singleBiasedDepthEdgeKernel;
  if (antiAcneIsPaidInDepthSpace) return ZERO_CONTACT_GAP_NORMAL_BIAS;
  const fitted = Number(fittedNormalBias);
  return Number.isFinite(fitted) && fitted > 0 ? fitted : ZERO_CONTACT_GAP_NORMAL_BIAS;
}


export function contactGapFromNormalOffset(normalOffsetStuds, normalDotLight) {
  const offset = Number(normalOffsetStuds);
  const cosine = Number(normalDotLight);
  if (!Number.isFinite(offset) || !Number.isFinite(cosine)) return 0;
  const clampedCosine = Math.min(1, Math.max(-1, cosine));
  const sine = Math.sqrt(1 - clampedCosine * clampedCosine);
  return Math.abs(offset) * sine;
}
