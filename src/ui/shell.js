import { store, REGIONS, TABS } from "../core/state.js";
import { theme } from "../theme/theme.js";
import { bus } from "../core/eventBus.js";
import { logger } from "../core/logger.js";
import { openContextMenu } from "./contextMenu.js";            
import { availableLocales, getTestLocale, setTestLocale } from "../runtime/localization.js";            
import { createIcon } from "./icons.js";
import { buildWorkspace } from "./workspace.js";
import { initDockWidgetHost } from "../plugins/dockWidgets.js";            
import { buildExplorer } from "./explorer.js";
import { buildProperties } from "./properties.js";
import { buildViewport } from "../viewport/viewport.js";
import { tools as toolManager } from "../viewport/tools.js";
import {
  insertObject,
  cloneSelection,
  deleteSelection,
  duplicateSelection,
} from "../viewport/objectOps.js";
import { buildRibbonHome, buildRibbonModel } from "./ribbon.js";
import { initKeybindings } from "../core/keybindings.js";
import { registerDefaultShortcuts } from "./shortcuts.js";
import { registerFocusArea, initFocusManager } from "../core/focusManager.js";
import { buildRibbonAvatar } from "./avatarRibbon.js";
import { buildRibbonUI } from "./uiRibbon.js";
import { buildRibbonScript } from "./scriptRibbon.js";
import { buildRibbonTerrain } from "./terrainRibbon.js";
import { buildRibbonPlugins } from "./pluginsRibbon.js";
import { buildRibbonView } from "./viewRibbon.js";            
import { buildRibbonTest } from "./testRibbon.js";
import { initClientGrid } from "./clientGrid.js";
import { initDevConsole } from "./devConsole.js";            
import * as teamCreate from "../collab/teamCreate.js";            
import * as drafts from "../collab/drafts.js";            
import { initCollabRender } from "../collab/collabRender.js";            
import { persistence } from "../persistence/persistence.js";            
import { buildFindResults } from "./findResults.js";            
import { buildAssistantPanel } from "./assistantPanel.js";            
import { getCodeAssistStatus, isCodeAssistEnabled } from "../ai/codeAssist.js";            
import { buildApiBrowserPanel } from "./apiBrowser.js";            
import { initNotificationCenter, registerNotificationBadge, toggleNotificationCenter } from "./notificationCenter.js";            
import { initStatusBarExtra } from "./statusBarExtra.js";            
import { openWhatsNewPanel } from "./whatsNewPanel.js";            


import { initTaskScheduler } from "./taskScheduler.js";            
import { initDataStoreViewer } from "./dataStoreViewer.js";            
import { mountTerrainPanel } from "./terrainPanel.js";
import { buildOutput } from "./output.js";
import { buildScriptAnalysis } from "./scriptAnalysis.js";            
import { buildDebuggerPanel } from "./debuggerPanel.js";            
import { buildCommandBar } from "./commandBar.js";
import { wirePivotEditShortcuts } from "../viewport/pivotEditor.js";
import { buildScriptEditor } from "../editor/scriptEditor.js";
import { engine, RuntimeEvents } from "../runtime/engine.js";
import { buildMenuBar } from "./menuBar.js";
import { initMenuActions } from "./menuActions.js";
import { project } from "../core/project.js";
import { yieldToBrowserPaint } from "../boot/browserPaint.js";


const AREA = {
  topBar: "topbar",
  subBar: "mezzanine",
  toolStrip: "toolbar",
  workspace: "workspace",
  statusBar: "status",
};
const LABEL = {
  topBar: "Barra superior",
  subBar: "Mezzanine",
  toolStrip: "Barra de ferramentas",
  workspace: "Área de trabalho",
  statusBar: "Barra de status",
};

const TAB_LABELS = {
  home: "Home",
  model: "Model",
  terrain: "Terrain",
  avatar: "Avatar",
  ui: "UI",
  script: "Script",
  test: "Test",
  view: "View",            
  plugins: "Plugins",
};


