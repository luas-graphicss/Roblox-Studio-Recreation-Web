import { MSM_PARTITION_ACTION } from "./msmGridDirtyCore.js";
import { describeResidentCapacity } from "./msmResidentCapacityCore.js";

export const MSM_PARTITION_PHASE_ID = "MSM-F7";


export const MSM_PARTITION_SET = Object.freeze({
  RESIDENT: "resident",
  STOCHASTIC: "stochastic",
});


export const MSM_PARTITION_HYSTERESIS_MS = 2000;


export const MSM_PARTITION_MIN_COMMIT_INTERVAL_MS = 1000;
export const MSM_PARTITION_COMMIT_WINDOW_MS = 1000;
export const MSM_PARTITION_MAX_COMMITS_PER_SECOND = 1;


export const MSM_PARTITION_SLICE_LIGHT_COUNT = 1;


export const MSM_PARTITION_MAX_MATERIAL_LIGHT_COUNT_DELTA = 1;


export const MSM_PARTITION_PROMOTION_MARGIN = 0.15;

export const MSM_PARTITION_SKIP_REASON = Object.freeze({
  FROZEN: "frozen",
  NO_PULSE: "no-pulse",
  UNKNOWN_ACTION: "unknown-action",
  MISSING_CLOCK: "missing-clock",
  CAPACITY_REFUSED: "capacity-refused",
  SETTLED: "already-settled",
  COMMIT_COOLDOWN: "commit-cooldown",
  HYSTERESIS_HOLD: "hysteresis-hold",
});


const PULSE_ACTIONS = Object.freeze([
  MSM_PARTITION_ACTION.REEVALUATE_PULSED,
  MSM_PARTITION_ACTION.REEVALUATE_SLICED,
]);

function positiveNumberOr(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : fallback;
}

function positiveIntegerOr(value, fallback) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  const floored = Math.floor(parsed);
  return floored >= 1 ? floored : fallback;
}


function normalizedLight(candidate) {
  if (!candidate || typeof candidate !== "object") return null;
  const rawId = candidate.id === undefined || candidate.id === null ? "" : String(candidate.id).trim();
  if (!(rawId.length >= 1)) return null;
  const priority = Number(candidate.priority);
  if (!Number.isFinite(priority) || !(priority >= 0)) return null;
  return { id: rawId, priority };
}


function byPriorityThenId(first, second) {
  if (second.priority > first.priority) return 1;
  if (first.priority > second.priority) return -1;
  if (first.id > second.id) return 1;
  if (second.id > first.id) return -1;
  return 0;
}

function lightIds(lights) {
  return lights.map((light) => light.id);
}


function planDesiredMoves(rankedLights, residentIds, capacity, promotionMargin) {
  const survivors = [];
  const challengers = [];
  rankedLights.forEach((light) => {
    if (residentIds.has(light.id)) survivors.push(light);
    else challengers.push(light);
  });


  const moves = [];

  while (survivors.length > capacity) {
    moves.push({ demotion: survivors.pop(), capacityForced: true });
  }

  let freeSeats = capacity - survivors.length;
  let challengerIndex = 0;
  while (freeSeats >= 1 && challengers.length > challengerIndex) {
    moves.push({ promotion: challengers[challengerIndex] });
    challengerIndex += 1;
    freeSeats -= 1;
  }

  let weakestSurvivorIndex = survivors.length - 1;
  while (challengers.length > challengerIndex && weakestSurvivorIndex >= 0) {
    const challenger = challengers[challengerIndex];
    const weakestSurvivor = survivors[weakestSurvivorIndex];
    if (!(challenger.priority >= weakestSurvivor.priority * (1 + promotionMargin))) break;
    moves.push({ promotion: challenger, demotion: weakestSurvivor });
    challengerIndex += 1;
    weakestSurvivorIndex -= 1;
  }

  return moves;
}


