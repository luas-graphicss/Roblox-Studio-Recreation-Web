import { ensureViewportStarted } from '../viewport/viewportStartup.js';

export async function warmUpRenderEngine(options = {}) {
  options.signal?.throwIfAborted();
  const viewport = await ensureViewportStarted({
    reportProgress: (progress) => options.reportProgress?.(progress * 0.75),
  });
  options.signal?.throwIfAborted();

  if (!viewport) return Object.freeze({ isThreeJsReady: false, isViewportStageReady: false });
  options.reportProgress?.(0.75);
  await viewport.prepareForDisplay({
    ...options,
    reportProgress: (progress) => options.reportProgress?.(0.75 + progress * 0.25),
  });
  return Object.freeze({ isThreeJsReady: true, isViewportStageReady: true });
}
