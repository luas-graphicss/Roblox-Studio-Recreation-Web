import { bus } from "../core/eventBus.js";

import { deepCloneJsonValue } from "../core/deepCloneJsonValue.js";
import { logger } from "../core/logger.js";
import { getSecureRandomBytes } from "./secureTokenGenerator.js";
import { createTokenDigest, matchesTokenDigest } from "./apiKeyDigest.js";

const DB_NAME = "rsw-cloud";
const DB_VERSION = 1;
const CHUNK_SIZE = 256 * 1024;

export const STORES = Object.freeze(["universes", "places", "apiKeys", "assets"]);

let _dbPromise = null;





const _cachePromises = { universes: null, places: null, apiKeys: null, assets: null };
const _memChunks = new Map();

export function storageAvailable() {
  try {
    return typeof indexedDB !== "undefined" && indexedDB != null;
  } catch (_) {
    return false;
  }
}

export function newId64() {


  const b = getSecureRandomBytes(8);
  let n = 0n;
  for (const x of b) n = (n << 8n) | BigInt(x);


  n &= (1n << 52n) - 1n;
  if (n < 1000000000000n) n += 1000000000000n;
  return n.toString();
}


export function sliceName(raw, max) {
  let s = String(raw == null ? "" : raw).slice(0, max);
  const last = s.charCodeAt(s.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) s = s.slice(0, -1);
  return s;
}

function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    if (!storageAvailable()) {
      reject(new Error("IndexedDB indispon\u00edvel neste navegador."));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("universes")) db.createObjectStore("universes", { keyPath: "id" });
      if (!db.objectStoreNames.contains("places")) {
        const st = db.createObjectStore("places", { keyPath: "id" });
        st.createIndex("byUniverse", "universeId", { unique: false });
      }
      if (!db.objectStoreNames.contains("apiKeys")) db.createObjectStore("apiKeys", { keyPath: "id" });
      if (!db.objectStoreNames.contains("assets")) {
        const st = db.createObjectStore("assets", { keyPath: "id" });
        st.createIndex("byUniverse", "universeId", { unique: false });
      }
      if (!db.objectStoreNames.contains("chunks")) db.createObjectStore("chunks", { keyPath: "id" });
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        try { db.close(); } catch (_) {}
        _dbPromise = null;


        invalidateCache();
      };
      resolve(db);
    };
    req.onerror = () => {
      _dbPromise = null;
      reject(req.error || new Error("Falha ao abrir o IndexedDB da Cloud."));
    };
  });
  return _dbPromise;
}

function tx(storeNames, mode, fn) {
  return openDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        let result;
        let t;
        try {
          t = db.transaction(storeNames, mode);
        } catch (e) {
          reject(e);
          return;
        }
        t.oncomplete = () => resolve(result);
        t.onabort = () => reject(t.error || new Error("Transa\u00e7\u00e3o abortada."));
        t.onerror = () => reject(t.error || new Error("Erro na transa\u00e7\u00e3o."));
        try {
          result = fn(t);
        } catch (e) {
          try { t.abort(); } catch (_) {}
          reject(e);
        }
      }),
  );
}

function emitChanged(storeName) {
  try { bus.emit("cloud:changed", { store: storeName }); } catch (_) {}
}

function hydrate(storeName) {
  if (_cachePromises[storeName]) return _cachePromises[storeName];
  const p = (async () => {
    if (!storageAvailable()) return [];
    try {
      const holder = {};
      await tx([storeName], "readonly", (t) => {
        const r = t.objectStore(storeName).getAll();
        r.onsuccess = () => { holder.value = r.result || []; };
      });
      return Array.isArray(holder.value) ? holder.value : [];
    } catch (e) {
      logger.warn("CloudStore: falha ao carregar " + storeName + ": " + (e && e.message));


      if (_cachePromises[storeName] === p) _cachePromises[storeName] = null;
      return [];
    }
  })();
  _cachePromises[storeName] = p;
  return p;
}

