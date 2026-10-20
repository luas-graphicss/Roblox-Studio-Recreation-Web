import { store } from "../core/state.js";
import { bus } from "../core/eventBus.js";
import { logger } from "../core/logger.js";
import { settings } from "../config/settings.js";
import { theme as themeManager } from "../theme/theme.js";
import { Events } from "../datamodel/index.js";
import { createIcon } from "../ui/icons.js";
import { loadMonaco } from "./monacoLoader.js";
import { registerLuau, LUAU_LANGUAGE_ID } from "./luauLang.js";
import { registerThemes, themeIdFor } from "./monacoThemes.js";
import { TabManager } from "./editorTabs.js";
import { createSourceSync } from "./editorSync.js";
import { attachDebugGutter, debugAttachModel, debugDetachModel } from "./debugGutter.js";            

import {
  registerIntellisense,
  attachModel,
  detachModel,
  analyzeAndMark,
  getAnalysisMode,                                                         
  findLocalDefinition,
  resolveRequireTarget,
} from "./intellisense.js";
import * as drafts from "../collab/drafts.js";
import * as teamCreate from "../collab/teamCreate.js";
import { registerCodeAssist } from "../ai/codeAssist.js";            
import { registerEditorBridge } from "../ai/editorBridge.js";            

const SCRIPT_CLASSES = { Script: 1, LocalScript: 1, ModuleScript: 1 };
const CLASS_ICON = {
  Script: "script",
  LocalScript: "localscript",
  ModuleScript: "modulescript",
};

export function isScriptClass(inst) {
  return !!(inst && inst.className && SCRIPT_CLASSES[inst.className]);
}

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

