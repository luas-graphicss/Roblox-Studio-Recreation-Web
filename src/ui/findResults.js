import { store } from "../core/state.js";
import { bus } from "../core/eventBus.js";
import { logger } from "../core/logger.js";
import { commands } from "../core/commands.js";

const SCRIPT_CLASSES = ["Script", "LocalScript", "ModuleScript"];
const MAX_RESULTS = 2000;                                
const SLICE_MS = 8;                                           
const SEARCH_TIMEOUT_MS = 3000;                                        
const MAX_QUERY_LEN = 500;

const SCOPES = [
  { id: "all", label: "All Scripts" },
  { id: "server", label: "Server Scripts" },
  { id: "local", label: "Local Scripts" },
  { id: "module", label: "Module Scripts" },
  { id: "current", label: "Current Script" },
];

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}


export function buildMatcher(query, { caseSensitive = false, wholeWord = false, regex = false } = {}) {
  let q = String(query == null ? "" : query);
  if (!q) return null;
  if (q.length > MAX_QUERY_LEN) q = q.slice(0, MAX_QUERY_LEN);
  let pattern = regex ? q : q.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  if (wholeWord) pattern = `\\b(?:${pattern})\\b`;
  return new RegExp(pattern, caseSensitive ? "g" : "gi");
}


export function findInSource(source, matcher, deadline) {
  const out = [];
  if (!matcher || typeof source !== "string" || !source) return out;
  const lines = source.split("\n");
  for (let i = 0; i < lines.length; i++) {
    if (deadline && Date.now() > deadline) return out;
    const lineText = lines[i];
    matcher.lastIndex = 0;
    let m;
    while ((m = matcher.exec(lineText)) !== null) {
      out.push({ line: i + 1, col: m.index + 1, text: lineText });

      if (m.index === matcher.lastIndex) matcher.lastIndex++;
      if (out.length >= MAX_RESULTS) return out;
    }
  }
  return out;
}


function collectScripts(scope, currentScript) {
  if (scope === "current") return currentScript ? [currentScript] : [];
  const dm = typeof store.getDataModel === "function" ? store.getDataModel() : null;
  if (!dm) return [];
  let all = [];
  try {
    if (typeof dm.getDescendants === "function") all = dm.getDescendants();
    else if (typeof dm.getChildren === "function") {
      const walk = (inst) => {
        for (const c of inst.getChildren()) { all.push(c); walk(c); }
      };
      walk(dm);
    }
  } catch (err) {
    logger.warn("Find All: falha ao listar descendentes: " + ((err && err.message) || err));
    return [];
  }
  return all.filter((inst) => {
    const cn = inst && inst.className;
    if (!SCRIPT_CLASSES.includes(cn)) return false;
    if (scope === "server") return cn === "Script";
    if (scope === "local") return cn === "LocalScript";
    if (scope === "module") return cn === "ModuleScript";
    return true;       
  });
}

function readSource(inst) {
  try {
    const v = inst.getProperty("Source");
    return typeof v === "string" ? v : "";
  } catch (_) {
    return "";
  }
}

