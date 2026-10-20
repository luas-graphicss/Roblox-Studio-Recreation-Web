import {
  MSM_ATLAS_PAGE_ACTION,
  MSM_DIRTY_TARGET,
  MSM_GRID_ACTION,
  msmDirtyActionFor,
} from "./msmGridDirtyCore.js";
import {
  MSM_PROXY_BOX_CEILING,
  copyProxyBox,
  createNeutralProxyBox,
  resetProxyBoxToNeutral,
  writeProxyBox,
} from "./msmProxyOcclusionCore.js";
import { MSM_TIER_POLICY } from "./msmTierPolicy.js";

export const MSM_PROXY_COLLECT_OWNER = "MSM-F19";


export const MSM_PROXY_MINIMUM_RADIUS_IN_CELLS = 0.5;


export const MSM_PROXY_MAXIMUM_STRENGTH = 0.85;

export const MSM_PROXY_REFUSAL_REASON = Object.freeze({
  INVALID_NUMBERS: "invalid-numbers",
  TOO_SMALL: "too-small",
  TRANSPARENT: "transparent",
  OUTRANKED: "outranked",
  UNKNOWN_TIER: "unknown-tier",
});


export const MSM_PROXY_RECOLLECT_ACTION = Object.freeze({
  NONE: "none",
  FREEZE: "freeze",
  RESELECT: "reselect",
  REBUILD_ALL_SLOTS: "rebuild-all-slots",
});

function readTierText(value) {
  return typeof value === "string" ? value.trim().toLowerCase() : "";
}


export function resolveMinimumProxyRadiusStuds(tier, overrideStuds) {
  const override = Number(overrideStuds);
  if (Number.isFinite(override) && override > 0) return override;
  const policy = MSM_TIER_POLICY[readTierText(tier)];
  if (!policy) return null;
  return policy.worldGrid.cellStuds * MSM_PROXY_MINIMUM_RADIUS_IN_CELLS;
}


export function msmProxyCandidateScore(candidateRadiusStuds, anchorDistanceStuds) {
  if (!(candidateRadiusStuds > 0)) return 0;
  const surfaceDistance = Math.max(0, anchorDistanceStuds - candidateRadiusStuds);
  return candidateRadiusStuds / (candidateRadiusStuds + surfaceDistance);
}


export function createMsmProxyBoxCollector() {
  const boxes = [];
  const slotMetadata = [];
  for (let slotIndex = 0; MSM_PROXY_BOX_CEILING > slotIndex; slotIndex += 1) {
    boxes.push(createNeutralProxyBox());
    slotMetadata.push({ id: null, idText: "", score: 0 });
  }
  return {
    boxes,
    slotMetadata,
    filledSlotCount: 0,
    consideredCandidateCount: 0,
    refusedCandidateCount: 0,
    minimumRadiusStuds: 0,
  };
}

function readFiniteNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : Number.NaN;
}

function readVectorOrNull(vector) {
  if (!Array.isArray(vector)) return null;
  const first = readFiniteNumber(vector[0]);
  const second = readFiniteNumber(vector[1]);
  const third = readFiniteNumber(vector[2]);
  if (Number.isNaN(first + second + third)) return null;
  return vector;
}

function readUnitNumber(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  if (parsed > 1) return 1;
  if (0 > parsed) return 0;
  return parsed;
}

function distanceBetween(firstPoint, secondPoint) {
  const deltaX = firstPoint[0] - secondPoint[0];
  const deltaY = firstPoint[1] - secondPoint[1];
  const deltaZ = firstPoint[2] - secondPoint[2];
  return Math.sqrt(deltaX * deltaX + deltaY * deltaY + deltaZ * deltaZ);
}

function halfDiagonalOf(halfExtent) {
  const first = Math.abs(halfExtent[0]);
  const second = Math.abs(halfExtent[1]);
  const third = Math.abs(halfExtent[2]);
  return Math.sqrt(first * first + second * second + third * third);
}


function firstOutranksSecond(firstScore, firstIdText, secondScore, secondIdText) {
  if (firstScore > secondScore) return true;
  if (secondScore > firstScore) return false;
  return secondIdText > firstIdText;
}

function findInsertionPosition(collector, score, idText) {
  let position = 0;
  while (collector.filledSlotCount > position) {
    const slot = collector.slotMetadata[position];
    if (!firstOutranksSecond(slot.score, slot.idText, score, idText)) return position;
    position += 1;
  }
  return position;
}

function copySlot(collector, sourceIndex, targetIndex) {
  copyProxyBox(collector.boxes[sourceIndex], collector.boxes[targetIndex]);
  const source = collector.slotMetadata[sourceIndex];
  const target = collector.slotMetadata[targetIndex];
  target.id = source.id;
  target.idText = source.idText;
  target.score = source.score;
}

