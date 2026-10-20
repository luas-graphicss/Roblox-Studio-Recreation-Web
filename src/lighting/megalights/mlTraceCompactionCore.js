import { MGL_TRACE_RESULT } from "./mlPipelineContract.js";

function flagValueAt(flags, index) {
  const value = flags[index];
  if (value === true) return 1;
  if (!value) return 0;
  return Number(value) > 0 ? 1 : 0;
}

function resolveRowWidth(requestedRowWidth, length) {
  const requested = Math.floor(Number(requestedRowWidth) || 0);
  if (requested > 0) return requested;


  return Math.max(1, length);
}


export function inclusiveRowScan(flags, rowWidth) {
  const length = (flags && flags.length) || 0;
  const width = resolveRowWidth(rowWidth, length);
  const scan = new Int32Array(length);
  let runningTotal = 0;
  for (let index = 0; index < length; index++) {
    if (index % width === 0) runningTotal = 0;
    runningTotal += flagValueAt(flags, index);
    scan[index] = runningTotal;
  }
  return scan;
}


export function rowTotalsFrom(inclusiveScan, rowWidth) {
  const length = (inclusiveScan && inclusiveScan.length) || 0;
  const width = resolveRowWidth(rowWidth, length);
  const rowCount = Math.ceil(length / width);
  const totals = new Int32Array(rowCount);
  for (let row = 0; row < rowCount; row++) {
    const lastIndexOfRow = Math.min((row + 1) * width, length) - 1;
    totals[row] = lastIndexOfRow >= row * width ? inclusiveScan[lastIndexOfRow] : 0;
  }
  return totals;
}


export function exclusiveScan(values) {
  const length = (values && values.length) || 0;
  const scan = new Int32Array(length);
  let runningTotal = 0;
  for (let index = 0; index < length; index++) {
    scan[index] = runningTotal;
    runningTotal += Number(values[index]) || 0;
  }
  return scan;
}


export function scanFlags(input) {
  const flags = (input && input.flags) || [];
  const length = flags.length || 0;
  const rowWidth = resolveRowWidth(input && input.rowWidth, length);
  const inclusiveScan = inclusiveRowScan(flags, rowWidth);
  const rowTotals = rowTotalsFrom(inclusiveScan, rowWidth);
  const rowOffsets = exclusiveScan(rowTotals);
  const offsets = new Int32Array(length);
  let totalCount = 0;

  for (let index = 0; index < length; index++) {
    if (flagValueAt(flags, index) === 1) {
      offsets[index] = rowOffsets[Math.floor(index / rowWidth)] + inclusiveScan[index] - 1;
      totalCount++;
    } else {
      offsets[index] = -1;
    }
  }

  return {
    offsets,
    rowOffsets,
    rowTotals,
    inclusiveScan,
    totalCount,
    rowWidth,
    rowCount: rowTotals.length,
  };
}


export function compactIndices(input) {
  const scan = scanFlags(input);
  const indices = new Int32Array(scan.totalCount);
  for (let index = 0; index < scan.offsets.length; index++) {
    const offset = scan.offsets[index];
    if (offset >= 0) indices[offset] = index;
  }
  return { indices, offsets: scan.offsets, totalCount: scan.totalCount, rowWidth: scan.rowWidth, scan };
}


export function compactFlaggedItems(input) {
  const compaction = compactIndices(input);
  const build =
    typeof (input && input.build) === "function" ? input.build : (elementIndex) => elementIndex;
  const items = new Array(compaction.totalCount);
  for (let position = 0; position < compaction.indices.length; position++) {
    items[position] = build(compaction.indices[position], position);
  }
  return {
    items,
    totalCount: compaction.totalCount,
    offsets: compaction.offsets,
    rowWidth: compaction.rowWidth,
  };
}


export function isResolvedTraceResult(traceResult) {
  return traceResult === MGL_TRACE_RESULT.visible || traceResult === MGL_TRACE_RESULT.occluded;
}

export function isSurvivingTraceResult(traceResult) {
  return !isResolvedTraceResult(traceResult);
}


