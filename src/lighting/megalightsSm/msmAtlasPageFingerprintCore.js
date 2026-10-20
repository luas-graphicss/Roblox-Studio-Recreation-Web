export const MSM_PAGE_FINGERPRINT_UNKNOWN = 0;


const FNV_OFFSET_BASIS = 2166136261 | 0;
const FNV_PRIME = 16777619;


export const MSM_PAGE_POSITION_PRECISION = 1000;


export const MSM_PAGE_DIRECTION_PRECISION = 10000;


export const MSM_PAGE_FINGERPRINT_FIELDS = Object.freeze([
  "pageId",
  "lightId",
  "kind",
  "cubeFace",
  "resolution",
  "tileX",
  "tileY",
  "positionX",
  "positionY",
  "positionZ",
  "directionX",
  "directionY",
  "directionZ",
  "coneAngle",
  "range",
  "sceneRevision",
]);

function hashInteger(hash, value) {
  let mixed = hash;
  let remaining = value | 0;
  for (let byteIndex = 0; 4 > byteIndex; byteIndex += 1) {
    mixed = (mixed ^ (remaining & 255)) | 0;
    mixed = Math.imul(mixed, FNV_PRIME) | 0;
    remaining = remaining >>> 8;
  }
  return mixed;
}

function hashText(hash, text) {
  let mixed = hash;
  for (let charIndex = 0; text.length > charIndex; charIndex += 1) {
    mixed = (mixed ^ (text.charCodeAt(charIndex) & 255)) | 0;
    mixed = Math.imul(mixed, FNV_PRIME) | 0;
  }
  return hashInteger(mixed, text.length);
}

function isFiniteNumber(value) {
  return typeof value === "number" && Number.isFinite(value);
}


function comparableNumber(value, fallback) {
  if (value === undefined || value === null) return fallback;
  return isFiniteNumber(value) ? value : null;
}

function comparableText(value) {
  if (value === undefined || value === null) return "";
  if (typeof value === "string") return value;
  if (isFiniteNumber(value)) return String(value);
  return null;
}


export function isUsableSceneRevision(value) {
  if (isFiniteNumber(value)) return true;
  return typeof value === "string" && value.trim().length >= 1;
}








export function computeMsmAtlasPageFingerprint(input) {
  if (!input || typeof input !== "object") return MSM_PAGE_FINGERPRINT_UNKNOWN;
  if (!isUsableSceneRevision(input.sceneRevision)) return MSM_PAGE_FINGERPRINT_UNKNOWN;

  const pageId = comparableText(input.pageId);
  const lightId = comparableText(input.lightId);
  const kind = comparableText(input.kind);
  const sceneRevision = comparableText(input.sceneRevision);
  if (pageId === null || lightId === null || kind === null || sceneRevision === null) {
    return MSM_PAGE_FINGERPRINT_UNKNOWN;
  }

  const roundedNumbers = [
    comparableNumber(input.cubeFace, -1),
    comparableNumber(input.resolution, 0),
    comparableNumber(input.tileX, 0),
    comparableNumber(input.tileY, 0),
  ];
  const scaledNumbers = [
    [comparableNumber(input.positionX, 0), MSM_PAGE_POSITION_PRECISION],
    [comparableNumber(input.positionY, 0), MSM_PAGE_POSITION_PRECISION],
    [comparableNumber(input.positionZ, 0), MSM_PAGE_POSITION_PRECISION],
    [comparableNumber(input.directionX, 0), MSM_PAGE_DIRECTION_PRECISION],
    [comparableNumber(input.directionY, 0), MSM_PAGE_DIRECTION_PRECISION],
    [comparableNumber(input.directionZ, 0), MSM_PAGE_DIRECTION_PRECISION],
    [comparableNumber(input.coneAngle, 0), MSM_PAGE_DIRECTION_PRECISION],
    [comparableNumber(input.range, 0), MSM_PAGE_POSITION_PRECISION],
  ];

  let hash = FNV_OFFSET_BASIS;
  hash = hashText(hash, pageId);
  hash = hashText(hash, lightId);
  hash = hashText(hash, kind);

  for (let index = 0; roundedNumbers.length > index; index += 1) {
    const value = roundedNumbers[index];
    if (value === null) return MSM_PAGE_FINGERPRINT_UNKNOWN;
    hash = hashInteger(hash, Math.round(value));
  }

  for (let index = 0; scaledNumbers.length > index; index += 1) {
    const value = scaledNumbers[index][0];
    if (value === null) return MSM_PAGE_FINGERPRINT_UNKNOWN;
    hash = hashInteger(hash, Math.round(value * scaledNumbers[index][1]));
  }

  hash = hashText(hash, sceneRevision);


  return hash === MSM_PAGE_FINGERPRINT_UNKNOWN ? 1 : hash;
}
