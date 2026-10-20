export function yieldToBrowserPaint({ signal } = {}) {
  return new Promise((resolve, reject) => {
    let frameId = null;
    let taskId = null;
    let fallbackId = null;
    let settled = false;
    function finish(error) {
      if (settled) return;
      settled = true;
      if (frameId !== null) globalThis.cancelAnimationFrame?.(frameId);
      clearTimeout(taskId);
      clearTimeout(fallbackId);
      signal?.removeEventListener('abort', abort);
      if (error) reject(error);
      else resolve();
    }
    function abort() {
      finish(signal.reason || new Error('Loading was cancelled.'));
    }
    if (signal?.aborted) { abort(); return; }
    signal?.addEventListener('abort', abort, { once: true });
    if (typeof globalThis.requestAnimationFrame !== 'function' ||
        globalThis.document?.visibilityState === 'hidden') {
      taskId = setTimeout(() => finish(), 0);
      return;
    }

    fallbackId = setTimeout(() => finish(), 100);
    frameId = globalThis.requestAnimationFrame(() => {
      taskId = setTimeout(() => finish(), 0);
    });
  });
}
