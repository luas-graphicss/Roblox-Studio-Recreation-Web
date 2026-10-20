import { createInstance, getService, makeColor, makeVector3 } from "../datamodel/index.js";
import { store } from "../core/state.js";
import { commands } from "../core/commands.js";
import { selection } from "../core/selection.js";
import { logger } from "../core/logger.js";
import { clampNumber } from "../utils/validate.js";
import {
  ensureCharacterAttachments,
  ensureWrapTargets,
  syncRigAttachmentPositions,
  equipAccessory,
  unequipAccessory,
  findHandle,
  ATTACHMENT_BY_ACCESSORY_TYPE,
  isLayeredType,
} from "./accessoryRuntime.js";
import { buildAccessoryInstance } from "./accessoryFactory.js";
import { getRigTemplate } from "./rigs.js";
import { hasBoneDescendant } from "../assets/skinnedMeshFactory.js";            
import { sanitizeName } from "../datamodel/types.js";




export const MAX_ACCESSORIES = 50;

export const SCALE_FIELDS = Object.freeze([
  { key: "height", prop: "BodyHeightScale", label: "Height", min: 0.8, max: 2.0, def: 1.0 },
  { key: "width", prop: "BodyWidthScale", label: "Width", min: 0.7, max: 1.3, def: 1.0 },
  { key: "head", prop: "HeadScale", label: "Head", min: 0.6, max: 2.0, def: 1.0 },
  { key: "depth", prop: "BodyDepthScale", label: "BodyDepth", min: 0.7, max: 1.3, def: 1.0 },
]);

export const HIP_HEIGHT = Object.freeze({ min: 0, max: 10, def: 1.35 });

export const EXTENTS_MODES = Object.freeze(["Full", "Disabled"]);
export const COLLISION_TYPES = Object.freeze(["OuterBox", "InnerBox"]);


export const BODY_COLOR_MEMBERS = Object.freeze([
  { key: "Head", prop: "HeadColor", label: "Head" },
  { key: "Torso", prop: "TorsoColor", label: "Torso" },
  { key: "LeftArm", prop: "LeftArmColor", label: "Left Arm" },
  { key: "RightArm", prop: "RightArmColor", label: "Right Arm" },
  { key: "LeftLeg", prop: "LeftLegColor", label: "Left Leg" },
  { key: "RightLeg", prop: "RightLegColor", label: "Right Leg" },
]);


export const DESC_ASSET_FIELDS = Object.freeze([
  { prop: "Face", label: "Face" },
  { prop: "Head", label: "Head" },
  { prop: "Torso", label: "Torso" },
  { prop: "LeftArm", label: "Left Arm" },
  { prop: "RightArm", label: "Right Arm" },
  { prop: "LeftLeg", label: "Left Leg" },
  { prop: "RightLeg", label: "Right Leg" },
  { prop: "HatAccessory", label: "Hat Accessory" },
  { prop: "HairAccessory", label: "Hair Accessory" },
  { prop: "FaceAccessory", label: "Face Accessory" },
  { prop: "Shirt", label: "Shirt" },
  { prop: "Pants", label: "Pants" },
  { prop: "GraphicTShirt", label: "Graphic T-Shirt" },
]);


export const VISIBILITY_GROUPS = Object.freeze([
  { key: "Head", label: "Head", parts: ["Head"] },
  { key: "Torso", label: "Torso", parts: ["Torso", "UpperTorso", "LowerTorso"] },
  {
    key: "Arms",
    label: "Arms",
    parts: [
      "Left Arm", "Right Arm",
      "LeftUpperArm", "LeftLowerArm", "LeftHand",
      "RightUpperArm", "RightLowerArm", "RightHand",
    ],
  },
  {
    key: "Legs",
    label: "Legs",
    parts: [
      "Left Leg", "Right Leg",
      "LeftUpperLeg", "LeftLowerLeg", "LeftFoot",
      "RightUpperLeg", "RightLowerLeg", "RightFoot",
    ],
  },
]);







const RIBBON_ACCESSORY_TYPES = Object.freeze([
  "Hat", "Hair", "Face", "Neck", "Shoulder", "Front", "Back", "Waist",
]);
const ATTACHMENT_BY_TYPE = Object.freeze(
  Object.fromEntries(RIBBON_ACCESSORY_TYPES.map((t) => [t, ATTACHMENT_BY_ACCESSORY_TYPE[t]])),
);



const BODY_PART_NAMES = Object.freeze({
  Head: ["Head"],
  Torso: ["Torso", "UpperTorso", "LowerTorso"],
  LeftArm: ["Left Arm", "LeftUpperArm", "LeftLowerArm", "LeftHand"],
  RightArm: ["Right Arm", "RightUpperArm", "RightLowerArm", "RightHand"],
  LeftLeg: ["Left Leg", "LeftUpperLeg", "LeftLowerLeg", "LeftFoot"],
  RightLeg: ["Right Leg", "RightUpperLeg", "RightLowerLeg", "RightFoot"],
});


