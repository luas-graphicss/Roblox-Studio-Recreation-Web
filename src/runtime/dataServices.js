import { logger } from "../core/logger.js";

import { deepCloneJsonValue } from "../core/deepCloneJsonValue.js";
import { generateSecureToken } from "../cloud/secureTokenGenerator.js";
import {
  DATA_STORE_ID_SEPARATOR,
  LOCAL_UNIVERSE_ID,
  buildDataStoreEntryId,
  isLegacyDataStoreEntryId,
  normalizeUniverseId,
} from "./dataStoreKey.js";


export const DS_LIMITS = Object.freeze({
  maxValueBytes: 4 * 1024 * 1024,                 
  maxKeyLen: 50,
  maxNameLen: 50,
  maxScopeLen: 50,
  keyCooldownSec: 6,                                            
  queueTimeoutSec: 30,                                  
  jsonMaxBytes: 10 * 1024 * 1024,                                 
  jsonMaxDepth: 128,                                       
  msgMaxBytes: 1024,                                       
  topicMaxLen: 80,
  maxSubscriptionsPerTopic: 64,
  maxMockEntries: 200,
});

const DB_NAME = "rsw-datastores";
const STORE = "kv";
const SEP = DATA_STORE_ID_SEPARATOR;
const PROJECT_KEY = "rsw.ds.projectId";


const PROJECT_ID_PREFIX = "proj-";
const PROJECT_ID_RANDOM_LENGTH = 22;
const ENTRY_VERSION_RANDOM_LENGTH = 12;

function createProjectId() {
  return generateSecureToken(PROJECT_ID_PREFIX, PROJECT_ID_RANDOM_LENGTH);
}

let _projectId = null;
export function getProjectId() {
  if (_projectId) return _projectId;
  try {
    const ls = typeof localStorage !== "undefined" ? localStorage.getItem(PROJECT_KEY) : null;
    if (ls) { _projectId = ls; return _projectId; }
  } catch (_) {              }
  _projectId = createProjectId();
  try { if (typeof localStorage !== "undefined") localStorage.setItem(PROJECT_KEY, _projectId); } catch (_) {}
  return _projectId;
}
export function setProjectId(id) {
  _projectId = String(id || "").trim() || _projectId;
  try { if (typeof localStorage !== "undefined") localStorage.setItem(PROJECT_KEY, _projectId); } catch (_) {}

  mem.clear();
  hydratedProjects.clear();
  return _projectId;
}


let _universeId = LOCAL_UNIVERSE_ID;
export function getUniverseId() {
  return _universeId;
}
export function setUniverseId(universeId) {
  _universeId = normalizeUniverseId(universeId);
  return _universeId;
}
function resolveUniverseId(options) {
  const requestedUniverseId = options && options.universeId != null ? options.universeId : _universeId;
  return normalizeUniverseId(requestedUniverseId);
}


function clone(v) {
  if (v === null || v === undefined) return v;
  try { return deepCloneJsonValue(v); } catch (_) { return v; }
}
export function valueByteSize(jsValue) {
  let s;
  try { s = JSON.stringify(jsValue); } catch (_) { s = String(jsValue); }
  if (s == null) return 0;
  if (typeof TextEncoder !== "undefined") return new TextEncoder().encode(s).length;
  return s.length;
}
function idOf(pid, universeId, name, scope, key) {
  return buildDataStoreEntryId({
    projectId: pid,
    universeId,
    storeName: name,
    scope,
    entryKey: key,
  });
}
function genVersion() {
  return Date.now().toString(36) + "." + generateSecureToken("", ENTRY_VERSION_RANDOM_LENGTH);
}
function keyInfoOf(rec) {
  return {
    version: rec.version,
    createdTime: rec.createdTime,
    updatedTime: rec.updatedTime,
    userIds: (rec.userIds || []).slice(),
    metadata: {},
  };
}


const mem = new Map();                
const hydratedProjects = new Set();
const writeQueue = new Map();                                       
let flushTimer = null;
let _dbPromise = null;

