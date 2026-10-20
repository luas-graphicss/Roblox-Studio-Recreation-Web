export const MAX_GRANULARITY_WASTE_RATIO = 0.25;

export const GRANULARITY_VERDICT = Object.freeze({
  withinGate: "within-gate",
  aboveGate: "above-gate",
  notMeasured: "not-measured",
});


export function measureGranularityWaste(measurement) {
  const source = measurement || {};
  const gate = Number.isFinite(Number(source.gate)) ? Number(source.gate) : MAX_GRANULARITY_WASTE_RATIO;
  const rasterizedLaneCount = Math.max(0, Math.floor(Number(source.rasterizedLaneCount) || 0));
  const neededLaneCount = Math.max(0, Math.floor(Number(source.neededLaneCount) || 0));
  const label = source.label || source.tracer || null;

  if (rasterizedLaneCount === 0) {
    return {
      label,
      gate,
      rasterizedLaneCount,
      neededLaneCount,
      wastedLaneCount: 0,
      wasteRatio: 0,
      verdict: GRANULARITY_VERDICT.notMeasured,
      withinGate: false,
      problem: neededLaneCount > 0 ? neededLaneCount + " lanes asked for work but nothing was rasterized" : null,
    };
  }

  if (neededLaneCount > rasterizedLaneCount) {
    return {
      label,
      gate,
      rasterizedLaneCount,
      neededLaneCount,
      wastedLaneCount: 0,
      wasteRatio: 0,
      verdict: GRANULARITY_VERDICT.notMeasured,
      withinGate: false,
      problem:
        "needed " + neededLaneCount + " lanes but only " + rasterizedLaneCount +
        " were rasterized: the plan cannot cover the requests",
    };
  }

  const wastedLaneCount = rasterizedLaneCount - neededLaneCount;
  const wasteRatio = wastedLaneCount / rasterizedLaneCount;

  return {
    label,
    gate,
    rasterizedLaneCount,
    neededLaneCount,
    wastedLaneCount,
    wasteRatio,
    quadAlignedLaneCount: Math.max(0, Math.floor(Number(source.quadAlignedLaneCount) || 0)),
    verdict: wasteRatio <= gate ? GRANULARITY_VERDICT.withinGate : GRANULARITY_VERDICT.aboveGate,
    withinGate: wasteRatio <= gate,
    problem: null,
  };
}


export function measurePlansGranularityWaste(plans, gate) {
  const list = Array.isArray(plans) ? plans : [];
  const perPlan = list.map((plan) => measureGranularityWaste(Object.assign({ gate }, plan)));
  let rasterizedLaneCount = 0;
  let neededLaneCount = 0;
  for (let index = 0; index < list.length; index++) {
    rasterizedLaneCount += Math.max(0, Math.floor(Number(list[index].rasterizedLaneCount) || 0));
    neededLaneCount += Math.max(0, Math.floor(Number(list[index].neededLaneCount) || 0));
  }
  return {
    perPlan,
    total: measureGranularityWaste({ rasterizedLaneCount, neededLaneCount, gate, label: "frame" }),
  };
}


export function compareGranularityWaste(before, after) {
  const beforeMeasurement = measureGranularityWaste(before);
  const afterMeasurement = measureGranularityWaste(after);
  return {
    before: beforeMeasurement,
    after: afterMeasurement,
    rasterizedLaneCountRemoved: beforeMeasurement.rasterizedLaneCount - afterMeasurement.rasterizedLaneCount,
    wastedLaneCountRemoved: beforeMeasurement.wastedLaneCount - afterMeasurement.wastedLaneCount,
    wasteRatioDelta: afterMeasurement.wasteRatio - beforeMeasurement.wasteRatio,
    improved: afterMeasurement.wasteRatio < beforeMeasurement.wasteRatio,
  };
}