const ACCESSORY_PLACEMENT = Object.freeze({
  Hat: { ref: "Head", offset: [0, 0.95, 0], size: [1.9, 0.7, 1.9], color: [0.13, 0.13, 0.16] },
  Hair: { ref: "Head", offset: [0, 0.7, 0], size: [2.0, 0.9, 2.0], color: [0.25, 0.16, 0.08] },
  Face: { ref: "Head", offset: [0, 0.05, 0.55], size: [1.3, 0.8, 0.3], color: [0.1, 0.1, 0.1] },
  Neck: { ref: "Torso", offset: [0, 0.95, 0.35], size: [1.2, 0.4, 0.5], color: [0.7, 0.1, 0.1] },
  Shoulder: { ref: "Torso", offset: [1.15, 0.85, 0], size: [0.7, 0.5, 1.0], color: [0.3, 0.3, 0.35] },
  Front: { ref: "Torso", offset: [0, 0.15, 0.55], size: [1.2, 1.0, 0.3], color: [0.2, 0.4, 0.8] },
  Back: { ref: "Torso", offset: [0, 0.2, -0.55], size: [1.2, 1.4, 0.4], color: [0.2, 0.4, 0.8] },
  Waist: { ref: "Torso", offset: [0, -0.95, 0.3], size: [1.5, 0.4, 0.5], color: [0.13, 0.13, 0.16] },
});


function defaultBodyColors() {
  return {
    HeadColor: makeColor(0.953, 0.776, 0.565),
    TorsoColor: makeColor(0.039, 0.412, 0.675),
    LeftArmColor: makeColor(0.953, 0.776, 0.565),
    RightArmColor: makeColor(0.953, 0.776, 0.565),
    LeftLegColor: makeColor(0.0, 0.643, 0.0),
    RightLegColor: makeColor(0.0, 0.643, 0.0),
  };
}


function live(inst) {
  return !!(inst && inst.__isInstance === true && typeof inst.isDestroyed === "function" && !inst.isDestroyed());
}

function num(v, fb) {
  return Number.isFinite(v) ? v : fb;
}


function yawOf(part) {
  if (!live(part) || typeof part.hasProperty !== "function" || !part.hasProperty("Rotation")) return 0;
  const r = part.getProperty("Rotation") || {};
  return Number(r.y) || 0;
}


function rotYaw(x, y, z, yawDeg) {
  const a = ((Number(yawDeg) || 0) * Math.PI) / 180;
  if (a === 0) return { x, y, z };
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: x * c + z * s, y, z: -x * s + z * c };
}

function getWorkspace() {
  return getService(store.getDataModel(), "Workspace");
}

function currentSelection() {
  return selection.get();
}

function restoreSelection(items) {
  selection.set((items || []).filter(live));
}


function findCharacterFrom(inst) {
  let cur = inst;
  while (live(cur)) {
    if (typeof cur.getChildren === "function") {
      const hasHum = cur.getChildren().some((c) => c.className === "Humanoid");
      if (hasHum) return cur;
    }
    cur = cur.getParent();
  }
  return null;
}

function findHumanoidIn(char) {
  if (!live(char)) return null;
  return char.getChildren().find((c) => c.className === "Humanoid") || null;
}

function findChildByClass(char, className) {
  if (!live(char)) return null;
  return char.getChildren().find((c) => c.className === className) || null;
}

function getDescription(char) {
  return findChildByClass(char, "HumanoidDescription");
}

function findPartsByNames(char, names) {
  if (!live(char)) return [];
  const set = new Set(names);
  return char.getDescendants().filter(
    (d) => set.has(d.name) && typeof d.hasProperty === "function" && d.hasProperty("Transparency"),
  );
}

function findPartByName(char, name) {
  if (!live(char)) return null;
  return (
    char.getDescendants().find(
      (d) => d.name === name && typeof d.hasProperty === "function" && d.hasProperty("Size"),
    ) || null
  );
}


function findReferencePart(char, refName) {
  const candidates =
    refName === "Torso"
      ? ["Torso", "UpperTorso", "LowerTorso"]
      : refName === "Head"
        ? ["Head"]
        : [refName];
  for (const nm of candidates) {
    const part = findPartByName(char, nm);
    if (part) return part;
  }
  return null;
}


function sanitizeAssetId(v) {
  if (v == null) return 0;
  const digits = String(v).replace(/[^0-9]/g, "");
  if (digits === "") return 0;
  const n = parseInt(digits, 10);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}


