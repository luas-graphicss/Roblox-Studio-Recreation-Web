import { validateCaptureColor } from "./captureColor.js";
import { createAsyncPixelReadback } from "./asyncPixelReadback.js";

export function createCaptureEndpoint(adapter) {
  const readback = createAsyncPixelReadback(adapter);
  let request = null;
  let ticket = null;
  let result = null;
  let disposed = false;
  function reset() { ticket?.cancel(); ticket = null; request = null; result = null; }
  return Object.freeze({
    arm(next) {
      if (disposed || request || ticket) throw new Error("Capture endpoint is disposed or already armed");
      if (!next || ![next.frameId, next.generation].every((value) => Number.isSafeInteger(value) && value >= 0) || typeof next.viewId !== "string") throw new Error("Capture request needs explicit frame identity");
      if (![next.width, next.height].every((value) => Number.isSafeInteger(value) && value > 0)) throw new Error("Capture request needs valid pixel extents");
      if (next.referenceMode) throw new Error("CP-F29 BLOCKED_REFERENCE: no verified UE5.9 capture profile");
      if (!Number.isSafeInteger(next.maxBytes) || next.maxBytes < 1) throw new Error("Capture readback byte ceiling is required");
      request = Object.freeze({ ...next });
    },
    consume(source, frame) {
      if (!request) return Object.freeze({ status: "idle" });
      try {
        if (frame.referenceMode) throw new Error("CP-F29 BLOCKED_REFERENCE: no verified UE5.9 capture profile");
        for (const key of ["frameId", "viewId", "generation"]) if (frame[key] !== request[key] || source[key] !== frame[key]) throw new Error("Capture received a stale or cross-view frame");
        if (ticket) throw new Error("Duplicate capture submission");
        if (source.origin !== "bottom-left" || source.provenance !== "gpu") throw new Error("Capture requires current bottom-left GPU pixels");
        if (source.width !== request.width || source.height !== request.height) throw new Error("Capture tile extent mismatch");
        if (source.width * source.height * 16 > request.maxBytes) throw new Error("Capture readback exceeds declared byte ceiling");
        const color = validateCaptureColor(source.captureColor, source.captureColor?.domain === "display-encoded" ? "png" : "exr");
        ticket = readback.start(source);
        result = { color, width: source.width, height: source.height, frameId: frame.frameId, viewId: frame.viewId, generation: frame.generation, provenance: "gpu" };
        return Object.freeze({ status: "submitted", frameId: frame.frameId, bytes: source.width * source.height * 16 });
      } catch (error) { reset(); throw error; }
    },
    async collect(options) {
      if (!ticket || !result) throw new Error("Capture pass did not execute or its source was disconnected");
      const activeTicket = ticket;
      const metadata = result;
      try { return { ...metadata, pixels: await activeTicket.read(options) }; }
      finally { reset(); }
    },
    cancel: reset,
    stats: readback.stats,
    dispose() { if (disposed) return; disposed = true; reset(); readback.dispose(); }
  });
}
