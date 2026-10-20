import { bus } from "../core/eventBus.js";
import { commands } from "../core/commands.js";
import { selection } from "../core/selection.js";
import { store } from "../core/state.js";
import { logger } from "../core/logger.js";
import { createInstance, getService } from "../datamodel/index.js";
import { Enums } from "../datamodel/types.js";

export const MAX_VARIANTS = 100;
export const STUDS_PER_TILE_MIN = 0.05;
export const STUDS_PER_TILE_MAX = 2048;

function clampStuds(n) {
  const v = Number(n);
  if (!Number.isFinite(v)) return 10;
  return Math.min(STUDS_PER_TILE_MAX, Math.max(STUDS_PER_TILE_MIN, v));
}

export function getMaterialService() {
  try {
    return getService(store.getDataModel(), "MaterialService");
  } catch (_) {
    return null;
  }
}

export function isUse2022() {
  const svc = getMaterialService();
  if (!svc) return true;
  return svc.getProperty("Use2022Materials") !== false;
}

export function listVariants() {
  const svc = getMaterialService();
  if (!svc) return [];
  return svc
    .getChildren()
    .filter((c) => c && c.className === "MaterialVariant" && !c.isDestroyed());
}

export function findVariant(name) {
  if (!name) return null;
  for (const v of listVariants()) if (v.name === name) return v;
  return null;
}


export function getOverrideVariant(baseMaterial) {
  if (!baseMaterial) return null;
  for (const v of listVariants()) {
    if (
      v.getProperty("SetAsOverride") === true &&
      v.getProperty("BaseMaterial") === baseMaterial
    ) {
      return v;
    }
  }
  return null;
}


export function variantData(v) {
  if (!v || v.isDestroyed()) return null;
  return {
    name: v.name,
    baseMaterial: String(v.getProperty("BaseMaterial") || "Plastic"),
    colorMap: String(v.getProperty("ColorMap") || ""),
    normalMap: String(v.getProperty("NormalMap") || ""),
    metalnessMap: String(v.getProperty("MetalnessMap") || ""),
    roughnessMap: String(v.getProperty("RoughnessMap") || ""),
    studsPerTile: clampStuds(v.getProperty("StudsPerTile")),
    materialPattern: String(v.getProperty("MaterialPattern") || "Regular"),
    setAsOverride: v.getProperty("SetAsOverride") === true,
  };
}


let current = { material: "Plastic", variant: "" };
let paintMode = false;

export function getCurrentMaterial() {
  return { ...current };
}

export function setCurrentMaterial(material, variant = "") {
  if (Enums.Material.indexOf(material) === -1) return;
  current = { material, variant: String(variant || "") };
  bus.emit("material:current", { ...current });
}

export function isPaintMode() {
  return paintMode;
}

export function setPaintMode(on) {
  paintMode = !!on;
  bus.emit("material:paintmode", paintMode);
}

function isBasePart(inst) {


  return (
    !!inst &&
    typeof inst.hasProperty === "function" &&
    inst.hasProperty("Size") &&
    inst.hasProperty("Shape") &&
    inst.hasProperty("Material") &&
    !inst.isDestroyed()
  );
}


export function applyCurrentMaterialTo(parts) {
  const list = (parts || []).filter(isBasePart);
  if (!list.length) return false;
  const mat = current.material;
  const variant = current.variant;
  const prev = list.map((p) => ({
    p,
    m: p.getProperty("Material"),
    v: p.hasProperty("MaterialVariant") ? p.getProperty("MaterialVariant") : "",
  }));
  return commands.execute({
    name: variant ? `Apply Material Variant (${variant})` : `Apply Material (${mat})`,
    do() {
      for (const { p } of prev) {
        if (p.isDestroyed()) continue;
        p.setProperty("Material", mat);
        if (p.hasProperty("MaterialVariant")) p.setProperty("MaterialVariant", variant);
      }
      return true;
    },
    undo() {
      for (const { p, m, v } of prev) {
        if (p.isDestroyed()) continue;
        p.setProperty("Material", m);
        if (p.hasProperty("MaterialVariant")) p.setProperty("MaterialVariant", v);
      }
    },
  });
}

