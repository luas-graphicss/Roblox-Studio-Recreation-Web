import { getSchedulerJobStats } from "../runtime/scheduler.js";
import { getRenderSample } from "./renderStats.js";
import { registerFrameCallback } from "./frameDriver.js";

export const MAX_PROFILER_FRAMES = 200;

export const PROFILER_CATEGORIES = Object.freeze([
  Object.freeze({ id: "render", label: "Render", color: "#e05252" }),
  Object.freeze({ id: "physics", label: "Physics", color: "#e08a3c" }),
  Object.freeze({ id: "scripts", label: "Scripts", color: "#e3c84b" }),
  Object.freeze({ id: "heartbeat", label: "Heartbeat", color: "#4caf6e" }),
  Object.freeze({ id: "stepped", label: "Stepped", color: "#5bc8e8" }),
  Object.freeze({ id: "network", label: "Network", color: "#a06ee0" }),
  Object.freeze({ id: "gc", label: "GC", color: "#9a9aa0" }),
  Object.freeze({ id: "other", label: "Other", color: "#e8e8ec" }),
]);

const CAT_IDS = PROFILER_CATEGORIES.map((c) => c.id);


const frameRing = new Array(MAX_PROFILER_FRAMES);
let frameRingCount = 0;
let frameWriteIndex = 0;
let frameNo = 0;
let pending = emptyCats();
let pendingSubs = {};
const listeners = new Set();
const listenerSnapshot = [];
let refs = 0;



let unregisterFrameCallback = null;
let lastTs = 0;
let emaTotal = 16.7;
let gcPauses = 0;
let gcTimeTotal = 0;
let gcPeak = 0;
let lastRenderSeq = 0;
const lastJobRuns = new Map();

function emptyCats() {
  const o = {};
  for (const c of ["render", "physics", "scripts", "heartbeat", "stepped", "network", "gc", "other"]) o[c] = 0;
  return o;
}

function resetCategoriesInPlace(target) {
  for (const id of CAT_IDS) target[id] = 0;
  return target;
}

function clearSubBucketsInPlace(target) {
  for (const id of Object.keys(target)) delete target[id];
  return target;
}


function frameAtIndex(index) {
  const oldest = frameRingCount === MAX_PROFILER_FRAMES ? frameWriteIndex : 0;
  return frameRing[(oldest + index) % MAX_PROFILER_FRAMES];
}

function notifyFrameListeners(frame) {
  let listenerCount = 0;
  for (const listener of listeners) listenerSnapshot[listenerCount++] = listener;
  for (let i = 0; i < listenerCount; i++) {
    const listener = listenerSnapshot[i];
    listenerSnapshot[i] = null;
    if (!listeners.has(listener)) continue;                           
    try { listener(frame); } catch (_) {            }
  }
}

function nowMs() {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}

function clampMs(ms) {
  const v = Number(ms);
  if (!Number.isFinite(v) || v <= 0) return 0;
  return Math.min(v, 1000);
}

function catForJob(name) {
  const n = String(name || "").toLowerCase();
  if (n.includes("heartbeat")) return "heartbeat";
  if (n.includes("renderstepped")) return "stepped";
  if (n.includes("stepped")) return "stepped";
  if (n.includes("physics")) return "physics";
  if (n.includes("network") || n.includes("remote")) return "network";
  return "scripts";
}

function report(cat, ms, sub) {
  const id = CAT_IDS.includes(cat) ? cat : "other";
  const v = clampMs(ms);
  if (!v) return;
  pending[id] += v;
  if (sub) {
    const bucket = pendingSubs[id] || (pendingSubs[id] = {});
    bucket[sub] = (bucket[sub] || 0) + v;
  }
}

function collectScheduler() {
  let stats = null;
  try { stats = getSchedulerJobStats(); } catch (_) { return; }
  for (const st of stats || []) {
    const prev = lastJobRuns.get(st.name);
    if (prev !== st.runs) {
      lastJobRuns.set(st.name, st.runs);
      if (prev != null) report(catForJob(st.name), st.last, st.name);
    }
  }
}

function collectRender() {
  const s = getRenderSample();
  if (s && s.seq !== lastRenderSeq) {
    lastRenderSeq = s.seq;
    report("render", s.frameMs, "three.render");
  }
}