const AXES_LABELS = {
  world: "World",
  local: "Local",
  lastObject: "Last Object",
};


const ICON_TO_TOOL = Object.freeze({
  cursor: "select",
  move: "move",
  rotate: "rotate",
  scale: "scale",
});


const INSERT_BY_LABEL = Object.freeze({
  "Parte": "Part",
  "Esfera": "Sphere",
  "Cilindro": "Cylinder",
  "Cunha": "Wedge",
  "Modelo": "Model",
  "Pasta": "Folder",
});
const EDIT_BY_LABEL = Object.freeze({
  "Clonar": "clone",
  "Duplicar": "duplicate",
  "Excluir": "delete",
});


const UTILITIES = [
  ["collab", "Colaboração"],
  ["share", "Compartilhar"],
  ["assistant", "Assistant"],
  ["bell", "Notificações"],
  ["account", "Conta"],
];


const TOOLBAR = {
  home: [
    { title: "Seleção", tools: [["cursor", "Selecionar"], ["move", "Mover"], ["rotate", "Girar"], ["scale", "Escalar"]] },
    { title: "Inserir", tools: [["part", "Parte"], ["part", "Esfera"], ["part", "Cilindro"], ["part", "Cunha"], ["model", "Modelo"], ["folder", "Pasta"]] },
    { title: "Edição", tools: [["duplicate", "Clonar"], ["duplicate", "Duplicar"], ["trash", "Excluir"], ["lock", "Travar"]] },
    { title: "Aparência", tools: [["material", "Material"], ["paint", "Cor"], ["texture", "Textura"]] },
    { title: "Organização", tools: [["group", "Agrupar"], ["ungroup", "Desagrupar"], ["layers", "Camadas"]] },
  ],
  model: [
    { title: "Seleção", tools: [["cursor", "Selecionar"], ["move", "Mover"], ["rotate", "Girar"], ["scale", "Escalar"]] },
    { title: "Geometria", tools: [["part", "Parte"], ["part", "Esfera"], ["part", "Cilindro"], ["part", "Cunha"]] },
    { title: "Restrições", tools: [["lock", "Âncora"], ["align", "Alinhar"]] },
    { title: "Organização", tools: [["group", "Agrupar"], ["ungroup", "Desagrupar"]] },
  ],
  avatar: [
    { title: "Rigging", tools: [["model", "Esqueleto"], ["move", "Juntas"]] },
    { title: "Acessórios", tools: [["part", "Acessório"], ["texture", "Roupas"]] },
    { title: "Animação", tools: [["run", "Pose"], ["effect", "Editor"]] },
  ],
  ui: [
    { title: "Inserir", tools: [["part", "Quadro"], ["text", "Texto"], ["model", "Botão"]] },
    { title: "Layout", tools: [["layers", "Lista"], ["align", "Grade"]] },
    { title: "Alinhamento", tools: [["align", "Alinhar"], ["move", "Posição"]] },
  ],
  script: [
    { title: "Editar", tools: [["text", "Script"], ["duplicate", "Módulo"]] },
    { title: "Executar", tools: [["run", "Rodar"], ["bug", "Depurar"]] },
    { title: "Localizar", tools: [["find", "Buscar"], ["align", "Ir para"]] },
  ],
  plugins: [
    { title: "Gerenciar", tools: [["plugin", "Plugins"], ["find", "Procurar"]] },
    { title: "Criar", tools: [["model", "Novo"], ["duplicate", "Empacotar"]] },
  ],
};

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}


function iconButton({ cls, icon, label, action = "noop", title, disabled = false, withLabel = false }) {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = cls;
  if (action) btn.dataset.action = action;
  if (title) {
    btn.setAttribute("title", title);
    btn.setAttribute("aria-label", title);
  }
  if (disabled) btn.disabled = true;
  if (icon) btn.appendChild(createIcon(icon, withLabel ? 18 : 16));
  if (withLabel && label) {
    const span = el("span", "rsw-tool__label");
    span.textContent = label;                     
    btn.appendChild(span);
  }
  return btn;
}

