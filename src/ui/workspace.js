import { store } from "../core/state.js";
import { logger } from "../core/logger.js";
import { createIcon } from "./icons.js";

const MIN_PANEL = 100;                         
const SPLITTER = 6;                               
const STATE_THROTTLE_MS = 90;                                                  

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

function clamp(v, min, max) {
  return Math.min(max, Math.max(min, v));
}

function makeDock(name, title) {
  const dock = el("div", `rsw-dock rsw-dock--${name}`);
  dock.dataset.panel = name;

  const header = el("div", "rsw-dock__header");
  const titleEl = el("span", "rsw-dock__title");
  titleEl.textContent = title;                                      
  const close = document.createElement("button");
  close.type = "button";
  close.className = "rsw-dock__close";
  close.dataset.close = name;
  close.setAttribute("title", `Fechar ${title}`);
  close.setAttribute("aria-label", `Fechar ${title}`);
  close.appendChild(createIcon("close", 12));
  header.append(titleEl, close);

  const body = el("div", "rsw-dock__body");
  dock.append(header, body);
  return { dock, header, body, close };
}

function makeSplitter(kind, orientation) {
  const s = el("div", `rsw-splitter rsw-splitter--${orientation}`);
  s.dataset.splitter = kind;
  s.setAttribute("role", "separator");
  s.setAttribute("aria-orientation", orientation === "col" ? "vertical" : "horizontal");
  return s;
}

