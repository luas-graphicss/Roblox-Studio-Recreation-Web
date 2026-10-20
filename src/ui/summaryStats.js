import { profiler } from "../core/profiler.js";
import { getRenderSample } from "../core/renderStats.js";
import { getLiveConnectionCount } from "../runtime/scheduler.js";
import { engine } from "../runtime/engine.js";
import { store } from "../core/state.js";
import { getBasePartCount } from "../datamodel/basePartCount.js";
import { startVisibilityAwareInterval } from "../core/visibilityAwareInterval.js";

const REFRESH_INTERVAL_MS = 500;

let panel = null;
let stopRefreshInterval = null;
let body = null;
let agg = null;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function fmt(v, digits) {
  if (v == null || !Number.isFinite(v)) return "\u2014";
  const d = digits == null ? 1 : digits;
  return d === 0 ? String(Math.round(v)) : v.toFixed(d);
}


function countParts() {
  try {
    const dataModel = engine.getDataModel ? engine.getDataModel() : store.getDataModel();
    return getBasePartCount(dataModel);
  } catch (_) {
    return null;
  }
}

function buildMetrics() {
  return [
    { id: "fps", label: "Frame Rate", units: "fps", digits: 0, peakMode: "min", get: (c) => (c.sum ? c.sum.fps.current : null) },
    { id: "frameTime", label: "Frame Time", units: "ms", digits: 2, get: (c) => (c.sum ? c.sum.frameTime.current : null) },
    { id: "render", label: "Render Time", units: "ms", digits: 2, get: (c) => (c.sum ? c.sum.cats.render.current : null) },
    { id: "physics", label: "Physics Time", units: "ms", digits: 2, get: (c) => (c.sum ? c.sum.cats.physics.current : null) },
    { id: "scripts", label: "Script Time", units: "ms", digits: 2, get: (c) => (c.sum ? c.sum.cats.scripts.current + c.sum.cats.heartbeat.current + c.sum.cats.stepped.current : null) },
    { id: "gc", label: "GC Pauses", units: "ms", digits: 1, custom: (c) => (c.sum ? { current: c.sum.gc.pauses + " pausas", average: fmt(c.sum.gc.avgMs) + " ms", peak: fmt(c.sum.gc.peakMs) + " ms" } : null) },
    { id: "drawCalls", label: "Draw Calls", units: "calls", digits: 0, get: (c) => c.rs.calls },
    { id: "triangles", label: "Triangle Count", units: "tris", digits: 0, get: (c) => c.rs.triangles },
    { id: "texMem", label: "Texture Memory", units: "MB (est.)", digits: 1, get: (c) => c.rs.textures * 2 },
    { id: "scriptMem", label: "Script Memory", units: "MB (heap)", digits: 1, get: (c) => c.heapMb },
    { id: "parts", label: "Parts Count", units: "parts", digits: 0, get: (c) => c.parts },
    { id: "conns", label: "Connection Count", units: "conns", digits: 0, get: (c) => c.conns },
  ];
}

const METRICS = buildMetrics();

function tick() {
  if (!panel || !body) return;
  const mem = typeof performance !== "undefined" ? performance.memory : null;
  const ctx = {
    sum: profiler.getSummary(),
    rs: getRenderSample(),
    heapMb: mem && mem.usedJSHeapSize ? mem.usedJSHeapSize / 1048576 : null,
    parts: countParts(),
    conns: getLiveConnectionCount(),
  };
  const rows = [];
  for (const m of METRICS) {
    let current = "\u2014";
    let average = "\u2014";
    let peak = "\u2014";
    if (m.custom) {
      const v = m.custom(ctx);
      if (v) { current = v.current; average = v.average; peak = v.peak; }
    } else {
      const val = m.get(ctx);
      if (val != null && Number.isFinite(val)) {
        const a = agg.get(m.id) || { sum: 0, n: 0, peak: -Infinity, min: Infinity };
        a.sum += val;
        a.n++;
        a.peak = Math.max(a.peak, val);
        a.min = Math.min(a.min, val);
        agg.set(m.id, a);
        current = fmt(val, m.digits);
        average = fmt(a.sum / a.n, m.digits);
        peak = fmt(m.peakMode === "min" ? a.min : a.peak, m.digits);
      }
    }
    rows.push({ label: m.label, current, average, peak, units: m.units });
  }
  const frag = document.createDocumentFragment();
  for (const r of rows) {
    const tr = el("tr");
    tr.append(el("td", "rsw-stats__metric", r.label), el("td", null, String(r.current)), el("td", null, String(r.average)), el("td", null, String(r.peak)), el("td", "rsw-stats__units", r.units));
    frag.appendChild(tr);
  }
  body.replaceChildren(frag);
}

export function isSummaryStatsVisible() {
  return !!panel;
}

export function openSummaryStats() {
  if (panel) return;
  agg = new Map();
  profiler.resetGcStats();
  panel = el("div", "rsw-stats rsw-stats--summary");
  panel.setAttribute("role", "dialog");
  panel.setAttribute("aria-label", "Summary Stats");
  const header = el("div", "rsw-stats__header");
  const title = el("span", "rsw-stats__title", "Summary Stats");
  const closeBtn = el("button", "rsw-stats__close", "\u00d7");
  closeBtn.type = "button";
  closeBtn.title = "Fechar";
  closeBtn.addEventListener("click", () => closeSummaryStats());
  header.append(title, closeBtn);
  const table = el("table", "rsw-stats__table");
  const thead = el("thead");
  const hr = el("tr");
  for (const h of ["Metric", "Current", "Average", "Peak", "Units"]) hr.appendChild(el("th", null, h));
  thead.appendChild(hr);
  body = el("tbody");
  table.append(thead, body);
  panel.append(header, table);
  document.body.appendChild(panel);

  let dragging = null;
  header.addEventListener("mousedown", (e) => {
    if (e.target === closeBtn) return;
    const rect = panel.getBoundingClientRect();
    dragging = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    e.preventDefault();
  });
  const onMove = (e) => {
    if (!dragging) return;
    panel.style.left = Math.max(0, e.clientX - dragging.dx) + "px";
    panel.style.top = Math.max(0, e.clientY - dragging.dy) + "px";
    panel.style.right = "auto";
  };
  const onUp = () => { dragging = null; };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
  panel._cleanupDrag = () => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  };

  profiler.retain();
  tick();


  stopRefreshInterval = startVisibilityAwareInterval(tick, REFRESH_INTERVAL_MS);
}

export function closeSummaryStats() {
  if (!panel) return;
  if (stopRefreshInterval) stopRefreshInterval();
  stopRefreshInterval = null;
  profiler.release();
  if (panel._cleanupDrag) panel._cleanupDrag();
  panel.remove();
  panel = null;
  body = null;
  agg = null;
}

export function toggleSummaryStats() {
  if (panel) closeSummaryStats();
  else openSummaryStats();
}