function hasIDB() {
  return typeof indexedDB !== "undefined" && indexedDB !== null;
}
function openDb() {
  if (!hasIDB()) return Promise.resolve(null);
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve) => {
    let req;
    try { req = indexedDB.open(DB_NAME, 1); } catch (_) { resolve(null); return; }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) {
        const os = db.createObjectStore(STORE, { keyPath: "id" });
        os.createIndex("projectId", "projectId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
  });
  return _dbPromise;
}


function upgradeLegacyEntryRecord(rec) {
  if (rec.universeId && !isLegacyDataStoreEntryId(rec.id)) return rec;
  const legacyId = rec.id;
  const universeId = normalizeUniverseId(rec.universeId);
  const upgraded = {
    ...rec,
    universeId,
    id: idOf(rec.projectId, universeId, rec.name, rec.scope, rec.key),
  };
  if (upgraded.id !== legacyId) {
    writeQueue.set(legacyId, null);
    writeQueue.set(upgraded.id, upgraded);
    scheduleFlush();
  }
  return upgraded;
}

async function hydrate(pid) {
  if (hydratedProjects.has(pid)) return;
  hydratedProjects.add(pid);
  const db = await openDb();
  if (!db) return;                   
  await new Promise((resolve) => {
    let tx;
    try { tx = db.transaction(STORE, "readonly"); } catch (_) { resolve(); return; }
    const os = tx.objectStore(STORE);
    let cursorReq;
    try { cursorReq = os.index("projectId").openCursor(IDBKeyRange.only(pid)); }
    catch (_) { cursorReq = os.openCursor(); }
    cursorReq.onsuccess = () => {
      const cur = cursorReq.result;
      if (!cur) { resolve(); return; }
      const rec = cur.value;
      if (rec && rec.projectId === pid) {
        const upgraded = upgradeLegacyEntryRecord(rec);
        mem.set(upgraded.id, upgraded);
      }
      cur.continue();
    };
    cursorReq.onerror = () => resolve();
  });
}

function scheduleFlush() {
  if (flushTimer || !hasIDB()) return;
  flushTimer = setTimeout(flush, 0);
}
async function flush() {
  flushTimer = null;
  if (writeQueue.size === 0) return;
  const db = await openDb();
  if (!db) { writeQueue.clear(); return; }
  const batch = [...writeQueue.entries()];
  writeQueue.clear();
  try {
    const tx = db.transaction(STORE, "readwrite");
    const os = tx.objectStore(STORE);
    for (const [id, rec] of batch) {
      if (rec === null) os.delete(id);
      else os.put(rec);
    }
  } catch (e) {
    dsLog("warn", "Falha ao gravar no IndexedDB: " + (e && e.message), "DataStoreService");
  }
}


export async function dsGet(name, scope, key, options) {
  const pid = getProjectId();
  const universeId = resolveUniverseId(options);
  await hydrate(pid);
  const rec = mem.get(idOf(pid, universeId, name, scope, key));
  return rec ? clone(rec.value) : null;
}

export async function dsSet(name, scope, key, value, userIds, options) {
  const pid = getProjectId();
  const universeId = resolveUniverseId(options);
  await hydrate(pid);
  const id = idOf(pid, universeId, name, scope, key);
  const prev = mem.get(id);
  const now = Date.now();
  const rec = {
    id, projectId: pid, universeId, name, scope, key,
    value: clone(value),
    version: genVersion(),
    createdTime: prev ? prev.createdTime : now,
    updatedTime: now,
    userIds: Array.isArray(userIds) ? userIds.slice() : [],
  };
  mem.set(id, rec);
  writeQueue.set(id, rec);
  scheduleFlush();
  return { version: rec.version, keyInfo: keyInfoOf(rec) };
}

export async function dsRemove(name, scope, key, options) {
  const pid = getProjectId();
  const universeId = resolveUniverseId(options);
  await hydrate(pid);
  const id = idOf(pid, universeId, name, scope, key);
  const prev = mem.get(id);
  if (!prev) return null;
  mem.delete(id);
  writeQueue.set(id, null);
  scheduleFlush();
  return clone(prev.value);
}

