import { commandRegistry } from "../core/commandRegistry.js";
import { persistence } from "../persistence/persistence.js";            
import {
  openSaveAsDialog,
  openOpenDialog as openOpenDialogReal,
  openInsertFromFile,
  openRecoverDialog,
} from "./dialogs/projectDialogs.js";            
import { isModalOpen, openInfo, openConfirm, _el as el } from "./modal.js";
import { project, setStatus } from "../core/project.js";
import { commands } from "../core/commands.js";
import { selection } from "../core/selection.js";
import { store } from "../core/state.js";
import { theme } from "../theme/theme.js";
import { bus } from "../core/eventBus.js";
import { toggleTagEditor, isTagEditorOpen } from "./tagEditor.js";            
import * as teamCreate from "../collab/teamCreate.js";            
import { toggleTeamCreatePanel, isTeamCreatePanelOpen, openTeamCreatePanel } from "./teamCreatePanel.js";            
import { toggleDraftsPanel, isDraftsPanelOpen } from "./draftsPanel.js";            
import { toggleActivityLogPanel, isActivityLogPanelOpen } from "./activityLogPanel.js";            
import { logger } from "../core/logger.js";
import { engine } from "../runtime/engine.js";
import { sanitizeName } from "../datamodel/types.js";
import { insertObject, duplicateSelection, deleteSelection } from "../viewport/objectOps.js";
import {
  cutSelection,
  copySelection,
  pasteFromClipboard,
  hasClipboard,
  selectAll,
  groupSelection,
  ungroupSelection,
  canGroup,
  canUngroup,
  canLock,
  toggleLockSelection,
  insertAnyClass,
  getWorkspaceRoot,
} from "../core/editOps.js";
import {
  canAlign,
  alignLeft,
  alignCenterH,
  alignRight,
  alignTop,
  alignMiddle,
  alignBottom,
  canToggleAnchored,
  getAnchoredActive,
  toggleAnchored,
} from "../core/modelOps.js";
import { openGameSettings } from "./dialogs/gameSettings.js";
import { openPublish } from "./dialogs/publish.js";
import { openCreatorDashboard, saveCurrentProjectToCloud } from "./creatorDashboard.js";            
import { openStudioSettings } from "./dialogs/studioSettings.js";
import { openAboutDialog, openReportBugDialog, openCheckForUpdates } from "./helpDialogs.js";            
import { exportPlaceRbxlx, exportSelectionRbxmx, exportPlaceRbxl, exportSelectionRbxm, importRobloxFile } from "../interop/rbxInterop.js";               
import { openWhatsNewPanel } from "./whatsNewPanel.js";            
import { focusApiSearch } from "./apiBrowser.js";            
import { startWelcomeTour } from "../help/welcomeTour.js";            

function hasSelection() {
  try {
    return selection.get().length > 0;
  } catch (_) {
    return false;
  }
}


function confirmUnsavedThen(proceed) {
  if (!project.isDirty()) {
    proceed();
    return;
  }
  openConfirm({
    title: "Unsaved changes",
    message: "Você tem alterações não salvas. Deseja salvá-las antes de continuar?",
    buttons: [
      { label: "Save", value: "save", kind: "primary" },
      { label: "Don't Save", value: "discard", kind: "default" },
      { label: "Cancel", value: "cancel", kind: "ghost" },
    ],
    closeOnBackdrop: false,
  }).then((choice) => {
    if (choice == null || choice === "cancel") return;
    if (choice === "save") {

      persistence.save().then((ok) => {
        if (ok) proceed();
      });
      return;
    }
    proceed();
  });
}


function pickFile(accept, onPick) {
  const input = document.createElement("input");
  input.type = "file";
  if (accept) input.accept = accept;
  input.style.position = "fixed";
  input.style.left = "-9999px";
  document.body.appendChild(input);
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    if (file) onPick(sanitizeName(file.name));
    if (input.parentNode) input.parentNode.removeChild(input);
  });
  input.click();
}

function importAsset() {
  pickFile(".rbxm,.obj,.fbx,.png,.jpg,.mesh", (name) => {
    logger.info("Import (simulado): " + name, { source: "Studio" });
    setStatus("Imported: " + name);
  });
}


function downloadBlob(filename, text) {
  try {
    const blob = new Blob([text], { type: "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
      URL.revokeObjectURL(url);
      if (a.parentNode) a.parentNode.removeChild(a);
    }, 0);
    return true;
  } catch (e) {
    logger.warn("Export falhou: " + (e && e.message));
    return false;
  }
}