export function applyRigShape(char, hum) {
  if (!live(char) || !live(hum)) return;
  const template = getRigTemplate(hum.getProperty("RigType"));
  if (!template) return;
  const width = num(hum.getProperty("BodyWidthScale"), 1);
  const height = num(hum.getProperty("BodyHeightScale"), 1);
  const depth = num(hum.getProperty("BodyDepthScale"), 1);
  const headScale = num(hum.getProperty("HeadScale"), 1);
  const troot =
    template.parts.find((p) => p.name === template.rootPart) || template.parts[0];
  const rootPart = findPartByName(char, template.rootPart);

  const anchor = rootPart
    ? rootPart.getProperty("Position")
    : makeVector3(troot.pos[0], troot.pos[1], troot.pos[2]);


  const rootYaw = yawOf(rootPart);
  for (const pd of template.parts) {
    const part = findPartByName(char, pd.name);
    if (!part) continue;
    if (pd.name === "Head") {

      part.setProperty(
        "Size",
        makeVector3(pd.size[0] * headScale, pd.size[1] * headScale, pd.size[2] * headScale),
      );
    } else {
      part.setProperty(
        "Size",
        makeVector3(pd.size[0] * width, pd.size[1] * height, pd.size[2] * depth),
      );
    }
    const ox = (pd.pos[0] - troot.pos[0]) * width;
    let oy = (pd.pos[1] - troot.pos[1]) * height;
    const oz = (pd.pos[2] - troot.pos[2]) * depth;
    if (pd.name === "Head") {


      oy += (pd.size[1] / 2) * (headScale - height);
    }
    const off = rotYaw(ox, oy, oz, rootYaw);
    part.setProperty("Position", makeVector3(anchor.x + off.x, anchor.y + off.y, anchor.z + off.z));
  }


  syncRigAttachmentPositions(char);
}


export function getSelectedCharacter() {
  for (const it of currentSelection()) {
    const char = findCharacterFrom(it);
    if (char) return char;
  }
  return null;
}

export function getSelectedHumanoid() {
  for (const it of currentSelection()) {
    if (live(it) && it.className === "Humanoid") return it;
  }
  return findHumanoidIn(getSelectedCharacter());
}

export function getSelectedAccessory() {
  for (const it of currentSelection()) {
    let cur = it;
    while (live(cur)) {
      if (cur.className === "Accessory") return cur;
      cur = cur.getParent();
    }
  }
  return null;
}

export function hasHumanoid() {
  return !!getSelectedHumanoid();
}
export function hasCharacter() {
  return !!getSelectedCharacter();
}
export function hasAccessorySelected() {
  return !!getSelectedAccessory();
}
export function canBuildRig() {
  return !!getWorkspace();
}


export function getSelectedSkinnedRig() {
  for (const it of currentSelection()) {
    let cur = it;
    while (live(cur)) {
      if ((cur.className === "Model" || cur.className === "MeshPart") && hasBoneDescendant(cur)) {
        return cur;
      }
      cur = typeof cur.getParent === "function" ? cur.getParent() : null;
    }
  }
  return null;
}

export function getRigTypeLabel() {
  const hum = getSelectedHumanoid();
  if (hum) return hum.getProperty("RigType") || "Desconhecido";
  if (getSelectedSkinnedRig()) return "Skinned";
  return "Nenhum";
}

export function getAccessoryCount(char) {
  const c = char || getSelectedCharacter();
  if (!live(c)) return 0;
  return c.getChildren().filter((x) => x.className === "Accessory").length;
}


function constructRig(template) {
  const model = createInstance("Model", { name: template.modelName });
  const partByName = new Map();

  for (const pd of template.parts) {
    const part = createInstance("Part", { name: pd.name });
    part.setProperty("Size", makeVector3(pd.size[0], pd.size[1], pd.size[2]));
    part.setProperty("Position", makeVector3(pd.pos[0], pd.pos[1], pd.pos[2]));
    part.setProperty("Color", makeColor(pd.color[0], pd.color[1], pd.color[2]));
    part.setProperty("Anchored", true);
    if (pd.transparency != null) part.setProperty("Transparency", pd.transparency);
    part.setParent(model);
    partByName.set(pd.name, part);
    if (pd.mesh) {
      const mesh = createInstance("SpecialMesh", { name: "Mesh" });
      mesh.setProperty("MeshType", pd.mesh);
      mesh.setParent(part);
    }
  }

  const hum = createInstance("Humanoid", {});
  hum.setProperty("RigType", template.rigType);
  hum.setParent(model);


  for (const jd of template.joints) {
    const host = partByName.get(jd.parent);
    const p0 = partByName.get(jd.part0);
    const p1 = partByName.get(jd.part1);
    if (!host || !p0 || !p1) continue;
    const motor = createInstance("Motor6D", { name: jd.name });
    motor.setProperty("Part0", p0);
    motor.setProperty("Part1", p1);
    motor.setParent(host);
  }

  const animate = createInstance("LocalScript", { name: "Animate" });
  animate.setProperty("Source", "-- Animate (placeholder \u2014 Animation será implementado em parte futura)\n");
  animate.setParent(model);

  return model;
}

export function buildRig(rigType) {
  const ws = getWorkspace();
  if (!ws) {
    logger.warn("Build Rig: Workspace indisponível.");
    return false;
  }
  const template = getRigTemplate(rigType);
  if (!template) {
    logger.warn(`Build Rig: tipo de rig desconhecido "${rigType}".`);
    return false;
  }
  const prevSel = currentSelection();
  let model = null;
  return commands.execute({
    name: `Inserir ${template.modelName}`,
    do() {
      if (!live(ws)) return false;
      if (!model || model.isDestroyed()) model = constructRig(template);
      model.setParent(ws);
      ensureCharacterAttachments(model);
      ensureWrapTargets(model);
      selection.set([model]);                      
      return true;
    },
    undo() {
      if (model && live(model)) model.setParent(null);
      restoreSelection(prevSel);
    },
  });
}