function sampleFrame() {
  if (refs <= 0) {
    lastTs = 0;
    return;
  }
  const now = nowMs();
  if (lastTs > 0) {
    const total = Math.min(now - lastTs, 1000);
    collectScheduler();
    collectRender();
    const recycledFrame = frameRing[frameWriteIndex];
    const cats = pending;
    const subs = pendingSubs;
    if (recycledFrame) {
      pending = resetCategoriesInPlace(recycledFrame.cats);
      pendingSubs = clearSubBucketsInPlace(recycledFrame.subs);
    } else {
      pending = emptyCats();
      pendingSubs = {};
    }
    let used = 0;
    for (const id of CAT_IDS) {
      if (id !== "other" && id !== "gc") used += cats[id];
    }
    let leftover = Math.max(0, total - used - cats.gc);
    if (leftover > 40 && total > emaTotal * 3) {
      const gcGuess = leftover * 0.75;
      cats.gc += gcGuess;
      leftover -= gcGuess;
      gcPauses++;
      gcTimeTotal += gcGuess;
      gcPeak = Math.max(gcPeak, gcGuess);
    }
    cats.other = leftover;
    emaTotal = emaTotal * 0.9 + total * 0.1;
    const frame = recycledFrame || { n: 0, at: 0, total: 0, cats: null, subs: null };
    frame.n = frameNo++;
    frame.at = now;
    frame.total = total;
    frame.cats = cats;
    frame.subs = subs;
    frameRing[frameWriteIndex] = frame;
    frameWriteIndex = (frameWriteIndex + 1) % MAX_PROFILER_FRAMES;
    if (frameRingCount < MAX_PROFILER_FRAMES) frameRingCount++;
    notifyFrameListeners(frame);
  }
  lastTs = now;
}

function startFrameSampling() {
  if (unregisterFrameCallback || refs <= 0) return;
  unregisterFrameCallback = registerFrameCallback("overlay", sampleFrame, "profiler");
}

function stopFrameSampling() {
  if (!unregisterFrameCallback) return;
  unregisterFrameCallback();
  unregisterFrameCallback = null;
}

export const profiler = {
  categories: PROFILER_CATEGORIES,
  maxFrames: MAX_PROFILER_FRAMES,

  retain() {
    refs++;
    if (refs === 1) {
      lastTs = 0;
      startFrameSampling();
    }
  },

  release() {
    refs = Math.max(0, refs - 1);
    if (refs === 0) {
      stopFrameSampling();
      lastTs = 0;
    }
  },

  isActive: () => refs > 0,
  report,

  onFrame(fn) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },

  getFrames: () => {
    const ordered = new Array(frameRingCount);
    for (let i = 0; i < frameRingCount; i++) ordered[i] = frameAtIndex(i);
    return ordered;
  },
  latestFrame: () => (frameRingCount ? frameAtIndex(frameRingCount - 1) : null),

  getSummary() {
    if (!frameRingCount) return null;
    const n = frameRingCount;
    let sumTotal = 0;
    let maxTotal = 0;
    const sums = emptyCats();
    const peaks = emptyCats();
    for (let i = 0; i < n; i++) {
      const f = frameAtIndex(i);
      sumTotal += f.total;
      maxTotal = Math.max(maxTotal, f.total);
      for (const id of CAT_IDS) {
        sums[id] += f.cats[id];
        peaks[id] = Math.max(peaks[id], f.cats[id]);
      }
    }
    const last = frameAtIndex(n - 1);
    const cats = {};
    for (const id of CAT_IDS) {
      cats[id] = { current: last.cats[id], average: sums[id] / n, peak: peaks[id] };
    }
    return {
      frameCount: n,
      fps: {
        current: last.total > 0 ? 1000 / last.total : 0,
        average: sumTotal > 0 ? 1000 / (sumTotal / n) : 0,
        min: maxTotal > 0 ? 1000 / maxTotal : 0,
      },
      frameTime: { current: last.total, average: sumTotal / n, peak: maxTotal },
      cats,
      gc: { pauses: gcPauses, totalMs: gcTimeTotal, avgMs: gcPauses ? gcTimeTotal / gcPauses : 0, peakMs: gcPeak },
    };
  },

  resetGcStats() {
    gcPauses = 0;
    gcTimeTotal = 0;
    gcPeak = 0;
  },
};
