export const MSM_DIRTY_PHASE_ID = "MSM-F4";


export const MSM_DIRTY_TARGET = Object.freeze({
  GRID: "grid",
  ATLAS_PAGE: "atlasPage",
  TEMPORAL_HISTORY: "temporalHistory",
  PARTITION: "partition",
});


export const MSM_DIRTY_EVENT = Object.freeze({
  LIGHT_CREATED: "light-created",
  LIGHT_REMOVED: "light-removed",
  LIGHT_MOVED: "light-moved",
  LIGHT_RETINTED: "light-retinted",
  PART_EDITED: "part-edited",
  PART_MOVED: "part-moved",
  CAMERA_CROSSED_CELL: "camera-crossed-cell",
  CAMERA_ROTATED: "camera-rotated",
  CAMERA_MOVED_INSIDE_CELL: "camera-moved-inside-cell",
  TIER_CHANGED: "tier-changed",
  TECHNOLOGY_CHANGED: "technology-changed",
  IDLE_SETTLED: "idle-settled",
});

export const MSM_GRID_ACTION = Object.freeze({
  NONE: "none",
  FREEZE: "freeze",
  SHIFT_AND_FILL_NEW_CELLS: "shift-and-fill-new-cells",
  REBUILD_LIGHT_CELLS: "rebuild-light-cells",
  REBUILD_ALL_CELLS: "rebuild-all-cells",
  RESET_BY_GATE: "reset-by-gate",
});

export const MSM_ATLAS_PAGE_ACTION = Object.freeze({
  NONE: "none",
  FREEZE: "freeze",
  INVALIDATE_PAGES_OF_BOX: "invalidate-pages-of-box",
  INVALIDATE_PAGES_OF_LIGHT: "invalidate-pages-of-light",
  REPLAN_ALL_PAGES: "replan-all-pages",
});

export const MSM_HISTORY_ACTION = Object.freeze({
  NONE: "none",
  FREEZE: "freeze",
  REPROJECT: "reproject",
  FAST_ALPHA: "fast-alpha",
  RESET: "reset",
});

export const MSM_PARTITION_ACTION = Object.freeze({
  NONE: "none",
  FREEZE: "freeze",
  REEVALUATE_PULSED: "reevaluate-pulsed",
  REEVALUATE_SLICED: "reevaluate-sliced",
});



export const MSM_FAST_ALPHA_FRAMES = 4;


const GRID_ACTIONS_BY_STRENGTH = [
  MSM_GRID_ACTION.NONE,
  MSM_GRID_ACTION.FREEZE,
  MSM_GRID_ACTION.SHIFT_AND_FILL_NEW_CELLS,
  MSM_GRID_ACTION.REBUILD_LIGHT_CELLS,
  MSM_GRID_ACTION.REBUILD_ALL_CELLS,
  MSM_GRID_ACTION.RESET_BY_GATE,
];

const ATLAS_PAGE_ACTIONS_BY_STRENGTH = [
  MSM_ATLAS_PAGE_ACTION.NONE,
  MSM_ATLAS_PAGE_ACTION.FREEZE,
  MSM_ATLAS_PAGE_ACTION.INVALIDATE_PAGES_OF_BOX,
  MSM_ATLAS_PAGE_ACTION.INVALIDATE_PAGES_OF_LIGHT,
  MSM_ATLAS_PAGE_ACTION.REPLAN_ALL_PAGES,
];

const HISTORY_ACTIONS_BY_STRENGTH = [
  MSM_HISTORY_ACTION.NONE,
  MSM_HISTORY_ACTION.FREEZE,
  MSM_HISTORY_ACTION.REPROJECT,
  MSM_HISTORY_ACTION.FAST_ALPHA,
  MSM_HISTORY_ACTION.RESET,
];

const PARTITION_ACTIONS_BY_STRENGTH = [
  MSM_PARTITION_ACTION.NONE,
  MSM_PARTITION_ACTION.FREEZE,
  MSM_PARTITION_ACTION.REEVALUATE_PULSED,
  MSM_PARTITION_ACTION.REEVALUATE_SLICED,
];