function buildTitleBar(region) {
  const bar = el("div", "rsw-titlebar");

  const left = el("div", "rsw-titlebar__left");
  const appIcon = el("span", "rsw-app-icon");
  appIcon.appendChild(createIcon("logo", 16));
  const appName = el("span", "rsw-app-name");
  appName.textContent = "Roblox Studio Web";
  left.append(appIcon, appName);

  const center = el("div", "rsw-titlebar__center");
  const title = el("span", "rsw-title");
  title.textContent = "Untitled Place";
  title.setAttribute("title", "Untitled Place");
  center.appendChild(title);

  const right = el("div", "rsw-titlebar__right");

  const giftBtn = iconButton({ cls: "rsw-util", icon: "gift", title: "What's New", action: "whatsnew" });
  const giftBadge = el("span", "rsw-badge is-hidden");
  giftBtn.appendChild(giftBadge);
  const renderGiftBadge = (unseenCount) => {
    giftBadge.textContent = unseenCount > 99 ? "99+" : String(unseenCount);
    giftBadge.classList.toggle("is-hidden", unseenCount === 0);
  };


  const updateGiftBadge = () => {
    import("../help/changelog.js")
      .then((changelog) => changelog.getUnseenCount())
      .then(renderGiftBadge)
      .catch(() => renderGiftBadge(0));
  };
  updateGiftBadge();
  bus.on("whatsnew:seen", updateGiftBadge);
  const bellBtn = iconButton({ cls: "rsw-util", icon: "bell", title: "Notifica\u00e7\u00f5es", action: "notif-center" });
  const bellBadge = el("span", "rsw-badge is-hidden");
  bellBtn.appendChild(bellBadge);
  registerNotificationBadge(bellBadge);
  right.append(
    giftBtn,
    bellBtn,
    iconButton({ cls: "rsw-winctl", icon: "minimize", title: "Minimizar" }),
    iconButton({ cls: "rsw-winctl", icon: "maximize", title: "Maximizar" }),
    iconButton({ cls: "rsw-winctl rsw-winctl--close", icon: "close", title: "Fechar" }),
  );

  bar.append(left, center, right);
  region.appendChild(bar);
  return { title };
}

function buildMezzanine(region) {
  const mezz = el("div", "rsw-mezzanine");


  const left = el("div", "rsw-mezz-zone rsw-mezz-zone--left");
  const runChip = el("div", "rsw-runchip");
  const playBtn = iconButton({ cls: "rsw-run-btn rsw-run-btn--play", icon: "play", action: "run-play", title: "Play (F5) \u2014 Run com F8" });
  const stopBtn = iconButton({ cls: "rsw-run-btn rsw-run-btn--stop", icon: "stop", action: "run-stop", title: "Stop (Shift+F5)", disabled: true });


  const pauseBtn = iconButton({ cls: "rsw-run-btn rsw-run-btn--pause", icon: "pause", action: "run-pause", title: "Pause (F7)", disabled: true });
  runChip.append(playBtn, pauseBtn, stopBtn);
  left.appendChild(runChip);
  const ptBadge = el("span", "rsw-playtest-badge");
  ptBadge.textContent = "PLAYTEST";
  ptBadge.hidden = true;
  left.appendChild(ptBadge);


  const center = el("div", "rsw-mezz-zone rsw-mezz-zone--center");
  const tablist = el("div", "rsw-tabs");
  tablist.setAttribute("role", "tablist");
  const tabButtons = [];
  for (const id of TABS) {
    const tab = document.createElement("button");
    tab.type = "button";
    tab.className = "rsw-tab";
    tab.setAttribute("role", "tab");
    tab.dataset.tab = id;
    tab.textContent = TAB_LABELS[id] || id;                     
    tablist.appendChild(tab);
    tabButtons.push(tab);
  }
  center.appendChild(tablist);


  const right = el("div", "rsw-mezz-zone rsw-mezz-zone--right");
  const utils = el("div", "rsw-utilities");
  for (const [icon, title] of UTILITIES) {
    const action = icon === "assistant" ? "toggle-assistant" : icon === "bell" ? "notif-center" : "noop";               
    utils.appendChild(iconButton({ cls: "rsw-util", icon, title, action }));
  }
  utils.appendChild(el("span", "rsw-util-sep"));
  const themeToggle = iconButton({
    cls: "rsw-util rsw-util--theme",
    icon: "moon",
    action: "toggle-theme",
    title: "Alternar tema",
  });
  utils.appendChild(themeToggle);
  right.appendChild(utils);

  mezz.append(left, center, right);
  region.appendChild(mezz);
  return { tabButtons, themeToggle, playBtn, stopBtn, pauseBtn, ptBadge };            
}

