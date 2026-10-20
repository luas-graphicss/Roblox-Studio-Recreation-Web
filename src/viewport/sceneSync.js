import { bus } from "../core/eventBus.js";
import { logger } from "../core/logger.js";
import { selection } from "../core/selection.js";
import { Events } from "../datamodel/index.js";

import { setActiveRenderStyle, sweepMaterialPhysics } from "../lighting/materialPhysicsTable.js";

import { refineImportedSolid } from "../interop/rbxCsgMeshBuild.js";
import { clampNumber, isFiniteNumber } from "../utils/validate.js";

const POS_LIMIT = 100000;                                            
const SIZE_MIN = 0.05;
const SIZE_MAX = 100000;
const GRAY = { r: 0.64, g: 0.635, b: 0.647 };
const SHAPES = ["Block", "Ball", "Cylinder", "Wedge"];


const APPEARANCE_CLASSES = new Set([
  "Decal",
  "Texture",
  "SpecialMesh",
  "SurfaceAppearance",
]);
const MAX_FACE_LAYERS = 16;                                                  
const ZINDEX_MIN = 0;
const ZINDEX_MAX = 1000;
const STUDS_TILE_MIN = 0.05;
const STUDS_TILE_MAX = 2048;


const CAMERA_POS = { x: 0, y: 12, z: 24 };
const CAMERA_SIZE = { x: 2.4, y: 2.4, z: 3.6 };
const CAMERA_COLOR = { r: 0.18, g: 0.55, b: 1 };

function isRenderablePart(inst) {
  return (
    inst.hasProperty("Size") &&
    inst.hasProperty("Position") &&
    inst.hasProperty("Color")
  );
}

function kindOf(inst) {
  if (!inst || inst.__isInstance !== true) return "other";
  if (isRenderablePart(inst)) return "part";
  if (inst.className === "Camera") return "camera";
  if (inst.className === "Model") return "model";
  if (APPEARANCE_CLASSES.has(inst.className)) return "appearance";
  return "other";
}

function hasMesh(kind) {
  return kind === "part" || kind === "camera";
}

