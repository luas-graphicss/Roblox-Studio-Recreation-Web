export function createHistoryStore() {
  const records = new Map();
  function keyFor(owner, name, frame) {
    return `${owner}:${name}:${frame.viewId}`;
  }
  return Object.freeze({
    read(owner, name, frame) {
      const record = records.get(keyFor(owner, name, frame));
      if (!record || frame.cameraCut || record.generation !== frame.generation || record.frameId !== frame.frameId - 1) return null;
      if (record.width !== frame.renderSize.width || record.height !== frame.renderSize.height) return null;
      return record.value;
    },
    write(owner, name, frame, value) {
      records.set(keyFor(owner, name, frame), { generation: frame.generation, frameId: frame.frameId, width: frame.renderSize.width, height: frame.renderSize.height, value });
    },
    clearView(viewId) { for (const key of records.keys()) if (key.endsWith(`:${viewId}`)) records.delete(key); },
    clearOwner(owner) { for (const key of records.keys()) if (key.startsWith(`${owner}:`)) records.delete(key); },
    size: () => records.size,
    clear: () => records.clear()
  });
}
