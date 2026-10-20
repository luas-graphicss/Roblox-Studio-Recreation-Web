import { createInstance, makeColor, makeVector3 } from "../datamodel/index.js";
import { logger } from "../core/logger.js";
import { Enums } from "../datamodel/types.js";
import { buildWrapPlacement, wrapPartNamesFor } from "./wrapDeform.js";
import { getRigTemplate } from "./rigs.js";

export const MAX_EQUIPPED_ACCESSORIES = 50;
export const MAX_LAYERED_CLOTHING = 20;
export const MAX_ATTACHMENT_NAME = 64;

export const LAYERED_TYPES = Object.freeze([
  "TShirt", "Shirt", "Pants", "Jacket", "Sweater", "Shorts",
  "LeftShoe", "RightShoe", "DressSkirt",
]);

export const ATTACHMENT_BY_ACCESSORY_TYPE = Object.freeze({
  Unknown: "HatAttachment",
  Hat: "HatAttachment",
  Hair: "HairAttachment",
  Face: "FaceFrontAttachment",
  Neck: "NeckAttachment",
  Shoulder: "RightShoulderAttachment",
  Front: "BodyFrontAttachment",
  Back: "BodyBackAttachment",
  Waist: "WaistCenterAttachment",
  TShirt: "BodyFrontAttachment",
  Shirt: "BodyFrontAttachment",
  Pants: "WaistCenterAttachment",
  Jacket: "BodyFrontAttachment",
  Sweater: "BodyFrontAttachment",
  Shorts: "WaistCenterAttachment",
  LeftShoe: "LeftFootAttachment",
  RightShoe: "RightFootAttachment",
  DressSkirt: "WaistCenterAttachment",
  Eyebrow: "FaceCenterAttachment",
  Eyelash: "FaceCenterAttachment",
});

export const R15_ATTACHMENTS = Object.freeze([
  { name: "HatAttachment", part: "Head", pos: [0, 0.6, 0] },
  { name: "HairAttachment", part: "Head", pos: [0, 0.6, 0] },
  { name: "FaceFrontAttachment", part: "Head", pos: [0, 0, 0.7] },
  { name: "FaceCenterAttachment", part: "Head", pos: [0, 0, 0] },
  { name: "NeckAttachment", part: "UpperTorso", pos: [0, 0.6, 0] },
  { name: "LeftShoulderAttachment", part: "LeftUpperArm", pos: [0, 0.6, 0] },
  { name: "RightShoulderAttachment", part: "RightUpperArm", pos: [0, 0.6, 0] },
  { name: "BodyFrontAttachment", part: "UpperTorso", pos: [0, 0, 0.5] },
  { name: "BodyBackAttachment", part: "UpperTorso", pos: [0, 0, -0.5] },
  { name: "WaistFrontAttachment", part: "LowerTorso", pos: [0, 0, 0.5] },
  { name: "WaistBackAttachment", part: "LowerTorso", pos: [0, 0, -0.5] },
  { name: "WaistCenterAttachment", part: "LowerTorso", pos: [0, 0, 0] },
  { name: "LeftFootAttachment", part: "LeftFoot", pos: [0, -0.25, 0] },
  { name: "RightFootAttachment", part: "RightFoot", pos: [0, -0.25, 0] },
  { name: "RootRigAttachment", part: "HumanoidRootPart", pos: [0, 0, 0] },
]);

export const R6_ATTACHMENTS = Object.freeze([
  { name: "HatAttachment", part: "Head", pos: [0, 0.6, 0] },
  { name: "HairAttachment", part: "Head", pos: [0, 0.6, 0] },
  { name: "FaceFrontAttachment", part: "Head", pos: [0, 0, 0.6] },
  { name: "FaceCenterAttachment", part: "Head", pos: [0, 0, 0] },
  { name: "NeckAttachment", part: "Torso", pos: [0, 1, 0] },


  { name: "LeftShoulderAttachment", part: "Left Arm", pos: [0, 1, 0] },
  { name: "RightShoulderAttachment", part: "Right Arm", pos: [0, 1, 0] },
  { name: "BodyFrontAttachment", part: "Torso", pos: [0, 0, 0.5] },
  { name: "BodyBackAttachment", part: "Torso", pos: [0, 0, -0.5] },
  { name: "WaistCenterAttachment", part: "Torso", pos: [0, -1, 0] },


  { name: "LeftFootAttachment", part: "Left Leg", pos: [0, -1, 0] },
  { name: "RightFootAttachment", part: "Right Leg", pos: [0, -1, 0] },
]);

