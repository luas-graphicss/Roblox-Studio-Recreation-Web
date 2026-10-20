export const DATA_STORE_ID_SEPARATOR = "\u0001";                                     
export const LOCAL_UNIVERSE_ID = "local";

const CURRENT_ID_SEGMENT_COUNT = 5;
const LEGACY_ID_SEGMENT_COUNT = 4;

function countIdSegments(entryId) {
  return String(entryId == null ? "" : entryId).split(DATA_STORE_ID_SEPARATOR).length;
}

export function normalizeUniverseId(universeId) {
  const normalizedUniverseId = String(universeId == null ? "" : universeId).trim();
  return normalizedUniverseId || LOCAL_UNIVERSE_ID;
}

export function buildDataStoreEntryId({ projectId, universeId, storeName, scope, entryKey }) {
  return [
    String(projectId),
    normalizeUniverseId(universeId),
    String(storeName),
    String(scope),
    String(entryKey),
  ].join(DATA_STORE_ID_SEPARATOR);
}


export function isLegacyDataStoreEntryId(entryId) {
  return countIdSegments(entryId) === LEGACY_ID_SEGMENT_COUNT;
}

export function isCurrentDataStoreEntryId(entryId) {
  return countIdSegments(entryId) === CURRENT_ID_SEGMENT_COUNT;
}
