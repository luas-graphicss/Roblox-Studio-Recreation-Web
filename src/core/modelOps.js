import { settings } from "../config/settings.js";
import { clampNumber } from "../utils/validate.js";
import { commands } from "./commands.js";
import { selection } from "./selection.js";
import { bus } from "./eventBus.js";
import { createInstance } from "../datamodel/index.js";
import { Enums } from "../datamodel/types.js";
import { isProtectedInstance, getWorkspaceRoot, toggleLockSelection, canLock } from "./editOps.js";

export const SNAP_MIN = 0.01;
export const SNAP_MAX = 1024;
export const MAX_UNION = 256;                                           
export const SURFACE_PROPS = Object.freeze([
  "TopSurface",
  "BottomSurface",
  "FrontSurface",
  "BackSurface",
  "LeftSurface",
  "RightSurface",
]);




function live(i) {
  if (!i || i.__isInstance !== true) return false;
  if (typeof i.isDestroyed === "function" && i.isDestroyed()) return false;
  return true;
}

function liveSel() {
  return (selection.get() || []).filter(live);
}

function isGeoPart(i) {
  return live(i) && i.hasProperty("Size") && i.hasProperty("Position") && i.hasProperty("Color");
}


function selParts() {
  return liveSel().filter((i) => isGeoPart(i) && !isProtectedInstance(i));
}

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function vec(v) {
  if (!v || typeof v !== "object") return { x: 0, y: 0, z: 0 };
  return { x: num(v.x), y: num(v.y), z: num(v.z) };
}

function cloneVal(v) {
  if (v && typeof v === "object") {
    if ("x" in v) return { x: v.x, y: v.y, z: v.z };
    if ("r" in v) return { r: v.r, g: v.g, b: v.b };
  }
  return v;
}

function sameVal(a, b) {
  if (a && b && typeof a === "object" && typeof b === "object") {
    if ("x" in a) return a.x === b.x && a.y === b.y && a.z === b.z;
    if ("r" in a) return a.r === b.r && a.g === b.g && a.b === b.b;
  }
  return a === b;
}


function commitPropChanges(name, changes) {
  const valid = (changes || []).filter(
    (c) => c && live(c.inst) && c.inst.hasProperty(c.prop) && !sameVal(c.before, c.after),
  );
  if (!valid.length) return false;
  const snap = valid.map((c) => ({
    inst: c.inst,
    prop: c.prop,
    before: cloneVal(c.before),
    after: cloneVal(c.after),
  }));
  return commands.execute({
    name,
    do() {
      for (const s of snap) if (live(s.inst)) s.inst.setProperty(s.prop, cloneVal(s.after));
      return true;
    },
    undo() {
      for (const s of snap) if (live(s.inst)) s.inst.setProperty(s.prop, cloneVal(s.before));
    },
  });
}


function worldHalf(p) {
  const s = vec(p.getProperty("Size"));
  const h = { x: Math.abs(s.x) / 2, y: Math.abs(s.y) / 2, z: Math.abs(s.z) / 2 };
  const rot = p.hasProperty("Rotation") ? vec(p.getProperty("Rotation")) : { x: 0, y: 0, z: 0 };
  if (!rot.x && !rot.y && !rot.z) return h;
  const rad = Math.PI / 180;
  const cx = Math.cos(rot.x * rad), sx = Math.sin(rot.x * rad);
  const cy = Math.cos(rot.y * rad), sy = Math.sin(rot.y * rad);
  const cz = Math.cos(rot.z * rad), sz = Math.sin(rot.z * rad);

  return {
    x: Math.abs(cy * cz) * h.x + Math.abs(cy * sz) * h.y + Math.abs(sy) * h.z,
    y: Math.abs(cx * sz + sx * sy * cz) * h.x + Math.abs(cx * cz - sx * sy * sz) * h.y + Math.abs(sx * cy) * h.z,
    z: Math.abs(sx * sz - cx * sy * cz) * h.x + Math.abs(sx * cz + cx * sy * sz) * h.y + Math.abs(cx * cy) * h.z,
  };
}


function bounds(parts) {
  const lo = { x: Infinity, y: Infinity, z: Infinity };
  const hi = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const p of parts) {
    const pos = vec(p.getProperty("Position"));
    const h = worldHalf(p);
    for (const a of ["x", "y", "z"]) {
      lo[a] = Math.min(lo[a], pos[a] - h[a]);
      hi[a] = Math.max(hi[a], pos[a] + h[a]);
    }
  }
  return { lo, hi };
}


