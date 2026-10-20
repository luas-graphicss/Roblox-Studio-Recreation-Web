import { generateSecureToken, getSecureRandomBytes } from "../cloud/secureTokenGenerator.js";

const RESOURCE_ID_RANDOM_LENGTH = 12;
const SESSION_TOKEN_LENGTH = 8;
const NUMERIC_ID_BYTE_COUNT = 4;
const UINT32_RANGE = 4294967296;

export function createResourceId(prefix) {
  const timestampPart = Date.now().toString(36);
  const randomPart = generateSecureToken("", RESOURCE_ID_RANDOM_LENGTH);
  return String(prefix == null ? "" : prefix) + timestampPart + "_" + randomPart;
}

export function createSessionScopedIdFactory(prefix) {
  let sessionToken = "";
  let createdCount = 0;
  return function createSessionScopedId() {


    if (!sessionToken) sessionToken = generateSecureToken("", SESSION_TOKEN_LENGTH);
    createdCount += 1;
    return String(prefix == null ? "" : prefix) + sessionToken + "_" + createdCount.toString(36);
  };
}

function readSecureUint32() {
  const randomBytes = getSecureRandomBytes(NUMERIC_ID_BYTE_COUNT);
  return ((randomBytes[0] * 256 + randomBytes[1]) * 256 + randomBytes[2]) * 256 + randomBytes[3];
}


export function createSecureNumericId(minimumValue, maximumValue) {
  const rangeSize = maximumValue - minimumValue + 1;
  const rejectionCeiling = Math.floor(UINT32_RANGE / rangeSize) * rangeSize;
  let drawnValue = readSecureUint32();
  while (drawnValue >= rejectionCeiling) drawnValue = readSecureUint32();
  return minimumValue + (drawnValue % rangeSize);
}
