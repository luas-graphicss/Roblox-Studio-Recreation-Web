import { logger } from "../core/logger.js";

const DB_NAME = "rsw-packages";
const DB_VERSION = 1;
export const MAX_PACKAGES = 200;
export const MAX_VERSIONS_PER_PACKAGE = 50;


export const MAX_VERSION_TEXT_BYTES = 8 * 1024 * 1024;

function storageAvailable() {
  try {
    return typeof indexedDB !== "undefined" && indexedDB != null;
  } catch (_) {
    return false;
  }
}

const memPackages = new Map();
const memVersions = new Map();

let dbPromise = null;

function openDb() {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    let req;
    try {


      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch (err) {
      reject(err || new Error("IndexedDB indisponivel"));
      return;
    }
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("packages")) {
        db.createObjectStore("packages", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("versions")) {
        const vs = db.createObjectStore("versions", { keyPath: "key" });
        vs.createIndex("byPackage", "packageId", { unique: false });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error || new Error("IndexedDB indisponivel"));
  });


  dbPromise.catch(() => {
    dbPromise = null;
  });
  return dbPromise;
}

function tx(db, names, mode) {
  return db.transaction(names, mode);
}

function reqAsync(request) {
  return new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error("Falha no IndexedDB"));
  });
}

function sanitizeMeta(meta) {
  const m = meta && typeof meta === "object" ? meta : {};
  return {
    id: String(m.id || ""),
    name: String(m.name || "Package").slice(0, 60),
    description: String(m.description || "").slice(0, 500),
    icon: String(m.icon || "package").slice(0, 40),
    version: Math.max(1, Math.floor(Number(m.version) || 1)),
    updatedAt: Number(m.updatedAt) || Date.now(),
    createdAt: Number(m.createdAt) || Date.now(),
    latestHash: String(m.latestHash || ""),
  };
}

async function listPackages() {
  if (!storageAvailable()) {
    return [...memPackages.values()].map(sanitizeMeta).sort((a, b) => b.updatedAt - a.updatedAt);
  }
  const db = await openDb();
  const rows = await reqAsync(tx(db, ["packages"], "readonly").objectStore("packages").getAll());
  return (rows || []).map(sanitizeMeta).sort((a, b) => b.updatedAt - a.updatedAt);
}

async function getPackage(id) {
  const key = String(id || "");
  if (!key) return null;
  if (!storageAvailable()) {
    return memPackages.has(key) ? sanitizeMeta(memPackages.get(key)) : null;
  }
  const db = await openDb();
  const row = await reqAsync(tx(db, ["packages"], "readonly").objectStore("packages").get(key));
  return row ? sanitizeMeta(row) : null;
}

async function packageCount() {
  if (!storageAvailable()) return memPackages.size;
  const db = await openDb();
  const n = await reqAsync(tx(db, ["packages"], "readonly").objectStore("packages").count());
  return Number(n) || 0;
}

async function putPackage(meta) {
  const m = sanitizeMeta(meta);
  if (!m.id) return { ok: false, error: "Package sem id." };
  const existing = await getPackage(m.id);
  if (!existing) {
    const count = await packageCount();
    if (count >= MAX_PACKAGES) {
      return { ok: false, error: "Limite de " + MAX_PACKAGES + " packages atingido." };
    }
  }
  if (!storageAvailable()) {
    memPackages.set(m.id, m);
    return { ok: true, meta: m };
  }
  const db = await openDb();
  await reqAsync(tx(db, ["packages"], "readwrite").objectStore("packages").put(m));
  return { ok: true, meta: m };
}

async function deletePackage(id) {
  const key = String(id || "");
  if (!key) return false;
  if (!storageAvailable()) {
    memPackages.delete(key);
    memVersions.delete(key);
    return true;
  }
  const db = await openDb();
  const t = tx(db, ["packages", "versions"], "readwrite");
  t.objectStore("packages").delete(key);
  const idx = t.objectStore("versions").index("byPackage");
  const rows = await reqAsync(idx.getAllKeys(key));
  for (const k of rows || []) t.objectStore("versions").delete(k);
  await new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error || new Error("Falha ao apagar package"));


    t.onabort = () => reject(t.error || new Error("Transacao abortada"));
  });
  return true;
}