function buildToolbar(region) {
  const toolbar = el("div", "rsw-toolbar");
  const groups = el("div", "rsw-toolbar__groups");
  groups.dataset.toolbarGroups = "";
  toolbar.appendChild(groups);
  region.appendChild(toolbar);
  return groups;
}



function renderToolbar(tabId, container, ribbonHome, ribbonModel, ribbonAvatar, ribbonUI, ribbonScript, ribbonTerrain, ribbonPlugins, ribbonView, ribbonTest) {
  if (tabId === "test" && ribbonTest) {
    container.replaceChildren(ribbonTest.el);
    ribbonTest.refresh();
    return;
  }
  if (tabId === "view" && ribbonView) {
    container.replaceChildren(ribbonView.el);
    ribbonView.refresh();
    return;
  }
  if (tabId === "home" && ribbonHome) {
    container.replaceChildren(ribbonHome.el);
    ribbonHome.refresh();
    return;
  }
  if (tabId === "model" && ribbonModel) {
    container.replaceChildren(ribbonModel.el);
    ribbonModel.refresh();
    return;
  }
  if (tabId === "terrain" && ribbonTerrain) {
    container.replaceChildren(ribbonTerrain.el);
    ribbonTerrain.refresh();
    return;
  }
  if (tabId === "avatar" && ribbonAvatar) {
    container.replaceChildren(ribbonAvatar.el);
    ribbonAvatar.refresh();
    return;
  }
  if (tabId === "ui" && ribbonUI) {
    container.replaceChildren(ribbonUI.el);
    ribbonUI.refresh();
    return;
  }
  if (tabId === "script" && ribbonScript) {
    container.replaceChildren(ribbonScript.el);
    ribbonScript.refresh();
    return;
  }
  if (tabId === "plugins" && ribbonPlugins) {
    container.replaceChildren(ribbonPlugins.el);
    ribbonPlugins.refresh();
    return;
  }
  const groups = TOOLBAR[tabId] || TOOLBAR.home;
  const built = [];
  for (const group of groups) {
    const gEl = el("div", "rsw-tgroup");
    const tools = el("div", "rsw-tgroup__tools");
    const isSelectionGroup = group.title === "Seleção";
    for (const [icon, label] of group.tools) {
      const btn = iconButton({ cls: "rsw-tool", icon, label, title: label, withLabel: true });
      const toolId = isSelectionGroup ? ICON_TO_TOOL[icon] : null;
      if (toolId) {
        btn.dataset.tool = toolId;
        btn.setAttribute("aria-pressed", toolManager.get() === toolId ? "true" : "false");
        btn.classList.toggle("rsw-tool--active", toolManager.get() === toolId);
      } else if (!isSelectionGroup && INSERT_BY_LABEL[label]) {
        btn.dataset.insert = INSERT_BY_LABEL[label];
      } else if (!isSelectionGroup && EDIT_BY_LABEL[label]) {
        btn.dataset.edit = EDIT_BY_LABEL[label];
      }
      tools.appendChild(btn);
    }
    const titleEl = el("div", "rsw-tgroup__title");
    titleEl.textContent = group.title;
    gEl.append(tools, titleEl);
    built.push(gEl);
  }
  container.replaceChildren(...built);
}

