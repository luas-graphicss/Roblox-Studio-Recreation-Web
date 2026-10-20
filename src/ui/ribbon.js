import { createIcon } from "./icons.js";
import { attachTooltip } from "./tooltip.js";
import { openContextMenu, closeContextMenu } from "./contextMenu.js";
import { tools } from "../viewport/tools.js";
import { commands } from "../core/commands.js";
import { selection } from "../core/selection.js";
import { store } from "../core/state.js";
import { climateDebugState } from "../climate/climateRuntime.js";            
import { bus } from "../core/eventBus.js";
import { engine } from "../runtime/engine.js";                               
import { openCollisionGroupsDialog } from "./collisionGroupsDialog.js";            
import { openInsertObjectDialog } from "./insertObjectDialog.js";            
import {
  insertObject,
  deleteSelection,
  duplicateSelection,
} from "../viewport/objectOps.js";
import {
  copySelection,
  cutSelection,
  pasteFromClipboard,
  pasteIntoSelection,
  hasClipboard,
  groupSelection,
  ungroupSelection,
  toggleLockSelection,
  canGroup,
  canUngroup,
  canLock,
  insertAnyClass,
  insertEffect,
  insertSound,
} from "../core/editOps.js";
import { Enums } from "../datamodel/types.js";
import { togglePivotEdit, isPivotEditing } from "../viewport/pivotEditor.js";
import {
  SNAP_MIN, SNAP_MAX,
  getSnapState, setMoveSnapEnabled, setRotateSnapEnabled, setMoveSnapValue, setRotateSnapValue,
  canAlign, alignLeft, alignCenterH, alignRight, alignTop, alignMiddle, alignBottom, alignAdvanced,
  canDistribute, distributeHorizontally, distributeVertically,
  canEditPivot, resetPivot, pivotToCenter,
  canUnion, unionSelection, canNegate, negateSelection, canSeparate, separateSelection,
  canToggleAnchored, getAnchoredActive, toggleAnchored, getCanCollideActive, toggleCanCollide,
  isConstraintDetailsVisible, toggleConstraintDetails,
  isWeldsVisible, toggleShowWelds,
  canSetSurface, setSurfaceType,
  getLockActive, canUnlockAll, unlockAll,
} from "../core/modelOps.js";

const CLICK_COOLDOWN = 120;                                       


const dropdownDefault = new Map();                         


function el(tag, cls) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}

function isLive(inst) {
  return !!(inst && typeof inst.isDestroyed === "function" && !inst.isDestroyed());
}

function liveSel() {
  return (selection.get() || []).filter(isLive);
}

function hasSel() {
  return liveSel().length > 0;
}


function transformEnabled() {
  return store.get("centralView") !== "editor";
}

function safe(fn) {
  try {
    return fn();
  } catch (err) {
    console.error("[RSW] Ribbon: erro ao avaliar estado:", err);
    return false;
  }
}


function insertTarget() {
  return liveSel()[0] || undefined;
}


