const targetNames = Object.freeze(["luminance", "horizontal", "base", "gainEven", "gainOdd", "color"]);

export function createLocalExposureTargets(pool, history, maxViews) {
  const views = new Map();
  function releaseView(viewId) {
    const entry = views.get(viewId);
    if (!entry) return;
    for (const key of entry.keys) pool.release(key);
    views.delete(viewId);
  }
  return Object.freeze({
    acquire(viewId, width, height) {
      let entry = views.get(viewId);
      if (entry && (entry.width !== width || entry.height !== height)) { releaseView(viewId); entry = null; }
      if (!entry && views.size >= maxViews) {
        releaseView(views.keys().next().value);
        history.clearOwner("CP-F10");
      }
      const prefix = `CP-F10.view.${encodeURIComponent(viewId)}`;
      const keys = targetNames.map((name) => `${prefix}.${name}`);
      const targets = {};
      try {
        for (let index = 0; index < targetNames.length; index += 1) {
          targets[targetNames[index]] = pool.acquire("CP-F10", keys[index], { width, height, format: "rgba16f", filter: "nearest", depth: false });
        }
      } catch (error) {
        for (const key of keys) pool.release(key);
        views.delete(viewId);
        throw error;
      }
      views.delete(viewId);
      views.set(viewId, { width, height, keys });
      return targets;
    },
    dispose() {
      for (const viewId of [...views.keys()]) releaseView(viewId);
    },
    bytesPerPixel: targetNames.length * 8
  });
}
