import { MSM_GRID_EMPTY_SLOT, MSM_GRID_MAX_LIGHT_COUNT } from "./msmWorldGridLayout.js";
import { describeMsmTierPolicy } from "./msmTierPolicy.js";


export const MSM_FAR_LIST_PHASE_ID = "MSM-F10";


export const MSM_FAR_LIST_CAPACITY = 8;


export const MSM_FAR_LIST_TIERS = Object.freeze(["lite", "low", "medium"]);


export const MSM_REC709_LUMINANCE_WEIGHTS = Object.freeze({ red: 0.2126, green: 0.7152, blue: 0.0722 });


export const MSM_FAR_LIST_REFERENCE_FLOOR_STUDS = 8;


export const MSM_FAR_LIST_MINIMUM_SQUARED_DISTANCE = 0.01;


export const MSM_FAR_LIST_DEFAULT_PROMOTION_MARGIN = 0;


export const MSM_FAR_LIST_SLOTS_UNIFORM_NAME = "uMsmFarLightSlots";
export const MSM_FAR_LIST_COUNT_UNIFORM_NAME = "uMsmFarLightCount";


export const MSM_FAR_LIST_SLEEP_REASON = Object.freeze({
  TIER_WITHOUT_FAR_LIST: "tierWithoutFarList",
  MSM_ASLEEP_ON_TIER: "msmAsleepOnTier",
  SOLD_BY_GOVERNOR: "soldByGovernor",
  GRID_BOUNDS_UNKNOWN: "gridBoundsUnknown",
});


export const MSM_FAR_LIST_CANDIDACY = Object.freeze({
  GRID_CELL_LIST: "gridCellList",
  OUTSIDE_GRID: "outsideGrid",
  COVERS_WHOLE_GRID: "coversWholeGrid",
  NOT_IN_RESIDENT_SET: "notInResidentSet",
});


export const MSM_FAR_LIST_COVERAGE_SOURCE = Object.freeze({
  GRID_RESIDENT_SET: "gridResidentSet",
  GEOMETRIC_FALLBACK: "geometricFallback",
});


export const MSM_FAR_LIST_REFUSAL = Object.freeze({
  NOT_A_RECORD: "notARecord",
  LIGHT_INDEX_OUT_OF_RANGE: "lightIndexOutOfRange",
  DUPLICATED_LIGHT_INDEX: "duplicatedLightIndex",
  DISABLED_LIGHT: "disabledLight",
  INVALID_POSITION: "invalidPosition",
  NO_REACH_INTO_GRID: "noReachIntoGrid",
  ZERO_STRENGTH: "zeroStrength",
});


export const MSM_EMITTER_REACH = Object.freeze({
  ABSENT: 0,
  GRID_CELL_LIST: 1,
  FAR_LIST: 2,
  DROPPED: 3,
});


export const MSM_FAR_LIST_RESIDUALS = Object.freeze([
  "A far list carrega apenas emissores que o grid NAO resolve. Um pixel fora do grid (caso da F9) le so essa lista e portanto nao ve os emissores residentes do grid: o volume e centrado na camera (192x64x192 studs no lite/low), entao esse pixel esta a pelo menos 96 studs do centro e o que importa ali sao justamente os fortes/distantes. Custo da alternativa: 16 slots de uniform em vez de 8.",
  "A forca e medida por LUZ contra o volume do grid, nunca por amostra. Quem pesa a amostra e a F13 (luminance x falloff x saturate(N.L + 0.2)). Aqui se decide QUEM pode ser sorteado, nunca com que peso.",
  "Luz cuja esfera nao toca o volume do grid e recusada com noReachIntoGrid: a contribuicao dela para os pixels que o grid cobre e exatamente zero. Se algum dia a far list tambem tiver de servir pixels fora do volume, essa recusa vira a primeira coisa a revisar.",
  "Sem gridBounds a far list RECUSA e dorme (gridBoundsUnknown). Nunca chuta que a luz esta fora.",
  "Histerese nasce em 0 (desligada) porque o aceite pede os 8 mais fortes ao pe da letra. Com margem > 0 um incumbente pode segurar o slot 8 contra um desafiante marginal — vies declarado, provado no spec.",
]);