function boundsCenter(parts) {
  const b = bounds(parts);
  return {
    x: (b.lo.x + b.hi.x) / 2,
    y: (b.lo.y + b.hi.y) / 2,
    z: (b.lo.z + b.hi.z) / 2,
  };
}

function boundingSize(parts) {
  const b = bounds(parts);
  return {
    x: Math.max(0.05, b.hi.x - b.lo.x),
    y: Math.max(0.05, b.hi.y - b.lo.y),
    z: Math.max(0.05, b.hi.z - b.lo.z),
  };
}

function copyGeo(src, dst) {
  for (const prop of ["Position", "Size", "Rotation", "Color", "Shape"]) {
    if (src.hasProperty(prop) && dst.hasProperty(prop)) dst.setProperty(prop, cloneVal(src.getProperty(prop)));
  }
}


export function getSnapState() {
  return {
    move: {
      enabled: settings.get("moveSnapEnabled") === true,
      value: num(settings.get("moveSnap")) || 1,
    },
    rotate: {
      enabled: settings.get("rotateSnapEnabled") === true,
      value: num(settings.get("rotateSnap")) || 45,
    },
  };
}

export function setMoveSnapEnabled(on) {
  settings.set("moveSnapEnabled", on === true);
  return settings.get("moveSnapEnabled") === true;
}

export function setRotateSnapEnabled(on) {
  settings.set("rotateSnapEnabled", on === true);
  return settings.get("rotateSnapEnabled") === true;
}


export function setMoveSnapValue(v) {
  const clamped = clampNumber(v, SNAP_MIN, SNAP_MAX, 1);
  settings.set("moveSnap", clamped);
  return clamped;
}

export function setRotateSnapValue(v) {
  const clamped = clampNumber(v, SNAP_MIN, SNAP_MAX, 45);
  settings.set("rotateSnap", clamped);
  return clamped;
}


export function canAlign() {
  return selParts().length >= 2;
}


export function alignSelection(axis, mode) {
  if (!["x", "y", "z"].includes(axis)) return false;
  if (!["min", "center", "max"].includes(mode)) return false;
  const parts = selParts();
  if (parts.length < 2) return false;                                  

  const b = bounds(parts);
  const lo = b.lo[axis];
  const hi = b.hi[axis];
  const center = (lo + hi) / 2;

  const changes = [];
  for (const p of parts) {
    const pos = vec(p.getProperty("Position"));
    const half = worldHalf(p)[axis];
    let target;
    if (mode === "min") target = lo + half;
    else if (mode === "max") target = hi - half;
    else target = center;
    if (!Number.isFinite(target)) continue;
    const after = { ...pos, [axis]: target };
    changes.push({ inst: p, prop: "Position", before: pos, after });
  }
  return commitPropChanges("Align", changes);
}

export function alignLeft() { return alignSelection("x", "min"); }
export function alignCenterH() { return alignSelection("x", "center"); }
export function alignRight() { return alignSelection("x", "max"); }
export function alignBottom() { return alignSelection("y", "min"); }
export function alignMiddle() { return alignSelection("y", "center"); }
export function alignTop() { return alignSelection("y", "max"); }


export function alignAdvanced({ space = "world", axes = {}, mode = "center" } = {}) {
  const parts = selParts();
  if (parts.length < 2) return false;
  const active = ["x", "y", "z"].filter((a) => axes[a]);
  if (!active.length) return false;
  if (!["min", "center", "max"].includes(mode)) return false;

  const b = bounds(parts);                                             
  const changes = [];
  for (const axis of active) {
    const lo = b.lo[axis];
    const hi = b.hi[axis];
    const center = (lo + hi) / 2;
    for (const p of parts) {
      const pos = vec(p.getProperty("Position"));
      const half = worldHalf(p)[axis];
      let target;
      if (mode === "min") target = lo + half;
      else if (mode === "max") target = hi - half;
      else target = center;
      if (!Number.isFinite(target)) continue;


      changes.push({ inst: p, axis, prop: "Position", before: pos, after: { ...pos, [axis]: target } });
    }
  }


  const merged = new Map();
  for (const c of changes) {
    const cur = merged.get(c.inst) || { inst: c.inst, prop: "Position", before: c.before, after: { ...c.before } };
    cur.after[c.axis] = c.after[c.axis];
    merged.set(c.inst, cur);
  }
  return commitPropChanges("Align (Advanced)", [...merged.values()]);
}