function buildStatusBar(region) {
  const bar = el("div", "rsw-statusbar");

  const leftSeg = el("div", "rsw-status__seg rsw-status__left");
  const msg = el("span", "rsw-status__msg");
  msg.textContent = "Pronto";
  leftSeg.appendChild(msg);

  const centerSeg = el("div", "rsw-status__seg rsw-status__center");

  const rightSeg = el("div", "rsw-status__seg rsw-status__right");

  const axesChip = el("span", "rsw-status__chip rsw-axes-indicator");
  axesChip.setAttribute("title", "Espaço dos eixos de transformação");
  axesChip.textContent = "Axes: World";
  const tabChip = el("span", "rsw-status__chip");
  tabChip.textContent = "Home";
  const zoomChip = el("span", "rsw-status__chip");
  zoomChip.textContent = "100%";
  const dot = el("span", "rsw-status__dot");
  dot.setAttribute("title", "Conectado");
  const localeChip = el("span", "rsw-status__chip rsw-locale-chip");
  localeChip.setAttribute("title", "Locale do jogador simulado (Playtest)");
  const updateLocaleChip = () => {
    localeChip.textContent = `Player Locale: ${getTestLocale()} \u25be`;
  };
  updateLocaleChip();
  localeChip.addEventListener("click", () => {
    const rect = localeChip.getBoundingClientRect();
    const ids = availableLocales(store.getDataModel());
    openContextMenu({
      x: Math.round(rect.left),
      y: Math.max(48, Math.round(rect.top - ids.length * 26 - 16)),
      items: ids.map((id) => ({
        label: `${getTestLocale() === id ? "\u2713 " : "\u2007\u2007 "}${id}`,
        onSelect: () => setTestLocale(id),
      })),
    });
  });
  bus.on("localization:testLocaleChanged", updateLocaleChip);

  const caChip = el("span", "rsw-status__chip rsw-ca-chip");
  caChip.setAttribute("title", "Code Assist (sugest\u00f5es de c\u00f3digo por IA)");
  const caDot = el("span", "rsw-ca-chip__dot");
  const caLabel = el("span", "rsw-ca-chip__label");
  caLabel.textContent = "Code Assist";
  caChip.append(caDot, caLabel);
  rightSeg.append(localeChip, caChip, axesChip, tabChip, zoomChip, dot);


  initStatusBarExtra({ leftSeg, centerSeg, rightSeg });

  bar.append(leftSeg, centerSeg, rightSeg);
  region.appendChild(bar);
  return { tabChip, msg, axesChip, caChip };
}




function buildPanelToggle() {
  const btn = document.createElement("button");
  btn.type = "button";
  btn.className = "rsw-panel-toggle";
  btn.dataset.action = "toggle-panels";
  btn.appendChild(createIcon("layers", 16));
  return btn;
}

function updatePanelToggle(btn, state) {
  const P = state.layout.panels;
  const anyOpen = !!(P.explorer || P.properties || P.output);
  btn.classList.toggle("rsw-panel-toggle--active", anyOpen);
  btn.setAttribute("aria-pressed", anyOpen ? "true" : "false");
  const label = anyOpen
    ? "Ocultar painéis Explorer, Properties e Output"
    : "Mostrar painéis Explorer, Properties e Output";
  btn.setAttribute("title", label);
  btn.setAttribute("aria-label", label);
}

function applyVisibility(state, regionEls) {
  for (const region of REGIONS) {
    const visible = state.regions[region] !== false;
    regionEls[region].toggleAttribute("hidden", !visible);
  }
}

