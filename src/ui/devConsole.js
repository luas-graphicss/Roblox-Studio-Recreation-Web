import { bus } from "../core/eventBus.js";
import { logger } from "../core/logger.js";
import { engine, RuntimeEvents } from "../runtime/engine.js";
import { profiler } from "../core/profiler.js";
import { scriptPerf } from "../devconsole/scriptPerf.js";
import { getDsStats, dsStatsReset } from "../devconsole/dsStats.js";
import {
  getSessionLogs, countLogLevels, consoleLevelOf, makeRateLimiter, collectMemory,
  flattenMemory, MAX_LINE_CHARS, COMMAND_RATE_PER_SEC,
} from "../devconsole/devConsoleData.js";
import { getNetCounters, getRemoteStats, resetRemoteStats } from "../runtime/network.js";
import { getBudget } from "../runtime/dataServices.js";
import * as monetization from "../runtime/monetization.js";
import { streaming } from "../runtime/streaming.js";
import { getInstancesOfAnyClass } from "../datamodel/classIndex.js";
import { startVisibilityAwareInterval } from "../core/visibilityAwareInterval.js";

const ROW_H = 20;



const PANEL_REFRESH_INTERVAL_MS = 1000;
const LOG_REFRESH_INTERVAL_MS = 150;
const MIN_W = 440;
const MIN_H = 280;
const TABS = [
  { id: "logClient", label: "Log (Client)" },
  { id: "logServer", label: "Log (Server)" },
  { id: "memory", label: "Memory" },
  { id: "scripts", label: "Scripts" },
  { id: "datastores", label: "DataStores" },
  { id: "network", label: "Network" },
  { id: "transactions", label: "Transactions" },
  { id: "cmdline", label: "Command Line" },
];
const LOG_FILTERS = ["All", "Output", "Info", "Warnings", "Errors"];
const FILTER_LEVEL = { Output: "output", Info: "info", Warnings: "warn", Errors: "error" };

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function fmtTime(ts) {
  const d = new Date(ts);
  const p = (v) => String(v).padStart(2, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`;
}

function fmtMb(mb) {
  return (Math.round(mb * 100) / 100).toFixed(2);
}

function instPath(inst) {
  const parts = [];
  let cur = inst;
  let guard = 0;
  while (cur && guard++ < 40) {
    const nm = cur.name || cur.className || "?";
    if (cur.className === "DataModel") break;
    parts.unshift(nm);
    cur = cur.getParent ? cur.getParent() : null;
  }
  return parts.join(".");
}

let ui = null;
let wired = false;

const state = {
  open: false,
  minimized: false,
  activeTab: "logClient",
  sessionStart: 0,
  clearMarks: { Client: 0, Server: 0 },
  badges: { Client: { errors: 0, warnings: 0 }, Server: { errors: 0, warnings: 0 } },
  logs: {
    logClient: { search: "", filter: "All", pinned: true, expandedId: 0, dirty: true },
    logServer: { search: "", filter: "All", pinned: true, expandedId: 0, dirty: true },
  },
  memory: { snapshot: null, expanded: new Set(["place"]), lastTree: null },
  scripts: { search: "", sortKey: "activity", sortDir: -1, rows: [], retained: false },
  net: { prevCounters: null, prevRemotes: new Map(), prevAt: 0 },
  tx: { type: "All", player: "All" },
  cmd: { history: [], histIndex: -1, draft: "", context: "server", allow: makeRateLimiter(COMMAND_RATE_PER_SEC), logOff: null },


  stopPanelRefresh: null,
  stopLogRefresh: null,
};

function ctxOfTab(tabId) {
  return tabId === "logClient" ? "Client" : "Server";
}

function resetSessionState() {
  state.sessionStart = Date.now();
  state.clearMarks = { Client: 0, Server: 0 };
  state.badges = { Client: { errors: 0, warnings: 0 }, Server: { errors: 0, warnings: 0 } };
  for (const k of ["logClient", "logServer"]) {
    state.logs[k].expandedId = 0;
    state.logs[k].pinned = true;
    state.logs[k].dirty = true;
  }
  state.memory.snapshot = null;
  state.memory.lastTree = null;
  state.scripts.rows = [];
  state.net.prevCounters = null;
  state.net.prevRemotes = new Map();
  state.net.prevAt = 0;
  state.tx.type = "All";
  state.tx.player = "All";
  state.cmd.history = [];
  state.cmd.histIndex = -1;
  state.cmd.draft = "";
  state.cmd.allow = makeRateLimiter(COMMAND_RATE_PER_SEC);
  scriptPerf.reset();
  dsStatsReset();
  resetRemoteStats();
}


function buildWindow() {
  if (ui) return ui;
  const root = el("div", "rsw-devcon");
  root.style.display = "none";

  const bar = el("div", "rsw-devcon__titlebar");
  const title = el("span", "rsw-devcon__title", "Developer Console");
  const btnMin = el("button", "rsw-devcon__btn", "\u2013");
  btnMin.type = "button";
  btnMin.title = "Minimizar";
  const btnClose = el("button", "rsw-devcon__btn rsw-devcon__btn--close", "\u00d7");
  btnClose.type = "button";
  btnClose.title = "Fechar (F9)";
  bar.append(title, btnMin, btnClose);

  const tabsBar = el("div", "rsw-devcon__tabs");
  const tabBtns = new Map();
  for (const t of TABS) {
    const b = el("button", "rsw-devcon__tab", t.label);
    b.type = "button";
    b.dataset.tab = t.id;
    b.addEventListener("click", () => setActiveTab(t.id));
    tabsBar.appendChild(b);
    tabBtns.set(t.id, b);
  }

  const body = el("div", "rsw-devcon__body");
  const panes = new Map();
  for (const t of TABS) {
    const pane = el("div", "rsw-devcon__pane");
    pane.dataset.pane = t.id;
    pane.style.display = "none";
    body.appendChild(pane);
    panes.set(t.id, pane);
  }

  const handles = {};
  for (const corner of ["nw", "ne", "sw", "se"]) {
    const h = el("div", `rsw-devcon__resize rsw-devcon__resize--${corner}`);
    h.dataset.corner = corner;
    root.appendChild(h);
    handles[corner] = h;
  }

  root.append(bar, tabsBar, body);
  document.body.appendChild(root);

  btnClose.addEventListener("click", () => closeConsole());
  btnMin.addEventListener("click", () => toggleMinimize());

  installDrag(root, bar);
  installResize(root, handles);

  ui = { root, bar, tabsBar, tabBtns, body, panes };
  buildLogPane("logClient");
  buildLogPane("logServer");
  buildMemoryPane();
  buildScriptsPane();
  buildDsPane();
  buildNetworkPane();
  buildTxPane();
  buildCmdPane();
  return ui;
}

function defaultGeometry() {
  const vw = window.innerWidth || 1200;
  const vh = window.innerHeight || 800;
  const w = Math.max(MIN_W, Math.round(vw * 0.6));
  const h = Math.max(MIN_H, Math.round(vh * 0.5));
  return { w, h, x: Math.round((vw - w) / 2), y: Math.round((vh - h) * 0.35) };
}

function applyGeometry(g) {
  ui.root.style.width = g.w + "px";
  ui.root.style.height = state.minimized ? "" : g.h + "px";
  ui.root.style.left = g.x + "px";
  ui.root.style.top = g.y + "px";
  state.geom = g;
}

function clampGeometry(g) {
  const vw = window.innerWidth || 1200;
  const vh = window.innerHeight || 800;
  g.w = Math.max(MIN_W, Math.min(g.w, vw - 16));
  g.h = Math.max(MIN_H, Math.min(g.h, vh - 16));
  g.x = Math.max(0, Math.min(g.x, vw - 80));
  g.y = Math.max(0, Math.min(g.y, vh - 40));
  return g;
}

function installDrag(root, bar) {
  let drag = null;
  bar.addEventListener("pointerdown", (e) => {
    if (e.target && e.target.tagName === "BUTTON") return;
    drag = { x0: e.clientX, y0: e.clientY, gx: state.geom.x, gy: state.geom.y };
    try { bar.setPointerCapture(e.pointerId); } catch (_) {            }
    e.preventDefault();
  });
  bar.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const g = { ...state.geom, x: drag.gx + (e.clientX - drag.x0), y: drag.gy + (e.clientY - drag.y0) };
    applyGeometry(clampGeometry(g));
  });
  const stop = () => { drag = null; };
  bar.addEventListener("pointerup", stop);
  bar.addEventListener("pointercancel", stop);
}

function installResize(root, handles) {
  for (const corner of Object.keys(handles)) {
    const h = handles[corner];
    let rs = null;
    h.addEventListener("pointerdown", (e) => {
      if (state.minimized) return;
      rs = { x0: e.clientX, y0: e.clientY, g: { ...state.geom } };
      try { h.setPointerCapture(e.pointerId); } catch (_) {            }
      e.preventDefault();
      e.stopPropagation();
    });
    h.addEventListener("pointermove", (e) => {
      if (!rs) return;
      const dx = e.clientX - rs.x0;
      const dy = e.clientY - rs.y0;
      const g = { ...rs.g };
      if (corner.includes("e")) g.w = rs.g.w + dx;
      if (corner.includes("s")) g.h = rs.g.h + dy;
      if (corner.includes("w")) { g.w = rs.g.w - dx; g.x = rs.g.x + dx; }
      if (corner.includes("n")) { g.h = rs.g.h - dy; g.y = rs.g.y + dy; }
      applyGeometry(clampGeometry(g));
      const tab = state.activeTab;
      if (tab === "logClient" || tab === "logServer") state.logs[tab].dirty = true;
    });
    const stop = () => { rs = null; };
    h.addEventListener("pointerup", stop);
    h.addEventListener("pointercancel", stop);
  }
}


const logUi = {};

function buildLogPane(tabId) {
  const pane = ui.panes.get(tabId);
  const toolbar = el("div", "rsw-devcon__toolbar");
  const search = el("input", "rsw-devcon__search");
  search.type = "text";
  search.placeholder = "Buscar\u2026";
  search.addEventListener("input", () => {
    state.logs[tabId].search = search.value;
    state.logs[tabId].dirty = true;
  });
  toolbar.appendChild(search);
  const filterBtns = new Map();
  for (const f of LOG_FILTERS) {
    const b = el("button", "rsw-devcon__filter", f);
    b.type = "button";
    b.addEventListener("click", () => {
      state.logs[tabId].filter = f;
      state.logs[tabId].dirty = true;
      for (const [name, btn] of filterBtns) btn.classList.toggle("is-on", name === f);
    });
    if (f === "All") b.classList.add("is-on");
    toolbar.appendChild(b);
    filterBtns.set(f, b);
  }
  const clearBtn = el("button", "rsw-devcon__filter rsw-devcon__filter--clear", "Clear");
  clearBtn.type = "button";
  clearBtn.addEventListener("click", () => {
    const ctx = ctxOfTab(tabId);
    const entries = getSessionLogs(ctx, state.sessionStart, state.clearMarks[ctx]);
    if (entries.length) state.clearMarks[ctx] = entries[entries.length - 1].id;
    state.badges[ctx] = { errors: 0, warnings: 0 };
    state.logs[tabId].expandedId = 0;
    state.logs[tabId].dirty = true;
    renderBadges();
  });
  toolbar.appendChild(clearBtn);

  const list = el("div", "rsw-devcon__loglist");
  const spacer = el("div", "rsw-devcon__logspacer");
  const layer = el("div", "rsw-devcon__loglayer");
  spacer.appendChild(layer);
  list.appendChild(spacer);
  list.addEventListener("scroll", () => {
    const pinned = list.scrollTop + list.clientHeight >= list.scrollHeight - 8;
    if (state.logs[tabId].pinned !== pinned) state.logs[tabId].pinned = pinned;
    state.logs[tabId].dirty = true;
  });
  pane.append(toolbar, list);
  logUi[tabId] = { list, spacer, layer, search, filterBtns, filtered: [], extraH: 0, expIdx: -1 };
}

function filterLogEntries(tabId) {
  const st = state.logs[tabId];
  const ctx = ctxOfTab(tabId);
  const entries = getSessionLogs(ctx, state.sessionStart, state.clearMarks[ctx]);
  const q = st.search.trim().toLowerCase();
  const lvl = FILTER_LEVEL[st.filter] || null;
  const out = [];
  for (const e of entries) {
    if (lvl && consoleLevelOf(e) !== lvl) continue;
    if (q && String(e.message || "").toLowerCase().indexOf(q) < 0) continue;
    out.push(e);
  }
  return out;
}

function expandedExtraHeight(entry) {
  if (!entry) return 0;
  const msgLines = Math.min(30, Math.ceil(String(entry.message || "").length / 110));
  const stackLines = entry.stack ? Math.min(14, String(entry.stack).split("\n").length) : 0;
  return 10 + Math.max(1, msgLines) * 15 + stackLines * 15;
}

function renderLogTab(tabId) {
  const st = state.logs[tabId];
  const w = logUi[tabId];
  if (!st.dirty) return;
  const filtered = filterLogEntries(tabId);
  w.filtered = filtered;
  const expIdx = st.expandedId ? filtered.findIndex((e) => e.id === st.expandedId) : -1;
  const extraH = expIdx >= 0 ? expandedExtraHeight(filtered[expIdx]) : 0;
  w.expIdx = expIdx;
  w.extraH = extraH;
  const total = filtered.length * ROW_H + extraH;
  w.spacer.style.height = total + "px";
  if (st.pinned && st.dirty) w.list.scrollTop = Math.max(0, total - w.list.clientHeight);

  const viewTop = w.list.scrollTop;
  const viewH = w.list.clientHeight || 300;
  const expTop = expIdx >= 0 ? expIdx * ROW_H : Infinity;
  const idxAt = (y) => {
    if (y < expTop) return Math.floor(y / ROW_H);
    if (y < expTop + ROW_H + extraH) return expIdx;
    return Math.floor((y - extraH) / ROW_H);
  };
  const start = Math.max(0, idxAt(viewTop) - 4);
  const end = Math.min(filtered.length - 1, idxAt(viewTop + viewH) + 4);

  w.layer.textContent = "";
  for (let i = start; i <= end; i++) {
    const e = filtered[i];
    const y = i * ROW_H + (expIdx >= 0 && i > expIdx ? extraH : 0);
    const row = el("div", "rsw-devcon__logrow rsw-devcon__logrow--" + consoleLevelOf(e));
    row.style.top = y + "px";
    const isExp = i === expIdx;
    const msg = String(e.message || "");
    const truncated = msg.length > MAX_LINE_CHARS;
    const line = el("div", "rsw-devcon__logline");
    line.textContent = `${fmtTime(e.time)}  ${truncated && !isExp ? msg.slice(0, MAX_LINE_CHARS) + "\u2026" : isExp ? "" : msg}`;
    row.appendChild(line);
    if (isExp) {
      row.classList.add("is-expanded");
      row.style.height = ROW_H + expandedExtraHeight(e) + "px";
      const detail = el("pre", "rsw-devcon__logdetail");
      detail.textContent = msg + (e.stack ? "\n" + String(e.stack) : "");
      line.textContent = `${fmtTime(e.time)}  [clique para recolher]`;
      row.appendChild(detail);
    }
    if (e.stack || truncated) {
      row.classList.add("is-expandable");
      line.addEventListener("click", () => {
        st.expandedId = st.expandedId === e.id ? 0 : e.id;
        st.pinned = false;
        st.dirty = true;
        renderLogTab(tabId);
      });
    }
    w.layer.appendChild(row);
  }
  st.dirty = false;
}

function renderBadges() {
  if (!ui) return;
  for (const tabId of ["logClient", "logServer"]) {
    const ctx = ctxOfTab(tabId);
    const base = TABS.find((t) => t.id === tabId).label;
    const b = state.badges[ctx];
    const parts = [];
    if (b.errors > 0) parts.push(`${b.errors} error${b.errors === 1 ? "" : "s"}`);
    if (b.warnings > 0) parts.push(`${b.warnings} warning${b.warnings === 1 ? "" : "s"}`);
    const btn = ui.tabBtns.get(tabId);
    btn.textContent = parts.length ? `${base} [${parts.join(", ")}]` : base;
    btn.classList.toggle("has-errors", b.errors > 0);
  }
}

function recomputeBadges() {
  for (const ctx of ["Client", "Server"]) {
    state.badges[ctx] = countLogLevels(getSessionLogs(ctx, state.sessionStart, state.clearMarks[ctx]));
  }
  renderBadges();
}


const memUi = {};

function buildMemoryPane() {
  const pane = ui.panes.get("memory");
  const toolbar = el("div", "rsw-devcon__toolbar");
  const total = el("span", "rsw-devcon__memtotal", "Total: \u2013");
  const snapBtn = el("button", "rsw-devcon__filter", "Snapshot");
  snapBtn.type = "button";
  snapBtn.addEventListener("click", () => {
    state.memory.snapshot = state.memory.lastTree ? flattenMemory(state.memory.lastTree) : null;
    renderMemory();
  });
  toolbar.append(total, snapBtn);
  const table = el("div", "rsw-devcon__memtable");
  pane.append(toolbar, table);
  memUi.total = total;
  memUi.table = table;
}

function memRow(cat, depth, totalMb, snap) {
  const row = el("div", "rsw-devcon__memrow");
  row.style.paddingLeft = 8 + depth * 18 + "px";
  const hasKids = cat.children && cat.children.length > 0;
  const arrow = el("span", "rsw-devcon__memarrow", hasKids ? (state.memory.expanded.has(cat.id) ? "\u25be" : "\u25b8") : "\u00a0");
  const name = el("span", "rsw-devcon__memname", cat.label);
  const val = el("span", "rsw-devcon__memval", fmtMb(cat.mb) + " MB");
  const barWrap = el("span", "rsw-devcon__membar");
  const fill = el("span", "rsw-devcon__membarfill");
  fill.style.width = Math.min(100, totalMb > 0 ? (cat.mb / totalMb) * 100 : 0) + "%";
  barWrap.appendChild(fill);
  row.append(arrow, name, val, barWrap);
  if (snap) {
    const prev = snap.get(cat.id);
    const delta = prev == null ? null : cat.mb - prev;
    const d = el("span", "rsw-devcon__memdelta", delta == null ? "\u2013" : (delta >= 0 ? "+" : "\u2212") + fmtMb(Math.abs(delta)));
    if (delta != null && Math.abs(delta) >= 0.005) d.classList.add(delta > 0 ? "is-up" : "is-down");
    row.appendChild(d);
  }
  if (hasKids) {
    row.classList.add("is-expandable");
    row.addEventListener("click", () => {
      if (state.memory.expanded.has(cat.id)) state.memory.expanded.delete(cat.id);
      else state.memory.expanded.add(cat.id);
      renderMemory();
    });
  }
  return row;
}

function renderMemory() {
  const streamed = streaming.isStreamingActive();
  const tree = streamed
    ? collectMemory(engine, { filter: (inst) => streaming.isLoadedForActive(inst) })
    : collectMemory(engine);
  state.memory.lastTree = tree;
  memUi.total.textContent = streamed
    ? `Total: ${fmtMb(tree.totalMb)} MB (client · streaming ativo)`
    : `Total: ${fmtMb(tree.totalMb)} MB`;
  memUi.table.textContent = "";
  const snap = state.memory.snapshot;
  const head = el("div", "rsw-devcon__memrow rsw-devcon__memrow--head");
  head.append(
    el("span", "rsw-devcon__memarrow", "\u00a0"),
    el("span", "rsw-devcon__memname", "Category"),
    el("span", "rsw-devcon__memval", "Value (MB)"),
    el("span", "rsw-devcon__membar rsw-devcon__membar--head", ""),
  );
  if (snap) head.appendChild(el("span", "rsw-devcon__memdelta", "Delta"));
  memUi.table.appendChild(head);
  const walk = (cats, depth) => {
    for (const c of cats) {
      memUi.table.appendChild(memRow(c, depth, tree.totalMb, snap));
      if (c.children && state.memory.expanded.has(c.id)) walk(c.children, depth + 1);
    }
  };
  walk(tree.categories, 0);
}


const scrUi = {};
const SCRIPT_COLS = [
  { key: "name", label: "Script Name" },
  { key: "context", label: "Context" },
  { key: "activity", label: "Activity (%)" },
  { key: "rate", label: "Rate (/s)" },
  { key: "time", label: "Time (ms)" },
];

function buildScriptsPane() {
  const pane = ui.panes.get("scripts");
  const toolbar = el("div", "rsw-devcon__toolbar");
  const search = el("input", "rsw-devcon__search");
  search.type = "text";
  search.placeholder = "Buscar script\u2026";
  search.addEventListener("input", () => {
    state.scripts.search = search.value;
    renderScriptsTable();
  });
  toolbar.appendChild(search);
  const head = el("div", "rsw-devcon__scrrow rsw-devcon__scrrow--head");
  for (const col of SCRIPT_COLS) {
    const c = el("span", "rsw-devcon__scrcell rsw-devcon__scrcell--" + col.key, col.label);
    c.addEventListener("click", () => {
      if (state.scripts.sortKey === col.key) state.scripts.sortDir *= -1;
      else {
        state.scripts.sortKey = col.key;
        state.scripts.sortDir = col.key === "name" || col.key === "context" ? 1 : -1;
      }
      renderScriptsTable();
    });
    head.appendChild(c);
  }
  const table = el("div", "rsw-devcon__scrtable");
  pane.append(toolbar, head, table);
  scrUi.table = table;
  scrUi.head = head;
}

const SCRIPT_CLASS_NAMES = Object.freeze(["Script", "LocalScript", "ModuleScript"]);


function scriptIndex() {
  const map = new Map();
  const dm = engine.getDataModel();
  if (!dm || !dm.getDescendants) return map;
  for (const inst of getInstancesOfAnyClass(dm, SCRIPT_CLASS_NAMES)) {
    if (!map.has(inst.name)) map.set(inst.name, inst);
  }
  return map;
}

function refreshScriptRows() {
  const { elapsedMs, entries } = scriptPerf.consume();
  const frames = Math.max(1, elapsedMs / 16.7);
  const rows = [];
  for (const e of entries) {
    if (e.count <= 0) continue;
    rows.push({
      name: e.name,
      context: e.context,
      activity: (e.timeMs / elapsedMs) * 100,
      rate: e.count / (elapsedMs / 1000),
      time: e.timeMs / frames,
    });
  }
  state.scripts.rows = rows;
  renderScriptsTable();
}

function renderScriptsTable() {
  if (!scrUi.table) return;
  const st = state.scripts;
  if (scrUi.head) {
    const cells = scrUi.head.children;
    SCRIPT_COLS.forEach((col, i) => {
      cells[i].textContent = col.label + (st.sortKey === col.key ? (st.sortDir < 0 ? " \u25be" : " \u25b4") : "");
    });
  }
  const q = st.search.trim().toLowerCase();
  const idx = scriptIndex();
  const rows = st.rows.filter((r) => !q || r.name.toLowerCase().indexOf(q) >= 0);
  const dir = st.sortDir;
  const key = st.sortKey;
  rows.sort((a, b) => {
    const av = a[key];
    const bv = b[key];
    if (typeof av === "string") return av.localeCompare(bv) * dir;
    return (av - bv) * dir;
  });
  scrUi.table.textContent = "";
  for (const r of rows.slice(0, 200)) {
    const row = el("div", "rsw-devcon__scrrow");
    if (r.activity > 10) row.classList.add("is-hot");
    else if (r.activity > 3) row.classList.add("is-warm");
    const inst = idx.get(r.name) || null;
    row.title = inst ? instPath(inst) : r.name;
    row.append(
      el("span", "rsw-devcon__scrcell rsw-devcon__scrcell--name", r.name),
      el("span", "rsw-devcon__scrcell rsw-devcon__scrcell--context", r.context),
      el("span", "rsw-devcon__scrcell rsw-devcon__scrcell--activity", r.activity.toFixed(2)),
      el("span", "rsw-devcon__scrcell rsw-devcon__scrcell--rate", r.rate.toFixed(1)),
      el("span", "rsw-devcon__scrcell rsw-devcon__scrcell--time", r.time.toFixed(3)),
    );
    if (inst) {
      row.classList.add("is-openable");
      row.addEventListener("click", () => bus.emit("editor:openScript", inst));
    }
    scrUi.table.appendChild(row);
  }
  if (!rows.length) {
    scrUi.table.appendChild(el("div", "rsw-devcon__empty", "Sem atividade de scripts no \u00faltimo intervalo."));
  }
}


const dsUi = {};

function buildDsPane() {
  const pane = ui.panes.get("datastores");
  const table = el("div", "rsw-devcon__kvtable");
  pane.appendChild(table);
  dsUi.table = table;
}

function kvRow(label, value) {
  const row = el("div", "rsw-devcon__kvrow");
  row.append(el("span", "rsw-devcon__kvlabel", label), el("span", "rsw-devcon__kvvalue", value));
  return row;
}

function renderDataStores() {
  const s = getDsStats();
  const t = dsUi.table;
  t.textContent = "";
  t.appendChild(el("div", "rsw-devcon__section", "Requests da sess\u00e3o (por tipo)"));
  for (const k of ["Get", "Set", "Update", "Increment", "Remove", "GetSorted", "List"]) {
    t.appendChild(kvRow(k, String(s.requests[k] || 0)));
  }
  t.appendChild(el("div", "rsw-devcon__section", "Budget dispon\u00edvel"));
  t.appendChild(kvRow("GetAsync", String(getBudget("GetAsync"))));
  t.appendChild(kvRow("SetIncrementAsync", String(getBudget("SetIncrementAsync"))));
  t.appendChild(kvRow("GetSortedAsync", String(getBudget("GetSortedAsync"))));
  t.appendChild(kvRow("ListAsync", String(getBudget("ListAsync"))));
  t.appendChild(el("div", "rsw-devcon__section", "Sess\u00e3o"));
  t.appendChild(kvRow("Fila pendente", String(s.pending)));
  t.appendChild(kvRow("Requests com throttle", String(s.throttled)));
  t.appendChild(kvRow("Falhas", String(s.failures)));
  t.appendChild(kvRow("Tempo m\u00e9dio de resposta", s.avgResponseMs > 0 ? s.avgResponseMs.toFixed(0) + " ms" : "\u2013"));
  if (s.lastErrors.length) {
    t.appendChild(el("div", "rsw-devcon__section", "\u00daltimos erros"));
    for (const err of s.lastErrors) {
      t.appendChild(kvRow(fmtTime(err.time), err.message));
    }
  }
}



const netUi = {};

function buildNetworkPane() {
  const pane = ui.panes.get("network");
  const table = el("div", "rsw-devcon__kvtable");
  const remotes = el("div", "rsw-devcon__scrtable");
  pane.append(table, remotes);
  netUi.table = table;
  netUi.remotes = remotes;
}

function renderNetwork() {
  const now = Date.now();
  const counters = getNetCounters();
  const remotes = getRemoteStats();
  const prev = state.net.prevCounters;
  const dtSec = state.net.prevAt > 0 ? Math.max(0.2, (now - state.net.prevAt) / 1000) : 1;
  const rate = (cur, prv) => (prev ? Math.max(0, cur - prv) / dtSec : 0);

  const outKb = rate(counters.bytesSent, prev ? prev.bytesSent : 0) / 1024;
  const inKb = rate(counters.bytesReceived, prev ? prev.bytesReceived : 0) / 1024;
  const evRate = rate(counters.remoteEvents, prev ? prev.remoteEvents : 0);
  const fnRate = rate(counters.remoteFunctions, prev ? prev.remoteFunctions : 0);

  const t = netUi.table;
  t.textContent = "";
  t.appendChild(el("div", "rsw-devcon__section", "Rede simulada"));
  t.appendChild(kvRow("Data Out", outKb.toFixed(2) + " KB/s"));
  t.appendChild(kvRow("Data In", inKb.toFixed(2) + " KB/s"));
  t.appendChild(kvRow("RemoteEvents", evRate.toFixed(1) + " /s"));
  t.appendChild(kvRow("RemoteFunctions", fnRate.toFixed(1) + " /s"));
  t.appendChild(kvRow("Replication queue", String(counters.queueSize)));
  t.appendChild(kvRow("Lat\u00eancia simulada", counters.latencyMs + " ms"));
  t.appendChild(kvRow("Packet loss", counters.packetLossPct + " %"));

  const prevRem = state.net.prevRemotes;
  const rows = [];
  for (const r of remotes) {
    const p = prevRem.get(r.name);
    const calls = p ? Math.max(0, r.calls - p.calls) / dtSec : 0;
    const bytes = p ? Math.max(0, r.bytes - p.bytes) / dtSec : 0;
    rows.push({
      name: r.name,
      kind: r.kind,
      dir: r.toServer >= r.toClient ? "Client \u2192 Server" : "Server \u2192 Client",
      calls,
      bytes,
      totalCalls: r.calls,
    });
  }
  rows.sort((a, b) => (b.calls - a.calls) || (b.totalCalls - a.totalCalls));
  const top = rows.slice(0, 10);
  const rem = netUi.remotes;
  rem.textContent = "";
  rem.appendChild(el("div", "rsw-devcon__section", "Remotes mais ativos (top 10)"));
  const head = el("div", "rsw-devcon__scrrow rsw-devcon__scrrow--head");
  head.append(
    el("span", "rsw-devcon__scrcell rsw-devcon__scrcell--name", "Remote"),
    el("span", "rsw-devcon__scrcell rsw-devcon__scrcell--context", "Dire\u00e7\u00e3o"),
    el("span", "rsw-devcon__scrcell rsw-devcon__scrcell--activity", "Calls/s"),
    el("span", "rsw-devcon__scrcell rsw-devcon__scrcell--rate", "Bytes/s"),
    el("span", "rsw-devcon__scrcell rsw-devcon__scrcell--time", "Total"),
  );
  rem.appendChild(head);
  for (const r of top) {
    const row = el("div", "rsw-devcon__scrrow");
    if (r.calls > 30) row.classList.add("is-hot");
    else if (r.calls > 10) row.classList.add("is-warm");
    row.append(
      el("span", "rsw-devcon__scrcell rsw-devcon__scrcell--name", `${r.name} (${r.kind})`),
      el("span", "rsw-devcon__scrcell rsw-devcon__scrcell--context", r.dir),
      el("span", "rsw-devcon__scrcell rsw-devcon__scrcell--activity", r.calls.toFixed(1)),
      el("span", "rsw-devcon__scrcell rsw-devcon__scrcell--rate", r.bytes.toFixed(0)),
      el("span", "rsw-devcon__scrcell rsw-devcon__scrcell--time", String(r.totalCalls)),
    );
    rem.appendChild(row);
  }
  if (!top.length) rem.appendChild(el("div", "rsw-devcon__empty", "Nenhum remote ativo na sess\u00e3o."));

  state.net.prevCounters = counters;
  state.net.prevAt = now;
  state.net.prevRemotes = new Map(remotes.map((r) => [r.name, { calls: r.calls, bytes: r.bytes }]));
}



const txUi = {};

function buildTxPane() {
  const pane = ui.panes.get("transactions");
  const bar = el("div", "rsw-devcon__cmdbar");
  const typeSel = el("select", "rsw-devcon__cmdctx");
  for (const t of ["All", "GamePass", "Product", "Badge"]) {
    const o = el("option", null, t === "All" ? "Type: All" : t);
    o.value = t;
    typeSel.appendChild(o);
  }
  typeSel.addEventListener("change", () => {
    state.tx.type = typeSel.value;
    renderTransactions();
  });
  const playerSel = el("select", "rsw-devcon__cmdctx");
  playerSel.addEventListener("change", () => {
    state.tx.player = playerSel.value;
    renderTransactions();
  });
  const clearBtn = el("button", "rsw-devcon__filter", "Clear History");
  clearBtn.type = "button";
  clearBtn.addEventListener("click", () => {
    monetization.clearTransactions();
    renderTransactions();
  });
  bar.append(typeSel, playerSel, clearBtn);
  const table = el("div", "rsw-devcon__scrtable");
  pane.append(bar, table);
  txUi.typeSel = typeSel;
  txUi.playerSel = playerSel;
  txUi.table = table;
  txUi.playersSig = null;
}

function syncTxPlayerOptions(all) {
  const players = [...new Set(all.map((t) => t.playerName))];
  const sig = players.join("|");
  if (txUi.playersSig === sig) return;
  txUi.playersSig = sig;
  txUi.playerSel.textContent = "";
  for (const p of ["All", ...players]) {
    const o = el("option", null, p === "All" ? "Player: All" : p);
    o.value = p;
    txUi.playerSel.appendChild(o);
  }
  if (![...txUi.playerSel.options].some((o) => o.value === state.tx.player)) {
    state.tx.player = "All";
  }
  txUi.playerSel.value = state.tx.player;
}

function renderTransactions() {
  if (!txUi.table) return;
  const all = monetization.getTransactions();
  syncTxPlayerOptions(all);
  let rows = all;
  if (state.tx.type !== "All") rows = rows.filter((t) => t.type === state.tx.type);
  if (state.tx.player !== "All") rows = rows.filter((t) => t.playerName === state.tx.player);
  rows = rows.slice(-200).reverse();
  const t = txUi.table;
  t.textContent = "";
  const head = el("div", "rsw-devcon__scrrow rsw-devcon__scrrow--head");
  head.append(
    el("span", "rsw-devcon__scrcell rsw-devcon__scrcell--time", "Timestamp"),
    el("span", "rsw-devcon__scrcell rsw-devcon__scrcell--context", "Player"),
    el("span", "rsw-devcon__scrcell rsw-devcon__scrcell--context", "Type"),
    el("span", "rsw-devcon__scrcell rsw-devcon__scrcell--name", "Item"),
    el("span", "rsw-devcon__scrcell rsw-devcon__scrcell--rate", "Amount"),
    el("span", "rsw-devcon__scrcell rsw-devcon__scrcell--activity", "Status"),
  );
  t.appendChild(head);
  for (const tx of rows) {
    const row = el("div", "rsw-devcon__scrrow");
    row.append(
      el("span", "rsw-devcon__scrcell rsw-devcon__scrcell--time", fmtTime(tx.time)),
      el("span", "rsw-devcon__scrcell rsw-devcon__scrcell--context", tx.playerName),
      el("span", "rsw-devcon__scrcell rsw-devcon__scrcell--context", tx.type),
      el("span", "rsw-devcon__scrcell rsw-devcon__scrcell--name", tx.itemName),
      el("span", "rsw-devcon__scrcell rsw-devcon__scrcell--rate", String(tx.amount)),
      el("span", "rsw-devcon__scrcell rsw-devcon__scrcell--activity rsw-devcon__tx--" + String(tx.status || "").toLowerCase(), tx.status),
    );
    t.appendChild(row);
  }
  if (!rows.length) t.appendChild(el("div", "rsw-devcon__empty", "Nenhuma transa\u00e7\u00e3o na sess\u00e3o."));
}


const cmdUi = {};

function buildCmdPane() {
  const pane = ui.panes.get("cmdline");
  const output = el("div", "rsw-devcon__cmdout");
  const bar = el("div", "rsw-devcon__cmdbar");
  const ctxSel = el("select", "rsw-devcon__cmdctx");
  for (const c of ["Server", "Client"]) {
    const o = el("option", null, c);
    o.value = c.toLowerCase();
    ctxSel.appendChild(o);
  }
  ctxSel.addEventListener("change", () => {
    state.cmd.context = ctxSel.value === "client" ? "client" : "server";
  });
  const input = el("input", "rsw-devcon__cmdinput");
  input.type = "text";
  input.placeholder = "Executar Luau no contexto selecionado\u2026";
  input.setAttribute("autocomplete", "off");
  input.setAttribute("spellcheck", "false");
  const runBtn = el("button", "rsw-devcon__filter", "Run");
  runBtn.type = "button";
  bar.append(ctxSel, input, runBtn);
  pane.append(output, bar);
  cmdUi.output = output;
  cmdUi.input = input;

  const appendLine = (text, cls) => {
    const line = el("div", "rsw-devcon__cmdline" + (cls ? " " + cls : ""), text);
    output.appendChild(line);
    while (output.childNodes.length > 200) output.removeChild(output.firstChild);
    output.scrollTop = output.scrollHeight;
  };
  cmdUi.appendLine = appendLine;

  const runCommand = () => {
    const code = String(input.value || "").trim();
    if (!code) return;
    if (!engine.isRunning()) {
      appendLine("O Playtest n\u00e3o est\u00e1 rodando.", "rsw-devcon__logrow--warn");
      return;
    }
    if (state.cmd.context === "client" && !engine.clientEnv) {
      appendLine("Contexto Client indispon\u00edvel (use o modo Play para ter um Client).", "rsw-devcon__logrow--warn");
      return;
    }
    if (!state.cmd.allow()) {
      appendLine("Rate limit: m\u00e1ximo de " + COMMAND_RATE_PER_SEC + " execu\u00e7\u00f5es por segundo.", "rsw-devcon__logrow--warn");
      return;
    }
    const hist = state.cmd.history;
    if (hist[hist.length - 1] !== code) {
      hist.push(code);
      if (hist.length > 100) hist.shift();
    }
    state.cmd.histIndex = -1;
    state.cmd.draft = "";
    appendLine(`${state.cmd.context === "client" ? "[Client]" : "[Server]"} > ${code}`, "rsw-devcon__cmdecho");
    logger.info(`> ${code}`, { source: "Command", context: state.cmd.context === "client" ? "Client" : "Server" });
    try {
      engine.execCommand(code, state.cmd.context);
    } catch (e) {
      appendLine(String(e && e.message ? e.message : e), "rsw-devcon__logrow--error");
    }
    input.value = "";
  };
  runBtn.addEventListener("click", runCommand);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      e.preventDefault();
      runCommand();
    } else if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      e.preventDefault();
      const hist = state.cmd.history;
      if (!hist.length) return;
      if (state.cmd.histIndex === -1) {
        state.cmd.draft = input.value;
        state.cmd.histIndex = hist.length;
      }
      state.cmd.histIndex += e.key === "ArrowUp" ? -1 : 1;
      if (state.cmd.histIndex < 0) state.cmd.histIndex = 0;
      if (state.cmd.histIndex >= hist.length) {
        state.cmd.histIndex = -1;
        input.value = state.cmd.draft;
        return;
      }
      input.value = hist[state.cmd.histIndex];
    }
    e.stopPropagation();
  });
}

function startCmdMirror() {
  stopCmdMirror();
  state.cmd.logOff = bus.on("log:added", (entry) => {
    if (!entry || !entry.context) return;
    if (entry.source === "Command") return;
    const want = state.cmd.context === "client" ? "Client" : "Server";
    if (entry.context !== want) return;
    if (entry.time < state.sessionStart) return;
    const msg = String(entry.message || "");
    cmdUi.appendLine(`${fmtTime(entry.time)}  ${msg.length > MAX_LINE_CHARS ? msg.slice(0, MAX_LINE_CHARS) + "\u2026" : msg}`, "rsw-devcon__logrow--" + consoleLevelOf(entry));
  });
}

function stopCmdMirror() {
  if (typeof state.cmd.logOff === "function") state.cmd.logOff();
  state.cmd.logOff = null;
}


function stopCollectors() {
  if (state.stopPanelRefresh) {
    state.stopPanelRefresh();
    state.stopPanelRefresh = null;
  }
  if (state.stopLogRefresh) {
    state.stopLogRefresh();
    state.stopLogRefresh = null;
  }
  if (state.scripts.retained) {
    scriptPerf.release();
    state.scripts.retained = false;
  }
  stopCmdMirror();
}

function startCollectors() {
  stopCollectors();
  if (!state.open || state.minimized) return;
  const tab = state.activeTab;
  if (tab === "logClient" || tab === "logServer") {
    state.logs[tab].dirty = true;
    renderLogTab(tab);
    state.stopLogRefresh = startVisibilityAwareInterval(() => {
      if (state.logs[tab].dirty) renderLogTab(tab);
    }, LOG_REFRESH_INTERVAL_MS);
  } else if (tab === "memory") {
    renderMemory();
    state.stopPanelRefresh = startVisibilityAwareInterval(renderMemory, PANEL_REFRESH_INTERVAL_MS);
  } else if (tab === "scripts") {
    scriptPerf.retain();
    state.scripts.retained = true;
    renderScriptsTable();
    state.stopPanelRefresh = startVisibilityAwareInterval(refreshScriptRows, PANEL_REFRESH_INTERVAL_MS);
  } else if (tab === "datastores") {
    renderDataStores();
    state.stopPanelRefresh = startVisibilityAwareInterval(renderDataStores, PANEL_REFRESH_INTERVAL_MS);
  } else if (tab === "network") {
    renderNetwork();
    state.stopPanelRefresh = startVisibilityAwareInterval(renderNetwork, PANEL_REFRESH_INTERVAL_MS);
  } else if (tab === "transactions") {
    renderTransactions();
    state.stopPanelRefresh = startVisibilityAwareInterval(renderTransactions, PANEL_REFRESH_INTERVAL_MS);
  } else if (tab === "cmdline") {
    startCmdMirror();
    requestAnimationFrame(() => {
      try { cmdUi.input.focus(); } catch (_) {            }
    });
  }
}

function setActiveTab(tabId) {
  if (!TABS.some((t) => t.id === tabId)) return;
  state.activeTab = tabId;
  for (const [id, btn] of ui.tabBtns) btn.classList.toggle("is-active", id === tabId);
  for (const [id, pane] of ui.panes) pane.style.display = id === tabId ? "" : "none";
  startCollectors();
}

function toggleMinimize() {
  state.minimized = !state.minimized;
  ui.root.classList.toggle("is-minimized", state.minimized);
  if (state.minimized) {
    ui.root.style.height = "";
    stopCollectors();
  } else {
    applyGeometry(state.geom);
    startCollectors();
  }
}


function openConsole() {
  if (!engine.isRunning()) return;
  buildWindow();
  if (!state.geom) applyGeometry(defaultGeometry());
  state.open = true;
  state.minimized = false;
  ui.root.classList.remove("is-minimized");
  ui.root.style.display = "";
  applyGeometry(clampGeometry(state.geom));
  recomputeBadges();
  setActiveTab(state.activeTab);
}

function closeConsole() {
  if (!ui || !state.open) return;
  state.open = false;
  stopCollectors();
  ui.root.style.display = "none";
}

function toggleConsole() {
  if (state.open) closeConsole();
  else openConsole();
}

let logCountOff = null;

export function initDevConsole() {
  if (wired || typeof document === "undefined") return;
  wired = true;
  scriptPerf.setExternalProbe(() => profiler.isActive());
  bus.on("devconsole:toggle", () => toggleConsole());
  bus.on("devconsole:open", () => openConsole());
  bus.on(RuntimeEvents.ModeChanged, () => {
    if (engine.isRunning()) {
      resetSessionState();
    } else {
      closeConsole();
      resetSessionState();
      state.sessionStart = 0;
      state.activeTab = "logClient";
      state.geom = null;
      if (ui) {
        for (const k of ["logClient", "logServer"]) {
          logUi[k].layer.textContent = "";
          logUi[k].search.value = "";
          state.logs[k].search = "";
          state.logs[k].filter = "All";
          for (const [name, btn] of logUi[k].filterBtns) btn.classList.toggle("is-on", name === "All");
        }
        cmdUi.output.textContent = "";
        cmdUi.input.value = "";
        renderBadges();
      }
    }
  });
  if (!logCountOff) {
    logCountOff = bus.on("log:added", (entry) => {
      if (!state.open || !entry || !entry.context) return;
      if (entry.context !== "Client" && entry.context !== "Server") return;
      if (entry.time < state.sessionStart) return;
      if (entry.level === "error") state.badges[entry.context].errors++;
      else if (entry.level === "warn") state.badges[entry.context].warnings++;
      else {
        const tabId = entry.context === "Client" ? "logClient" : "logServer";
        state.logs[tabId].dirty = true;
        return;
      }
      const tabId = entry.context === "Client" ? "logClient" : "logServer";
      state.logs[tabId].dirty = true;
      renderBadges();
    });
  }
}

export const devConsoleDebug = {
  isOpen: () => state.open,
  isMinimized: () => state.minimized,
  getActiveTab: () => state.activeTab,
  open: () => openConsole(),
  close: () => closeConsole(),
};
