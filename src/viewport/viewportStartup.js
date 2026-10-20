let initializer = null;
let started = null;
let startupProgress = 0;
const progressListeners = new Set();

function publishProgress(progress) {
  if (!Number.isFinite(progress)) return;
  startupProgress = Math.max(startupProgress, Math.min(1, Math.max(0, progress)));
  for (const listener of progressListeners) {
    try { listener(startupProgress); } catch {                                 }
  }
}

export function registerViewportInitializer(initialize) {
  if (typeof initialize !== 'function') throw new TypeError('A viewport initializer is required.');
  initializer = initialize;
  started = null;
  startupProgress = 0;
  progressListeners.clear();
  return () => {
    if (initializer !== initialize) return;
    initializer = null;
    started = null;
    progressListeners.clear();
  };
}

export function ensureViewportStarted({ reportProgress } = {}) {
  if (!initializer) return Promise.reject(new Error('The viewport has not been mounted.'));
  if (typeof reportProgress === 'function') {
    progressListeners.add(reportProgress);
    try { reportProgress(startupProgress); } catch {                                 }
  }
  if (!started) {
    const initialize = initializer;
    started = Promise.resolve()
      .then(() => initialize({ reportProgress: publishProgress }))
      .then((viewport) => { publishProgress(1); return viewport; })
      .finally(() => progressListeners.clear());
  } else if (startupProgress === 1) {
    progressListeners.delete(reportProgress);
  }
  return started;
}
