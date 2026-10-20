import { MSM_NEW_VRAM_CEILING_BYTES } from "./msmPipelineContract.js";

export const MSM_SCREEN_TARGET_BYTES_PER_PIXEL = 8;

export function resolveMsmScreenTargetBudget(request = {}) {
  const width = Math.floor(Number(request.width));
  const height = Math.floor(Number(request.height));
  const fixedBytes = Number(request.fixedBytes);
  const preferredDivisor = Math.floor(Number(request.preferredDivisor));
  const refused = { fits: false, width: 0, height: 0, divisor: 0, pixelCount: 0,
    newVramBytes: 0, ceilingBytes: MSM_NEW_VRAM_CEILING_BYTES, mode: "screen-only" };
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 1 || height < 1
      || !Number.isFinite(fixedBytes) || fixedBytes < 0 || ![2, 4].includes(preferredDivisor)) {
    return { ...refused, reason: "invalid-screen-target-budget-input" };
  }
  const availableBytes = MSM_NEW_VRAM_CEILING_BYTES - fixedBytes;
  if (availableBytes < MSM_SCREEN_TARGET_BYTES_PER_PIXEL) {
    return { ...refused, reason: "resident-textures-exhaust-budget" };
  }
  let divisor = preferredDivisor;
  let reducedWidth = Math.max(1, Math.floor(width / divisor));
  let reducedHeight = Math.max(1, Math.floor(height / divisor));


  while (reducedWidth * reducedHeight * MSM_SCREEN_TARGET_BYTES_PER_PIXEL > availableBytes) {
    divisor *= 2;
    reducedWidth = Math.max(1, Math.floor(width / divisor));
    reducedHeight = Math.max(1, Math.floor(height / divisor));
  }
  const pixelCount = reducedWidth * reducedHeight;
  return { fits: true, width: reducedWidth, height: reducedHeight, divisor, pixelCount,
    newVramBytes: fixedBytes + pixelCount * MSM_SCREEN_TARGET_BYTES_PER_PIXEL,
    ceilingBytes: MSM_NEW_VRAM_CEILING_BYTES, mode: "screen-only",
    reason: divisor === preferredDivisor ? "preferred-divisor-fits" : "adaptive-screen-target-divisor" };
}
