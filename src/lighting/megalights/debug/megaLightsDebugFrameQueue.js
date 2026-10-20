export function createMegaLightsDebugFrameQueue({
  requestRender,
  deadlineMs = 15000,
}) {
  const pending = new Set();
  let disposed = false;

  function waitForFrame(read, signal) {
    return new Promise((resolve, reject) => {
      if (disposed || signal?.aborted) {
        reject(new DOMException("Diagnostic run cancelled", "AbortError"));
        return;
      }
      let timer;
      const entry = { read, finish };
      const abort = () =>
        finish(new DOMException("Diagnostic run cancelled", "AbortError"));
      function finish(error, result) {
        if (!pending.delete(entry)) return;
        clearTimeout(timer);
        signal?.removeEventListener("abort", abort);
        if (error) reject(error);
        else resolve(result);
      }
      pending.add(entry);
      signal?.addEventListener("abort", abort, { once: true });
      timer = setTimeout(
        () =>
          finish(
            new DOMException(
              "No engine post-render frame arrived; no image was fabricated",
              "TimeoutError",
            ),
          ),
        deadlineMs,
      );
      requestRender?.();
    });
  }

  return {
    waitForFrame,
    afterRender(packet) {
      if (disposed) return;
      for (const entry of Array.from(pending)) {
        try {
          entry.finish(null, entry.read(packet));
        } catch (error) {
          entry.finish(error);
        }
      }
    },
    pendingCount: () => pending.size,
    dispose() {
      disposed = true;
      for (const entry of Array.from(pending))
        entry.finish(
          new DOMException("Diagnostic session closed", "AbortError"),
        );
    },
  };
}