export const R15_WRAP_PARTS = Object.freeze([
  "UpperTorso", "LowerTorso",
  "LeftUpperArm", "LeftLowerArm", "LeftHand",
  "RightUpperArm", "RightLowerArm", "RightHand",
  "LeftUpperLeg", "LeftLowerLeg", "LeftFoot",
  "RightUpperLeg", "RightLowerLeg", "RightFoot",
]);


export const avatarDebugState = {
  showCages: false,
  showAttachments: false,
  showClothingBounds: false,
};

const links = new Map();
const warned = new Set();

function live(inst) {
  return !!(inst && inst.__isInstance === true && typeof inst.isDestroyed === "function" && !inst.isDestroyed());
}

function isPartLike(inst) {
  return !!(live(inst) && inst.hasProperty && inst.hasProperty("Position") && inst.hasProperty("Size"));
}

function isAccessoryInst(inst) {
  return !!(live(inst) && (inst.className === "Accessory" || inst.className === "Accoutrement"));
}

export function isLayeredType(type) {
  return LAYERED_TYPES.includes(String(type));
}

export function sanitizeAttachmentName(name) {
  let s = String(name == null ? "" : name).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  if (s.length > MAX_ATTACHMENT_NAME) s = s.slice(0, MAX_ATTACHMENT_NAME);
  return s;
}

export function normalizeAccessoryType(type) {
  const s = String(type == null ? "" : type);
  return Enums.AccessoryType.includes(s) ? s : "Unknown";
}

function warnOnce(key, msg) {
  if (warned.has(key)) return;
  warned.add(key);
  if (warned.size > 512) warned.clear();
  logger.warn(msg);
}

function deg2rad(d) {
  return (Number(d) || 0) * Math.PI / 180;
}

function rotY(v, yawDeg) {
  const a = deg2rad(yawDeg);
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
}

function vec(inst, prop) {
  let v = null;
  try { v = inst.getProperty(prop); } catch (_) { v = null; }
  v = v || {};
  return { x: Number(v.x) || 0, y: Number(v.y) || 0, z: Number(v.z) || 0 };
}

export function rigTypeOf(char) {
  if (!live(char)) return null;
  const hum = char.getChildren().find((c) => c.className === "Humanoid");
  if (hum && hum.hasProperty && hum.hasProperty("RigType")) {
    const rt = hum.getProperty("RigType");
    if (rt === "R6" || rt === "R15") return rt;
  }
  if (char.findFirstChild && char.findFirstChild("UpperTorso")) return "R15";
  if (char.findFirstChild && char.findFirstChild("Torso")) return "R6";
  return null;
}


function partScaleFactors(rigType, part) {
  const tpl = getRigTemplate(rigType);
  const pd = tpl && tpl.parts ? tpl.parts.find((p) => p.name === part.name) : null;
  if (!pd) return { x: 1, y: 1, z: 1 };
  const size = vec(part, "Size");
  const f = (cur, base) => (Number.isFinite(cur) && cur > 0 && Number.isFinite(base) && base > 1e-6 ? cur / base : 1);
  return { x: f(size.x, pd.size[0]), y: f(size.y, pd.size[1]), z: f(size.z, pd.size[2]) };
}

function scaledSpecPos(rigType, part, spec) {
  const fx = partScaleFactors(rigType, part);
  return makeVector3(spec.pos[0] * fx.x, spec.pos[1] * fx.y, spec.pos[2] * fx.z);
}

export function ensureCharacterAttachments(char) {
  const rt = rigTypeOf(char);
  if (!rt) return 0;
  const specs = rt === "R15" ? R15_ATTACHMENTS : R6_ATTACHMENTS;
  let created = 0;
  for (const spec of specs) {
    const part = char.findFirstChild(spec.part);
    if (!isPartLike(part)) continue;
    const existing = part.getChildren().find((c) => c.className === "Attachment" && c.name === spec.name);
    if (existing) continue;
    const att = createInstance("Attachment", { name: spec.name });
    att.setProperty("Position", scaledSpecPos(rt, part, spec));
    att.setParent(part);
    created += 1;
  }
  return created;
}


