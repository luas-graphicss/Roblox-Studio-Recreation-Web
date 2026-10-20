export function evaluatePhaseCoverage(phases, records) {
  if (!Array.isArray(phases) || !Array.isArray(records))
    throw new TypeError(
      "Phase coverage requires inventories and execution records",
    );
  return phases.map((phase) => {
    const observed = records.filter((record) => record.owner === phase.id);
    const executed = observed.filter((record) => record.status === "executed");
    const measured = executed.filter(
      (record) =>
        record.draws > 0 &&
        record.writes.some(
          (write) =>
            write.pixelProof === true &&
            write.measurement?.pixelCount > 0 &&
            write.measurement.finite === true,
        ),
    );
    const blockedValues = executed.flatMap((record) =>
      record.writes.filter((write) => write.status === "blocked-value"),
    );
    const status =
      phase.status === "not-loaded-in-this-diagnostic"
        ? "not-loaded"
        : phase.status !== "implemented"
          ? "not-implemented"
          : observed.some((record) => record.status === "failed")
            ? "failed"
            : blockedValues.length
              ? "blocked-consumer"
              : measured.length
                ? "gpu-observed"
                : executed.length
                  ? "executed-without-pixel-proof"
                  : "not-executed";
    return {
      id: phase.id,
      declaredStatus: phase.status,
      status,
      passIds: [...new Set(executed.map((record) => record.id))],
      executions: executed.length,
      measuredExecutions: measured.length,
      drawCalls: executed.reduce((sum, record) => sum + record.draws, 0),
      failures: observed
        .filter((record) => record.error)
        .map((record) => ({ id: record.id, error: record.error })),
      blockedValues,
    };
  });
}
