export function createLutOutputLeases() {
  const views = new Map();

  function release(viewId) {
    const record = views.get(viewId);
    if (!record) return;
    record.active = false;
    record.target.removeEventListener?.("dispose", record.onDispose);
    views.delete(viewId);
  }

  return Object.freeze({
    begin(viewId, target) {
      release(viewId);
      const record = { target, active: true, committed: false, onDispose: () => release(viewId) };
      views.set(viewId, record);
      target.addEventListener?.("dispose", record.onDispose);
      return Object.freeze({
        isAlive: () => record.active && record.committed && views.get(viewId) === record,
        commit() { if (!record.active) throw new Error("CP-F13 output target was released during submission"); record.committed = true; }
      });
    },
    clear() { for (const viewId of [...views.keys()]) release(viewId); }
  });
}
