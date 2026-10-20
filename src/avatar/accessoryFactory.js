import { createInstance, makeColor, makeVector3 } from "../datamodel/index.js";
import {
  ATTACHMENT_BY_ACCESSORY_TYPE,
  isLayeredType,
  normalizeAccessoryType,
} from "./accessoryRuntime.js";

const RIGID_SHAPE = Object.freeze({
  Unknown: { size: [1, 1, 1], off: [0, 0, 0], color: [0.5, 0.5, 0.5] },
  Hat: { size: [1.9, 0.7, 1.9], off: [0, 0.35, 0], color: [0.13, 0.13, 0.16] },
  Hair: { size: [2.0, 0.9, 2.0], off: [0, 0.1, 0], color: [0.25, 0.16, 0.08] },
  Face: { size: [1.3, 0.8, 0.3], off: [0, 0, 0.15], color: [0.1, 0.1, 0.1] },
  Neck: { size: [1.2, 0.4, 0.5], off: [0, -0.2, 0.1], color: [0.7, 0.1, 0.1] },
  Shoulder: { size: [0.7, 0.5, 1.0], off: [0.2, 0, 0], color: [0.3, 0.3, 0.35] },
  Front: { size: [1.2, 1.0, 0.3], off: [0, 0, 0.15], color: [0.2, 0.4, 0.8] },
  Back: { size: [1.2, 1.4, 0.4], off: [0, 0, -0.2], color: [0.2, 0.4, 0.8] },
  Waist: { size: [1.5, 0.4, 0.5], off: [0, 0, 0.15], color: [0.13, 0.13, 0.16] },
  Eyebrow: { size: [1.1, 0.15, 0.2], off: [0, 0.25, 0.55], color: [0.15, 0.1, 0.05] },
  Eyelash: { size: [1.0, 0.1, 0.2], off: [0, 0.12, 0.58], color: [0.05, 0.05, 0.05] },
});

const LAYERED_SHAPE = Object.freeze({
  TShirt: { size: [2.2, 2.2, 1.3], color: [0.85, 0.85, 0.9] },
  Shirt: { size: [2.3, 2.3, 1.3], color: [0.35, 0.55, 0.85] },
  Pants: { size: [2.2, 2.8, 1.3], color: [0.2, 0.25, 0.4] },
  Jacket: { size: [2.5, 2.4, 1.4], color: [0.45, 0.3, 0.2] },
  Sweater: { size: [2.4, 2.4, 1.4], color: [0.6, 0.2, 0.25] },
  Shorts: { size: [2.2, 1.6, 1.3], color: [0.25, 0.35, 0.3] },
  LeftShoe: { size: [1.1, 0.7, 1.2], color: [0.15, 0.15, 0.15] },
  RightShoe: { size: [1.1, 0.7, 1.2], color: [0.15, 0.15, 0.15] },
  DressSkirt: { size: [2.4, 1.8, 1.5], color: [0.55, 0.25, 0.5] },
});

export function buildAccessoryInstance(spec) {
  const s = spec || {};
  const type = normalizeAccessoryType(s.type);
  const layered = isLayeredType(type) && s.layered !== false;
  const name = String(s.name || `${type}Accessory`).slice(0, 100);
  const acc = createInstance("Accessory", { name });
  acc.setProperty("AccessoryType", type);

  const shape = layered ? (LAYERED_SHAPE[type] || LAYERED_SHAPE.Shirt) : (RIGID_SHAPE[type] || RIGID_SHAPE.Unknown);
  const handle = createInstance(s.meshId ? "MeshPart" : "Part", { name: "Handle" });
  handle.setProperty("Size", makeVector3(shape.size[0], shape.size[1], shape.size[2]));
  handle.setProperty("Color", makeColor(shape.color[0], shape.color[1], shape.color[2]));
  handle.setProperty("Anchored", true);
  handle.setProperty("CanCollide", false);
  if (handle.hasProperty("Massless")) handle.setProperty("Massless", true);
  if (s.meshId && handle.hasProperty("MeshId")) handle.setProperty("MeshId", String(s.meshId));
  handle.setParent(acc);

  const attName = s.attachmentName || ATTACHMENT_BY_ACCESSORY_TYPE[type] || "HatAttachment";
  const att = createInstance("Attachment", { name: attName });
  if (!layered && shape.off) att.setProperty("Position", makeVector3(-shape.off[0], -shape.off[1], -shape.off[2]));
  att.setParent(handle);

  if (layered) {
    const wl = createInstance("WrapLayer", { name: "WrapLayer" });
    wl.setProperty("CageMeshId", String(s.cageMeshId || `rbxcage://clothing/${type.toLowerCase()}`));
    wl.setProperty("ReferenceMeshId", String(s.referenceMeshId || "rbxcage://body/reference"));


    const ord = s.order == null ? NaN : Number(s.order);
    wl.setProperty("Order", Number.isFinite(ord) ? ord : 1);
    const puf = s.puffiness == null ? NaN : Number(s.puffiness);
    wl.setProperty("Puffiness", Number.isFinite(puf) ? puf : 1);
    wl.setParent(handle);
  }
  return acc;
}

export const DESC_ACCESSORY_FIELDS = Object.freeze([
  ["HatAccessory", "Hat"],
  ["HairAccessory", "Hair"],
  ["FaceAccessory", "Face"],
  ["NeckAccessory", "Neck"],
  ["ShouldersAccessory", "Shoulder"],
  ["FrontAccessory", "Front"],
  ["BackAccessory", "Back"],
  ["WaistAccessory", "Waist"],
  ["Shirt", "Shirt"],
  ["Pants", "Pants"],
  ["GraphicTShirt", "TShirt"],
  ["JacketAccessory", "Jacket"],
  ["SweaterAccessory", "Sweater"],
  ["ShortsAccessory", "Shorts"],
  ["LeftShoeAccessory", "LeftShoe"],
  ["RightShoeAccessory", "RightShoe"],
  ["DressSkirtAccessory", "DressSkirt"],
]);

export const DESC_OWNED_MARK = "__RSW_DescriptionOwned";

export function markDescriptionOwned(acc) {
  try {
    const r = acc.setAttribute(DESC_OWNED_MARK, "boolean", true);
    if (r && r.ok) return true;
  } catch (_) {          }
  return false;
}

export function isDescriptionOwned(acc) {
  try {
    if (acc.getAttribute && acc.getAttribute(DESC_OWNED_MARK) === true) return true;
  } catch (_) {          }
  return false;
}
