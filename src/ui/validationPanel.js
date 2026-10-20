import { bus } from "../core/eventBus.js";
import { logger } from "../core/logger.js";
import { createIcon } from "./icons.js";
import { readJSON, writeJSON } from "../utils/storage.js";
import {
  runMasterValidation, isValidationRunning, listGroups,
} from "../validation/masterValidation.js";
import { registerAllChecks } from "../validation/checks.js";

const LAST_RUN_KEY = "validationLastRun";

const STATUS_META = {
  pass: { icon: "check", cls: "is-pass", label: "OK" },
  warn: { icon: "warning", cls: "is-warn", label: "Aviso" },
  fail: { icon: "close", cls: "is-fail", label: "Falha" },
  skip: { icon: "minus", cls: "is-skip", label: "Pulado" },
  pending: { icon: "circle", cls: "is-pending", label: "Pendente" },
  running: { icon: "circleHalf", cls: "is-running", label: "Executando" },
};

let win = null;
let listEl = null;
let summaryEl = null;
let runBtn = null;
let exportBtn = null;
let lastReport = null;
let registered = false;
const rows = new Map();
const offs = [];

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function setRowStatus(checkId, status, detail, ms) {
  const row = rows.get(checkId);
  if (!row) return;
  const meta = STATUS_META[status] || STATUS_META.pending;
  row.root.className = "rsw-val__row " + meta.cls;
  row.icon.replaceChildren(createIcon(meta.icon, 13));
  row.detail.textContent = detail || "";
  row.time.textContent = Number.isFinite(ms) ? ms + "ms" : "";
}

function loadLastRun() {
  const raw = readJSON(LAST_RUN_KEY);
  if (!raw || typeof raw !== "object" || typeof raw.at !== "string") return null;
  const s = raw.summary;
  if (!s || typeof s !== "object") return null;
  const num = (v) => (Number.isFinite(Number(v)) ? Math.max(0, Math.floor(Number(v))) : 0);
  return {
    at: raw.at.slice(0, 40),
    summary: { pass: num(s.pass), warn: num(s.warn), fail: num(s.fail), skip: num(s.skip) },
  };
}

function saveLastRun(report) {
  if (!report) return;
  writeJSON(LAST_RUN_KEY, { at: report.startedAt, summary: report.summary });
}

