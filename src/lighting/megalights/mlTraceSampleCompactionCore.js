import { MGL_TRACE_RESULT } from "./mlPipelineContract.js";


export function sampleCompactionRatioOf(promotedCount, inputCount) {
  if (!(inputCount > 0)) return 0;
  return promotedCount / inputCount;
}


export function compactUnresolvedSamples(sampleRecords) {
  const records = Array.isArray(sampleRecords) ? sampleRecords : [];
  const promotedIndices = [];
  let resolvedCount = 0;

  records.forEach((record, sampleIndex) => {
    if (record && record.traceResult === MGL_TRACE_RESULT.unknown) {
      promotedIndices.push(sampleIndex);
      return;
    }
    resolvedCount += 1;
  });

  const inputCount = records.length;
  return Object.freeze({
    promotedIndices: Object.freeze(promotedIndices),
    promotedCount: promotedIndices.length,
    inputCount,
    resolvedCount,

    savedTraceCount: inputCount - promotedIndices.length,
    compactionRatio: sampleCompactionRatioOf(promotedIndices.length, inputCount),
  });
}