export function syncRigAttachmentPositions(char) {
  const rt = rigTypeOf(char);
  if (!rt) return 0;
  const specs = rt === "R15" ? R15_ATTACHMENTS : R6_ATTACHMENTS;
  let updated = 0;
  for (const spec of specs) {
    const part = char.findFirstChild(spec.part);
    if (!isPartLike(part)) continue;
    const att = part.getChildren().find((c) => c.className === "Attachment" && c.name === spec.name);
    if (!live(att)) continue;
    att.setProperty("Position", scaledSpecPos(rt, part, spec));
    updated += 1;
  }
  return updated;
}

export function ensureWrapTargets(char) {


  if (!live(char)) return 0;
  let created = 0;
  for (const name of wrapPartNamesFor(char)) {
    const part = char.findFirstChild(name);
    if (!isPartLike(part)) continue;
    if (part.getChildren().some((c) => c.className === "WrapTarget")) continue;
    const wt = createInstance("WrapTarget", { name: name + "Cage" });
    wt.setProperty("CageMeshId", "rbxcage://body/" + name);
    wt.setParent(part);
    created += 1;
  }
  return created;
}

export function findHandle(acc) {
  if (!live(acc) || !acc.findFirstChild) return null;
  const h = acc.findFirstChild("Handle");
  return isPartLike(h) ? h : null;
}

export function findHandleAttachment(handle) {
  if (!live(handle)) return null;
  return handle.getChildren().find((c) => c.className === "Attachment") || null;
}

export function findWrapLayer(acc) {
  const handle = findHandle(acc);
  if (!handle) return null;
  return handle.getChildren().find((c) => c.className === "WrapLayer") || null;
}

function insideAccessory(inst, stopAt) {
  let n = inst;
  let g = 0;
  while (live(n) && n !== stopAt && g < 64) {
    if (n.className === "Accessory" || n.className === "Accoutrement") return true;
    n = n.getParent ? n.getParent() : null;
    g += 1;
  }
  return false;
}

export function findCharacterAttachment(char, name) {
  if (!live(char) || !name) return null;
  const wanted = sanitizeAttachmentName(name);
  const stack = char.getChildren().slice();
  while (stack.length > 0) {
    const n = stack.pop();
    if (!live(n)) continue;
    if (n.className === "Accessory" || n.className === "Accoutrement") continue;
    if (n.className === "Attachment" && sanitizeAttachmentName(n.name) === wanted) {
      const host = n.getParent ? n.getParent() : null;
      if (isPartLike(host) && !insideAccessory(host, char)) return n;
    }
    const kids = n.getChildren ? n.getChildren() : [];
    for (const k of kids) stack.push(k);
  }
  return null;
}

export function equippedAccessories(char) {
  if (!live(char)) return [];
  return char.getChildren().filter((c) => isAccessoryInst(c));
}

export function layeredAccessories(char) {
  return equippedAccessories(char).filter((a) => {
    const wl = findWrapLayer(a);
    return !!(wl && wl.getProperty("Enabled") !== false && isLayeredType(a.hasProperty && a.hasProperty("AccessoryType") ? a.getProperty("AccessoryType") : ""));
  });
}

function attWorld(part, att) {
  const pp = vec(part, "Position");
  const yaw = vec(part, "Rotation").y;
  const local = rotY(vec(att, "Position"), yaw);
  return { x: pp.x + local.x, y: pp.y + local.y, z: pp.z + local.z };
}

function positionHandle(link) {
  const { handle, bodyPart, charAtt, handleAtt } = link;
  if (!isPartLike(handle) || !isPartLike(bodyPart) || !live(charAtt)) return false;
  const yaw = vec(bodyPart, "Rotation").y;
  const world = attWorld(bodyPart, charAtt);
  const ho = live(handleAtt) ? rotY(vec(handleAtt, "Position"), yaw) : { x: 0, y: 0, z: 0 };
  try {
    handle.setProperty("Position", makeVector3(world.x - ho.x, world.y - ho.y, world.z - ho.z));
    if (handle.hasProperty("Rotation")) {
      const hr = vec(handle, "Rotation");
      handle.setProperty("Rotation", makeVector3(hr.x, yaw, hr.z));
    }
  } catch (_) { return false; }
  return true;
}

