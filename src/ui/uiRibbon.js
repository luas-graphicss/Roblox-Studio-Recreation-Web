import { createIcon } from "./icons.js";
import { attachTooltip } from "./tooltip.js";
import { closeContextMenu } from "./contextMenu.js";
import { tools } from "../viewport/tools.js";
import { store } from "../core/state.js";
import { bus } from "../core/eventBus.js";
import {
  insertScreenGui,
  insertBillboardGui,
  insertSurfaceGui,
  insertGuiObject,
  insertUIModifier,
  insertProgressBar,
  insertSelectionBox,
  hasSelectedBasePart,
  hasSelectedGuiContainer,
} from "./uiOps.js";

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
    console.error("[RSW] UI Ribbon: erro ao avaliar estado:", err);
    return false;
  }
}


function uiEditorOn() {
  return !!safe(() => store.get("uiEditorMode"));
}
function toggleUiEditor() {
  store.set("uiEditorMode", !uiEditorOn());
}

function buildGroups() {
  const guiObj = (cn) => () => insertGuiObject(cn);
  const modifier = (cn) => () => insertUIModifier(cn);
  return [
    {
      title: "Select",
      tools: [
        { id: "ui-select", label: "Select", icon: "cursor", size: "large", shortcut: "Q", desc: "Seleciona elementos de UI no editor.", onRun: () => tools.set("select"), getActive: () => tools.get() === "select" },
        { id: "ui-editor-mode", label: "UI Editor Mode", icon: "uimode", size: "large", stateToggle: true, desc: "Alterna o Viewport entre o modo 3D e o modo UI Editor 2D.", onRun: () => toggleUiEditor(), getActive: () => uiEditorOn() },
      ],
    },
    {
      title: "Screen Gui",
      tools: [
        { id: "ins-screengui", label: "ScreenGui", icon: "screengui", size: "large", desc: "Insere um ScreenGui no StarterGui.", onRun: () => insertScreenGui() },
        { id: "ins-billboardgui", label: "BillboardGui", icon: "billboardgui", size: "small", desc: "Insere um BillboardGui na Part selecionada ou no Workspace.", onRun: () => insertBillboardGui() },
        { id: "ins-surfacegui", label: "SurfaceGui", icon: "surfacegui", size: "small", desc: "Insere um SurfaceGui na Part selecionada (vira Adornee).", onRun: () => insertSurfaceGui(), getEnabled: () => safe(hasSelectedBasePart) },
      ],
    },
    {
      title: "Containers",
      tools: [
        { id: "ins-frame", label: "Frame", icon: "frame", size: "large", desc: "Insere um Frame dentro do contêiner GUI selecionado.", onRun: guiObj("Frame") },
        { id: "ins-scrollingframe", label: "ScrollingFrame", icon: "scrollingframe", size: "small", desc: "Insere um ScrollingFrame.", onRun: guiObj("ScrollingFrame") },
        { id: "ins-viewportframe", label: "ViewportFrame", icon: "viewportframe", size: "small", desc: "Insere um ViewportFrame.", onRun: guiObj("ViewportFrame") },
      ],
    },
    {
      title: "Labels",
      tools: [
        { id: "ins-textlabel", label: "TextLabel", icon: "textlabel", size: "large", desc: "Insere um TextLabel.", onRun: guiObj("TextLabel") },
        { id: "ins-imagelabel", label: "ImageLabel", icon: "imagelabel", size: "small", desc: "Insere um ImageLabel.", onRun: guiObj("ImageLabel") },
      ],
    },
    {
      title: "Inputs",
      tools: [
        { id: "ins-textbutton", label: "TextButton", icon: "textbutton", size: "large", desc: "Insere um TextButton.", onRun: guiObj("TextButton") },
        { id: "ins-imagebutton", label: "ImageButton", icon: "imagebutton", size: "small", desc: "Insere um ImageButton.", onRun: guiObj("ImageButton") },
        { id: "ins-textbox", label: "TextBox", icon: "textbox", size: "small", desc: "Insere um TextBox para entrada de texto.", onRun: guiObj("TextBox") },
      ],
    },
    {
      title: "Display",
      tools: [
        { id: "ins-progressbar", label: "ProgressBar", icon: "progressbar", size: "small", desc: "Insere um Frame configurado como barra de progresso.", onRun: () => insertProgressBar() },
        { id: "ins-videoframe", label: "VideoFrame", icon: "videoframe", size: "small", desc: "Insere um VideoFrame.", onRun: guiObj("VideoFrame") },
        { id: "ins-selectionbox", label: "SelectionBox", icon: "selectionbox", size: "small", desc: "Insere um SelectionBox (adornment 3D) na Part selecionada.", onRun: () => insertSelectionBox() },
      ],
    },
    {
      title: "Layout",
      tools: [
        { id: "ins-uilistlayout", label: "UIListLayout", icon: "uilayout", size: "small", desc: "Organiza filhos em lista. Exige um contêiner GUI selecionado.", onRun: modifier("UIListLayout"), getEnabled: () => safe(hasSelectedGuiContainer) },
        { id: "ins-uigridlayout", label: "UIGridLayout", icon: "uigrid", size: "small", desc: "Organiza filhos em grade.", onRun: modifier("UIGridLayout"), getEnabled: () => safe(hasSelectedGuiContainer) },
        { id: "ins-uitablelayout", label: "UITableLayout", icon: "uigrid", size: "small", desc: "Organiza filhos em tabela.", onRun: modifier("UITableLayout"), getEnabled: () => safe(hasSelectedGuiContainer) },
        { id: "ins-uipagelayout", label: "UIPageLayout", icon: "uilayout", size: "small", desc: "Organiza filhos em páginas.", onRun: modifier("UIPageLayout"), getEnabled: () => safe(hasSelectedGuiContainer) },
      ],
    },
    {
      title: "Constraints",
      tools: [
        { id: "ins-uiaspect", label: "UIAspectRatio", icon: "uiconstraint", size: "small", desc: "Restringe a proporção do elemento.", onRun: modifier("UIAspectRatioConstraint"), getEnabled: () => safe(hasSelectedGuiContainer) },
        { id: "ins-uisize", label: "UISizeConstraint", icon: "uiconstraint", size: "small", desc: "Restringe o tamanho do elemento.", onRun: modifier("UISizeConstraint"), getEnabled: () => safe(hasSelectedGuiContainer) },
        { id: "ins-uitextsize", label: "UITextSize", icon: "uiconstraint", size: "small", desc: "Restringe o tamanho do texto.", onRun: modifier("UITextSizeConstraint"), getEnabled: () => safe(hasSelectedGuiContainer) },
      ],
    },
    {
      title: "Style",
      tools: [
        { id: "ins-uicorner", label: "UICorner", icon: "uicorner", size: "small", desc: "Arredonda os cantos do elemento.", onRun: modifier("UICorner"), getEnabled: () => safe(hasSelectedGuiContainer) },
        { id: "ins-uistroke", label: "UIStroke", icon: "uistroke", size: "small", desc: "Adiciona uma borda ao elemento.", onRun: modifier("UIStroke"), getEnabled: () => safe(hasSelectedGuiContainer) },
        { id: "ins-uigradient", label: "UIGradient", icon: "uigradient", size: "small", desc: "Aplica um gradiente de cor.", onRun: modifier("UIGradient"), getEnabled: () => safe(hasSelectedGuiContainer) },
        { id: "ins-uipadding", label: "UIPadding", icon: "uipadding", size: "small", desc: "Adiciona espaçamento interno.", onRun: modifier("UIPadding"), getEnabled: () => safe(hasSelectedGuiContainer) },
      ],
    },
  ];
}

