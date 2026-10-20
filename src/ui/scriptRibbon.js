import { createIcon } from "./icons.js";
import { attachTooltip } from "./tooltip.js";
import { openContextMenu, closeContextMenu } from "./contextMenu.js";
import { store } from "../core/state.js";
import { bus } from "../core/eventBus.js";
import { logger } from "../core/logger.js";
import { insertScript, insertLocalScript, insertModuleScript } from "./scriptOps.js";
import { debuggerController } from "../debugger/controller.js";            

const CLICK_COOLDOWN = 120;

function el(tag, cls) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}

function safe(fn) {
  try {
    return fn();
  } catch (err) {
    console.error("[RSW] ScriptRibbon: erro ao avaliar estado:", err);
    return false;
  }
}


function placeholder(name) {
  logger.info(`[Script] "${name}" será implementado em uma parte futura.`, { source: "Script" });
}

function outputVisible() {
  return !!store.getState().layout.panels.output;
}
function toggleOutput() {
  store.setLayout({ panels: { output: !outputVisible() } });
}
function commandBarVisible() {
  return !!store.getState().commandBarVisible;
}
function toggleCommandBar() {
  store.set("commandBarVisible", !commandBarVisible());
}

function buildGroups() {
  return [
    {
      title: "Script Insert",
      tools: [
        { id: "insert-script", label: "Script", icon: "script", size: "large", desc: "Insere um Script (padrão: ServerScriptService).", onRun: () => insertScript() },
        { id: "insert-localscript", label: "LocalScript", icon: "localscript", size: "large", desc: "Insere um LocalScript (padrão: StarterPlayer > StarterPlayerScripts).", onRun: () => insertLocalScript() },
        { id: "insert-modulescript", label: "ModuleScript", icon: "modulescript", size: "large", desc: "Insere um ModuleScript (padrão: ReplicatedStorage).", onRun: () => insertModuleScript() },
      ],
    },
    {
      title: "Code Editor",
      tools: [
        { id: "open-editor", label: "Open in Editor", icon: "text", size: "large", desc: "Abre o script no editor (em breve).", onRun: () => placeholder("Open in Editor") },
        { id: "find-replace", label: "Find/Replace", icon: "find", size: "small", desc: "Busca/substituição no script (em breve).", onRun: () => placeholder("Find/Replace") },
        { id: "find-all", label: "Find in All Scripts", icon: "find", size: "small", desc: "Busca em todos os scripts (em breve).", onRun: () => placeholder("Find in All Scripts") },
        { id: "script-recovery", label: "Script Recovery", icon: "undo", size: "small", desc: "Recuperação de scripts (em breve).", onRun: () => placeholder("Script Recovery") },
        { id: "script-analysis", label: "Script Analysis", icon: "bug", size: "small", stateToggle: true, desc: "Mostra/oculta o painel Script Analysis.", onRun: () => store.setLayout({ panels: { analysis: !store.getState().layout.panels.analysis } }), getActive: () => !!store.getState().layout.panels.analysis },            
      ],
    },
    {
      title: "Debug",
      tools: [

        { id: "breakpoints", label: "Breakpoints", icon: "bug", size: "large", stateToggle: true, desc: "Mostra/oculta o painel Debugger (seção Breakpoints).", onRun: () => { const vis = !!store.getState().layout.panels.debugger; store.setLayout({ panels: { debugger: !vis } }); if (!vis) bus.emit("debugger:showSection", { section: "breakpoints" }); }, getActive: () => !!store.getState().layout.panels.debugger },
        { id: "call-stack", label: "Call Stack", icon: "layers", size: "small", desc: "Abre o painel Debugger na seção Call Stack.", onRun: () => { store.setLayout({ panels: { debugger: true } }); bus.emit("debugger:showSection", { section: "callstack" }); } },
        { id: "watch", label: "Watch", icon: "eye", size: "small", desc: "Abre o painel Debugger na seção Watch.", onRun: () => { store.setLayout({ panels: { debugger: true } }); bus.emit("debugger:showSection", { section: "watch" }); } },
        { id: "step-over", label: "Step Over", icon: "redo", size: "small", desc: "Step Over (F10): executa a linha atual sem entrar em funções.", getEnabled: () => debuggerController.isPaused(), onRun: () => debuggerController.stepOver() },
        { id: "step-into", label: "Step Into", icon: "move", size: "small", desc: "Step Into (F11): entra na função chamada na linha atual.", getEnabled: () => debuggerController.isPaused(), onRun: () => debuggerController.stepInto() },
        { id: "step-out", label: "Step Out", icon: "undo", size: "small", desc: "Step Out (Shift+F11): executa até retornar da função atual.", getEnabled: () => debuggerController.isPaused(), onRun: () => debuggerController.stepOut() },
        { id: "resume", label: "Resume", icon: "play", size: "small", desc: "Resume (F5): continua até o próximo breakpoint ou o fim.", getEnabled: () => debuggerController.isPaused(), onRun: () => debuggerController.resume() },
      ],
    },
    {
      title: "Output",
      tools: [
        { id: "show-output", label: "Show Output", icon: "eye", size: "large", stateToggle: true, desc: "Mostra/oculta o painel Output.", onRun: () => toggleOutput(), getActive: () => outputVisible() },
        { id: "clear-output", label: "Clear Output", icon: "trash", size: "large", desc: "Limpa todos os logs do Output.", onRun: () => logger.clear() },
        {
          id: "output-filter", label: "Filter", icon: "filter", size: "large", desc: "Filtra os logs por nível.",
          options: [
            { label: "All", run: () => bus.emit("output:setFilter", { level: "all" }) },
            { label: "Info", run: () => bus.emit("output:setFilter", { level: "info" }) },
            { label: "Warnings", run: () => bus.emit("output:setFilter", { level: "warn" }) },
            { label: "Errors", run: () => bus.emit("output:setFilter", { level: "error" }) },
          ],
        },
      ],
    },
    {
      title: "Command",
      tools: [
        { id: "command-bar", label: "Command Bar", icon: "command", size: "large", stateToggle: true, desc: "Mostra/oculta a Command Bar.", onRun: () => toggleCommandBar(), getActive: () => commandBarVisible() },
        { id: "run-command", label: "Run Command", icon: "play", size: "small", desc: "Executa o último comando digitado.", onRun: () => bus.emit("commandbar:runLast") },
      ],
    },
    {
      title: "Test",
      tools: [
        { id: "run-script", label: "Run Script", icon: "run", size: "large", desc: "Executa o script selecionado (em breve).", onRun: () => placeholder("Run Script") },
        { id: "stop-script", label: "Stop Script", icon: "stop", size: "small", desc: "Para a execução do script (em breve).", onRun: () => placeholder("Stop Script") },
      ],
    },
  ];
}