export async function dsGetKeyInfo(name, scope, key, options) {
  const pid = getProjectId();
  const universeId = resolveUniverseId(options);
  await hydrate(pid);
  const rec = mem.get(idOf(pid, universeId, name, scope, key));
  return rec ? keyInfoOf(rec) : null;
}

export async function dsListKeys(name, scope, prefix, options) {
  const pid = getProjectId();
  const universeId = resolveUniverseId(options);
  await hydrate(pid);
  const pre = prefix == null ? "" : String(prefix);
  const out = [];
  for (const rec of mem.values()) {
    if (
      rec.projectId === pid &&
      rec.universeId === universeId &&
      rec.name === name &&
      rec.scope === scope &&
      rec.key.startsWith(pre)
    ) {
      out.push(rec.key);
    }
  }
  out.sort();
  return out;
}

export async function dsGetAll(name, scope, options) {
  const keys = await dsListKeys(name, scope, "", options);
  const pid = getProjectId();
  const universeId = resolveUniverseId(options);
  return keys.map((k) => {
    const rec = mem.get(idOf(pid, universeId, name, scope, k));
    return { key: k, value: rec ? clone(rec.value) : null };
  });
}

export async function dsListStores(options) {
  const pid = getProjectId();
  const universeId = resolveUniverseId(options);
  await hydrate(pid);
  const seen = new Map();
  for (const rec of mem.values()) {
    if (rec.projectId !== pid || rec.universeId !== universeId) continue;
    const k = rec.name + SEP + rec.scope;
    if (!seen.has(k)) seen.set(k, { name: rec.name, scope: rec.scope });
  }
  return [...seen.values()].sort((a, b) =>
    a.name === b.name ? a.scope.localeCompare(b.scope) : a.name.localeCompare(b.name),
  );
}

export async function dsClearAll(options) {
  const pid = getProjectId();
  const universeId = resolveUniverseId(options);
  await hydrate(pid);
  for (const id of [...mem.keys()]) {
    const rec = mem.get(id);
    if (rec && rec.projectId === pid && rec.universeId === universeId) {
      mem.delete(id);
      writeQueue.set(id, null);
    }
  }
  scheduleFlush();
  lastKeyWriteTimes.clear();
}


const BUDGET_DEFS = {
  GetAsync: { base: 60, perPlayer: 10, regen: 1.0 },
  SetIncrementAsync: { base: 60, perPlayer: 10, regen: 0.166 },
  GetSortedAsync: { base: 10, perPlayer: 2, regen: 0.083 },
  ListAsync: { base: 5, perPlayer: 2, regen: 0.05 },
};
const BUDGET_ALIASES = {
  GetAsync: "GetAsync",
  SetAsync: "SetIncrementAsync",
  SetIncrementAsync: "SetIncrementAsync",
  IncrementAsync: "SetIncrementAsync",
  UpdateAsync: "SetIncrementAsync",
  RemoveAsync: "SetIncrementAsync",
  GetSortedAsync: "GetSortedAsync",
  ListAsync: "ListAsync",
  ListKeysAsync: "ListAsync",
  ListVersionsAsync: "ListAsync",
};
let _playerCount = 1;                                      
const _budgets = new Map();                            

function budgetType(requestType) {
  const rt = String(requestType || "").replace(/^Enum\.DataStoreRequestType\./, "");
  return BUDGET_ALIASES[rt] || "SetIncrementAsync";
}
function maxBudget(type) {
  const def = BUDGET_DEFS[type];
  return def ? def.base + def.perPlayer * Math.max(0, _playerCount - 1) : 0;
}
function refreshBudget(type) {
  const def = BUDGET_DEFS[type];
  if (!def) return { amount: 0, last: Date.now() };
  let b = _budgets.get(type);
  const now = Date.now();
  if (!b) { b = { amount: maxBudget(type), last: now }; _budgets.set(type, b); return b; }
  const elapsed = (now - b.last) / 1000;
  if (elapsed > 0) {
    b.amount = Math.min(maxBudget(type), b.amount + elapsed * def.regen * Math.max(1, _playerCount));
    b.last = now;
  }
  return b;
}
export function setPlayerCount(n) {
  _playerCount = Math.max(1, Math.floor(Number(n) || 1));
}
export function getBudget(requestType) {
  const type = budgetType(requestType);
  const b = refreshBudget(type);
  return Math.floor(b.amount);
}
export function tryConsumeBudget(requestType) {
  const type = budgetType(requestType);
  const b = refreshBudget(type);
  if (b.amount >= 1) { b.amount -= 1; return true; }
  return false;
}
export function resetBudgets() {
  _budgets.clear();
}


