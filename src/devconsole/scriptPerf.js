export const MAX_PERF_ENTRIES = 300;
export const MAX_PERF_NAME_LEN = 120;

function nowMs() {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

const state = {
  refs: 0,
  externalProbe: null,
  buckets: new Map(),
  windowStart: 0,
};

export const scriptPerf = {
  retain() {
    state.refs++;
    if (state.refs === 1) {
      state.buckets.clear();
      state.windowStart = nowMs();
    }
  },

  release() {
    state.refs = Math.max(0, state.refs - 1);
    if (state.refs === 0) state.buckets.clear();
  },


  setExternalProbe(fn) {
    state.externalProbe = typeof fn === "function" ? fn : null;
  },

  isActive() {
    if (state.refs > 0) return true;
    if (!state.externalProbe) return false;
    try {
      return state.externalProbe() === true;
    } catch (_) {
      return false;
    }
  },

  report(context, name, ms) {
    const v = Number(ms);
    if (!Number.isFinite(v) || v < 0) return;
    const ctx = context === "Client" ? "Client" : "Server";
    const nm = String(name || "thread").slice(0, MAX_PERF_NAME_LEN);
    const key = ctx + "|" + nm;
    let b = state.buckets.get(key);
    if (!b) {
      if (state.buckets.size >= MAX_PERF_ENTRIES) return;
      b = { context: ctx, name: nm, timeMs: 0, count: 0 };
      state.buckets.set(key, b);
    }
    b.timeMs += Math.min(v, 1000);
    b.count++;
  },


  consume() {
    const now = nowMs();
    const start = state.windowStart || now;
    const elapsedMs = Math.max(1, now - start);
    const entries = [];
    for (const b of state.buckets.values()) {
      entries.push({ context: b.context, name: b.name, timeMs: b.timeMs, count: b.count });
    }
    state.buckets.clear();
    state.windowStart = now;
    return { elapsedMs, entries };
  },

  reset() {
    state.buckets.clear();
    state.windowStart = nowMs();
  },
};