export function buildScriptEditor(opts) {
  const o = opts || {};
  const body = o.body;
  const switchBar = o.switchBar;
  const viewportEl = o.viewportEl || null;
  if (!body) throw new Error("ScriptEditor: 'body' ausente.");

  const tabs = new TabManager();

  const records = new Map();

  let monaco = null;
  let editor = null;
  let monacoState = "idle";                                  


  const root = el("div", "rsw-scripteditor rsw-center__pane");
  root.setAttribute("hidden", "");

  const tabbar = el("div", "rsw-edtabs");
  const tabList = el("div", "rsw-edtabs__list");
  tabList.setAttribute("role", "tablist");
  const tabActions = el("div", "rsw-edtabs__actions");
  const returnBtn = el("button", "rsw-edtabs__return");
  returnBtn.type = "button";
  returnBtn.setAttribute("title", "Return to Viewport (Alt+F1)");
  returnBtn.append(createIcon("object", 14), document.createTextNode(" Viewport"));
  const lockBadge = el("div", "rsw-collab-lockbadge");
  lockBadge.setAttribute("hidden", "");
  const lockBadgeDot = el("span", "rsw-collab-lockbadge__dot");
  const lockBadgeLabel = el("span", "rsw-collab-lockbadge__label");
  const lockBadgeBtn = el("button", "rsw-collab-lockbadge__btn");
  lockBadgeBtn.type = "button";
  lockBadgeBtn.textContent = "Request Edit";
  lockBadge.append(lockBadgeDot, lockBadgeLabel, lockBadgeBtn);
  tabActions.append(lockBadge, returnBtn);
  tabbar.append(tabList, tabActions);

  const stage = el("div", "rsw-editor-stage");
  const host = el("div", "rsw-editor-host");
  const empty = el("div", "rsw-editor-empty");
  empty.append(createIcon("script", 28));
  const emptyMsg = el("div", "rsw-editor-empty__msg");
  emptyMsg.textContent = "Nenhum script aberto. De um duplo clique em um script no Explorer.";
  empty.appendChild(emptyMsg);
  const errorBox = el("div", "rsw-editor-error");
  errorBox.setAttribute("hidden", "");
  stage.append(host, empty, errorBox);

  root.append(tabbar, stage);
  body.appendChild(root);


  let btnViewport = null;
  let btnEditor = null;
  if (switchBar) {
    btnViewport = el("button", "rsw-viewswitch__btn");
    btnViewport.type = "button";
    btnViewport.dataset.view = "viewport";
    btnViewport.append(createIcon("object", 14), document.createTextNode(" Viewport 3D"));
    btnEditor = el("button", "rsw-viewswitch__btn");
    btnEditor.type = "button";
    btnEditor.dataset.view = "editor";
    btnEditor.append(createIcon("script", 14), document.createTextNode(" Script Editor"));
    switchBar.append(btnViewport, btnEditor);
    switchBar.addEventListener("click", (e) => {
      const b = e.target && e.target.closest ? e.target.closest("[data-view]") : null;
      if (!b) return;
      setCentralView(b.dataset.view);
    });
  }


  function getCentralView() {
    return store.get("centralView") === "editor" ? "editor" : "viewport";
  }

  function setCentralView(view) {
    const next = view === "editor" ? "editor" : "viewport";
    if (getCentralView() === next) {
      applyCentralView(next);
      return;
    }
    store.set("centralView", next);
  }

  function applyCentralView(view) {
    const editorActive = view === "editor";
    root.toggleAttribute("hidden", !editorActive);
    if (viewportEl) viewportEl.toggleAttribute("hidden", editorActive);
    if (btnViewport) btnViewport.classList.toggle("rsw-viewswitch__btn--active", !editorActive);
    if (btnEditor) btnEditor.classList.toggle("rsw-viewswitch__btn--active", editorActive);
    if (editorActive && editor && typeof editor.layout === "function") {

      try { editor.layout(); } catch (_) {            }
      if (typeof editor.focus === "function") {
        try { editor.focus(); } catch (_) {            }
      }
    }
  }


  function ensureMonaco() {
    if (monacoState === "ready") return Promise.resolve(monaco);
    if (monacoState === "loading" && _loadPromise) return _loadPromise;
    monacoState = "loading";
    showError(null);
    _loadPromise = loadMonaco()
      .then((m) => {
        monaco = m;
        registerLuau(monaco);
        registerThemes(monaco);
        registerIntellisense(monaco);                                       
        registerCodeAssist(monaco, LUAU_LANGUAGE_ID, activeScriptMeta);                                       
        createEditor();
        monacoState = "ready";
        return monaco;
      })
      .catch((err) => {
        monacoState = "error";
        _loadPromise = null;
        logger.error("Falha ao carregar o editor de scripts.", { source: "Editor", stack: err && err.stack });
        showError("Nao foi possivel carregar o editor de scripts (Monaco). Verifique a conexao e tente reabrir o script.");
        throw err;
      });
    return _loadPromise;
  }
  let _loadPromise = null;

  function effectiveEditorTheme() {
    const t = settings.all().editorTheme;
    return t === "dark" || t === "light" ? t : themeManager.get();
  }

  function editorOptions() {
    const s = settings.all();
    return {
      automaticLayout: true,
      language: LUAU_LANGUAGE_ID,
      theme: themeIdFor(effectiveEditorTheme()),
      fontFamily: "'JetBrains Mono', 'Consolas', 'Courier New', monospace",
      fontSize: typeof s.editorFontSize === "number" ? s.editorFontSize : 14,
      tabSize: typeof s.editorTabSize === "number" ? s.editorTabSize : 2,
      wordWrap: s.editorWordWrap === false ? "off" : "on",
      lineNumbers: s.editorLineNumbers !== false ? "on" : "off",
      minimap: { enabled: s.editorMinimap !== false },
      autoIndent: "full",
      formatOnPaste: true,
      bracketPairColorization: { enabled: true },
      renderWhitespace: "none",
      smoothScrolling: true,
      cursorBlinking: "smooth",
      cursorSmoothCaretAnimation: "on",
      scrollBeyondLastLine: false,
      tabCompletion: "on",
      quickSuggestions: true,
      quickSuggestionsDelay: 150,                                      
      suggest: { showDeprecated: true },                                    
      parameterHints: { enabled: true },                                   
      hover: { enabled: true, delay: 200 },                                 
      lightbulb: { enabled: true },                       
      glyphMargin: true,                                            
      inlineSuggest: { enabled: true },                                       
    };
  }

  function createEditor() {
    editor = monaco.editor.create(host, editorOptions());
    wireIntellisenseActions();            
    attachDebugGutter(editor, monaco);                                          
    showModelFor(tabs.activeTab);
  }


  function wireIntellisenseActions() {

    editor.addAction({
      id: "rsw.goToDefinition",
      label: "Go to Definition",
      keybindings: [monaco.KeyCode.F12],
      run: (ed) => {
        const model = ed.getModel();
        const pos = ed.getPosition();
        if (!model || !pos) return;
        const def = findLocalDefinition(model, pos);
        if (def) {
          try {
            ed.revealLineInCenter(def.lineNumber);
            ed.setPosition({ lineNumber: def.lineNumber, column: def.column });
            ed.focus();
          } catch (_) {            }
          return;
        }
        const target = resolveRequireTarget(model, pos);
        if (target) {
          openScript(target);
          return;
        }
        bus.emit("status:message", { text: "Definition not found" });
      },
    });

    editor.addAction({
      id: "rsw.explainWithAssistant",
      label: "Explain with Assistant",
      contextMenuGroupId: "9_assistant",
      contextMenuOrder: 1,
      run: (ed) => {
        const model = ed.getModel();
        if (!model) return;
        const sel = ed.getSelection();
        const text = sel && !sel.isEmpty() ? model.getValueInRange(sel) : model.getValue();
        const code = String(text || "").slice(0, 4000).trim();
        if (!code) return;
        bus.emit("assistant:open", { prompt: "Explain this Luau code:\n```luau\n" + code + "\n```", send: true });
      },
    });

    editor.onMouseDown((e) => {
      const ev = e && e.event;
      if (!ev || !(ev.ctrlKey || ev.metaKey)) return;
      const pos = e.target ? e.target.position : null;
      const model = editor.getModel();
      if (!pos || !model) return;
      const target = resolveRequireTarget(model, pos);
      if (target) openScript(target);
    });
  }


  function activeScriptMeta() {
    const tab = tabs.activeTab;
    const inst = tab && tab.getInstance ? tab.getInstance() : null;
    if (!inst) return null;
    let path = inst.name;
    try { path = inst.getFullName(); } catch (_) {            }
    return { name: inst.name, className: inst.className, path };
  }

  function activeScriptInfo() {
    const meta = activeScriptMeta();
    if (!meta) return null;
    const tab = tabs.activeTab;
    const inst = tab && tab.getInstance ? tab.getInstance() : null;
    const pos = editor && typeof editor.getPosition === "function" ? editor.getPosition() : null;
    return {
      name: meta.name,
      className: meta.className,
      path: meta.path,
      source: inst ? String(inst.getProperty("Source") || "") : "",
      cursorLine: pos ? pos.lineNumber : 1,
      cursorColumn: pos ? pos.column : 1,
    };
  }

  function insertCodeAtCursor(code) {
    if (!editor || !monaco || !tabs.activeTab) return false;
    const model = editor.getModel();
    if (!model) return false;
    const pos = editor.getPosition() || { lineNumber: 1, column: 1 };
    editor.executeEdits("assistant", [{
      range: new monaco.Range(pos.lineNumber, pos.column, pos.lineNumber, pos.column),
      text: String(code || ""),
      forceMoveMarkers: true,
    }]);
    editor.focus();
    return true;
  }

  registerEditorBridge({
    getActiveScript: activeScriptInfo,
    insertAtCursor: insertCodeAtCursor,
    forceSuggest: () => {
      if (!editor) return;
      editor.trigger("codeAssist", "editor.action.inlineSuggest.trigger", {});
      editor.focus();
    },
  });


  const ANALYSIS_DEBOUNCE = 1000;                                    

  function runAnalysis(tab, rec) {
    if (!rec || !rec.model) return;
    if (rec.model.isDisposed && rec.model.isDisposed()) return;
    let issues = [];
    try {
      issues = analyzeAndMark(rec.model) || [];
    } catch (err) {
      console.error("[RSW] ScriptEditor: falha na análise do script:", err);
    }
    let name = tab.title;
    let className = "Script";
    try {
      const inst = tab.getInstance ? tab.getInstance() : null;
      if (inst) {
        name = String(inst.getProperty("Name") || tab.title);
        className = inst.className || "Script";
      }
    } catch (_) {            }

    let mode = null;
    try { mode = getAnalysisMode(rec.model); } catch (_) { mode = null; }
    bus.emit("scriptAnalysis:updated", { instanceId: tab.instanceId, name, className, issues, mode });
  }

  function scheduleAnalysis(tab, rec) {
    if (rec.analysisTimer) clearTimeout(rec.analysisTimer);
    rec.analysisTimer = setTimeout(() => {
      rec.analysisTimer = 0;
      runAnalysis(tab, rec);
    }, ANALYSIS_DEBOUNCE);
  }


  function recordFor(tab) {
    if (!tab) return null;
    const id = tab.instanceId;
    let rec = records.get(id);
    if (rec) return rec;
    const inst = tab.getInstance ? tab.getInstance() : null;
    if (!inst || !monaco) return null;
    const source = String(inst.getProperty("Source") || "");
    const model = monaco.editor.createModel(source, LUAU_LANGUAGE_ID);
    rec = { model, sync: null, offChange: null, applyingExternal: false, analysisTimer: 0 };                           
    rec.sync = createSourceSync({


      getSource: () => (model && typeof model.getValue === "function" ? model.getValue() : ""),
      setSource: (val) => {
        const live = tab.getInstance ? tab.getInstance() : null;
        if (live && !live.isDestroyed() && drafts.shouldIntercept(live)) {
          drafts.captureDraft(live, val);
          if (tabs.setDirtyByInstanceId(id, false)) renderTabs();
          return;
        }
        if (live && !live.isDestroyed()) live.setProperty("Source", val);
        if (tabs.setDirtyByInstanceId(id, false)) renderTabs();
      },
    });
    const sub = model.onDidChangeContent(() => {
      scheduleAnalysis(tab, rec);                                                                  
      if (rec.applyingExternal) return;                                              
      rec.sync.onEditorChange(model.getValue());
      if (tabs.setDirtyByInstanceId(id, true)) renderTabs();
    });
    rec.offChange = sub;
    records.set(id, rec);

    attachModel(model, { getInstance: tab.getInstance });
    debugAttachModel(model, { getInstance: tab.getInstance });                         
    runAnalysis(tab, rec);
    return rec;
  }

  function disposeRecord(instanceId) {
    const rec = records.get(instanceId);
    if (!rec) return;
    if (rec.analysisTimer) clearTimeout(rec.analysisTimer);            
    try { detachModel(rec.model); } catch (_) {            }            
    try { debugDetachModel(rec.model); } catch (_) {            }            
    bus.emit("scriptAnalysis:removed", { instanceId });            
    try { rec.sync.cancel(); } catch (_) {            }
    try { if (rec.offChange && rec.offChange.dispose) rec.offChange.dispose(); } catch (_) {            }
    try { if (rec.model && rec.model.dispose) rec.model.dispose(); } catch (_) {            }
    records.delete(instanceId);
  }

  function showModelFor(tab) {
    if (!editor) return;
    if (!tab) {
      if (typeof editor.setModel === "function") editor.setModel(null);
      updateEmptyState();
      return;
    }
    const rec = recordFor(tab);
    if (rec && typeof editor.setModel === "function") editor.setModel(rec.model);
    updateEmptyState();
    applyCollabLockState();
    if (typeof editor.focus === "function") {
      try { editor.focus(); } catch (_) {            }
    }
  }

  function updateEmptyState() {
    const hasTabs = tabs.count > 0;
    empty.toggleAttribute("hidden", hasTabs || monacoState === "error");
    host.toggleAttribute("hidden", !hasTabs || monacoState === "error");
  }

  function showError(msg) {
    if (!msg) {
      errorBox.setAttribute("hidden", "");
      errorBox.textContent = "";
      return;
    }
    errorBox.textContent = msg;                                    
    errorBox.removeAttribute("hidden");
    host.setAttribute("hidden", "");
    empty.setAttribute("hidden", "");
  }


  function applyCollabLockState() {
    const tab = tabs.activeTab;
    const inst = tab && tab.getInstance ? tab.getInstance() : null;
    const lock = inst && teamCreate.isEnabled() ? teamCreate.scriptLockFor(inst.id) : null;
    if (editor && typeof editor.updateOptions === "function") {
      editor.updateOptions({ readOnly: !!lock });
    }
    if (!lock || !inst) {
      lockBadge.setAttribute("hidden", "");
      lockBadge.dataset.inst = "";
      lockBadge.dataset.lockKey = "";
      return;
    }
    const lockKey = inst.id + ":" + lock.collabId;
    if (lockBadge.dataset.lockKey !== lockKey) {
      lockBadgeBtn.disabled = false;
      lockBadgeBtn.textContent = "Request Edit";
    }
    lockBadge.dataset.inst = inst.id;
    lockBadge.dataset.lockKey = lockKey;
    lockBadgeDot.style.background = lock.color;
    lockBadgeLabel.textContent = lock.name + " está editando";
    lockBadge.removeAttribute("hidden");
  }

  lockBadgeBtn.addEventListener("click", () => {
    const instId = lockBadge.dataset.inst;
    if (instId && teamCreate.requestScriptEdit(instId)) {
      lockBadgeBtn.disabled = true;
      lockBadgeBtn.textContent = "Solicitado...";
    }
  });


  function openScript(inst) {
    if (!isScriptClass(inst)) {
      logger.warn("Apenas Script/LocalScript/ModuleScript podem ser abertos no editor.", { source: "Editor" });
      return;
    }
    if (inst.isDestroyed && inst.isDestroyed()) return;
    const { tab } = tabs.open(inst);
    setCentralView("editor");
    applyCentralView("editor");
    renderTabs();
    updateEmptyState();
    ensureMonaco()
      .then(() => {
        recordFor(tab);
        showModelFor(tabs.activeTab);
      })
      .catch(() => {                       });
  }

  function activateTab(tabId) {
    const t = tabs.activate(tabId);
    renderTabs();
    showModelFor(t);
  }

  function closeTab(tabId, optsClose) {
    const skipConfirm = !!(optsClose && optsClose.skipConfirm);
    const tab = tabs.byId(tabId);
    if (!tab) return;
    if (!skipConfirm && tab.dirty) {
      const name = tab.title || "script";
      const okToClose =
        typeof window !== "undefined" && typeof window.confirm === "function"
          ? window.confirm(`O script "${name}" tem alteracoes nao sincronizadas. Fechar mesmo assim?`)
          : true;
      if (!okToClose) return;
    }
    const instanceId = tab.instanceId;
    disposeRecord(instanceId);
    const res = tabs.close(tabId);
    renderTabs();
    if (res.empty) {
      setCentralView("viewport");
      if (editor && typeof editor.setModel === "function") editor.setModel(null);
      updateEmptyState();
      return;
    }
    showModelFor(res.newActive);
  }


  let dragFromIndex = -1;

  function renderTabs() {
    const frag = document.createDocumentFragment();
    const list = tabs.list();
    for (let i = 0; i < list.length; i++) {
      const t = list[i];
      const inst = t.getInstance ? t.getInstance() : null;
      const cls = inst ? inst.className : "Script";
      const tabEl = el("div", "rsw-edtab");
      tabEl.dataset.tab = t.id;
      tabEl.dataset.index = String(i);
      tabEl.setAttribute("role", "tab");
      tabEl.setAttribute("draggable", "true");
      if (t.id === tabs.activeId) tabEl.classList.add("rsw-edtab--active");
      if (t.dirty) tabEl.classList.add("rsw-edtab--dirty");

      tabEl.appendChild(createIcon(CLASS_ICON[cls] || "script", 13));
      const label = el("span", "rsw-edtab__label");
      label.textContent = t.title;                          
      tabEl.appendChild(label);
      const dot = el("span", "rsw-edtab__dirty");
      dot.textContent = "\u25CF";               
      tabEl.appendChild(dot);
      const close = el("button", "rsw-edtab__close");
      close.type = "button";
      close.dataset.close = t.id;
      close.setAttribute("aria-label", "Fechar tab");
      close.appendChild(createIcon("close", 11));
      tabEl.appendChild(close);

      frag.appendChild(tabEl);
    }
    tabList.replaceChildren(frag);
  }


  tabList.addEventListener("click", (e) => {
    const t = e.target;
    if (!t || typeof t.closest !== "function") return;
    const closeBtn = t.closest("[data-close]");
    if (closeBtn) {
      e.stopPropagation();
      closeTab(closeBtn.dataset.close);
      return;
    }
    const tabEl = t.closest("[data-tab]");
    if (tabEl) activateTab(tabEl.dataset.tab);
  });


  tabList.addEventListener("auxclick", (e) => {
    if (e.button !== 1) return;
    const tabEl = e.target && e.target.closest ? e.target.closest("[data-tab]") : null;
    if (tabEl) { e.preventDefault(); closeTab(tabEl.dataset.tab); }
  });


  tabList.addEventListener("dragstart", (e) => {
    const tabEl = e.target && e.target.closest ? e.target.closest("[data-tab]") : null;
    dragFromIndex = tabEl ? Number(tabEl.dataset.index) : -1;
    if (e.dataTransfer) { try { e.dataTransfer.effectAllowed = "move"; } catch (_) {} }
  });
  tabList.addEventListener("dragover", (e) => {
    if (dragFromIndex < 0) return;
    e.preventDefault();
    if (e.dataTransfer) { try { e.dataTransfer.dropEffect = "move"; } catch (_) {} }
  });
  tabList.addEventListener("drop", (e) => {
    if (dragFromIndex < 0) return;
    e.preventDefault();
    const tabEl = e.target && e.target.closest ? e.target.closest("[data-tab]") : null;
    const to = tabEl ? Number(tabEl.dataset.index) : tabs.count - 1;
    if (tabs.move(dragFromIndex, to)) renderTabs();
    dragFromIndex = -1;
  });

  returnBtn.addEventListener("click", () => setCentralView("viewport"));


  function onKeyDown(e) {
    if (getCentralView() !== "editor") return;
    const ctrl = e.ctrlKey || e.metaKey;
    if (ctrl && (e.key === "w" || e.key === "W")) {
      e.preventDefault();
      if (tabs.activeId) closeTab(tabs.activeId);
      return;
    }
    if (ctrl && e.key === "Tab") {
      e.preventDefault();
      const t = e.shiftKey ? tabs.prev() : tabs.next();
      renderTabs();
      showModelFor(t);
    }
  }
  document.addEventListener("keydown", onKeyDown, true);


  const offProp = bus.on(Events.PropertyChanged, (payload) => {
    const inst = payload && payload.instance;
    if (!inst) return;
    const id = inst.id;
    if (payload.property === "Name") {
      if (tabs.updateTitleByInstanceId(id, payload.value)) renderTabs();
      const renamedTab = tabs.byInstanceId(id);                                       
      const renamedRec = records.get(id);
      if (renamedTab && renamedRec) runAnalysis(renamedTab, renamedRec);
      return;
    }
    if (payload.property === "Source") {
      const rec = records.get(id);
      if (!rec) return;
      const value = String(payload.value == null ? "" : payload.value);
      if (!rec.sync.shouldApplyExternal(value)) return;
      rec.applyingExternal = true;
      try {
        if (typeof rec.model.setValue === "function") rec.model.setValue(value);
      } finally {
        rec.applyingExternal = false;
      }
    }
  });

  const offScriptLocks = bus.on("collab:scriptLocks", () => applyCollabLockState());
  const offCollabEnabled = bus.on("collab:enabledChanged", () => applyCollabLockState());


  const offDraftReverted = bus.on("drafts:reverted", (payload) => {
    const instId = payload && payload.instId;
    if (!instId) return;
    const tab = tabs.byInstanceId(instId);
    const rec = records.get(instId);
    if (!tab || !rec) return;
    const inst = tab.getInstance ? tab.getInstance() : null;
    if (!inst || inst.isDestroyed()) return;
    let live = "";
    try { live = String(inst.getProperty("Source") || ""); } catch (_) {            }
    try { rec.sync.cancel(); } catch (_) {            }                                          
    if (rec.model && typeof rec.model.getValue === "function" && rec.model.getValue() !== live) {
      rec.applyingExternal = true;
      try {
        if (typeof rec.model.setValue === "function") rec.model.setValue(live);
      } finally {
        rec.applyingExternal = false;
      }
    }
    if (tabs.setDirtyByInstanceId(instId, false)) renderTabs();
  });

  const offDestroy = bus.on(Events.Destroying, (payload) => {
    const inst = payload && payload.instance;
    if (!inst) return;
    const tab = tabs.byInstanceId(inst.id);
    if (!tab) return;
    disposeRecord(inst.id);
    const res = tabs.closeByInstanceId(inst.id);
    renderTabs();
    if (res.empty) {
      setCentralView("viewport");
      if (editor && typeof editor.setModel === "function") editor.setModel(null);
      updateEmptyState();
    } else {
      showModelFor(res.newActive);
    }
  });


  const offTheme = bus.on("theme:changed", () => {
    if (monaco && monaco.editor && typeof monaco.editor.setTheme === "function") {
      monaco.editor.setTheme(themeIdFor(effectiveEditorTheme()));
    }
  });
  const offSettings = bus.on("settings:changed", ({ key }) => {
    if (key === "editorTheme") {
      if (monaco && monaco.editor && typeof monaco.editor.setTheme === "function") {
        monaco.editor.setTheme(themeIdFor(effectiveEditorTheme()));
      }
      return;
    }


    if (key === "luauTypeChecking" || key === "luauStrictByDefault") {
      for (const t of tabs.list()) {
        const rec2 = records.get(t.instanceId);
        if (rec2) runAnalysis(t, rec2);
      }
      return;
    }
    if (!editor || typeof editor.updateOptions !== "function") return;
    if (key === "editorFontSize" || key === "editorTabSize" || key === "editorWordWrap" || key === "editorMinimap" || key === "editorLineNumbers") {
      const s = settings.all();
      editor.updateOptions({
        fontSize: typeof s.editorFontSize === "number" ? s.editorFontSize : 14,
        tabSize: typeof s.editorTabSize === "number" ? s.editorTabSize : 2,
        wordWrap: s.editorWordWrap === false ? "off" : "on",
        lineNumbers: s.editorLineNumbers !== false ? "on" : "off",
        minimap: { enabled: s.editorMinimap !== false },
      });
    }
  });


  const offOpen = bus.on("editor:openScript", (payload) => {
    const inst = payload && (payload.instance || payload);
    openScript(inst);
  });


  const offReanalyze = bus.on("scriptAnalysis:reanalyzeAll", () => {
    for (const t of tabs.list()) {
      const rec = records.get(t.instanceId);
      if (rec) runAnalysis(t, rec);
    }
  });


  const offReveal = bus.on("editor:revealIssue", (p) => {
    if (!p || !p.instanceId) return;
    const tab = tabs.byInstanceId(p.instanceId);
    if (!tab) return;
    setCentralView("editor");
    applyCentralView("editor");
    activateTab(tab.id);
    if (!editor) return;
    const line = Math.max(1, p.line || 1);
    const col = Math.max(1, p.column || 1);
    try {
      editor.revealLineInCenter(line);
      editor.setPosition({ lineNumber: line, column: col });
      editor.focus();
    } catch (_) {            }
  });


  const offDebugFocus = bus.on("debugger:focusLine", (p) => {
    if (!p || !p.instance) return;
    openScript(p.instance);
    const line = Math.max(1, p.line || 1);
    let attempts = 40;
    const tryReveal = () => {
      const tab = tabs.byInstanceId(p.instance.id);
      if (editor && tab && tabs.activeTab && tabs.activeTab.id === tab.id && editor.getModel()) {
        try {
          editor.revealLineInCenter(line);
          editor.setPosition({ lineNumber: line, column: 1 });
        } catch (_) {            }
        return;
      }
      if (--attempts > 0) setTimeout(tryReveal, 50);
    };
    tryReveal();
  });


  const offStore = store.subscribe((state, change) => {
    if (change && change.key === "centralView") applyCentralView(state.centralView);
  });


  applyCentralView(getCentralView());
  updateEmptyState();

  logger.info("Editor de scripts montado.", { source: "Editor" });

  function destroy() {
    document.removeEventListener("keydown", onKeyDown, true);
    if (offProp) offProp();
    if (offDestroy) offDestroy();
    if (offTheme) offTheme();
    if (offSettings) offSettings();
    if (offOpen) offOpen();
    if (offReanalyze) offReanalyze();            
    if (offReveal) offReveal();            
    if (offDebugFocus) offDebugFocus();            
    if (offScriptLocks) offScriptLocks();                                         
    if (offCollabEnabled) offCollabEnabled();                                         
    if (offDraftReverted) offDraftReverted();
    if (offStore) offStore();
    for (const id of [...records.keys()]) disposeRecord(id);
    if (editor && typeof editor.dispose === "function") {
      try { editor.dispose(); } catch (_) {            }
    }
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  return {
    el: root,
    openScript,
    closeTab,
    setCentralView,
    destroy,
    _debug: {
      tabs,
      records,
      isScriptClass,
      getCentralView,
      ensureMonaco,
      renderTabs,
      getMonacoState: () => monacoState,
      getEditor: () => editor,
    },
  };
}