function formatRunDate(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("pt-BR", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" });
}

function renderSummary(summary, durationMs) {
  if (!summaryEl) return;
  if (!summary) {
    const last = loadLastRun();
    if (last) {
      const s = last.summary;
      summaryEl.textContent =
        `Última execução ${formatRunDate(last.at)}: ${s.pass} ok \u00b7 ${s.warn} aviso(s) \u00b7 ` +
        `${s.fail} falha(s) \u00b7 ${s.skip} pulado(s).`;
      summaryEl.className =
        "rsw-val__summary " + (s.fail > 0 ? "is-fail" : s.warn > 0 ? "is-warn" : "is-pass");
    } else {
      summaryEl.textContent = "Pronto para executar a validação completa do editor.";
      summaryEl.className = "rsw-val__summary";
    }
    return;
  }
  const parts = [
    summary.pass + " ok",
    summary.warn + " aviso(s)",
    summary.fail + " falha(s)",
    summary.skip + " pulado(s)",
  ];
  summaryEl.textContent =
    parts.join(" \u00b7 ") + (durationMs ? ` \u2014 ${(durationMs / 1000).toFixed(1)}s` : "");
  summaryEl.className =
    "rsw-val__summary " + (summary.fail > 0 ? "is-fail" : summary.warn > 0 ? "is-warn" : "is-pass");
}

function buildList() {
  listEl.textContent = "";
  rows.clear();
  for (const group of listGroups()) {
    const gEl = el("div", "rsw-val__group");
    gEl.appendChild(el("div", "rsw-val__grouptitle", group.label));
    for (const check of group.checks) {
      const root = el("div", "rsw-val__row is-pending");
      const icon = el("span", "rsw-val__icon");
      icon.appendChild(createIcon(STATUS_META.pending.icon, 13));
      const main = el("div", "rsw-val__main");
      const label = el("div", "rsw-val__label", check.label);
      const detail = el("div", "rsw-val__detail", "");
      main.append(label, detail);
      const time = el("span", "rsw-val__time", "");
      root.append(icon, main, time);
      gEl.appendChild(root);
      rows.set(check.id, { root, icon, detail, time });
    }
    listEl.appendChild(gEl);
  }
}

async function runAll() {
  if (isValidationRunning()) return;
  runBtn.disabled = true;
  exportBtn.disabled = true;
  runBtn.textContent = "Executando\u2026";
  for (const [id] of rows) setRowStatus(id, "pending", "", NaN);
  summaryEl.textContent = "Executando checks\u2026";
  summaryEl.className = "rsw-val__summary";
  const report = await runMasterValidation();
  lastReport = report;
  runBtn.disabled = false;
  exportBtn.disabled = !report;
  runBtn.textContent = "Executar validação";
  if (report) {
    saveLastRun(report);
    renderSummary(report.summary, report.durationMs);
  }
}

function exportReport() {
  if (!lastReport) return;
  try {
    const blob = new Blob([JSON.stringify(lastReport, null, 2)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = "validation-report.json";
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 3000);
    logger.info("Relatório de validação exportado.", { source: "Studio" });
  } catch (e) {
    logger.warn("Falha ao exportar relatório: " + ((e && e.message) || e), { source: "Studio" });
  }
}

export function isValidationPanelVisible() {
  return !!win;
}

export function openValidationPanel() {
  if (win) return;
  if (!registered) {
    registerAllChecks();
    registered = true;
  }

  win = el("div", "rsw-val");
  win.setAttribute("role", "dialog");
  win.setAttribute("aria-label", "Validação Mestre");

  const header = el("div", "rsw-val__header");
  const title = el("span", "rsw-val__title", "Validação Mestre");
  const closeBtn = el("button", "rsw-val__close");
  closeBtn.appendChild(createIcon("close", 13));
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Fechar Validação Mestre");
  closeBtn.addEventListener("click", () => closeValidationPanel());
  header.append(title, closeBtn);

  const bar = el("div", "rsw-val__bar");
  runBtn = el("button", "rsw-val__btn rsw-val__btn--primary", "Executar validação");
  runBtn.type = "button";
  runBtn.addEventListener("click", runAll);
  exportBtn = el("button", "rsw-val__btn", "Exportar JSON");
  exportBtn.type = "button";
  exportBtn.disabled = true;
  exportBtn.addEventListener("click", exportReport);
  bar.append(runBtn, exportBtn);

  summaryEl = el("div", "rsw-val__summary");
  listEl = el("div", "rsw-val__list");

  win.append(header, bar, summaryEl, listEl);
  document.body.appendChild(win);
  buildList();
  renderSummary(null);

  let dragging = null;
  header.addEventListener("mousedown", (e) => {
    if (e.target === closeBtn) return;
    const rect = win.getBoundingClientRect();
    dragging = { dx: e.clientX - rect.left, dy: e.clientY - rect.top };
    e.preventDefault();
  });
  const onMove = (e) => {
    if (!dragging) return;
    win.style.left = Math.max(0, e.clientX - dragging.dx) + "px";
    win.style.top = Math.max(0, e.clientY - dragging.dy) + "px";
    win.style.right = "auto";
  };
  const onUp = () => { dragging = null; };
  document.addEventListener("mousemove", onMove);
  document.addEventListener("mouseup", onUp);
  offs.push(() => {
    document.removeEventListener("mousemove", onMove);
    document.removeEventListener("mouseup", onUp);
  });

  offs.push(bus.on("validation:progress", (p) => {
    if (!p || !p.check) return;
    setRowStatus(p.check.id, p.check.status, p.check.detail, p.check.ms);
    if (p.summary) renderSummary(p.summary);
  }));
}

export function closeValidationPanel() {
  if (!win) return;
  for (const off of offs) {
    try { off(); } catch (_e) {            }
  }
  offs.length = 0;
  rows.clear();
  win.remove();
  win = null;
  listEl = null;
  summaryEl = null;
  runBtn = null;
  exportBtn = null;
}

export function toggleValidationPanel() {
  if (win) closeValidationPanel();
  else openValidationPanel();
}