export function equipAccessory(char, acc, opts) {
  const quiet = !!(opts && opts.quiet);
  const say = (key, msg) => { if (quiet) { warnOnce(key, msg); } else { logger.warn(msg); } };
  if (!live(char)) return { ok: false, reason: "character" };
  if (!isAccessoryInst(acc)) {
    say("notacc", "AddAccessory: o objeto informado n\u00e3o \u00e9 um Accessory.");
    return { ok: false, reason: "not-accessory" };
  }
  const typeRaw = acc.hasProperty && acc.hasProperty("AccessoryType") ? acc.getProperty("AccessoryType") : "Unknown";
  const type = normalizeAccessoryType(typeRaw);
  if (type !== typeRaw && acc.hasProperty && acc.hasProperty("AccessoryType")) {
    try { acc.setProperty("AccessoryType", "Unknown"); } catch (_) {          }
  }
  const handle = findHandle(acc);
  if (!handle) {
    say("nohandle:" + acc.id, `AddAccessory: "${acc.name}" n\u00e3o possui Handle (Part/MeshPart) e n\u00e3o foi equipado.`);
    return { ok: false, reason: "no-handle" };
  }
  const handleAtt = findHandleAttachment(handle);
  if (!handleAtt) {
    say("noatt:" + acc.id, `AddAccessory: o Handle de "${acc.name}" n\u00e3o possui Attachment e n\u00e3o foi equipado.`);
    return { ok: false, reason: "no-handle-attachment" };
  }
  const charAtt = findCharacterAttachment(char, handleAtt.name);
  if (!charAtt) {
    say("nocompat:" + acc.id, `AddAccessory: personagem n\u00e3o possui Attachment "${handleAtt.name}" compat\u00edvel com "${acc.name}".`);
    return { ok: false, reason: "no-compatible-attachment" };
  }
  const already = equippedAccessories(char).filter((a) => a !== acc);
  if (already.length >= MAX_EQUIPPED_ACCESSORIES) {
    say("maxacc", `AddAccessory: limite de ${MAX_EQUIPPED_ACCESSORIES} acess\u00f3rios equipados atingido.`);
    return { ok: false, reason: "max-accessories" };
  }
  const wl = findWrapLayer(acc);
  const layered = !!(wl && wl.getProperty("Enabled") !== false && isLayeredType(type));
  if (layered) {
    const layeredCount = already.filter((a) => {
      const w = findWrapLayer(a);

      const t = a.hasProperty && a.hasProperty("AccessoryType") ? a.getProperty("AccessoryType") : "";
      return !!(w && w.getProperty("Enabled") !== false && isLayeredType(t));
    }).length;
    if (layeredCount >= MAX_LAYERED_CLOTHING) {
      say("maxlay", `AddAccessory: limite de ${MAX_LAYERED_CLOTHING} layered clothing simult\u00e2neas atingido.`);
      return { ok: false, reason: "max-layered" };
    }
  }
  if (acc.getParent && acc.getParent() !== char) acc.setParent(char);
  try {
    if (handle.hasProperty("CanCollide")) handle.setProperty("CanCollide", false);
    if (handle.hasProperty("Massless")) handle.setProperty("Massless", true);
    if (handle.hasProperty("Anchored")) handle.setProperty("Anchored", true);
  } catch (_) {          }
  const bodyPart = charAtt.getParent();








  const prev = links.get(acc);
  const samePrevHandle = !!(prev && prev.handle === handle);
  const handleSize0 = samePrevHandle
    ? prev.handleSize0
    : (handle.hasProperty("Size") ? vec(handle, "Size") : null);
  const handleTransparency0 = samePrevHandle
    ? prev.handleTransparency0
    : (handle.hasProperty("Transparency") ? (Number(handle.getProperty("Transparency")) || 0) : null);
  const link = { acc, char, handle, handleAtt, charAtt, bodyPart, attName: handleAtt.name, layered, wrapCache: samePrevHandle ? prev.wrapCache : null, handleSize0, handleTransparency0 };
  links.set(acc, link);
  if (layered) {
    applyWrapTo(char, acc, link);
  } else {




    restoreHandleVisual(link);
    positionHandle(link);
  }
  return { ok: true, link };
}

