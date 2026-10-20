import { throwIfAborted } from "./captureValidation.js";

export function createCaptureWorkerEncoder({ workerFactory = (url) => new Worker(url, { type: "module" }), timeoutMilliseconds = 60000 } = {}) {
  if (typeof workerFactory !== "function" || !Number.isFinite(timeoutMilliseconds) || timeoutMilliseconds < 1 || timeoutMilliseconds > 600000) throw new Error("Invalid capture worker configuration");
  let worker = null;
  let pending = null;
  let nextId = 0;
  let disposed = false;
  function cancel() {
    if (pending) { const error = new Error("Capture encoding cancelled"); error.name = "AbortError"; pending.reject(error); }
    worker?.terminate();
    worker = null;
  }
  return Object.freeze({
    encode(input, { signal } = {}) {
      if (disposed || pending) return Promise.reject(new Error("Capture encoder is disposed or busy"));
      throwIfAborted(signal);
      worker ??= workerFactory(new URL("./captureEncoderWorker.js", import.meta.url));
      const currentWorker = worker;
      const id = ++nextId;
      return new Promise((resolve, reject) => {
        let timer;
        const cleanup = () => {
          clearTimeout(timer);
          signal?.removeEventListener("abort", abort);
          currentWorker.removeEventListener("message", message);
          currentWorker.removeEventListener("error", error);
          pending = null;
        };
        const rejectAndCleanup = (reason) => { cleanup(); reject(reason); };
        const abort = () => cancel();
        const error = (event) => { rejectAndCleanup(new Error(event.message || "Capture encoder worker failed")); currentWorker.terminate(); worker = null; };
        const message = (event) => {
          if (event.data.id !== id) return;
          cleanup();
          if (event.data.error) reject(new Error(event.data.error));
          else resolve(event.data.encoded);
        };
        pending = { reject: rejectAndCleanup };
        currentWorker.addEventListener("message", message);
        currentWorker.addEventListener("error", error);
        signal?.addEventListener("abort", abort, { once: true });
        timer = setTimeout(() => { rejectAndCleanup(new Error("Capture encoding timed out")); currentWorker.terminate(); worker = null; }, timeoutMilliseconds);
        try { currentWorker.postMessage({ id, input }, [input.pixels.buffer]); }
        catch (reason) { rejectAndCleanup(reason); currentWorker.terminate(); worker = null; }
      });
    },
    cancel,
    dispose() { if (disposed) return; disposed = true; cancel(); },
    stats: () => ({ liveWorkers: worker ? 1 : 0, pending: pending ? 1 : 0 })
  });
}