export function canDistribute() {
  return selParts().length >= 3;
}


export function distribute(axis) {
  if (!["x", "y", "z"].includes(axis)) return false;
  const parts = selParts();
  if (parts.length < 3) return false;
  const sorted = [...parts].sort((a, c) => vec(a.getProperty("Position"))[axis] - vec(c.getProperty("Position"))[axis]);
  const first = vec(sorted[0].getProperty("Position"))[axis];
  const last = vec(sorted[sorted.length - 1].getProperty("Position"))[axis];
  const span = last - first;
  const step = span / (sorted.length - 1);
  if (!Number.isFinite(step)) return false;

  const changes = [];
  for (let i = 1; i < sorted.length - 1; i++) {
    const p = sorted[i];
    const pos = vec(p.getProperty("Position"));
    const target = first + step * i;
    if (!Number.isFinite(target)) continue;
    changes.push({ inst: p, prop: "Position", before: pos, after: { ...pos, [axis]: target } });
  }
  return commitPropChanges("Distribute", changes);
}

export function distributeHorizontally() { return distribute("x"); }
export function distributeVertically() { return distribute("y"); }


export function canEditPivot() {
  return liveSel().some((i) => live(i) && i.hasProperty("PivotOffset"));
}

function zeroPivot(name) {
  const parts = liveSel().filter((i) => i.hasProperty("PivotOffset"));
  if (!parts.length) return false;
  const changes = parts.map((p) => ({
    inst: p,
    prop: "PivotOffset",
    before: vec(p.getProperty("PivotOffset")),
    after: { x: 0, y: 0, z: 0 },
  }));
  return commitPropChanges(name, changes);
}


export function resetPivot() {
  return zeroPivot("Reset Pivot");
}


export function pivotToCenter() {
  return zeroPivot("Pivot to Center");
}


function sizePositive(p) {
  const s = vec(p.getProperty("Size"));
  return s.x > 0 && s.y > 0 && s.z > 0;
}

export function canUnion() {
  const parts = selParts();
  return parts.length >= 2 && parts.length <= MAX_UNION;
}

export function unionSelection() {
  const parts = selParts();
  if (parts.length < 2) return false;
  if (parts.length > MAX_UNION) return false;                
  if (!parts.every(sizePositive)) return false;                    

  const parent = parts[0].getParent();
  if (!parent) return false;
  const union = createInstance("UnionOperation", { name: "Union" });
  if (!union) return false;


  const c = boundsCenter(parts);
  const sz = boundingSize(parts);
  if (union.hasProperty("Position")) union.setProperty("Position", c);
  if (union.hasProperty("Size")) union.setProperty("Size", sz);
  if (union.hasProperty("Color")) union.setProperty("Color", cloneVal(parts[0].getProperty("Color")));
  union._sourceParts = parts.slice();


  const entries = parts.map((p) => ({ p, oldParent: p.getParent() }));
  const prevSel = liveSel();

  return commands.execute({
    name: "Union",
    do() {


      if (union.isDestroyed() || !live(parent)) return false;
      union.setParent(parent);
      for (const e of entries) if (live(e.p)) e.p.setParent(null);
      selection.set([union]);
      return true;
    },
    undo() {
      for (const e of entries) {
        if (live(e.p) && live(e.oldParent)) e.p.setParent(e.oldParent);
      }
      union.setParent(null);
      selection.set(prevSel.filter(live));
    },
  });
}

export function canSeparate() {
  return liveSel().some((i) => live(i) && i.className === "UnionOperation" && Array.isArray(i._sourceParts) && i._sourceParts.length >= 1);
}

