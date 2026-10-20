import { commands } from "./commands.js";
import { selection } from "./selection.js";
import { store } from "./state.js";
import { bus } from "./eventBus.js";
import { createInstance, getService } from "../datamodel/index.js";
import { isInsertableClass } from "../datamodel/classes.js";
import { logger } from "./logger.js";

const MAX_NAME = 200;                                         
const MAX_BULK = 1000;                                                       


export const INSERTABLE_CLASSES = Object.freeze([
  "Part",

  "SpawnLocation",
  "TrussPart",
  "ForceField",
  "Model",
  "Folder",

  "Configuration",
  "Script",
  "LocalScript",
  "ModuleScript",

  "RemoteEvent",
  "RemoteFunction",
  "BindableEvent",
  "BindableFunction",

  "StringValue",
  "BoolValue",
  "IntValue",
  "NumberValue",
  "ObjectValue",
  "Color3Value",
  "BrickColorValue",
  "Vector3Value",
  "CFrameValue",
  "RayValue",
  "IntConstrainedValue",
  "DoubleConstrainedValue",

  "Highlight",
  "SelectionBox",
  "SelectionSphere",
  "DragDetector",
  "UIDragDetector",
  "Handles",
  "ArcHandles",
]);

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


function isProtected(inst) {
  if (!live(inst)) return true;
  if (typeof inst.isLocked === "function" && inst.isLocked()) return true;
  if (inst.className === "DataModel") return true;
  return false;
}

export function isProtectedInstance(inst) {
  return isProtected(inst);
}

function dataModel() {
  try {
    return store.getDataModel();
  } catch (_) {
    return null;
  }
}

function workspace() {
  try {
    return getService(dataModel(), "Workspace");
  } catch (_) {
    return null;
  }
}

export function getWorkspaceRoot() {
  return workspace();
}


function isSelfOrDescendant(node, ancestor) {
  let cur = node;
  while (cur) {
    if (cur === ancestor) return true;
    cur = typeof cur.getParent === "function" ? cur.getParent() : null;
  }
  return false;
}


export function canRename(inst) {
  return live(inst) && !isProtected(inst);
}


export function sanitizeRenameInput(raw) {
  if (typeof raw !== "string") return "";
  let s = raw
    .replace(/<[^>]*>/g, "")
    .replace(/[<>]/g, "")

    .replace(/[\u0000-\u001F\u007F]/g, "");
  s = s.trim();
  if (s.length > MAX_NAME) s = s.slice(0, MAX_NAME);
  return s;
}

export function renameInstance(inst, rawName) {
  if (!canRename(inst)) return false;
  const next = sanitizeRenameInput(rawName);
  if (!next) return false;                                                  
  const old = inst.name;
  if (next === old) return false;                    
  return commands.execute({
    name: `Renomear "${old}" -> "${next}"`,
    do() {
      if (!live(inst)) return false;
      return inst.setProperty("Name", next) !== false;
    },
    undo() {
      if (live(inst)) inst.setProperty("Name", old);
    },
  });
}






export function canReparent(item, target) {
  if (!live(item) || !live(target)) return false;
  if (isProtected(item)) return false;                                     
  if (target === item) return false;                                
  if (isSelfOrDescendant(target, item)) return false;                                   
  return true;
}

export function reparentInstances(items, target) {
  if (!live(target)) return false;
  const valid = liveOnly(items).filter((it) => canReparent(it, target));
  if (valid.length === 0) return false;
  if (valid.length > MAX_BULK) {
    logger.warn(`Reparent bloqueado: excede ${MAX_BULK} objetos.`);
    return false;
  }

  const entries = valid
    .map((inst) => ({ inst, oldParent: inst.getParent() }))
    .filter((e) => e.oldParent !== target);
  if (entries.length === 0) return false;

  return commands.execute({
    name: `Mover (${entries.length})`,
    do() {
      let any = false;
      for (const e of entries) {

        if (
          live(e.inst) &&
          live(target) &&
          !isSelfOrDescendant(target, e.inst)
        ) {
          if (e.inst.setParent(target)) any = true;
        }
      }
      return any;
    },
    undo() {
      for (const e of entries) {
        if (!live(e.inst)) continue;
        if (e.oldParent && live(e.oldParent)) {
          e.inst.setParent(e.oldParent);
        } else if (!e.oldParent) {


          e.inst.setParent(null);
        }
      }
    },
  });
}