export function createLightPartition(options) {
  const settings = options && typeof options === "object" ? options : {};
  const hysteresisMs = positiveNumberOr(settings.hysteresisMs, MSM_PARTITION_HYSTERESIS_MS);
  const minCommitIntervalMs = positiveNumberOr(settings.minCommitIntervalMs, MSM_PARTITION_MIN_COMMIT_INTERVAL_MS);
  const commitWindowMs = positiveNumberOr(settings.commitWindowMs, MSM_PARTITION_COMMIT_WINDOW_MS);
  const sliceLightCount = positiveIntegerOr(settings.sliceLightCount, MSM_PARTITION_SLICE_LIGHT_COUNT);
  const promotionMargin = positiveNumberOr(settings.promotionMargin, MSM_PARTITION_PROMOTION_MARGIN);
  const resolveCapacity =
    typeof settings.resolveCapacity === "function" ? settings.resolveCapacity : describeResidentCapacity;

  const residentIds = new Set();
  const lastChangeAtMsById = new Map();
  const commitTimestampsMs = [];

  const totals = {
    evaluations: 0,
    frozenEvaluations: 0,
    quietEvaluations: 0,
    rejectedActions: 0,
    rejectedLights: 0,
    missingClockEvaluations: 0,
    capacityRefusals: 0,
    settledEvaluations: 0,
    cooldownSkips: 0,
    hysteresisSkips: 0,
    commits: 0,
    ignitionCommits: 0,
    ignitionPromotionCount: 0,
    promotions: 0,
    demotions: 0,
    capacityForcedDemotions: 0,
    removals: 0,
    materialLightCountChanges: 0,
    maxMaterialLightCountDelta: 0,
    maxCommitsPerSecond: 0,
    maxResidentCount: 0,
  };

  let lastCommitAtMs = null;
  let lastRankedIds = [];
  let lastCapacity = null;
  let lastCapacityReason = "never evaluated";

  function stochasticIdsNow() {
    return lastRankedIds.filter((id) => !residentIds.has(id));
  }

  function frozenPlan(fields) {
    return Object.freeze({
      phase: MSM_PARTITION_PHASE_ID,
      evaluation: totals.evaluations,
      nowMs: fields.nowMs,
      action: fields.action,
      committed: fields.committed,
      ignition: fields.ignition === true,
      skipReason: fields.skipReason,
      capacity: fields.capacity,
      capacityReason: fields.capacityReason,
      resident: Object.freeze(Array.from(residentIds)),
      stochastic: Object.freeze(stochasticIdsNow()),
      promoted: Object.freeze(fields.promoted || []),
      demoted: Object.freeze(fields.demoted || []),
      removed: Object.freeze(fields.removed || []),
      materialLightCountDelta: fields.materialLightCountDelta || 0,
      overCapacityResidentCount: fields.overCapacityResidentCount || 0,
      pendingPromotionCount: fields.pendingPromotionCount || 0,
      pendingDemotionCount: fields.pendingDemotionCount || 0,
      heldByHysteresisCount: fields.heldByHysteresisCount || 0,
      reason: fields.reason,
    });
  }

  function dropCommitsOutsideWindow(nowMs) {
    while (commitTimestampsMs.length >= 1 && nowMs - commitTimestampsMs[0] >= commitWindowMs) {
      commitTimestampsMs.shift();
    }
  }

  function canMoveLight(lightId, nowMs) {
    const lastChangeAtMs = lastChangeAtMsById.get(lightId);
    if (lastChangeAtMs === undefined) return true;
    return nowMs - lastChangeAtMs >= hysteresisMs;
  }

  function pruneLightsThatLeftTheScene(presentIds) {
    const removed = [];
    residentIds.forEach((residentId) => {
      if (!presentIds.has(residentId)) removed.push(residentId);
    });
    removed.forEach((removedId) => {
      residentIds.delete(removedId);
      lastChangeAtMsById.delete(removedId);
    });
    lastChangeAtMsById.forEach((unusedValue, knownId) => {
      if (!presentIds.has(knownId)) lastChangeAtMsById.delete(knownId);
    });
    totals.removals += removed.length;
    return removed;
  }

  function commitMoves(nowMs, promotions, demotions, isIgnition) {
    promotions.forEach((light) => {
      residentIds.add(light.id);
      lastChangeAtMsById.set(light.id, nowMs);
    });
    demotions.forEach((light) => {
      residentIds.delete(light.id);
      lastChangeAtMsById.set(light.id, nowMs);
    });

    const materialLightCountDelta = promotions.length - demotions.length;
    const absoluteDelta = Math.abs(materialLightCountDelta);

    commitTimestampsMs.push(nowMs);
    dropCommitsOutsideWindow(nowMs);
    lastCommitAtMs = nowMs;

    totals.commits += 1;
    if (isIgnition) totals.ignitionCommits += 1;
    totals.promotions += promotions.length;
    totals.demotions += demotions.length;
    if (absoluteDelta >= 1) totals.materialLightCountChanges += 1;


    if (isIgnition) totals.ignitionPromotionCount = promotions.length;
    else if (absoluteDelta > totals.maxMaterialLightCountDelta) totals.maxMaterialLightCountDelta = absoluteDelta;
    if (commitTimestampsMs.length > totals.maxCommitsPerSecond) {
      totals.maxCommitsPerSecond = commitTimestampsMs.length;
    }
    if (residentIds.size > totals.maxResidentCount) totals.maxResidentCount = residentIds.size;

    return materialLightCountDelta;
  }

  function evaluate(request) {
    const source = request && typeof request === "object" ? request : {};
    const action = String(
      source.partitionAction === undefined || source.partitionAction === null
        ? MSM_PARTITION_ACTION.NONE
        : source.partitionAction,
    );
    totals.evaluations += 1;


    if (action === MSM_PARTITION_ACTION.FREEZE) {
      totals.frozenEvaluations += 1;
      return frozenPlan({
        nowMs: Number.isFinite(Number(source.nowMs)) ? Number(source.nowMs) : null,
        action,
        committed: false,
        skipReason: MSM_PARTITION_SKIP_REASON.FROZEN,
        capacity: lastCapacity,
        capacityReason: lastCapacityReason,
        reason: "idle brake is on: the partition freezes with the scene and costs nothing",
      });
    }

    if (action === MSM_PARTITION_ACTION.NONE) {
      totals.quietEvaluations += 1;
      return frozenPlan({
        nowMs: Number.isFinite(Number(source.nowMs)) ? Number(source.nowMs) : null,
        action,
        committed: false,
        skipReason: MSM_PARTITION_SKIP_REASON.NO_PULSE,
        capacity: lastCapacity,
        capacityReason: lastCapacityReason,
        reason: "no dirty pulse asked for a reevaluation, so the partition does not touch itself",
      });
    }

    if (PULSE_ACTIONS.indexOf(action) === -1) {
      totals.rejectedActions += 1;
      return frozenPlan({
        nowMs: Number.isFinite(Number(source.nowMs)) ? Number(source.nowMs) : null,
        action,
        committed: false,
        skipReason: MSM_PARTITION_SKIP_REASON.UNKNOWN_ACTION,
        capacity: lastCapacity,
        capacityReason: lastCapacityReason,
        reason:
          'unknown partition action "' +
          action +
          '" - only the dirty ledger of MSM-F4 moves this partition, and an unknown order is refused instead of guessed',
      });
    }

    const nowMs = Number(source.nowMs);
    if (!Number.isFinite(nowMs)) {
      totals.missingClockEvaluations += 1;
      return frozenPlan({
        nowMs: null,
        action,
        committed: false,
        skipReason: MSM_PARTITION_SKIP_REASON.MISSING_CLOCK,
        capacity: lastCapacity,
        capacityReason: lastCapacityReason,
        reason: "nowMs is required: without a clock there is no hysteresis and no one-change-per-second ceiling",
      });
    }

    const rawLights = Array.isArray(source.lights) ? source.lights : [];
    const lights = [];
    rawLights.forEach((rawLight) => {
      const light = normalizedLight(rawLight);
      if (light) lights.push(light);
      else totals.rejectedLights += 1;
    });
    const rankedLights = lights.slice().sort(byPriorityThenId);
    lastRankedIds = lightIds(rankedLights);

    const presentIds = new Set(lastRankedIds);
    const removed = pruneLightsThatLeftTheScene(presentIds);

    const capacityDecision = resolveCapacity(source);
    if (!capacityDecision || capacityDecision.refused || capacityDecision.capacity === null) {
      totals.capacityRefusals += 1;
      const refusalReason = capacityDecision ? capacityDecision.reason : "capacity resolver returned nothing";
      lastCapacityReason = refusalReason;
      return frozenPlan({
        nowMs,
        action,
        committed: false,
        skipReason: MSM_PARTITION_SKIP_REASON.CAPACITY_REFUSED,
        capacity: null,
        capacityReason: refusalReason,
        removed,
        overCapacityResidentCount: 0,
        reason: "the partition keeps the current sets when the capacity is refused: it never resizes on a guess",
      });
    }

    const capacity = capacityDecision.capacity;
    lastCapacity = capacity;
    lastCapacityReason = capacityDecision.reason;

    const desiredMoves = planDesiredMoves(rankedLights, residentIds, capacity, promotionMargin);
    const desiredPromotionCount = desiredMoves.filter((move) => move.promotion).length;
    const desiredDemotionCount = desiredMoves.filter((move) => move.demotion).length;

    if (desiredPromotionCount + desiredDemotionCount === 0) {
      totals.settledEvaluations += 1;
      if (residentIds.size > totals.maxResidentCount) totals.maxResidentCount = residentIds.size;
      return frozenPlan({
        nowMs,
        action,
        committed: false,
        skipReason: MSM_PARTITION_SKIP_REASON.SETTLED,
        capacity,
        capacityReason: capacityDecision.reason,
        removed,
        overCapacityResidentCount: Math.max(0, residentIds.size - capacity),
        reason: "the partition already matches the desired one, margin included: nothing to move",
      });
    }


    const isIgnition = lastCommitAtMs === null && residentIds.size === 0;
    if (isIgnition) {
      const ignitionPromotions = desiredMoves
        .filter((move) => move.promotion)
        .map((move) => move.promotion);
      const materialLightCountDelta = commitMoves(nowMs, ignitionPromotions, [], true);
      return frozenPlan({
        nowMs,
        action,
        committed: true,
        ignition: true,
        skipReason: null,
        capacity,
        capacityReason: capacityDecision.reason,
        promoted: lightIds(ignitionPromotions),
        removed,
        materialLightCountDelta,
        overCapacityResidentCount: Math.max(0, residentIds.size - capacity),
        reason:
          "ignition: the resident set is filled to capacity in a single commit because the material is being created, not recompiled",
      });
    }

    if (!(lastCommitAtMs === null || nowMs - lastCommitAtMs >= minCommitIntervalMs)) {
      totals.cooldownSkips += 1;
      return frozenPlan({
        nowMs,
        action,
        committed: false,
        skipReason: MSM_PARTITION_SKIP_REASON.COMMIT_COOLDOWN,
        capacity,
        capacityReason: capacityDecision.reason,
        removed,
        pendingPromotionCount: desiredPromotionCount,
        pendingDemotionCount: desiredDemotionCount,
        overCapacityResidentCount: Math.max(0, residentIds.size - capacity),
        reason:
          "at most one partition change per second: " +
          (desiredPromotionCount + desiredDemotionCount) +
          " move(s) wait for the cooldown instead of recompiling the material now",
      });
    }


    let heldByHysteresisCount = 0;
    const movableMoves = desiredMoves.filter((move) => {
      if (move.capacityForced) return true;
      const promotionMovable = !move.promotion || canMoveLight(move.promotion.id, nowMs);
      const demotionMovable = !move.demotion || canMoveLight(move.demotion.id, nowMs);
      if (promotionMovable && demotionMovable) return true;
      heldByHysteresisCount += 1;
      return false;
    });


    const slicedPromotions = [];
    const slicedDemotions = [];
    let capacityForcedInSlice = 0;
    movableMoves.forEach((move) => {
      const promotionCost = move.promotion ? 1 : 0;
      const demotionCost = move.demotion ? 1 : 0;
      if (!(sliceLightCount >= slicedPromotions.length + promotionCost)) return;
      if (!(sliceLightCount >= slicedDemotions.length + demotionCost)) return;
      if (move.promotion) slicedPromotions.push(move.promotion);
      if (move.demotion) slicedDemotions.push(move.demotion);
      if (move.capacityForced) capacityForcedInSlice += 1;
    });

    if (slicedPromotions.length + slicedDemotions.length === 0) {
      totals.hysteresisSkips += 1;
      return frozenPlan({
        nowMs,
        action,
        committed: false,
        skipReason: MSM_PARTITION_SKIP_REASON.HYSTERESIS_HOLD,
        capacity,
        capacityReason: capacityDecision.reason,
        removed,
        pendingPromotionCount: desiredPromotionCount,
        pendingDemotionCount: desiredDemotionCount,
        heldByHysteresisCount,
        overCapacityResidentCount: Math.max(0, residentIds.size - capacity),
        reason:
          "every wanted move is still inside the " +
          hysteresisMs +
          " ms hysteresis of its own light: flapping is the failure this phase exists to prevent",
      });
    }

    totals.capacityForcedDemotions += capacityForcedInSlice;
    const materialLightCountDelta = commitMoves(nowMs, slicedPromotions, slicedDemotions, false);

    return frozenPlan({
      nowMs,
      action,
      committed: true,
      skipReason: null,
      capacity,
      capacityReason: capacityDecision.reason,
      promoted: lightIds(slicedPromotions),
      demoted: lightIds(slicedDemotions),
      removed,
      materialLightCountDelta,
      overCapacityResidentCount: Math.max(0, residentIds.size - capacity),
      pendingPromotionCount: desiredPromotionCount - slicedPromotions.length,
      pendingDemotionCount: desiredDemotionCount - slicedDemotions.length,
      heldByHysteresisCount,
      reason:
        "sliced commit: " +
        slicedPromotions.length +
        " promotion(s), " +
        slicedDemotions.length +
        " demotion(s), material light count delta " +
        materialLightCountDelta,
    });
  }

  function snapshot() {
    return {
      phase: MSM_PARTITION_PHASE_ID,
      capacity: lastCapacity,
      resident: Array.from(residentIds),
      stochastic: stochasticIdsNow(),
      residentCount: residentIds.size,
      stochasticCount: stochasticIdsNow().length,
      overCapacityResidentCount: lastCapacity === null ? 0 : Math.max(0, residentIds.size - lastCapacity),
      lastCommitAtMs,
    };
  }

  function setOfLight(lightId) {
    const knownId = String(lightId);
    if (residentIds.has(knownId)) return MSM_PARTITION_SET.RESIDENT;
    return lastRankedIds.indexOf(knownId) >= 0 ? MSM_PARTITION_SET.STOCHASTIC : null;
  }

  function stats() {
    return Object.assign({}, totals, {
      phase: MSM_PARTITION_PHASE_ID,
      capacity: lastCapacity,
      residentCount: residentIds.size,
      stochasticCount: stochasticIdsNow().length,
      commitsInWindow: commitTimestampsMs.length,
      lastCommitAtMs,
      hysteresisMs,
      minCommitIntervalMs,
      commitWindowMs,
      sliceLightCount,
      promotionMargin,
    });
  }

  function reset() {
    residentIds.clear();
    lastChangeAtMsById.clear();
    commitTimestampsMs.length = 0;
    Object.keys(totals).forEach((field) => {
      totals[field] = 0;
    });
    lastCommitAtMs = null;
    lastRankedIds = [];
    lastCapacity = null;
    lastCapacityReason = "never evaluated";
    return true;
  }

  return {
    evaluate,
    snapshot,
    setOfLight,
    stats,
    reset,
  };
}


export function describePartitionPolicy() {
  return Object.freeze({
    phase: MSM_PARTITION_PHASE_ID,
    hysteresisMs: MSM_PARTITION_HYSTERESIS_MS,
    minCommitIntervalMs: MSM_PARTITION_MIN_COMMIT_INTERVAL_MS,
    maxCommitsPerSecond: MSM_PARTITION_MAX_COMMITS_PER_SECOND,
    sliceLightCount: MSM_PARTITION_SLICE_LIGHT_COUNT,
    maxMaterialLightCountDelta: MSM_PARTITION_MAX_MATERIAL_LIGHT_COUNT_DELTA,
    promotionMargin: MSM_PARTITION_PROMOTION_MARGIN,
    pulseActions: PULSE_ACTIONS,
    sets: MSM_PARTITION_SET,
  });
}
