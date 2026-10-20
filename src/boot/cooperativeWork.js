import { yieldToBrowserPaint } from './browserPaint.js';

export async function runCooperativeWork(iterator, {
  budgetMs = 4,
  maxStepsPerSlice = 16,
  waitForPaint = yieldToBrowserPaint,
  now = () => globalThis.performance?.now() ?? Date.now(),
  signal,
  reportProgress = () => {},
} = {}) {
  if (!iterator || typeof iterator.next !== 'function') {
    throw new TypeError('Cooperative work requires an iterator.');
  }
  const sliceBudgetMs = Number.isFinite(budgetMs) && budgetMs > 0 ? budgetMs : 4;
  const stepLimit = Number.isFinite(maxStepsPerSlice) && maxStepsPerSlice > 0
    ? Math.max(1, Math.floor(maxStepsPerSlice)) : 16;
  try {
    for (;;) {
      signal?.throwIfAborted();
      const startedAt = now();
      let steps = 0;
      do {
        signal?.throwIfAborted();
        const result = iterator.next();
        if (result.done) return result.value;
        if (Number.isFinite(result.value)) reportProgress(result.value);
        steps += 1;
      } while (steps < stepLimit && now() - startedAt < sliceBudgetMs);
      await waitForPaint({ signal });
    }
  } finally {
    iterator.return?.();
  }
}