export function insertObjectUnder(className, parent) {
  if (!INSERTABLE_CLASSES.includes(className)) {
    logger.warn(`insertObjectUnder: classe não inserível "${className}".`);
    return null;
  }
  const target = live(parent) ? parent : workspace();
  if (!target) {
    logger.warn("insertObjectUnder: destino indisponível.");
    return null;
  }
  const inst = createInstance(className, {});
  if (!inst) return null;
  const prevSel = selection.get();
  const ok = commands.execute({
    name: `Inserir ${className}`,
    do() {
      if (inst.isDestroyed() || !live(target)) return false;
      inst.setParent(target);
      selection.set([inst]);
      return true;
    },
    undo() {
      inst.setParent(null);
      selection.set(liveOnly(prevSel));
    },
  });


  return ok ? inst : null;
}


let clipboard = null;                                           

function emitClipboardChanged() {
  try {
    bus.emit("clipboard:changed", { hasClipboard: hasClipboard() });
  } catch (_) {

  }
}

export function hasClipboard() {
  return !!(clipboard && Array.isArray(clipboard.items) && clipboard.items.length);
}


function snapshotSelection() {
  const sel = liveOnly(selection.get()).filter((i) => !isProtected(i));
  if (!sel.length || sel.length > MAX_BULK) return null;
  const clones = [];
  for (const src of sel) {
    const c = typeof src.clone === "function" ? src.clone() : null;
    if (c && typeof c.setParent === "function" && c.getParent() == null) clones.push(c);
  }
  return clones.length ? clones : null;
}

export function copySelection() {
  const snap = snapshotSelection();
  if (!snap) return false;
  clipboard = { items: snap };
  emitClipboardChanged();
  return true;
}


export function cutSelection() {
  const snap = snapshotSelection();
  if (!snap) return false;
  const sel = liveOnly(selection.get()).filter((i) => !isProtected(i));
  if (!sel.length) return false;
  const entries = sel.map((inst) => ({ inst, parent: inst.getParent() }));
  const prevSel = selection.get();
  const ok = commands.execute({
    name: `Recortar (${sel.length})`,
    do() {
      for (const e of entries) if (live(e.inst)) e.inst.setParent(null);
      selection.clear();
      return true;
    },
    undo() {


      for (const e of entries) if (live(e.inst) && live(e.parent)) e.inst.setParent(e.parent);
      selection.set(liveOnly(prevSel));
    },
  });
  if (!ok) return false;
  clipboard = { items: snap };
  emitClipboardChanged();
  return true;
}


export function pasteInto(target) {
  if (!hasClipboard()) return false;
  let dest = live(target) ? target : workspace();


  if (dest && dest.className === "DataModel") dest = workspace();
  if (!dest) return false;
  const src = clipboard.items.slice(0, MAX_BULK);                                      
  const copies = [];
  for (const item of src) {
    const c = typeof item.clone === "function" ? item.clone() : null;
    if (c) copies.push(c);
  }
  if (!copies.length) return false;
  const prevSel = selection.get();
  return commands.execute({
    name: `Colar (${copies.length})`,
    do() {
      if (!live(dest)) return false;
      for (const c of copies) if (!c.isDestroyed()) c.setParent(dest);
      selection.set(copies.filter((c) => !c.isDestroyed()));
      return true;
    },
    undo() {
      for (const c of copies) c.setParent(null);
      selection.set(liveOnly(prevSel));
    },
  });
}


export function pasteFromClipboard() {
  const sel = liveOnly(selection.get());
  let dest = sel.length ? sel[0].getParent() || workspace() : workspace();


  if (dest && dest.className === "DataModel") dest = sel[0];
  return pasteInto(dest);
}


