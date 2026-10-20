import { bus } from "../core/eventBus.js";

import { deepCloneJsonValue } from "../core/deepCloneJsonValue.js";
import { RuntimeEvents } from "./engine.js";

export const MS_LIMITS = Object.freeze({
  minTtlSec: 1,
  maxTtlSec: 3888000,
  maxValueBytes: 32 * 1024,
  maxKeyLen: 128,
  maxNameLen: 128,
  requestsPerMinute: 1200,
  maxReadCount: 100,
  maxRangeCount: 200,
});

const hashMaps = new Map();
const sortedMaps = new Map();
const queues = new Map();
let queueSeq = 1;
let rateWindowStart = 0;
let rateCount = 0;
let wired = false;

function wire() {
  if (wired) return;
  wired = true;
  bus.on(RuntimeEvents.ModeChanged, (p) => {
    if (!(p && p.running)) clearAll();
  });
}

export function clearAll() {
  hashMaps.clear();
  sortedMaps.clear();
  queues.clear();
  queueSeq = 1;
  rateWindowStart = 0;
  rateCount = 0;
}

export function tryConsumeRequest() {
  wire();
  const now = Date.now();
  if (now - rateWindowStart >= 60000) {
    rateWindowStart = now;
    rateCount = 0;
  }
  rateCount += 1;
  return rateCount <= MS_LIMITS.requestsPerMinute;
}

export function validateKey(key) {
  if (typeof key !== "string" && typeof key !== "number") return null;
  const k = String(key);
  if (!k.length || k.length > MS_LIMITS.maxKeyLen) return null;
  return k;
}

export function valueSizeOk(jsValue) {
  let s;
  try {
    s = JSON.stringify(jsValue);
  } catch (_) {
    return false;
  }
  if (s == null) return false;
  const bytes = typeof TextEncoder !== "undefined" ? new TextEncoder().encode(s).length : s.length;
  return bytes <= MS_LIMITS.maxValueBytes;
}

export function clampTtl(seconds) {
  return Math.max(MS_LIMITS.minTtlSec, Math.min(MS_LIMITS.maxTtlSec, Math.floor(seconds)));
}

function clone(v) {
  if (v === null || v === undefined) return v;
  try {
    return deepCloneJsonValue(v);
  } catch (_) {
    return v;
  }
}

function mapOf(root, name) {
  let m = root.get(name);
  if (!m) {
    m = new Map();
    root.set(name, m);
  }
  return m;
}

function liveEntry(map, key) {
  const e = map.get(key);
  if (!e) return null;
  if (e.expiresAt <= Date.now()) {
    map.delete(key);
    return null;
  }
  return e;
}

export function hashSet(name, key, value, ttlSec) {
  wire();
  mapOf(hashMaps, name).set(key, { value: clone(value), expiresAt: Date.now() + ttlSec * 1000 });
}

export function hashGet(name, key) {
  wire();
  const e = liveEntry(mapOf(hashMaps, name), key);
  return e ? clone(e.value) : null;
}

export function hashRemove(name, key) {
  wire();
  mapOf(hashMaps, name).delete(key);
}

export function sortedSet(name, key, value, ttlSec, sortKey) {
  wire();
  mapOf(sortedMaps, name).set(key, {
    value: clone(value),
    sortKey: sortKey === undefined ? null : sortKey,
    expiresAt: Date.now() + ttlSec * 1000,
  });
}

export function sortedGet(name, key) {
  wire();
  const e = liveEntry(mapOf(sortedMaps, name), key);
  return e ? clone(e.value) : null;
}

export function sortedRemove(name, key) {
  wire();
  mapOf(sortedMaps, name).delete(key);
}

function rankOf(key, e) {
  return e.sortKey !== null && e.sortKey !== undefined ? e.sortKey : key;
}

function compareRank(a, b) {
  const ta = typeof a === "number" ? 0 : 1;
  const tb = typeof b === "number" ? 0 : 1;
  if (ta !== tb) return ta - tb;
  if (a < b) return -1;
  if (a > b) return 1;
  return 0;
}

export function sortedRange(name, direction, count, exclusiveLower, exclusiveUpper) {
  wire();
  const map = mapOf(sortedMaps, name);
  const now = Date.now();
  const items = [];
  for (const [key, e] of map) {
    if (e.expiresAt <= now) {
      map.delete(key);
      continue;
    }
    items.push({ key, value: clone(e.value), rank: rankOf(key, e) });
  }
  items.sort((x, y) => compareRank(x.rank, y.rank) || compareRank(x.key, y.key));
  if (String(direction) === "Descending") items.reverse();


  const entriesWithinBounds = items.filter((item) => {
    const isAboveLowerBound = exclusiveLower == null || compareRank(item.rank, exclusiveLower) > 0;
    const isBelowUpperBound = exclusiveUpper == null || compareRank(item.rank, exclusiveUpper) < 0;
    return isAboveLowerBound && isBelowUpperBound;
  });
  return entriesWithinBounds
    .slice(0, Math.max(1, count))
    .map((item) => ({ key: item.key, value: item.value }));
}

function queueOf(name) {
  let q = queues.get(name);
  if (!q) {
    q = { items: [] };
    queues.set(name, q);
  }
  return q;
}

export function queueAdd(name, value, ttlSec, priority) {
  wire();
  const q = queueOf(name);
  const id = "q" + (queueSeq++).toString(36) + "_" + Math.random().toString(36).slice(2, 8);
  q.items.push({
    id,
    value: clone(value),
    priority: Number.isFinite(Number(priority)) ? Number(priority) : 0,
    addedAt: Date.now(),
    expiresAt: Date.now() + ttlSec * 1000,
    invisibleUntil: 0,
  });
  return id;
}

export function queueRead(name, count, allOrNothing, invisibilityTimeoutSec) {
  wire();
  const q = queueOf(name);
  const now = Date.now();
  q.items = q.items.filter((it) => it.expiresAt > now);
  const visible = q.items.filter((it) => it.invisibleUntil <= now);
  visible.sort((a, b) => (b.priority - a.priority) || (a.addedAt - b.addedAt));
  const take = visible.slice(0, Math.max(1, count));
  if (!take.length || (allOrNothing && take.length < count)) return { items: [], ids: [] };
  const until = now + Math.max(1, invisibilityTimeoutSec) * 1000;
  for (const it of take) it.invisibleUntil = until;
  return { items: take.map((t) => clone(t.value)), ids: take.map((t) => t.id) };
}

export function queueRemove(name, ids) {
  wire();
  const q = queueOf(name);
  const set = new Set(Array.isArray(ids) ? ids.map(String) : [String(ids)]);
  q.items = q.items.filter((it) => !set.has(it.id));
}
