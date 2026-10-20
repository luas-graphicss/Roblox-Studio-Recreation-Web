import { commands } from "../core/commands.js";
import { selection } from "../core/selection.js";
import { store } from "../core/state.js";
import { logger } from "../core/logger.js";
import {
  createInstance,
  getService,
  makeColor,
  makeUDim2,
} from "../datamodel/index.js";


export const GUI_ROOTS = new Set(["ScreenGui", "BillboardGui", "SurfaceGui"]);


export const GUI_OBJECTS = new Set([
  "Frame",
  "ScrollingFrame",
  "ViewportFrame",
  "VideoFrame",
  "ImageLabel",
  "ImageButton",
  "TextLabel",
  "TextButton",
  "TextBox",
]);


export const UI_MODIFIERS = new Set([
  "UIListLayout",
  "UIGridLayout",
  "UITableLayout",
  "UIPageLayout",
  "UIAspectRatioConstraint",
  "UISizeConstraint",
  "UITextSizeConstraint",
  "UICorner",
  "UIStroke",
  "UIGradient",
  "UIPadding",
]);


function isGuiContainerClass(className) {
  return GUI_ROOTS.has(className) || GUI_OBJECTS.has(className);
}

function live(i) {
  return (
    i &&
    i.__isInstance === true &&
    typeof i.isDestroyed === "function" &&
    !i.isDestroyed()
  );
}

function liveOnly(list) {
  return (list || []).filter(live);
}

function dataModel() {
  try {
    return store.getDataModel();
  } catch (_) {
    return null;
  }
}

function serviceNamed(name) {
  try {
    return getService(dataModel(), name);
  } catch (_) {
    return null;
  }
}

export function starterGui() {
  return serviceNamed("StarterGui");
}

export function workspaceRoot() {
  return serviceNamed("Workspace");
}

export function selectedInstance() {
  return liveOnly(selection.get())[0] || null;
}



export function isBasePart(inst) {
  return !!(
    inst &&
    typeof inst.hasProperty === "function" &&
    inst.hasProperty("Size") &&
    inst.hasProperty("Position") &&
    inst.hasProperty("Color") &&
    inst.hasProperty("Anchored")
  );
}

export function isGuiContainer(inst) {
  return !!(inst && live(inst) && isGuiContainerClass(inst.className));
}


function runInsert(label, inst, parent, opts = {}) {
  if (!inst) return false;
  if (!live(parent)) {
    logger.warn(`${label}: destino indisponível; inserção bloqueada.`);
    if (typeof inst.destroy === "function") inst.destroy();
    return false;
  }
  const selectInst = opts.selectInst && live(opts.selectInst) ? opts.selectInst : inst;
  const configure = typeof opts.configure === "function" ? opts.configure : null;
  const prevSel = selection.get();
  return commands.execute({
    name: label,
    do() {
      if (inst.isDestroyed() || !live(parent)) return false;
      inst.setParent(parent);
      if (configure) {
        try {
          configure();
        } catch (_) {

        }
      }
      selection.set(liveOnly([selectInst]));
      return true;
    },
    undo() {
      inst.setParent(null);
      selection.set(liveOnly(prevSel));
    },
  });
}


export function insertScreenGui() {
  const sg = starterGui();
  if (!sg) {
    logger.warn("insertScreenGui: StarterGui indisponível.");
    return null;
  }
  const inst = createInstance("ScreenGui", {});
  if (!inst) return null;
  return runInsert("Inserir ScreenGui", inst, sg) ? inst : null;
}

export function insertBillboardGui() {
  const sel = selectedInstance();
  const parent = sel && isBasePart(sel) ? sel : workspaceRoot();
  if (!parent) return null;
  const inst = createInstance("BillboardGui", {});
  if (!inst) return null;
  return runInsert("Inserir BillboardGui", inst, parent) ? inst : null;
}

