import { throwIfAborted } from "./captureValidation.js";

export function createAsyncPixelReadback(adapter) {
  const gl = adapter?.context;
  if (!gl || typeof gl.fenceSync !== "function" || !adapter.renderer?.setRenderTarget) throw new Error("Capture requires a WebGL2 adapter with explicit render-target binding");
  const pending = new Set();
  let disposed = false;
  let peakBytes = 0;
  let currentBytes = 0;
  function start(source) {
    if (disposed || gl.isContextLost()) throw new Error("Capture GPU context is unavailable");
    if (!source?.target || source.target.texture !== source.texture) throw new Error("Capture source must expose its real render target");
    if (!["rgba8", "rgba16f", "rgba32f"].includes(source.format)) throw new Error("Capture only reads explicit RGBA formats");
    if (pending.size) throw new Error("Capture permits one in-flight readback for bounded memory");
    const byteFormat = source.format === "rgba8";
    const length = source.width * source.height * 4;
    const byteLength = length * (byteFormat ? 1 : 4);
    const previousTarget = adapter.renderer.getRenderTarget();
    const previousReadFramebuffer = gl.getParameter(gl.READ_FRAMEBUFFER_BINDING);
    const previousDrawFramebuffer = gl.getParameter(gl.DRAW_FRAMEBUFFER_BINDING);
    const previousReadBuffer = gl.getParameter(gl.READ_BUFFER);
    const previousViewport = gl.getParameter(gl.VIEWPORT);
    const previousBuffer = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
    const previousAlignment = gl.getParameter(gl.PACK_ALIGNMENT);
    const previousRowLength = gl.getParameter(gl.PACK_ROW_LENGTH);
    const previousSkipPixels = gl.getParameter(gl.PACK_SKIP_PIXELS);
    const previousSkipRows = gl.getParameter(gl.PACK_SKIP_ROWS);
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error("Unable to allocate capture transfer buffer");
    let fence;
    let targetReadBuffer;
    try {
      adapter.renderer.setRenderTarget(source.target);
      targetReadBuffer = gl.getParameter(gl.READ_BUFFER);
      if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error("Capture framebuffer is incomplete");
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, byteLength, gl.STREAM_READ);
      gl.pixelStorei(gl.PACK_ALIGNMENT, 1);
      gl.pixelStorei(gl.PACK_ROW_LENGTH, 0);
      gl.pixelStorei(gl.PACK_SKIP_PIXELS, 0);
      gl.pixelStorei(gl.PACK_SKIP_ROWS, 0);
      gl.readBuffer(gl.COLOR_ATTACHMENT0);
      gl.readPixels(0, 0, source.width, source.height, gl.RGBA, byteFormat ? gl.UNSIGNED_BYTE : gl.FLOAT, 0);
      fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
      if (!fence || gl.getError() !== gl.NO_ERROR) throw new Error("Capture asynchronous GPU readback submission failed");
      gl.flush();
    } catch (error) {
      gl.deleteBuffer(buffer);
      if (fence) gl.deleteSync(fence);
      throw error;
    } finally {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, previousBuffer);
      gl.pixelStorei(gl.PACK_ALIGNMENT, previousAlignment);
      gl.pixelStorei(gl.PACK_ROW_LENGTH, previousRowLength);
      gl.pixelStorei(gl.PACK_SKIP_PIXELS, previousSkipPixels);
      gl.pixelStorei(gl.PACK_SKIP_ROWS, previousSkipRows);
      if (targetReadBuffer !== undefined) gl.readBuffer(targetReadBuffer);
      adapter.renderer.setRenderTarget(previousTarget);
      gl.bindFramebuffer(gl.READ_FRAMEBUFFER, previousReadFramebuffer);
      gl.readBuffer(previousReadBuffer);
      gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, previousDrawFramebuffer);
      gl.viewport(...previousViewport);
    }
    let released = false;
    let consumed = false;
    const ticket = {
      cancel() {
        if (released) return;
        released = true;
        pending.delete(ticket);
        currentBytes -= byteLength;
        gl.deleteSync(fence);
        gl.deleteBuffer(buffer);
      },
      async read({ signal, timeoutMilliseconds = 10000, yieldControl = () => new Promise((resolve) => setTimeout(resolve, 0)) } = {}) {
        if (consumed || released) throw new Error("Capture readback was already consumed or released");
        if (!Number.isFinite(timeoutMilliseconds) || timeoutMilliseconds < 1 || timeoutMilliseconds > 60000) { ticket.cancel(); throw new RangeError("Capture readback timeout must be within 1..60000 ms"); }
        consumed = true;
        const started = performance.now();
        try {
          while (true) {
            throwIfAborted(signal);
            if (released || disposed || gl.isContextLost()) throw new Error("Capture device lost or readback disposed");
            const result = gl.clientWaitSync(fence, 0, 0);
            if (result === gl.WAIT_FAILED) throw new Error("Capture GPU fence failed");
            if (result === gl.ALREADY_SIGNALED || result === gl.CONDITION_SATISFIED) break;
            if (performance.now() - started > timeoutMilliseconds) throw new Error("Capture GPU readback timed out");
            await yieldControl();
          }
          const raw = byteFormat ? new Uint8Array(length) : new Float32Array(length);
          const saved = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
          try {
            gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
            gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, raw);
            if (gl.getError() !== gl.NO_ERROR) throw new Error("Capture GPU transfer failed");
          } finally { gl.bindBuffer(gl.PIXEL_PACK_BUFFER, saved); }
          return byteFormat ? Float32Array.from(raw, (value) => value / 255) : raw;
        } finally { ticket.cancel(); }
      }
    };
    pending.add(ticket);
    currentBytes += byteLength;
    peakBytes = Math.max(peakBytes, currentBytes);
    return Object.freeze(ticket);
  }
  return Object.freeze({ start, stats: () => ({ liveTransfers: pending.size, currentBytes, peakBytes, blockingReadPixels: false }), dispose() { if (disposed) return; disposed = true; for (const ticket of [...pending]) ticket.cancel(); } });
}
