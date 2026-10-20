const liveCountByScopeName = new Map();

function addLiveCount(scopeName, delta) {
  const nextCount = (liveCountByScopeName.get(scopeName) || 0) + delta;
  if (nextCount > 0) liveCountByScopeName.set(scopeName, nextCount);
  else liveCountByScopeName.delete(scopeName);
}

function canReceiveListeners(target) {
  return (
    !!target &&
    typeof target.addEventListener === "function" &&
    typeof target.removeEventListener === "function"
  );
}

export function createListenerScope(scopeName) {
  const name = typeof scopeName === "string" && scopeName ? scopeName : "anonymous";
  const entries = [];

  function add(target, type, handler, options) {
    if (!canReceiveListeners(target)) return null;
    if (typeof type !== "string" || !type || typeof handler !== "function") return null;
    target.addEventListener(type, handler, options);
    entries.push({ target, type, handler, options });
    addLiveCount(name, 1);

    return handler;
  }

  function disposeAll() {
    for (let index = 0; index < entries.length; index += 1) {
      const entry = entries[index];
      try {
        entry.target.removeEventListener(entry.type, entry.handler, entry.options);
      } catch (error) {


      }
    }
    addLiveCount(name, -entries.length);
    entries.length = 0;
  }

  return {
    name,
    add,
    disposeAll,
    get size() {
      return entries.length;
    },
  };
}


export function listenerScopeLeakReport(threshold = 25) {
  const report = [];
  liveCountByScopeName.forEach((count, scopeName) => {
    if (count >= threshold) report.push({ scope: scopeName, count });
  });
  report.sort((first, second) => second.count - first.count);
  return report;
}

if (typeof window !== "undefined") {
  window.__rswListenerScopeQa = {
    leakReport: listenerScopeLeakReport,
    liveCounts: () => Object.fromEntries(liveCountByScopeName),
  };
}