export function separateSelection() {
  const unions = liveSel().filter(
    (i) => live(i) && i.className === "UnionOperation" && Array.isArray(i._sourceParts) && i._sourceParts.length >= 1,
  );
  if (!unions.length) return false;
  const prevSel = liveSel();


  const ops = unions.map((u) => ({ union: u, parent: u.getParent(), parts: u._sourceParts.slice() }));

  return commands.execute({
    name: "Separate",
    do() {
      const restored = [];
      for (const op of ops) {


        if (!live(op.parent)) continue;
        const liveParts = op.parts.filter(live);
        if (!liveParts.length) continue;
        for (const p of liveParts) { p.setParent(op.parent); restored.push(p); }
        if (live(op.union)) op.union.setParent(null);
      }
      selection.set(restored);
      return restored.length > 0;
    },
    undo() {
      for (const op of ops) {
        for (const p of op.parts) if (live(p)) p.setParent(null);
        if (op.parent && live(op.union)) op.union.setParent(op.parent);
      }
      selection.set(prevSel.filter(live));
    },
  });
}

export function canNegate() {
  return selParts().some((p) => p.className !== "NegateOperation");
}

export function negateSelection() {
  const parts = selParts().filter((p) => p.className !== "NegateOperation");
  if (!parts.length) return false;
  if (!parts.every(sizePositive)) return false;


  const ops = parts.map((src) => {
    const neg = createInstance("NegateOperation", { name: "Negate" });
    if (neg) {
      copyGeo(src, neg);
      neg._original = src;
    }
    return { src, neg, parent: src.getParent() };
  }).filter((o) => o.neg && o.parent);
  if (!ops.length) return false;
  const prevSel = liveSel();

  return commands.execute({
    name: "Negate",
    do() {
      const created = [];
      for (const op of ops) {

        if (!live(op.parent) || op.neg.isDestroyed()) continue;
        op.neg.setParent(op.parent);
        if (live(op.src)) op.src.setParent(null);
        created.push(op.neg);
      }
      selection.set(created);
      return created.length > 0;
    },
    undo() {
      for (const op of ops) {
        if (live(op.src)) op.src.setParent(op.parent);
        op.neg.setParent(null);
      }
      selection.set(prevSel.filter(live));
    },
  });
}






export const CSG_MAX_TRIANGLES = 20000;
export const CSG_MAX_DEPTH = 50;

function estimateTris(inst) {
  if (inst && Array.isArray(inst._sourceParts) && inst._sourceParts.length) {
    let t = 0;
    for (const s of inst._sourceParts) t += estimateTris(s);
    return t;
  }
  return 12;
}

function csgDepth(inst, guard) {
  guard = guard || 0;
  if (guard > 64) return guard;
  if (!inst || !Array.isArray(inst._sourceParts) || !inst._sourceParts.length) return 1;
  let max = 0;
  for (const s of inst._sourceParts) max = Math.max(max, csgDepth(s, guard + 1));
  return max + 1;
}

export function csgAsyncBuild(rootPart, otherParts, opts) {
  opts = opts || {};
  if (!live(rootPart) || !isGeoPart(rootPart)) throw new Error("Parte base inv\u00e1lida para CSG.");
  const others = (Array.isArray(otherParts) ? otherParts : []).filter((p) => live(p) && isGeoPart(p));
  if (!others.length) throw new Error("\u00c9 necess\u00e1rio ao menos uma parte v\u00e1lida no array para a opera\u00e7\u00e3o CSG.");
  const all = [rootPart, ...others];
  if (all.length > MAX_UNION) throw new Error(`Opera\u00e7\u00e3o CSG excede o limite de ${MAX_UNION} partes.`);
  if (!all.every(sizePositive)) throw new Error("Todas as partes precisam de tamanho positivo para CSG.");
  let tris = 0;
  let depth = 0;
  for (const p of all) {
    tris += estimateTris(p);
    depth = Math.max(depth, csgDepth(p));
  }
  if (tris > CSG_MAX_TRIANGLES) throw new Error(`Opera\u00e7\u00e3o CSG excede ${CSG_MAX_TRIANGLES} tri\u00e2ngulos.`);
  if (depth >= CSG_MAX_DEPTH) throw new Error(`Profundidade do CSG Tree excede ${CSG_MAX_DEPTH} n\u00edveis.`);

  const union = createInstance("UnionOperation", { name: rootPart.name || "Union" });
  if (!union) throw new Error("N\u00e3o foi poss\u00edvel criar a UnionOperation.");
  const c = boundsCenter(all);
  const sz = boundingSize(all);
  if (union.hasProperty("Position")) union.setProperty("Position", c);
  if (union.hasProperty("Size")) union.setProperty("Size", sz);
  if (union.hasProperty("Color")) union.setProperty("Color", cloneVal(rootPart.getProperty("Color")));
  if (opts.collisionFidelity && union.hasProperty("CollisionFidelity")) union.setProperty("CollisionFidelity", opts.collisionFidelity);
  if (opts.renderFidelity && union.hasProperty("RenderFidelity")) union.setProperty("RenderFidelity", opts.renderFidelity);

  const sources = [];
  const rootClone = createInstance("Part", { name: rootPart.name || "Part" });
  if (rootClone) {
    copyGeo(rootPart, rootClone);
    sources.push(rootClone);
  }
  for (const p of others) {
    const isNeg = !!opts.subtract;
    const cl = createInstance(isNeg ? "NegateOperation" : "Part", { name: isNeg ? "Negate" : (p.name || "Part") });
    if (cl) {
      copyGeo(p, cl);
      sources.push(cl);
    }
  }
  if (sources.length < 2) throw new Error("Falha ao clonar as partes de origem do CSG.");
  union._sourceParts = sources;
  return union;
}


