export function summarizeMsmTelemetry(snapshot = {}) {
  const sample = snapshot.sample || {};
  const budget = sample.targetBudget || {};
  const forward = snapshot.forward || {};
  const atlas = snapshot.atlasSchedule || null;
  return {
    ...snapshot,
    samplesPerPixel: sample.streamCount ?? 0,
    resolutionDivisor: budget.divisor ?? sample.divisor ?? null,
    lights: {
      candidates: snapshot.candidateCount ?? 0,
      nativeResident: snapshot.nativeShadowCount ?? 0,
      atlasResident: snapshot.atlasShadowCount ?? 0,
      stochastic: forward.active ? forward.stochasticCount : sample.lightCount ?? 0,
      saturatedCells: sample.grid?.saturatedCellCount ?? null,
      saturatedCellsInLastRebuild: sample.lastRebuild?.saturatedCells ?? null,
      droppedCellEntriesInLastRebuild: sample.lastRebuild?.droppedEntries ?? null,
    },
    pages: atlas,
    samplingCost: { valuesAreConfiguredBounds: true, normalDepthTaps: 3, atlasDepthTapsPerSample: 1,
      screenDepthTapsPerSample: sample.screenTraceSteps ?? null,
      forwardTextureUnits: forward.materialTextureUnitCost ?? 0,
      budgetedResidentBytes: budget.newVramBytes ?? null },
    convergence: sample.convergence || null,
    passTimings: sample.governor?.passes || [],
    timingMode: sample.governor?.mode || 'not-measured',
    gateReason: snapshot.sleepReason || snapshot.wakeReason || '',
  };
}
