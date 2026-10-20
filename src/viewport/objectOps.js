import { commands } from "../core/commands.js";
import { selection } from "../core/selection.js";
import { store } from "../core/state.js";
import { createInstance, getService, makeVector3 } from "../datamodel/index.js";
import { tools } from "./tools.js";
import { logger } from "../core/logger.js";

const MAX_BULK = 1000;                                                      
const POS_LIMIT = 100000;                             
const CLONE_OFFSET_Y = 2;                                          


const INSERTABLE = Object.freeze({
  Part: { className: "Part", name: "Part", shape: "Block" },
  Sphere: { className: "Part", name: "Sphere", shape: "Ball" },
  Cylinder: { className: "Part", name: "Cylinder", shape: "Cylinder" },
  Wedge: { className: "Part", name: "Wedge", shape: "Wedge" },
  CornerWedge: { className: "Part", name: "CornerWedge", shape: "CornerWedge" },
  Model: { className: "Model", name: "Model" },
  Folder: { className: "Folder", name: "Folder" },

  SpawnLocation: {
    className: "SpawnLocation",
    name: "SpawnLocation",
    size: { x: 6, y: 1, z: 6 },
    anchored: true,
  },
  TrussPart: { className: "TrussPart", name: "Truss", size: { x: 2, y: 8, z: 2 }, anchored: true },



  Seat: { className: "Seat", name: "Seat", size: { x: 2, y: 1, z: 2 }, anchored: true },
  VehicleSeat: { className: "VehicleSeat", name: "VehicleSeat", size: { x: 5, y: 1, z: 2 }, anchored: true },
});


let spawnAnchorProvider = null;
export function setSpawnAnchorProvider(fn) {
  spawnAnchorProvider = typeof fn === "function" ? fn : null;
}

function clampCoord(n, fb = 0) {
  return Number.isFinite(n) ? Math.min(POS_LIMIT, Math.max(-POS_LIMIT, n)) : fb;
}

function workspace() {
  try {
    return getService(store.getDataModel(), "Workspace");
  } catch (_) {
    return null;
  }
}

function selectedInstances() {
  try {
    return selection.get().filter((i) => i && typeof i.isDestroyed === "function" && !i.isDestroyed());
  } catch (_) {
    return [];
  }
}

function liveOnly(list) {
  return (list || []).filter(
    (i) => i && typeof i.isDestroyed === "function" && !i.isDestroyed(),
  );
}


function isProtected(inst) {
  if (!inst || typeof inst.isDestroyed !== "function") return true;
  if (inst.isDestroyed()) return true;
  if (typeof inst.isLocked === "function" && inst.isLocked()) return true;
  if (inst.className === "DataModel") return true;
  return false;
}

function spawnPosition() {
  let pos = { x: 0, y: 2.5, z: 0 };
  if (spawnAnchorProvider) {
    try {
      const a = spawnAnchorProvider();
      if (a && typeof a === "object") {
        pos = { x: clampCoord(a.x), y: clampCoord(a.y), z: clampCoord(a.z) };
      }
    } catch (_) {

    }
  }
  return pos;
}


export function getSpawnPosition() {
  return spawnPosition();
}


export function insertObject(key) {
  const spec = INSERTABLE[key];
  if (!spec) {
    logger.warn(`insertObject: tipo desconhecido "${key}".`);
    return null;
  }
  const ws = workspace();
  if (!ws) {
    logger.warn("insertObject: Workspace indisponível.");
    return null;
  }
  const inst = createInstance(spec.className, { name: spec.name });
  if (!inst) return null;

  if (spec.shape && inst.hasProperty("Shape")) inst.setProperty("Shape", spec.shape);
  if (spec.size && inst.hasProperty("Size")) {
    inst.setProperty("Size", makeVector3(spec.size.x, spec.size.y, spec.size.z));
  }
  if (spec.anchored && inst.hasProperty("Anchored")) inst.setProperty("Anchored", true);
  if (inst.hasProperty("Position")) {
    const p = spawnPosition();
    const y = clampCoord(p.y + CLONE_OFFSET_Y);                                     
    inst.setProperty("Position", makeVector3(p.x, y, p.z));
  }

  const prevSel = selectedInstances();
  commands.execute({
    name: `Inserir ${spec.name}`,
    do() {
      if (inst.isDestroyed()) return false;
      inst.setParent(ws);
      selection.set([inst]);
      return true;
    },
    undo() {
      inst.setParent(null);
      selection.set(liveOnly(prevSel));
    },
  });
  return inst;
}


