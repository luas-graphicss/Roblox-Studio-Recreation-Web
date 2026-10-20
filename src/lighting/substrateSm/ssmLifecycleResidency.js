import { getSubstrateSmProfile } from './ssmContract.js';
import { createSubstrateSmRecipeMemoryLedger } from './ssmRecipeMemoryLedger.js';

function requireAmount(value, field) {
  if (!Number.isSafeInteger(value) || value < 0) throw new RangeError(`SSM_RESIDENCY_INVALID_${field}`);
  return value;
}

export function createSubstrateSmLifecycleResidency({
  profile = 'Lite',
  memoryLedger,
  derivedTexturePeakBytes,
  maxProgramVariants,
} = {}) {
  const settings = getSubstrateSmProfile(profile);
  if (!settings) throw new TypeError('SSM_RESIDENCY_PROFILE_INVALID');
  const ledger = memoryLedger ?? createSubstrateSmRecipeMemoryLedger({ profile });
  if (ledger.profile !== profile) throw new TypeError('SSM_RESIDENCY_PROFILE_MISMATCH');
  const textureLimit = derivedTexturePeakBytes ?? settings.limits.derivedTexturePeakBytes;
  const programLimit = maxProgramVariants ?? settings.limits.familyVariants;
  requireAmount(textureLimit, 'textureLimit');
  requireAmount(programLimit, 'programLimit');
  if (
    textureLimit > settings.limits.derivedTexturePeakBytes ||
    programLimit > settings.limits.familyVariants
  ) {
    throw new RangeError('SSM_RESIDENCY_PROFILE_LIMIT_EXCEEDED');
  }
  const reservations = new Map();
  const programReferences = new Map();
  let textureBytes = 0;
  let peakTextureBytes = 0;
  let peakPrograms = 0;
  let peakReservations = 0;
  let refused = 0;

  function reserve(owner, { cost, programKey, contextGeneration }) {
    if (owner === undefined || owner === null || reservations.has(owner))
      throw new TypeError('SSM_RESIDENCY_OWNER_INVALID');
    if (!cost || typeof cost !== 'object') throw new TypeError('SSM_RESIDENCY_COST_REQUIRED');
    if (typeof programKey !== 'string' || !programKey || programKey.length > 8192)
      throw new TypeError('SSM_RESIDENCY_PROGRAM_KEY_REQUIRED');
    requireAmount(contextGeneration, 'contextGeneration');
    for (const field of ['residentRecipes', 'numericBufferBytes', 'cpuCacheBytes', 'derivedTextureBytes'])
      requireAmount(cost[field], field);
    if (
      cost.residentRecipes !== 1 ||
      cost.numericBufferBytes < settings.limits.payloadBytes ||
      cost.cpuCacheBytes < cost.numericBufferBytes
    )
      throw new RangeError('SSM_RESIDENCY_COST_UNDERREPORTED');
    const sharedKey = `${contextGeneration}:${programKey}`;
    const existing = programReferences.get(sharedKey) ?? 0;
    if (
      textureBytes + cost.derivedTextureBytes > textureLimit ||
      (!existing && programReferences.size >= programLimit)
    ) {
      refused += 1;
      return false;
    }
    const cpuCacheBytes = cost.cpuCacheBytes + 256 + sharedKey.length * 2;
    if (!Number.isSafeInteger(cpuCacheBytes) || !ledger.reserve(owner, { ...cost, cpuCacheBytes })) {
      refused += 1;
      return false;
    }
    reservations.set(owner, { derivedTextureBytes: cost.derivedTextureBytes, sharedKey });
    programReferences.set(sharedKey, existing + 1);
    textureBytes += cost.derivedTextureBytes;
    peakTextureBytes = Math.max(peakTextureBytes, textureBytes);
    peakPrograms = Math.max(peakPrograms, programReferences.size);
    peakReservations = Math.max(peakReservations, reservations.size);
    return true;
  }

  function release(owner) {
    const reservation = reservations.get(owner);
    if (!reservation) return false;
    const references = programReferences.get(reservation.sharedKey) - 1;
    if (references === 0) programReferences.delete(reservation.sharedKey);
    else programReferences.set(reservation.sharedKey, references);
    textureBytes -= reservation.derivedTextureBytes;
    reservations.delete(owner);
    ledger.release(owner);
    return true;
  }

  function readStatistics() {
    return Object.freeze({
      profile,
      reservations: reservations.size,
      derivedTextureBytes: textureBytes,
      derivedTexturePeakBytes: textureLimit,
      programVariants: programReferences.size,
      maxProgramVariants: programLimit,
      peakTextureBytes,
      peakPrograms,
      peakReservations,
      refused,
      driverProgramBytes: null,
      driverProgramBytesMeasured: false,
      memory: ledger.readStatistics(),
    });
  }

  return Object.freeze({ profile, memoryLedger: ledger, reserve, release, readStatistics });
}
