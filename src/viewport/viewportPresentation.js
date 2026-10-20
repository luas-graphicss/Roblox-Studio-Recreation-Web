import { yieldToBrowserPaint } from '../boot/browserPaint.js';

export async function waitForViewportPresentation({
  requestRender,
  readFrameCount,
  isPreparing = () => false,
  isUnavailable = () => false,
  readPreparationError = () => null,
  readPreparationProgress = () => 0,
  waitForPaint = yieldToBrowserPaint,
  now = () => globalThis.performance?.now() ?? Date.now(),
  timeoutMs = 90000,
  requiredFrames = 2,
  signal,
  reportProgress = () => {},
} = {}) {
  if (typeof requestRender !== 'function' || typeof readFrameCount !== 'function') {
    throw new TypeError('Viewport presentation requires a render request and frame counter.');
  }
  const startedAt = now();
  let settledFrameCount = readFrameCount();
  let highestProgress = 0;
  function publishProgress(progress) {
    if (!Number.isFinite(progress)) return;
    highestProgress = Math.max(highestProgress, Math.min(0.99, Math.max(0, progress)));
    reportProgress(highestProgress);
  }
  for (;;) {
    signal?.throwIfAborted();
    const preparationError = readPreparationError();
    if (preparationError) throw preparationError;
    if (isUnavailable()) throw new Error('The graphics context is unavailable.');
    if (now() - startedAt >= timeoutMs) {
      throw new Error('The viewport did not present a ready frame before the loading deadline.');
    }
    if (isPreparing()) {
      settledFrameCount = readFrameCount();
      publishProgress(Math.min(1, Math.max(0, readPreparationProgress())) * 0.9);
    } else {
      const framesPresented = Math.max(0, readFrameCount() - settledFrameCount);
      if (framesPresented >= requiredFrames) {
        reportProgress(1);
        return true;
      }
      publishProgress(0.9 + 0.1 * framesPresented / requiredFrames);
    }
    requestRender();
    await waitForPaint({ signal });
  }
}
