export function createGpuTimerQuery(
  gl,
  { maximumPending = 128, maximumSamples = 4096 } = {},
) {
  if (
    !gl?.getExtension ||
    !Number.isInteger(maximumPending) ||
    maximumPending < 1 ||
    !Number.isInteger(maximumSamples) ||
    maximumSamples < 1
  )
    throw new TypeError("Invalid GPU timer configuration");
  const extension = gl.getExtension("EXT_disjoint_timer_query_webgl2");
  const pending = [];
  const samples = [];
  let current = null;
  let disposed = false;
  let disjointSamples = 0;
  let rejectedSamples = 0;
  let droppedSamples = 0;
  function clearPending() {
    for (const record of pending.splice(0)) gl.deleteQuery(record.query);
  }
  return Object.freeze({
    begin(frameId) {
      if (disposed) throw new Error("GPU timer is disposed");
      if (!extension || gl.isContextLost()) return false;
      if (current) throw new Error("GPU timer query is already active");
      if (pending.length >= maximumPending) {
        rejectedSamples++;
        return false;
      }
      const query = gl.createQuery();
      if (!query) {
        rejectedSamples++;
        return false;
      }
      current = { query, frameId };
      gl.beginQuery(extension.TIME_ELAPSED_EXT, query);
      return true;
    },
    end() {
      if (!current) return;
      gl.endQuery(extension.TIME_ELAPSED_EXT);
      pending.push(current);
      current = null;
    },
    poll() {
      if (!extension || disposed) return [];
      if (gl.isContextLost() || gl.getParameter(extension.GPU_DISJOINT_EXT)) {
        disjointSamples += Math.max(
          1,
          pending.length + Number(Boolean(current)),
        );
        if (current) {
          if (!gl.isContextLost()) gl.endQuery(extension.TIME_ELAPSED_EXT);
          gl.deleteQuery(current.query);
          current = null;
        }
        clearPending();
        samples.length = 0;
        return [];
      }
      const available = [];
      while (
        pending.length &&
        gl.getQueryParameter(pending[0].query, gl.QUERY_RESULT_AVAILABLE)
      ) {
        const record = pending.shift();
        const elapsed = gl.getQueryParameter(record.query, gl.QUERY_RESULT);
        gl.deleteQuery(record.query);
        if (!Number.isFinite(elapsed) || elapsed < 0) {
          rejectedSamples++;
          continue;
        }
        const sample = {
          frameId: record.frameId,
          milliseconds: elapsed / 1000000,
        };
        if (samples.length === maximumSamples) {
          samples.shift();
          droppedSamples++;
        }
        samples.push(sample);
        available.push(sample);
      }
      return available;
    },
    snapshot: () => ({
      source: extension ? "EXT_disjoint_timer_query_webgl2" : null,
      available: Boolean(extension),
      pendingSamples: pending.length,
      disjointSamples,
      rejectedSamples,
      droppedSamples,
      samples: samples.map((sample) => ({ ...sample })),
    }),
    dispose() {
      if (disposed) return;
      if (current) {
        if (!gl.isContextLost()) gl.endQuery(extension.TIME_ELAPSED_EXT);
        gl.deleteQuery(current.query);
        current = null;
      }
      clearPending();
      disposed = true;
    },
  });
}