function openDropdown(entry, anchorEl) {
  const rect = anchorEl.getBoundingClientRect();
  const items = entry.options.map((opt) => ({
    label: opt.label,
    onSelect: () => {
      if (typeof opt.run === "function") opt.run();
    },
  }));
  openContextMenu({ x: Math.round(rect.left), y: Math.round(rect.bottom + 2), items });
}

function buildToolButton(entry, ctx) {
  const btn = el("button", `rsw-rtool rsw-rtool--${entry.size}`);
  btn.type = "button";
  btn.dataset.rb = entry.id;
  if (entry.options) btn.classList.add("rsw-rtool--hasdrop");

  const iconWrap = el("span", "rsw-rtool__icon");
  iconWrap.appendChild(createIcon(entry.icon, entry.size === "large" ? 26 : 16));
  btn.appendChild(iconWrap);

  const label = el("span", "rsw-rtool__label");
  label.textContent = entry.label;
  btn.appendChild(label);

  if (entry.options) {
    const arrow = el("span", "rsw-rtool__arrow");
    arrow.dataset.rbArrow = "1";
    arrow.textContent = "\u25BE";
    btn.appendChild(arrow);
  }

  let lastClick = 0;
  btn.addEventListener("click", (e) => {
    if (btn.getAttribute("aria-disabled") === "true") return;

    if (entry.options && e.target.closest && e.target.closest("[data-rb-arrow]")) {
      e.preventDefault();
      openDropdown(entry, btn);
      return;
    }

    const now = Date.now();
    if (now - lastClick < CLICK_COOLDOWN) return;
    lastClick = now;

    try {
      if (entry.options) openDropdown(entry, btn);
      else if (typeof entry.onRun === "function") entry.onRun();
      if (ctx && typeof ctx.afterRun === "function") ctx.afterRun();
    } catch (err) {


      console.error(
        `[RSW] ScriptRibbon: erro ao executar "${entry.id}": ` + ((err && err.message) || String(err)),
        (err && err.stack) || err,
      );
    }
  });

  const dispose = attachTooltip(btn, { title: entry.label, desc: entry.desc, shortcut: entry.shortcut });
  ctx.disposers.push(dispose);
  entry.el = btn;
  ctx.entries.push(entry);
  return btn;
}

