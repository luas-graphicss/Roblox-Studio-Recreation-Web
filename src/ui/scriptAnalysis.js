import { bus } from "../core/eventBus.js";
import { createIcon } from "./icons.js";
import { attachTooltip } from "./tooltip.js";


import * as luauAnalysis from "../editor/luauAnalysis.js";

const FALLBACK_TYPE_CODES = Object.freeze(["LUA017", "LUA018", "LUA019", "LUA020", "LUA021", "LUA022", "LUA023", "LUA024", "LUA025"]);
function normalizeTypeCodes(raw) {
  try {
    if (raw && typeof raw.has === "function") return raw;
    if (Array.isArray(raw)) return new Set(raw);
  } catch (_) {                 }
  return new Set(FALLBACK_TYPE_CODES);
}
const TYPE_DIAGNOSTIC_CODES = normalizeTypeCodes(luauAnalysis.TYPE_DIAGNOSTIC_CODES);

const ROW_HEIGHT = 24;
const OVERSCAN = 6;
const SEARCH_DEBOUNCE = 200;

const FILTERS = [
  { id: "all", label: "All" },
  { id: "error", label: "Errors" },
  { id: "warning", label: "Warnings" },
  { id: "info", label: "Info" },
  { id: "types", label: "Types" },                               
];

function el(tag, cls) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

function severityRank(sev) {
  if (sev === "error") return 0;
  if (sev === "warning") return 1;
  return 2;
}

