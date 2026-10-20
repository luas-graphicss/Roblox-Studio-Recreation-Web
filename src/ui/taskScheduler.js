import { bus } from "../core/eventBus.js";
import { logger } from "../core/logger.js";
import { getSchedulerJobStats } from "../runtime/scheduler.js";
import { engine } from "../runtime/engine.js";

const UPDATE_MS = 500;

const DEFAULT_JOBS = [
  "Heartbeat",
  "Stepped",
  "RenderStepped",
  "Physics Simulation",
  "Input Processing",
  "Tweens",
  "Wait Resume",
  "Sound",
];

let win = null;
let visible = false;
let timer = null;
let rows = new Map();                                                                   
let detailEl = null;
let detailJob = null;

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function fmtMs(v) {
  if (typeof v !== "number" || !Number.isFinite(v) || v <= 0) return "\u2014";
  return v < 10 ? v.toFixed(2) + " ms" : v.toFixed(1) + " ms";
}

function fmtRate(errors, runs) {
  if (!runs) return "\u2014";
  const pct = (errors / runs) * 100;
  if (pct === 0) return "0%";
  return pct < 0.1 ? "<0.1%" : pct.toFixed(1) + "%";
}

function isEngineRunning() {
  try { return typeof engine.isRunning === "function" ? !!engine.isRunning() : false; }
  catch (_) { return false; }
}


function currentJobs() {
  const stats = new Map();
  try {
    for (const s of getSchedulerJobStats()) stats.set(s.name, s);
  } catch (err) {
    logger.warn("Task Scheduler: falha ao ler stats: " + ((err && err.message) || err));
  }
  const names = [...DEFAULT_JOBS];
  for (const n of stats.keys()) if (!names.includes(n)) names.push(n);
  const running = isEngineRunning();
  return names.map((name) => {
    const s = stats.get(name);
    return {
      name,
      ema: s ? s.ema : 0,
      max: s ? s.max : 0,
      last: s ? s.last : 0,
      runs: s ? s.runs : 0,
      errors: s ? s.errors : 0,
      running: running && !!s && s.runs > 0,
    };
  });
}

function renderDetail(job) {
  if (!detailEl) return;
  if (!job) {
    detailEl.hidden = true;
    detailEl.textContent = "";
    return;
  }
  detailEl.hidden = false;
  detailEl.textContent = "";
  detailEl.appendChild(el("div", "rsw-tasks__detail-title", job.name));
  const dl = el("div", "rsw-tasks__detail-grid");
  const add = (k, v) => {
    dl.appendChild(el("span", "rsw-tasks__detail-k", k));
    dl.appendChild(el("span", "rsw-tasks__detail-v", v));
  };
  add("M\u00e9dia (EMA)", fmtMs(job.ema));
  add("\u00daltimo frame", fmtMs(job.last));
  add("M\u00e1ximo", fmtMs(job.max));
  add("Execu\u00e7\u00f5es", String(job.runs));
  add("Erros", String(job.errors));
  add("Error Rate", fmtRate(job.errors, job.runs));
  detailEl.appendChild(dl);
}

function update() {
  if (!win || !visible) return;
  const jobs = currentJobs();
  for (const job of jobs) {
    let row = rows.get(job.name);
    if (!row) continue;                                                                 
    const next = {
      time: fmtMs(job.ema),
      err: fmtRate(job.errors, job.runs),
      run: job.running ? "Sim" : "N\u00e3o",
    };

    if (next.time !== row.last.time) { row.cells.time.textContent = next.time; row.last.time = next.time; }
    if (next.err !== row.last.err) { row.cells.err.textContent = next.err; row.last.err = next.err; }
    if (next.run !== row.last.run) {
      row.cells.run.textContent = next.run;
      row.tr.classList.toggle("rsw-tasks__row--running", job.running);
      row.last.run = next.run;
    }
    if (detailJob === job.name) renderDetail(job);
  }
}

