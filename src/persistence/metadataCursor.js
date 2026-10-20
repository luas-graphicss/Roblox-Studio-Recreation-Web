export function collectCursorMetadata(objectStore, toMetadata) {
  const rows = [];
  const request = objectStore.openCursor();
  request.onsuccess = () => {
    const cursor = request.result;
    if (!cursor) return;
    try {
      const metadata = toMetadata(cursor.value);
      if (metadata) rows.push(metadata);
      cursor.continue();
    } catch {

      objectStore.transaction.abort();
    }
  };
  return rows;
}
