import { getSecureRandomBytes } from "../../cloud/secureTokenGenerator.js";

const MASK_64 = 0xffffffffffffffffn;
const SPLITMIX64_INCREMENT = 0x9e3779b97f4a7c15n;
const FIRST_MIX_MULTIPLIER = 0xbf58476d1ce4e5b9n;
const SECOND_MIX_MULTIPLIER = 0x94d049bb133111ebn;
const MANTISSA_SHIFT = 11n;                                        
const MANTISSA_DIVISOR = 9007199254740992;        
const SEED_BYTE_COUNT = 8;
const SEED_BYTE_MULTIPLIER = 256n;                                           
const FALLBACK_SEED = 1n;


function seedFromSecureRandomBytes() {
  let seed = 0n;
  for (const byte of getSecureRandomBytes(SEED_BYTE_COUNT)) {
    seed = ((seed * SEED_BYTE_MULTIPLIER) | BigInt(byte)) & MASK_64;
  }
  return seed === 0n ? FALLBACK_SEED : seed;
}

function normalizeSeed(requestedSeed) {
  const seedAsNumber = Number(requestedSeed);
  if (!Number.isFinite(seedAsNumber)) return seedFromSecureRandomBytes();
  const truncated = BigInt(Math.trunc(seedAsNumber)) & MASK_64;
  return truncated === 0n ? FALLBACK_SEED : truncated;
}


function mixState(state) {
  let mixed = state;
  mixed = ((mixed ^ (mixed >> 30n)) * FIRST_MIX_MULTIPLIER) & MASK_64;
  mixed = ((mixed ^ (mixed >> 27n)) * SECOND_MIX_MULTIPLIER) & MASK_64;
  return (mixed ^ (mixed >> 31n)) & MASK_64;
}


export function createLuauRandomGenerator(explicitSeed) {
  let state = normalizeSeed(explicitSeed);

  function nextUnsignedInteger() {
    state = (state + SPLITMIX64_INCREMENT) & MASK_64;
    return mixState(state);
  }

  return {

    nextUnitFloat() {
      return Number(nextUnsignedInteger() >> MANTISSA_SHIFT) / MANTISSA_DIVISOR;
    },
    reseed(seed) {
      state = normalizeSeed(seed);
    },
  };
}