export function buildScriptAnalysis(dockRefs) {
  if (!dockRefs || !dockRefs.body || !dockRefs.header) {
    throw new Error("buildScriptAnalysis: dockRefs inválido");
  }
  const { header, body, close } = dockRefs;


  const scripts = new Map();
  let filter = "all";
  let searchText = "";
  let flat = [];
  let searchTimer = 0;
  let rafPending = false;


  const tools = el("div", "rsw-sa__tools");
  const counter = el("span", "rsw-sa__counter");
  counter.textContent = "0 erros · 0 avisos";
  const reBtn = el("button", "rsw-sa__btn");
  reBtn.type = "button";
  reBtn.appendChild(createIcon("run", 12));
  const reLabel = el("span");
  reLabel.textContent = "Re-analyze";
  reBtn.appendChild(reLabel);
  attachTooltip(reBtn, { title: "Re-analyze", desc: "Reanalisa todos os scripts abertos." });
  reBtn.addEventListener("click", () => {
    bus.emit("scriptAnalysis:reanalyzeAll", {});
  });
  tools.appendChild(counter);
  tools.appendChild(reBtn);
  if (close && close.parentNode === header) header.insertBefore(tools, close);
  else header.appendChild(tools);


  const root = el("div", "rsw-sa");
  const barEl = el("div", "rsw-sa__bar");
  const filterBtns = new Map();
  for (const f of FILTERS) {
    const b = el("button", "rsw-sa__filter" + (f.id === filter ? " is-active" : ""));
    b.type = "button";
    b.textContent = f.label;
    b.addEventListener("click", () => {
      filter = f.id;
      for (const [id, btn] of filterBtns) btn.classList.toggle("is-active", id === filter);
      rebuild();
    });
    filterBtns.set(f.id, b);
    barEl.appendChild(b);
  }
  const search = el("div", "rsw-sa__search");
  search.appendChild(createIcon("find", 12));
  const searchInput = el("input", "rsw-sa__searchinput");
  searchInput.type = "text";
  searchInput.placeholder = "Filtrar...";
  searchInput.addEventListener("input", () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchTimer = 0;
      searchText = searchInput.value.trim().toLowerCase();
      rebuild();
    }, SEARCH_DEBOUNCE);
  });
  search.appendChild(searchInput);
  barEl.appendChild(search);
  root.appendChild(barEl);


  const viewport = el("div", "rsw-sa__viewport");
  const spacerTop = el("div");
  const rowsHost = el("div", "rsw-sa__rows");
  const spacerBottom = el("div");
  const empty = el("div", "rsw-sa__empty");
  empty.textContent = "Nenhum problema encontrado.";
  viewport.appendChild(spacerTop);
  viewport.appendChild(rowsHost);
  viewport.appendChild(spacerBottom);
  viewport.appendChild(empty);
  viewport.addEventListener("scroll", () => {
    if (rafPending) return;
    rafPending = true;
    requestAnimationFrame(() => {
      rafPending = false;
      renderWindow();
    });
  });
  root.appendChild(viewport);
  body.appendChild(root);

  function makeRow(item) {
    const row = el("div", "rsw-sa__row");
    row.appendChild(el("span", "rsw-sa__dot rsw-sa__dot--" + item.severity));
    const code = el("span", "rsw-sa__code");
    code.textContent = item.code || "";
    row.appendChild(code);
    const scriptName = el("span", "rsw-sa__script");
    scriptName.textContent = item.scriptName;
    row.appendChild(scriptName);
    if (item.mode) {

      const modeEl = el("span", "rsw-sa__modechip");
      modeEl.textContent = item.mode;
      row.appendChild(modeEl);
    }
    const lineEl = el("span", "rsw-sa__line");
    lineEl.textContent = "linha " + item.line;
    row.appendChild(lineEl);
    const msg = el("span", "rsw-sa__msg");
    msg.textContent = item.message;
    msg.title = item.message;
    row.appendChild(msg);
    if (item.severity === "error") {            
      const fixBtn = el("button", "rsw-sa__fix");
      fixBtn.type = "button";
      fixBtn.textContent = "Fix with Assistant";
      fixBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        const prompt = [
          "Fix this Luau error found by Script Analysis.",
          "Script: " + item.scriptName,
          "Line " + item.line + (item.code ? " (" + item.code + ")" : "") + ": " + item.message,
          "Reply with the corrected code snippet.",
        ].join("\n");
        bus.emit("assistant:open", { prompt, send: true });
      });
      row.appendChild(fixBtn);
    }
    row.addEventListener("click", () => {
      bus.emit("editor:revealIssue", {
        instanceId: item.instanceId,
        line: item.line,
        column: item.column,
      });
    });
    return row;
  }

  function renderWindow() {
    const total = flat.length;
    const height = viewport.clientHeight || 0;
    let first = Math.floor(viewport.scrollTop / ROW_HEIGHT) - OVERSCAN;
    if (first < 0) first = 0;
    let count = Math.ceil(height / ROW_HEIGHT) + OVERSCAN * 2;
    if (first + count > total) count = total - first;
    if (count < 0) count = 0;
    spacerTop.style.height = first * ROW_HEIGHT + "px";
    spacerBottom.style.height = (total - first - count) * ROW_HEIGHT + "px";
    rowsHost.textContent = "";
    const frag = document.createDocumentFragment();
    for (let i = first; i < first + count; i++) frag.appendChild(makeRow(flat[i]));
    rowsHost.appendChild(frag);
  }

  function rebuild() {
    flat = [];
    let errors = 0;
    let warnings = 0;
    for (const [instanceId, rec] of scripts) {
      for (const issue of rec.issues) {
        if (issue.severity === "error") errors++;
        else if (issue.severity === "warning") warnings++;

        if (filter === "types") {
          if (!TYPE_DIAGNOSTIC_CODES.has(String(issue.code || ""))) continue;
        } else if (filter !== "all" && issue.severity !== filter) continue;
        if (searchText) {
          const hay = (issue.message + " " + (issue.code || "") + " " + rec.name).toLowerCase();
          if (!hay.includes(searchText)) continue;
        }
        flat.push({
          instanceId,
          scriptName: rec.name,
          severity: issue.severity,
          code: issue.code,
          message: issue.message,
          line: issue.line,
          column: issue.column,
          mode: rec.mode || null,                                    
        });
      }
    }
    flat.sort((a, b) =>
      severityRank(a.severity) - severityRank(b.severity) ||
      a.scriptName.localeCompare(b.scriptName) ||
      a.line - b.line);

    let typesCount = 0;
    const modesSeen = new Set();
    for (const [, recS] of scripts) {
      if (recS && typeof recS.mode === "string" && recS.mode) modesSeen.add(recS.mode);
      for (const isu of (recS && recS.issues) || []) {
        if (TYPE_DIAGNOSTIC_CODES.has(String(isu.code || ""))) typesCount++;
      }
    }
    counter.textContent = errors + " erros · " + warnings + " avisos" +
      (typesCount > 0 ? " · " + typesCount + " de tipo" : "") +
      (modesSeen.size === 1 ? " · modo " + Array.from(modesSeen)[0] : "");
    empty.style.display = flat.length ? "none" : "";
    renderWindow();
  }

  const offUpdated = bus.on("scriptAnalysis:updated", (p) => {
    if (!p || !p.instanceId) return;
    scripts.set(p.instanceId, {
      name: p.name || "Script",
      className: p.className || "Script",
      issues: Array.isArray(p.issues) ? p.issues : [],
      mode: typeof p.mode === "string" && p.mode ? p.mode : null,             
    });
    rebuild();
  });
  const offRemoved = bus.on("scriptAnalysis:removed", (p) => {
    if (!p || !p.instanceId) return;
    if (scripts.delete(p.instanceId)) rebuild();
  });

  rebuild();

  return {
    refresh: rebuild,
    destroy() {
      offUpdated();
      offRemoved();
      if (searchTimer) clearTimeout(searchTimer);
      if (tools.parentNode) tools.parentNode.removeChild(tools);
      if (root.parentNode) root.parentNode.removeChild(root);
      scripts.clear();
    },
  };
}