const lastKeyWriteTimes = new Map();                                                    
export function keyWriteAgeSec(name, scope, key, options) {
  const entryId = idOf(getProjectId(), resolveUniverseId(options), name, scope, key);
  const lastWriteAt = lastKeyWriteTimes.get(entryId);
  if (!lastWriteAt) return Infinity;
  return (Date.now() - lastWriteAt) / 1000;
}
export function markKeyWrite(name, scope, key, options) {
  const entryId = idOf(getProjectId(), resolveUniverseId(options), name, scope, key);
  lastKeyWriteTimes.set(entryId, Date.now());
}


const _mock = {
  config: { defaultLatencyMs: 80, defaultError: "HttpError: ConnectFail (URL externa nao registrada no Mock HTTP)" },
  entries: new Map(),                                                    
};
export const mockHttp = {
  list() {
    return [..._mock.entries.values()].map((e) => ({ ...e, headers: { ...e.headers } }));
  },
  getConfig() {
    return { defaultLatencyMs: _mock.config.defaultLatencyMs, defaultError: _mock.config.defaultError };
  },
  setConfig(c) {
    c = c || {};
    if (typeof c.defaultLatencyMs === "number" && Number.isFinite(c.defaultLatencyMs)) {
      _mock.config.defaultLatencyMs = Math.max(0, c.defaultLatencyMs);
    }
    if (typeof c.defaultError === "string") _mock.config.defaultError = c.defaultError;
  },
  register(url, resp) {
    if (!url) return null;
    if (_mock.entries.size >= DS_LIMITS.maxMockEntries && !_mock.entries.has(String(url))) {
      throw new Error("Mock HTTP: limite de " + DS_LIMITS.maxMockEntries + " entradas atingido.");
    }
    const e = {
      url: String(url),
      status: (resp && typeof resp.status === "number") ? resp.status : 200,
      body: (resp && resp.body != null) ? String(resp.body) : "",
      headers: (resp && resp.headers && typeof resp.headers === "object") ? { ...resp.headers } : {},
      latencyMs: (resp && typeof resp.latencyMs === "number") ? Math.max(0, resp.latencyMs) : _mock.config.defaultLatencyMs,
    };
    _mock.entries.set(e.url, e);
    return { ...e, headers: { ...e.headers } };
  },
  remove(url) {
    return _mock.entries.delete(String(url));
  },
  clear() {
    _mock.entries.clear();
  },
  lookup(url) {
    const e = _mock.entries.get(String(url));
    if (!e) return null;
    return { status: e.status, body: e.body, headers: { ...e.headers }, latencyMs: e.latencyMs };
  },
};


let _teleportData = null;
export function getTeleportData() { return _teleportData == null ? null : clone(_teleportData); }
export function setTeleportData(v) { _teleportData = v == null ? null : clone(v); }


export function serializeConfig() {
  return {
    mock: mockHttp.list(),
    config: mockHttp.getConfig(),
    teleportData: _teleportData == null ? null : clone(_teleportData),
  };
}
export function loadConfig(obj) {
  mockHttp.clear();
  if (!obj || typeof obj !== "object") return;
  if (obj.config) mockHttp.setConfig(obj.config);
  if (Array.isArray(obj.mock)) {
    for (const e of obj.mock) {
      try { mockHttp.register(e.url, e); } catch (_) {              }
    }
  }
  _teleportData = obj.teleportData == null ? null : clone(obj.teleportData);
}


export function dsLog(level, message, source) {
  const src = source || "DataStoreService";
  try {
    if (logger && typeof logger[level] === "function") { logger[level](message, { source: src }); return; }
    if (logger && typeof logger.info === "function") { logger.info(message, { source: src }); return; }
  } catch (_) {              }

}
