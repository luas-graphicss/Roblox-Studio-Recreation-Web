import { MSM_NEW_VRAM_CEILING_BYTES } from './msmPipelineContract.js';

export function mipPixelCount(width, height) {
  if (!Number.isSafeInteger(width) || !Number.isSafeInteger(height) || width < 1 || height < 1) return 0;
  let pixels = 0;
  do {
    pixels += width * height;
    if (width === 1 && height === 1) return pixels;
    width = Math.max(1, Math.floor(width / 2));
    height = Math.max(1, Math.floor(height / 2));
  } while (true);
}

export function resolveMsmRuntimeBudget(request = {}) {
  const fullWidth = Math.floor(request.width);
  const fullHeight = Math.floor(request.height);
  const fixedBytes = Number(request.fixedBytes);
  const signalBytes = 8;
  const momentBytes = request.webgl2 ? 4 : 8;
  const limit = MSM_NEW_VRAM_CEILING_BYTES;
  if (!Number.isSafeInteger(fullWidth) || !Number.isSafeInteger(fullHeight) ||
      !(fullWidth > 0) || !(fullHeight > 0) || !Number.isFinite(fixedBytes) || fixedBytes < 0) {
    return { fits: false, reason: 'invalid-runtime-budget' };
  }
  if (fixedBytes + signalBytes * 3 + momentBytes * 2 > limit) {
    return { fits: false, reason: 'resident-textures-exhaust-budget' };
  }
  let divisor = request.preferredDivisor >= 4 ? 4 : 2;
  while (true) {
    const width = Math.max(1, Math.ceil(fullWidth / divisor));
    const height = Math.max(1, Math.ceil(fullHeight / divisor));


    const signals = 3 * signalBytes * mipPixelCount(width, height);
    const moments = 2 * momentBytes * width * height;
    const newVramBytes = fixedBytes + signals + moments;
    if (newVramBytes <= limit) {
      return { fits: true, fullWidth, fullHeight, width, height, divisor,
        pixelCount: width * height, coverageCycleFrames: divisor * divisor,
        newVramBytes, fixedBytes, signalBytes: signals, momentBytes: moments,
        ceilingBytes: limit, reason: 'complete-pipeline-fits' };
    }
    divisor *= 2;
  }
}