export function insertSurfaceGui() {
  const sel = selectedInstance();
  const part = sel && isBasePart(sel) ? sel : null;
  const parent = part || workspaceRoot();
  if (!parent) return null;
  const inst = createInstance("SurfaceGui", {});
  if (!inst) return null;
  const configure = part ? () => inst.setProperty("Adornee", part) : null;
  return runInsert("Inserir SurfaceGui", inst, parent, { configure }) ? inst : null;
}


export function insertGuiObject(className) {
  if (!GUI_OBJECTS.has(className)) {
    logger.warn(`insertGuiObject: classe inválida "${className}".`);
    return null;
  }
  const sel = selectedInstance();
  const inst = createInstance(className, {});
  if (!inst) return null;


  if (sel && isGuiContainer(sel)) {
    return runInsert(`Inserir ${className}`, inst, sel) ? inst : null;
  }


  const sg = starterGui();
  if (!sg) {
    if (typeof inst.destroy === "function") inst.destroy();
    return null;
  }
  const screen = createInstance("ScreenGui", {});
  if (!screen) {
    if (typeof inst.destroy === "function") inst.destroy();
    return null;
  }
  inst.setParent(screen);                                             
  const ok = runInsert(`Inserir ${className}`, screen, sg, { selectInst: inst });
  return ok ? inst : null;
}


export function insertUIModifier(className) {
  if (!UI_MODIFIERS.has(className)) {
    logger.warn(`insertUIModifier: classe inválida "${className}".`);
    return null;
  }
  const sel = selectedInstance();
  if (!sel || !isGuiContainer(sel)) {

    logger.warn(`${className} exige um contêiner GUI selecionado; inserção bloqueada.`);
    return null;
  }
  const inst = createInstance(className, {});
  if (!inst) return null;
  return runInsert(`Inserir ${className}`, inst, sel) ? inst : null;
}


export function insertProgressBar() {
  const sel = selectedInstance();
  const bar = createInstance("Frame", { name: "ProgressBar" });
  if (!bar) return null;
  bar.setProperty("Size", makeUDim2(0, 220, 0, 24));
  bar.setProperty("BackgroundColor3", makeColor(0.14, 0.15, 0.18));
  bar.setProperty("BorderSizePixel", 0);
  bar.setProperty("ClipsDescendants", true);

  const fill = createInstance("Frame", { name: "Fill" });
  if (fill) {
    fill.setProperty("Size", makeUDim2(0.5, 0, 1, 0));
    fill.setProperty("Position", makeUDim2(0, 0, 0, 0));
    fill.setProperty("BackgroundColor3", makeColor(0.2, 0.75, 0.35));
    fill.setProperty("BorderSizePixel", 0);
    fill.setParent(bar);
  }

  if (sel && isGuiContainer(sel)) {
    return runInsert("Inserir ProgressBar", bar, sel) ? bar : null;
  }
  const sg = starterGui();
  if (!sg) {
    if (typeof bar.destroy === "function") bar.destroy();
    return null;
  }
  const screen = createInstance("ScreenGui", {});
  if (!screen) {
    if (typeof bar.destroy === "function") bar.destroy();
    return null;
  }
  bar.setParent(screen);
  return runInsert("Inserir ProgressBar", screen, sg, { selectInst: bar }) ? bar : null;
}

export function insertSelectionBox() {
  const sel = selectedInstance();
  const part = sel && isBasePart(sel) ? sel : null;
  const parent = part || workspaceRoot();
  if (!parent) return null;
  const inst = createInstance("SelectionBox", {});
  if (!inst) return null;
  const configure = part ? () => inst.setProperty("Adornee", part) : null;
  return runInsert("Inserir SelectionBox", inst, parent, { configure }) ? inst : null;
}


export function hasSelectedBasePart() {
  const s = selectedInstance();
  return !!(s && isBasePart(s));
}

export function hasSelectedGuiContainer() {
  const s = selectedInstance();
  return !!(s && isGuiContainer(s));
}
