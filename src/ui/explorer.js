import { store } from "../core/state.js";
import { bus } from "../core/eventBus.js";
import { logger } from "../core/logger.js";
import { createIcon } from "./icons.js";
import { flattenVisible, computeWindow } from "./treeVirtual.js";
import { selection } from "../core/selection.js";
import { Events } from "../datamodel/index.js";
import { streaming } from "../runtime/streaming.js";            
import { openContextMenu } from "./contextMenu.js";
import { getPluginContextMenuItems } from "../plugins/pluginHost.js";            
import { persistence } from "../persistence/persistence.js";            
import { openInsertFromFile } from "./dialogs/projectDialogs.js";            
import { openTagEditorFor } from "./tagEditor.js";            
import * as packages from "../packages/packages.js";            
import { openConvertToPackageDialog, openPackageManagerDialog } from "./packageManagerDialog.js";            
import {
  INSERTABLE_CLASSES,
  insertAnyClass,
  insertEffect,
  insertSound,
  insertSoundGroup,
  insertSoundEffect,
  SOUND_EFFECT_CLASSES,
  insertObjectUnder,
  cutSelection,
  copySelection,
  pasteInto,
  hasClipboard,
  renameInstance,
  canRename,
  reparentInstances,
  canReparent,
  selectChildren,
  selectAll,
  groupSelection,
  ungroupSelection,
  canGroup,
  canUngroup,
  isProtectedInstance,
  getWorkspaceRoot,
} from "../core/editOps.js";


const SCRIPT_CLASSES = { Script: 1, LocalScript: 1, ModuleScript: 1 };


const LIGHTING_CHILD_CLASSES = Object.freeze([
  "ReflectionProbe",                                                     
  "Atmosphere",
  "Sky",
  "BlurEffect",
  "BloomEffect",
  "ColorCorrectionEffect",
  "DepthOfFieldEffect",
  "SunRaysEffect",
]);

const PART_LIGHT_CLASSES = Object.freeze(["PointLight", "SpotLight", "SurfaceLight", "RectLight", "TubeLight"]);          
import { cloneSelection, deleteSelection } from "../viewport/objectOps.js";

const INDENT = 14;                                        
const BASE_PAD = 6;                   
const SEARCH_DEBOUNCE = 160;      
const DRAG_THRESHOLD = 5;                                              


const CLASS_ICON = {

  PackageLink: "packageLink",
  Highlight: "highlight",
  SelectionBox: "selectionBox",
  SelectionSphere: "selectionSphere",
  DragDetector: "dragDetector",
  UIDragDetector: "uiDragDetector",
  Handles: "handles",
  ArcHandles: "arcHandles",

  MeshPart: "meshpart",
  IKControl: "ikcontrol",            
  SpecialMesh: "specialmesh",
  Decal: "decal",
  Texture: "texture",
  SurfaceAppearance: "surfaceappearance",
  MaterialVariant: "materialvariant",
  MaterialService: "material",
  LocalizationService: "localization",
  LocalizationTable: "localization",

  RemoteEvent: "remoteevent",
  RemoteFunction: "remotefunction",
  BindableEvent: "bindableevent",
  BindableFunction: "bindablefunction",

  SpawnLocation: "part",
  TrussPart: "part",
  ForceField: "instance",

  Players: "teams",
  Player: "avatar",
  PlayerGui: "screengui",
  PlayerScripts: "folder",
  Backpack: "starterpack",
  StarterGear: "starterpack",
  StarterPlayerScripts: "folder",
  StarterCharacterScripts: "folder",

  Sound: "sound",
  SoundGroup: "soundGroup",
  EqualizerSoundEffect: "soundEffect",
  ReverbSoundEffect: "soundEffect",
  DistortionSoundEffect: "soundEffect",
  ChorusSoundEffect: "soundEffect",
  CompressorSoundEffect: "soundEffect",
  EchoSoundEffect: "soundEffect",
  FlangeSoundEffect: "soundEffect",
  PitchShiftSoundEffect: "soundEffect",
  TremoloSoundEffect: "soundEffect",
  DataModel: "datamodel",
  Workspace: "workspace",
  Camera: "camera",
  Terrain: "terrain",
  Part: "part",
  BasePart: "part",
  Model: "model",
  Folder: "folder",
  Script: "script",
  LocalScript: "localscript",
  ModuleScript: "modulescript",
  Lighting: "lighting",
  ReplicatedStorage: "replicatedstorage",
  ServerStorage: "serverstorage",
  ServerScriptService: "serverscriptservice",
  StarterGui: "startergui",
  StarterPack: "starterpack",
  StarterPlayer: "starterplayer",
  SoundService: "soundservice",
  TweenService: "tweenservice",            
  UserInputService: "userinputservice",            
  ContextActionService: "contextactionservice",            
  Teams: "teams",

  ParticleEmitter: "particle",
  Beam: "beam",
  Trail: "trail",
  Fire: "fire",
  Smoke: "smoke",
  Sparkles: "sparkles",
  Explosion: "explosion",

  ScreenGui: "screengui",
  BillboardGui: "billboardgui",
  SurfaceGui: "surfacegui",
  Frame: "frame",
  ScrollingFrame: "scrollingframe",
  ViewportFrame: "viewportframe",
  TextLabel: "textlabel",
  ImageLabel: "imagelabel",
  TextButton: "textbutton",
  ImageButton: "imagebutton",
  TextBox: "textbox",
  VideoFrame: "videoframe",
  SelectionBox: "selectionbox",
  UIListLayout: "uilayout",
  UIPageLayout: "uilayout",
  UIGridLayout: "uigrid",
  UITableLayout: "uigrid",
  UIAspectRatioConstraint: "uiconstraint",
  UISizeConstraint: "uiconstraint",
  UITextSizeConstraint: "uiconstraint",
  UICorner: "uicorner",
  UIStroke: "uistroke",
  UIGradient: "uigradient",
  UIPadding: "uipadding",

  Accessory: "accessory",
  Accoutrement: "accessory",
  WrapLayer: "wraplayer",
  WrapTarget: "wraptarget",

  Tool: "tool",
  ClickDetector: "clickdetector",
  ProximityPrompt: "proximityprompt",
  Seat: "seat",
  VehicleSeat: "vehicleseat",

  PathfindingService: "pathservice",
  PathfindingModifier: "pathmodifier",
  PathfindingLink: "pathlink",

  CollectionService: "tag",
  StringValue: "stringvalue",
  BoolValue: "boolvalue",
  IntValue: "intvalue",
  NumberValue: "numbervalue",
  ObjectValue: "objectvalue",
  Color3Value: "color3value",
  BrickColorValue: "brickcolorvalue",
  Vector3Value: "vector3value",
  CFrameValue: "cframevalue",
  RayValue: "rayvalue",
  IntConstrainedValue: "intconstrainedvalue",
  DoubleConstrainedValue: "doubleconstrainedvalue",
};