function buildGroups() {
  return [
    {
      title: "Clipboard",
      tools: [
        { id: "cut", label: "Cut", icon: "cut", size: "large", shortcut: "Ctrl+X", desc: "Corta a seleção para a área de transferência.", onRun: () => cutSelection(), getEnabled: hasSel },
        { id: "copy", label: "Copy", icon: "copy", size: "large", shortcut: "Ctrl+C", desc: "Copia a seleção para a área de transferência.", onRun: () => copySelection(), getEnabled: hasSel },
        { id: "paste", label: "Paste", icon: "paste", size: "large", shortcut: "Ctrl+V", desc: "Cola os objetos da área de transferência.", onRun: () => pasteFromClipboard(), getEnabled: hasClipboard },
        { id: "pasteInto", label: "Paste Into", icon: "paste", size: "small", shortcut: "Ctrl+Shift+V", desc: "Cola como filho do objeto selecionado.", onRun: () => pasteIntoSelection(), getEnabled: hasClipboard },
        { id: "duplicate", label: "Duplicate", icon: "duplicate", size: "small", shortcut: "Ctrl+D", desc: "Duplica os objetos selecionados.", onRun: () => duplicateSelection(), getEnabled: hasSel },
      ],
    },
    {
      title: "Tools",
      tools: [
        { id: "tool-select", label: "Select", icon: "cursor", size: "large", shortcut: "Q", desc: "Ferramenta de seleção.", onRun: () => tools.set("select"), getActive: () => tools.get() === "select", getEnabled: transformEnabled },
        { id: "tool-move", label: "Move", icon: "move", size: "large", shortcut: "W", desc: "Move objetos (gizmo de movimento).", onRun: () => tools.set("move"), getActive: () => tools.get() === "move", getEnabled: transformEnabled },
        { id: "tool-scale", label: "Scale", icon: "scale", size: "large", shortcut: "R", desc: "Redimensiona objetos (gizmo de escala).", onRun: () => tools.set("scale"), getActive: () => tools.get() === "scale", getEnabled: transformEnabled },
        { id: "tool-rotate", label: "Rotate", icon: "rotate", size: "large", shortcut: "E", desc: "Rotaciona objetos (gizmo de rotação).", onRun: () => tools.set("rotate"), getActive: () => tools.get() === "rotate", getEnabled: transformEnabled },
        { id: "tool-transform", label: "Transform", icon: "transform", size: "large", desc: "Combina mover, escalar e rotacionar num único gizmo.", onRun: () => tools.set("transform"), getActive: () => tools.get() === "transform", getEnabled: transformEnabled },
      ],
    },
    {
      title: "Insert",
      tools: [
        {
          id: "insert-part", label: "Part", icon: "part", size: "large", desc: "Insere uma Part. Use a seta para escolher a forma.",
          options: [
            { label: "Block", run: () => insertObject("Part") },
            { label: "Sphere", run: () => insertObject("Sphere") },
            { label: "Wedge", run: () => insertObject("Wedge") },
            { label: "Cylinder", run: () => insertObject("Cylinder") },
            { label: "CornerWedge", run: () => insertObject("CornerWedge") },
            { label: "SpawnLocation", run: () => insertObject("SpawnLocation") },
            { label: "Truss", run: () => insertObject("TrussPart") },
          ],
        },
        {
          id: "insert-ui", label: "UI", icon: "ui", size: "large", desc: "Insere elementos de interface (GUI).",
          options: [
            { label: "ScreenGui", run: () => insertAnyClass("ScreenGui", insertTarget()) },
            { label: "Frame", run: () => insertAnyClass("Frame", insertTarget()) },
            { label: "TextLabel", run: () => insertAnyClass("TextLabel", insertTarget()) },
            { label: "TextButton", run: () => insertAnyClass("TextButton", insertTarget()) },
            { label: "ImageLabel", run: () => insertAnyClass("ImageLabel", insertTarget()) },
            { label: "ScrollingFrame", run: () => insertAnyClass("ScrollingFrame", insertTarget()) },
          ],
        },
        {
          id: "insert-effect", label: "Effect", icon: "effect", size: "large", desc: "Insere efeitos visuais.",


          options: [
            { label: "ParticleEmitter", run: () => insertEffect("ParticleEmitter", insertTarget()) },
            { label: "Beam", run: () => insertEffect("Beam", insertTarget()) },
            { label: "Trail", run: () => insertEffect("Trail", insertTarget()) },
            { label: "Fire", run: () => insertEffect("Fire", insertTarget()) },
            { label: "Smoke", run: () => insertEffect("Smoke", insertTarget()) },
            { label: "Sparkles", run: () => insertEffect("Sparkles", insertTarget()) },
            { label: "Explosion", run: () => insertEffect("Explosion", insertTarget()) },
          ],
        },
        {
          id: "insert-sound", label: "Sound", icon: "sound", size: "large",


          desc: "Insere um Sound: na BasePart selecionada ou no Workspace.",
          onRun: () => insertSound(insertTarget()),
        },
        { id: "insert-object", label: "Object", icon: "object", size: "large", desc: "Abre o diálogo \"Insert Object\" para inserir qualquer classe.", onRun: () => openInsertObjectDialog() },
      ],
    },
    {
      title: "Assets",
      tools: [
        { id: "open-toolbox", label: "Toolbox", icon: "plugin", size: "large", desc: "Abre a biblioteca de assets (Toolbox): modelos, decais, áudio e meshes.", onRun: () => bus.emit("toolbox:toggle") },
        { id: "open-assetmanager", label: "Asset Manager", icon: "folder", size: "large", desc: "Abre o gerenciador de assets locais do projeto.", onRun: () => bus.emit("assetmanager:toggle") },
        { id: "open-materialmanager", label: "Material Manager", icon: "material", size: "large", desc: "Abre o gerenciador de materiais (base + customizados).", onRun: () => bus.emit("materialmanager:toggle") },            
      ],
    },
    {
      title: "Edit",
      tools: [
        { id: "undo", label: "Undo", icon: "undo", size: "large", shortcut: "Ctrl+Z", desc: "Desfaz a última ação.", onRun: () => commands.undo(), getEnabled: () => commands.canUndo() },
        { id: "redo", label: "Redo", icon: "redo", size: "large", shortcut: "Ctrl+Y", desc: "Refaz a ação desfeita.", onRun: () => commands.redo(), getEnabled: () => commands.canRedo() },
        { id: "delete", label: "Delete", icon: "trash", size: "large", shortcut: "Del", desc: "Exclui os objetos selecionados.", onRun: () => deleteSelection(), getEnabled: hasSel },
        { id: "group", label: "Group", icon: "group", size: "small", shortcut: "Ctrl+G", desc: "Agrupa os objetos selecionados num Model.", onRun: () => groupSelection(), getEnabled: () => canGroup() },
        { id: "ungroup", label: "Ungroup", icon: "ungroup", size: "small", shortcut: "Ctrl+U", desc: "Desagrupa o(s) Model(s) selecionado(s).", onRun: () => ungroupSelection(), getEnabled: () => canUngroup() },
        { id: "lock", label: "Lock", icon: "lock", size: "small", shortcut: "L", desc: "Bloqueia/desbloqueia a seleção (não selecionável no Viewport).", onRun: () => toggleLockSelection(), getEnabled: () => canLock() },
      ],
    },
    {
      title: "Constraints",
      tools: [
        {
          id: "create-constraint", label: "Create", icon: "create", size: "large", desc: "Cria constraints entre objetos.",
          options: [
            { label: "Weld", run: () => insertAnyClass("Weld", insertTarget()) },
            { label: "Hinge", run: () => insertAnyClass("HingeConstraint", insertTarget()) },
            { label: "Rope", run: () => insertAnyClass("RopeConstraint", insertTarget()) },
            { label: "Spring", run: () => insertAnyClass("SpringConstraint", insertTarget()) },
          ],
        },
        { id: "show-welds", label: "Show Welds", icon: "model", size: "small", stateToggle: true, desc: "Mostra/oculta os marcadores 3D de Welds e WeldConstraints no viewport.", onRun: () => toggleShowWelds(), getActive: () => safe(isWeldsVisible) },
        { id: "show-details", label: "Show Details", icon: "find", size: "small", stateToggle: true, desc: "Mostra indicadores 3D de constraints e attachments no viewport.", onRun: () => toggleConstraintDetails(), getActive: () => safe(isConstraintDetailsVisible) },
      ],
    },
    {
      title: "Climate",
      tools: [
        { id: "show-wind-vector", label: "Wind Vector", icon: "move", size: "small", toggle: true, stateToggle: true, desc: "Mostra seta 3D com a direcao e forca do GlobalWind.", onRun: () => { climateDebugState.showWindVector = !climateDebugState.showWindVector; }, getActive: () => climateDebugState.showWindVector },
        { id: "show-windshake", label: "WindShake", icon: "model", size: "small", toggle: true, stateToggle: true, desc: "Destaca objetos marcados com o Attribute WindShake.", onRun: () => { climateDebugState.showWindShakeObjects = !climateDebugState.showWindShakeObjects; }, getActive: () => climateDebugState.showWindShakeObjects },
        { id: "show-weather-bounds", label: "Weather Bounds", icon: "find", size: "small", toggle: true, stateToggle: true, desc: "Mostra o raio de efeitos climaticos ao redor da camera.", onRun: () => { climateDebugState.showWeatherBounds = !climateDebugState.showWeatherBounds; }, getActive: () => climateDebugState.showWeatherBounds },
      ],
    },
    {
      title: "Test",
      tools: [

        { id: "play", label: "Play", icon: "play", size: "large", shortcut: "F5", desc: "Inicia o Playtest completo (Server + Client + personagem).", onRun: () => engine.play(), getEnabled: () => !engine.isRunning() },
        { id: "play-here", label: "Play Here", icon: "play", size: "small", shortcut: "F6", desc: "Inicia o Playtest com o personagem nascendo na posição da câmera do editor.", onRun: () => engine.playHere(), getEnabled: () => !engine.isRunning() },
        { id: "run", label: "Run", icon: "run", size: "small", shortcut: "F8", desc: "Roda apenas os scripts do Server (sem personagem).", onRun: () => engine.run(), getEnabled: () => !engine.isRunning() },
        { id: "stop", label: "Stop", icon: "stop", size: "large", shortcut: "Shift+F5", desc: "Para o Playtest e restaura a cena.", onRun: () => engine.stop(), getEnabled: () => engine.isRunning() },
        { id: "pause", label: "Pause", icon: "pause", size: "small", shortcut: "F7", desc: "Pausa/retoma o Playtest.", onRun: () => engine.togglePause(), getEnabled: () => engine.isRunning(), getActive: () => engine.isPaused() },
      ],
    },
  ];
}