async function putRecord(storeName, rec) {
  if (!rec || !rec.id) throw new Error("Registro inv\u00e1lido para " + storeName + ".");
  const list = await hydrate(storeName);
  const clean = deepCloneJsonValue(rec);
  if (storageAvailable()) {
    await tx([storeName], "readwrite", (t) => {
      t.objectStore(storeName).put(clean);
    });
  }
  const idx = list.findIndex((r) => r.id === clean.id);
  if (idx >= 0) list[idx] = clean;
  else list.push(clean);
  emitChanged(storeName);
  return clean;
}

async function deleteRecord(storeName, id) {
  const list = await hydrate(storeName);
  if (storageAvailable()) {
    await tx([storeName], "readwrite", (t) => {
      t.objectStore(storeName).delete(String(id));
    });
  }
  const idx = list.findIndex((r) => r.id === String(id));
  if (idx >= 0) list.splice(idx, 1);
  emitChanged(storeName);
  return true;
}

async function getRecord(storeName, id) {
  const list = await hydrate(storeName);
  const hit = list.find((r) => r.id === String(id));
  return hit ? deepCloneJsonValue(hit) : null;
}

async function listRecords(storeName) {
  const list = await hydrate(storeName);
  return list.map((r) => deepCloneJsonValue(r));
}

async function safeList(storeName) {
  try {
    return await listRecords(storeName);
  } catch (e) {
    logger.warn("CloudStore: falha ao listar " + storeName + ": " + (e && e.message));
    return [];
  }
}

export function invalidateCache(storeName) {
  if (storeName && storeName in _cachePromises) _cachePromises[storeName] = null;
  else for (const k of Object.keys(_cachePromises)) _cachePromises[k] = null;
}

export async function writeChunkedText(owner, text) {
  const raw = String(text == null ? "" : text);
  const count = Math.max(1, Math.ceil(raw.length / CHUNK_SIZE));
  if (!storageAvailable()) {
    _memChunks.set(String(owner), raw);
    return count;
  }
  await tx(["chunks"], "readwrite", (t) => {
    const st = t.objectStore("chunks");
    const metaReq = st.get(owner + "#meta");
    metaReq.onsuccess = () => {
      const prev = metaReq.result;
      const prevCount = prev && Number.isFinite(Number(prev.count)) ? Number(prev.count) : 0;
      for (let i = count; i < prevCount; i++) st.delete(owner + "#" + i);
      for (let i = 0; i < count; i++) {
        st.put({ id: owner + "#" + i, data: raw.slice(i * CHUNK_SIZE, (i + 1) * CHUNK_SIZE) });
      }
      st.put({ id: owner + "#meta", count, size: raw.length, savedAt: new Date().toISOString() });
    };
  });
  return count;
}

export async function readChunkedText(owner) {
  if (!storageAvailable()) {
    const v = _memChunks.get(String(owner));
    return v == null ? null : v;
  }
  const holder = { parts: null, size: null, missing: 0 };
  await tx(["chunks"], "readonly", (t) => {
    const st = t.objectStore("chunks");
    const metaReq = st.get(owner + "#meta");
    metaReq.onsuccess = () => {
      const meta = metaReq.result;
      if (!meta || !Number(meta.count)) return;
      const n = Number(meta.count);
      holder.size = Number.isFinite(Number(meta.size)) ? Number(meta.size) : null;
      holder.parts = new Array(n).fill("");
      for (let i = 0; i < n; i++) {
        const at = i;
        const cReq = st.get(owner + "#" + i);
        cReq.onsuccess = () => {
          if (cReq.result) holder.parts[at] = String(cReq.result.data || "");
          else holder.missing += 1;
        };
      }
    };
  });
  if (!holder.parts) return null;
  const joined = holder.parts.join("");


  if (holder.missing > 0 || (holder.size != null && joined.length !== holder.size)) {
    logger.warn("CloudStore: conte\u00fado de \"" + owner + "\" corrompido (" + holder.missing + " chunk(s) faltando, " + joined.length + "/" + (holder.size == null ? "?" : holder.size) + " chars) \u2014 tratado como ausente.");
    return null;
  }
  return joined;
}