function buildToolButton(entry, ctx) {
  const btn = el("button", `rsw-rtool rsw-rtool--${entry.size}`);
  btn.type = "button";
  btn.dataset.rb = entry.id;

  const iconWrap = el("span", "rsw-rtool__icon");
  iconWrap.appendChild(createIcon(entry.icon, entry.size === "large" ? 26 : 16));
  btn.appendChild(iconWrap);

  const label = el("span", "rsw-rtool__label");
  label.textContent = entry.label;
  btn.appendChild(label);

  let lastClick = 0;
  btn.addEventListener("click", () => {
    if (btn.getAttribute("aria-disabled") === "true") return;
    const now = Date.now();
    if (now - lastClick < CLICK_COOLDOWN) return;
    lastClick = now;
    try {
      if (typeof entry.onRun === "function") entry.onRun();
      if (ctx && typeof ctx.afterRun === "function") ctx.afterRun();
    } catch (err) {


      console.error(
        `[RSW] UI Ribbon: erro ao executar "${entry.id}": ` + ((err && err.message) || String(err)),
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

export function buildRibbonUI() {
  const ctx = { entries: [], disposers: [] };
  const root = el("div", "rsw-ribbon");
  root.setAttribute("role", "toolbar");
  root.setAttribute("aria-label", "UI");

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

  const offSel = bus.on("selection:changed", refresh);
  const offHist = bus.on("history:changed", refresh);
  const offStore = store.subscribe((_s, change) => {
    if (change && (change.key === "activeTool" || change.key === "uiEditorMode")) refresh();
  });

  refresh();

  function destroy() {
    [offSel, offHist, offStore].forEach((f) => {
      if (typeof f === "function") f();
    });
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