function runDefault(entry) {
  const idx = dropdownDefault.has(entry.id) ? dropdownDefault.get(entry.id) : 0;
  const opt = entry.options[idx] || entry.options[0];
  if (opt && typeof opt.run === "function") opt.run();
}

function openDropdown(entry, anchorEl) {
  const rect = anchorEl.getBoundingClientRect();
  const curIdx = dropdownDefault.has(entry.id) ? dropdownDefault.get(entry.id) : 0;
  const items = entry.options.map((opt, i) => ({
    label: opt.label,
    icon: i === curIdx ? "cursor" : undefined,                              
    onSelect: () => {
      dropdownDefault.set(entry.id, i);                                     
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
  iconWrap.appendChild(createIcon(entry.icon, entry.size === "large" ? 32 : 16));
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

    if (entry.toggle) {
      entry.toggled = !entry.toggled;
      btn.classList.toggle("rsw-rtool--active", entry.toggled);
    }

    try {
      if (entry.options) runDefault(entry);
      else if (typeof entry.onRun === "function") entry.onRun();


      if (ctx && typeof ctx.afterRun === "function") ctx.afterRun();
    } catch (err) {


      console.error(
        `[RSW] Ribbon: erro ao executar "${entry.id}": ` + ((err && err.message) || String(err)),
        (err && err.stack) || err,
      );
    }
  });


  if (entry.toggle && !entry.stateToggle) entry.getActive = () => !!entry.toggled;

  const dispose = attachTooltip(btn, { title: entry.label, desc: entry.desc, shortcut: entry.shortcut });
  ctx.disposers.push(dispose);
  entry.el = btn;
  ctx.entries.push(entry);
  return btn;
}

const MAX_SMALLS_PER_COL = 3;                                                      

export function buildGroupEl(group, ctx) {
  const groupEl = el("div", "rsw-rgroup");
  const toolsRow = el("div", "rsw-rgroup__tools");

  let col = null;                                                      
  let colSmalls = 0;                                                
  const breakCol = () => {
    col = null;
    colSmalls = 0;
  };
  const ensureCol = () => {
    if (!col) {
      col = el("div", "rsw-rgroup__col");
      toolsRow.appendChild(col);
      colSmalls = 0;
    }
  };
  for (const tool of group.tools) {

    if (tool.colBreak) breakCol();

    if (tool.custom && typeof tool.build === "function") {
      ensureCol();
      col.appendChild(tool.build(ctx));
      continue;
    }
    const btn = buildToolButton(tool, ctx);
    if (tool.size === "small") {
      if (colSmalls >= MAX_SMALLS_PER_COL) breakCol();
      ensureCol();
      col.appendChild(btn);
      colSmalls += 1;
    } else {
      breakCol();                                                    
      toolsRow.appendChild(btn);
    }
  }

  const titleEl = el("div", "rsw-rgroup__title");
  titleEl.textContent = group.title;

  groupEl.appendChild(toolsRow);
  groupEl.appendChild(titleEl);
  return groupEl;
}


export function buildRibbonHome() {
  const ctx = { entries: [], disposers: [] };
  const root = el("div", "rsw-ribbon");
  root.setAttribute("role", "toolbar");
  root.setAttribute("aria-label", "Home");

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


  const offSel = bus.on("selection:changed", refresh);
  const offHist = bus.on("history:changed", refresh);
  const offClip = bus.on("clipboard:changed", refresh);

  const offMode = bus.on("runtime:modeChanged", refresh);
  const offPause = bus.on("runtime:pausedChanged", refresh);


  const offConstr = bus.on("constraints:detailsChanged", refresh);
  const offWelds = bus.on("constraints:showWeldsChanged", refresh);
  const offStore = store.subscribe((_s, change) => {
    if (change && (change.key === "activeTool" || change.key === "centralView")) refresh();
  });

  refresh();                  

  function destroy() {
    if (typeof offSel === "function") offSel();
    if (typeof offHist === "function") offHist();
    if (typeof offClip === "function") offClip();
    if (typeof offMode === "function") offMode();            
    if (typeof offPause === "function") offPause();            
    if (typeof offConstr === "function") offConstr();
    if (typeof offWelds === "function") offWelds();
    if (typeof offStore === "function") offStore();
    for (const d of ctx.disposers) {
      try { d(); } catch (_) {            }
    }
    closeContextMenu();
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  ctx.afterRun = refresh;
  return { el: root, refresh, destroy };
}


function buildSnapControl(cfg, ctx) {
  const wrap = el("div", "rsw-snap");
  wrap.dataset.rb = cfg.id;

  const toggle = el("button", "rsw-snap__toggle");
  toggle.type = "button";
  toggle.appendChild(createIcon(cfg.kind === "rotate" ? "rotate" : "move", 14));
  const lbl = el("span", "rsw-snap__label");
  lbl.textContent = cfg.label;
  toggle.appendChild(lbl);

  const input = el("input", "rsw-snap__input");
  input.type = "number";
  input.min = String(SNAP_MIN);
  input.max = String(SNAP_MAX);
  input.step = cfg.kind === "rotate" ? "1" : "0.1";

  function sync() {
    const st = safe(() => getSnapState()[cfg.kind]) || { enabled: false, value: 0 };
    toggle.classList.toggle("rsw-snap__toggle--active", !!st.enabled);
    toggle.setAttribute("aria-pressed", st.enabled ? "true" : "false");
    if (document.activeElement !== input) input.value = String(st.value);
  }

  toggle.addEventListener("click", () => {
    const st = safe(() => getSnapState()[cfg.kind]) || { enabled: false };
    if (cfg.kind === "move") setMoveSnapEnabled(!st.enabled);
    else setRotateSnapEnabled(!st.enabled);
    sync();
  });

  function commitValue() {
    const clamped = cfg.kind === "move" ? setMoveSnapValue(Number(input.value)) : setRotateSnapValue(Number(input.value));
    input.value = String(clamped);
  }
  input.addEventListener("change", commitValue);
  input.addEventListener("blur", commitValue);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") { e.preventDefault(); commitValue(); input.blur(); }
  });

  const dispose = attachTooltip(toggle, { title: `${cfg.label} Snap`, desc: cfg.desc });
  ctx.disposers.push(dispose);
  if (ctx.snapSyncers) ctx.snapSyncers.push(sync);
  sync();

  wrap.appendChild(toggle);
  wrap.appendChild(input);
  return wrap;
}


let activeAlignDialog = null;

function closeAlignDialog() {
  if (activeAlignDialog) {
    activeAlignDialog.dispose();
    activeAlignDialog = null;
  }
}

function openAlignDialog() {
  closeAlignDialog();

  const overlay = el("div", "rsw-modal-overlay");
  const modal = el("div", "rsw-modal rsw-modal--align");
  const header = el("div", "rsw-modal__header");
  const title = el("div", "rsw-modal__title");
  title.textContent = "Align Objects";
  const closeBtn = el("button", "rsw-modal__close");
  closeBtn.type = "button";
  closeBtn.setAttribute("aria-label", "Fechar");
  closeBtn.appendChild(createIcon("close", 14));
  header.appendChild(title);
  header.appendChild(closeBtn);

  const body = el("div", "rsw-align");
  let space = "world";
  const axes = { x: false, y: true, z: false };
  let mode = "center";

  function radioRow(labelText, name, opts, current, onPick) {
    const row = el("div", "rsw-align__row");
    const lab = el("div", "rsw-align__label");
    lab.textContent = labelText;
    row.appendChild(lab);
    const optsEl = el("div", "rsw-align__opts");
    for (const [v, text] of opts) {
      const opt = el("label", "rsw-align__opt");
      const r = el("input");
      r.type = "radio";
      r.name = name;
      r.value = v;
      if (v === current) r.checked = true;
      r.addEventListener("change", () => { if (r.checked) onPick(v); });
      const t = el("span");
      t.textContent = text;
      opt.appendChild(r);
      opt.appendChild(t);
      optsEl.appendChild(opt);
    }
    row.appendChild(optsEl);
    return row;
  }


  body.appendChild(radioRow("Space", "rsw-align-space", [["world", "World"], ["local", "Local"]], space, (v) => { space = v; }));


  const axisRow = el("div", "rsw-align__row");
  const axisLbl = el("div", "rsw-align__label");
  axisLbl.textContent = "Axes";
  axisRow.appendChild(axisLbl);
  const axisOpts = el("div", "rsw-align__opts");
  for (const a of ["x", "y", "z"]) {
    const opt = el("label", "rsw-align__opt");
    const c = el("input");
    c.type = "checkbox";
    c.checked = axes[a];
    c.addEventListener("change", () => { axes[a] = c.checked; });
    const t = el("span");
    t.textContent = a.toUpperCase();
    opt.appendChild(c);
    opt.appendChild(t);
    axisOpts.appendChild(opt);
  }
  axisRow.appendChild(axisOpts);
  body.appendChild(axisRow);


  body.appendChild(radioRow("Align by", "rsw-align-mode", [["min", "Min"], ["center", "Center"], ["max", "Max"]], mode, (v) => { mode = v; }));

  const footer = el("div", "rsw-align__footer");
  const alignBtn = el("button", "rsw-align__btn");
  alignBtn.type = "button";
  alignBtn.textContent = "Align";
  alignBtn.addEventListener("click", () => {
    safe(() => alignAdvanced({ space, axes, mode }));
    closeAlignDialog();
  });
  footer.appendChild(alignBtn);
  body.appendChild(footer);

  modal.appendChild(header);
  modal.appendChild(body);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  const onOverlay = (e) => { if (e.target === overlay) closeAlignDialog(); };
  const onKey = (e) => { if (e.key === "Escape") closeAlignDialog(); };
  overlay.addEventListener("mousedown", onOverlay);
  closeBtn.addEventListener("click", closeAlignDialog);
  document.addEventListener("keydown", onKey, true);

  activeAlignDialog = {
    dispose() {
      document.removeEventListener("keydown", onKey, true);
      if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
    },
  };
}

function buildModelGroups() {
  const surfaceOpts = (Array.isArray(Enums.SurfaceType) ? Enums.SurfaceType : []).map((t) => ({
    label: t,
    run: () => setSurfaceType(t),
  }));
  return [
    {

      title: "Materials",
      tools: [
        { id: "mm-open", label: "Material Manager", icon: "material", size: "large", desc: "Abre o gerenciador de materiais (base + customizados).", onRun: () => bus.emit("materialmanager:toggle") },
      ],
    },
    {
      title: "Tools",
      tools: [
        { id: "m-tool-select", label: "Select", icon: "cursor", size: "large", shortcut: "Q", desc: "Ferramenta de seleção.", onRun: () => tools.set("select"), getActive: () => tools.get() === "select", getEnabled: transformEnabled },
        { id: "m-tool-move", label: "Move", icon: "move", size: "large", shortcut: "W", desc: "Move objetos (gizmo de movimento).", onRun: () => tools.set("move"), getActive: () => tools.get() === "move", getEnabled: transformEnabled },
        { id: "m-tool-scale", label: "Scale", icon: "scale", size: "large", shortcut: "R", desc: "Redimensiona objetos.", onRun: () => tools.set("scale"), getActive: () => tools.get() === "scale", getEnabled: transformEnabled },
        { id: "m-tool-rotate", label: "Rotate", icon: "rotate", size: "large", shortcut: "E", desc: "Rotaciona objetos.", onRun: () => tools.set("rotate"), getActive: () => tools.get() === "rotate", getEnabled: transformEnabled },
        { id: "m-tool-transform", label: "Transform", icon: "transform", size: "large", desc: "Move, escala e rotaciona num único gizmo.", onRun: () => tools.set("transform"), getActive: () => tools.get() === "transform", getEnabled: transformEnabled },
      ],
    },
    {
      title: "Snap to Grid",
      tools: [
        { id: "snap-rotate", custom: true, build: (ctx) => buildSnapControl({ id: "snap-rotate", label: "Rotate", kind: "rotate", desc: "Incremento de rotação dos gizmos (graus). Padrão 45°." }, ctx) },
        { id: "snap-move", custom: true, build: (ctx) => buildSnapControl({ id: "snap-move", label: "Move", kind: "move", desc: "Incremento de movimento dos gizmos (studs). Padrão 1." }, ctx) },
      ],
    },
    {
      title: "Pivot",
      tools: [
        { id: "edit-pivot", label: "Edit Pivot", icon: "move", size: "large", stateToggle: true, desc: "Entra no modo de edição do pivot (Enter/Esc para sair).", onRun: () => togglePivotEdit(), getActive: () => safe(isPivotEditing), getEnabled: () => safe(canEditPivot) },
        { id: "reset-pivot", label: "Reset Pivot", icon: "undo", size: "small", desc: "Reseta o pivot ao centro do objeto.", onRun: () => resetPivot(), getEnabled: () => safe(canEditPivot) },
        { id: "pivot-center", label: "Pivot to Center", icon: "object", size: "small", desc: "Alinha o pivot ao centro geométrico.", onRun: () => pivotToCenter(), getEnabled: () => safe(canEditPivot) },
      ],
    },
    {
      title: "Align",
      tools: [
        { id: "align-tool", label: "Align", icon: "align", size: "large", desc: "Abre o diálogo de alinhamento avançado.", onRun: () => openAlignDialog(), getEnabled: () => safe(canAlign) },
        { id: "align-left", label: "Align Left", icon: "align", size: "small", desc: "Alinha pela borda esquerda (X mín).", onRun: () => alignLeft(), getEnabled: () => safe(canAlign) },
        { id: "align-centerh", label: "Align Center", icon: "align", size: "small", desc: "Alinha pelo centro horizontal (X).", onRun: () => alignCenterH(), getEnabled: () => safe(canAlign) },
        { id: "align-right", label: "Align Right", icon: "align", size: "small", desc: "Alinha pela borda direita (X máx).", onRun: () => alignRight(), getEnabled: () => safe(canAlign) },
        { id: "align-top", label: "Align Top", icon: "align", size: "small", desc: "Alinha pelo topo (Y máx).", onRun: () => alignTop(), getEnabled: () => safe(canAlign) },
        { id: "align-middle", label: "Align Middle", icon: "align", size: "small", desc: "Alinha pelo meio vertical (Y).", onRun: () => alignMiddle(), getEnabled: () => safe(canAlign) },
        { id: "align-bottom", label: "Align Bottom", icon: "align", size: "small", desc: "Alinha pela base (Y mín).", onRun: () => alignBottom(), getEnabled: () => safe(canAlign) },
        { id: "dist-h", label: "Distribute H", icon: "align", size: "small", desc: "Distribui espaçamento horizontal (X).", onRun: () => distributeHorizontally(), getEnabled: () => safe(canDistribute) },
        { id: "dist-v", label: "Distribute V", icon: "align", size: "small", desc: "Distribui espaçamento vertical (Y).", onRun: () => distributeVertically(), getEnabled: () => safe(canDistribute) },
      ],
    },
    {
      title: "Solid Modeling",
      tools: [
        { id: "union", label: "Union", icon: "group", size: "large", desc: "Combina 2+ Parts em uma UnionOperation.", onRun: () => unionSelection(), getEnabled: () => safe(canUnion) },
        { id: "negate", label: "Negate", icon: "part", size: "large", desc: "Marca Part(s) como NegateOperation (negativo).", onRun: () => negateSelection(), getEnabled: () => safe(canNegate) },
        { id: "separate", label: "Separate", icon: "ungroup", size: "large", desc: "Separa uma Union nas Parts originais.", onRun: () => separateSelection(), getEnabled: () => safe(canSeparate) },
      ],
    },
    {
      title: "Constraints",
      tools: [
        { id: "anchored", label: "Anchored", icon: "lock", size: "large", stateToggle: true, desc: "Alterna a propriedade Anchored da seleção.", onRun: () => toggleAnchored(), getActive: () => safe(getAnchoredActive), getEnabled: () => safe(canToggleAnchored) },
        { id: "cancollide", label: "CanCollide", icon: "part", size: "small", stateToggle: true, desc: "Alterna a propriedade CanCollide da seleção.", onRun: () => toggleCanCollide(), getActive: () => safe(getCanCollideActive), getEnabled: () => safe(canToggleAnchored) },
        { id: "show-constraint-details", label: "Show Details", icon: "find", size: "small", stateToggle: true, desc: "Mostra indicadores 3D de constraints e attachments no viewport.", onRun: () => toggleConstraintDetails(), getActive: () => safe(isConstraintDetailsVisible) },
      ],
    },
    {
      title: "Advanced",
      tools: [
        { id: "collision-groups", label: "Collision Groups", icon: "group", size: "large", desc: "Gerencia grupos de colis\u00e3o (PhysicsService) e a matriz de colidibilidade.", onRun: () => openCollisionGroupsDialog() },
      ],
    },
    {
      title: "Surface Joints",
      tools: [
        { id: "surface", label: "Surface", icon: "material", size: "large", desc: "Define o tipo de superfície das faces da seleção.", getEnabled: () => safe(canSetSurface), options: surfaceOpts },
      ],
    },
    {
      title: "Lock",
      tools: [
        { id: "model-lock", label: "Lock", icon: "lock", size: "large", stateToggle: true, shortcut: "L", desc: "Bloqueia/desbloqueia a seleção.", onRun: () => toggleLockSelection(), getActive: () => safe(getLockActive), getEnabled: () => safe(canLock) },
        { id: "unlock-all", label: "Unlock All", icon: "lock", size: "small", desc: "Desbloqueia todos os objetos da cena.", onRun: () => unlockAll(), getEnabled: () => safe(canUnlockAll) },
      ],
    },
  ];
}

export function buildRibbonModel() {
  const ctx = { entries: [], disposers: [], snapSyncers: [] };
  const root = el("div", "rsw-ribbon");
  root.setAttribute("role", "toolbar");
  root.setAttribute("aria-label", "Model");

  const groups = buildModelGroups();
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
    for (const sync of ctx.snapSyncers) { try { sync(); } catch (_) {            } }
  }
  ctx.afterRun = refresh;

  const offSel = bus.on("selection:changed", refresh);
  const offHist = bus.on("history:changed", refresh);
  const offSettings = bus.on("settings:changed", refresh);
  const offPivot = bus.on("pivot:modeChanged", refresh);
  const offConstr = bus.on("constraints:detailsChanged", refresh);
  const offStore = store.subscribe((_s, change) => {
    if (change && (change.key === "activeTool" || change.key === "centralView")) refresh();
  });

  refresh();

  function destroy() {
    [offSel, offHist, offSettings, offPivot, offConstr, offStore].forEach((f) => { if (typeof f === "function") f(); });
    for (const d of ctx.disposers) { try { d(); } catch (_) {            } }
    closeContextMenu();
    closeAlignDialog();
    if (root.parentNode) root.parentNode.removeChild(root);
  }

  return { el: root, refresh, destroy };
}
