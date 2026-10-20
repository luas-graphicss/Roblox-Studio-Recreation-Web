import { logger } from "../core/logger.js";
import { createResourceId } from "../core/resourceId.js";           
import { collectCursorMetadata } from "./metadataCursor.js";

const DB_NAME = "rsw-projects";
const DB_VERSION = 2;
export const MAX_AUTOSAVES_PER_PROJECT = 5;

let _dbPromise = null;

export function storageAvailable() {
  try {
    return typeof indexedDB !== "undefined" && indexedDB != null;
  } catch (_) {
    return false;
  }
}

function openDb() {
  if (_dbPromise) return _dbPromise;
  _dbPromise = new Promise((resolve, reject) => {
    if (!storageAvailable()) {
      reject(new Error("IndexedDB indisponível neste navegador."));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("projects")) {
        db.createObjectStore("projects", { keyPath: "id" });
      }
      if (!db.objectStoreNames.contains("autosaves")) {
        const st = db.createObjectStore("autosaves", { keyPath: "id" });
        st.createIndex("byProject", "projectId", { unique: false });
      }
      if (!db.objectStoreNames.contains("versions")) {
        const vs = db.createObjectStore("versions", { keyPath: "id" });
        vs.createIndex("byProject", "projectKey", { unique: false });
      }
      if (!db.objectStoreNames.contains("versionTexts")) {
        db.createObjectStore("versionTexts", { keyPath: "id" });
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => { try { db.close(); } catch (_) {} _dbPromise = null; };
      resolve(db);
    };
    req.onerror = () => {
      _dbPromise = null;
      reject(req.error || new Error("Falha ao abrir o IndexedDB."));
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
        t.onabort = () => reject(t.error || new Error("Transação abortada."));
        t.onerror = () => reject(t.error || new Error("Erro na transação."));
        try {
          result = fn(t);
        } catch (e) {
          try { t.abort(); } catch (_) {}
          reject(e);
        }
      }),
  );
}