function versionRecord(packageId, num, text, extra) {
  const e = extra && typeof extra === "object" ? extra : {};


  const n = Math.max(1, Math.floor(Number(num) || 1));
  return {
    key: packageId + ":" + String(n).padStart(6, "0"),
    packageId,
    num: n,
    at: Number(e.at) || Date.now(),
    contentHash: String(e.contentHash || ""),
    size: text.length,
    text,
  };
}

async function putVersion(packageId, num, text, extra) {
  const id = String(packageId || "");
  const body = String(text == null ? "" : text);
  if (!id) return { ok: false, error: "Package sem id." };
  if (body.length > MAX_VERSION_TEXT_BYTES) {
    return { ok: false, error: "Package excede o tamanho maximo de versao." };
  }
  const rec = versionRecord(id, num, body, extra);
  if (!storageAvailable()) {
    let vs = memVersions.get(id);
    if (!vs) {
      vs = new Map();
      memVersions.set(id, vs);
    }
    vs.set(rec.num, rec);
    const nums = [...vs.keys()].sort((a, b) => b - a);
    for (const n of nums.slice(MAX_VERSIONS_PER_PACKAGE)) vs.delete(n);
    return { ok: true };
  }
  const db = await openDb();
  const t = tx(db, ["versions"], "readwrite");
  t.objectStore("versions").put(rec);
  const idx = t.objectStore("versions").index("byPackage");
  const rows = await reqAsync(idx.getAll(id));
  const sorted = (rows || []).sort((a, b) => b.num - a.num);
  for (const old of sorted.slice(MAX_VERSIONS_PER_PACKAGE)) {
    t.objectStore("versions").delete(old.key);
  }
  await new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error || new Error("Falha ao gravar versao"));

    t.onabort = () => reject(t.error || new Error("Transacao abortada"));
  });
  return { ok: true };
}

async function listVersions(packageId) {
  const id = String(packageId || "");
  if (!id) return [];
  if (!storageAvailable()) {
    const vs = memVersions.get(id);
    if (!vs) return [];
    return [...vs.values()]
      .map((r) => ({ packageId: r.packageId, num: r.num, at: r.at, contentHash: r.contentHash, size: r.size }))
      .sort((a, b) => b.num - a.num);
  }
  try {
    const db = await openDb();
    const idx = tx(db, ["versions"], "readonly").objectStore("versions").index("byPackage");
    const rows = await reqAsync(idx.getAll(id));
    return (rows || [])
      .map((r) => ({ packageId: r.packageId, num: r.num, at: r.at, contentHash: r.contentHash, size: r.size }))
      .sort((a, b) => b.num - a.num);
  } catch (err) {


    logger.warn("Falha ao listar versoes de package: " + ((err && err.message) || err));
    return [];
  }
}

async function getVersionText(packageId, num) {
  const id = String(packageId || "");
  const n = Math.max(1, Math.floor(Number(num) || 1));
  if (!id) return null;
  if (!storageAvailable()) {
    const vs = memVersions.get(id);
    const rec = vs ? vs.get(n) : null;
    return rec ? rec.text : null;
  }
  const db = await openDb();
  const rec = await reqAsync(
    tx(db, ["versions"], "readonly").objectStore("versions").get(id + ":" + String(n).padStart(6, "0")),
  );
  return rec ? rec.text : null;
}


async function deleteVersion(packageId, num) {
  const id = String(packageId || "");
  if (!id) return false;
  const n = Math.max(1, Math.floor(Number(num) || 1));
  if (!storageAvailable()) {
    const vs = memVersions.get(id);
    if (vs) vs.delete(n);
    return true;
  }
  const db = await openDb();
  const t = tx(db, ["versions"], "readwrite");
  t.objectStore("versions").delete(id + ":" + String(n).padStart(6, "0"));
  await new Promise((resolve, reject) => {
    t.oncomplete = () => resolve();
    t.onerror = () => reject(t.error || new Error("Falha ao apagar versao"));
    t.onabort = () => reject(t.error || new Error("Transacao abortada"));
  });
  return true;
}

async function safeListPackages() {
  try {
    return await listPackages();
  } catch (err) {
    logger.warn("Falha ao listar packages: " + ((err && err.message) || err));
    return [];
  }
}

function clearMemoryForTests() {
  memPackages.clear();
  memVersions.clear();
}

export const packageStore = {
  storageAvailable,
  listPackages,
  safeListPackages,
  getPackage,
  packageCount,
  putPackage,
  deletePackage,
  putVersion,
  listVersions,
  getVersionText,
  deleteVersion,
  clearMemoryForTests,
};
