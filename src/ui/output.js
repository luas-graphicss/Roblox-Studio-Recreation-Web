import { bus } from "../core/eventBus.js";
import { logger } from "../core/logger.js";
import { createIcon } from "./icons.js";
import { openContextMenu, closeContextMenu } from "./contextMenu.js";

import {
  getNetworkSettings,
  setNetworkSetting,
  LATENCY_OPTIONS,
  PACKET_LOSS_OPTIONS,
} from "../runtime/network.js";

const SEARCH_DEBOUNCE = 300;      
const MAX_LOGS_LIMIT = 50000;
const MAX_LOGS_DEFAULT = 5000;
const BOTTOM_EPS = 24;                                         

const LEVEL_LABEL = { debug: "Debug", info: "Info", warn: "Warning", error: "Error" };

function el(tag, cls) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}

function pad2(n) {
  return n < 10 ? `0${n}` : String(n);
}

function formatTime(ts) {
  const d = new Date(ts);
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`;
}


function copyText(text) {
  try {
    if (navigator && navigator.clipboard && typeof navigator.clipboard.writeText === "function") {
      navigator.clipboard.writeText(text).catch(() => {});
      return;
    }
  } catch (_) {

  }
  try {
    const ta = document.createElement("textarea");
    ta.value = text;
    ta.setAttribute("readonly", "");
    ta.style.position = "absolute";
    ta.style.left = "-9999px";
    document.body.appendChild(ta);
    ta.select();
    if (typeof document.execCommand === "function") document.execCommand("copy");
    document.body.removeChild(ta);
  } catch (_) {

  }
}

export function buildOutput(dockRefs) {
  if (!dockRefs || !dockRefs.body || !dockRefs.header) {
    throw new Error("Output: referências do dock ausentes.");
  }
  const { header, body, close } = dockRefs;


  const opts = {
    showTimestamps: true,
    showSource: true,
    autoscroll: true,
    showDebug: false,
    wordWrap: true,
    maxLogs: MAX_LOGS_DEFAULT,
    fontSize: 12,
    clearOnStop: false,                                                       
  };
  let filterLevel = "all";                             
  let contextFilter = "all";                                                
  let searchText = "";
  let paused = false;
  let stickToBottom = true;                                   

  const items = [];                                                         
  const pending = [];                                     


  let visibleRowCount = 0;
  let rafId = 0;
  let flushScheduled = false;
  let scrollRaf = 0;
  let scrollScheduled = false;
  let searchTimer = 0;


  const tools = el("div", "rsw-output__tools");

  const clearBtn = toolButton("trash", "Clear", "Limpar todos os logs");
  const filterBtn = toolButton("filter", "Filter", "Filtrar por nível");
  const searchWrap = el("div", "rsw-output__search");
  searchWrap.appendChild(createIcon("find", 12));
  const searchInput = el("input", "rsw-output__searchinput");
  searchInput.type = "text";
  searchInput.placeholder = "Buscar…";
  searchInput.setAttribute("aria-label", "Buscar nos logs");
  searchWrap.appendChild(searchInput);
  const settingsBtn = toolButton("settings", "Settings", "Configurações do Output");
  const pauseBtn = toolButton("pause", "Pause", "Pausar autoscroll");
  const counter = el("span", "rsw-output__counter");
  counter.hidden = true;

  tools.append(counter, clearBtn, filterBtn, searchWrap, settingsBtn, pauseBtn);

  if (close && close.parentNode === header) header.insertBefore(tools, close);
  else header.appendChild(tools);


  const list = el("div", "rsw-output__list");
  list.setAttribute("role", "log");
  list.setAttribute("aria-live", "polite");
  list.setAttribute("aria-label", "Output logs");
  list.style.fontSize = `${opts.fontSize}px`;
  body.appendChild(list);
  applyDisplayClasses();

  function toolButton(icon, label, title) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "rsw-output__btn";
    b.setAttribute("title", title);
    b.setAttribute("aria-label", title);
    b.dataset.out = label;
    b.appendChild(createIcon(icon, 14));
    return b;
  }


  function matchesFilter(entry) {
    if (entry.level === "debug" && !opts.showDebug) return false;
    if (filterLevel === "all") return true;
    return entry.level === filterLevel;
  }
  function matchesSearch(entry) {
    if (!searchText) return true;
    const hay = `${entry.source || ""} ${entry.message || ""}`.toLowerCase();
    return hay.indexOf(searchText) !== -1;                                
  }

  function matchesContext(entry) {
    if (contextFilter === "all") return true;
    return entry.context === contextFilter;
  }
  function isVisible(entry) {
    return matchesFilter(entry) && matchesContext(entry) && matchesSearch(entry);
  }
  function filtersActive() {
    return filterLevel !== "all" || contextFilter !== "all" || searchText !== "";
  }

  function applyVisibilityTo(item) {
    const vis = isVisible(item.entry);
    item.visible = vis;                                            
    item.row.classList.toggle("rsw-log--hidden", !vis);
    return vis;
  }

  function reapplyAll() {
    let visible = 0;
    for (const it of items) {
      if (applyVisibilityTo(it)) visible += 1;
    }
    visibleRowCount = visible;
    updateCounter(visibleRowCount);
  }

  function updateCounter(visibleCount) {
    if (!filtersActive()) {
      counter.hidden = true;
      counter.textContent = "";
      return;
    }
    counter.hidden = false;
    counter.textContent = `${visibleCount} de ${items.length} logs`;
  }

  function applyDisplayClasses() {
    list.classList.toggle("rsw-output--no-time", !opts.showTimestamps);
    list.classList.toggle("rsw-output--no-source", !opts.showSource);
    list.classList.toggle("rsw-output--nowrap", !opts.wordWrap);
  }


  function buildRow(entry) {
    const row = el("div", `rsw-log rsw-log--${entry.level}`);
    row.dataset.level = entry.level;

    const time = el("span", "rsw-log__time");
    time.textContent = formatTime(entry.time);                           
    const dot = el("span", `rsw-log__dot rsw-log__dot--${entry.level}`);
    dot.setAttribute("title", LEVEL_LABEL[entry.level] || entry.level);
    const src = el("span", "rsw-log__source");
    src.textContent = entry.source ? `[${entry.source}]` : "";

    const ctxCls = entry.context === "Client" ? "client" : entry.context === "Network" ? "network" : "server";
    const ctx = el("span", `rsw-log__ctx rsw-log__ctx--${ctxCls}`);
    ctx.textContent = entry.context ? `[${entry.context}]` : "";
    if (!entry.context) ctx.hidden = true;
    const msg = el("span", "rsw-log__msg");
    msg.textContent = entry.message;                           

    row.append(time, dot, src, ctx, msg);

    let stackEl = null;
    if (entry.level === "error" && entry.stack) {
      row.classList.add("rsw-log--expandable");
      stackEl = el("pre", "rsw-log__stack");
      stackEl.textContent = entry.stack;                          
      stackEl.hidden = true;
      row.appendChild(stackEl);
      row.addEventListener("click", (e) => {

        const sel = typeof window !== "undefined" && window.getSelection ? String(window.getSelection()) : "";
        if (sel) return;
        if (e.target === stackEl) return;
        stackEl.hidden = !stackEl.hidden;
        row.classList.toggle("rsw-log--open", !stackEl.hidden);
      });
    }
    return { entry, row, stackEl };
  }


  function enqueue(entry) {
    pending.push(entry);
    if (!flushScheduled) {
      flushScheduled = true;
      rafId = requestAnimationFrame(flush);
    }
  }


  function flush() {
    flushScheduled = false;
    rafId = 0;
    if (!pending.length) return;
    const frag = document.createDocumentFragment();
    for (let pendingIndex = 0; pendingIndex < pending.length; pendingIndex += 1) {
      const entry = pending[pendingIndex];
      const item = buildRow(entry);
      item.visible = isVisible(entry);
      items.push(item);
      if (!item.visible) item.row.classList.add("rsw-log--hidden");
      else visibleRowCount += 1;
      frag.appendChild(item.row);
    }
    pending.length = 0;
    list.appendChild(frag);
    enforceMaxLogs();                                                    
    updateCounter(visibleRowCount);
    scheduleAutoscroll();
  }


  function enforceMaxLogs() {
    const over = items.length - opts.maxLogs;
    if (over <= 0) return;
    const removedItems = items.splice(0, over);
    for (const item of removedItems) {
      if (item.visible) visibleRowCount -= 1;
      if (item.row.parentNode) item.row.parentNode.removeChild(item.row);
    }
  }


  function scheduleAutoscroll() {
    if (!opts.autoscroll || paused || !stickToBottom) return;
    if (scrollScheduled) return;
    scrollScheduled = true;
    scrollRaf = requestAnimationFrame(() => {
      scrollScheduled = false;
      scrollRaf = 0;
      list.scrollTop = list.scrollHeight;
    });
  }

  list.addEventListener("scroll", () => {
    const atBottom = list.scrollHeight - list.scrollTop - list.clientHeight < BOTTOM_EPS;
    stickToBottom = atBottom;
  });


  function openFilterMenu() {
    const r = filterBtn.getBoundingClientRect();
    const mk = (level, label) => ({
      label,
      icon: filterLevel === level ? "check" : undefined,
      onSelect: () => setFilter(level),
    });

    const mkCtx = (ctx, label) => ({
      label,
      icon: contextFilter === ctx ? "check" : undefined,
      onSelect: () => setContextFilter(ctx),
    });
    openContextMenu({
      x: Math.round(r.left),
      y: Math.round(r.bottom + 2),
      items: [
        mk("all", "All"),
        mk("info", "Info"),
        mk("warn", "Warnings"),
        mk("error", "Errors"),

        mkCtx("all", "All Contexts"),
        mkCtx("Server", "Server"),
        mkCtx("Client", "Client"),
        mkCtx("Network", "Network"),                             
      ],
    });
  }

  function setFilter(level) {
    filterLevel = ["all", "info", "warn", "error"].includes(level) ? level : "all";
    filterBtn.classList.toggle("rsw-output__btn--active", filterLevel !== "all" || contextFilter !== "all");
    reapplyAll();
  }


  function setContextFilter(ctx) {
    contextFilter = ["all", "Server", "Client", "Network"].includes(ctx) ? ctx : "all";
    filterBtn.classList.toggle("rsw-output__btn--active", filterLevel !== "all" || contextFilter !== "all");
    reapplyAll();
  }


  searchInput.addEventListener("input", () => {
    if (searchTimer) clearTimeout(searchTimer);
    searchTimer = setTimeout(() => {
      searchTimer = 0;
      searchText = searchInput.value.trim().toLowerCase();
      reapplyAll();
    }, SEARCH_DEBOUNCE);
  });


  let settingsPopover = null;
  function closeSettings() {
    if (settingsPopover) {
      settingsPopover.dispose();
      settingsPopover = null;
    }
  }
  function openSettings() {
    closeSettings();
    const pop = el("div", "rsw-output__settings");

    const addToggle = (label, key) => {
      const rowEl = el("label", "rsw-output__setrow");
      const cb = el("input");
      cb.type = "checkbox";
      cb.checked = !!opts[key];
      cb.addEventListener("change", () => {
        opts[key] = cb.checked;
        applyDisplayClasses();
        if (key === "showDebug") reapplyAll();
        if (key === "autoscroll") scheduleAutoscroll();
      });
      const t = el("span");
      t.textContent = label;
      rowEl.append(cb, t);
      pop.appendChild(rowEl);
    };
    addToggle("Show Timestamps", "showTimestamps");
    addToggle("Show Source", "showSource");
    addToggle("Autoscroll", "autoscroll");
    addToggle("Show Debug", "showDebug");
    addToggle("Word Wrap", "wordWrap");
    addToggle("Clear on Playtest Stop", "clearOnStop");            


    const maxRow = el("label", "rsw-output__setrow");
    const maxLbl = el("span");
    maxLbl.textContent = "Max Logs";
    const maxIn = el("input", "rsw-output__setnum");
    maxIn.type = "number";
    maxIn.min = "1";
    maxIn.max = String(MAX_LOGS_LIMIT);
    maxIn.value = String(opts.maxLogs);
    const commitMax = () => {
      let v = Math.floor(Number(maxIn.value));
      if (!Number.isFinite(v) || v < 1) v = MAX_LOGS_DEFAULT;
      v = Math.min(MAX_LOGS_LIMIT, Math.max(1, v));
      opts.maxLogs = v;
      maxIn.value = String(v);
      enforceMaxLogs();
      reapplyAll();
    };
    maxIn.addEventListener("change", commitMax);
    maxRow.append(maxLbl, maxIn);
    pop.appendChild(maxRow);


    const fsRow = el("label", "rsw-output__setrow");
    const fsLbl = el("span");
    fsLbl.textContent = "Font Size";
    const fsVal = el("span", "rsw-output__setval");
    fsVal.textContent = `${opts.fontSize}px`;
    const fsIn = el("input", "rsw-output__setrange");
    fsIn.type = "range";
    fsIn.min = "10";
    fsIn.max = "20";
    fsIn.step = "1";
    fsIn.value = String(opts.fontSize);
    fsIn.addEventListener("input", () => {
      let v = Math.floor(Number(fsIn.value));
      if (!Number.isFinite(v)) v = 12;
      v = Math.min(20, Math.max(10, v));
      opts.fontSize = v;
      list.style.fontSize = `${v}px`;
      fsVal.textContent = `${v}px`;
    });
    fsRow.append(fsLbl, fsIn, fsVal);
    pop.appendChild(fsRow);


    const netTitle = el("div", "rsw-output__settitle");
    netTitle.textContent = "Network (Playtest)";
    pop.appendChild(netTitle);

    const net = getNetworkSettings();

    const dbgRow = el("label", "rsw-output__setrow");
    const dbgCb = el("input");
    dbgCb.type = "checkbox";
    dbgCb.checked = !!net.debug;
    dbgCb.addEventListener("change", () => setNetworkSetting("debug", dbgCb.checked));
    const dbgLbl = el("span");
    dbgLbl.textContent = "Network Debug";
    dbgRow.append(dbgCb, dbgLbl);
    pop.appendChild(dbgRow);

    const addNetSelect = (label, key, options, current, fmt) => {
      const rowEl = el("label", "rsw-output__setrow");
      const lbl = el("span");
      lbl.textContent = label;
      const sel = el("select", "rsw-output__setsel");
      for (const v of options) {
        const o = el("option");
        o.value = String(v);
        o.textContent = fmt(v);
        if (v === current) o.selected = true;
        sel.appendChild(o);
      }
      sel.addEventListener("change", () => setNetworkSetting(key, Number(sel.value)));
      rowEl.append(lbl, sel);
      pop.appendChild(rowEl);
    };
    addNetSelect("Simulated Latency", "latencyMs", LATENCY_OPTIONS, net.latencyMs, (v) => (v === 0 ? "Off" : `${v}ms`));
    addNetSelect("Simulated Packet Loss", "packetLossPct", PACKET_LOSS_OPTIONS, net.packetLossPct, (v) => `${v}%`);

    document.body.appendChild(pop);
    const r = settingsBtn.getBoundingClientRect();
    const pr = pop.getBoundingClientRect();
    let left = Math.round(r.right - pr.width);
    let top = Math.round(r.bottom + 4);
    if (left < 4) left = 4;
    pop.style.left = `${left}px`;
    pop.style.top = `${top}px`;

    const onDocDown = (e) => {
      if (pop.contains(e.target) || settingsBtn.contains(e.target)) return;
      closeSettings();
    };
    const onKey = (e) => {
      if (e.key === "Escape") closeSettings();
    };
    setTimeout(() => document.addEventListener("pointerdown", onDocDown, true), 0);
    document.addEventListener("keydown", onKey, true);
    settingsPopover = {
      dispose() {
        document.removeEventListener("pointerdown", onDocDown, true);
        document.removeEventListener("keydown", onKey, true);
        if (pop.parentNode) pop.parentNode.removeChild(pop);
      },
    };
  }


  function togglePause() {
    paused = !paused;
    pauseBtn.classList.toggle("rsw-output__btn--active", paused);
    pauseBtn.setAttribute("aria-pressed", paused ? "true" : "false");
    if (!paused) {
      stickToBottom = true;
      scheduleAutoscroll();
    }
  }


  function allText() {
    return items
      .map((it) => {
        const e = it.entry;
        const parts = [];
        if (opts.showTimestamps) parts.push(formatTime(e.time));
        if (opts.showSource && e.source) parts.push(`[${e.source}]`);
        parts.push(e.message);
        return parts.join(" ");
      })
      .join("\n");
  }

  list.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    const sel = typeof window !== "undefined" && window.getSelection ? String(window.getSelection()) : "";
    const menuItems = [
      { label: "Copy Selected", disabled: !sel, onSelect: () => copyText(sel) },
      { label: "Copy All", onSelect: () => copyText(allText()) },
      { type: "separator" },
      { label: "Clear Output", icon: "trash", onSelect: () => logger.clear() },
    ];

    const rowEl = e.target && typeof e.target.closest === "function" ? e.target.closest(".rsw-log") : null;
    if (rowEl && rowEl.dataset.level === "error") {
      const msgEl = rowEl.querySelector(".rsw-log__msg");
      const errText = String((msgEl ? msgEl.textContent : rowEl.textContent) || "").slice(0, 1500).trim();
      if (errText) {
        menuItems.push({ type: "separator" });
        menuItems.push({
          label: "Ask Assistant about this error",
          onSelect: () => bus.emit("assistant:open", { prompt: "I got this error in the Output of my Roblox Studio project. Explain the cause and how to fix it:\n" + errText, send: true }),
        });
      }
    }
    openContextMenu({ x: e.clientX, y: e.clientY, items: menuItems });
  });


  clearBtn.addEventListener("click", () => logger.clear());
  filterBtn.addEventListener("click", openFilterMenu);
  settingsBtn.addEventListener("click", () => {
    if (settingsPopover) closeSettings();
    else openSettings();
  });
  pauseBtn.addEventListener("click", togglePause);


  const offAdded = bus.on("log:added", (entry) => {
    if (entry) enqueue(entry);
  });
  const offCleared = bus.on("log:cleared", () => {
    pending.length = 0;
    items.length = 0;
    visibleRowCount = 0;
    list.replaceChildren();
    updateCounter(0);
  });
  const offFilter = bus.on("output:setFilter", (p) => {
    if (p && typeof p.level === "string") setFilter(p.level);
  });

  let inPlaytest = false;
  const offMode = bus.on("runtime:modeChanged", (p) => {
    const running = !!(p && p.running);
    if (inPlaytest && !running && opts.clearOnStop) logger.clear();
    inPlaytest = running;
  });


  for (const entry of logger.getEntries()) enqueue(entry);

  function destroy() {
    if (typeof offAdded === "function") offAdded();
    if (typeof offCleared === "function") offCleared();
    if (typeof offFilter === "function") offFilter();
    if (typeof offMode === "function") offMode();            
    if (rafId) cancelAnimationFrame(rafId);
    if (scrollRaf) cancelAnimationFrame(scrollRaf);
    if (searchTimer) clearTimeout(searchTimer);
    closeSettings();
    closeContextMenu();
    if (tools.parentNode) tools.parentNode.removeChild(tools);
    if (list.parentNode) list.parentNode.removeChild(list);
  }


  return {
    el: list,
    destroy,
    setFilter,
    _debug: { items, opts, getFilter: () => filterLevel, getSearch: () => searchText, isPaused: () => paused, setSearch: (s) => { searchText = String(s).toLowerCase(); reapplyAll(); }, flush },
  };
}
