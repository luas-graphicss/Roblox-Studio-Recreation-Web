import { assetStore, MAX_IMPORT_BYTES } from "../assets/assetStore.js";
import { logger } from "../core/logger.js";
import { store } from "../core/state.js";
import { getService } from "../datamodel/index.js";
import { buildAccessoryInstance } from "./accessoryFactory.js";
import {
  ATTACHMENT_BY_ACCESSORY_TYPE,
  ensureCharacterAttachments,
  ensureWrapTargets,
  equipAccessory,
  isLayeredType,
  normalizeAccessoryType,
  validateAccessoryAsset,
} from "./accessoryRuntime.js";
import { registerImportedCage, sanitizeCageMesh } from "./wrapDeform.js";

const templates = new Map();

function live(inst) {
  return !!(inst && inst.__isInstance === true && typeof inst.isDestroyed === "function" && !inst.isDestroyed());
}

function sanitizeName(name, fallback) {
  const s = String(name == null ? "" : name).replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return (s || fallback).slice(0, 100);
}

function checkSize(fileSize) {
  const n = Number(fileSize) || 0;
  if (n > MAX_IMPORT_BYTES) {
    logger.warn(`Avatar Importer: arquivo excede o limite de ${Math.round(MAX_IMPORT_BYTES / (1024 * 1024))}MB.`);
    return false;
  }
  return true;
}

function register(template, meta) {
  const rec = assetStore.addImported({
    name: template.name,
    section: "accessories",
    ext: "rbxacc",
    size: Number(meta && meta.fileSize) || 0,
    dataUri: null,
    mime: null,
  });


  if (!rec || !rec.id) {
    logger.warn(`Avatar Importer: falha ao registrar "${template.name}" no Asset Manager.`);
    return null;
  }
  templates.set(rec.id, { template, meta: meta || {} });
  return rec;
}

export function importAccessory(opts) {
  const o = opts || {};
  if (!checkSize(o.fileSize)) return { ok: false, reason: "file-too-large", checklist: [{ status: "error", label: "Arquivo maior que 50MB." }] };
  const type = normalizeAccessoryType(o.accessoryType);
  const attachmentName = o.attachmentName || ATTACHMENT_BY_ACCESSORY_TYPE[type] || "HatAttachment";
  const template = buildAccessoryInstance({
    type,
    name: sanitizeName(o.name, `${type}Accessory`),
    attachmentName,
    meshId: o.meshId || null,
    layered: false,
  });
  const checklist = validateAccessoryAsset(template, o.previewChar || null);
  const hasError = checklist.some((c) => c.status === "error");
  if (hasError) {
    logger.warn(`Avatar Importer: "${template.name}" reprovado na valida\u00e7\u00e3o.`);
    return { ok: false, reason: "validation", checklist };
  }
  const rec = register(template, { kind: "rigid", type, attachmentName, thumb: o.thumb || null, fileSize: o.fileSize });
  logger.info(`Avatar Importer: acess\u00f3rio "${template.name}" importado (${type}).`);
  return { ok: true, assetId: rec ? rec.id : null, template, checklist };
}

export function importLayeredClothing(opts) {
  const o = opts || {};
  if (!checkSize(o.fileSize)) return { ok: false, reason: "file-too-large", checklist: [{ status: "error", label: "Arquivo maior que 50MB." }] };
  const type = normalizeAccessoryType(o.accessoryType);
  if (!isLayeredType(type)) {
    logger.warn(`Avatar Importer: "${type}" n\u00e3o \u00e9 um tipo de layered clothing.`);
    return { ok: false, reason: "not-layered-type", checklist: [{ status: "error", label: `AccessoryType "${type}" n\u00e3o \u00e9 roupa em camadas.` }] };
  }
  if (o.cageMesh != null) {
    const san = sanitizeCageMesh(o.cageMesh);
    if (!san.ok) {
      logger.warn(`Avatar Importer: cage mesh rejeitada (${san.reason}).`);
      return { ok: false, reason: "bad-cage", checklist: [{ status: "error", label: `Cage mesh inv\u00e1lida: ${san.reason}.` }] };
    }



    if (o.cageMeshId) registerImportedCage(String(o.cageMeshId), o.cageMesh);
  }
  const template = buildAccessoryInstance({
    type,
    name: sanitizeName(o.name, `${type}Clothing`),
    meshId: o.meshId || null,
    cageMeshId: o.cageMeshId || null,
    order: o.order,
    puffiness: o.puffiness,
    layered: true,
  });
  const checklist = validateAccessoryAsset(template, o.previewChar || null);
  const hasError = checklist.some((c) => c.status === "error");
  if (hasError) {
    logger.warn(`Avatar Importer: "${template.name}" reprovado na valida\u00e7\u00e3o.`);
    return { ok: false, reason: "validation", checklist };
  }
  const rec = register(template, { kind: "layered", type, order: o.order, puffiness: o.puffiness, fileSize: o.fileSize });
  logger.info(`Avatar Importer: layered clothing "${template.name}" importada (${type}).`);
  return { ok: true, assetId: rec ? rec.id : null, template, checklist };
}

export function importBodyMesh(opts) {
  const o = opts || {};
  if (!checkSize(o.fileSize)) return { ok: false, reason: "file-too-large" };
  if (o.mesh != null) {
    const san = sanitizeCageMesh(o.mesh);
    if (!san.ok) {
      logger.warn(`Avatar Importer: body mesh rejeitada (${san.reason}).`);
      return { ok: false, reason: "bad-mesh" };
    }
  }
  const rec = assetStore.addImported({
    name: sanitizeName(o.name, "BodyMesh"),
    section: "meshes",
    ext: "obj",
    size: Number(o.fileSize) || 0,
    dataUri: null,
    mime: null,
  });
  logger.info(`Avatar Importer: body mesh "${sanitizeName(o.name, "BodyMesh")}" importada.`);
  return { ok: true, assetId: rec ? rec.id : null };
}

export function validateAvatarAsset(inst, char) {
  return validateAccessoryAsset(inst, char || null);
}

export function importedAccessoryFor(assetId) {
  const entry = templates.get(assetId);
  return entry ? entry.template : null;
}

export function insertImportedAccessory(assetId, char) {
  const entry = templates.get(assetId);
  if (!entry || !live(entry.template)) {
    logger.warn("Avatar Importer: asset de acess\u00f3rio n\u00e3o encontrado.");
    return null;
  }
  const acc = entry.template.clone();
  if (live(char)) {
    ensureCharacterAttachments(char);
    ensureWrapTargets(char);
    const res = equipAccessory(char, acc);
    if (!res.ok) {
      acc.setParent(char);
    }
  } else {
    const ws = getService(store.getDataModel(), "Workspace");
    if (ws) acc.setParent(ws);
  }
  return acc;
}

export function previewOnRig(assetId, char) {
  if (!live(char)) {
    logger.warn("Avatar Importer: nenhum rig dispon\u00edvel para preview.");
    return null;
  }
  return insertImportedAccessory(assetId, char);
}