export function unequipAccessory(acc) {


  const link = links.get(acc);
  if (link) restoreHandleVisual(link);
  return links.delete(acc);
}

export function linkFor(acc) {
  return links.get(acc) || null;
}

export function clearAccessoryState() {
  links.clear();
  warned.clear();
}


function restoreHandleVisual(link) {
  if (!link.wrapCache) return;
  link.wrapCache = null;
  if (!isPartLike(link.handle)) return;
  try {
    if (link.handleSize0) {
      link.handle.setProperty("Size", makeVector3(link.handleSize0.x, link.handleSize0.y, link.handleSize0.z));
    }
    if (link.handleTransparency0 != null && link.handle.hasProperty("Transparency")) {
      link.handle.setProperty("Transparency", link.handleTransparency0);
    }
  } catch (_) {          }
}

function applyWrapTo(char, acc, link) {
  const wl = findWrapLayer(acc);
  if (!wl || wl.getProperty("Enabled") === false) {
    link.layered = false;
    restoreHandleVisual(link);
    positionHandle(link);
    return;
  }
  const type = normalizeAccessoryType(acc.getProperty("AccessoryType"));
  const placement = buildWrapPlacement(char, wl, type, link.wrapCache);
  if (!placement) {
    warnOnce("wrap:" + acc.id, `Layered clothing "${acc.name}": WrapTarget compat\u00edvel n\u00e3o encontrado; renderizando como mesh r\u00edgida.`);
    positionHandle(link);
    return;
  }
  link.wrapCache = placement;
  try {
    link.handle.setProperty("Position", makeVector3(placement.center.x, placement.center.y, placement.center.z));
    link.handle.setProperty("Size", makeVector3(placement.size.x, placement.size.y, placement.size.z));
    if (link.handle.hasProperty("Transparency")) link.handle.setProperty("Transparency", 0.05);
  } catch (_) {          }
}

export function updateCharacterAccessories(char) {
  if (!live(char)) return 0;
  let updated = 0;
  for (const acc of equippedAccessories(char)) {
    let link = links.get(acc);
    if (!link) {
      const res = equipAccessory(char, acc, { quiet: true });
      if (!res.ok) continue;
      link = res.link;
      updated += 1;
      continue;
    }


    const handleNow = findHandle(acc);
    const handleAttStale = !!(link.handleAtt && (!live(link.handleAtt) || link.handleAtt.getParent() !== handleNow));
    if (!handleNow || handleNow !== link.handle || handleAttStale) {
      if (!handleNow) {
        restoreHandleVisual(link);                                              
        links.delete(acc);
        warnOnce("handle:" + acc.id, `Accessory "${acc.name}": Handle foi removido; v\u00ednculo desfeito.`);
        continue;
      }
      if (handleNow !== link.handle) {
        restoreHandleVisual(link);                                                   
        links.delete(acc);                                           
      }
      const res = equipAccessory(char, acc, { quiet: true });
      if (!res.ok) {
        restoreHandleVisual(link);
        links.delete(acc);
        warnOnce("handle:" + acc.id, `Accessory "${acc.name}": n\u00e3o foi poss\u00edvel re-vincular ap\u00f3s troca do Handle.`);
        continue;
      }
      link = res.link;
      updated += 1;
      continue;
    }
    if (!live(link.charAtt) || !live(link.bodyPart) || link.charAtt.getParent() !== link.bodyPart) {
      const again = findCharacterAttachment(char, link.attName);
      if (again) {
        link.charAtt = again;
        link.bodyPart = again.getParent();
      } else {
        warnOnce("lost:" + acc.id, `Accessory "${acc.name}": Attachment "${link.attName}" foi removido do personagem; v\u00ednculo desfeito.`);
        links.delete(acc);
        continue;
      }
    }


    const wl = findWrapLayer(acc);
    const t = acc.hasProperty && acc.hasProperty("AccessoryType") ? acc.getProperty("AccessoryType") : "Unknown";
    const layeredNow = !!(wl && wl.getProperty("Enabled") !== false && isLayeredType(normalizeAccessoryType(t)));
    if (!layeredNow && link.layered) restoreHandleVisual(link);
    link.layered = layeredNow;
    if (link.layered) {
      applyWrapTo(char, acc, link);
    } else {
      positionHandle(link);
    }
    updated += 1;
  }
  for (const [acc, link] of links) {
    if (!live(acc) || !live(link.char)) {


      restoreHandleVisual(link);                                                        
      links.delete(acc);
      continue;
    }
    if (link.char === char && acc.getParent && acc.getParent() !== char) {
      restoreHandleVisual(link);                                                  
      links.delete(acc);
    }
  }
  return updated;
}