function ledgerRow(gridAction, atlasPageAction, historyAction, partitionAction) {
  return Object.freeze({
    grid: gridAction,
    atlasPage: atlasPageAction,
    temporalHistory: historyAction,
    partition: partitionAction,
  });
}



export const MSM_DIRTY_LEDGER = Object.freeze({


  [MSM_DIRTY_EVENT.LIGHT_CREATED]: ledgerRow(
    MSM_GRID_ACTION.REBUILD_LIGHT_CELLS,
    MSM_ATLAS_PAGE_ACTION.INVALIDATE_PAGES_OF_LIGHT,
    MSM_HISTORY_ACTION.FAST_ALPHA,
    MSM_PARTITION_ACTION.REEVALUATE_PULSED,
  ),
  [MSM_DIRTY_EVENT.LIGHT_REMOVED]: ledgerRow(
    MSM_GRID_ACTION.REBUILD_LIGHT_CELLS,
    MSM_ATLAS_PAGE_ACTION.INVALIDATE_PAGES_OF_LIGHT,
    MSM_HISTORY_ACTION.FAST_ALPHA,
    MSM_PARTITION_ACTION.REEVALUATE_PULSED,
  ),
  [MSM_DIRTY_EVENT.LIGHT_MOVED]: ledgerRow(
    MSM_GRID_ACTION.REBUILD_LIGHT_CELLS,
    MSM_ATLAS_PAGE_ACTION.INVALIDATE_PAGES_OF_LIGHT,
    MSM_HISTORY_ACTION.FAST_ALPHA,
    MSM_PARTITION_ACTION.REEVALUATE_PULSED,
  ),
  [MSM_DIRTY_EVENT.LIGHT_RETINTED]: ledgerRow(
    MSM_GRID_ACTION.REBUILD_LIGHT_CELLS,
    MSM_ATLAS_PAGE_ACTION.INVALIDATE_PAGES_OF_LIGHT,
    MSM_HISTORY_ACTION.FAST_ALPHA,
    MSM_PARTITION_ACTION.REEVALUATE_PULSED,
  ),


  [MSM_DIRTY_EVENT.PART_EDITED]: ledgerRow(
    MSM_GRID_ACTION.NONE,
    MSM_ATLAS_PAGE_ACTION.INVALIDATE_PAGES_OF_BOX,
    MSM_HISTORY_ACTION.FAST_ALPHA,
    MSM_PARTITION_ACTION.NONE,
  ),
  [MSM_DIRTY_EVENT.PART_MOVED]: ledgerRow(
    MSM_GRID_ACTION.NONE,
    MSM_ATLAS_PAGE_ACTION.INVALIDATE_PAGES_OF_BOX,
    MSM_HISTORY_ACTION.FAST_ALPHA,
    MSM_PARTITION_ACTION.NONE,
  ),


  [MSM_DIRTY_EVENT.CAMERA_CROSSED_CELL]: ledgerRow(
    MSM_GRID_ACTION.SHIFT_AND_FILL_NEW_CELLS,
    MSM_ATLAS_PAGE_ACTION.NONE,
    MSM_HISTORY_ACTION.NONE,
    MSM_PARTITION_ACTION.NONE,
  ),


  [MSM_DIRTY_EVENT.CAMERA_ROTATED]: ledgerRow(
    MSM_GRID_ACTION.NONE,
    MSM_ATLAS_PAGE_ACTION.NONE,
    MSM_HISTORY_ACTION.REPROJECT,
    MSM_PARTITION_ACTION.NONE,
  ),
  [MSM_DIRTY_EVENT.CAMERA_MOVED_INSIDE_CELL]: ledgerRow(
    MSM_GRID_ACTION.NONE,
    MSM_ATLAS_PAGE_ACTION.NONE,
    MSM_HISTORY_ACTION.REPROJECT,
    MSM_PARTITION_ACTION.NONE,
  ),


  [MSM_DIRTY_EVENT.TIER_CHANGED]: ledgerRow(
    MSM_GRID_ACTION.REBUILD_ALL_CELLS,
    MSM_ATLAS_PAGE_ACTION.REPLAN_ALL_PAGES,
    MSM_HISTORY_ACTION.RESET,
    MSM_PARTITION_ACTION.REEVALUATE_SLICED,
  ),


  [MSM_DIRTY_EVENT.TECHNOLOGY_CHANGED]: ledgerRow(
    MSM_GRID_ACTION.RESET_BY_GATE,
    MSM_ATLAS_PAGE_ACTION.NONE,
    MSM_HISTORY_ACTION.RESET,
    MSM_PARTITION_ACTION.REEVALUATE_PULSED,
  ),


  [MSM_DIRTY_EVENT.IDLE_SETTLED]: ledgerRow(
    MSM_GRID_ACTION.FREEZE,
    MSM_ATLAS_PAGE_ACTION.FREEZE,
    MSM_HISTORY_ACTION.FREEZE,
    MSM_PARTITION_ACTION.FREEZE,
  ),
});