export function applyToSelection() {
  return applyCurrentMaterialTo(selection.get());
}


export function paintPick(inst) {
  if (!paintMode || !isBasePart(inst)) return false;
  applyCurrentMaterialTo([inst]);
  return true;
}


function emitVariantsChanged() {
  bus.emit("materials:variants-changed", {});
}

export function createVariant(data = {}) {
  const svc = getMaterialService();
  if (!svc) return null;
  if (listVariants().length >= MAX_VARIANTS) {
    logger.warn(`Limite de ${MAX_VARIANTS} MaterialVariants por projeto atingido.`);
    return null;
  }
  const v = createInstance("MaterialVariant", { name: String(data.name || "MaterialVariant") });
  if (!v) return null;
  applyVariantProps(v, data);
  const ok = commands.execute({
    name: "New Material Variant",
    do() {
      if (svc.isDestroyed()) return false;
      v.setParent(svc);
      return true;
    },
    undo() {
      v.setParent(null);
    },
  });
  emitVariantsChanged();
  return ok ? v : null;
}

function applyVariantProps(v, data) {
  if (data.name != null) v.setProperty("Name", String(data.name));
  if (data.baseMaterial != null && Enums.Material.indexOf(data.baseMaterial) !== -1) {
    v.setProperty("BaseMaterial", data.baseMaterial);
  }
  for (const key of ["ColorMap", "NormalMap", "MetalnessMap", "RoughnessMap"]) {
    const lk = key.charAt(0).toLowerCase() + key.slice(1);
    if (data[lk] != null) v.setProperty(key, String(data[lk]));
  }
  if (data.studsPerTile != null) v.setProperty("StudsPerTile", clampStuds(data.studsPerTile));
  if (data.materialPattern != null && Enums.MaterialPattern.indexOf(data.materialPattern) !== -1) {
    v.setProperty("MaterialPattern", data.materialPattern);
  }
  if (data.setAsOverride != null) v.setProperty("SetAsOverride", !!data.setAsOverride);
}

export function updateVariant(v, data = {}) {
  if (!v || v.isDestroyed()) return false;
  const before = variantData(v);
  const ok = commands.execute({
    name: `Edit Material Variant (${v.name})`,
    do() {
      if (v.isDestroyed()) return false;
      applyVariantProps(v, data);
      return true;
    },
    undo() {
      if (v.isDestroyed()) return;
      applyVariantProps(v, before);
    },
  });
  emitVariantsChanged();
  return ok;
}


function partsUsingVariant(name) {
  const out = [];
  let dm = null;
  try {
    dm = store.getDataModel();
  } catch (_) {
    dm = null;
  }
  if (!dm || !name) return out;
  const stack = [dm];
  let guard = 0;
  while (stack.length && guard < 100000) {
    guard += 1;
    const node = stack.pop();
    const kids = typeof node.getChildren === "function" ? node.getChildren() : [];
    for (const k of kids) {
      if (!k || (typeof k.isDestroyed === "function" && k.isDestroyed())) continue;
      if (
        typeof k.hasProperty === "function" &&
        k.hasProperty("MaterialVariant") &&
        k.getProperty("MaterialVariant") === name
      ) {
        out.push(k);
      }
      stack.push(k);
    }
  }
  return out;
}


export function deleteVariant(v) {
  if (!v || v.isDestroyed()) return false;
  const svc = getMaterialService();
  const name = v.name;
  const users = partsUsingVariant(name);
  const ok = commands.execute({
    name: `Delete Material Variant (${name})`,
    do() {
      for (const p of users) {
        if (!p.isDestroyed()) p.setProperty("MaterialVariant", "");
      }
      v.setParent(null);
      return true;
    },
    undo() {
      if (svc && !svc.isDestroyed()) v.setParent(svc);
      for (const p of users) {
        if (!p.isDestroyed()) p.setProperty("MaterialVariant", name);
      }
    },
  });
  if (current.variant === name) setCurrentMaterial(current.material, "");
  emitVariantsChanged();
  return ok;
}