function readNumber(value, fallback) {
  if (value === null || value === undefined || value === "" || typeof value === "boolean") return fallback;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function readVectorComponent(source, key, index, fallback) {
  if (source === null || source === undefined || typeof source !== "object") return fallback;
  return readNumber(Array.isArray(source) ? source[index] : source[key], fallback);
}


function writeGridBounds(gridBounds, bounds) {
  if (gridBounds === null || gridBounds === undefined || typeof gridBounds !== "object") return false;
  const hasVectorShape = gridBounds.min !== undefined && gridBounds.max !== undefined;
  const minX = hasVectorShape ? readVectorComponent(gridBounds.min, "x", 0, Number.NaN) : readNumber(gridBounds.minX, Number.NaN);
  const minY = hasVectorShape ? readVectorComponent(gridBounds.min, "y", 1, Number.NaN) : readNumber(gridBounds.minY, Number.NaN);
  const minZ = hasVectorShape ? readVectorComponent(gridBounds.min, "z", 2, Number.NaN) : readNumber(gridBounds.minZ, Number.NaN);
  const maxX = hasVectorShape ? readVectorComponent(gridBounds.max, "x", 0, Number.NaN) : readNumber(gridBounds.maxX, Number.NaN);
  const maxY = hasVectorShape ? readVectorComponent(gridBounds.max, "y", 1, Number.NaN) : readNumber(gridBounds.maxY, Number.NaN);
  const maxZ = hasVectorShape ? readVectorComponent(gridBounds.max, "z", 2, Number.NaN) : readNumber(gridBounds.maxZ, Number.NaN);
  if (!Number.isFinite(minX) || !Number.isFinite(minY) || !Number.isFinite(minZ)) return false;
  if (!Number.isFinite(maxX) || !Number.isFinite(maxY) || !Number.isFinite(maxZ)) return false;
  if (!(maxX >= minX) || !(maxY >= minY) || !(maxZ >= minZ)) return false;
  bounds[0] = minX;
  bounds[1] = minY;
  bounds[2] = minZ;
  bounds[3] = maxX;
  bounds[4] = maxY;
  bounds[5] = maxZ;
  return true;
}

function axisDistanceOutside(value, minimum, maximum) {
  if (minimum > value) return minimum - value;
  if (value > maximum) return value - maximum;
  return 0;
}

function nearestDistanceToBounds(x, y, z, bounds) {
  const dx = axisDistanceOutside(x, bounds[0], bounds[3]);
  const dy = axisDistanceOutside(y, bounds[1], bounds[4]);
  const dz = axisDistanceOutside(z, bounds[2], bounds[5]);
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}

function farthestDistanceToBounds(x, y, z, bounds) {
  const dx = Math.max(Math.abs(x - bounds[0]), Math.abs(x - bounds[3]));
  const dy = Math.max(Math.abs(y - bounds[1]), Math.abs(y - bounds[4]));
  const dz = Math.max(Math.abs(z - bounds[2]), Math.abs(z - bounds[5]));
  return Math.sqrt(dx * dx + dy * dy + dz * dz);
}










export function emitterLuminousPower(candidate) {
  if (candidate === null || candidate === undefined || typeof candidate !== "object") return 0;
  const red = readVectorComponent(candidate.color, "r", 0, 1);
  const green = readVectorComponent(candidate.color, "g", 1, 1);
  const blue = readVectorComponent(candidate.color, "b", 2, 1);
  const luminance =
    MSM_REC709_LUMINANCE_WEIGHTS.red * red +
    MSM_REC709_LUMINANCE_WEIGHTS.green * green +
    MSM_REC709_LUMINANCE_WEIGHTS.blue * blue;
  return Math.max(0, luminance) * Math.max(0, readNumber(candidate.intensity, 1));
}






export function windowedInverseSquareAttenuation(distance, range) {
  const measuredDistance = Math.max(0, readNumber(distance, 0));
  const inverseSquare = 1 / Math.max(measuredDistance * measuredDistance, MSM_FAR_LIST_MINIMUM_SQUARED_DISTANCE);
  const cutoffRange = readNumber(range, 0);
  if (!(cutoffRange > 0)) return inverseSquare;
  const ratio = Math.min(1, measuredDistance / cutoffRange);
  const windowFactor = Math.max(0, 1 - ratio * ratio * ratio * ratio);
  return inverseSquare * windowFactor * windowFactor;
}


function candidacyFromGeometry(range, nearestDistance, farthestDistance) {
  const isRangeBounded = Number.isFinite(range) && range > 0;
  if (!isRangeBounded) return MSM_FAR_LIST_CANDIDACY.COVERS_WHOLE_GRID;
  if (nearestDistance > range) return MSM_FAR_LIST_CANDIDACY.OUTSIDE_GRID;
  if (range >= farthestDistance) return MSM_FAR_LIST_CANDIDACY.COVERS_WHOLE_GRID;
  return MSM_FAR_LIST_CANDIDACY.GRID_CELL_LIST;
}


export function describeGridCoverage(candidate, gridBounds) {
  const bounds = new Float64Array(6);
  if (!writeGridBounds(gridBounds, bounds)) {
    return Object.freeze({
      usable: false,
      candidacy: "",
      resolvedByGrid: false,
      nearestDistance: Number.NaN,
      farthestDistance: Number.NaN,
      reason: "gridBounds ausente ou invalido: a far list nao chuta cobertura",
    });
  }
  const positionX = readVectorComponent(candidate === null || candidate === undefined ? null : candidate.position, "x", 0, Number.NaN);
  const positionY = readVectorComponent(candidate === null || candidate === undefined ? null : candidate.position, "y", 1, Number.NaN);
  const positionZ = readVectorComponent(candidate === null || candidate === undefined ? null : candidate.position, "z", 2, Number.NaN);
  if (!Number.isFinite(positionX) || !Number.isFinite(positionY) || !Number.isFinite(positionZ)) {
    return Object.freeze({
      usable: false,
      candidacy: "",
      resolvedByGrid: false,
      nearestDistance: Number.NaN,
      farthestDistance: Number.NaN,
      reason: "position ausente ou invalida",
    });
  }
  const nearestDistance = nearestDistanceToBounds(positionX, positionY, positionZ, bounds);
  const farthestDistance = farthestDistanceToBounds(positionX, positionY, positionZ, bounds);
  const range = readNumber(candidate.range, 0);
  const candidacy = candidacyFromGeometry(range, nearestDistance, farthestDistance);
  return Object.freeze({
    usable: true,
    candidacy,
    resolvedByGrid: candidacy === MSM_FAR_LIST_CANDIDACY.GRID_CELL_LIST,
    nearestDistance,
    farthestDistance,
    reason: "",
  });
}


export function emitterReachStrength(candidate, gridBounds, options) {
  const coverage = describeGridCoverage(candidate, gridBounds);
  if (!coverage.usable) return 0;
  const source = options === null || options === undefined || typeof options !== "object" ? {} : options;
  const attenuation = typeof source.distanceAttenuation === "function" ? source.distanceAttenuation : windowedInverseSquareAttenuation;
  const referenceFloorStuds = Math.max(0, readNumber(source.referenceFloorStuds, MSM_FAR_LIST_REFERENCE_FLOOR_STUDS));
  const referenceDistance = Math.max(coverage.nearestDistance, referenceFloorStuds);
  return emitterLuminousPower(candidate) * attenuation(referenceDistance, readNumber(candidate.range, 0));
}


export function describeFarListTierGate(tier) {
  const tierDecision = describeMsmTierPolicy(tier);
  const resolvedTier =
    typeof tierDecision.tier === "string" && tierDecision.tier !== ""
      ? tierDecision.tier
      : String(tier === null || tier === undefined ? "" : tier);
  if (!tierDecision.runs) {
    return Object.freeze({
      tier: resolvedTier,
      carriesFarList: false,
      capacity: 0,
      sleepReason: MSM_FAR_LIST_SLEEP_REASON.MSM_ASLEEP_ON_TIER,
      reason: tierDecision.reason,
    });
  }
  if (MSM_FAR_LIST_TIERS.indexOf(resolvedTier) === -1) {
    return Object.freeze({
      tier: resolvedTier,
      carriesFarList: false,
      capacity: 0,
      sleepReason: MSM_FAR_LIST_SLEEP_REASON.TIER_WITHOUT_FAR_LIST,
      reason: "§8 MSM-F10 pede tier lite+: o micro dorme sem far list (e a far list e o degrau 6 da escada do §6.3)",
    });
  }
  return Object.freeze({
    tier: resolvedTier,
    carriesFarList: true,
    capacity: MSM_FAR_LIST_CAPACITY,
    sleepReason: "",
    reason: "tier lite+ carrega a far list dos 8 emissores mais fortes (§5.3)",
  });
}


export function farListCapacityForTier(tier) {
  return describeFarListTierGate(tier).capacity;
}


function clampCapacity(value) {
  const requested = Math.trunc(readNumber(value, MSM_FAR_LIST_CAPACITY));
  if (!(requested >= 1)) return MSM_FAR_LIST_CAPACITY;
  return Math.min(requested, MSM_FAR_LIST_CAPACITY);
}

function createEmptyEntry() {
  return {
    lightIndex: MSM_GRID_EMPTY_SLOT,
    lightId: 0,
    strength: 0,
    rankingKey: 0,
    distanceToGrid: 0,
    candidacy: "",
    heldByHysteresis: false,
  };
}

function clearEntry(entry) {
  entry.lightIndex = MSM_GRID_EMPTY_SLOT;
  entry.lightId = 0;
  entry.strength = 0;
  entry.rankingKey = 0;
  entry.distanceToGrid = 0;
  entry.candidacy = "";
  entry.heldByHysteresis = false;
}


export function createFarListBuilder(options) {
  const source = options === null || options === undefined || typeof options !== "object" ? {} : options;
  const capacity = clampCapacity(source.capacity);
  const promotionMargin = Math.max(0, readNumber(source.promotionMargin, MSM_FAR_LIST_DEFAULT_PROMOTION_MARGIN));
  const referenceFloorStuds = Math.max(0, readNumber(source.referenceFloorStuds, MSM_FAR_LIST_REFERENCE_FLOOR_STUDS));
  const distanceAttenuation =
    typeof source.distanceAttenuation === "function" ? source.distanceAttenuation : windowedInverseSquareAttenuation;

  const bounds = new Float64Array(6);
  const slots = new Int32Array(capacity);
  const previousSlots = new Int32Array(capacity);
  const reachByLightIndex = new Uint8Array(MSM_GRID_MAX_LIGHT_COUNT + 1);
  const residentByLightIndex = new Uint8Array(MSM_GRID_MAX_LIGHT_COUNT + 1);
  const seenLightIndex = new Uint8Array(MSM_GRID_MAX_LIGHT_COUNT + 1);
  const orderedEntries = [];
  for (let slot = 0; slot < capacity; slot += 1) orderedEntries.push(createEmptyEntry());

  const refusals = {
    notARecord: 0,
    lightIndexOutOfRange: 0,
    duplicatedLightIndex: 0,
    disabledLight: 0,
    invalidPosition: 0,
    noReachIntoGrid: 0,
    zeroStrength: 0,
  };
  const problems = [];
  const result = {
    phase: MSM_FAR_LIST_PHASE_ID,
    tier: "",
    enabled: false,
    sleepReason: "",
    capacity,
    promotionMargin,
    coverageSource: "",
    residentSetSize: -1,
    entries: orderedEntries,
    entryCount: 0,
    slots,
    reachByLightIndex,
    consideredCount: 0,
    gridResidentCount: 0,
    candidateCount: 0,
    droppedCount: 0,
    carriedStrengthSum: 0,
    candidateStrengthSum: 0,
    droppedStrengthSum: 0,
    strengthCoverage: 1,
    saturated: false,
    refusals,
    problems,
  };

  let entryCount = 0;
  let residentMarkCount = 0;

  function markResidentLightIndex(value) {
    const lightIndex = Math.trunc(readNumber(value, 0));
    if (!(lightIndex >= 1) || lightIndex > MSM_GRID_MAX_LIGHT_COUNT) return;
    if (residentByLightIndex[lightIndex] === 1) return;
    residentByLightIndex[lightIndex] = 1;
    residentMarkCount += 1;
  }


  function fillResidentTable(gridResidentLightIndices) {
    residentByLightIndex.fill(0);
    residentMarkCount = 0;
    if (gridResidentLightIndices === null || gridResidentLightIndices === undefined) return -1;
    if (typeof gridResidentLightIndices.length === "number") {
      for (let index = 0; index < gridResidentLightIndices.length; index += 1) {
        markResidentLightIndex(gridResidentLightIndices[index]);
      }
      return residentMarkCount;
    }
    if (typeof gridResidentLightIndices.forEach === "function") {
      gridResidentLightIndices.forEach(markResidentLightIndex);
      return residentMarkCount;
    }
    return -1;
  }

  function clearSelection() {
    entryCount = 0;
    slots.fill(MSM_GRID_EMPTY_SLOT);
    reachByLightIndex.fill(MSM_EMITTER_REACH.ABSENT);
    seenLightIndex.fill(0);
    for (let slot = 0; slot < capacity; slot += 1) clearEntry(orderedEntries[slot]);
    refusals.notARecord = 0;
    refusals.lightIndexOutOfRange = 0;
    refusals.duplicatedLightIndex = 0;
    refusals.disabledLight = 0;
    refusals.invalidPosition = 0;
    refusals.noReachIntoGrid = 0;
    refusals.zeroStrength = 0;
    problems.length = 0;
    result.entryCount = 0;
    result.coverageSource = "";
    result.residentSetSize = -1;
    result.consideredCount = 0;
    result.gridResidentCount = 0;
    result.candidateCount = 0;
    result.droppedCount = 0;
    result.carriedStrengthSum = 0;
    result.candidateStrengthSum = 0;
    result.droppedStrengthSum = 0;
    result.strengthCoverage = 1;
    result.saturated = false;
  }

  function sleep(sleepReason) {
    result.enabled = false;
    result.sleepReason = sleepReason;
    previousSlots.fill(MSM_GRID_EMPTY_SLOT);
    return result;
  }

  function wasInPreviousList(lightIndex) {
    for (let slot = 0; slot < capacity; slot += 1) {
      if (previousSlots[slot] === lightIndex) return true;
    }
    return false;
  }


  function beatsEntry(rankingKey, lightId, entry) {
    if (rankingKey > entry.rankingKey) return true;
    if (entry.rankingKey > rankingKey) return false;
    return entry.lightId > lightId;
  }

  function insertCandidate(lightIndex, lightId, strength, rankingKey, distanceToGrid, candidacy, heldByHysteresis) {
    let insertIndex = 0;
    while (insertIndex < entryCount && !beatsEntry(rankingKey, lightId, orderedEntries[insertIndex])) insertIndex += 1;
    if (insertIndex >= capacity) return;
    const recycledIndex = entryCount >= capacity ? capacity - 1 : entryCount;
    const recycledEntry = orderedEntries[recycledIndex];
    for (let position = recycledIndex; position > insertIndex; position -= 1) {
      orderedEntries[position] = orderedEntries[position - 1];
    }
    orderedEntries[insertIndex] = recycledEntry;
    recycledEntry.lightIndex = lightIndex;
    recycledEntry.lightId = lightId;
    recycledEntry.strength = strength;
    recycledEntry.rankingKey = rankingKey;
    recycledEntry.distanceToGrid = distanceToGrid;
    recycledEntry.candidacy = candidacy;
    recycledEntry.heldByHysteresis = heldByHysteresis;
    if (entryCount < capacity) entryCount += 1;
  }

  function rebuild(request) {
    const input = request === null || request === undefined || typeof request !== "object" ? {} : request;
    const tierGate = describeFarListTierGate(input.tier);
    clearSelection();
    result.tier = tierGate.tier;

    if (input.soldByGovernor === true) return sleep(MSM_FAR_LIST_SLEEP_REASON.SOLD_BY_GOVERNOR);
    if (!tierGate.carriesFarList) return sleep(tierGate.sleepReason);
    if (!writeGridBounds(input.gridBounds, bounds)) return sleep(MSM_FAR_LIST_SLEEP_REASON.GRID_BOUNDS_UNKNOWN);

    const residentSetSize = fillResidentTable(input.gridResidentLightIndices);
    const hasResidentSet = residentSetSize >= 0;
    result.residentSetSize = residentSetSize;
    result.coverageSource = hasResidentSet
      ? MSM_FAR_LIST_COVERAGE_SOURCE.GRID_RESIDENT_SET
      : MSM_FAR_LIST_COVERAGE_SOURCE.GEOMETRIC_FALLBACK;

    const lights = Array.isArray(input.lights) ? input.lights : [];
    for (let index = 0; index < lights.length; index += 1) {
      const candidate = lights[index];
      if (candidate === null || candidate === undefined || typeof candidate !== "object") {
        refusals.notARecord += 1;
        continue;
      }
      const lightIndex = Math.trunc(readNumber(candidate.lightIndex, 0));
      if (!(lightIndex >= 1) || lightIndex > MSM_GRID_MAX_LIGHT_COUNT) {
        refusals.lightIndexOutOfRange += 1;
        continue;
      }
      if (seenLightIndex[lightIndex] === 1) {
        refusals.duplicatedLightIndex += 1;
        continue;
      }
      seenLightIndex[lightIndex] = 1;
      if (candidate.enabled === false) {
        refusals.disabledLight += 1;
        continue;
      }
      const positionX = readVectorComponent(candidate.position, "x", 0, Number.NaN);
      const positionY = readVectorComponent(candidate.position, "y", 1, Number.NaN);
      const positionZ = readVectorComponent(candidate.position, "z", 2, Number.NaN);
      if (!Number.isFinite(positionX) || !Number.isFinite(positionY) || !Number.isFinite(positionZ)) {
        refusals.invalidPosition += 1;
        continue;
      }

      result.consideredCount += 1;
      const range = readNumber(candidate.range, 0);
      const nearestDistance = nearestDistanceToBounds(positionX, positionY, positionZ, bounds);
      const farthestDistance = farthestDistanceToBounds(positionX, positionY, positionZ, bounds);
      const candidacy = hasResidentSet
        ? (residentByLightIndex[lightIndex] === 1
            ? MSM_FAR_LIST_CANDIDACY.GRID_CELL_LIST
            : MSM_FAR_LIST_CANDIDACY.NOT_IN_RESIDENT_SET)
        : candidacyFromGeometry(range, nearestDistance, farthestDistance);

      if (candidacy === MSM_FAR_LIST_CANDIDACY.GRID_CELL_LIST) {
        reachByLightIndex[lightIndex] = MSM_EMITTER_REACH.GRID_CELL_LIST;
        result.gridResidentCount += 1;
        continue;
      }

      const referenceDistance = Math.max(nearestDistance, referenceFloorStuds);
      const strength = emitterLuminousPower(candidate) * distanceAttenuation(referenceDistance, range);
      if (!(strength > 0)) {

        if (nearestDistance > range && Number.isFinite(range) && range > 0) refusals.noReachIntoGrid += 1;
        else refusals.zeroStrength += 1;
        continue;
      }

      reachByLightIndex[lightIndex] = MSM_EMITTER_REACH.DROPPED;
      result.candidateCount += 1;
      result.candidateStrengthSum += strength;
      const lightId = readNumber(candidate.lightId, lightIndex);
      const heldByHysteresis = promotionMargin > 0 && wasInPreviousList(lightIndex);
      const rankingKey = heldByHysteresis ? strength * (1 + promotionMargin) : strength;
      insertCandidate(lightIndex, lightId, strength, rankingKey, nearestDistance, candidacy, heldByHysteresis);
    }

    for (let slot = 0; slot < capacity; slot += 1) {
      if (slot >= entryCount) {
        slots[slot] = MSM_GRID_EMPTY_SLOT;
        continue;
      }
      const entry = orderedEntries[slot];
      slots[slot] = entry.lightIndex;
      reachByLightIndex[entry.lightIndex] = MSM_EMITTER_REACH.FAR_LIST;
      result.carriedStrengthSum += entry.strength;
    }

    result.entryCount = entryCount;
    result.droppedCount = result.candidateCount - entryCount;
    result.droppedStrengthSum = Math.max(0, result.candidateStrengthSum - result.carriedStrengthSum);
    result.strengthCoverage =
      result.candidateStrengthSum > 0 ? result.carriedStrengthSum / result.candidateStrengthSum : 1;
    result.saturated = result.candidateCount > capacity;
    result.enabled = true;
    result.sleepReason = "";

    if (result.saturated) {
      problems.push(
        `far list saturada: ${result.candidateCount} emissores fora do grid para ${capacity} slots (${result.droppedCount} descartados, ${(result.strengthCoverage * 100).toFixed(2)}% da forca carregada)`,
      );
    }
    if (refusals.noReachIntoGrid > 0) {
      problems.push(`${refusals.noReachIntoGrid} luz(es) fora do grid sem alcance no volume: contribuicao zero, ver residuo declarado`);
    }

    previousSlots.set(slots);
    return result;
  }

  return {
    capacity,
    promotionMargin,
    referenceFloorStuds,
    rebuild,
    inspect: function inspect() {
      return result;
    },
  };
}

function freezeFarList(result) {
  const entries = [];
  for (let slot = 0; slot < result.entryCount; slot += 1) {
    const entry = result.entries[slot];
    entries.push(
      Object.freeze({
        lightIndex: entry.lightIndex,
        lightId: entry.lightId,
        strength: entry.strength,
        rankingKey: entry.rankingKey,
        distanceToGrid: entry.distanceToGrid,
        candidacy: entry.candidacy,
        heldByHysteresis: entry.heldByHysteresis,
      }),
    );
  }
  return Object.freeze({
    phase: result.phase,
    tier: result.tier,
    enabled: result.enabled,
    sleepReason: result.sleepReason,
    capacity: result.capacity,
    promotionMargin: result.promotionMargin,
    coverageSource: result.coverageSource,
    residentSetSize: result.residentSetSize,
    entries: Object.freeze(entries),
    entryCount: result.entryCount,
    slots: Object.freeze(Array.from(result.slots)),
    reachByLightIndex: Object.freeze(Array.from(result.reachByLightIndex)),
    consideredCount: result.consideredCount,
    gridResidentCount: result.gridResidentCount,
    candidateCount: result.candidateCount,
    droppedCount: result.droppedCount,
    carriedStrengthSum: result.carriedStrengthSum,
    candidateStrengthSum: result.candidateStrengthSum,
    droppedStrengthSum: result.droppedStrengthSum,
    strengthCoverage: result.strengthCoverage,
    saturated: result.saturated,
    refusals: Object.freeze({
      notARecord: result.refusals.notARecord,
      lightIndexOutOfRange: result.refusals.lightIndexOutOfRange,
      duplicatedLightIndex: result.refusals.duplicatedLightIndex,
      disabledLight: result.refusals.disabledLight,
      invalidPosition: result.refusals.invalidPosition,
      noReachIntoGrid: result.refusals.noReachIntoGrid,
      zeroStrength: result.refusals.zeroStrength,
    }),
    problems: Object.freeze(result.problems.slice()),
  });
}


export function selectFarList(request) {
  const input = request === null || request === undefined || typeof request !== "object" ? {} : request;
  const builder = createFarListBuilder({
    capacity: input.capacity,
    promotionMargin: input.promotionMargin,
    referenceFloorStuds: input.referenceFloorStuds,
    distanceAttenuation: input.distanceAttenuation,
  });
  return freezeFarList(builder.rebuild(input));
}


export function farListSlotsForUniform(result) {
  const uniformSlots = new Array(MSM_FAR_LIST_CAPACITY);
  for (let slot = 0; slot < MSM_FAR_LIST_CAPACITY; slot += 1) {
    const hasResult = result !== null && result !== undefined && result.slots !== undefined && result.enabled === true;
    const value = hasResult && slot < result.slots.length ? result.slots[slot] : MSM_GRID_EMPTY_SLOT;
    uniformSlots[slot] = Math.trunc(readNumber(value, MSM_GRID_EMPTY_SLOT));
  }
  return uniformSlots;
}

function reachOf(result, lightIndex) {
  if (result === null || result === undefined || result.reachByLightIndex === undefined) return MSM_EMITTER_REACH.ABSENT;
  const index = Math.trunc(readNumber(lightIndex, 0));
  if (!(index >= 1) || index > MSM_GRID_MAX_LIGHT_COUNT) return MSM_EMITTER_REACH.ABSENT;
  return result.reachByLightIndex[index];
}


export function isEmitterConsiderable(result, lightIndex) {
  const reach = reachOf(result, lightIndex);
  return reach === MSM_EMITTER_REACH.GRID_CELL_LIST || reach === MSM_EMITTER_REACH.FAR_LIST;
}


export function describeEmitterReach(result, lightIndex) {
  const reach = reachOf(result, lightIndex);
  const reasonByReach = {
    0: "emissor ausente do rebuild (ou a far list esta dormindo)",
    1: "resolvido pela lista da celula do grid (dono: F8)",
    2: "carregado pela far list dos emissores fortes (MSM-F10)",
    3: "fora do grid e mais fraco que os primeiros da far list: perda declarada",
  };
  return Object.freeze({
    lightIndex: Math.trunc(readNumber(lightIndex, 0)),
    reach,
    considerable: reach === MSM_EMITTER_REACH.GRID_CELL_LIST || reach === MSM_EMITTER_REACH.FAR_LIST,
    reason: reasonByReach[reach],
  });
}


export function describeFarList(result) {
  if (result === null || result === undefined) return `${MSM_FAR_LIST_PHASE_ID}: sem resultado`;
  if (result.enabled !== true) return `${MSM_FAR_LIST_PHASE_ID}: dormindo (${result.sleepReason}) no tier ${result.tier}`;
  return (
    `${MSM_FAR_LIST_PHASE_ID}: ${result.entryCount}/${result.capacity} slots, ` +
    `${result.gridResidentCount} no grid, ${result.candidateCount} fora, ${result.droppedCount} descartados, ` +
    `forca carregada ${(result.strengthCoverage * 100).toFixed(2)}%, fonte ${result.coverageSource}`
  );
}