function insertIntoRanking(collector, candidate, score, idText, strength) {
  const position = findInsertionPosition(collector, score, idText);
  if (!(MSM_PROXY_BOX_CEILING > position)) return false;

  const lastIndex = Math.min(collector.filledSlotCount, MSM_PROXY_BOX_CEILING - 1);
  for (let slotIndex = lastIndex; slotIndex > position; slotIndex -= 1) {
    copySlot(collector, slotIndex - 1, slotIndex);
  }

  writeProxyBox(collector.boxes[position], candidate.center, candidate.halfExtent, strength);
  const slot = collector.slotMetadata[position];
  slot.id = candidate.id;
  slot.idText = idText;
  slot.score = score;

  if (MSM_PROXY_BOX_CEILING > collector.filledSlotCount) collector.filledSlotCount += 1;
  return true;
}


function resetCollector(collector) {
  for (let slotIndex = 0; MSM_PROXY_BOX_CEILING > slotIndex; slotIndex += 1) {
    resetProxyBoxToNeutral(collector.boxes[slotIndex]);
    const slot = collector.slotMetadata[slotIndex];
    slot.id = null;
    slot.idText = "";
    slot.score = 0;
  }
  collector.filledSlotCount = 0;
  collector.consideredCandidateCount = 0;
  collector.refusedCandidateCount = 0;
}


export function collectMsmProxyBoxes(collector, candidates, anchorWorldPosition, options) {
  resetCollector(collector);

  const tier = options ? options.tier : undefined;
  const minimumRadius = resolveMinimumProxyRadiusStuds(tier, options ? options.minimumRadiusStuds : undefined);
  const maximumStrength = readUnitNumber(options ? options.maximumStrength : undefined, MSM_PROXY_MAXIMUM_STRENGTH);
  collector.minimumRadiusStuds = minimumRadius === null ? 0 : minimumRadius;

  const anchor = readVectorOrNull(anchorWorldPosition);
  if (minimumRadius === null || anchor === null) return collector;

  const candidateCount = Array.isArray(candidates) ? candidates.length : 0;
  for (let candidateIndex = 0; candidateCount > candidateIndex; candidateIndex += 1) {
    const candidate = candidates[candidateIndex];
    collector.consideredCandidateCount += 1;
    if (!candidate) {
      collector.refusedCandidateCount += 1;
      continue;
    }

    const center = readVectorOrNull(candidate.center);
    const halfExtent = readVectorOrNull(candidate.halfExtent);
    if (center === null || halfExtent === null) {
      collector.refusedCandidateCount += 1;
      continue;
    }

    const radius = halfDiagonalOf(halfExtent);
    if (!(radius >= minimumRadius)) {
      collector.refusedCandidateCount += 1;
      continue;
    }

    const strength = readUnitNumber(candidate.strength, 1) * maximumStrength;
    if (!(strength > 0)) {
      collector.refusedCandidateCount += 1;
      continue;
    }

    const score = msmProxyCandidateScore(radius, distanceBetween(center, anchor));
    const idText = String(candidate.id);
    if (!insertIntoRanking(collector, candidate, score, idText, strength)) {
      collector.refusedCandidateCount += 1;
    }
  }

  return collector;
}


export function msmProxyRecollectActionFor(dirtyEventType) {
  const gridAction = msmDirtyActionFor(dirtyEventType, MSM_DIRTY_TARGET.GRID);
  if (gridAction === null) return null;
  if (gridAction === MSM_GRID_ACTION.FREEZE) return MSM_PROXY_RECOLLECT_ACTION.FREEZE;
  if (gridAction === MSM_GRID_ACTION.REBUILD_ALL_CELLS) return MSM_PROXY_RECOLLECT_ACTION.REBUILD_ALL_SLOTS;
  if (gridAction === MSM_GRID_ACTION.RESET_BY_GATE) return MSM_PROXY_RECOLLECT_ACTION.REBUILD_ALL_SLOTS;

  const atlasPageAction = msmDirtyActionFor(dirtyEventType, MSM_DIRTY_TARGET.ATLAS_PAGE);
  if (atlasPageAction === MSM_ATLAS_PAGE_ACTION.INVALIDATE_PAGES_OF_BOX) return MSM_PROXY_RECOLLECT_ACTION.RESELECT;
  if (gridAction === MSM_GRID_ACTION.SHIFT_AND_FILL_NEW_CELLS) return MSM_PROXY_RECOLLECT_ACTION.RESELECT;

  return MSM_PROXY_RECOLLECT_ACTION.NONE;
}
