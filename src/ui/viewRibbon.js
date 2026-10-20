import { store, RENDER_MODES, AXES_SPACES, GRID_COLORS, GRID_CELL_SIZES } from "../core/state.js";
import { bus } from "../core/eventBus.js";
import { logger } from "../core/logger.js";
import { settings } from "../config/settings.js";
import { createIcon } from "./icons.js";
import { attachTooltip } from "./tooltip.js";
import { openContextMenu } from "./contextMenu.js";
import { openConfirm, openPrompt } from "./modal.js";
import { isToolboxVisible } from "./toolbox.js";
import { isAssetManagerVisible } from "./assetManager.js";
import { isTaskSchedulerVisible } from "./taskScheduler.js";
import { isDataStoreViewerVisible } from "./dataStoreViewer.js";            
import * as teamCreate from "../collab/teamCreate.js";            
import { toggleTeamCreatePanel, isTeamCreatePanelOpen } from "./teamCreatePanel.js";            
import { toggleDraftsPanel, isDraftsPanelOpen } from "./draftsPanel.js";            
import { toggleActivityLogPanel, isActivityLogPanelOpen } from "./activityLogPanel.js";            
import { isLocalizationEditorVisible } from "./localizationEditor.js";            
import { toggleStreamingStats, isStreamingStatsVisible } from "./streamingStats.js";            
import { getActiveDebuggerSection } from "./debuggerPanel.js";
import {
  listSavedLayouts,
  saveCurrentLayout,
  restoreSavedLayout,
  resetToDefaultLayout,
  sanitizeLayoutName,
  MAX_SAVED_LAYOUTS,
  MAX_LAYOUT_NAME,
} from "./layouts.js";

const CLICK_COOLDOWN = 120;

const RENDER_MODE_LABELS = {
  default: "Default",
  wireframe: "Wireframe",
  detail: "Detail",
  shadowmap: "ShadowMap",
  albedo: "Albedo",
  normals: "Normals",
  roughness: "Roughness",
};
const GRID_COLOR_LABELS = { default: "Cinza (padr\u00e3o)", blue: "Azul", green: "Verde", amber: "\u00c2mbar" };
const AXES_LABELS = { world: "World Space", local: "Local Space", lastObject: "Last Object" };

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function safe(fn) {
  try { return fn(); } catch (err) {
    logger.warn("View ribbon: " + ((err && err.message) || err));
    return undefined;
  }
}

function view(key) {
  return store.getViewOption(key);
}

function setView(key, value) {
  store.setViewOption(key, value);
}

function panels() {
  return store.getState().layout.panels;
}

function togglePanel(name) {
  const p = panels();
  store.setLayout({ panels: { [name]: !p[name] } });
}


function toggleDebugSection(sectionId) {
  const p = panels();
  const activeSection = safe(getActiveDebuggerSection);
  if (p.debugger && activeSection === sectionId) {
    store.setLayout({ panels: { debugger: false } });
    return;
  }
  if (!p.debugger) store.setLayout({ panels: { debugger: true } });
  bus.emit("debugger:showSection", { id: sectionId });
}

function isDebugSectionActive(sectionId) {
  return !!panels().debugger && safe(getActiveDebuggerSection) === sectionId;
}