export async function deleteChunkedText(owner) {
  if (!storageAvailable()) {
    _memChunks.delete(String(owner));
    return true;
  }
  await tx(["chunks"], "readwrite", (t) => {
    const st = t.objectStore("chunks");
    const metaReq = st.get(owner + "#meta");
    metaReq.onsuccess = () => {
      const meta = metaReq.result;
      const n = meta && Number.isFinite(Number(meta.count)) ? Number(meta.count) : 0;
      for (let i = 0; i < n; i++) st.delete(owner + "#" + i);
      st.delete(owner + "#meta");
    };
  });
  return true;
}

export function listUniverses() { return safeList("universes"); }
export function getUniverse(id) { return getRecord("universes", id); }
export function putUniverse(rec) { return putRecord("universes", rec); }

export async function deleteUniverse(id) {
  const uid = String(id);
  const places = await safeList("places");
  for (const p of places) {
    if (p.universeId === uid) {
      await deleteChunkedText("place:" + p.id);
      await deleteRecord("places", p.id);
    }
  }
  const assets = await safeList("assets");
  for (const a of assets) {
    if (a.universeId === uid) {
      await deleteChunkedText("asset:" + a.id);
      await deleteRecord("assets", a.id);
    }
  }
  const keys = await safeList("apiKeys");
  for (const k of keys) {
    if (k.universeId === uid) await deleteRecord("apiKeys", k.id);
  }
  await deleteRecord("universes", uid);
  return true;
}

export async function listPlaces(universeId) {
  const all = await safeList("places");
  const list = universeId == null ? all : all.filter((p) => p.universeId === String(universeId));
  list.sort((a, b) => String(b.savedAt || "").localeCompare(String(a.savedAt || "")));
  return list;
}
export function getPlace(id) { return getRecord("places", id); }
export function putPlace(rec) { return putRecord("places", rec); }

export async function deletePlace(id) {
  await deleteChunkedText("place:" + String(id));
  return deleteRecord("places", id);
}

export function writePlaceText(placeId, text) { return writeChunkedText("place:" + String(placeId), text); }
export function readPlaceText(placeId) { return readChunkedText("place:" + String(placeId)); }

export function listApiKeys() { return safeList("apiKeys"); }
export function getApiKey(id) { return getRecord("apiKeys", id); }
export function putApiKey(rec) { return putRecord("apiKeys", rec); }
export function deleteApiKey(id) { return deleteRecord("apiKeys", id); }


export async function findApiKeyByToken(token) {
  const rawToken = String(token == null ? "" : token);
  if (!rawToken) return null;
  const list = await safeList("apiKeys");
  for (const record of list) {
    if (record.tokenDigest) {
      if (await matchesTokenDigest(rawToken, record.tokenDigest)) return record;
      continue;
    }
    if (record.token && (await matchesTokenDigest(rawToken, await createTokenDigest(record.token)))) {
      return upgradeLegacyTokenRecord(record);
    }
  }
  return null;
}

async function upgradeLegacyTokenRecord(record) {
  const upgraded = {
    ...record,
    tokenDigest: await createTokenDigest(record.token),
    tokenPreview: String(record.token).slice(0, 12) + "\u2026",
  };
  delete upgraded.token;
  await putApiKey(upgraded);
  logger.info("Open Cloud: API Key \"" + String(upgraded.name || upgraded.id) + "\" migrada para digest (o token em claro foi apagado).", { source: "Studio" });
  return upgraded;
}

export async function listAssets(universeId) {
  const all = await safeList("assets");
  const list = universeId == null ? all : all.filter((a) => a.universeId === String(universeId));
  list.sort((a, b) => String(b.createdAt || "").localeCompare(String(a.createdAt || "")));
  return list;
}
export function getAsset(id) { return getRecord("assets", id); }
export function putAsset(rec) { return putRecord("assets", rec); }

export async function deleteAsset(id) {
  await deleteChunkedText("asset:" + String(id));
  return deleteRecord("assets", id);
}

export function writeAssetData(assetId, dataUri) { return writeChunkedText("asset:" + String(assetId), dataUri); }
export function readAssetData(assetId) { return readChunkedText("asset:" + String(assetId)); }