export function createSceneSync(config = {}) {
  const getWorkspace =
    typeof config.getWorkspace === "function" ? config.getWorkspace : () => null;
  const maxObjects = Number.isFinite(config.maxObjects) ? config.maxObjects : 1500;

  const records = new Map();                
  const selectedIds = new Set();
  const offs = [];
  let sink = null;
  let started = false;
  let warnedCap = false;


  function readVec(inst, prop, fb, min, max) {
    const v = inst.getProperty(prop);
    if (!v || typeof v !== "object") return { ...fb };
    return {
      x: clampNumber(v.x, min, max, fb.x),
      y: clampNumber(v.y, min, max, fb.y),
      z: clampNumber(v.z, min, max, fb.z),
    };
  }

  function readColor(inst) {


    if (inst.className === "NegateOperation") return { r: 0.85, g: 0.12, b: 0.12 };
    const c = inst.getProperty("Color");
    if (!c || typeof c !== "object") return { ...GRAY };
    return {
      r: clampNumber(c.r, 0, 1, GRAY.r),
      g: clampNumber(c.g, 0, 1, GRAY.g),
      b: clampNumber(c.b, 0, 1, GRAY.b),
    };
  }

  function readTransparency(inst) {

    if (inst.className === "NegateOperation") return 0.5;
    const t = inst.getProperty("Transparency");
    return isFiniteNumber(t) ? clampNumber(t, 0, 1, 0) : 0;
  }


  function readLocalTransparency(inst) {
    if (!inst.hasProperty || !inst.hasProperty("LocalTransparencyModifier")) return 0;
    const t = inst.getProperty("LocalTransparencyModifier");
    return isFiniteNumber(t) ? clampNumber(t, 0, 1, 0) : 0;
  }

  function readShape(inst) {
    const s = inst.getProperty("Shape");
    return SHAPES.indexOf(s) !== -1 ? s : "Block";
  }


  function readMaterial(inst) {
    const m = inst.hasProperty("Material") ? inst.getProperty("Material") : "Plastic";
    return typeof m === "string" && m ? m : "Plastic";
  }

  function readMaterialVariant(inst) {
    const v = inst.hasProperty("MaterialVariant") ? inst.getProperty("MaterialVariant") : "";
    return typeof v === "string" ? v : "";
  }

  function readLayerColor(ch, prop = "Color3") {
    const c = ch.hasProperty(prop) ? ch.getProperty(prop) : null;
    if (!c || typeof c !== "object") return { r: 1, g: 1, b: 1 };
    return {
      r: clampNumber(c.r, 0, 1, 1),
      g: clampNumber(c.g, 0, 1, 1),
      b: clampNumber(c.b, 0, 1, 1),
    };
  }


  function collectAppearance(inst) {
    if (typeof inst.getChildren !== "function") return null;
    let layers = null;
    let special = null;
    let surface = null;
    const perFace = {};
    for (const ch of inst.getChildren()) {
      if (!ch || (typeof ch.isDestroyed === "function" && ch.isDestroyed())) continue;
      if (ch.className === "Decal" || ch.className === "Texture") {
        const face = String(ch.getProperty("Face") || "Front");
        perFace[face] = (perFace[face] || 0) + 1;
        if (perFace[face] > MAX_FACE_LAYERS) continue;                
        const layer = {
          type: ch.className === "Texture" ? "texture" : "decal",
          texture: String(ch.getProperty("Texture") || ""),
          face,
          color: readLayerColor(ch),
          transparency: clampNumber(ch.getProperty("Transparency"), 0, 1, 0),
          zIndex: clampNumber(ch.getProperty("ZIndex"), ZINDEX_MIN, ZINDEX_MAX, 1),
        };
        if (layer.type === "texture") {
          layer.studsPerTileU = clampNumber(ch.getProperty("StudsPerTileU"), STUDS_TILE_MIN, STUDS_TILE_MAX, 2);
          layer.studsPerTileV = clampNumber(ch.getProperty("StudsPerTileV"), STUDS_TILE_MIN, STUDS_TILE_MAX, 2);
          layer.offsetStudsU = clampNumber(ch.getProperty("OffsetStudsU"), -POS_LIMIT, POS_LIMIT, 0);
          layer.offsetStudsV = clampNumber(ch.getProperty("OffsetStudsV"), -POS_LIMIT, POS_LIMIT, 0);
        }
        (layers = layers || []).push(layer);
      } else if (ch.className === "SpecialMesh" && !special) {
        special = {
          meshType: String(ch.getProperty("MeshType") || "Head"),
          meshId: String(ch.getProperty("MeshId") || ""),
          textureId: String(ch.getProperty("TextureId") || ""),
          scale: readVec(ch, "Scale", { x: 1, y: 1, z: 1 }, -SIZE_MAX, SIZE_MAX),
          offset: readVec(ch, "Offset", { x: 0, y: 0, z: 0 }, -POS_LIMIT, POS_LIMIT),
          vertexColor: readVec(ch, "VertexColor", { x: 1, y: 1, z: 1 }, 0, 10),
        };
      } else if (ch.className === "SurfaceAppearance" && !surface && inst.className === "MeshPart") {
        surface = {
          substrateMaterial: String(ch.getProperty("SubstrateMaterial") || ""),
          colorMap: String(ch.getProperty("ColorMap") || ""),
          normalMap: String(ch.getProperty("NormalMap") || ""),
          metalnessMap: String(ch.getProperty("MetalnessMap") || ""),
          roughnessMap: String(ch.getProperty("RoughnessMap") || ""),
          alphaMode: String(ch.getProperty("AlphaMode") || "Overlay"),
          color: readLayerColor(ch, "Color"),


          normalMapConvention: String(ch.getProperty("NormalMapConvention") || "Auto"),
          heightMap: String(ch.getProperty("HeightMap") || ""),
          heightScale: clampNumber(ch.getProperty("HeightScale"), 0, 0.2, 0.02),
          detailColorMap: String(ch.getProperty("DetailColorMap") || ""),
          detailNormalMap: String(ch.getProperty("DetailNormalMap") || ""),
          detailTiling: clampNumber(ch.getProperty("DetailTiling"), 0.05, 256, 8),
        };
      }
    }
    if (!layers && !special && !surface) return null;
    if (layers) layers.sort((a, b) => a.zIndex - b.zIndex);
    return { layers, special, surface };
  }

  function buildRecord(inst, kind) {
    if (kind === "camera") {
      return {
        id: inst.id,
        instance: inst,
        className: inst.className,
        name: inst.name,
        kind: "camera",
        mesh: true,
        position: { ...CAMERA_POS },
        size: { ...CAMERA_SIZE },
        color: { ...CAMERA_COLOR },
        transparency: 0,
      };
    }
    const rec = {
      id: inst.id,
      instance: inst,
      className: inst.className,
      name: inst.name,
      kind: "part",
      mesh: true,
      position: readVec(inst, "Position", { x: 0, y: 0, z: 0 }, -POS_LIMIT, POS_LIMIT),
      size: readVec(inst, "Size", { x: 1, y: 1, z: 1 }, SIZE_MIN, SIZE_MAX),
      rotation: readVec(inst, "Rotation", { x: 0, y: 0, z: 0 }, -POS_LIMIT, POS_LIMIT),
      color: readColor(inst),
      transparency: readTransparency(inst),
      localTransparency: readLocalTransparency(inst),
      shape: readShape(inst),
    };


    if (inst.className === "MeshPart") {
      rec.isMeshPart = true;
      rec.meshId = inst.hasProperty("MeshId") ? inst.getProperty("MeshId") : "";
      rec.textureId = inst.hasProperty("TextureID") ? inst.getProperty("TextureID") : "";
      rec.doubleSided = inst.getProperty("DoubleSided") === true;
    }


    rec.material = readMaterial(inst);
    rec.materialVariant = readMaterialVariant(inst);
    rec.substrateMaterial = String(inst.getProperty("SubstrateMaterial") || "");
    rec.appearance = collectAppearance(inst);


    const csg = buildCsgData(inst, rec.position, rec.size);
    if (csg) rec.csg = csg;


    if (!rec.csg) {
      const solid = buildSolidData(inst, rec.size);


      if (solid) rec.solid = refineImportedSolid(solid, inst._importedSolid) || solid;
    }
    return rec;
  }


  function buildCsgData(inst, center, baseSize) {
    if (!inst || inst.className !== "UnionOperation") return null;
    const src = Array.isArray(inst._sourceParts) ? inst._sourceParts : null;
    if (!src || !src.length) return null;
    const parts = [];
    for (const p of src) {
      if (!p || p.__isInstance !== true) continue;
      if (typeof p.isDestroyed === "function" && p.isDestroyed()) continue;
      if (!isRenderablePart(p)) continue;
      const pos = readVec(p, "Position", { x: 0, y: 0, z: 0 }, -POS_LIMIT, POS_LIMIT);
      parts.push({
        shape: readShape(p),
        size: readVec(p, "Size", { x: 1, y: 1, z: 1 }, SIZE_MIN, SIZE_MAX),
        rotation: readVec(p, "Rotation", { x: 0, y: 0, z: 0 }, -POS_LIMIT, POS_LIMIT),
        local: { x: pos.x - center.x, y: pos.y - center.y, z: pos.z - center.z },
        color: readColor(p),
        negate: p.className === "NegateOperation",
      });
    }


    const bs = baseSize || { x: 1, y: 1, z: 1 };
    const usePartColor = inst.hasProperty("UsePartColor") ? inst.getProperty("UsePartColor") === true : false;
    const rawAngle = inst.hasProperty("SmoothingAngle") ? Number(inst.getProperty("SmoothingAngle")) : 50;
    const smoothingAngle = Number.isFinite(rawAngle) ? Math.min(180, Math.max(0, rawAngle)) : 50;
    return parts.length
      ? { parts, baseSize: { x: bs.x, y: bs.y, z: bs.z }, usePartColor, smoothingAngle }
      : null;
  }


  function buildSolidData(inst, sizeFallback) {
    if (!inst || inst.className !== "UnionOperation") return null;
    const solid = inst._importedSolid;
    if (!solid || typeof solid !== "object") return null;
    const positions = Array.isArray(solid.positions) ? solid.positions : null;
    if (!positions || positions.length < 9 || positions.length % 9 !== 0) return null;
    const raw = solid.baseSize;
    const bsOk =
      raw &&
      Number.isFinite(raw.x) && raw.x > 0 &&
      Number.isFinite(raw.y) && raw.y > 0 &&
      Number.isFinite(raw.z) && raw.z > 0;


    const bs = bsOk ? raw : sizeFallback || { x: 1, y: 1, z: 1 };
    const usePartColor = inst.hasProperty("UsePartColor") ? inst.getProperty("UsePartColor") === true : false;
    const rawAngle = inst.hasProperty("SmoothingAngle") ? Number(inst.getProperty("SmoothingAngle")) : 50;
    const smoothingAngle = Number.isFinite(rawAngle) ? Math.min(180, Math.max(0, rawAngle)) : 50;
    return {
      source: solid.source === "hulls" ? "hulls" : "meshData",
      positions,
      colors: Array.isArray(solid.colors) && solid.colors.length ? solid.colors : null,
      baseSize: { x: bs.x, y: bs.y, z: bs.z },
      triCount: Number.isFinite(solid.triCount) ? solid.triCount : Math.floor(positions.length / 9),
      usePartColor,
      smoothingAngle,
    };
  }


  function emitAdd(rec) {
    if (sink && typeof sink.add === "function") sink.add(rec);
  }
  function emitUpdate(rec, keys) {
    if (sink && typeof sink.update === "function") sink.update(rec, keys);
  }
  function emitRemove(id) {
    if (sink && typeof sink.remove === "function") sink.remove(id);
  }
  function emitSelection() {
    if (sink && typeof sink.selection === "function") {
      sink.selection(new Set(selectedIds));
    }
  }


  function inWorkspace(inst) {
    const ws = getWorkspace();
    if (!ws || !inst) return false;
    let cur = inst;
    let guard = 0;
    while (cur && guard < 10000) {
      if (cur === ws) return true;
      cur = typeof cur.getParent === "function" ? cur.getParent() : null;
      guard += 1;
    }
    return false;
  }


  function addInstance(inst, kind) {
    if (!inst || records.has(inst.id)) return;
    if (typeof inst.isDestroyed === "function" && inst.isDestroyed()) return;
    if (!hasMesh(kind)) return;
    if (records.size >= maxObjects) {
      if (!warnedCap) {
        warnedCap = true;
        logger.warn(
          `Viewport: limite de ${maxObjects} objetos renderizados atingido; novos objetos não serão exibidos.`,
        );
      }
      return;
    }
    const rec = buildRecord(inst, kind);
    records.set(inst.id, rec);
    emitAdd(rec);
    if (selection && typeof selection.isSelected === "function") {
      try {
        if (selection.isSelected(inst)) {
          selectedIds.add(inst.id);
          emitSelection();
        }
      } catch (_) {

      }
    }
  }

  function addSubtree(node) {
    if (!node) return;
    const nodes = [node, ...(node.getDescendants ? node.getDescendants() : [])];
    for (const n of nodes) addInstance(n, kindOf(n));
  }

  function removeInstance(id) {
    if (!records.has(id)) return;
    records.delete(id);
    if (selectedIds.delete(id)) emitSelection();
    emitRemove(id);
  }

  function removeSubtree(node) {
    if (!node) return;
    const nodes = [node, ...(node.getDescendants ? node.getDescendants() : [])];
    for (const n of nodes) removeInstance(n.id);
  }


  function onChildAdded(payload) {
    const child = payload && payload.child;
    if (!child) return;
    if (inWorkspace(child)) addSubtree(child);

    if (kindOf(child) === "appearance") {
      refreshAppearanceFor(typeof child.getParent === "function" ? child.getParent() : null);
    }
    if (child.className === "MaterialVariant") refreshAllMaterials();
  }

  function onChildRemoved(payload) {
    const child = payload && payload.child;
    if (!child) return;
    removeSubtree(child);

    if (kindOf(child) === "appearance") {
      refreshAppearanceFor(payload.parent || null);
    }
    if (child.className === "MaterialVariant") refreshAllMaterials();
  }

  function onDestroying(payload) {
    const inst = payload && payload.instance;
    if (inst) removeInstance(inst.id);
  }

  function onPropertyChanged(payload) {
    if (!payload || !payload.instance) return;
    const rec = records.get(payload.instance.id);
    if (!rec) {


      handleNonRecordChange(payload.instance);
      return;
    }
    const prop = payload.property;
    const inst = payload.instance;
    switch (prop) {
      case "Position":
        if (rec.kind !== "part") return;
        rec.position = readVec(inst, "Position", rec.position, -POS_LIMIT, POS_LIMIT);
        break;
      case "Size":
        if (rec.kind !== "part") return;
        rec.size = readVec(inst, "Size", rec.size, SIZE_MIN, SIZE_MAX);
        break;
      case "Rotation":
        if (rec.kind !== "part") return;
        rec.rotation = readVec(inst, "Rotation", rec.rotation || { x: 0, y: 0, z: 0 }, -POS_LIMIT, POS_LIMIT);
        break;
      case "Color":
        if (rec.kind !== "part") return;
        rec.color = readColor(inst);
        if (inst.className === "UnionOperation" && rec.csg) {
          const ncsg = buildCsgData(inst, rec.position, rec.csg.baseSize || rec.size);
          if (ncsg) rec.csg = ncsg;
        }


        if (inst.className === "UnionOperation" && !rec.csg && rec.solid) {
          const nsolid = buildSolidData(inst, rec.size);
          if (nsolid) rec.solid = nsolid;
        }
        break;
      case "UsePartColor":
      case "SmoothingAngle":
        if (rec.kind !== "part" || inst.className !== "UnionOperation") return;
        {
          const ncsg = buildCsgData(inst, rec.position, rec.csg && rec.csg.baseSize ? rec.csg.baseSize : rec.size);
          if (ncsg) rec.csg = ncsg;


          if (!rec.csg && rec.solid) {
            const nsolid = buildSolidData(inst, rec.size);
            if (nsolid) rec.solid = nsolid;
          }
        }
        break;
      case "Transparency":
        if (rec.kind !== "part") return;
        rec.transparency = readTransparency(inst);
        break;
      case "LocalTransparencyModifier":
        if (rec.kind !== "part") return;
        rec.localTransparency = readLocalTransparency(inst);
        break;
      case "Shape":
        if (rec.kind !== "part") return;
        rec.shape = readShape(inst);
        break;
      case "MeshId":
        if (!rec.isMeshPart) return;
        rec.meshId = inst.hasProperty("MeshId") ? inst.getProperty("MeshId") : "";
        break;
      case "TextureID":
        if (!rec.isMeshPart) return;
        rec.textureId = inst.hasProperty("TextureID") ? inst.getProperty("TextureID") : "";
        break;
      case "Material":
        if (rec.kind !== "part") return;
        rec.material = readMaterial(inst);
        break;
      case "SubstrateMaterial":
        if (rec.kind !== "part") return;
        rec.substrateMaterial = String(inst.getProperty("SubstrateMaterial") || "");
        break;
      case "MaterialVariant":
        if (rec.kind !== "part") return;
        rec.materialVariant = readMaterialVariant(inst);
        break;
      case "DoubleSided":
        if (!rec.isMeshPart) return;
        rec.doubleSided = inst.getProperty("DoubleSided") === true;
        break;
      case "Name":
        rec.name = inst.name;
        break;
      default:
        return;                                               
    }
    emitUpdate(rec, [prop]);
  }


  function refreshAppearanceFor(parentInst) {
    if (!parentInst || parentInst.__isInstance !== true) return;
    const rec = records.get(parentInst.id);
    if (!rec || rec.kind !== "part") return;
    rec.appearance = collectAppearance(parentInst);
    emitUpdate(rec, ["Appearance"]);
  }


  function refreshAllMaterials() {
    for (const rec of records.values()) {
      if (rec.kind !== "part") continue;
      rec.material = readMaterial(rec.instance);
      rec.materialVariant = readMaterialVariant(rec.instance);
      emitUpdate(rec, ["Material"]);
    }
  }

  function handleNonRecordChange(inst) {
    if (!inst || inst.__isInstance !== true) return;


    if (inst.className === "Lighting") {
      const raw = typeof inst.getProperty === "function" ? inst.getProperty("RenderStyle") : null;
      if (setActiveRenderStyle(raw).changed) {
        sweepMaterialPhysics();
        refreshAllMaterials();
      }
      return;
    }
    if (APPEARANCE_CLASSES.has(inst.className)) {
      refreshAppearanceFor(typeof inst.getParent === "function" ? inst.getParent() : null);
      return;
    }
    if (inst.className === "MaterialVariant" || inst.className === "MaterialService") {
      refreshAllMaterials();
    }
  }


  function onCloudSolidResolved(payload) {
    const inst = payload && payload.instance;
    if (!inst || inst.__isInstance !== true) return;
    if (!records.has(inst.id)) return;                                    
    const kind = kindOf(inst);
    removeInstance(inst.id);
    addInstance(inst, kind);
  }


  const MAX_CONTAINER_HIGHLIGHT = 150;
  function addDescendantRecords(inst, budget) {
    if (budget <= 0 || !inst || typeof inst.getChildren !== "function") return budget;
    for (const child of inst.getChildren()) {
      if (budget <= 0) return 0;
      if (child && records.has(child.id) && !selectedIds.has(child.id)) {
        selectedIds.add(child.id);
        budget -= 1;
      }
      budget = addDescendantRecords(child, budget);
    }
    return budget;
  }

  function onSelectionChanged(payload) {
    const items = payload && Array.isArray(payload.items) ? payload.items : null;
    const ids =
      payload && Array.isArray(payload.ids)
        ? payload.ids
        : items
          ? items.map((i) => i && i.id).filter(Boolean)
          : [];
    selectedIds.clear();
    for (const id of ids) {
      if (records.has(id)) selectedIds.add(id);
    }
    if (items) {
      let budget = MAX_CONTAINER_HIGHLIGHT;
      for (const it of items) {
        if (budget <= 0) break;
        if (it && it.id != null && !records.has(it.id)) budget = addDescendantRecords(it, budget);
      }
    }
    emitSelection();
  }


  function setSink(s) {
    sink = s || null;
  }


  function flush() {
    for (const rec of records.values()) emitAdd(rec);
    emitSelection();
  }

  function scan() {
    const ws = getWorkspace();
    if (!ws) return;
    addSubtree(ws);
  }

  function syncSelectionFromManager() {
    let items = [];
    try {
      if (selection && typeof selection.get === "function") items = selection.get() || [];
    } catch (_) {
      items = [];
    }
    onSelectionChanged({ items });
  }


  function seedRenderStyle() {
    try {
      const ws = getWorkspace();
      const root = ws && typeof ws.getParent === "function" ? ws.getParent() : null;
      const kids = root && typeof root.getChildren === "function" ? root.getChildren() : [];
      for (const kid of kids) {
        if (kid && kid.className === "Lighting") {
          const raw = typeof kid.getProperty === "function" ? kid.getProperty("RenderStyle") : null;





          if (setActiveRenderStyle(raw).changed) {
            sweepMaterialPhysics();
            refreshAllMaterials();
          }
          return;
        }
      }
    } catch (_) {

    }
  }

  function start() {
    if (started) return;
    started = true;
    offs.push(bus.on(Events.ChildAdded, onChildAdded));
    offs.push(bus.on(Events.ChildRemoved, onChildRemoved));
    offs.push(bus.on(Events.Destroying, onDestroying));
    offs.push(bus.on(Events.PropertyChanged, onPropertyChanged));

    offs.push(bus.on("csg:cloudSolidResolved", onCloudSolidResolved));
    offs.push(bus.on("selection:changed", onSelectionChanged));
    scan();
    seedRenderStyle();                                                  
    syncSelectionFromManager();
  }

  function stop() {
    for (const off of offs) {
      try {
        if (typeof off === "function") off();
      } catch (_) {

      }
    }
    offs.length = 0;
    started = false;
  }

  function getRecords() {
    return [...records.values()];
  }
  function getRecord(id) {
    return records.get(id) || null;
  }
  function getSelectedIds() {
    return new Set(selectedIds);
  }
  function getSelectedRecords() {
    const out = [];
    for (const id of selectedIds) {
      const r = records.get(id);
      if (r) out.push(r);
    }
    return out;
  }

  return {
    start,
    stop,
    setSink,
    flush,
    rescan: scan,
    getRecords,
    getRecord,
    getSelectedIds,
    getSelectedRecords,
  };
}
