export function createDiagnosticReporter(report = () => {}) {
  let failureCount = 0;
  let lastFailure = null;
  function failed(error) {
    failureCount += 1;
    lastFailure = error?.message ?? String(error);
  }
  const emit = (event) => {
    try {
      const result = report(event);
      if (result && typeof result.then === "function") Promise.resolve(result).catch(failed);
    } catch (error) {
      failed(error);
    }
  };
  emit.stats = () => ({ failureCount, lastFailure });
  return Object.freeze(emit);
}