function buildGroupEl(group, ctx) {
  const groupEl = el("div", "rsw-rgroup");
  const toolsRow = el("div", "rsw-rgroup__tools");


  const MAX_SMALLS_PER_COL = 3;
  let col = null;
  let colSmalls = 0;
  for (const tool of group.tools) {
    const btn = buildToolButton(tool, ctx);
    if (tool.size === "small") {
      if (!col || colSmalls >= MAX_SMALLS_PER_COL) {
        col = el("div", "rsw-rgroup__col");
        toolsRow.appendChild(col);
        colSmalls = 0;
      }
      col.appendChild(btn);
      colSmalls += 1;
    } else {
      col = null;
      toolsRow.appendChild(btn);
    }
  }

  const titleEl = el("div", "rsw-rgroup__title");
  titleEl.textContent = group.title;
  groupEl.appendChild(toolsRow);
  groupEl.appendChild(titleEl);
  return groupEl;
}

export function buildRibbonScript() {
  const ctx = { entries: [], disposers: [] };
  const root = el("div", "rsw-ribbon");
  root.setAttribute("role", "toolbar");
  root.setAttribute("aria-label", "Script");

  const groups = buildGroups();
  groups.forEach((group, i) => {
    if (i > 0) root.appendChild(el("div", "rsw-rsep"));
    root.appendChild(buildGroupEl(group, ctx));
  });

  function refresh() {
    for (const entry of ctx.entries) {
      if (!entry.el) continue;
      if (entry.getActive) {
        entry.el.classList.toggle("rsw-rtool--active", !!safe(entry.getActive));
      }
      if (entry.getEnabled) {
        const enabled = !!safe(entry.getEnabled);
        entry.el.classList.toggle("rsw-rtool--disabled", !enabled);
        entry.el.setAttribute("aria-disabled", enabled ? "false" : "true");
      }
    }
  }
  ctx.afterRun = refresh;

  const offStore = store.subscribe((_s, change) => {
    if (!change) return;
    if (change.key === "layout" || change.key === "commandBarVisible") refresh();
  });
  const offSel = bus.on("selection:changed", refresh);
  const offDbg = bus.on("debugger:stateChanged", refresh);            

  refresh();

  function destroy() {
    if (typeof offStore === "function") offStore();
    if (typeof offSel === "function") offSel();
    if (typeof offDbg === "function") offDbg();            
    for (const d of ctx.disposers) {
      try {
        d();
      } catch (_) {

      }
    }
    closeContextMenu();
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  return { el: root, refresh, destroy };
}