export function cloneSelection() {
  const sel = selectedInstances().filter((i) => !isProtected(i));
  if (sel.length === 0) return [];
  if (sel.length > MAX_BULK) {
    logger.warn(`Clone bloqueado: seleção excede ${MAX_BULK} objetos.`);
    return [];
  }

  const entries = [];
  for (const orig of sel) {
    const parent = orig.getParent();
    if (!parent) continue;
    const copy = typeof orig.clone === "function" ? orig.clone() : null;
    if (!copy) continue;
    if (copy.hasProperty("Position")) {
      const p = copy.getProperty("Position") || { x: 0, y: 0, z: 0 };
      copy.setProperty(
        "Position",
        makeVector3(clampCoord(p.x), clampCoord(p.y + CLONE_OFFSET_Y), clampCoord(p.z)),
      );
    }
    entries.push({ copy, parent });
  }
  if (entries.length === 0) return [];

  const prevSel = selectedInstances();
  commands.execute({
    name: `Clonar (${entries.length})`,
    do() {
      for (const e of entries) {
        if (!e.copy.isDestroyed() && !e.parent.isDestroyed()) e.copy.setParent(e.parent);
      }
      selection.set(entries.map((e) => e.copy).filter((c) => !c.isDestroyed()));
      return true;
    },
    undo() {
      for (const e of entries) e.copy.setParent(null);
      selection.set(liveOnly(prevSel));
    },
  });
  return entries.map((e) => e.copy);
}


export function deleteSelection() {
  const sel = selectedInstances().filter((i) => !isProtected(i));
  if (sel.length === 0) return false;

  const entries = sel.map((inst) => ({ inst, parent: inst.getParent() }));
  const prevSel = selectedInstances();
  commands.execute({
    name: `Excluir (${entries.length})`,
    do() {
      for (const e of entries) {
        if (!e.inst.isDestroyed()) e.inst.setParent(null);
      }
      selection.set([]);
      return true;
    },
    undo() {
      for (const e of entries) {
        if (e.parent && !e.inst.isDestroyed() && !e.parent.isDestroyed()) {
          e.inst.setParent(e.parent);
        }
      }
      selection.set(liveOnly(entries.map((e) => e.inst)));
    },
  });
  return true;
}




export function duplicateSelection() {
  const clones = cloneSelection();
  if (clones.length > 0) tools.set("move");                                         
  return clones;
}


function isTyping(node) {
  if (!node) return false;
  const tag = (node.tagName || "").toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    node.isContentEditable === true
  );
}

export function wireObjectShortcuts(target) {
  const el = target || (typeof document !== "undefined" ? document : null);
  if (!el || typeof el.addEventListener !== "function") return () => {};
  const onKey = (e) => {
    if (isTyping(e.target)) return;
    const key = (e.key || "").toLowerCase();
    if ((e.ctrlKey || e.metaKey) && !e.altKey && key === "d") {
      e.preventDefault();
      if (e.shiftKey) duplicateSelection();
      else cloneSelection();
      return;
    }
    if (
      !e.ctrlKey &&
      !e.metaKey &&
      !e.altKey &&
      (e.key === "Delete" || e.key === "Backspace")
    ) {
      e.preventDefault();
      deleteSelection();
    }
  };
  el.addEventListener("keydown", onKey);
  return () => el.removeEventListener("keydown", onKey);
}