export function buildRibbonView() {
  const root = el("div", "rsw-ribbon rsw-ribbon--view");
  const disposers = [];
  const buttons = [];                  
  let lastClick = 0;

  function buildButton(entry) {
    const btn = el("button", "rsw-rtool rsw-rtool--" + (entry.size || "small"));
    btn.type = "button";
    const icon = el("span", "rsw-rtool__icon");
    icon.appendChild(createIcon(entry.icon, entry.size === "large" ? 26 : 16));
    const label = el("span", "rsw-rtool__label", entry.label);
    btn.append(icon, label);
    if (entry.options) {
      const arrow = el("span", "rsw-rtool__arrow", "\u25be");
      arrow.dataset.rbArrow = "1";
      btn.appendChild(arrow);
      btn.classList.add("rsw-rtool--hasdrop");
    }
    if (entry.desc) {
      const descText = typeof entry.desc === "function" ? safe(entry.desc) : entry.desc;
      disposers.push(attachTooltip(btn, { title: entry.label, desc: descText || "" }));
    }
    btn.addEventListener("click", (e) => {
      const t = Date.now();
      if (t - lastClick < CLICK_COOLDOWN) return;
      lastClick = t;
      if (entry.options) {
        const items = safe(() => (typeof entry.options === "function" ? entry.options() : entry.options)) || [];
        if (items.length) {
          const rect = btn.getBoundingClientRect();
          openContextMenu({
            x: Math.round(rect.left),
            y: Math.round(rect.bottom + 2),
            items: items.map((o) => ({
              label: (o.checked ? "\u2713 " : "\u2007\u2007 ") + o.label,
              onSelect: () => { safe(o.run); refresh(); },
            })),
          });
        }
      } else if (entry.onRun) {
        safe(entry.onRun);
      }
      refresh();
    });
    buttons.push({ btn, entry });
    return btn;
  }

  function buildGroup(title, entries) {
    const group = el("div", "rsw-rgroup");
    const tools = el("div", "rsw-rgroup__tools");
    for (const entry of entries) tools.appendChild(buildButton(entry));
    group.appendChild(tools);
    group.appendChild(el("div", "rsw-rgroup__title", title));
    return group;
  }


  const showEntries = [
    { label: "Explorer", icon: "layers", size: "large", desc: "Mostra/oculta o painel Explorer.", onRun: () => togglePanel("explorer"), getActive: () => !!panels().explorer },
    { label: "Properties", icon: "settings", size: "large", desc: "Mostra/oculta o painel Properties.", onRun: () => togglePanel("properties"), getActive: () => !!panels().properties },
    { label: "Output", icon: "text", size: "small", desc: "Mostra/oculta o painel Output.", onRun: () => togglePanel("output"), getActive: () => !!panels().output },
    { label: "Assistant", icon: "assistant", size: "small", desc: "Mostra/oculta o painel Assistant (IA integrada). Atalho: Ctrl+I.", onRun: () => togglePanel("assistant"), getActive: () => !!panels().assistant },
    { label: "Toolbox", icon: "part", size: "small", desc: "Mostra/oculta o Toolbox.", onRun: () => bus.emit("toolbox:toggle"), getActive: () => safe(isToolboxVisible) === true },
    { label: "Asset Manager", icon: "folder", size: "small", desc: "Mostra/oculta o Asset Manager.", onRun: () => bus.emit("assetmanager:toggle"), getActive: () => safe(isAssetManagerVisible) === true },
    { label: "Command Bar", icon: "command", size: "small", desc: "Mostra/oculta a Command Bar.", onRun: () => store.set("commandBarVisible", !store.getState().commandBarVisible), getActive: () => !!store.getState().commandBarVisible },
    { label: "Script Analysis", icon: "bug", size: "small", desc: "Mostra/oculta o painel Script Analysis.", onRun: () => togglePanel("analysis"), getActive: () => !!panels().analysis },
    { label: "Call Stack", icon: "script", size: "small", desc: "Abre o Debugger na se\u00e7\u00e3o Call Stack.", onRun: () => toggleDebugSection("callstack"), getActive: () => isDebugSectionActive("callstack") },
    { label: "Watch", icon: "eye", size: "small", desc: "Abre o Debugger na se\u00e7\u00e3o Watch.", onRun: () => toggleDebugSection("watch"), getActive: () => isDebugSectionActive("watch") },
    { label: "Breakpoints", icon: "bug", size: "small", desc: "Abre o Debugger na se\u00e7\u00e3o Breakpoints.", onRun: () => toggleDebugSection("breakpoints"), getActive: () => isDebugSectionActive("breakpoints") },
    { label: "Find Results", icon: "find", size: "small", desc: "Mostra/oculta o painel Find Results (Find All).", onRun: () => { const willShow = !panels().find; togglePanel("find"); if (willShow) setTimeout(() => bus.emit("find:focus"), 0); }, getActive: () => !!panels().find },
    { label: "Task Scheduler", icon: "run", size: "small", desc: "Mostra/oculta a janela Task Scheduler (somente leitura).", onRun: () => bus.emit("taskscheduler:toggle"), getActive: () => safe(isTaskSchedulerVisible) === true },
    { label: "DataStore Viewer", icon: "folder", size: "small", desc: "Mostra/oculta o DataStore Viewer (inspecionar e editar dados persistidos).", onRun: () => bus.emit("datastoreviewer:toggle"), getActive: () => safe(isDataStoreViewerVisible) === true },
    { label: "Creator Dashboard", icon: "workspace", size: "large", desc: "Abre o Creator Dashboard (Universes, Places, API Keys e Cloud Assets). Parte 67.", onRun: () => { import("./creatorDashboard.js").then((m) => m.openCreatorDashboard()).catch(() => {}); } },
    { label: "Localization", icon: "localization", size: "small", desc: "Mostra/oculta o Localization Editor (tabela de tradu\u00e7\u00f5es).", onRun: () => bus.emit("localizationeditor:toggle"), getActive: () => safe(isLocalizationEditorVisible) === true },
    { label: "Team Create", icon: "collab", size: "large", desc: "Mostra/oculta o painel Team Create (colaboradores simulados).", onRun: () => toggleTeamCreatePanel(), getActive: () => safe(isTeamCreatePanelOpen) === true },
    { label: "Drafts", icon: "script", size: "small", desc: "Mostra/oculta o painel Drafts (rascunhos de scripts do Team Create).", onRun: () => toggleDraftsPanel(), getActive: () => safe(isDraftsPanelOpen) === true },
    { label: "Activity Log", icon: "text", size: "small", desc: "Mostra/oculta o Activity Log (hist\u00f3rico de a\u00e7\u00f5es dos colaboradores).", onRun: () => toggleActivityLogPanel(), getActive: () => safe(isActivityLogPanelOpen) === true },
    { label: "Streaming Debug", icon: "progressbar", size: "small", desc: "Painel com m\u00e9tricas do streaming do Workspace por cliente (inst\u00e2ncias carregadas, chunks, mem\u00f3ria, filas, LOD). Parte 66.", onRun: () => safe(toggleStreamingStats), getActive: () => safe(isStreamingStatsVisible) === true },
  ];


  const viewportEntries = [
    {
      label: "Render Mode", icon: "material", size: "large",
      desc: "Modo de renderiza\u00e7\u00e3o do Viewport (Default, Wireframe, Detail, ShadowMap, Albedo, Normals, Roughness).",
      options: () => RENDER_MODES.map((m) => ({ label: RENDER_MODE_LABELS[m] || m, checked: view("renderMode") === m, run: () => setView("renderMode", m) })),
      getActive: () => view("renderMode") !== "default",
    },
    { label: "Show Grid", icon: "uigrid", size: "small", desc: "Mostra/oculta o grid do ch\u00e3o.", onRun: () => settings.set("gridVisible", settings.get("gridVisible") === false), getActive: () => settings.get("gridVisible") !== false },
    {
      label: "Grid Style", icon: "paint", size: "small",
      desc: "Cor e tamanho da c\u00e9lula do grid do ch\u00e3o.",
      options: () => [
        ...GRID_COLORS.map((c) => ({ label: "Cor: " + (GRID_COLOR_LABELS[c] || c), checked: view("gridColor") === c, run: () => setView("gridColor", c) })),
        ...GRID_CELL_SIZES.map((s) => ({ label: "C\u00e9lula: " + s + " studs", checked: view("gridCellSize") === s, run: () => setView("gridCellSize", s) })),
      ],
    },
    { label: "Gizmos", icon: "transform", size: "small", desc: "Mostra/oculta gizmos auxiliares (c\u00e2mera, spawns, constraints).", onRun: () => setView("showGizmos", !view("showGizmos")), getActive: () => !!view("showGizmos") },
    { label: "Show Pathfinding Paths", icon: "pathservice", size: "small", desc: "Desenha paths ativos, waypoints, PathfindingLinks e PathfindingModifiers no Viewport durante o Playtest.", onRun: () => setView("showPathfinding", !view("showPathfinding")), getActive: () => !!view("showPathfinding") },
    { label: "Show Dynamic Obstacles", icon: "object", size: "small", desc: "Desenha as caixas dos obst\u00e1culos din\u00e2micos do navmesh (amarelo; mais intenso quando em movimento), os waypoints bloqueados em vermelho e um pulso curto quando um caminho \u00e9 replanejado. Parte 135.", onRun: () => setView("showDynamicObstacles", !view("showDynamicObstacles")), getActive: () => !!view("showDynamicObstacles") },
    { label: "Show Raycasts", icon: "find", size: "small", desc: "Desenha os Workspace:Raycast() recentes (verde = acerto, vermelho = sem acerto) no Viewport.", onRun: () => setView("showRaycastDebug", !view("showRaycastDebug")), getActive: () => !!view("showRaycastDebug") },
    { label: "Show Overlap Volumes", icon: "object", size: "small", desc: "Desenha os volumes de GetPartBoundsInBox/Radius e GetPartsInPart no Viewport.", onRun: () => setView("showOverlapDebug", !view("showOverlapDebug")), getActive: () => !!view("showOverlapDebug") },
    { label: "Show Shapecasts", icon: "transform", size: "small", desc: "Desenha os Blockcast/Spherecast/Shapecast recentes (trajeto + forma) no Viewport.", onRun: () => setView("showShapecastDebug", !view("showShapecastDebug")), getActive: () => !!view("showShapecastDebug") },
    { label: "Show Query Hits", icon: "selectionbox", size: "small", desc: "Marca com esferas os pontos e partes retornados pelas queries espaciais.", onRun: () => setView("showQueryHits", !view("showQueryHits")), getActive: () => !!view("showQueryHits") },

    { label: "Show Streaming Bounds", icon: "object", size: "small", desc: "Esferas do StreamingMinRadius (azul) e StreamingTargetRadius (roxo) ao redor do foco de replica\u00e7\u00e3o do cliente ativo.", onRun: () => setView("showStreamingBounds", !view("showStreamingBounds")), getActive: () => !!view("showStreamingBounds") },
    { label: "Show Streamed Chunks", icon: "uigrid", size: "small", desc: "Chunks de terrain (32\u00b3 voxels) em wireframe: verde = carregado, vermelho = descarregado para o cliente ativo.", onRun: () => setView("showStreamedChunks", !view("showStreamedChunks")), getActive: () => !!view("showStreamedChunks") },
    { label: "Show Replication Focus", icon: "cursor", size: "small", desc: "Marcador vermelho sobre o ReplicationFocus do cliente ativo.", onRun: () => setView("showReplicationFocus", !view("showReplicationFocus")), getActive: () => !!view("showReplicationFocus") },
    { label: "Show LOD Levels", icon: "material", size: "small", desc: "Marca as parts carregadas com a cor do tier de LOD (verde = Near, amarelo = Mid, laranja = Far).", onRun: () => setView("showLODLevels", !view("showLODLevels")), getActive: () => !!view("showLODLevels") },
    { label: "Selection Boxes", icon: "selectionbox", size: "small", desc: "Caixa azul ao redor dos objetos selecionados.", onRun: () => setView("showSelectionBoxes", !view("showSelectionBoxes")), getActive: () => !!view("showSelectionBoxes") },
    { label: "Bounding Boxes", icon: "object", size: "small", desc: "Caixa cinza-claro ao redor de todas as partes.", onRun: () => setView("showBoundingBoxes", !view("showBoundingBoxes")), getActive: () => !!view("showBoundingBoxes") },
    { label: "Hover Highlight", icon: "cursor", size: "small", desc: "Real\u00e7a o objeto sob o cursor.", onRun: () => setView("showHoverHighlight", !view("showHoverHighlight")), getActive: () => !!view("showHoverHighlight") },
    { label: "Guides", icon: "ruler", size: "small", desc: "R\u00e9guas e guias do UI Editor.", onRun: () => setView("showGuides", !view("showGuides")), getActive: () => !!view("showGuides") },
    { label: "Perf Stats", icon: "progressbar", size: "small", desc: "Overlay de estat\u00edsticas de performance (FPS, draw calls, mem\u00f3ria).", onRun: () => setView("perfStats", !view("perfStats")), getActive: () => !!view("perfStats") },
    { label: "Explorer Focus", icon: "filter", size: "small", desc: "Rola o Explorer automaticamente at\u00e9 o objeto selecionado no Viewport.", onRun: () => setView("explorerFocus", !view("explorerFocus")), getActive: () => !!view("explorerFocus") },
  ];


  const axesEntries = AXES_SPACES.map((space) => ({
    label: AXES_LABELS[space] || space,
    icon: space === "world" ? "workspace" : space === "local" ? "object" : "instance",
    size: "small",
    desc: "Espa\u00e7o de refer\u00eancia dos gizmos de transforma\u00e7\u00e3o: " + (AXES_LABELS[space] || space) + ".",
    onRun: () => setView("axesSpace", space),
    getActive: () => view("axesSpace") === space,
  }));


  async function saveLayoutFlow() {
    const name = await openPrompt({
      title: "Save Layout",
      label: `Nome do layout (m\u00e1x. ${MAX_LAYOUT_NAME} caracteres)`,
      placeholder: "Meu layout",
      maxLength: MAX_LAYOUT_NAME,
      sanitize: sanitizeLayoutName,
      validate: (v) => (!v ? "Digite um nome v\u00e1lido." : null),
      okLabel: "Salvar",
      cancelLabel: "Cancelar",
    });
    if (name == null) return;
    let res = saveCurrentLayout(name);
    if (!res.ok && res.reason === "exists") {
      const over = await openConfirm({
        title: "Sobrescrever layout?",
        message: `J\u00e1 existe um layout chamado "${name}". Deseja sobrescrev\u00ea-lo?`,
        buttons: [
          { label: "Cancelar", value: false, kind: "ghost" },
          { label: "Sobrescrever", value: true, kind: "primary" },
        ],
      });
      if (over !== true) return;
      res = saveCurrentLayout(name, { overwrite: true });
    }
    if (!res.ok && res.reason === "full") {
      await openConfirm({
        title: "Limite atingido",
        message: `M\u00e1ximo de ${MAX_SAVED_LAYOUTS} layouts salvos. Exclua ou sobrescreva um existente.`,
        buttons: [{ label: "OK", value: true, kind: "primary" }],
      });
    }
  }

  async function resetLayoutFlow() {
    const ok = await openConfirm({
      title: "Reset Layout",
      message: "Restaurar o layout padr\u00e3o do Studio? Pain\u00e9is abertos ser\u00e3o reorganizados.",
      buttons: [
        { label: "Cancelar", value: false, kind: "ghost" },
        { label: "Resetar", value: true, kind: "primary" },
      ],
    });
    if (ok === true) resetToDefaultLayout();
  }

  const layoutEntries = [
    {
      label: "Restore Layout", icon: "ui", size: "large",
      desc: "Aplica um layout salvo (ou o padr\u00e3o do Studio).",
      options: () => [
        { label: "Default", run: () => resetToDefaultLayout() },
        ...listSavedLayouts().map((e) => ({ label: e.name, run: () => restoreSavedLayout(e.name) })),
      ],
    },
    { label: "Save Layout", icon: "create", size: "small", desc: `Salva o layout atual dos pain\u00e9is (m\u00e1x. ${MAX_SAVED_LAYOUTS}).`, onRun: () => { saveLayoutFlow(); } },
    { label: "Reset Layout", icon: "undo", size: "small", desc: "Restaura o layout padr\u00e3o do Studio (com confirma\u00e7\u00e3o).", onRun: () => { resetLayoutFlow(); } },
  ];

  root.appendChild(buildGroup("Show", showEntries));
  root.appendChild(el("div", "rsw-rsep"));
  root.appendChild(buildGroup("Viewport", viewportEntries));
  root.appendChild(el("div", "rsw-rsep"));
  root.appendChild(buildGroup("Axes", axesEntries));
  root.appendChild(el("div", "rsw-rsep"));
  root.appendChild(buildGroup("Layouts", layoutEntries));

  function refresh() {
    for (const { btn, entry } of buttons) {
      if (entry.getActive) {
        const on = safe(entry.getActive) === true;
        btn.classList.toggle("rsw-rtool--active", on);
        btn.setAttribute("aria-pressed", on ? "true" : "false");
      }
      if (entry.getEnabled) {
        const en = safe(entry.getEnabled) !== false;
        btn.classList.toggle("rsw-rtool--disabled", !en);
        btn.setAttribute("aria-disabled", en ? "false" : "true");
      }
    }
  }


  disposers.push(store.subscribe((_st, change) => {
    if (!change) return;
    if (change.key === "layout" || change.key === "viewOptions" || change.key === "commandBarVisible") refresh();
  }));
  disposers.push(bus.on("settings:changed", (p) => { if (p && p.key === "gridVisible") refresh(); }));
  disposers.push(bus.on("taskscheduler:visibilityChanged", refresh));
  disposers.push(bus.on("toolbox:visibilityChanged", refresh));
  disposers.push(bus.on("assetmanager:visibilityChanged", refresh));
  disposers.push(bus.on("debugger:sectionChanged", refresh));
  disposers.push(bus.on("layouts:changed", refresh));

  refresh();

  function destroy() {
    for (const d of disposers) { if (typeof d === "function") safe(d); }
  }

  return { el: root, refresh, destroy };
}