export function buildFindResults(refs) {
  const body = refs && refs.body ? refs.body : null;
  if (!body) return { destroy() {} };
  body.classList.add("rsw-find");


  let results = [];                                   
  let searching = false;
  let searchToken = 0;                                                 
  let currentScript = null;                                                   
  let lastMatcherOpts = null;                                           

  const offOpen = bus.on("editor:openScript", (payload) => {
    const inst = payload && (payload.instance || payload);
    if (inst && SCRIPT_CLASSES.includes(inst.className)) currentScript = inst;
  });


  const bar = el("div", "rsw-find__bar");
  const queryInput = el("input", "rsw-find__input");
  queryInput.type = "text";
  queryInput.placeholder = "Buscar em scripts\u2026";
  queryInput.maxLength = MAX_QUERY_LEN;
  queryInput.setAttribute("aria-label", "Texto de busca");

  const replaceInput = el("input", "rsw-find__input rsw-find__input--replace");
  replaceInput.type = "text";
  replaceInput.placeholder = "Substituir por\u2026";
  replaceInput.maxLength = MAX_QUERY_LEN;
  replaceInput.setAttribute("aria-label", "Texto de substitui\u00e7\u00e3o");

  const scopeSel = el("select", "rsw-find__scope");
  for (const s of SCOPES) {
    const o = el("option", null, s.label);
    o.value = s.id;
    scopeSel.appendChild(o);
  }
  scopeSel.setAttribute("aria-label", "Escopo da busca");

  function makeCheck(label, title) {
    const wrap = el("label", "rsw-find__check");
    const c = el("input");
    c.type = "checkbox";
    wrap.appendChild(c);
    wrap.appendChild(el("span", null, label));
    wrap.title = title;
    return { wrap, input: c };
  }
  const caseChk = makeCheck("Aa", "Case Sensitive");
  const wordChk = makeCheck("\u201cW\u201d", "Whole Word");
  const regexChk = makeCheck(".*", "Regular Expression");

  function makeBtn(label, cls) {
    const b = el("button", "rsw-find__btn" + (cls ? " " + cls : ""), label);
    b.type = "button";
    return b;
  }
  const findBtn = makeBtn("Find All", "rsw-find__btn--primary");
  const replaceBtn = makeBtn("Replace All");
  const clearBtn = makeBtn("Clear Results");

  bar.append(queryInput, caseChk.wrap, wordChk.wrap, regexChk.wrap, scopeSel, findBtn, replaceInput, replaceBtn, clearBtn);


  const status = el("div", "rsw-find__status");
  const list = el("div", "rsw-find__list");
  list.setAttribute("role", "list");
  body.append(bar, status, list);


  const counter = el("span", "rsw-find__counter");
  if (refs.header) {
    const title = refs.header.querySelector(".rsw-dock__title");
    if (title) title.appendChild(counter);
    else refs.header.insertBefore(counter, refs.header.firstChild);
  }

  function setStatus(text) { status.textContent = text || ""; }
  function setCounter(n) { counter.textContent = n > 0 ? ` (${n})` : ""; }

  function clearResults() {
    searchToken++;
    searching = false;
    results = [];
    list.textContent = "";
    setCounter(0);
    setStatus("");
  }

  function renderResults(partial) {
    list.textContent = "";
    const frag = document.createDocumentFragment();
    for (const r of results) {
      const row = el("div", "rsw-find__row");
      row.setAttribute("role", "listitem");
      row.tabIndex = 0;
      const loc = el("span", "rsw-find__loc", `${r.name}:${r.line}:${r.col}`);
      const ctx = el("span", "rsw-find__ctx", r.text.length > 240 ? r.text.slice(0, 240) + "\u2026" : r.text);
      row.append(loc, ctx);
      const open = () => {

        bus.emit("debugger:focusLine", { instance: r.inst, line: r.line });
      };
      row.addEventListener("click", open);
      row.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); open(); } });
      frag.appendChild(row);
    }
    list.appendChild(frag);
    setCounter(results.length);
    if (!partial) {
      setStatus(results.length
        ? `${results.length} resultado(s)${results.length >= MAX_RESULTS ? " (limite atingido)" : ""}`
        : "Nenhum resultado.");
    }
  }


  function startSearch() {
    const query = queryInput.value;
    if (!query) { setStatus("Digite um texto para buscar."); return; }
    const opts = {
      caseSensitive: caseChk.input.checked,
      wholeWord: wordChk.input.checked,
      regex: regexChk.input.checked,
    };
    let matcher;
    try {
      matcher = buildMatcher(query, opts);
    } catch (err) {
      setStatus("Express\u00e3o regular inv\u00e1lida: " + ((err && err.message) || err));
      return;
    }
    if (!matcher) return;
    lastMatcherOpts = { query, ...opts };

    const scope = scopeSel.value;
    const scripts = collectScripts(scope, currentScript);
    if (scope === "current" && !scripts.length) {
      setStatus("Nenhum script aberto no editor.");
      return;
    }

    searchToken++;
    const token = searchToken;
    searching = true;
    results = [];
    list.textContent = "";
    setCounter(0);
    setStatus(`Buscando em ${scripts.length} script(s)\u2026`);
    const deadline = Date.now() + SEARCH_TIMEOUT_MS;
    let idx = 0;
    let timedOut = false;

    function slice() {
      if (token !== searchToken) return;                               
      const sliceEnd = Date.now() + SLICE_MS;
      while (idx < scripts.length && Date.now() < sliceEnd) {
        if (Date.now() > deadline) { timedOut = true; break; }
        const inst = scripts[idx++];
        const hits = findInSource(readSource(inst), matcher, deadline);
        for (const h of hits) {
          results.push({ inst, name: inst.name, line: h.line, col: h.col, text: h.text });
          if (results.length >= MAX_RESULTS) break;
        }
        if (results.length >= MAX_RESULTS) break;
      }
      if (Date.now() > deadline) timedOut = true;
      if (idx >= scripts.length || results.length >= MAX_RESULTS || timedOut) {
        searching = false;
        renderResults(false);
        if (timedOut) setStatus(`Busca interrompida por timeout (${SEARCH_TIMEOUT_MS / 1000}s) \u2014 ${results.length} resultado(s) parciais.`);
        return;
      }
      setStatus(`Buscando\u2026 ${idx}/${scripts.length} script(s), ${results.length} resultado(s).`);
      setTimeout(slice, 0);                                          
    }
    setTimeout(slice, 0);
  }


  function replaceAll() {
    if (searching) { setStatus("Aguarde a busca terminar."); return; }
    if (!results.length || !lastMatcherOpts) { setStatus("Execute uma busca antes de substituir."); return; }
    let matcher;
    try { matcher = buildMatcher(lastMatcherOpts.query, lastMatcherOpts); }
    catch (_) { setStatus("Express\u00e3o inv\u00e1lida."); return; }
    if (!matcher) return;


    const raw = replaceInput.value;
    const replacement = lastMatcherOpts.regex ? raw : raw.replace(/\$/g, "$$$$");


    const seen = new Set();
    const edits = [];
    const deadline = Date.now() + SEARCH_TIMEOUT_MS;
    let replacedCount = 0;
    for (const r of results) {
      if (Date.now() > deadline) { setStatus("Replace All interrompido por timeout."); return; }
      if (!r.inst || seen.has(r.inst)) continue;
      seen.add(r.inst);
      const before = readSource(r.inst);
      matcher.lastIndex = 0;
      const matches = before.match(matcher);
      if (!matches || !matches.length) continue;
      const after = before.replace(matcher, replacement);
      if (after === before) continue;
      replacedCount += matches.length;
      edits.push({ inst: r.inst, before, after });
    }
    if (!edits.length) { setStatus("Nada para substituir (fontes podem ter mudado)."); return; }

    const ok = commands.execute({
      name: `Replace All (${edits.length} script(s))`,
      do() { for (const e of edits) e.inst.setProperty("Source", e.after); },
      undo() { for (const e of edits) e.inst.setProperty("Source", e.before); },
    });
    if (ok) {
      setStatus(`${replacedCount} ocorr\u00eancia(s) substitu\u00edda(s) em ${edits.length} script(s). (Ctrl+Z desfaz)`);
      logger.info(`Find All: Replace All aplicado em ${edits.length} script(s).`);
      clearList();
    } else {
      setStatus("Falha ao aplicar a substitui\u00e7\u00e3o.");
    }
  }

  function clearList() {
    results = [];
    list.textContent = "";
    setCounter(0);
  }

  findBtn.addEventListener("click", startSearch);
  queryInput.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); startSearch(); } });
  replaceBtn.addEventListener("click", replaceAll);
  clearBtn.addEventListener("click", clearResults);


  const offFocus = bus.on("find:focus", () => {
    try { queryInput.focus(); queryInput.select(); } catch (_) {            }
  });

  logger.info("Painel Find Results montado.");

  function destroy() {
    if (typeof offOpen === "function") offOpen();
    if (typeof offFocus === "function") offFocus();
  }
  return { destroy };
}
