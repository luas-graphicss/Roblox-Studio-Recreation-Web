export function bindDeviceEvents(target, device, report = () => {}) {
  if (!target?.addEventListener || !target?.removeEventListener)
    return Object.freeze({ attached: false, dispose() {} });
  let disposed = false;
  const lost = (event) => {
    if (disposed) return;
    event.preventDefault();
    try {
      device.lose();
    } catch (error) {
      report({ phase: "CP-F32", type: "device-cleanup-failed", message: error.message });
    }
  };
  const restored = () => {
    if (disposed) return;
    try {
      device.restore();
    } catch (error) {
      report({ phase: "CP-F32", type: "device-restore-failed", message: error.message });
    }
  };
  target.addEventListener("webglcontextlost", lost);
  try {
    target.addEventListener("webglcontextrestored", restored);
  } catch (error) {
    target.removeEventListener("webglcontextlost", lost);
    throw error;
  }
  return Object.freeze({
    attached: true,
    dispose() {
      if (disposed) return;
      disposed = true;
      target.removeEventListener("webglcontextlost", lost);
      target.removeEventListener("webglcontextrestored", restored);
    }
  });
}
