import { withRendererState } from "../../render/rendererState.js";
import { METERING_RESOURCES } from "./meteringLayout.js";

export function createAsyncMeteringReadback(adapter, maximumPending = 2) {
  if (!Number.isInteger(maximumPending) || maximumPending < 1 || maximumPending > 4) throw new RangeError("CP-F08 readback queue capacity must be 1..4");
  const { context: gl, renderer, THREE } = adapter;
  const pending = [];
  let disposed = false;
  const fields = [METERING_RESOURCES.exposure, METERING_RESOURCES.statistics, METERING_RESOURCES.histogram];

  function release(job) { if (job.sync) gl.deleteSync(job.sync); if (job.buffer) gl.deleteBuffer(job.buffer); }

  function enqueue(resources) {
    if (disposed) throw new Error("CP-F08 readback is disposed");
    if (gl.isContextLost()) throw new Error("CP-F08 readback context is lost");
    if (pending.length >= maximumPending) return { queued: false, reason: "queue-full" };
    const first = resources[fields[0]];
    for (const name of fields) {
      const resource = resources[name];
      if (!resource?.target || resource.format !== "r32f" || resource.frameId !== first?.frameId || resource.viewId !== first?.viewId || resource.generation !== first?.generation) throw new TypeError("CP-F08 readback requires matching metering resources");
    }
    const slices = fields.map((name) => ({ name, target: resources[name].target, length: resources[name].width * resources[name].height * 4 }));
    const totalLength = slices.reduce((sum, slice) => sum + slice.length, 0);
    const buffer = gl.createBuffer();
    if (!buffer) throw new Error("CP-F08 pixel pack buffer allocation failed");
    const job = { buffer, sync: null, slices, totalLength, frameId: first.frameId, viewId: first.viewId, generation: first.generation, provenance: first.provenance, metadata: resources[METERING_RESOURCES.metadata]?.value };
    const savedBuffer = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
    const packNames = [gl.PACK_ALIGNMENT, gl.PACK_ROW_LENGTH, gl.PACK_SKIP_PIXELS, gl.PACK_SKIP_ROWS];
    const packValues = packNames.map((name) => gl.getParameter(name));
    try {
      withRendererState(THREE, renderer, () => {
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, buffer);
        gl.bufferData(gl.PIXEL_PACK_BUFFER, totalLength * 4, gl.STREAM_READ);
        packNames.forEach((name, index) => gl.pixelStorei(name, index === 0 ? 4 : 0));
        let byteOffset = 0;
        for (const slice of slices) {
          renderer.setRenderTarget(slice.target);
          gl.readBuffer(gl.COLOR_ATTACHMENT0);
          gl.readPixels(0, 0, slice.target.width, slice.target.height, gl.RGBA, gl.FLOAT, byteOffset);
          byteOffset += slice.length * 4;
        }
        job.sync = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
        if (!job.sync) throw new Error("CP-F08 GPU fence creation failed");
        gl.flush();
      });
      pending.push(job);
      return { queued: true, frameId: job.frameId, viewId: job.viewId };
    } catch (error) { release(job); throw error; }
    finally {
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, savedBuffer);
      packNames.forEach((name, index) => gl.pixelStorei(name, packValues[index]));
    }
  }

  function poll() {
    if (disposed) throw new Error("CP-F08 readback is disposed");
    if (gl.isContextLost()) { for (const job of pending.splice(0)) release(job); throw new Error("CP-F08 readback context is lost"); }
    const job = pending[0];
    if (!job) return null;
    const waitResult = gl.clientWaitSync(job.sync, 0, 0);
    if (waitResult === gl.TIMEOUT_EXPIRED) return null;
    pending.shift();
    if (waitResult === gl.WAIT_FAILED) { release(job); throw new Error("CP-F08 GPU readback fence failed"); }
    const savedBuffer = gl.getParameter(gl.PIXEL_PACK_BUFFER_BINDING);
    try {
      const data = new Float32Array(job.totalLength);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, job.buffer);
      gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, data);
      let offset = 0;
      const values = {};
      for (const slice of job.slices) {
        values[slice.name] = Array.from({ length: slice.length / 4 }, (_, index) => data[offset + index * 4]);
        offset += slice.length;
      }
      return { frameId: job.frameId, viewId: job.viewId, generation: job.generation, provenance: job.provenance, metadata: job.metadata, values };
    } finally { gl.bindBuffer(gl.PIXEL_PACK_BUFFER, savedBuffer); release(job); }
  }

  return Object.freeze({ enqueue, poll, pendingCount: () => pending.length, dispose() { if (disposed) return; disposed = true; for (const job of pending.splice(0)) release(job); } });
}