async function exportPlaceReal() {
  try {
    const { text } = await persistence.buildPlaceTextAsync("Exporting\u2026");
    downloadBlob(persistence.safeFileName(project.getName()) + ".rswp", text);
    logger.info("Exported place (.rswp).", { source: "Studio" });
    setStatus("Exported place");
  } catch (e) {
    logger.warn("Export Place falhou: " + (e && e.message ? e.message : e));
  }
}

function openAutoRecover() {
  const body = el("div", "rsw-info");
  body.appendChild(el("p", "rsw-info__msg", "Arquivos recuperados automaticamente:"));
  const list = el("ul", "rsw-picker__list");
  list.appendChild(el("li", "rsw-picker__item", "Nenhum arquivo de recuperação encontrado."));
  body.appendChild(list);
  openInfo({ title: "Auto-Recover", content: body });
}

function openVersionHistory() {
  import("./versionHistoryDialog.js")
    .then((m) => m.openVersionHistoryDialog())
    .catch((e) => logger.warn("Version History indisponivel: " + (e && e.message)));
}

function exitStudio() {
  confirmUnsavedThen(() => {
    openInfo({
      title: "Exit Studio",
      content: "Você pode fechar esta aba do navegador para sair do Studio.",
    });
    setStatus("Ready to exit");
  });
}


function togglePanel(key) {
  const P = store.getState().layout.panels;
  store.setLayout({ panels: { [key]: !P[key] } });
}
function panelVisible(key) {
  return !!store.getState().layout.panels[key];
}

let _initialized = false;

