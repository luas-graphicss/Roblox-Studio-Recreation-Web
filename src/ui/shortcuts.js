import { keybindings } from "../core/keybindings.js";
import { commandRegistry } from "../core/commandRegistry.js";
import { bus } from "../core/eventBus.js";
import { store } from "../core/state.js";
import { settings } from "../config/settings.js";
import { selection } from "../core/selection.js";
import { tools } from "../viewport/tools.js";
import { engine } from "../runtime/engine.js";
import { debuggerController } from "../debugger/controller.js";
import { isModalOpen } from "./modal.js";
import { pasteIntoSelection, hasClipboard } from "../core/editOps.js";
import { toggleMicroProfiler } from "./microProfiler.js";
import { forceCodeAssistSuggestion } from "../ai/editorBridge.js";
import { focusApiSearch } from "./apiBrowser.js";            
import { openInsertObjectDialog } from "./insertObjectDialog.js";            
import { toggleValidationPanel } from "./validationPanel.js";            

function isStartPage() {
  return document.body.classList.contains("rsw-mode-start");
}

export function registerDefaultShortcuts(deps) {
  const scriptEditor = deps && deps.scriptEditor ? deps.scriptEditor : null;

  keybindings.setContextProviders({
    isDialogOpen: () => isModalOpen(),
    isScriptEditorActive: () => !isStartPage() && store.get("centralView") === "editor",
    isViewportActive: () => !isStartPage() && store.get("centralView") !== "editor",
    isPlaytestRunning: () => engine.isRunning() || debuggerController.isPaused(),
  });

  const cmd = (id) => () => commandRegistry.run(id);
  const cmdEnabled = (id) => () => commandRegistry.isEnabled(id);
  const reg = (def) => keybindings.register(def);


  reg({ id: "file.new", label: "New Project", category: "File", combo: "Ctrl+N", run: cmd("file.new"), enabled: cmdEnabled("file.new") });
  reg({ id: "file.open", label: "Open Project", category: "File", combo: "Ctrl+O", run: cmd("file.open"), enabled: cmdEnabled("file.open") });
  reg({ id: "file.save", label: "Save", category: "File", combo: "Ctrl+S", run: cmd("file.save"), enabled: cmdEnabled("file.save") });
  reg({ id: "file.saveAs", label: "Save As", category: "File", combo: "Ctrl+Shift+S", run: cmd("file.saveAs"), enabled: cmdEnabled("file.saveAs") });
  reg({ id: "file.publish", label: "Publish to Roblox", category: "File", combo: "Ctrl+P", run: cmd("file.saveToRoblox"), enabled: cmdEnabled("file.saveToRoblox") });
  reg({ id: "app.studioSettings", label: "Studio Settings", category: "File", combo: "Ctrl+,", run: cmd("file.studioSettings") });


  reg({ id: "help.apiReference", label: "API Reference", category: "Help", combo: "Ctrl+Shift+D", run: () => focusApiSearch() });
  reg({ id: "insert.objectDialog", label: "Insert Object\u2026", category: "Insert", combo: "Alt+I", skipWhenTyping: true, run: () => openInsertObjectDialog() });


  reg({ id: "edit.undo", label: "Undo", category: "Edit", combo: "Ctrl+Z", run: cmd("edit.undo"), enabled: cmdEnabled("edit.undo") });
  reg({ id: "edit.redo", label: "Redo", category: "Edit", combo: "Ctrl+Y", run: cmd("edit.redo"), enabled: cmdEnabled("edit.redo") });
  reg({ id: "edit.redoAlt", label: "Redo (Alternative)", category: "Edit", combo: "Ctrl+Shift+Z", run: cmd("edit.redo"), enabled: cmdEnabled("edit.redo") });
  reg({ id: "edit.cut", label: "Cut", category: "Edit", combo: "Ctrl+X", skipWhenTyping: true, run: cmd("edit.cut"), enabled: cmdEnabled("edit.cut") });
  reg({ id: "edit.copy", label: "Copy", category: "Edit", combo: "Ctrl+C", skipWhenTyping: true, run: cmd("edit.copy"), enabled: cmdEnabled("edit.copy") });
  reg({ id: "edit.paste", label: "Paste", category: "Edit", combo: "Ctrl+V", skipWhenTyping: true, run: cmd("edit.paste"), enabled: cmdEnabled("edit.paste") });
  reg({ id: "edit.pasteInto", label: "Paste Into", category: "Edit", combo: "Ctrl+Shift+V", enabled: () => hasClipboard() && selection.get().length === 1, run: () => pasteIntoSelection() });
  reg({ id: "edit.duplicate", label: "Duplicate", category: "Edit", combo: "Ctrl+D", run: cmd("edit.duplicate"), enabled: cmdEnabled("edit.duplicate") });
  reg({ id: "edit.delete", label: "Delete", category: "Edit", combo: "Delete", skipWhenTyping: true, run: cmd("edit.delete"), enabled: cmdEnabled("edit.delete") });
  reg({ id: "edit.deleteAlt", label: "Delete (Backspace)", category: "Edit", combo: "Backspace", skipWhenTyping: true, run: cmd("edit.delete"), enabled: cmdEnabled("edit.delete") });
  reg({ id: "edit.selectAll", label: "Select All", category: "Edit", combo: "Ctrl+A", run: cmd("edit.selectAll"), enabled: cmdEnabled("edit.selectAll") });
  reg({ id: "edit.group", label: "Group", category: "Edit", combo: "Ctrl+G", layer: "viewport", run: cmd("format.group"), enabled: cmdEnabled("format.group") });
  reg({ id: "edit.ungroup", label: "Ungroup", category: "Edit", combo: "Ctrl+U", run: cmd("format.ungroup"), enabled: cmdEnabled("format.ungroup") });


  reg({ id: "edit.lock", label: "Lock", category: "Edit", combo: "L", layer: "viewport", skipWhenTyping: true, run: cmd("format.lock"), enabled: cmdEnabled("format.lock") });
  reg({ id: "edit.rename", label: "Rename", category: "Edit", combo: "F2", skipWhenTyping: true, enabled: () => selection.get().length === 1, run: () => bus.emit("explorer:renameAnchor", {}) });


  const toolDefs = [
    ["select", "Q", "Select Tool"],
    ["move", "W", "Move Tool"],
    ["rotate", "E", "Rotate Tool"],
    ["scale", "R", "Scale Tool"],
    ["transform", "T", "Transform Tool"],
  ];
  for (const [tool, key, label] of toolDefs) {
    reg({ id: "tools." + tool, label, category: "Tools", combo: key, layer: "viewport", skipWhenTyping: true, run: () => tools.set(tool) });
  }


  reg({ id: "view.focusSelection", label: "Focus Selection", category: "Viewport", combo: "F", layer: "viewport", skipWhenTyping: true, enabled: () => selection.get().length > 0, run: () => bus.emit("camera:focusSelection", {}) });
  reg({ id: "view.frameSelection", label: "Zoom to Fit Selection", category: "Viewport", combo: "Ctrl+Shift+F", layer: "viewport", run: () => bus.emit("camera:frameSelection", {}) });
  reg({ id: "view.toggleProjection", label: "Perspective/Orthographic", category: "Viewport", combo: "Alt+P", layer: "viewport", run: () => bus.emit("camera:toggleProjection", {}) });
  const views = [
    ["front", "Numpad1", "Front View"],
    ["back", "Numpad2", "Back View"],
    ["right", "Numpad3", "Right View"],
    ["left", "Numpad4", "Left View"],
    ["top", "Numpad5", "Top View"],
    ["bottom", "Numpad6", "Bottom View"],
  ];
  for (const [view, key, label] of views) {
    reg({ id: "view.camera." + view, label, category: "Viewport", combo: key, layer: "viewport", skipWhenTyping: true, run: () => bus.emit("camera:view", { view }) });
  }
  reg({ id: "view.resetCamera", label: "Reset Camera", category: "Viewport", combo: "Numpad0", layer: "viewport", skipWhenTyping: true, run: () => bus.emit("camera:reset", {}) });
  reg({ id: "select.clear", label: "Clear Selection", category: "Viewport", combo: "Escape", layer: "viewport", skipWhenTyping: true, enabled: () => selection.get().length > 0, run: () => selection.clear() });
  reg({ id: "snap.toggleMove", label: "Toggle Move Snap", category: "Viewport", combo: "Ctrl+Shift+1", run: () => settings.set("moveSnapEnabled", settings.get("moveSnapEnabled") !== true) });
  reg({ id: "snap.toggleRotate", label: "Toggle Rotate Snap", category: "Viewport", combo: "Ctrl+Shift+2", run: () => settings.set("rotateSnapEnabled", settings.get("rotateSnapEnabled") !== true) });


  reg({ id: "playtest.play", label: "Play", category: "Playtest", combo: "F5", enabled: () => commandRegistry.isEnabled("test.play") && !debuggerController.isPaused(), run: cmd("test.play") });
  reg({ id: "playtest.playHere", label: "Play Here", category: "Playtest", combo: "F6", enabled: () => !engine.isRunning(), run: () => engine.playHere() });
  reg({ id: "playtest.pause", label: "Pause/Resume", category: "Playtest", combo: "F7", enabled: () => engine.isRunning(), run: cmd("test.pause") });
  reg({ id: "playtest.run", label: "Run", category: "Playtest", combo: "F8", run: cmd("test.run"), enabled: cmdEnabled("test.run") });
  reg({ id: "playtest.stop", label: "Stop", category: "Playtest", combo: "Shift+F5", run: cmd("test.stop"), enabled: cmdEnabled("test.stop") });
  reg({ id: "test.microProfiler", label: "Toggle MicroProfiler", category: "Playtest", combo: "Ctrl+F6", run: () => toggleMicroProfiler() });
  reg({ id: "test.validation", label: "Master Validation", category: "Playtest", combo: "Ctrl+Alt+V", run: () => toggleValidationPanel() });
  reg({ id: "playtest.devConsole", label: "Developer Console", category: "Playtest", combo: "F9", layer: "playtest", enabled: () => engine.isRunning(), run: () => bus.emit("devconsole:toggle") });


  const paused = () => debuggerController.isPaused();
  reg({ id: "debug.toggleOutput", label: "Toggle Output", category: "Debug", combo: "F9", run: cmd("view.output") });
  reg({ id: "debug.resume", label: "Resume (Debugger)", category: "Debug", combo: "F5", layer: "playtest", enabled: paused, run: () => debuggerController.resume() });
  reg({ id: "debug.stepOver", label: "Step Over", category: "Debug", combo: "F10", layer: "playtest", enabled: paused, run: () => debuggerController.stepOver() });
  reg({ id: "debug.stepInto", label: "Step Into", category: "Debug", combo: "F11", layer: "playtest", enabled: paused, run: () => debuggerController.stepInto() });
  reg({ id: "debug.stepOut", label: "Step Out", category: "Debug", combo: "Shift+F11", layer: "playtest", enabled: paused, run: () => debuggerController.stepOut() });


  function monacoEditor() {
    if (!scriptEditor || !scriptEditor._debug || typeof scriptEditor._debug.getEditor !== "function") return null;
    return scriptEditor._debug.getEditor() || null;
  }
  function monacoAction(actionId) {
    const ed = monacoEditor();
    if (!ed || typeof ed.getAction !== "function") return;
    const action = ed.getAction(actionId);
    if (action && typeof action.run === "function") action.run();
  }
  function editorTabs() {
    return scriptEditor && scriptEditor._debug && scriptEditor._debug.tabs ? scriptEditor._debug.tabs : null;
  }
  const se = (id, label, combo, run, extra) =>
    reg({ id, label, category: "Script Editor", combo, layer: "scriptEditor", run, ...(extra || {}) });

  se("editor.find", "Find", "Ctrl+F", () => monacoAction("actions.find"));
  se("editor.replace", "Find and Replace", "Ctrl+H", () => monacoAction("editor.action.startFindReplaceAction"));
  se("editor.gotoLine", "Go to Line", "Ctrl+G", () => monacoAction("editor.action.gotoLine"));
  se("editor.toggleComment", "Toggle Comment", "Ctrl+/", () => monacoAction("editor.action.commentLine"));
  se("editor.closeTab", "Close Tab", "Ctrl+W", () => {
    const t = editorTabs();
    const active = t && typeof t.getActive === "function" ? t.getActive() : null;
    if (active && typeof scriptEditor.closeTab === "function") {
      scriptEditor.closeTab(active.id != null ? active.id : active);
    }
  });
  se("editor.nextTab", "Next Tab", "Ctrl+Tab", () => {
    const t = editorTabs();
    if (t && typeof t.next === "function") t.next();
  });
  se("editor.prevTab", "Previous Tab", "Ctrl+Shift+Tab", () => {
    const t = editorTabs();
    if (t && typeof t.prev === "function") t.prev();
  });
  se("editor.findInAll", "Find in All Scripts", "Ctrl+Shift+F", () => commandRegistry.run("view.findResults"));
  se("editor.goToDefinition", "Go to Definition", "F12", () => monacoAction("editor.action.revealDefinition"));
  se("editor.findReferences", "Find All References", "Shift+F12", () => monacoAction("editor.action.goToReferences"));
  se("editor.codeAssist", "Trigger Code Assist", "Ctrl+Shift+Space", () => {
    if (!forceCodeAssistSuggestion()) monacoAction("editor.action.inlineSuggest.trigger");
  });
  reg({ id: "view.gotoViewport", label: "Go to Viewport", category: "Script Editor", combo: "Alt+F1", run: () => { if (scriptEditor && typeof scriptEditor.setCentralView === "function") scriptEditor.setCentralView("viewport"); } });
  reg({ id: "view.gotoEditor", label: "Go to Script Editor", category: "Script Editor", combo: "Alt+F2", run: () => { if (scriptEditor && typeof scriptEditor.setCentralView === "function") scriptEditor.setCentralView("editor"); } });


  reg({ id: "panels.explorer", label: "Toggle Explorer", category: "Panels", combo: "Ctrl+Shift+X", run: cmd("view.explorer") });
  reg({ id: "panels.properties", label: "Toggle Properties", category: "Panels", combo: "Ctrl+Shift+P", run: cmd("view.properties") });
  reg({ id: "panels.output", label: "Toggle Output", category: "Panels", combo: "Ctrl+Shift+O", run: cmd("view.output") });
  reg({ id: "panels.toolbox", label: "Toggle Toolbox", category: "Panels", combo: "Ctrl+Shift+T", run: cmd("view.toolbox") });
  reg({ id: "panels.assistant", label: "Toggle Assistant", category: "Panels", combo: "Ctrl+I", run: cmd("view.assistant") });
  reg({ id: "app.gameSettings", label: "Game Settings", category: "Panels", combo: "Ctrl+Shift+G", run: cmd("file.gameSettings"), enabled: cmdEnabled("file.gameSettings") });

  keybindings.loadFromSettings();
}