function buildWindow() {
  win = el("div", "rsw-tasks");
  win.hidden = true;
  win.setAttribute("role", "dialog");
  win.setAttribute("aria-label", "Task Scheduler");

  const header = el("div", "rsw-tasks__header");
  header.appendChild(el("span", "rsw-tasks__title", "Task Scheduler"));
  const closeBtn = el("button", "rsw-tasks__close", "\u00d7");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Fechar Task Scheduler");
  closeBtn.addEventListener("click", hide);
  header.appendChild(closeBtn);
  win.appendChild(header);

  const note = el("div", "rsw-tasks__note", "Somente leitura. Dados em tempo real durante o Playtest.");
  win.appendChild(note);

  const table = el("table", "rsw-tasks__table");
  const thead = el("thead");
  const hrow = el("tr");
  for (const h of ["Job Name", "Execution Time", "Error Rate", "Is Running"]) {
    hrow.appendChild(el("th", null, h));
  }
  thead.appendChild(hrow);
  table.appendChild(thead);
  const tbody = el("tbody");
  table.appendChild(tbody);
  win.appendChild(table);

  rows = new Map();
  for (const job of currentJobs()) {
    const tr = el("tr", "rsw-tasks__row");
    tr.tabIndex = 0;
    const name = el("td", "rsw-tasks__name", job.name);
    const time = el("td", null, "\u2014");
    const err = el("td", null, "\u2014");
    const run = el("td", null, "N\u00e3o");
    tr.append(name, time, err, run);
    const select = () => {
      detailJob = detailJob === job.name ? null : job.name;
      for (const r of rows.values()) r.tr.classList.remove("rsw-tasks__row--selected");
      if (detailJob) tr.classList.add("rsw-tasks__row--selected");
      renderDetail(detailJob ? currentJobs().find((j) => j.name === detailJob) : null);
    };
    tr.addEventListener("click", select);
    tr.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); select(); } });
    tbody.appendChild(tr);
    rows.set(job.name, { tr, cells: { time, err, run }, last: { time: "\u2014", err: "\u2014", run: "N\u00e3o" } });
  }

  detailEl = el("div", "rsw-tasks__detail");
  detailEl.hidden = true;
  win.appendChild(detailEl);


  let dragState = null;
  header.addEventListener("pointerdown", (e) => {
    if (e.button !== 0 || e.target === closeBtn) return;
    const rect = win.getBoundingClientRect();
    dragState = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    header.setPointerCapture?.(e.pointerId);
  });
  header.addEventListener("pointermove", (e) => {
    if (!dragState) return;
    const maxX = Math.max(0, (globalThis.innerWidth || 1200) - 120);
    const maxY = Math.max(0, (globalThis.innerHeight || 800) - 60);
    win.style.left = Math.min(maxX, Math.max(0, e.clientX - dragState.dx)) + "px";
    win.style.top = Math.min(maxY, Math.max(0, e.clientY - dragState.dy)) + "px";
  });
  const endDrag = () => { dragState = null; };
  header.addEventListener("pointerup", endDrag);
  header.addEventListener("pointercancel", endDrag);

  document.body.appendChild(win);
}

function show() {
  if (!win) buildWindow();
  if (visible) return;
  visible = true;
  win.hidden = false;
  if (!win.style.left) { win.style.left = "120px"; win.style.top = "120px"; }

  timer = setInterval(update, UPDATE_MS);
  update();
  bus.emit("taskscheduler:visibilityChanged", { visible: true });
}

function hide() {
  if (!visible) return;
  visible = false;
  if (win) win.hidden = true;
  if (timer) { clearInterval(timer); timer = null; }
  bus.emit("taskscheduler:visibilityChanged", { visible: false });
}

export function isTaskSchedulerVisible() {
  return visible;
}

export function initTaskScheduler() {
  bus.on("taskscheduler:toggle", () => (visible ? hide() : show()));
  bus.on("taskscheduler:show", show);
  bus.on("taskscheduler:hide", hide);
  logger.info("Task Scheduler inicializado.");
}