export function initMenuActions(target) {
  if (_initialized) return;
  _initialized = true;

  const reg = (id, def) => commandRegistry.register(id, def);


  reg("file.new", { label: "New", shortcut: "Ctrl+N", run: () => confirmUnsavedThen(() => persistence.newPlace()) });
  reg("file.open", { label: "Open\u2026", shortcut: "Ctrl+O", run: () => openOpenDialogReal() });
  reg("file.openFromFile", { label: "Open from File\u2026", run: () => openOpenDialogReal() });
  reg("file.closePlace", { label: "Close Place", run: () => confirmUnsavedThen(() => bus.emit("startpage:closeProject")) });
  reg("file.save", { label: "Save", shortcut: "Ctrl+S", run: () => persistence.save() });
  reg("file.saveAs", { label: "Save As\u2026", shortcut: "Ctrl+Shift+S", run: () => openSaveAsDialog() });
  reg("file.saveToRoblox", { label: "Save to Roblox\u2026", shortcut: "Ctrl+P", run: () => openPublish({ asNew: false }) });
  reg("file.publishAs", { label: "Publish to Roblox As\u2026", run: () => openPublish({ asNew: true }) });
  reg("file.saveToCloud", { label: "Save to Cloud\u2026", run: () => saveCurrentProjectToCloud() });            
  reg("file.gameSettings", { label: "Game Settings\u2026", shortcut: "Ctrl+Shift+G", run: () => openGameSettings() });
  reg("file.studioSettings", { shortcut: "Ctrl+,", label: "Studio Settings\u2026", run: () => openStudioSettings() });
  reg("file.import", { label: "Import\u2026", run: importAsset });
  reg("file.insertFromFile", { label: "Insert from File\u2026", run: () => openInsertFromFile() });
  reg("file.exportSelection", { label: "Export Selection\u2026", enabled: hasSelection, run: () => persistence.exportSelectionToFile() });
  reg("file.exportPlace", { label: "Export Place\u2026", run: exportPlaceReal });

  reg("file.importRoblox", { label: "Import from Roblox (.rbxl/.rbxlx/.rbxm/.rbxmx)\u2026", run: () => importRobloxFile() });
  reg("file.exportRbxlx", { label: "Export to Roblox (.rbxlx)\u2026", run: () => exportPlaceRbxlx() });
  reg("file.exportRbxl", { label: "Export to Roblox (.rbxl)\u2026", run: () => exportPlaceRbxl() });
  reg("file.exportSelectionRbxmx", { label: "Export Selection to Roblox (.rbxmx)\u2026", enabled: hasSelection, run: () => exportSelectionRbxmx() });
  reg("file.exportSelectionRbxm", { label: "Export Selection to Roblox (.rbxm)\u2026", enabled: hasSelection, run: () => exportSelectionRbxm() });
  reg("file.autoRecover", { label: "Auto-Recover\u2026", run: () => openRecoverDialog() });
  reg("file.versionHistory", { label: "Version History\u2026", run: openVersionHistory });
  reg("file.teamCreate", {
    label: "Team Create",
    checked: () => teamCreate.isEnabled(),
    run: () => {
      teamCreate.setEnabled(!teamCreate.isEnabled());
      if (teamCreate.isEnabled()) openTeamCreatePanel();
    },
  });
  reg("file.exit", { label: "Exit Studio", run: exitStudio });


  reg("edit.undo", { label: "Undo", enabled: () => commands.canUndo(), run: () => commands.undo() });
  reg("edit.redo", { label: "Redo", enabled: () => commands.canRedo(), run: () => commands.redo() });
  reg("edit.cut", { label: "Cut", enabled: hasSelection, run: () => cutSelection() });
  reg("edit.copy", { label: "Copy", enabled: hasSelection, run: () => copySelection() });
  reg("edit.paste", { label: "Paste", enabled: () => hasClipboard(), run: () => pasteFromClipboard() });
  reg("edit.duplicate", { label: "Duplicate", enabled: hasSelection, run: () => duplicateSelection() });
  reg("edit.delete", { label: "Delete", enabled: hasSelection, run: () => deleteSelection() });
  reg("edit.selectAll", { label: "Select All", shortcut: "Ctrl+A", skipWhenTyping: true, run: () => selectAll() });


  reg("view.explorer", { shortcut: "Ctrl+Shift+X", label: "Explorer", checked: () => panelVisible("explorer"), run: () => togglePanel("explorer") });
  reg("view.properties", { shortcut: "Ctrl+Shift+P", label: "Properties", checked: () => panelVisible("properties"), run: () => togglePanel("properties") });
  reg("view.output", { shortcut: "Ctrl+Shift+O", label: "Output", checked: () => panelVisible("output"), run: () => togglePanel("output") });
  reg("view.assistant", { shortcut: "Ctrl+I", label: "Assistant", checked: () => panelVisible("assistant"), run: () => togglePanel("assistant") });            
  reg("view.apiBrowser", { label: "API Browser", checked: () => panelVisible("apiBrowser"), run: () => togglePanel("apiBrowser") });            
  reg("view.findResults", { label: "Find Results", checked: () => panelVisible("find"), run: () => togglePanel("find") });
  reg("view.commandBar", { label: "Command Bar", checked: () => !!store.get("commandBarVisible"), run: () => store.set("commandBarVisible", !store.get("commandBarVisible")) });
  reg("view.toolbox", { shortcut: "Ctrl+Shift+T", label: "Toolbox", run: () => bus.emit("toolbox:toggle", {}) });
  reg("view.assetManager", { label: "Asset Manager", run: () => bus.emit("assetmanager:toggle", {}) });
  reg("view.creatorDashboard", { label: "Creator Dashboard", run: () => openCreatorDashboard() });            

  reg("view.packageManager", {
    label: "Package Manager",
    run: () => {
      import("./packageManagerDialog.js").then((m) => m.openPackageManagerDialog());
    },
  });
  reg("view.theme", { label: "Toggle Theme", checked: () => theme.get() === "dark", run: () => theme.toggle() });
  reg("view.tagEditor", { label: "Tag Editor", checked: () => isTagEditorOpen(), run: () => toggleTagEditor() });            
  reg("view.teamCreatePanel", { label: "Team Create", checked: () => isTeamCreatePanelOpen(), run: () => toggleTeamCreatePanel() });            
  reg("view.draftsPanel", { label: "Drafts", checked: () => isDraftsPanelOpen(), run: () => toggleDraftsPanel() });            
  reg("view.activityLog", { label: "Activity Log", checked: () => isActivityLogPanelOpen(), run: () => toggleActivityLogPanel() });            

  reg("view.colorGrading", {
    label: "Color Grading",
    run: () => {
      import("./dialogs/gradingPanel.js").then((m) => m.openGradingPanel());
    },
  });


  reg("insert.part", { label: "Part", run: () => insertObject("Part") });
  reg("insert.sphere", { label: "Sphere", run: () => insertObject("Sphere") });
  reg("insert.cylinder", { label: "Cylinder", run: () => insertObject("Cylinder") });
  reg("insert.wedge", { label: "Wedge", run: () => insertObject("Wedge") });
  reg("insert.model", { label: "Model", run: () => insertObject("Model") });
  reg("insert.spawnlocation", { label: "SpawnLocation", run: () => insertObject("SpawnLocation") });
  reg("insert.truss", { label: "Truss", run: () => insertObject("TrussPart") });
  reg("insert.folder", { label: "Folder", run: () => insertObject("Folder") });
  reg("insert.script", { label: "Script", run: () => insertAnyClass("Script", selection.get()[0] || getWorkspaceRoot()) });

  reg("insert.tool", { label: "Tool", run: () => insertAnyClass("Tool", selection.get()[0] || getWorkspaceRoot()) });
  reg("insert.seat", { label: "Seat", run: () => insertObject("Seat") });
  reg("insert.vehicleseat", { label: "VehicleSeat", run: () => insertObject("VehicleSeat") });
  reg("insert.clickdetector", { label: "ClickDetector", run: () => insertAnyClass("ClickDetector", selection.get()[0] || getWorkspaceRoot()) });
  reg("insert.proximityprompt", { label: "ProximityPrompt", run: () => insertAnyClass("ProximityPrompt", selection.get()[0] || getWorkspaceRoot()) });


  reg("format.group", { label: "Group", enabled: () => canGroup(), run: () => groupSelection() });
  reg("format.ungroup", { label: "Ungroup", enabled: () => canUngroup(), run: () => ungroupSelection() });
  reg("format.lock", { label: "Lock", enabled: () => canLock(), run: () => toggleLockSelection() });
  reg("format.anchor", { label: "Anchor", enabled: () => canToggleAnchored(), checked: () => getAnchoredActive(), run: () => toggleAnchored() });
  reg("format.alignLeft", { label: "Align Left", enabled: () => canAlign(), run: () => alignLeft() });
  reg("format.alignCenterH", { label: "Align Center", enabled: () => canAlign(), run: () => alignCenterH() });
  reg("format.alignRight", { label: "Align Right", enabled: () => canAlign(), run: () => alignRight() });
  reg("format.alignTop", { label: "Align Top", enabled: () => canAlign(), run: () => alignTop() });
  reg("format.alignMiddle", { label: "Align Middle", enabled: () => canAlign(), run: () => alignMiddle() });
  reg("format.alignBottom", { label: "Align Bottom", enabled: () => canAlign(), run: () => alignBottom() });


  reg("test.play", { label: "Play", shortcut: "F5", enabled: () => !engine.isRunning(), run: () => engine.play() });
  reg("test.run", { label: "Run", shortcut: "F8", enabled: () => !engine.isRunning(), run: () => engine.run() });
  reg("test.stop", { label: "Stop", shortcut: "Shift+F5", enabled: () => engine.isRunning(), run: () => engine.stop() });

  reg("test.pause", { label: "Pause", shortcut: "F7", enabled: () => engine.isRunning(), run: () => engine.togglePause() });


  reg("help.about", { label: "About Roblox Studio Web", run: () => openAboutDialog() });
  reg("help.whatsNew", { label: "What's New", run: () => openWhatsNewPanel() });
  reg("help.apiReference", { label: "API Reference", run: () => focusApiSearch() });
  reg("help.shortcuts", { label: "Keyboard Shortcuts\u2026", run: () => openStudioSettings("shortcuts") });
  reg("help.studioSettings", { label: "Studio Settings\u2026", run: () => openStudioSettings() });
  reg("help.reportBug", { label: "Report a Bug\u2026", run: () => openReportBugDialog() });
  reg("help.tour", { label: "Welcome Tour", run: () => startWelcomeTour() });
  reg("help.checkUpdates", { label: "Check for Updates", run: () => openCheckForUpdates() });


  commandRegistry.setBlocker(() => isModalOpen());
  void target;                                                                     

  logger.info("Menu actions registradas.", { source: "Studio" });
}

function doSaveAs() {

  import("./modal.js").then(({ openPrompt }) => {
    openPrompt({
      title: "Save As",
      label: "Nome do lugar",
      value: project.getName(),
      okLabel: "Save",
      maxLength: 200,
      sanitize: (v) => sanitizeName(v),
      validate: (v) => (v ? "" : "Informe um nome válido."),
    }).then((name) => {
      if (name) project.saveAs(name);
    });
  });
}
