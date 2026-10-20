export function createWarmupQueue({ now = () => performance.now(), maxPending = 128 } = {}) {
  if (typeof now !== "function" || !Number.isInteger(maxPending) || maxPending < 1)
    throw new TypeError("Invalid warmup queue configuration");
  const jobs = new Map();
  let disposed = false;
  let draining = false;
  let completed = 0;
  let failed = 0;
  let cancelled = 0;
  let lastSlice = null;
  function remove(id) {
    const job = jobs.get(id);
    if (!job) return null;
    jobs.delete(id);
    job.signal?.removeEventListener("abort", job.onAbort);
    return job;
  }
  function cancel(id) {
    if (!remove(id)) return false;
    cancelled += 1;
    return true;
  }
  return Object.freeze({
    enqueue(id, execute, { signal } = {}) {
      if (disposed) throw new Error("Warmup queue is disposed");
      if (typeof id !== "string" || !id || typeof execute !== "function")
        throw new TypeError("Warmup requires an ID and synchronous job");
      if (signal?.aborted) return false;
      if (jobs.has(id)) return false;
      if (jobs.size >= maxPending) throw new RangeError("Warmup queue capacity exceeded");
      const job = { execute, signal, onAbort: () => cancel(id) };
      jobs.set(id, job);
      signal?.addEventListener("abort", job.onAbort, { once: true });
      return true;
    },
    cancel,
    cancelAll() {
      for (const id of [...jobs.keys()]) cancel(id);
    },
    drain({ maxPrograms = 2, budgetMilliseconds = 2 } = {}) {
      if (disposed || draining)
        throw new Error(
          disposed ? "Warmup queue is disposed" : "Warmup queue reentry is forbidden"
        );
      if (
        !Number.isInteger(maxPrograms) ||
        maxPrograms < 0 ||
        !Number.isFinite(budgetMilliseconds) ||
        budgetMilliseconds < 0
      )
        throw new RangeError("Invalid warmup slice budget");
      const started = now();
      const results = [];
      draining = true;
      try {
        for (const id of [...jobs.keys()]) {
          if (
            disposed ||
            results.length >= maxPrograms ||
            budgetMilliseconds === 0 ||
            now() - started >= budgetMilliseconds
          )
            break;
          const job = remove(id);
          if (!job || job.signal?.aborted) continue;
          try {
            const value = job.execute();
            if (value && typeof value.then === "function")
              throw new TypeError("Warmup jobs must be synchronous");
            completed += 1;
            results.push({ id, status: "compiled" });
          } catch (error) {
            failed += 1;
            results.push({ id, status: "failed", message: error.message });
          }
        }
      } finally {
        draining = false;
      }
      lastSlice = Object.freeze({
        results,
        cpuSubmissionMilliseconds: Math.max(0, now() - started),
        pending: jobs.size,
        preemption: "between-programs-only"
      });
      return lastSlice;
    },
    stats: () => ({
      pending: jobs.size,
      completed,
      failed,
      cancelled,
      timers: 0,
      abortListeners: [...jobs.values()].filter((job) => job.signal).length,
      lastSlice
    }),
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const id of [...jobs.keys()]) cancel(id);
    }
  });
}
