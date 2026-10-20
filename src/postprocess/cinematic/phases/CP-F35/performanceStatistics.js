export function summarizeSamples(samples) {
  if (
    !Array.isArray(samples) ||
    samples.some(
      (value) =>
        typeof value !== "number" || !Number.isFinite(value) || value < 0,
    )
  )
    throw new TypeError("Timing samples must be finite nonnegative numbers");
  if (!samples.length)
    return {
      sampleCount: 0,
      p50: null,
      p95: null,
      p99: null,
      minimum: null,
      maximum: null,
      mean: null,
      method: "nearest-rank",
    };
  const ordered = [...samples].sort((left, right) => left - right);
  const percentile = (probability) =>
    ordered[Math.max(0, Math.ceil(ordered.length * probability) - 1)];
  return {
    sampleCount: ordered.length,
    p50: percentile(0.5),
    p95: percentile(0.95),
    p99: percentile(0.99),
    minimum: ordered[0],
    maximum: ordered.at(-1),
    mean:
      ordered.at(-1) === 0
        ? 0
        : Math.min(
            1,
            ordered.reduce((sum, value) => sum + value / ordered.at(-1), 0) /
              ordered.length,
          ) * ordered.at(-1),
    method: "nearest-rank",
  };
}