export function pasteIntoSelection() {
  const sel = liveOnly(selection.get());
  const dest = sel.length ? sel[0] : workspace();
  return pasteInto(dest);
}


export function selectChildren(inst) {
  if (!live(inst)) return false;
  const kids = inst.getChildren().filter(live);
  if (!kids.length) return false;
  selection.set(kids);
  return true;
}

export function selectAll() {
  const ws = workspace();
  if (!ws) return false;


  const all = ws
    .getDescendants()
    .filter(live)
    .filter((i) => i.className !== "Camera" && i.className !== "Terrain");
  selection.set(all);
  return true;
}


export function insertAnyClass(className, target) {
  if (!isInsertableClass(className)) {
    logger.warn(`insertAnyClass: classe não inserível "${className}".`);
    return null;
  }


  let dest = live(target) ? target : null;
  if (!dest) {
    if (className === "RemoteEvent" || className === "RemoteFunction") {
      dest = getService(dataModel(), "ReplicatedStorage") || workspace();
    } else if (className === "BindableEvent" || className === "BindableFunction") {
      dest = getService(dataModel(), "ServerScriptService") || workspace();
    } else {
      dest = workspace();
    }
  }
  if (!dest) return null;
  const inst = createInstance(className, {});
  if (!inst) return null;
  const prevSel = selection.get();
  const ok = commands.execute({
    name: `Inserir ${className}`,
    do() {
      if (inst.isDestroyed() || !live(dest)) return false;
      inst.setParent(dest);
      selection.set([inst]);
      return true;
    },
    undo() {
      inst.setParent(null);
      selection.set(liveOnly(prevSel));
    },
  });

  return ok ? inst : null;
}


export const EFFECT_CLASSES = Object.freeze([
  "ParticleEmitter",
  "Beam",
  "Trail",
  "Fire",
  "Smoke",
  "Sparkles",
  "Explosion",
]);

function isLiveBasePart(inst) {
  return !!(inst && live(inst) && typeof inst.hasProperty === "function" && inst.hasProperty("Anchored") && inst.hasProperty("Position"));
}


export function insertEffect(className, target) {
  if (!EFFECT_CLASSES.includes(className)) return insertAnyClass(className, target);
  const ws = workspace();
  if (!ws) return null;

  let host = isLiveBasePart(target) ? target : null;
  if (!host) host = liveOnly(selection.get()).find(isLiveBasePart) || null;


  if (className === "Explosion") {
    const inst = createInstance("Explosion", {});
    if (!inst) return null;
    if (host) {
      const hp = host.getProperty("Position");
      if (hp) inst.setProperty("Position", { x: hp.x, y: hp.y, z: hp.z });
    }
    const prevSel = selection.get();
    const ok = commands.execute({
      name: "Inserir Explosion",
      do() {
        if (inst.isDestroyed() || !live(ws)) return false;
        inst.setParent(ws);
        return true;
      },
      undo() {
        inst.setParent(null);
        selection.set(liveOnly(prevSel));
      },
    });
    return ok ? inst : null;
  }


  let holder = null;
  if (!host) {
    holder = createInstance("Part", {});
    if (!holder) return null;
    holder.setProperty("Name", "EffectPart");
    holder.setProperty("Anchored", true);
    holder.setProperty("Transparency", 1);
    if (holder.hasProperty("CanCollide")) holder.setProperty("CanCollide", false);
    holder.setProperty("Position", { x: 0, y: 6, z: 0 });
    host = holder;
  }

  const inst = createInstance(className, {});
  if (!inst) return null;


  let a0 = null;
  let a1 = null;
  if (className === "Beam" || className === "Trail") {
    a0 = createInstance("Attachment", {});
    a1 = createInstance("Attachment", {});
    if (a0 && a1) {
      a0.setProperty("Name", "Attachment0");
      a1.setProperty("Name", "Attachment1");
      if (className === "Trail") {

        a0.setProperty("Position", { x: 0, y: 1, z: 0 });
        a1.setProperty("Position", { x: 0, y: -1, z: 0 });
      } else {
        a0.setProperty("Position", { x: -2, y: 0, z: 0 });
        a1.setProperty("Position", { x: 2, y: 0, z: 0 });
      }
    }
  }

  const prevSel = selection.get();
  const hostRef = host;
  const holderRef = holder;
  const ok = commands.execute({
    name: `Inserir ${className}`,
    do() {
      if (inst.isDestroyed()) return false;
      if (holderRef && !holderRef.isDestroyed() && holderRef.getParent() !== ws) {
        if (!live(ws)) return false;
        holderRef.setParent(ws);
      }
      if (!live(hostRef)) return false;
      if (a0 && !a0.isDestroyed()) a0.setParent(hostRef);
      if (a1 && !a1.isDestroyed()) a1.setParent(hostRef);
      inst.setParent(hostRef);
      if (a0 && !a0.isDestroyed()) inst.setProperty("Attachment0", a0);
      if (a1 && !a1.isDestroyed()) inst.setProperty("Attachment1", a1);
      selection.set([inst]);
      return true;
    },
    undo() {
      inst.setParent(null);
      if (a0) a0.setParent(null);
      if (a1) a1.setParent(null);
      if (holderRef) holderRef.setParent(null);
      selection.set(liveOnly(prevSel));
    },
  });
  return ok ? inst : null;
}




