export function installSubstrateSmQaSurface({ lightingQa, telemetry, captureFrame } = {}) {
  if (!lightingQa || typeof lightingQa !== 'object' || typeof telemetry?.getSnapshot !== 'function') {
    throw new TypeError('SSM_QA_SURFACE_INPUT_REQUIRED');
  }
  if ('substrateSm' in lightingQa) throw new Error('SSM_QA_SURFACE_ALREADY_INSTALLED');
  if (captureFrame !== undefined && typeof captureFrame !== 'function') throw new TypeError('SSM_QA_CAPTURE_CALLBACK_REQUIRED');
  let disposed = false;
  const unavailable = reason => Object.freeze({ ok: false, reason });
  const getSnapshot = () => disposed ? unavailable('SSM_QA_SURFACE_DISPOSED') : telemetry.getSnapshot();
  const surface = Object.freeze({ schemaVersion: 1, get: getSnapshot, getSnapshot,
    async capture(options = {}) {
      if (disposed) return unavailable('SSM_QA_SURFACE_DISPOSED');
      if (!captureFrame) return unavailable('SSM_QA_CAPTURE_UNAVAILABLE');
      return captureFrame(options);
    } });
  Object.defineProperty(lightingQa, 'substrateSm', { value: surface, enumerable: true, configurable: true, writable: false });
  return Object.freeze({ surface, dispose() {
    if (disposed) return true;
    if (Object.getOwnPropertyDescriptor(lightingQa, 'substrateSm')?.value !== surface) return false;
    delete lightingQa.substrateSm;
    disposed = true;
    return true;
  } });
}
