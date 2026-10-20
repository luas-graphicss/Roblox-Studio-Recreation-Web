import { readJSON, writeJSON } from "../utils/storage.js";
import { bus } from "../core/eventBus.js";
import { loadChangelogEntries } from "./changelogSource.js";

const SEEN_KEY = "whatsNewSeen";

function readSeenIds() {
  const raw = readJSON(SEEN_KEY);
  return new Set(Array.isArray(raw) ? raw.filter((id) => typeof id === "string") : []);
}

function selectUnseenIds(entries, seenIds) {
  const unseenIds = [];
  for (const entry of entries) {
    if (!seenIds.has(entry.id)) unseenIds.push(entry.id);
  }
  return unseenIds;
}

export async function getUnseenIds() {
  const entries = await loadChangelogEntries();
  return selectUnseenIds(entries, readSeenIds());
}

export async function getUnseenCount() {
  const unseenIds = await getUnseenIds();
  return unseenIds.length;
}


export async function markAllSeen() {
  const entries = await loadChangelogEntries();
  const unseenCountBefore = selectUnseenIds(entries, readSeenIds()).length;
  if (entries.length > 0) writeJSON(SEEN_KEY, entries.map((entry) => entry.id));
  if (unseenCountBefore > 0) bus.emit("whatsnew:seen", { unseen: 0 });
  return unseenCountBefore;
}