function reqToPromise(req) {
  return new Promise((resolve, reject) => {


    if (req.readyState === "done") {
      if (req.error) reject(req.error);
      else resolve(req.result);
      return;
    }
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

export function newProjectId() {
  return createResourceId("p_");
}

function metaOf(rec) {
  if (!rec) return null;
  return {
    id: rec.id,
    name: rec.name,
    savedAt: rec.savedAt,
    size: rec.size,
    thumbnail: rec.thumbnail || null,
  };
}


export async function listProjects() {


  const list = await tx(["projects"], "readonly", (transaction) =>
    collectCursorMetadata(transaction.objectStore("projects"), metaOf),
  );
  list.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  return list;
}


export async function safeListProjects() {
  try {
    return await listProjects();
  } catch (e) {
    logger.warn("ProjectStore: falha ao listar projetos: " + (e && e.message));
    return [];
  }
}

export async function getProject(id) {
  const req = await tx(["projects"], "readonly", (t) => t.objectStore("projects").get(String(id)));
  return reqToPromise(req);
}


export async function putProject(rec) {
  if (!rec || !rec.id || typeof rec.text !== "string") {
    throw new Error("Registro de projeto inválido.");
  }
  const clean = {
    id: String(rec.id),
    name: String(rec.name || "Untitled Place").slice(0, 200),
    savedAt: rec.savedAt || new Date().toISOString(),
    size: rec.text.length,
    thumbnail: typeof rec.thumbnail === "string" ? rec.thumbnail : null,
    text: rec.text,
  };
  await tx(["projects"], "readwrite", (t) => {
    t.objectStore("projects").put(clean);
  });
  return metaOf(clean);
}

export async function renameProject(id, newName) {
  const rec = await getProject(id);
  if (!rec) return null;
  rec.name = String(newName || rec.name).slice(0, 200);
  await tx(["projects"], "readwrite", (t) => {
    t.objectStore("projects").put(rec);
  });
  return metaOf(rec);
}

export async function duplicateProject(id) {
  const rec = await getProject(id);
  if (!rec) return null;
  const copy = {
    ...rec,
    id: newProjectId(),
    name: (String(rec.name || "Untitled Place") + " (cópia)").slice(0, 200),
    savedAt: new Date().toISOString(),
  };
  await tx(["projects"], "readwrite", (t) => {
    t.objectStore("projects").put(copy);
  });
  return metaOf(copy);
}


export async function deleteProject(id) {
  const pid = String(id);
  await tx(["projects", "autosaves", "versions", "versionTexts"], "readwrite", (t) => {
    t.objectStore("projects").delete(pid);
    const idx = t.objectStore("autosaves").index("byProject");
    const cursorReq = idx.openCursor(pid);
    cursorReq.onsuccess = () => {
      const cur = cursorReq.result;
      if (cur) {
        cur.delete();
        cur.continue();
      }
    };


    const vIdx = t.objectStore("versions").index("byProject");
    for (const vKey of ["idb:" + pid, pid]) {
      const vReq = vIdx.openCursor(vKey);
      vReq.onsuccess = () => {
        const cur = vReq.result;
        if (cur) {
          t.objectStore("versionTexts").delete(cur.value.id);
          cur.delete();
          cur.continue();
        }
      };
    }
  });
  return true;
}


export async function listAutosaves(projectId) {
  const req = await tx(["autosaves"], "readonly", (t) => {
    const st = t.objectStore("autosaves");
    if (projectId != null) return st.index("byProject").getAll(String(projectId));
    return st.getAll();
  });
  const all = (await reqToPromise(req)) || [];
  const list = all.map((r) => ({
    id: r.id,
    projectId: r.projectId,
    name: r.name,
    savedAt: r.savedAt,
    size: r.size,
  }));
  list.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
  return list;
}

export async function getAutosave(id) {
  const req = await tx(["autosaves"], "readonly", (t) => t.objectStore("autosaves").get(String(id)));
  return reqToPromise(req);
}


export async function putAutosave(rec) {
  if (!rec || !rec.id || !rec.projectId || typeof rec.text !== "string") {
    throw new Error("Registro de autosave inválido.");
  }
  const clean = {
    id: String(rec.id),
    projectId: String(rec.projectId),
    name: String(rec.name || "Untitled Place").slice(0, 200),
    savedAt: rec.savedAt || new Date().toISOString(),
    size: rec.text.length,
    text: rec.text,
  };
  await tx(["autosaves"], "readwrite", (t) => {
    const st = t.objectStore("autosaves");
    st.put(clean);

    const idx = st.index("byProject");
    const allReq = idx.getAll(clean.projectId);
    allReq.onsuccess = () => {
      const all = (allReq.result || []).slice();
      if (all.length <= MAX_AUTOSAVES_PER_PROJECT) return;
      all.sort((a, b) => String(b.savedAt).localeCompare(String(a.savedAt)));
      for (const old of all.slice(MAX_AUTOSAVES_PER_PROJECT)) {
        st.delete(old.id);
      }
    };
  });
  return { id: clean.id, projectId: clean.projectId, savedAt: clean.savedAt, size: clean.size };
}

export async function deleteAutosave(id) {
  await tx(["autosaves"], "readwrite", (t) => {
    t.objectStore("autosaves").delete(String(id));
  });
  return true;
}



export const MAX_VERSIONS_PER_PROJECT = 100;

export function newVersionId() {
  return createResourceId("v_");
}

export async function listVersions(projectKey) {
  const req = await tx(["versions"], "readonly", (t) =>
    t.objectStore("versions").index("byProject").getAll(String(projectKey)),
  );
  const all = (await reqToPromise(req)) || [];
  all.sort((a, b) => (Number(b.num) || 0) - (Number(a.num) || 0));
  return all;
}

export async function safeListVersions(projectKey) {
  try {
    return await listVersions(projectKey);
  } catch (e) {
    logger.warn("ProjectStore: falha ao listar vers\u00f5es: " + (e && e.message));
    return [];
  }
}

export async function getVersion(id) {
  const req = await tx(["versions"], "readonly", (t) => t.objectStore("versions").get(String(id)));
  return reqToPromise(req);
}

export async function getVersionText(id) {
  const req = await tx(["versionTexts"], "readonly", (t) =>
    t.objectStore("versionTexts").get(String(id)),
  );
  const rec = await reqToPromise(req);
  return rec && typeof rec.text === "string" ? rec.text : null;
}

export async function putVersion(rec) {
  if (!rec || !rec.projectKey || typeof rec.text !== "string") {
    throw new Error("Registro de vers\u00e3o inv\u00e1lido.");
  }
  const id = String(rec.id || newVersionId());
  const meta = {
    id,
    projectKey: String(rec.projectKey),
    num: 0,
    savedAt: rec.savedAt || new Date().toISOString(),
    size: rec.text.length,
    author: String(rec.author || "Owner").slice(0, 80),
    comment: String(rec.comment || "").slice(0, 500),
    thumbnail: typeof rec.thumbnail === "string" ? rec.thumbnail : null,
  };
  const holder = await tx(["versions", "versionTexts"], "readwrite", (t) => {
    const vs = t.objectStore("versions");
    const ts = t.objectStore("versionTexts");
    const out = { num: 0 };
    const allReq = vs.index("byProject").getAll(meta.projectKey);
    allReq.onsuccess = () => {
      const all = (allReq.result || []).slice();
      let maxNum = 0;
      for (const v of all) maxNum = Math.max(maxNum, Number(v.num) || 0);
      meta.num = maxNum + 1;
      out.num = meta.num;
      vs.put(meta);
      ts.put({ id, text: rec.text });
      all.push(meta);
      all.sort((a, b) => (Number(b.num) || 0) - (Number(a.num) || 0));
      for (const old of all.slice(MAX_VERSIONS_PER_PROJECT)) {
        vs.delete(old.id);
        ts.delete(old.id);
      }
    };
    return out;
  });
  return { ...meta, num: holder.num };
}

export async function deleteVersion(id) {
  await tx(["versions", "versionTexts"], "readwrite", (t) => {
    t.objectStore("versions").delete(String(id));
    t.objectStore("versionTexts").delete(String(id));
  });
  return true;
}
