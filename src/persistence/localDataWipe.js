export const LOCAL_DATA_KEY_PREFIX = "rsw.";
export const LOCAL_DATA_DATABASE_NAMES = Object.freeze([
  "rsw-projects",
  "rsw-datastores",
  "rsw-cloud",
  "rsw-packages",
]);


const DELETE_DATABASE_TIMEOUT_MS = 4000;

function readStorage(storageName) {
  try {
    const storage = globalThis[storageName];
    return storage && typeof storage.removeItem === "function" ? storage : null;
  } catch (_) {
    return null;
  }
}

export function listAppKeys(storage) {
  const appKeys = [];
  if (!storage) return appKeys;
  try {
    for (let index = 0; index !== storage.length; index += 1) {
      const key = storage.key(index);
      if (typeof key === "string" && key.startsWith(LOCAL_DATA_KEY_PREFIX)) appKeys.push(key);
    }
  } catch (_) {
    return appKeys;
  }
  return appKeys;
}

function clearAppKeys(storage) {
  const appKeys = listAppKeys(storage);
  let removedCount = 0;
  for (const key of appKeys) {
    try {
      storage.removeItem(key);
      removedCount += 1;
    } catch (_) {

    }
  }
  return removedCount;
}

export function deleteDatabase(databaseName) {
  return new Promise((resolve) => {
    let request;
    try {
      request = indexedDB.deleteDatabase(databaseName);
    } catch (error) {
      resolve({ name: databaseName, deleted: false, reason: String((error && error.message) || error) });
      return;
    }
    const finish = (result) => {
      if (timer) clearTimeout(timer);
      resolve(result);
    };
    const timer = setTimeout(
      () => finish({ name: databaseName, deleted: false, reason: "blocked by another tab" }),
      DELETE_DATABASE_TIMEOUT_MS,
    );
    request.onsuccess = () => finish({ name: databaseName, deleted: true, reason: "" });
    request.onerror = () =>
      finish({
        name: databaseName,
        deleted: false,
        reason: String((request.error && request.error.message) || "delete failed"),
      });
    request.onblocked = () =>
      finish({ name: databaseName, deleted: false, reason: "blocked by another tab" });
  });
}

async function deleteAllDatabases() {
  const hasIndexedDb = (() => {
    try {
      return typeof indexedDB !== "undefined" && indexedDB != null;
    } catch (_) {
      return false;
    }
  })();
  if (!hasIndexedDb) {
    return LOCAL_DATA_DATABASE_NAMES.map((databaseName) => ({
      name: databaseName,
      deleted: false,
      reason: "IndexedDB unavailable",
    }));
  }
  const results = [];
  for (const databaseName of LOCAL_DATA_DATABASE_NAMES) {
    results.push(await deleteDatabase(databaseName));
  }
  return results;
}

async function deleteCaches() {
  let removedCount = 0;
  try {
    if (typeof caches === "undefined" || !caches || typeof caches.keys !== "function") {
      return removedCount;
    }
    for (const cacheName of await caches.keys()) {
      if (await caches.delete(cacheName)) removedCount += 1;
    }
  } catch (_) {
    return removedCount;
  }
  return removedCount;
}


export async function wipeLocalData() {
  const localKeysRemoved = clearAppKeys(readStorage("localStorage"));
  const sessionKeysRemoved = clearAppKeys(readStorage("sessionStorage"));
  const databases = await deleteAllDatabases();
  const cachesRemoved = await deleteCaches();
  return {
    localKeysRemoved,
    sessionKeysRemoved,
    databases,
    cachesRemoved,
    blockedDatabases: databases.filter((entry) => !entry.deleted).map((entry) => entry.name),
  };
}

export function describeWipeReport(report) {
  if (!report) return "Nothing was removed.";
  const removedKeys = report.localKeysRemoved + report.sessionKeysRemoved;
  const deletedDatabases = report.databases.filter((entry) => entry.deleted).length;
  const parts = [
    removedKeys + " stored setting(s)",
    deletedDatabases + "/" + report.databases.length + " database(s)",
    report.cachesRemoved + " cache(s)",
  ];
  const summary = "Removed " + parts.join(", ") + ".";
  if (!report.blockedDatabases.length) return summary;
  return summary + " Still open in another tab: " + report.blockedDatabases.join(", ") + ".";
}