export function canGroup() {
  const sel = liveOnly(selection.get()).filter((i) => !isProtected(i));
  return sel.length >= 2;
}

export function canUngroup() {
  return liveOnly(selection.get()).some(
    (i) => i.className === "Model" && !isProtected(i),
  );
}


export function groupSelection() {
  const sel = liveOnly(selection.get()).filter((i) => !isProtected(i));
  if (sel.length < 2) return null;
  const selSet = new Set(sel);


  const roots = sel.filter((i) => !selSet.has(i.getParent()));


  if (!roots.length) return null;
  const parent = roots[0].getParent() || workspace();
  if (!live(parent)) return null;
  const model = createInstance("Model", {});
  if (!model) return null;
  const entries = roots.map((inst) => ({ inst, oldParent: inst.getParent() }));
  const prevSel = selection.get();
  const ok = commands.execute({
    name: `Agrupar (${roots.length})`,
    do() {
      if (model.isDestroyed() || !live(parent)) return false;
      model.setParent(parent);
      for (const e of entries) if (live(e.inst)) e.inst.setParent(model);
      selection.set([model]);
      return true;
    },
    undo() {
      for (const e of entries) if (live(e.inst) && live(e.oldParent)) e.inst.setParent(e.oldParent);
      model.setParent(null);
      selection.set(liveOnly(prevSel));
    },
  });
  return ok ? model : null;
}


export function ungroupSelection() {
  const models = liveOnly(selection.get()).filter(
    (i) => i.className === "Model" && !isProtected(i),
  );
  if (!models.length) return false;
  const plans = [];
  for (const model of models) {
    const parent = model.getParent();
    if (!live(parent)) continue;
    plans.push({ model, parent, children: model.getChildren().filter(live) });
  }
  if (!plans.length) return false;
  const prevSel = selection.get();
  return commands.execute({
    name: `Desagrupar (${plans.length})`,
    do() {
      const newSel = [];
      let any = false;
      for (const pl of plans) {
        if (!live(pl.model)) continue;


        const cur = pl.model.getParent();
        const dest = live(cur) ? cur : live(pl.parent) ? pl.parent : null;
        if (!dest) continue;


        for (const child of pl.model.getChildren()) {
          if (live(child)) { child.setParent(dest); newSel.push(child); }
        }
        pl.model.setParent(null);
        any = true;
      }
      selection.set(newSel.filter(live));
      return any;
    },
    undo() {
      for (const pl of plans) {
        if (live(pl.model) && live(pl.parent)) pl.model.setParent(pl.parent);
        for (const child of pl.children) {
          if (live(child) && live(pl.model)) child.setParent(pl.model);
        }
      }
      selection.set(liveOnly(prevSel));
    },
  });
}