export function compactSurvivorLanes(input) {
  const lanes = Array.isArray(input && input.lanes) ? input.lanes : [];
  const isSurvivor =
    typeof (input && input.isSurvivor) === "function"
      ? input.isSurvivor
      : (lane) => isSurvivingTraceResult(lane && lane.traceResult);

  const flags = new Int32Array(lanes.length);
  const counters = {
    visibleCount: 0,
    occludedCount: 0,
    unknownCount: 0,
    unclassifiedCount: 0,
  };

  for (let index = 0; index < lanes.length; index++) {
    const lane = lanes[index];
    const traceResult = lane && lane.traceResult;
    if (traceResult === MGL_TRACE_RESULT.visible) counters.visibleCount++;
    else if (traceResult === MGL_TRACE_RESULT.occluded) counters.occludedCount++;
    else if (traceResult === MGL_TRACE_RESULT.unknown) counters.unknownCount++;
    else counters.unclassifiedCount++;
    flags[index] = isSurvivor(lane) ? 1 : 0;
  }

  const compaction = compactFlaggedItems({
    flags,
    rowWidth: input && input.rowWidth,
    build: (laneIndex) => lanes[laneIndex],
  });

  return Object.assign(
    {
      survivors: compaction.items,
      inputCount: lanes.length,
      survivorCount: compaction.totalCount,
      resolvedCount: lanes.length - compaction.totalCount,
      offsets: compaction.offsets,
      rowWidth: compaction.rowWidth,
    },
    counters,
  );
}


export function createCompactionLedger() {
  const records = [];
  let initialCount = null;

  function begin(inputCount) {
    records.length = 0;
    initialCount = Math.max(0, Math.floor(Number(inputCount) || 0));
    return initialCount;
  }

  function record(entry) {
    const inputCount = Math.max(0, Math.floor(Number(entry && entry.inputCount) || 0));
    const survivorCount = Math.max(0, Math.floor(Number(entry && entry.survivorCount) || 0));
    const stored = {
      stage: String((entry && entry.stage) || "?"),
      inputCount,
      survivorCount,
      resolvedCount: Math.max(0, inputCount - survivorCount),
      survivorRatio: inputCount > 0 ? survivorCount / inputCount : 0,
    };
    records.push(stored);
    return stored;
  }

  function stages() {
    return records.map((stageRecord) => Object.assign({}, stageRecord));
  }

  function pendingCount() {
    if (records.length > 0) return records[records.length - 1].survivorCount;
    return initialCount;
  }


  function dropsBetweenStages() {
    if (records.length === 0) return false;
    return records.every((stageRecord) => stageRecord.survivorCount < stageRecord.inputCount);
  }


  function verify() {
    const problems = [];
    const warnings = [];

    if (initialCount === null) problems.push("the ledger was never started with begin(requestCount)");
    if (initialCount !== null && records.length > 0 && records[0].inputCount !== initialCount) {
      problems.push(
        'stage "' + records[0].stage + '" received ' + records[0].inputCount +
          " lanes but the frame produced " + initialCount,
      );
    }

    for (let index = 0; index < records.length; index++) {
      const stageRecord = records[index];
      if (stageRecord.survivorCount > stageRecord.inputCount) {
        problems.push('stage "' + stageRecord.stage + '" returned more survivors than it received');
      }
      if (index > 0 && stageRecord.inputCount !== records[index - 1].survivorCount) {
        problems.push(
          'stage "' + stageRecord.stage + '" received ' + stageRecord.inputCount +
            ' lanes but stage "' + records[index - 1].stage + '" left ' +
            records[index - 1].survivorCount,
        );
      }
      if (stageRecord.inputCount > 0 && stageRecord.survivorCount === stageRecord.inputCount) {
        warnings.push('stage "' + stageRecord.stage + '" resolved nothing: its compaction bought no work');
      }
    }

    return { ok: problems.length === 0, problems, warnings };
  }

  function summary() {
    const verification = verify();
    return {
      initialCount,
      stageCount: records.length,
      finalSurvivorCount: pendingCount(),
      resolvedCount:
        initialCount === null ? 0 : Math.max(0, initialCount - (pendingCount() || 0)),
      dropsBetweenStages: dropsBetweenStages(),
      ok: verification.ok,
      problems: verification.problems,
      warnings: verification.warnings,
      stages: stages(),
    };
  }

  function reset() {
    records.length = 0;
    initialCount = null;
  }

  return { begin, record, stages, pendingCount, dropsBetweenStages, verify, summary, reset };
}