export function msmDirtyEventTypes() {
  return Object.keys(MSM_DIRTY_LEDGER);
}

export function msmDirtyLedgerEntryFor(eventType) {
  const key = String(eventType);
  return Object.prototype.hasOwnProperty.call(MSM_DIRTY_LEDGER, key) ? MSM_DIRTY_LEDGER[key] : null;
}

export function msmDirtyActionFor(eventType, target) {
  const entry = msmDirtyLedgerEntryFor(eventType);
  if (!entry) return null;
  const column = String(target);
  return Object.prototype.hasOwnProperty.call(entry, column) ? entry[column] : null;
}


export function msmDirtyEventReignitesConvergence(eventType) {
  const historyAction = msmDirtyActionFor(eventType, MSM_DIRTY_TARGET.TEMPORAL_HISTORY);
  return historyAction === MSM_HISTORY_ACTION.FAST_ALPHA || historyAction === MSM_HISTORY_ACTION.RESET;
}


export function msmDirtyLedgerRows() {
  return msmDirtyEventTypes().map((eventType) => {
    const entry = MSM_DIRTY_LEDGER[eventType];
    return {
      event: eventType,
      grid: entry.grid,
      atlasPage: entry.atlasPage,
      temporalHistory: entry.temporalHistory,
      partition: entry.partition,
      reignitesConvergence: msmDirtyEventReignitesConvergence(eventType),
    };
  });
}

function numberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function normalizedCellIndex(value) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const cellIndex = Math.floor(parsed);
  return cellIndex >= 0 ? cellIndex : null;
}

function normalizedKey(value) {
  if (value === null || value === undefined) return null;
  const key = String(value).trim();
  return key.length >= 1 ? key : null;
}

function normalizedCellShift(value) {
  if (!value || typeof value !== "object") return null;
  return {
    x: Math.round(numberOr(value.x, 0)),
    y: Math.round(numberOr(value.y, 0)),
    z: Math.round(numberOr(value.z, 0)),
  };
}

function addedCellShift(currentShift, nextShift) {
  if (!nextShift) return currentShift;
  if (!currentShift) return nextShift;
  return {
    x: currentShift.x + nextShift.x,
    y: currentShift.y + nextShift.y,
    z: currentShift.z + nextShift.z,
  };
}

function collectCellIndicesInto(targetSet, values) {
  if (!Array.isArray(values)) return;
  values.forEach((value) => {
    const cellIndex = normalizedCellIndex(value);
    if (cellIndex === null) return;
    targetSet.add(cellIndex);
  });
}

function collectKeysInto(targetSet, values) {
  if (!Array.isArray(values)) return;
  values.forEach((value) => {
    const key = normalizedKey(value);
    if (key === null) return;
    targetSet.add(key);
  });
}

function strongerAction(actionsByStrength, currentAction, candidateAction) {
  const candidateStrength = actionsByStrength.indexOf(candidateAction);
  if (!(candidateStrength >= 0)) return currentAction;
  const currentStrength = actionsByStrength.indexOf(currentAction);
  return candidateStrength > currentStrength ? candidateAction : currentAction;
}

function sortedNumbers(values) {
  return Array.from(values).sort((first, second) => first - second);
}

