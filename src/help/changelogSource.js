import { fetchPublicJson } from "../utils/publicAsset.js";
import { normalizeCategory } from "./changelogCategories.js";

export const CHANGELOG_JSON_PATH = "help/changelog.json";

const EMPTY_ENTRIES = Object.freeze([]);

let cachedEntries = null;
let inFlightLoad = null;
let lastLoadError = null;

function isUsableText(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function normalizeEntry(rawEntry) {
  if (!rawEntry || !isUsableText(rawEntry.id)) return null;
  return Object.freeze({
    id: rawEntry.id,
    date: isUsableText(rawEntry.date) ? rawEntry.date : "",
    category: normalizeCategory(rawEntry.category),
    title: isUsableText(rawEntry.title) ? rawEntry.title : rawEntry.id,
    description: typeof rawEntry.description === "string" ? rawEntry.description : "",
  });
}


export function normalizeChangelogPayload(payload) {
  const rawEntries = Array.isArray(payload) ? payload : payload && payload.entries;
  if (!Array.isArray(rawEntries)) return EMPTY_ENTRIES;
  const entries = [];
  const seenIds = new Set();
  for (const rawEntry of rawEntries) {
    const entry = normalizeEntry(rawEntry);
    if (!entry || seenIds.has(entry.id)) continue;
    seenIds.add(entry.id);
    entries.push(entry);
  }
  return Object.freeze(entries);
}

export function latestChangelogDate(entries) {
  let latest = "";
  for (const entry of entries) {
    if (typeof entry.date === "string" && entry.date > latest) latest = entry.date;
  }
  return latest;
}

export function loadChangelogEntries() {
  if (cachedEntries) return Promise.resolve(cachedEntries);
  if (!inFlightLoad) {
    inFlightLoad = fetchPublicJson(CHANGELOG_JSON_PATH)
      .then((payload) => {
        cachedEntries = normalizeChangelogPayload(payload);
        lastLoadError = null;
        return cachedEntries;
      })
      .catch((error) => {
        lastLoadError = error;
        inFlightLoad = null;                                                    
        try {
          console.warn("[help/changelogSource] changelog unavailable:", error);
        } catch {

        }
        return EMPTY_ENTRIES;
      });
  }
  return inFlightLoad;
}


export function getLoadedChangelogEntries() {
  return cachedEntries || EMPTY_ENTRIES;
}

export function getChangelogSourceState() {
  return {
    loaded: !!cachedEntries,
    entryCount: cachedEntries ? cachedEntries.length : 0,
    loading: !!inFlightLoad && !cachedEntries,
    lastLoadError: lastLoadError ? String((lastLoadError && lastLoadError.message) || lastLoadError) : null,
  };
}

export function resetChangelogSourceForTests() {
  cachedEntries = null;
  inFlightLoad = null;
  lastLoadError = null;
}