function orderOrDefault(wl) {
  const raw = wl.getProperty("Order");
  const n = Number(raw);
  return raw == null || !Number.isFinite(n) ? 1 : n;
}

export function accessorySummary(char) {
  const out = [];
  for (const acc of equippedAccessories(char)) {
    const wl = findWrapLayer(acc);
    const type = normalizeAccessoryType(acc.hasProperty("AccessoryType") ? acc.getProperty("AccessoryType") : "Unknown");
    const layered = !!(wl && wl.getProperty("Enabled") !== false && isLayeredType(type));
    out.push({
      acc,
      name: acc.name,
      type,
      layered,
      order: layered ? orderOrDefault(wl) : null,
      equipped: links.has(acc),
    });
  }
  out.sort((a, b) => (a.layered === b.layered ? (a.order || 0) - (b.order || 0) : a.layered ? 1 : -1));
  return out;
}

export function validateAccessoryAsset(acc, char) {
  const items = [];
  const push = (status, label) => items.push({ status, label });
  if (!isAccessoryInst(acc)) {
    push("error", "O objeto n\u00e3o \u00e9 um Accessory.");
    return items;
  }
  push("ok", "Inst\u00e2ncia Accessory v\u00e1lida.");


  const hasTypeProp = !!(acc.hasProperty && acc.hasProperty("AccessoryType"));
  const typeRaw = hasTypeProp ? acc.getProperty("AccessoryType") : "Unknown";
  const rawStr = String(typeRaw == null ? "" : typeRaw);
  const type = normalizeAccessoryType(typeRaw);
  if (type !== rawStr) {
    push("warning", `AccessoryType "${rawStr}" fora do enum: normalizado para "Unknown".`);
  } else if (type === "Unknown") {
    push("ok", hasTypeProp
      ? "AccessoryType \"Unknown\" v\u00e1lido: acess\u00f3rio r\u00edgido, posicionado pelo Attachment do Handle."
      : "Sem AccessoryType (Accoutrement legado): equipa como acess\u00f3rio r\u00edgido pelo Attachment do Handle.");
  } else {
    push("ok", `AccessoryType "${type}" v\u00e1lido.`);
  }
  const handle = findHandle(acc);
  if (!handle) {
    push("error", "Handle (Part/MeshPart) n\u00e3o encontrado.");
    return items;
  }
  push("ok", `Handle "${handle.className}" presente.`);
  const handleAtt = findHandleAttachment(handle);
  if (!handleAtt) push("error", "Handle n\u00e3o possui Attachment.");
  else push("ok", `Attachment "${handleAtt.name}" presente no Handle.`);
  if (handleAtt && char) {
    const charAtt = findCharacterAttachment(char, handleAtt.name);
    if (charAtt) push("ok", `Personagem possui Attachment compat\u00edvel "${handleAtt.name}".`);
    else push("error", `Personagem n\u00e3o possui Attachment "${handleAtt.name}".`);
  }
  const wl = findWrapLayer(acc);
  if (isLayeredType(type)) {
    if (!wl) push("warning", "Tipo de roupa sem WrapLayer: ser\u00e1 tratado como acess\u00f3rio r\u00edgido.");
    else if (!String(wl.getProperty("CageMeshId") || "").trim()) push("warning", "WrapLayer sem CageMeshId: wrap ser\u00e1 ignorado.");
    else push("ok", "WrapLayer com CageMeshId configurado.");
  } else if (wl) {
    push("warning", "Acess\u00f3rio r\u00edgido cont\u00e9m WrapLayer (ser\u00e1 ignorado para este tipo).");
  }
  return items;
}