const ARM_PART_NAMES = Object.freeze([
  "Left Arm",
  "Right Arm",
  "LeftUpperArm",
  "LeftLowerArm",
  "LeftHand",
  "RightUpperArm",
  "RightLowerArm",
  "RightHand",
]);
const LEG_PART_NAMES = Object.freeze([
  "Left Leg",
  "Right Leg",
  "LeftUpperLeg",
  "LeftLowerLeg",
  "LeftFoot",
  "RightUpperLeg",
  "RightLowerLeg",
  "RightFoot",
]);

function clampOr(v, min, max, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

function sanitizeRgb01(c, fb) {
  const o = c && typeof c === "object" ? c : {};
  return [clampOr(o.r, 0, 1, fb[0]), clampOr(o.g, 0, 1, fb[1]), clampOr(o.b, 0, 1, fb[2])];
}


function customPartColor(partName, palette) {
  if (LEG_PART_NAMES.indexOf(partName) !== -1) return palette.leg;
  if (partName === "HumanoidRootPart" || partName.indexOf("Torso") !== -1) return palette.torso;
  return palette.skin;                       
}


function buildCustomTemplate(config) {
  const cfg = config && typeof config === "object" ? config : {};
  const base = getRigTemplate(cfg.base === "R6" ? "R6" : "R15");
  if (!base) return null;
  const colors = cfg.colors && typeof cfg.colors === "object" ? cfg.colors : {};
  const palette = {
    skin: sanitizeRgb01(colors.skin, [0.953, 0.776, 0.565]),
    torso: sanitizeRgb01(colors.torso, [0.039, 0.412, 0.675]),
    leg: sanitizeRgb01(colors.leg, [0.0, 0.643, 0.0]),
  };
  const removed = new Set();
  if (cfg.includeArms === false) for (const n of ARM_PART_NAMES) removed.add(n);
  if (cfg.includeLegs === false) for (const n of LEG_PART_NAMES) removed.add(n);

  const parts = [];
  for (const pd of base.parts) {
    if (removed.has(pd.name)) continue;
    parts.push({
      name: pd.name,
      size: pd.size.slice(),
      pos: pd.pos.slice(),
      color: customPartColor(pd.name, palette),
      transparency: pd.transparency,
      mesh: pd.mesh,
    });
  }
  const joints = base.joints.filter(
    (jd) => !removed.has(jd.part0) && !removed.has(jd.part1) && !removed.has(jd.parent),
  );
  return {
    rigType: base.rigType,                                                                   
    modelName: sanitizeName(cfg.name, "Custom Rig"),
    rootPart: base.rootPart,
    parts,
    joints,
  };
}


export function buildCustomRig(config) {
  const ws = getWorkspace();
  if (!ws) {
    logger.warn("Custom Rig: Workspace indisponível.");
    return false;
  }
  const template = buildCustomTemplate(config);
  if (!template || !template.parts.length) {
    logger.warn("Custom Rig: configuração sem partes válidas.");
    return false;
  }
  const scalesIn = config && config.scales && typeof config.scales === "object" ? config.scales : {};
  const prevSel = currentSelection();
  let model = null;
  const ok = commands.execute({
    name: `Inserir ${template.modelName} (Custom Rig)`,
    do() {
      if (!live(ws)) return false;
      if (!model || model.isDestroyed()) {
        model = constructRig(template);
        const hum = findHumanoidIn(model);
        if (hum) {
          for (const f of SCALE_FIELDS) {
            hum.setProperty(f.prop, clampOr(scalesIn[f.key], f.min, f.max, f.def));
          }
          applyRigShape(model, hum);
        }
      }
      model.setParent(ws);
      ensureCharacterAttachments(model);
      ensureWrapTargets(model);
      selection.set([model]);                                           
      return true;
    },
    undo() {
      if (model && live(model)) model.setParent(null);
      restoreSelection(prevSel);
    },
  });
  if (ok) logger.info(`Custom Rig "${template.modelName}" inserido (base ${template.rigType}).`);
  return ok;
}


export const BODY_MESH_TYPES = Object.freeze([
  "Brick",
  "Sphere",
  "Cylinder",
  "Wedge",
  "CornerWedge",
  "Pyramid",
  "Prism",
  "Head",
  "Torso",
]);


function readSpecialMeshState(part) {
  const mesh = findChildByClass(part, "SpecialMesh");
  if (!live(mesh)) return null;
  const sc = mesh.getProperty("Scale") || {};
  const of = mesh.getProperty("Offset") || {};
  return {
    meshType: String(mesh.getProperty("MeshType") || "Head"),
    meshId: String(mesh.getProperty("MeshId") || ""),
    textureId: String(mesh.getProperty("TextureId") || ""),
    scale: { x: num(sc.x, 1), y: num(sc.y, 1), z: num(sc.z, 1) },
    offset: { x: num(of.x, 0), y: num(of.y, 0), z: num(of.z, 0) },
  };
}


function writeSpecialMeshState(part, state) {
  let mesh = findChildByClass(part, "SpecialMesh");
  if (!state) {
    if (live(mesh)) mesh.setParent(null);
    return;
  }
  if (!live(mesh)) {
    mesh = createInstance("SpecialMesh", { name: "Mesh" });
    mesh.setParent(part);
  }
  mesh.setProperty("MeshType", state.meshType);
  mesh.setProperty("MeshId", state.meshId || "");
  mesh.setProperty("TextureId", state.textureId || "");
  const sc = state.scale || {};
  const of = state.offset || {};
  mesh.setProperty("Scale", makeVector3(num(sc.x, 1), num(sc.y, 1), num(sc.z, 1)));
  mesh.setProperty("Offset", makeVector3(num(of.x, 0), num(of.y, 0), num(of.z, 0)));
}


export function getBodyMeshState() {
  const char = getSelectedCharacter();
  const out = {};
  for (const m of BODY_COLOR_MEMBERS) {
    const parts = live(char) ? findPartsByNames(char, BODY_PART_NAMES[m.key] || []).filter(live) : [];
    out[m.key] = parts.length ? readSpecialMeshState(parts[0]) : null;
  }
  return out;
}


export function applyBodyMesh(memberKey, spec) {
  const char = getSelectedCharacter();
  if (!live(char)) {
    logger.warn("Body Mesh: selecione um personagem (Model com Humanoid).");
    return false;
  }
  const names = BODY_PART_NAMES[memberKey];
  if (!names) {
    logger.warn(`Body Mesh: membro desconhecido "${String(memberKey)}".`);
    return false;
  }
  const parts = findPartsByNames(char, names).filter(live);
  if (!parts.length) {
    logger.warn(`Body Mesh: o personagem não possui Parts do membro "${memberKey}".`);
    return false;
  }
  let next = null;
  if (spec && typeof spec === "object") {
    if (spec.meshType === "FileMesh") {
      const id = String(spec.meshId || "").trim();
      if (!id) {
        logger.warn("Body Mesh: FileMesh requer um MeshId.");
        return false;
      }
      next = { meshType: "FileMesh", meshId: id };
    } else if (BODY_MESH_TYPES.indexOf(spec.meshType) !== -1) {
      next = { meshType: spec.meshType, meshId: "" };
    } else {
      logger.warn(`Body Mesh: MeshType inválido "${String(spec.meshType)}".`);
      return false;
    }
  }
  const targets = parts.map((part) => ({ part, prev: readSpecialMeshState(part) }));
  const label = next ? `Body Mesh: ${next.meshType} (${memberKey})` : `Body Mesh: remover (${memberKey})`;
  return commands.execute({
    name: label,
    do() {
      for (const t of targets) if (live(t.part)) writeSpecialMeshState(t.part, next);
      return true;
    },
    undo() {
      for (const t of targets) if (live(t.part)) writeSpecialMeshState(t.part, t.prev);
    },
  });
}


function placementFor(type) {
  return ACCESSORY_PLACEMENT[type] || ACCESSORY_PLACEMENT.Hat;
}


function computeHandlePos(char, place) {
  const ref = findReferencePart(char, place.ref);
  const base = ref ? ref.getProperty("Position") : makeVector3(0, 4.5, 0);



  const off = rotYaw(place.offset[0], place.offset[1], place.offset[2], ref ? yawOf(ref) : 0);
  return makeVector3(base.x + off.x, base.y + off.y, base.z + off.z);
}

function constructAccessory(type, handlePos) {


  const acc = buildAccessoryInstance({
    type,
    name: `${type}Accessory`,
    attachmentName: ATTACHMENT_BY_TYPE[type] || "HatAttachment",
    layered: false,
  });


  const handle = findHandle(acc);
  if (handle) handle.setProperty("Position", makeVector3(handlePos.x, handlePos.y, handlePos.z));
  return acc;
}

export function addAccessory(type) {
  const char = getSelectedCharacter();
  if (!char) {
    logger.warn("Add Accessory: nenhum personagem selecionado.");
    return false;
  }
  if (!ATTACHMENT_BY_TYPE[type]) {
    logger.warn(`Add Accessory: tipo inválido "${type}".`);
    return false;
  }
  if (getAccessoryCount(char) >= MAX_ACCESSORIES) {
    logger.warn(`Add Accessory: limite de ${MAX_ACCESSORIES} acessórios atingido.`);
    return false;
  }
  const place = placementFor(type);
  const handlePos = computeHandlePos(char, place);
  const prevSel = currentSelection();
  let acc = null;
  return commands.execute({
    name: `Adicionar ${type} Accessory`,
    do() {
      if (!live(char)) return false;
      if (!acc || acc.isDestroyed()) acc = constructAccessory(type, handlePos);
      ensureCharacterAttachments(char);
      ensureWrapTargets(char);
      const res = equipAccessory(char, acc);
      if (!res.ok && (!acc.getParent || acc.getParent() !== char)) acc.setParent(char);
      selection.set([acc]);
      return true;
    },
    undo() {
      if (acc && live(acc)) {
        unequipAccessory(acc);
        acc.setParent(null);
      }
      restoreSelection(prevSel);
    },
  });
}

export function fitToCharacter() {
  const acc = getSelectedAccessory();
  if (!acc) {
    logger.warn("Fit to Character: nenhum acessório selecionado.");
    return false;
  }
  const char = findCharacterFrom(acc);
  const handle = findHandle(acc);                                             
  if (!char || !handle) {
    logger.warn("Fit to Character: acessório ou personagem incompleto.");
    return false;
  }
  const type = acc.hasProperty && acc.hasProperty("AccessoryType") ? acc.getProperty("AccessoryType") : "Hat";


  const place = isLayeredType(type)
    ? { ref: "Torso", offset: [0, 0, 0] }
    : placementFor(type);
  const target = computeHandlePos(char, place);
  const old = handle.getProperty("Position");
  return commands.execute({
    name: "Fit Accessory",
    do() {
      if (!live(handle)) return false;
      return handle.setProperty("Position", makeVector3(target.x, target.y, target.z));
    },
    undo() {
      if (live(handle) && old) handle.setProperty("Position", old);
    },
  });
}

export function removeAllAccessories() {
  const char = getSelectedCharacter();
  if (!char) {
    logger.warn("Remove All Accessories: nenhum personagem selecionado.");
    return false;
  }
  const accs = char.getChildren().filter((c) => c.className === "Accessory");
  if (accs.length === 0) return false;
  return commands.execute({
    name: "Remover Acessórios",
    do() {
      for (const acc of accs) {
        if (!live(acc)) continue;
        unequipAccessory(acc);
        acc.setParent(null);
      }
      return true;
    },
    undo() {
      if (!live(char)) return;
      for (const acc of accs) if (live(acc)) acc.setParent(char);
    },
  });
}


function setHumanoidProp(prop, value, label) {
  const hum = getSelectedHumanoid();
  if (!hum || !live(hum)) {
    logger.warn(`${label || prop}: nenhum Humanoid selecionado.`);
    return false;
  }
  const old = hum.getProperty(prop);
  return commands.execute({
    name: label || `Set ${prop}`,
    do() {
      if (!live(hum)) return false;
      return hum.setProperty(prop, value);
    },
    undo() {
      if (live(hum)) hum.setProperty(prop, old);
    },
  });
}

export function getScale(key) {
  const f = SCALE_FIELDS.find((x) => x.key === key);
  const hum = getSelectedHumanoid();
  if (!f || !hum) return f ? f.def : 1;
  const v = hum.getProperty(f.prop);
  return Number.isFinite(v) ? v : f.def;
}



export function setScale(key, value) {
  const f = SCALE_FIELDS.find((x) => x.key === key);
  if (!f) return false;
  const hum = getSelectedHumanoid();
  if (!hum || !live(hum)) {
    logger.warn(`Scale ${f.label}: nenhum Humanoid selecionado.`);
    return false;
  }
  const char = getSelectedCharacter();
  const clamped = clampNumber(Number(value), f.min, f.max, f.def);                 
  const old = hum.getProperty(f.prop);
  return commands.execute({
    name: `Scale ${f.label}`,
    do() {
      if (!live(hum)) return false;
      const changed = hum.setProperty(f.prop, clamped);
      applyRigShape(char, hum);
      return changed;
    },
    undo() {
      if (!live(hum)) return;
      hum.setProperty(f.prop, old);
      applyRigShape(char, hum);
    },
  });
}

export function getProportionsEnabled() {
  const hum = getSelectedHumanoid();
  return hum ? !!hum.getProperty("AutomaticScalingEnabled") : true;
}
export function setProportionsEnabled(enabled) {
  return setHumanoidProp("AutomaticScalingEnabled", !!enabled, "ProportionsEnabled");
}

export function getHipHeight() {
  const hum = getSelectedHumanoid();
  const v = hum ? hum.getProperty("HipHeight") : HIP_HEIGHT.def;
  return Number.isFinite(v) ? v : HIP_HEIGHT.def;
}
export function setHipHeight(value) {
  const clamped = clampNumber(Number(value), HIP_HEIGHT.min, HIP_HEIGHT.max, HIP_HEIGHT.def);
  return setHumanoidProp("HipHeight", clamped, "HipHeight");
}

export function getExtentsMode() {
  const hum = getSelectedHumanoid();
  return hum ? hum.getProperty("AutomaticExtentsMode") : EXTENTS_MODES[0];
}
export function setExtentsMode(mode) {
  if (!EXTENTS_MODES.includes(mode)) return false;
  return setHumanoidProp("AutomaticExtentsMode", mode, "AutomaticExtentsMode");
}

export function getCollisionType() {
  const hum = getSelectedHumanoid();
  return hum ? hum.getProperty("CollisionType") : COLLISION_TYPES[0];
}
export function setCollisionType(type) {
  if (!COLLISION_TYPES.includes(type)) return false;
  return setHumanoidProp("CollisionType", type, "CollisionType");
}


export function getVisibility(groupKey) {
  const g = VISIBILITY_GROUPS.find((x) => x.key === groupKey);
  const char = getSelectedCharacter();
  if (!g || !char) return true;
  const parts = findPartsByNames(char, g.parts);
  if (parts.length === 0) return true;

  return parts.some((pt) => Number(pt.getProperty("Transparency")) < 1);
}

export function toggleVisibility(groupKey) {
  const g = VISIBILITY_GROUPS.find((x) => x.key === groupKey);
  const char = getSelectedCharacter();
  if (!g || !char) return false;
  const parts = findPartsByNames(char, g.parts);
  if (parts.length === 0) return false;
  const makeHidden = getVisibility(groupKey);                                
  const target = makeHidden ? 1 : 0;
  const prev = parts.map((pt) => pt.getProperty("Transparency"));
  return commands.execute({
    name: `Visibilidade ${g.label}`,
    do() {
      let changed = false;
      parts.forEach((pt) => {
        if (live(pt) && pt.setProperty("Transparency", target)) changed = true;
      });
      return changed;
    },
    undo() {
      parts.forEach((pt, i) => {
        if (live(pt)) pt.setProperty("Transparency", prev[i]);
      });
    },
  });
}


export function getBodyColors(char) {
  return findChildByClass(char || getSelectedCharacter(), "BodyColors");
}

export function getBodyColor(memberKey) {
  const m = BODY_COLOR_MEMBERS.find((x) => x.key === memberKey);
  if (!m) return null;
  const bc = getBodyColors();
  if (bc) return bc.getProperty(m.prop);
  return defaultBodyColors()[m.prop];
}


export function setBodyColor(memberKey, color) {
  const char = getSelectedCharacter();
  const m = BODY_COLOR_MEMBERS.find((x) => x.key === memberKey);
  if (!char || !m || !color) return false;
  const safeColor = makeColor(color.r, color.g, color.b);
  const parts = findPartsByNames(char, BODY_PART_NAMES[m.key] || []).filter((p) =>
    p.hasProperty("Color"),
  );
  const oldPartColors = parts.map((p) => ({ p, c: p.getProperty("Color") }));
  let bc = getBodyColors(char);
  let created = false;
  const oldVal = bc ? bc.getProperty(m.prop) : null;
  return commands.execute({
    name: `Body Color ${m.label}`,
    do() {
      if (!live(char)) return false;
      if (!bc || bc.isDestroyed()) {
        bc = createInstance("BodyColors", {});
        created = true;
      }
      if (bc.getParent() !== char) bc.setParent(char);
      bc.setProperty(m.prop, safeColor);
      for (const { p } of oldPartColors) if (live(p)) p.setProperty("Color", safeColor);
      return true;
    },
    undo() {
      if (created) {
        if (live(bc)) bc.setParent(null);
      } else if (live(bc) && oldVal != null) {
        bc.setProperty(m.prop, oldVal);
      }
      for (const { p, c } of oldPartColors) if (live(p) && c) p.setProperty("Color", c);
    },
  });
}


export function readHumanoidDescription() {
  const char = getSelectedCharacter();
  const desc = char ? getDescription(char) : null;
  const defaults = defaultBodyColors();
  const assets = {};
  for (const f of DESC_ASSET_FIELDS) assets[f.prop] = desc ? desc.getProperty(f.prop) : 0;
  const colors = {};
  for (const m of BODY_COLOR_MEMBERS) colors[m.prop] = desc ? desc.getProperty(m.prop) : defaults[m.prop];
  return { assets, colors };
}


export function applyHumanoidDescription(data) {
  const char = getSelectedCharacter();
  const hum = getSelectedHumanoid();
  if (!char || !hum) {
    logger.warn("Apply Description: nenhum Humanoid selecionado.");
    return false;
  }
  const assets = (data && data.assets) || {};
  const colors = (data && data.colors) || {};
  const applyColors = Object.keys(colors).length > 0;

  let desc = getDescription(char);
  let bc = getBodyColors(char);
  let createdDesc = false;
  let createdBc = false;
  const prevDesc = {};
  const prevBc = {};
  const prevPartColors = [];

  return commands.execute({
    name: "Apply HumanoidDescription",
    do() {
      if (!live(char)) return false;
      prevPartColors.length = 0;
      if (!desc || desc.isDestroyed()) {
        desc = createInstance("HumanoidDescription", {});
        createdDesc = true;
      }
      if (desc.getParent() !== char) desc.setParent(char);

      for (const f of DESC_ASSET_FIELDS) {
        if (!(f.prop in prevDesc)) prevDesc[f.prop] = desc.getProperty(f.prop);
        desc.setProperty(f.prop, sanitizeAssetId(assets[f.prop]));
      }
      if (applyColors) {
        for (const m of BODY_COLOR_MEMBERS) {
          if (!colors[m.prop]) continue;
          const col = makeColor(colors[m.prop].r, colors[m.prop].g, colors[m.prop].b);
          if (!(m.prop in prevDesc)) prevDesc[m.prop] = desc.getProperty(m.prop);
          desc.setProperty(m.prop, col);
        }
        if (!bc || bc.isDestroyed()) {
          bc = createInstance("BodyColors", {});
          createdBc = true;
        }
        if (bc.getParent() !== char) bc.setParent(char);
        for (const m of BODY_COLOR_MEMBERS) {
          if (!colors[m.prop]) continue;
          const col = makeColor(colors[m.prop].r, colors[m.prop].g, colors[m.prop].b);
          if (!(m.prop in prevBc)) prevBc[m.prop] = bc.getProperty(m.prop);
          bc.setProperty(m.prop, col);
          const parts = findPartsByNames(char, BODY_PART_NAMES[m.key] || []).filter((p) =>
            p.hasProperty("Color"),
          );
          for (const p of parts) {
            prevPartColors.push({ p, c: p.getProperty("Color") });
            p.setProperty("Color", col);
          }
        }
      }
      return true;
    },
    undo() {
      if (createdDesc) {
        if (live(desc)) desc.setParent(null);
      } else if (live(desc)) {
        for (const k in prevDesc) desc.setProperty(k, prevDesc[k]);
      }
      if (createdBc) {
        if (live(bc)) bc.setParent(null);
      } else if (live(bc)) {
        for (const k in prevBc) bc.setProperty(k, prevBc[k]);
      }
      for (const { p, c } of prevPartColors) if (live(p) && c) p.setProperty("Color", c);
    },
  });
}


export function resetToDefault() {
  const char = getSelectedCharacter();
  const hum = getSelectedHumanoid();
  if (!char || !hum) {
    logger.warn("Reset to Default: nenhum Humanoid selecionado.");
    return false;
  }
  const HUM_DEFAULTS = {
    BodyHeightScale: 1, BodyWidthScale: 1, BodyDepthScale: 1, HeadScale: 1,
    AutomaticScalingEnabled: true, HipHeight: HIP_HEIGHT.def,
    AutomaticExtentsMode: "Full", CollisionType: "OuterBox",
  };
  const defaults = defaultBodyColors();
  const accs = char.getChildren().filter((c) => c.className === "Accessory");
  const bc = getBodyColors(char);
  const desc = getDescription(char);
  const prevHum = {};
  const prevBc = {};
  const prevDesc = {};
  const prevPartColors = [];
  const prevTransparency = [];

  return commands.execute({
    name: "Reset to Default",
    do() {
      if (!live(hum)) return false;
      prevPartColors.length = 0;
      prevTransparency.length = 0;
      for (const k in HUM_DEFAULTS) {
        if (!(k in prevHum)) prevHum[k] = hum.getProperty(k);
        hum.setProperty(k, HUM_DEFAULTS[k]);
      }
      applyRigShape(char, hum);                                             


      const tmpl = getRigTemplate(hum.getProperty("RigType"));
      if (tmpl) {
        for (const pd of tmpl.parts) {
          const part = findPartByName(char, pd.name);
          if (!part) continue;
          const tTarget = pd.transparency != null ? pd.transparency : 0;
          prevTransparency.push({ p: part, t: part.getProperty("Transparency") });
          part.setProperty("Transparency", tTarget);
        }
      }
      for (const acc of accs) {
        if (!live(acc)) continue;


        unequipAccessory(acc);
        acc.setParent(null);
      }
      if (bc && live(bc)) {
        for (const m of BODY_COLOR_MEMBERS) {
          if (!(m.prop in prevBc)) prevBc[m.prop] = bc.getProperty(m.prop);
          bc.setProperty(m.prop, defaults[m.prop]);
        }
      }

      for (const m of BODY_COLOR_MEMBERS) {
        const parts = findPartsByNames(char, BODY_PART_NAMES[m.key] || []).filter((p) =>
          p.hasProperty("Color"),
        );
        for (const p of parts) {
          prevPartColors.push({ p, c: p.getProperty("Color") });
          p.setProperty("Color", defaults[m.prop]);
        }
      }
      if (desc && live(desc)) {
        for (const f of DESC_ASSET_FIELDS) {
          if (!(f.prop in prevDesc)) prevDesc[f.prop] = desc.getProperty(f.prop);
          desc.setProperty(f.prop, 0);
        }
      }
      return true;
    },
    undo() {
      if (live(hum)) {
        for (const k in prevHum) hum.setProperty(k, prevHum[k]);
        applyRigShape(char, hum);
      }
      if (live(char)) for (const acc of accs) if (live(acc)) acc.setParent(char);
      for (const { p, t } of prevTransparency) if (live(p)) p.setProperty("Transparency", t);
      if (bc && live(bc)) for (const k in prevBc) bc.setProperty(k, prevBc[k]);
      for (const { p, c } of prevPartColors) if (live(p) && c) p.setProperty("Color", c);
      if (desc && live(desc)) for (const k in prevDesc) desc.setProperty(k, prevDesc[k]);
    },
  });
}