export function canLock() {
  return liveOnly(selection.get()).some(
    (i) => typeof i.hasProperty === "function" && i.hasProperty("Locked"),
  );
}

export function toggleLockSelection() {
  const sel = liveOnly(selection.get()).filter(
    (i) => typeof i.hasProperty === "function" && i.hasProperty("Locked"),
  );
  if (!sel.length) return false;
  const allLocked = sel.every((i) => i.getProperty("Locked") === true);
  const target = !allLocked;                                              
  const entries = sel.map((inst) => ({ inst, old: inst.getProperty("Locked") === true }));
  return commands.execute({
    name: target ? `Travar (${sel.length})` : `Destravar (${sel.length})`,
    do() {
      for (const e of entries) if (live(e.inst)) e.inst.setProperty("Locked", target);
      return true;
    },
    undo() {
      for (const e of entries) if (live(e.inst)) e.inst.setProperty("Locked", e.old);
    },
  });
}


export const SOUND_EFFECT_CLASSES = Object.freeze([
  "EqualizerSoundEffect",
  "ReverbSoundEffect",
  "DistortionSoundEffect",
  "ChorusSoundEffect",
  "CompressorSoundEffect",
  "EchoSoundEffect",
  "FlangeSoundEffect",
  "PitchShiftSoundEffect",
  "TremoloSoundEffect",
]);


function execAudioInsert(inst, target) {
  const prevSel = selection.get();
  const ok = commands.execute({
    name: `Inserir ${inst.className}`,
    do() {
      if (inst.isDestroyed() || !live(target)) return false;
      inst.setParent(target);
      selection.set([inst]);
      return true;
    },
    undo() {
      inst.setParent(null);
      selection.set(liveOnly(prevSel));
    },
  });
  return ok ? inst : null;
}

function soundServiceInstance() {
  const ws = workspace();
  const dm = ws && typeof ws.getParent === "function" ? ws.getParent() : null;
  if (!dm || typeof dm.getChildren !== "function") return null;
  return dm.getChildren().find((c) => c && c.className === "SoundService") || null;
}


export function insertSound(target) {
  const ok = (i) =>
    !!(i && live(i) && (isLiveBasePart(i) || i.className === "Attachment" || i.className === "Workspace"));
  let dest = ok(target) ? target : null;
  if (!dest) dest = liveOnly(selection.get()).find(ok) || null;
  if (!dest) dest = workspace();
  if (!dest) {
    logger.warn("insertSound: destino indisponível.");
    return null;
  }
  const inst = createInstance("Sound", {});
  if (!inst) return null;
  return execAudioInsert(inst, dest);
}


export function insertSoundGroup(target) {
  const dest =
    target && live(target) && (target.className === "SoundService" || target.className === "SoundGroup")
      ? target
      : soundServiceInstance();
  if (!dest) {
    logger.warn("insertSoundGroup: SoundService indisponível.");
    return null;
  }
  const inst = createInstance("SoundGroup", {});
  if (!inst) return null;
  return execAudioInsert(inst, dest);
}


export function insertSoundEffect(className, target) {
  if (!SOUND_EFFECT_CLASSES.includes(className)) {
    logger.warn(`insertSoundEffect: classe inválida "${className}".`);
    return null;
  }
  const ok = (i) =>
    !!(i && live(i) && (i.className === "Sound" || i.className === "SoundGroup" || i.className === "SoundService"));
  let dest = ok(target) ? target : null;
  if (!dest) dest = liveOnly(selection.get()).find(ok) || null;
  if (!dest) dest = soundServiceInstance();
  if (!dest) {
    logger.warn("insertSoundEffect: destino indisponível.");
    return null;
  }
  const inst = createInstance(className, {});
  if (!inst) return null;
  return execAudioInsert(inst, dest);
}