function sortedKeys(values) {
  return Array.from(values).sort();
}


export function createGridDirtyLedger(options) {
  const settings = options || {};
  const fastAlphaFrames = Math.max(1, Math.floor(numberOr(settings.fastAlphaFrames, MSM_FAST_ALPHA_FRAMES)));

  const lightCellIndices = new Set();
  const cameraNewCellIndices = new Set();
  const dirtyPageKeys = new Set();
  const dirtyLightIds = new Set();
  const frameEventTypes = new Set();

  const totals = {
    frames: 0,
    idleFrames: 0,
    frozenFrames: 0,
    events: 0,
    rejectedEvents: 0,
    invalidations: 0,
    dirtyPulses: 0,
    gridCells: 0,
    atlasPages: 0,
    historyPulses: 0,
    partitionReevaluations: 0,
  };

  let gridAction = MSM_GRID_ACTION.NONE;
  let atlasPageAction = MSM_ATLAS_PAGE_ACTION.NONE;
  let historyAction = MSM_HISTORY_ACTION.NONE;
  let partitionAction = MSM_PARTITION_ACTION.NONE;
  let rebuildAllCells = false;
  let resetGridByGate = false;
  let replanAllPages = false;
  let cameraCellShift = null;
  let frameEventCount = 0;
  let frameCount = 0;

  function clearFrame() {
    lightCellIndices.clear();
    cameraNewCellIndices.clear();
    dirtyPageKeys.clear();
    dirtyLightIds.clear();
    frameEventTypes.clear();
    gridAction = MSM_GRID_ACTION.NONE;
    atlasPageAction = MSM_ATLAS_PAGE_ACTION.NONE;
    historyAction = MSM_HISTORY_ACTION.NONE;
    partitionAction = MSM_PARTITION_ACTION.NONE;
    rebuildAllCells = false;
    resetGridByGate = false;
    replanAllPages = false;
    cameraCellShift = null;
    frameEventCount = 0;
  }

  function collectGridPayload(entry, event) {
    if (entry.grid === MSM_GRID_ACTION.REBUILD_LIGHT_CELLS) collectCellIndicesInto(lightCellIndices, event.cellIndices);
    if (entry.grid === MSM_GRID_ACTION.SHIFT_AND_FILL_NEW_CELLS) {
      collectCellIndicesInto(cameraNewCellIndices, event.newCellIndices);
      cameraCellShift = addedCellShift(cameraCellShift, normalizedCellShift(event.cellShift));
    }
    if (entry.grid === MSM_GRID_ACTION.REBUILD_ALL_CELLS) rebuildAllCells = true;
    if (entry.grid === MSM_GRID_ACTION.RESET_BY_GATE) resetGridByGate = true;
  }

  function collectAtlasPagePayload(entry, event) {
    if (entry.atlasPage === MSM_ATLAS_PAGE_ACTION.INVALIDATE_PAGES_OF_LIGHT) {
      collectKeysInto(dirtyPageKeys, event.pageKeys);
      const lightId = normalizedKey(event.lightId);
      if (lightId !== null) dirtyLightIds.add(lightId);
    }
    if (entry.atlasPage === MSM_ATLAS_PAGE_ACTION.INVALIDATE_PAGES_OF_BOX) collectKeysInto(dirtyPageKeys, event.pageKeys);
    if (entry.atlasPage === MSM_ATLAS_PAGE_ACTION.REPLAN_ALL_PAGES) replanAllPages = true;
  }


  function recordEvent(event) {
    const source = event || {};
    const eventType = String(source.type === undefined ? "" : source.type);
    const entry = msmDirtyLedgerEntryFor(eventType);
    if (!entry) {
      totals.rejectedEvents++;
      return false;
    }
    frameEventCount++;
    totals.events++;
    frameEventTypes.add(eventType);
    gridAction = strongerAction(GRID_ACTIONS_BY_STRENGTH, gridAction, entry.grid);
    atlasPageAction = strongerAction(ATLAS_PAGE_ACTIONS_BY_STRENGTH, atlasPageAction, entry.atlasPage);
    historyAction = strongerAction(HISTORY_ACTIONS_BY_STRENGTH, historyAction, entry.temporalHistory);
    partitionAction = strongerAction(PARTITION_ACTIONS_BY_STRENGTH, partitionAction, entry.partition);
    collectGridPayload(entry, source);
    collectAtlasPagePayload(entry, source);
    return true;
  }

  function planFrame() {
    frameCount++;
    totals.frames++;

    const historyPulse = historyAction === MSM_HISTORY_ACTION.FAST_ALPHA || historyAction === MSM_HISTORY_ACTION.RESET;
    const partitionReevaluated =
      partitionAction === MSM_PARTITION_ACTION.REEVALUATE_PULSED || partitionAction === MSM_PARTITION_ACTION.REEVALUATE_SLICED;

    const grid = Object.freeze({
      action: gridAction,
      cellIndices: sortedNumbers(lightCellIndices),
      newCellIndices: sortedNumbers(cameraNewCellIndices),
      cellShift: cameraCellShift ? Object.freeze(Object.assign({}, cameraCellShift)) : null,
      rebuildAll: rebuildAllCells,
      resetByGate: resetGridByGate,
    });
    const atlasPage = Object.freeze({
      action: atlasPageAction,
      pageKeys: sortedKeys(dirtyPageKeys),
      lightIds: sortedKeys(dirtyLightIds),
      replanAll: replanAllPages,
    });
    const temporalHistory = Object.freeze({
      action: historyAction,
      fastAlphaFrames: historyPulse ? fastAlphaFrames : 0,
    });
    const partition = Object.freeze({ action: partitionAction });

    const invalidationCount =
      grid.cellIndices.length +
      grid.newCellIndices.length +
      (grid.rebuildAll ? 1 : 0) +
      (grid.resetByGate ? 1 : 0) +
      atlasPage.pageKeys.length +
      atlasPage.lightIds.length +
      (atlasPage.replanAll ? 1 : 0) +
      (historyPulse ? 1 : 0) +
      (partitionReevaluated ? 1 : 0);

    const frozen = frameEventTypes.has(MSM_DIRTY_EVENT.IDLE_SETTLED) && invalidationCount === 0;

    const plan = Object.freeze({
      phase: MSM_DIRTY_PHASE_ID,
      frame: frameCount,
      eventCount: frameEventCount,
      eventTypes: sortedKeys(frameEventTypes),
      grid: grid,
      atlasPage: atlasPage,
      temporalHistory: temporalHistory,
      partition: partition,
      dirtyPulse: historyPulse,
      frozen: frozen,
      invalidationCount: invalidationCount,
    });

    totals.invalidations += invalidationCount;
    totals.gridCells += grid.cellIndices.length + grid.newCellIndices.length;
    totals.atlasPages += atlasPage.pageKeys.length;
    if (historyPulse) totals.historyPulses++;
    if (partitionReevaluated) totals.partitionReevaluations++;
    if (plan.dirtyPulse) totals.dirtyPulses++;
    if (frameEventCount === 0) totals.idleFrames++;
    if (frozen) totals.frozenFrames++;

    clearFrame();
    return plan;
  }

  function stats() {
    return {
      phase: MSM_DIRTY_PHASE_ID,
      frames: totals.frames,
      idleFrames: totals.idleFrames,
      frozenFrames: totals.frozenFrames,
      events: totals.events,
      rejectedEvents: totals.rejectedEvents,
      invalidations: totals.invalidations,
      dirtyPulses: totals.dirtyPulses,
      gridCells: totals.gridCells,
      atlasPages: totals.atlasPages,
      historyPulses: totals.historyPulses,
      partitionReevaluations: totals.partitionReevaluations,
      fastAlphaFrames: fastAlphaFrames,
    };
  }

  function reset() {
    clearFrame();
    frameCount = 0;
    Object.keys(totals).forEach((field) => {
      totals[field] = 0;
    });
    return true;
  }

  return {
    recordEvent: recordEvent,
    planFrame: planFrame,
    pendingEventCount: () => frameEventCount,
    stats: stats,
    reset: reset,
  };
}