export function canToggleAnchored() {
  return selParts().length > 0;
}

export function getAnchoredActive() {
  const parts = selParts();
  return parts.length > 0 && parts.every((p) => p.getProperty("Anchored") === true);
}

export function toggleAnchored() {
  const parts = selParts();
  if (!parts.length) return false;
  const target = !getAnchoredActive();
  const changes = parts.map((p) => ({ inst: p, prop: "Anchored", before: p.getProperty("Anchored") === true, after: target }));
  return commitPropChanges(target ? "Anchor" : "Unanchor", changes);
}

export function getCanCollideActive() {
  const parts = selParts();
  return parts.length > 0 && parts.every((p) => p.getProperty("CanCollide") === true);
}

export function toggleCanCollide() {
  const parts = selParts();
  if (!parts.length) return false;
  const target = !getCanCollideActive();
  const changes = parts.map((p) => ({ inst: p, prop: "CanCollide", before: p.getProperty("CanCollide") === true, after: target }));
  return commitPropChanges("Toggle CanCollide", changes);
}


let _constraintDetails = false;
export function isConstraintDetailsVisible() {
  return _constraintDetails === true;
}
export function toggleConstraintDetails() {
  _constraintDetails = !_constraintDetails;
  bus.emit("constraints:detailsChanged", { visible: _constraintDetails });
  return _constraintDetails;
}


let _showWelds = false;
export function isWeldsVisible() {
  return _showWelds === true;
}
export function toggleShowWelds() {
  _showWelds = !_showWelds;
  bus.emit("constraints:showWeldsChanged", { visible: _showWelds });
  return _showWelds;
}


export function canSetSurface() {
  return selParts().some((p) => p.hasProperty("TopSurface"));
}

export function setSurfaceType(type) {
  if (!Array.isArray(Enums.SurfaceType) || !Enums.SurfaceType.includes(type)) return false;
  const parts = selParts().filter((p) => p.hasProperty("TopSurface"));
  if (!parts.length) return false;
  const changes = [];
  for (const p of parts) {
    for (const prop of SURFACE_PROPS) {
      if (p.hasProperty(prop)) changes.push({ inst: p, prop, before: p.getProperty(prop), after: type });
    }
  }
  return commitPropChanges("Set Surface", changes);
}


export { canLock, toggleLockSelection };

export function getLockActive() {
  const parts = liveSel().filter((i) => live(i) && i.hasProperty("Locked") && !isProtectedInstance(i));
  return parts.length > 0 && parts.every((p) => p.getProperty("Locked") === true);
}

export function canUnlockAll() {
  const ws = getWorkspaceRoot();
  if (!ws) return false;
  return ws.getDescendants().some((i) => live(i) && i.hasProperty("Locked") && i.getProperty("Locked") === true);
}

export function unlockAll() {
  const ws = getWorkspaceRoot();
  if (!ws) return false;
  const locked = ws.getDescendants().filter((i) => live(i) && i.hasProperty("Locked") && i.getProperty("Locked") === true);
  if (!locked.length) return false;
  const changes = locked.map((p) => ({ inst: p, prop: "Locked", before: true, after: false }));
  return commitPropChanges("Unlock All", changes);
}