function iconNameFor(className) {
  return CLASS_ICON[className] || "instance";
}

function el(tag, cls) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}

function liveInst(i) {
  return (
    i &&
    i.__isInstance === true &&
    typeof i.isDestroyed === "function" &&
    !i.isDestroyed()
  );
}

export function buildExplorer(body) {
  if (!body) throw new Error("Explorer: corpo do painel ausente.");
  selection.wire();

  body.classList.add("rsw-explorer");


  const searchWrap = el("div", "rsw-explorer__search");
  const searchIcon = createIcon("find", 13);
  searchIcon.classList.add("rsw-explorer__search-icon");
  const input = document.createElement("input");
  input.type = "text";
  input.className = "rsw-explorer__input";
  input.placeholder = "Buscar";
  input.setAttribute("aria-label", "Buscar na hierarquia");
  searchWrap.append(searchIcon, input);


  const viewSel = el("div", "rsw-explorer__viewsel");
  viewSel.hidden = true;
  const viewBtns = {};
  for (const m of ["server", "client"]) {
    const b = document.createElement("button");
    b.type = "button";
    b.className = "rsw-explorer__viewbtn";
    b.textContent = m === "server" ? "Server" : "Client";
    b.setAttribute("title", m === "server" ? "Server View (DataModel completo)" : "Client View (apenas a réplica do Client)");
    b.addEventListener("click", () => setViewMode(m));
    viewBtns[m] = b;
    viewSel.appendChild(b);
  }
  viewBtns.server.classList.add("rsw-explorer__viewbtn--active");


  const tree = el("div", "rsw-tree");
  tree.setAttribute("role", "tree");
  tree.setAttribute("aria-label", "Explorer Panel");
  tree.tabIndex = 0;
  const virtual = el("div", "rsw-tree__virtual");
  tree.appendChild(virtual);

  body.replaceChildren(searchWrap, viewSel, tree);


  const ROW_H = 20;                                                         
  const rows = new Map();                                                        
  const rowPool = [];                                             
  let visList = [];                                                  
  let indexOf = new Map();                           
  let listDirty = true;
  let renderPending = false;
  const expanded = new Set();                                       
  let filterSet = null;                                                
  let viewMode = "server";                                               
  let playtestRunning = false;                             
  let dataModel = null;
  let renaming = null;                                            
  let drag = null;                                                 
  let suppressClick = false;                                           

  const isExpanded = (id) => expanded.has(id);






  function viewHides(inst) {
    if (!playtestRunning || !inst) return false;


    if (viewMode === "client" && !streaming.isLoadedForActive(inst)) return true;
    let p = inst;
    while (p) {
      if (viewMode === "client") {
        if (p.className === "ServerStorage" || p.className === "ServerScriptService") return true;
      } else if (p.__netContext === "client") {
        return true;
      }
      p = typeof p.getParent === "function" ? p.getParent() : null;
    }
    return false;
  }

  function applyViewVisibility() {
    markDirty();
  }

  function setViewMode(mode) {
    const m = mode === "client" ? "client" : "server";
    if (viewMode === m) return;
    viewMode = m;
    viewBtns.server.classList.toggle("rsw-explorer__viewbtn--active", m === "server");
    viewBtns.client.classList.toggle("rsw-explorer__viewbtn--active", m === "client");
    applyViewVisibility();

    const keep = selection.get().filter((i) => liveInst(i) && !viewHides(i));
    if (keep.length !== selection.get().length) {
      if (keep.length) selection.setRange(keep);
      else selection.clear();
    }
  }


  function updatePackageBadge(instance, badgeEl) {
    badgeEl.textContent = "";
    let link = null;
    try {
      link = instance.getChildren().find((c) => c.className === "PackageLink" && !c.isDestroyed()) || null;
    } catch (_) { link = null; }
    if (!link) {
      badgeEl.hidden = true;
      badgeEl.title = "";
      return;
    }
    badgeEl.hidden = false;
    const chain = createIcon("packageLink", 10);
    badgeEl.appendChild(chain);
    const status = String(link.getProperty("Status") || "UpToDate");
    if (status !== "UpToDate") {
      const warn = createIcon("packageWarn", 10);
      warn.style.color = "#e8b339";
      badgeEl.appendChild(warn);
    }
    badgeEl.title = "Package \u00b7 " + status;
  }


  function makeRowEl() {
    const rowEl = el("div", "rsw-row");
    rowEl.setAttribute("role", "treeitem");
    const twistyEl = el("span", "rsw-twisty");
    const iconEl = createIcon("instance", 14);
    iconEl.classList.add("rsw-row__icon");
    const pkgBadgeEl = el("span", "rsw-pkgbadge");
    pkgBadgeEl.style.cssText = "display:inline-flex;align-items:center;gap:1px;margin-right:2px;flex-shrink:0;color:#7aa7d6;";
    const labelEl = el("span", "rsw-row__label");
    rowEl.append(twistyEl, iconEl, pkgBadgeEl, labelEl);
    virtual.appendChild(rowEl);
    return { instance: null, depth: 0, rowEl, twistyEl, iconEl, iconName: "instance", pkgBadgeEl, labelEl };
  }

  function refreshRow(st) {
    const inst = st.instance;
    st.rowEl.dataset.id = inst.id;
    st.twistyEl.dataset.twisty = inst.id;
    st.rowEl.style.paddingLeft = BASE_PAD + st.depth * INDENT + "px";
    const icon = iconNameFor(inst.className);
    if (icon !== st.iconName) {
      const next = createIcon(icon, 14);
      next.classList.add("rsw-row__icon");
      st.rowEl.replaceChild(next, st.iconEl);
      st.iconEl = next;
      st.iconName = icon;
    }
    st.labelEl.textContent = inst.name;                                    
    st.labelEl.title = inst.name;
    updatePackageBadge(inst, st.pkgBadgeEl);
    const has = inst.getChildren().length > 0;
    const open = has && (filterSet ? true : isExpanded(inst.id));
    st.twistyEl.classList.toggle("rsw-twisty--has", has);
    st.twistyEl.classList.toggle("rsw-twisty--open", open);
    if (has) st.rowEl.setAttribute("aria-expanded", open ? "true" : "false");
    else st.rowEl.removeAttribute("aria-expanded");
    st.rowEl.classList.toggle("rsw-row--selected", selection.isSelected(inst));
  }

  function unbindRow(st) {
    if (renaming && renaming.st === st) cancelRename();
    rows.delete(st.instance.id);
    st.instance = null;
    st.rowEl.style.display = "none";
    rowPool.push(st);
  }


  function rebuildList() {
    listDirty = false;
    visList = dataModel
      ? flattenVisible({
          roots: [dataModel],
          isExpanded,
          filterSet,
          hides: (inst) => viewHides(inst),
        })
      : [];
    indexOf.clear();
    for (let i = 0; i < visList.length; i++) indexOf.set(visList[i].inst.id, i);
  }

  function markDirty() {
    listDirty = true;
    scheduleRender();
  }

  function scheduleRender() {
    if (renderPending) return;
    renderPending = true;
    requestAnimationFrame(() => {
      renderPending = false;
      render();
    });
  }

  function render() {
    if (listDirty) rebuildList();
    virtual.style.height = Math.max(1, visList.length * ROW_H) + "px";
    const { first, last } = computeWindow({
      scrollTop: tree.scrollTop,
      viewportHeight: tree.clientHeight || 400,
      rowHeight: ROW_H,
      total: visList.length,
    });
    const need = new Map();
    for (let i = first; i <= last; i++) {
      if (visList[i]) need.set(visList[i].inst.id, i);
    }
    for (const st of [...rows.values()]) {
      if (!need.has(st.instance.id)) unbindRow(st);
    }
    for (const [id, i] of need) {
      let st = rows.get(id);
      if (!st) {
        st = rowPool.pop() || makeRowEl();
        st.instance = visList[i].inst;
        st.rowEl.style.display = "";
        rows.set(id, st);
      }
      st.depth = visList[i].depth;
      st.rowEl.style.top = i * ROW_H + "px";
      refreshRow(st);
    }
  }


  if (typeof ResizeObserver !== "undefined") {
    const treeResizeObs = new ResizeObserver(() => scheduleRender());
    treeResizeObs.observe(tree);
  }

  function scrollToIndex(i) {
    if (i == null || i < 0) return;
    const top = i * ROW_H;
    const bottom = top + ROW_H;
    if (top < tree.scrollTop) tree.scrollTop = top;
    else if (bottom > tree.scrollTop + tree.clientHeight) tree.scrollTop = bottom - tree.clientHeight;
  }

  function renderAll() {
    markDirty();
    render();
  }


  function onChildAdded(parent, child) {
    if (!parent || !child) return;
    if (filterSet) scheduleFilter();                                             
    markDirty();
  }

  function removeNode(instance) {
    if (!instance) return;
    if (expanded.has(instance.id)) expanded.delete(instance.id);
    markDirty();
  }

  function onName(instance) {
    const st = rows.get(instance.id);
    if (st) {
      st.labelEl.textContent = instance.name;              
      st.labelEl.title = instance.name;
    }
    if (filterSet) scheduleFilter();
  }


  function forEachInstance(fn) {
    if (!dataModel) return;
    const stack = [dataModel];
    while (stack.length) {
      const inst = stack.pop();
      fn(inst);
      const ch = inst.getChildren();
      for (let i = ch.length - 1; i >= 0; i--) stack.push(ch[i]);
    }
  }

  function toggleExpand(id) {
    const st = rows.get(id);
    if (!st || !st.instance) return;
    if (st.instance.getChildren().length === 0) return;                        
    if (expanded.has(id)) expanded.delete(id);
    else expanded.add(id);
    markDirty();
    render();
  }

  function expandAll() {
    forEachInstance((inst) => {
      if (inst.getChildren().length > 0) expanded.add(inst.id);
    });
    markDirty();
    render();
  }

  function collapseAll() {
    expanded.clear();
    if (dataModel) expanded.add(dataModel.id);                         
    markDirty();
    render();
  }

  function ensureExpanded(inst) {
    if (!inst) return;
    if (inst.getChildren().length && !expanded.has(inst.id)) {
      expanded.add(inst.id);
      markDirty();
      render();
    }
  }


  let filterTimer = 0;
  function scheduleFilter() {
    if (filterTimer) clearTimeout(filterTimer);
    filterTimer = setTimeout(applyFilter, SEARCH_DEBOUNCE);
  }

  function applyFilter() {
    filterTimer = 0;
    const q = String(input.value || "").trim().toLowerCase();
    if (!q) {
      filterSet = null;
      markDirty();
      render();
      return;
    }

    const set = new Set();
    forEachInstance((inst) => {
      const name = String(inst.name || "").toLowerCase();
      if (name.includes(q)) {
        let cur = inst;
        while (cur && !set.has(cur.id)) {
          set.add(cur.id);
          cur = cur.getParent();
        }
      }
    });
    filterSet = set;
    markDirty();
    render();
  }


  function computeVisibleList() {
    if (listDirty) rebuildList();
    return visList.map((it) => it.inst);
  }


  function instFromRow(rowEl) {
    const id = rowEl && rowEl.dataset ? rowEl.dataset.id : null;
    if (!id) return null;
    const st = rows.get(id);
    if (!st) return null;
    if (typeof st.instance.isDestroyed === "function" && st.instance.isDestroyed())
      return null;
    return st.instance;
  }

  function refreshSelection() {
    if (listDirty) rebuildList();
    const sel = new Set(selection.ids());
    for (const st of rows.values()) {
      st.rowEl.classList.toggle("rsw-row--selected", sel.has(st.instance.id));
    }


    if (
      sel.size &&
      typeof store.getViewOption === "function" &&
      store.getViewOption("explorerFocus") !== false
    ) {
      let firstIdx = null;
      for (const id of sel) {
        const i = indexOf.get(id);
        if (i != null && (firstIdx == null || i < firstIdx)) firstIdx = i;
      }
      if (firstIdx != null) scrollToIndex(firstIdx);
    }
    scheduleRender();
  }


  function startRename(inst) {
    if (!canRename(inst)) return;
    cancelRename();                                                      
    let st = rows.get(inst.id);
    if (!st) {

      let p = typeof inst.getParent === "function" ? inst.getParent() : null;
      while (p) {
        expanded.add(p.id);
        p = typeof p.getParent === "function" ? p.getParent() : null;
      }
      listDirty = true;
      rebuildList();
      const idx = indexOf.get(inst.id);
      if (idx == null) return;
      scrollToIndex(idx);
      render();
      st = rows.get(inst.id);
      if (!st) return;
    }

    const original = inst.name;
    const field = document.createElement("input");
    field.type = "text";
    field.className = "rsw-row__rename";
    field.value = original;
    field.maxLength = 200;                                  
    field.setAttribute("aria-label", "Renomear objeto");

    st.labelEl.style.display = "none";
    st.rowEl.insertBefore(field, st.labelEl.nextSibling);
    renaming = { inst, st, field };

    let finished = false;
    const finish = (commit) => {
      if (finished) return;
      finished = true;
      const val = field.value;
      if (field.parentNode) field.parentNode.removeChild(field);
      st.labelEl.style.display = "";
      renaming = null;
      if (commit) renameInstance(inst, val);                                      

      if (liveInst(inst)) {
        st.labelEl.textContent = inst.name;
        st.labelEl.title = inst.name;
      }
    };

    field.addEventListener("keydown", (e) => {
      e.stopPropagation();                                           
      if (e.key === "Enter") {
        e.preventDefault();
        finish(true);
      } else if (e.key === "Escape") {
        e.preventDefault();
        finish(false);                                   
      }
    });
    field.addEventListener("blur", () => finish(true));                        
    field.addEventListener("pointerdown", (e) => e.stopPropagation());
    field.addEventListener("dblclick", (e) => e.stopPropagation());


    requestAnimationFrame(() => {
      field.focus();
      field.select();
    });
  }

  function cancelRename() {
    if (!renaming) return;
    const { field, st } = renaming;
    if (field && field.parentNode) field.parentNode.removeChild(field);
    if (st) st.labelEl.style.display = "";
    renaming = null;
  }


  function insertSubmenu(parentGetter) {
    return INSERTABLE_CLASSES.map((cls) => ({
      label: cls,
      icon: iconNameFor(cls),
      onSelect: () => insertObjectUnder(cls, parentGetter()),
    }));
  }


  function contextInsertItems(inst) {
    let extra = [];
    if (inst.className === "Lighting") {

      const hasAtmosphere = inst.getChildren().some((c) => c.className === "Atmosphere");
      extra = LIGHTING_CHILD_CLASSES.map((cls) => ({
        label: cls,
        icon: iconNameFor(cls),
        disabled: cls === "Atmosphere" && hasAtmosphere,
        onSelect: () => insertAnyClass(cls, inst),
      }));
    } else if (inst.hasProperty && inst.hasProperty("Anchored")) {

      extra = PART_LIGHT_CLASSES.map((cls) => ({
        label: cls,
        icon: iconNameFor(cls),
        onSelect: () => insertAnyClass(cls, inst),
      }));


      const appearanceClasses = ["Decal", "Texture", "SpecialMesh"];
      if (inst.className === "MeshPart") appearanceClasses.push("SurfaceAppearance");
      extra = extra.concat(
        appearanceClasses.map((cls) => ({
          label: cls,
          icon: iconNameFor(cls),
          onSelect: () => insertAnyClass(cls, inst),
        })),
      );
    } else if (inst.className === "LocalizationService") {
      extra = [{
        label: "LocalizationTable",
        icon: iconNameFor("LocalizationTable"),
        onSelect: () => insertAnyClass("LocalizationTable", inst),
      }];
    } else if (inst.className === "ReplicatedStorage" || inst.className === "ServerScriptService") {

      extra = ["RemoteEvent", "RemoteFunction", "BindableEvent", "BindableFunction"].map((cls) => ({
        label: cls,
        icon: iconNameFor(cls),
        onSelect: () => insertAnyClass(cls, inst),
      }));
    }
    return extra.length ? extra.concat([{ type: "separator" }]) : [];
  }

  function buildEmptyAreaMenu() {
    return [
      {
        label: "Insert Object",
        icon: "instance",
        submenu: insertSubmenu(() => getWorkspaceRoot()),
      },
      { type: "separator" },
      {
        label: "Paste",
        icon: "duplicate",
        shortcut: "Ctrl+V",
        disabled: !hasClipboard(),
        onSelect: () => pasteInto(getWorkspaceRoot()),
      },
      { type: "separator" },
      { label: "Select All", onSelect: () => selectAll() },
      { type: "separator" },
      { label: "Expand All", onSelect: expandAll },
      { label: "Collapse All", onSelect: collapseAll },
    ];
  }

  function buildInstanceMenu(inst) {
    const prot = isProtectedInstance(inst);
    const hasChildren = inst.getChildren().length > 0;
    const items = [];
    if (SCRIPT_CLASSES[inst.className]) {
      items.push({ label: "Open Script", icon: "script", onSelect: () => bus.emit("editor:openScript", inst) });
      items.push({ type: "separator" });
    }
    if (inst.className === "LocalizationService" || inst.className === "LocalizationTable") {
      items.push({
        label: "Open Localization Editor",
        icon: "localization",
        onSelect: () => bus.emit("localizationeditor:open", { table: inst.className === "LocalizationTable" ? inst : null }),
      });
      items.push({ type: "separator" });
    }


    const pkgLink = packages.linkOf(inst);
    if (pkgLink) {
      const pkgStatus = String(pkgLink.getProperty("Status") || "UpToDate");
      const pkgId = String(pkgLink.getProperty("PackageId") || "");
      items.push({
        label: "Publish to Package",
        icon: "packageLink",
        disabled: pkgStatus !== "Modified",
        onSelect: () => { packages.publishFromCopy(inst); },
      });
      items.push({
        label: "Update Package",
        icon: "packageWarn",
        disabled: pkgStatus !== "OutOfDate",
        onSelect: () => { packages.updateCopy(inst); },
      });
      items.push({
        label: "Update All Copies",
        icon: "packageWarn",
        onSelect: () => { packages.updateAllCopies(pkgId); },
      });
      items.push({
        label: "Undo Changes to Package",
        icon: "packageLink",
        disabled: pkgStatus !== "Modified",
        onSelect: () => { packages.revertCopy(inst); },
      });
      items.push({
        label: "Unlink Package",
        icon: "packageLink",
        disabled: prot,
        onSelect: () => { packages.unlinkCopy(inst); },
      });
      items.push({
        label: "Package Manager\u2026",
        icon: "packageLink",
        onSelect: () => { openPackageManagerDialog(); },
      });
      items.push({ type: "separator" });
    } else if (!prot && inst.className !== "PackageLink") {
      items.push({
        label: "Convert to Package\u2026",
        icon: "packageLink",
        onSelect: () => { openConvertToPackageDialog(inst); },
      });
      items.push({ type: "separator" });
    }
    items.push({
      label: "Insert Object",
      icon: "instance",
      submenu: contextInsertItems(inst).concat(insertSubmenu(() => inst)),
    });

    if (typeof inst.hasProperty === "function" && inst.hasProperty("Anchored")) {
      items.push({
        label: "Insert Effect",
        icon: "effect",
        submenu: ["ParticleEmitter", "Beam", "Trail", "Fire", "Smoke", "Sparkles", "Explosion"].map((cls) => ({
          label: cls,
          icon: CLASS_ICON[cls] || "effect",
          onSelect: () => insertEffect(cls, inst),
        })),
      });
    }

    if (
      (typeof inst.hasProperty === "function" && inst.hasProperty("Anchored")) ||
      inst.className === "Attachment" ||
      inst.className === "Workspace"
    ) {
      items.push({ label: "Insert Sound", icon: "sound", onSelect: () => insertSound(inst) });
    }
    if (inst.className === "SoundService" || inst.className === "SoundGroup") {
      items.push({ label: "Insert SoundGroup", icon: "soundGroup", onSelect: () => insertSoundGroup(inst) });
    }
    if (inst.className === "SoundService" || inst.className === "Sound" || inst.className === "SoundGroup") {
      items.push({
        label: "Insert Sound Effect",
        icon: "soundEffect",
        submenu: SOUND_EFFECT_CLASSES.map((cls) => ({
          label: cls,
          icon: "soundEffect",
          onSelect: () => insertSoundEffect(cls, inst),
        })),
      });
    }
    items.push(

      { label: "Insert from File\u2026", icon: "folder", onSelect: () => openInsertFromFile(inst) },
      {
        label: "Export Selection\u2026",
        icon: "folder",
        disabled: prot,
        onSelect: () => {
          if (!selection.get().includes(inst)) selection.selectSingle(inst);
          persistence.exportSelectionToFile();
        },
      },
      { type: "separator" },
      { label: "Cut", shortcut: "Ctrl+X", disabled: prot, onSelect: () => cutSelection() },
      { label: "Copy", shortcut: "Ctrl+C", disabled: prot, onSelect: () => copySelection() },
      {
        label: "Paste Into",
        shortcut: "Ctrl+Shift+V",
        disabled: !hasClipboard(),
        onSelect: () => pasteInto(inst),
      },
      {
        label: "Duplicate",
        icon: "duplicate",
        shortcut: "Ctrl+D",
        disabled: prot,
        onSelect: () => cloneSelection(),
      },
      { label: "Delete", icon: "trash", shortcut: "Del", disabled: prot, onSelect: () => deleteSelection() },
      { type: "separator" },
      { label: "Edit Tags\u2026", icon: "tag", onSelect: () => openTagEditorFor(inst) },
      { type: "separator" },
      { label: "Rename", shortcut: "F2", disabled: !canRename(inst), onSelect: () => startRename(inst) },


      { label: "Group", shortcut: "Ctrl+G", disabled: !canGroup(), onSelect: () => groupSelection() },
      { label: "Ungroup", shortcut: "Ctrl+U", disabled: !canUngroup(), onSelect: () => ungroupSelection() },
      { type: "separator" },
      { label: "Select Children", disabled: !hasChildren, onSelect: () => selectChildren(inst) },
      { label: "Select All", onSelect: () => selectAll() },
      { type: "separator" },
      { label: "Expand All", onSelect: expandAll },
      { label: "Collapse All", onSelect: collapseAll },
    );
    return items;
  }


  function makeDragGhost(items) {
    const g = el("div", "rsw-drag-ghost");
    g.textContent =
      items.length === 1 ? items[0].name : `${items.length} objetos`;
    return g;
  }

  function clearDropHighlight() {
    if (drag && drag.overRowEl) {
      drag.overRowEl.classList.remove("rsw-row--droptarget", "rsw-row--dropinvalid");
      drag.overRowEl = null;
    }
  }

  function endDrag() {
    if (!drag) return;
    if (drag.ghost && drag.ghost.parentNode) {
      drag.ghost.parentNode.removeChild(drag.ghost);
    }
    clearDropHighlight();
    tree.classList.remove("rsw-tree--dragging");
    if (drag.pointerId != null) {
      try {
        tree.releasePointerCapture(drag.pointerId);
      } catch (_) {

      }
    }
    drag = null;
  }

  function updateDragVisual() {
    if (!drag || !drag.started) {
      if (drag) drag.rafPending = false;
      return;
    }
    drag.rafPending = false;
    const x = drag.lastX;
    const y = drag.lastY;
    if (drag.ghost) {
      drag.ghost.style.left = `${x + 12}px`;
      drag.ghost.style.top = `${y + 8}px`;
    }
    const elAt = document.elementFromPoint(x, y);
    const rowEl = elAt && elAt.closest ? elAt.closest(".rsw-row") : null;
    if (drag.overRowEl && drag.overRowEl !== rowEl) {
      drag.overRowEl.classList.remove("rsw-row--droptarget", "rsw-row--dropinvalid");
    }
    drag.overRowEl = rowEl && tree.contains(rowEl) ? rowEl : null;
    let validHere = false;
    if (drag.overRowEl) {
      const targetInst = instFromRow(drag.overRowEl);
      if (targetInst) {
        validHere = drag.items.some((it) => canReparent(it, targetInst));
        drag.overRowEl.classList.toggle("rsw-row--droptarget", validHere);
        drag.overRowEl.classList.toggle("rsw-row--dropinvalid", !validHere);
      }
    }
    if (drag.ghost) {
      drag.ghost.classList.toggle("is-invalid", !!drag.overRowEl && !validHere);
    }
  }


  tree.addEventListener("click", (e) => {
    if (suppressClick) {
      suppressClick = false;
      if (typeof e.stopPropagation === "function") e.stopPropagation();
      return;
    }
    if (typeof tree.focus === "function") tree.focus();
    const t = e.target;
    if (!t || typeof t.closest !== "function") return;


    const tw = t.closest("[data-twisty]");
    if (tw) {
      toggleExpand(tw.dataset.twisty);
      if (typeof e.stopPropagation === "function") e.stopPropagation();
      return;
    }

    const rowEl = t.closest(".rsw-row");
    if (!rowEl) {
      selection.clear();                        
      return;
    }
    const inst = instFromRow(rowEl);
    if (!inst) return;                                                         

    const shift = !!e.shiftKey;
    const ctrl = !!(e.ctrlKey || e.metaKey);

    if (shift && selection.getAnchor()) {
      const vis = computeVisibleList();
      const a = vis.indexOf(selection.getAnchor());
      const b = vis.indexOf(inst);
      if (a >= 0 && b >= 0) {
        const [lo, hi] = a < b ? [a, b] : [b, a];
        selection.setRange(vis.slice(lo, hi + 1));
        return;
      }
      selection.selectSingle(inst);
      return;
    }
    if (ctrl) {
      selection.toggle(inst);
      return;
    }
    selection.selectSingle(inst);
  });


  tree.addEventListener("dblclick", (e) => {
    const t = e.target;
    if (!t || typeof t.closest !== "function") return;
    if (t.closest("[data-twisty]")) return;
    const rowEl = t.closest(".rsw-row");
    if (!rowEl) return;
    const inst = instFromRow(rowEl);
    if (!inst) return;
    e.preventDefault();
    if (SCRIPT_CLASSES[inst.className]) {
      bus.emit("editor:openScript", inst);
    } else {
      startRename(inst);
    }
  });


  tree.addEventListener("keydown", (e) => {
    if (e.key === "F2") {
      const anchor = selection.getAnchor() || selection.get()[0];
      if (anchor) {
        e.preventDefault();
        startRename(anchor);
      }
      return;
    }
    if (e.key === "ArrowUp" || e.key === "ArrowDown") {
      const list = computeVisibleList();
      if (!list.length) return;
      e.preventDefault();
      const cur = selection.getAnchor() || selection.get()[0];
      let idx = cur ? list.indexOf(cur) : -1;
      idx = e.key === "ArrowDown" ? Math.min(list.length - 1, idx + 1) : Math.max(0, idx - 1);
      const next = list[idx];
      if (next) {
        selection.selectSingle(next);
        const i = indexOf.get(next.id);
        if (i != null) scrollToIndex(i);
        scheduleRender();
      }
      return;
    }
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      const cur = selection.getAnchor() || selection.get()[0];
      if (!cur || cur.getChildren().length === 0) return;
      const open = isExpanded(cur.id);
      if ((e.key === "ArrowRight" && !open) || (e.key === "ArrowLeft" && open)) {
        e.preventDefault();
        toggleExpand(cur.id);
      }
    }
  });


  tree.addEventListener("contextmenu", (e) => {
    if (typeof e.preventDefault === "function") e.preventDefault();
    cancelRename();
    const t = e.target;
    const rowEl = t && typeof t.closest === "function" ? t.closest(".rsw-row") : null;
    const inst = rowEl ? instFromRow(rowEl) : null;
    if (inst && !selection.isSelected(inst)) selection.selectSingle(inst);
    const items = inst ? buildInstanceMenu(inst) : buildEmptyAreaMenu();
    const pluginItems = getPluginContextMenuItems();
    if (pluginItems.length) items.push({ type: "separator" }, ...pluginItems);
    openContextMenu({ x: e.clientX, y: e.clientY, items });
  });


  tree.addEventListener("pointerdown", (e) => {
    suppressClick = false;
    if (e.button !== 0) return;                         
    if (renaming) return;
    const t = e.target;
    if (!t || typeof t.closest !== "function") return;
    if (t.closest("[data-twisty]")) return;                    
    if (t.closest(".rsw-row__rename")) return;                       
    const rowEl = t.closest(".rsw-row");
    if (!rowEl) return;
    const inst = instFromRow(rowEl);
    if (!inst) return;
    drag = {
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastY: e.clientY,
      pressInst: inst,
      pointerId: e.pointerId,
      started: false,
      ghost: null,
      overRowEl: null,
      items: null,
      rafPending: false,
    };
  });

  tree.addEventListener("pointermove", (e) => {
    if (!drag) return;
    if (!drag.started) {
      if (Math.hypot(e.clientX - drag.startX, e.clientY - drag.startY) < DRAG_THRESHOLD) {
        return;
      }
      drag.started = true;


      let items;
      if (selection.isSelected(drag.pressInst) && selection.get().length > 1) {
        items = selection.get().filter(liveInst);
      } else {
        items = [drag.pressInst];
      }
      drag.items = items;
      drag.ghost = makeDragGhost(items);
      document.body.appendChild(drag.ghost);
      tree.classList.add("rsw-tree--dragging");
      try {
        tree.setPointerCapture(drag.pointerId);
      } catch (_) {

      }
    }
    drag.lastX = e.clientX;
    drag.lastY = e.clientY;
    if (!drag.rafPending) {
      drag.rafPending = true;
      requestAnimationFrame(updateDragVisual);                                 
    }
    if (typeof e.preventDefault === "function") e.preventDefault();
  });

  tree.addEventListener("pointerup", (e) => {
    if (!drag) return;
    const d = drag;
    if (!d.started) {
      drag = null;
      return;                                                        
    }

    const elAt = document.elementFromPoint(e.clientX, e.clientY);
    const rowEl = elAt && elAt.closest ? elAt.closest(".rsw-row") : null;
    let targetInst = null;
    if (rowEl && tree.contains(rowEl)) targetInst = instFromRow(rowEl);
    endDrag();
    suppressClick = true;                                       
    if (targetInst) {
      const moved = reparentInstances(d.items, targetInst);
      if (moved) ensureExpanded(targetInst);
    }

  });

  tree.addEventListener("pointercancel", () => {
    endDrag();
  });

  tree.addEventListener("focus", () => tree.classList.add("is-focused"));
  tree.addEventListener("blur", () => tree.classList.remove("is-focused"));
  tree.addEventListener("scroll", scheduleRender);

  input.addEventListener("input", scheduleFilter);
  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && typeof e.preventDefault === "function") e.preventDefault();
  });


  bus.on("selection:changed", refreshSelection);

  const refreshPkgBadges = () => {
    for (const st of rows.values()) {
      if (st.pkgBadgeEl) updatePackageBadge(st.instance, st.pkgBadgeEl);
    }
  };
  bus.on("packages:statusChanged", refreshPkgBadges);
  bus.on("packages:changed", refreshPkgBadges);
  bus.on("explorer:renameAnchor", () => {
    const anchor = selection.getAnchor() || selection.get()[0];
    if (anchor) startRename(anchor);
  });
  bus.on(Events.ChildAdded, ({ parent, child }) => onChildAdded(parent, child));
  bus.on(Events.ChildRemoved, ({ parent, child }) => removeNode(child, parent));
  bus.on(Events.Destroying, ({ instance }) =>
    removeNode(
      instance,
      instance && typeof instance.getParent === "function" ? instance.getParent() : null,
    ),
  );
  bus.on(Events.PropertyChanged, ({ instance, property }) => {
    if (property === "Name") onName(instance);
  });

  bus.on("runtime:modeChanged", (p) => {
    playtestRunning = !!(p && p.running);
    viewSel.hidden = !playtestRunning;
    if (!playtestRunning) viewMode = "server";                              
    viewBtns.server.classList.toggle("rsw-explorer__viewbtn--active", viewMode === "server");
    viewBtns.client.classList.toggle("rsw-explorer__viewbtn--active", viewMode === "client");
    applyViewVisibility();
  });


  bus.on("streaming:changed", () => {
    if (playtestRunning && viewMode === "client") applyViewVisibility();
  });


  function init(dm) {
    dataModel = dm;
    expanded.clear();
    if (dm) {
      expanded.add(dm.id);                           
      const ws = typeof dm.findFirstChild === "function" ? dm.findFirstChild("Workspace") : null;
      if (ws) expanded.add(ws.id);                                  
    }
    renderAll();
    logger.info("Explorer pronto.");
  }

  const existing = typeof store.getDataModel === "function" ? store.getDataModel() : null;
  if (existing) init(existing);
  else bus.on("datamodel:ready", ({ dataModel: dm }) => init(dm));

  return {
    body,
    tree,
    input,
    rows,
    expanded,
    renderAll,
    computeVisibleList,
    _init: init,
  };
}
