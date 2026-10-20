import { readJSON, writeJSON } from "../utils/storage.js";

const RECENTS_KEY = "startRecents";
const ARCHIVE_KEY = "startArchive";

export const MAX_RECENTS = 50;
const MAX_ARCHIVED = 500;

function sanitizeEntry(raw) {
  if (!raw || typeof raw !== "object") return null;
  const kind = raw.kind === "idb" || raw.kind === "file" ? raw.kind : null;
  if (!kind) return null;
  const name = String(raw.name == null ? "" : raw.name).slice(0, 200).trim();
  if (!name) return null;
  const id = kind === "idb" ? String(raw.id == null ? "" : raw.id).slice(0, 80) : "";
  if (kind === "idb" && !id) return null;


  const openedAt = typeof raw.openedAt === "string" && Number.isFinite(Date.parse(raw.openedAt))
    ? raw.openedAt
    : new Date().toISOString();
  return { kind, id, name, openedAt };
}

export function recentKeyOf(entry) {
  if (!entry) return "";


  return entry.kind === "idb" ? "idb:" + entry.id : "file:" + String(entry.name || "");
}

export function listRecents() {
  const raw = readJSON(RECENTS_KEY);
  if (!Array.isArray(raw)) return [];
  const seen = new Set();
  const out = [];
  for (const item of raw) {
    const entry = sanitizeEntry(item);
    if (!entry) continue;
    const key = recentKeyOf(entry);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(entry);
    if (out.length >= MAX_RECENTS) break;
  }
  return out;
}

export function recordRecent(raw) {
  const entry = sanitizeEntry(Object.assign({}, raw, { openedAt: new Date().toISOString() }));
  if (!entry) return listRecents();
  const key = recentKeyOf(entry);
  const rest = listRecents().filter((e) => recentKeyOf(e) !== key);
  const next = [entry].concat(rest).slice(0, MAX_RECENTS);
  writeJSON(RECENTS_KEY, next);
  return next;
}

export function removeRecent(key) {
  const next = listRecents().filter((e) => recentKeyOf(e) !== key);
  writeJSON(RECENTS_KEY, next);
  return next;
}

export function renameRecent(projectId, newName) {
  const sid = String(projectId);
  const clean = String(newName == null ? "" : newName).slice(0, 200).trim();
  const next = listRecents().map((e) =>
    e.kind === "idb" && e.id === sid && clean ? Object.assign({}, e, { name: clean }) : e
  );
  writeJSON(RECENTS_KEY, next);
  return next;
}

export function listArchivedIds() {
  const raw = readJSON(ARCHIVE_KEY);
  if (!Array.isArray(raw)) return [];
  const out = [];
  const seen = new Set();
  for (const v of raw) {
    if (typeof v !== "string" || !v || seen.has(v)) continue;
    seen.add(v);
    out.push(v);
    if (out.length >= MAX_ARCHIVED) break;
  }
  return out;
}

export function isArchived(id) {
  return listArchivedIds().indexOf(String(id)) !== -1;
}

export function setArchived(id, flag) {
  const sid = String(id);
  const cur = listArchivedIds().filter((v) => v !== sid);
  if (flag) cur.unshift(sid);


  const next = cur.slice(0, MAX_ARCHIVED);
  writeJSON(ARCHIVE_KEY, next);
  return next;
}

export function pruneMissing(existingIds) {
  const ids = new Set((existingIds || []).map((v) => String(v)));
  const recents = listRecents().filter((e) => e.kind !== "idb" || ids.has(e.id));
  writeJSON(RECENTS_KEY, recents);
  const archived = listArchivedIds().filter((id) => ids.has(id));
  writeJSON(ARCHIVE_KEY, archived);
  return { recents, archived };
}

export function timeAgo(iso, now) {
  const t = Date.parse(iso || "");
  if (!Number.isFinite(t)) return "";
  const ref = typeof now === "number" ? now : Date.now();
  const diff = Math.max(0, ref - t);
  const min = Math.floor(diff / 60000);
  if (min < 1) return "just now";
  if (min < 60) return min === 1 ? "1 minute ago" : min + " minutes ago";
  const hours = Math.floor(min / 60);
  if (hours < 24) return hours === 1 ? "1 hour ago" : hours + " hours ago";
  const days = Math.floor(hours / 24);
  if (days < 30) return days === 1 ? "1 day ago" : days + " days ago";
  const months = Math.floor(days / 30);
  if (months < 12) return months === 1 ? "1 month ago" : months + " months ago";
  const years = Math.floor(months / 12);
  return years === 1 ? "1 year ago" : years + " years ago";
}