export function buildWorkspace(region) {
  if (!region) throw new Error("Workspace: região ausente.");

  const ws = el("div", "rsw-workspace");


  const main = el("div", "rsw-work-main");


  const center = el("div", "rsw-center");
  const viewSwitch = el("div", "rsw-viewswitch");
  const centerBody = el("div", "rsw-center__body");
  const viewport = el("div", "rsw-viewport rsw-center__pane");
  const vpNote = el("div", "rsw-viewport__note");
  vpNote.textContent = "Viewport 3D";
  viewport.appendChild(vpNote);
  centerBody.appendChild(viewport);
  center.append(viewSwitch, centerBody);

  const colSplitter = makeSplitter("right-width", "col");

  const rightPanel = el("div", "rsw-rightpanel");
  const explorer = makeDock("explorer", "Explorer");
  const innerSplitter = makeSplitter("explorer-height", "row");
  const properties = makeDock("properties", "Properties");
  rightPanel.append(explorer.dock, innerSplitter, properties.dock);


  const assistantSplitter = makeSplitter("assistant-width", "col");
  const assistant = makeDock("assistant", "Assistant");


  const apiBrowserSplitter = makeSplitter("apibrowser-width", "col");
  const apiBrowser = makeDock("apiBrowser", "API Reference");

  main.append(center, colSplitter, rightPanel, assistantSplitter, assistant.dock, apiBrowserSplitter, apiBrowser.dock);


  const outputSplitter = makeSplitter("output-height", "row");
  const output = makeDock("output", "Output");


  const analysisSplitter = makeSplitter("analysis-height", "row");
  const analysis = makeDock("analysis", "Script Analysis");


  const debuggerSplitter = makeSplitter("debugger-height", "row");
  const debuggerDock = makeDock("debugger", "Debugger");


  const findSplitter = makeSplitter("find-height", "row");
  const find = makeDock("find", "Find Results");

  ws.append(main, findSplitter, find.dock, debuggerSplitter, debuggerDock.dock, analysisSplitter, analysis.dock, outputSplitter, output.dock);
  region.appendChild(ws);


  function applyLayout() {
    const L = store.getState().layout;
    const P = L.panels;
    const rightVisible = P.explorer || P.properties;

    rightPanel.toggleAttribute("hidden", !rightVisible);
    colSplitter.toggleAttribute("hidden", !rightVisible);
    explorer.dock.toggleAttribute("hidden", !P.explorer);
    properties.dock.toggleAttribute("hidden", !P.properties);
    innerSplitter.toggleAttribute("hidden", !(P.explorer && P.properties));
    output.dock.toggleAttribute("hidden", !P.output);
    outputSplitter.toggleAttribute("hidden", !P.output);
    analysis.dock.toggleAttribute("hidden", !P.analysis);            
    analysisSplitter.toggleAttribute("hidden", !P.analysis);
    debuggerDock.dock.toggleAttribute("hidden", !P.debugger);            
    debuggerSplitter.toggleAttribute("hidden", !P.debugger);
    find.dock.toggleAttribute("hidden", !P.find);            
    findSplitter.toggleAttribute("hidden", !P.find);
    assistant.dock.toggleAttribute("hidden", !P.assistant);            
    assistantSplitter.toggleAttribute("hidden", !P.assistant);
    apiBrowser.dock.toggleAttribute("hidden", !P.apiBrowser);            
    apiBrowserSplitter.toggleAttribute("hidden", !P.apiBrowser);


    const mainW = main.getBoundingClientRect().width;
    const wsH = ws.getBoundingClientRect().height;
    const needsExplorerHeight = P.explorer && P.properties;
    const rightPanelHeight = needsExplorerHeight
      ? rightPanel.getBoundingClientRect().height
      : 0;

    if (rightVisible) {
      let w = L.rightWidth;
      if (mainW > 0) w = clamp(w, MIN_PANEL, Math.max(MIN_PANEL, mainW - MIN_PANEL - SPLITTER));
      rightPanel.style.flex = `0 0 ${w}px`;
    }
    if (P.output) {
      let h = L.outputHeight;
      if (wsH > 0) h = clamp(h, MIN_PANEL, Math.max(MIN_PANEL, wsH - MIN_PANEL - SPLITTER));
      output.dock.style.flex = `0 0 ${h}px`;
    }
    if (P.analysis) {            
      let h = L.analysisHeight;
      if (wsH > 0) h = clamp(h, MIN_PANEL, Math.max(MIN_PANEL, wsH - MIN_PANEL - SPLITTER));
      analysis.dock.style.flex = `0 0 ${h}px`;
    }
    if (P.debugger) {            
      let h = L.debuggerHeight;
      if (wsH > 0) h = clamp(h, MIN_PANEL, Math.max(MIN_PANEL, wsH - MIN_PANEL - SPLITTER));
      debuggerDock.dock.style.flex = `0 0 ${h}px`;
    }
    if (P.find) {            
      let h = L.findHeight;
      if (wsH > 0) h = clamp(h, MIN_PANEL, Math.max(MIN_PANEL, wsH - MIN_PANEL - SPLITTER));
      find.dock.style.flex = `0 0 ${h}px`;
    }
    if (P.assistant) {            
      let w = L.assistantWidth;
      if (mainW > 0) w = clamp(w, MIN_PANEL, Math.max(MIN_PANEL, mainW - MIN_PANEL - SPLITTER));
      assistant.dock.style.flex = `0 0 ${w}px`;
    }
    if (P.apiBrowser) {            
      let w = L.apiBrowserWidth;
      if (mainW > 0) w = clamp(w, MIN_PANEL, Math.max(MIN_PANEL, mainW - MIN_PANEL - SPLITTER));
      apiBrowser.dock.style.flex = `0 0 ${w}px`;
    }
    if (needsExplorerHeight) {
      let h = L.explorerHeight;
      if (rightPanelHeight > 0) {
        h = clamp(h, MIN_PANEL, Math.max(MIN_PANEL, rightPanelHeight - MIN_PANEL - SPLITTER));
      }
      explorer.dock.style.flex = `0 0 ${h}px`;
      properties.dock.style.flex = "1 1 0";
    } else if (P.explorer) {
      explorer.dock.style.flex = "1 1 0";
    } else if (P.properties) {
      properties.dock.style.flex = "1 1 0";
    }
  }


  const SPLITTER_DRAG_TARGETS = Object.freeze({
    "right-width": () => ({ panel: rightPanel, container: main, axis: "width" }),
    "assistant-width": () => ({ panel: assistant.dock, container: main, axis: "width" }),            
    "apibrowser-width": () => ({ panel: apiBrowser.dock, container: main, axis: "width" }),            
    "output-height": () => ({ panel: output.dock, container: ws, axis: "height" }),
    "analysis-height": () => ({ panel: analysis.dock, container: ws, axis: "height" }),            
    "debugger-height": () => ({ panel: debuggerDock.dock, container: ws, axis: "height" }),            
    "find-height": () => ({ panel: find.dock, container: ws, axis: "height" }),            
    "explorer-height": () => ({ panel: explorer.dock, container: rightPanel, axis: "height" }),
  });

  function readSplitterDragMetrics(kind) {
    const resolveTarget = SPLITTER_DRAG_TARGETS[kind] || SPLITTER_DRAG_TARGETS["explorer-height"];
    const { panel, container, axis } = resolveTarget();
    const panelRect = panel.getBoundingClientRect();
    const containerRect = container.getBoundingClientRect();
    const startSize = axis === "width" ? panelRect.width : panelRect.height;
    const availableSize = axis === "width" ? containerRect.width : containerRect.height;

    return { startSize, maxSize: Math.max(MIN_PANEL, availableSize - MIN_PANEL - SPLITTER) };
  }

  function applySize(kind, size) {
    if (kind === "right-width") rightPanel.style.flex = `0 0 ${size}px`;
    else if (kind === "assistant-width") assistant.dock.style.flex = `0 0 ${size}px`;            
    else if (kind === "apibrowser-width") apiBrowser.dock.style.flex = `0 0 ${size}px`;            
    else if (kind === "output-height") output.dock.style.flex = `0 0 ${size}px`;
    else if (kind === "analysis-height") analysis.dock.style.flex = `0 0 ${size}px`;            
    else if (kind === "debugger-height") debuggerDock.dock.style.flex = `0 0 ${size}px`;            
    else if (kind === "find-height") find.dock.style.flex = `0 0 ${size}px`;            
    else explorer.dock.style.flex = `0 0 ${size}px`;
  }

  function commit(kind, size) {
    const rounded = Math.round(size);
    if (kind === "right-width") store.setLayout({ rightWidth: rounded });
    else if (kind === "assistant-width") store.setLayout({ assistantWidth: rounded });            
    else if (kind === "apibrowser-width") store.setLayout({ apiBrowserWidth: rounded });            
    else if (kind === "output-height") store.setLayout({ outputHeight: rounded });
    else if (kind === "analysis-height") store.setLayout({ analysisHeight: rounded });            
    else if (kind === "debugger-height") store.setLayout({ debuggerHeight: rounded });            
    else if (kind === "find-height") store.setLayout({ findHeight: rounded });            
    else store.setLayout({ explorerHeight: rounded });
  }

  function startDrag(e, kind) {
    if (e && typeof e.preventDefault === "function") e.preventDefault();
    const isCol = kind === "right-width" || kind === "assistant-width" || kind === "apibrowser-width";
    const pointerStart = isCol ? e.clientX : e.clientY;
    const { startSize, maxSize: max } = readSplitterDragMetrics(kind);


    const overlay = el("div", "rsw-resize-overlay");
    overlay.style.cursor = isCol ? "col-resize" : "row-resize";
    document.body.appendChild(overlay);

    let latest = startSize;
    let rafId = 0;
    let lastState = 0;

    const onMove = (ev) => {
      const cur = isCol ? ev.clientX : ev.clientY;
      let delta = cur - pointerStart;

      if (kind === "right-width" || kind === "assistant-width" || kind === "apibrowser-width" || kind === "output-height" || kind === "analysis-height" || kind === "debugger-height") delta = -delta;
      latest = clamp(startSize + delta, MIN_PANEL, max);

      if (!rafId) {
        rafId = requestAnimationFrame(() => {
          rafId = 0;
          applySize(kind, latest);
        });
      }
      const now = typeof performance !== "undefined" ? performance.now() : Date.now();
      if (now - lastState > STATE_THROTTLE_MS) {
        lastState = now;
        commit(kind, latest);                                       
      }
    };

    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      window.removeEventListener("pointercancel", onUp);
      if (rafId) cancelAnimationFrame(rafId);
      if (overlay.remove) overlay.remove();
      commit(kind, latest);                                               
    };

    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);


    window.addEventListener("pointercancel", onUp);
  }

  colSplitter.addEventListener("pointerdown", (e) => startDrag(e, "right-width"));
  innerSplitter.addEventListener("pointerdown", (e) => startDrag(e, "explorer-height"));
  outputSplitter.addEventListener("pointerdown", (e) => startDrag(e, "output-height"));
  analysisSplitter.addEventListener("pointerdown", (e) => startDrag(e, "analysis-height"));            
  debuggerSplitter.addEventListener("pointerdown", (e) => startDrag(e, "debugger-height"));            
  findSplitter.addEventListener("pointerdown", (e) => startDrag(e, "find-height"));            
  assistantSplitter.addEventListener("pointerdown", (e) => startDrag(e, "assistant-width"));            
  apiBrowserSplitter.addEventListener("pointerdown", (e) => startDrag(e, "apibrowser-width"));            


  ws.addEventListener("click", (e) => {
    const target = e.target;
    const btn = target && typeof target.closest === "function" ? target.closest("[data-close]") : null;
    if (!btn) return;
    const name = btn.dataset.close;
    store.setLayout({ panels: { [name]: false } });
  });


  store.subscribe((state, change) => {
    if (change && change.key === "layout") applyLayout();
  });


  let resizeRaf = 0;
  window.addEventListener("resize", () => {
    if (resizeRaf) return;
    resizeRaf = requestAnimationFrame(() => {
      resizeRaf = 0;
      applyLayout();
    });
  });

  applyLayout();
  if (typeof requestAnimationFrame === "function") requestAnimationFrame(applyLayout);

  logger.info("Workspace dockável montado.");
  return {
    ws, main, center, viewSwitch, centerBody, viewport, colSplitter, rightPanel,
    explorer, innerSplitter, properties, outputSplitter, output,
    analysisSplitter, analysis,            
    debuggerSplitter, debugger: debuggerDock,            
    findSplitter, find,            
    assistantSplitter, assistant,            
    apiBrowserSplitter, apiBrowser,            
    applyLayout, startDrag,
  };
}