function updateToolButtons(container, activeTool) {
  const btns = container.querySelectorAll("[data-tool]");
  for (const btn of btns) {
    const on = btn.dataset.tool === activeTool;
    btn.classList.toggle("rsw-tool--active", on);
    btn.setAttribute("aria-pressed", on ? "true" : "false");
  }
}

function updateTabs(state, tabButtons) {
  const active = state.activeTab;
  for (const btn of tabButtons) {
    const on = btn.dataset.tab === active;
    btn.classList.toggle("rsw-tab--active", on);
    btn.setAttribute("aria-selected", on ? "true" : "false");
    btn.tabIndex = on ? 0 : -1;
  }
}

export async function mountShell(root, { reportProgress = () => {}, signal } = {}) {
  if (!root) throw new Error("Shell: root element is missing.");
  async function checkpoint(progress) {
    signal?.throwIfAborted();
    reportProgress(progress);
    await yieldToBrowserPaint({ signal });
  }

  const shell = el("div", "rsw-shell");
  const regionEls = {};
  for (const region of REGIONS) {
    const section = document.createElement("section");
    section.className = `rsw-region rsw-region--${AREA[region]}`;
    section.dataset.region = region;
    section.setAttribute("aria-label", LABEL[region]);
    regionEls[region] = section;
    shell.appendChild(section);
  }

  const { title: titleEl } = buildTitleBar(regionEls.topBar);
  const menuBar = buildMenuBar();                                                 
  shell.appendChild(menuBar);
  const { tabButtons, themeToggle, playBtn, stopBtn, pauseBtn, ptBadge } = buildMezzanine(regionEls.subBar);            
  const toolbarGroups = buildToolbar(regionEls.toolStrip);
  await checkpoint(0.10);
  const ribbonHome = buildRibbonHome();                                                 
  const ribbonModel = buildRibbonModel();                                            
  const ribbonAvatar = buildRibbonAvatar();                                             
  await checkpoint(0.22);
  const ribbonUI = buildRibbonUI();                                         
  const ribbonScript = buildRibbonScript();                                             
  const ribbonTerrain = buildRibbonTerrain();                                              
  await checkpoint(0.34);
  const ribbonPlugins = buildRibbonPlugins();                                              
  const ribbonView = buildRibbonView();                                           
  const ribbonTest = buildRibbonTest();
  await checkpoint(0.46);
  const wsRefs = buildWorkspace(regionEls.workspace);
  initDockWidgetHost(wsRefs);                                                   
  buildExplorer(wsRefs.explorer.body);                                  
  buildProperties(wsRefs.properties.body);                               
  await checkpoint(0.58);
  const viewportHandle = buildViewport(wsRefs.viewport);                                                                                  
  buildOutput(wsRefs.output);                                      
  buildScriptAnalysis(wsRefs.analysis);                                     
  buildDebuggerPanel(wsRefs.debugger);                              
  buildFindResults(wsRefs.find);                                             
  await checkpoint(0.68);
  buildAssistantPanel(wsRefs.assistant);                               
  buildApiBrowserPanel(wsRefs.apiBrowser);                                 
  initNotificationCenter();                                              
  initTaskScheduler();                                    
  initDataStoreViewer();                                      
  await checkpoint(0.78);
  buildCommandBar(wsRefs.ws);                                    
  const scriptEditor = buildScriptEditor({
    body: wsRefs.centerBody,
    switchBar: wsRefs.viewSwitch,
    viewportEl: wsRefs.viewport,
  });                                
  const { tabChip: statusTabChip, msg: statusMsg, axesChip: statusAxesChip, caChip: statusCaChip } = buildStatusBar(regionEls.statusBar);
  const panelToggle = buildPanelToggle();                               
  shell.appendChild(panelToggle);

  mountTerrainPanel(shell);                                      
  root.replaceChildren(shell);
  await checkpoint(0.88);

  function syncThemeButton() {
    const isDark = theme.get() === "dark";
    themeToggle.replaceChildren(createIcon(isDark ? "sun" : "moon", 16));
    const label = isDark ? "Mudar para tema claro" : "Mudar para tema escuro";
    themeToggle.setAttribute("title", label);
    themeToggle.setAttribute("aria-label", label);
  }


  const initial = store.getState();
  applyVisibility(initial, regionEls);
  updateTabs(initial, tabButtons);
  renderToolbar(initial.activeTab, toolbarGroups, ribbonHome, ribbonModel, ribbonAvatar, ribbonUI, ribbonScript, ribbonTerrain, ribbonPlugins, ribbonView, ribbonTest);
  statusTabChip.textContent = TAB_LABELS[initial.activeTab] || "Home";

  function syncAxesChip() {
    const space = typeof store.getViewOption === "function" ? store.getViewOption("axesSpace") : "world";
    statusAxesChip.textContent = "Axes: " + (AXES_LABELS[space] || "World");
  }
  syncAxesChip();
  store.subscribe((_state, change) => {
    if (change && change.key === "viewOptions" && change.option === "axesSpace") syncAxesChip();
  });

  function syncCaChip(state) {
    const s = state || getCodeAssistStatus();
    const enabled = isCodeAssistEnabled();
    statusCaChip.classList.toggle("rsw-ca-chip--off", !enabled);
    statusCaChip.classList.toggle("rsw-ca-chip--requesting", enabled && s === "requesting");
    statusCaChip.classList.toggle("rsw-ca-chip--error", enabled && s === "error");
  }
  syncCaChip();
  bus.on("codeAssist:status", (p) => syncCaChip(p && p.state));
  bus.on("settings:changed", (p) => {
    if (p && (p.key === "editorCodeAssist" || String(p.key).indexOf("ai") === 0)) syncCaChip();
  });
  bus.on("settings:reset", () => syncCaChip());
  updatePanelToggle(panelToggle, initial);
  syncThemeButton();


  function syncRunButtons(running) {
    playBtn.disabled = !!running;
    stopBtn.disabled = !running;
    pauseBtn.disabled = !running;
    playBtn.classList.toggle("rsw-run-btn--active", !!running);
    if (!running) pauseBtn.classList.remove("rsw-run-btn--active");


    ptBadge.hidden = !running;
    document.body.classList.toggle("rsw-playtest", !!running);
  }
  syncRunButtons(engine.isRunning());
  bus.on(RuntimeEvents.ModeChanged, (p) => syncRunButtons(p && p.running));

  bus.on(RuntimeEvents.PausedChanged, (p) => {
    pauseBtn.classList.toggle("rsw-run-btn--active", !!(p && p.paused));
  });


  shell.addEventListener("click", (e) => {
    const target = e.target;
    if (!target || typeof target.closest !== "function") return;
    const tabBtn = target.closest("[data-tab]");
    if (tabBtn) {
      store.setActiveTab(tabBtn.dataset.tab);                              
      return;
    }
    if (target.closest("[data-action='toggle-theme']")) {
      theme.toggle();
      return;
    }
    if (target.closest("[data-action='toggle-panels']")) {
      const P = store.getState().layout.panels;
      const open = !(P.explorer || P.properties || P.output);                                
      store.setLayout({ panels: { explorer: open, properties: open, output: open } });
      return;
    }
    if (target.closest("[data-action='toggle-assistant']")) {            
      const P = store.getState().layout.panels;
      store.setLayout({ panels: { assistant: !P.assistant } });
      return;
    }
    const notifBtn = target.closest("[data-action='notif-center']");            
    if (notifBtn) {
      toggleNotificationCenter(notifBtn);
      return;
    }
    if (target.closest("[data-action='whatsnew']")) {            
      openWhatsNewPanel();
      return;
    }
    if (target.closest("[data-action='run-play']")) {
      engine.play();                              
      return;
    }
    if (target.closest("[data-action='run-stop']")) {
      engine.stop();                                
      return;
    }
    if (target.closest("[data-action='run-pause']")) {
      engine.togglePause();                                       
      return;
    }
    const insertBtn = target.closest("[data-insert]");
    if (insertBtn) {
      insertObject(insertBtn.dataset.insert);
      return;
    }
    const editBtn = target.closest("[data-edit]");
    if (editBtn) {
      const action = editBtn.dataset.edit;
      if (action === "clone") cloneSelection();
      else if (action === "duplicate") duplicateSelection();
      else if (action === "delete") deleteSelection();
      return;
    }
    const toolBtn = target.closest("[data-tool]");
    if (toolBtn) {
      toolManager.set(toolBtn.dataset.tool);                       
      return;
    }

  });


  store.subscribe((state, change) => {
    if (!change) return;
    if (change.key === "regions") {
      applyVisibility(state, regionEls);
      return;
    }
    if (change.key === "activeTab") {
      updateTabs(state, tabButtons);
      renderToolbar(state.activeTab, toolbarGroups, ribbonHome, ribbonModel, ribbonAvatar, ribbonUI, ribbonScript, ribbonTerrain, ribbonPlugins, ribbonView, ribbonTest);
      statusTabChip.textContent = TAB_LABELS[state.activeTab] || "Home";
      return;
    }
    if (change.key === "activeTool") {
      updateToolButtons(toolbarGroups, state.activeTool);
      return;
    }
    if (change.key === "layout") {
      updatePanelToggle(panelToggle, state);
    }
  });


  bus.on("theme:changed", syncThemeButton);


  wirePivotEditShortcuts(document);                                               
  regionEls.toolStrip.setAttribute("role", "toolbar");
  regionEls.toolStrip.setAttribute("aria-label", "Toolbar");
  initKeybindings(document);
  registerDefaultShortcuts({ scriptEditor });
  registerFocusArea("explorer", wsRefs.explorer.body, { label: "Explorer Panel", order: 1 });
  registerFocusArea("viewport", wsRefs.viewport, { label: "Viewport", order: 2 });
  if (scriptEditor.el) registerFocusArea("editor", scriptEditor.el, { label: "Script Editor", order: 3 });
  registerFocusArea("properties", wsRefs.properties.body, { label: "Properties Panel", order: 4 });
  registerFocusArea("output", wsRefs.output.body, { label: "Output Panel", order: 5 });
  initFocusManager();
  initClientGrid({ host: wsRefs.viewport });
  initDevConsole();


  bus.on("status:message", (p) => {
    const text = p && p.text ? String(p.text) : "";
    statusMsg.textContent = text || "Pronto";
    if (statusMsg._t) { clearTimeout(statusMsg._t); statusMsg._t = null; }
    if (text && (!p || p.transient !== false)) {
      statusMsg._t = setTimeout(() => { statusMsg.textContent = "Pronto"; statusMsg._t = null; }, 4000);
    }
  });
  bus.on("project:changed", (p) => {
    const name = p && p.name ? String(p.name) : "Untitled Place";
    const dirty = !!(p && p.dirty);
    titleEl.textContent = name + (dirty ? " *" : "");
    titleEl.setAttribute("title", name + (dirty ? " (nao salvo)" : ""));

    document.title = name + (dirty ? " *" : "") + " \u2014 Roblox Studio Web";
  });


  await checkpoint(0.94);
  project.init();
  initMenuActions(document);

  persistence.init();


  import("../packages/packages.js").then((m) => m.init());


  import("../runtime/monetization.js").then((m) => m.initMonetization());


  teamCreate.init();
  teamCreate.setRuntimeGuard(() => engine.isRunning());
  drafts.init();
  initCollabRender({ viewport: viewportHandle });

  await checkpoint(1);
  logger.info("Chrome visual montado.");
  return { shell, regionEls };
}
