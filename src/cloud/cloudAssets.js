import { bus } from "../core/eventBus.js";
import { logger } from "../core/logger.js";
import { assetStore } from "../assets/assetStore.js";
import * as cloudStore from "./cloudStore.js";
import { createResourceId } from "../core/resourceId.js";           

export const MAX_ASSET_BYTES = 20 * 1024 * 1024;
export const MODERATION_MIN_MS = 2500;
export const MODERATION_MAX_MS = 6000;
export const REJECT_CHANCE = 0.15;

export const KIND_BY_EXT = Object.freeze({
  png: "image",
  jpg: "image",
  jpeg: "image",
  bmp: "image",
  mp3: "audio",
  ogg: "audio",
  wav: "audio",
  obj: "mesh",
  glb: "mesh",
  gltf: "mesh",
});

export const KIND_SECTION = Object.freeze({ image: "images", audio: "audio", mesh: "meshes" });
export const KIND_LABELS = Object.freeze({ image: "Image", audio: "Audio", mesh: "Mesh" });


const THUMB_CACHE_MAX = 200;
const _thumbCache = new Map();
function cacheThumb(id, thumb) {
  if (_thumbCache.has(id)) _thumbCache.delete(id);
  _thumbCache.set(id, thumb);
  while (_thumbCache.size > THUMB_CACHE_MAX) {
    _thumbCache.delete(_thumbCache.keys().next().value);
  }
}
const _moderationTimers = new Map();
let _contentDeletedThumb = null;

export function acceptAttribute() {
  return Object.keys(KIND_BY_EXT).map((e) => "." + e).join(",");
}

function extOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ""));
  return m ? m[1].toLowerCase() : "";
}

export function validateUploadFile(file) {
  if (!file || typeof file !== "object") return { ok: false, reason: "Arquivo inv\u00e1lido." };
  const name = String(file.name || "");
  const ext = extOf(name);
  const kind = KIND_BY_EXT[ext];
  if (!kind) return { ok: false, reason: "Tipo n\u00e3o suportado: ." + (ext || "?") + " (apenas imagens, \u00e1udio e geometria)." };
  const size = Number(file.size) || 0;
  if (size <= 0) return { ok: false, reason: "Arquivo vazio." };
  if (size > MAX_ASSET_BYTES) return { ok: false, reason: "Arquivo excede o limite de " + Math.floor(MAX_ASSET_BYTES / (1024 * 1024)) + "MB." };
  const mime = String(file.type || "");
  if (kind === "image" && mime && !mime.startsWith("image/")) {
    return { ok: false, reason: "MIME \"" + mime + "\" incompat\u00edvel com imagem." };
  }
  if (kind === "audio" && mime && !mime.startsWith("audio/")) {
    return { ok: false, reason: "MIME \"" + mime + "\" incompat\u00edvel com \u00e1udio." };
  }
  if (kind === "mesh" && mime && /^(image|audio|video)\//.test(mime)) {
    return { ok: false, reason: "MIME \"" + mime + "\" incompat\u00edvel com geometria." };
  }
  return { ok: true, kind, ext };
}

function readFileAsDataUri(file) {
  return new Promise((resolve, reject) => {
    const fr = new FileReader();
    fr.onload = () => resolve(String(fr.result || ""));
    fr.onerror = () => reject(fr.error || new Error("Falha ao ler o arquivo."));
    fr.readAsDataURL(file);
  });
}

function sanitizeAssetName(raw) {
  let s = String(raw == null ? "" : raw);
  s = s.replace(/<[^>]*>/g, " ").replace(/[<>{}\\`$]/g, " ").replace(/\s+/g, " ").trim();


  return cloudStore.sliceName(s, 120) || "asset";
}

export function scheduleModeration(assetId, delayMs) {
  const id = String(assetId);
  if (_moderationTimers.has(id)) return;
  const ms = Number.isFinite(delayMs)
    ? Math.max(500, delayMs)
    : MODERATION_MIN_MS + Math.random() * (MODERATION_MAX_MS - MODERATION_MIN_MS);
  const timer = setTimeout(async () => {
    _moderationTimers.delete(id);
    try {
      const rec = await cloudStore.getAsset(id);
      if (!rec || rec.status !== "Pending") return;
      rec.status = Math.random() < REJECT_CHANCE ? "Rejected" : "Approved";
      rec.moderatedAt = new Date().toISOString();
      await cloudStore.putAsset(rec);
      _thumbCache.delete(id);
      bus.emit("cloud:assetsChanged", { id, status: rec.status });
      logger.info("Cloud Assets: \"" + rec.name + "\" moderado como " + rec.status + ".", { source: "Studio" });
    } catch (e) {
      logger.warn("Cloud Assets: falha na modera\u00e7\u00e3o simulada: " + ((e && e.message) || e), { source: "Studio" });
    }
  }, ms);
  _moderationTimers.set(id, timer);
}

export async function resumePendingModeration() {
  try {
    const all = await cloudStore.listAssets();
    for (const a of all) {
      if (a.status === "Pending") scheduleModeration(a.id, 1500 + Math.random() * 2500);
    }
  } catch (_) {}
}

export async function uploadFiles(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const universe = await cloudStore.getUniverse(o.universeId);
  if (!universe) throw new Error("Selecione um Universe v\u00e1lido antes de enviar assets.");
  const files = Array.from(o.files || []);


  const rawProgress = typeof o.onProgress === "function" ? o.onProgress : () => {};
  const onProgress = function () { try { rawProgress.apply(null, arguments); } catch (_) {} };
  const results = [];
  let done = 0;
  for (const file of files) {
    const v = validateUploadFile(file);
    if (!v.ok) {
      done += 1;
      results.push({ ok: false, name: String(file && file.name || "?"), reason: v.reason });
      onProgress(done, files.length, String(file && file.name || "?"), false, v.reason);
      continue;
    }
    try {
      const dataUri = await readFileAsDataUri(file);
      const id = createResourceId("ca_");
      const rec = {
        id,
        assetId: cloudStore.newId64(),
        name: sanitizeAssetName(file.name),
        kind: v.kind,
        ext: v.ext,
        size: Number(file.size) || 0,
        mime: String(file.type || ""),
        universeId: String(universe.id),
        isPublic: false,
        status: "Pending",
        createdAt: new Date().toISOString(),
        moderatedAt: null,
        dataChunks: 0,
      };
      rec.dataChunks = await cloudStore.writeAssetData(id, dataUri);
      try {
        await cloudStore.putAsset(rec);
      } catch (e) {


        try { await cloudStore.deleteAsset(id); } catch (_) {}
        throw e;
      }
      scheduleModeration(id);
      done += 1;
      results.push({ ok: true, name: rec.name, asset: rec });
      onProgress(done, files.length, rec.name, true, null);
    } catch (e) {
      done += 1;
      const reason = (e && e.message) || "Falha ao enviar.";
      results.push({ ok: false, name: String(file && file.name || "?"), reason });
      onProgress(done, files.length, String(file && file.name || "?"), false, reason);
    }
  }
  if (results.some((r) => r.ok)) bus.emit("cloud:assetsChanged", { uploaded: true });
  return results;
}

export async function setAssetPublic(assetId, isPublic) {
  const rec = await cloudStore.getAsset(assetId);
  if (!rec) return false;
  rec.isPublic = !!isPublic;
  await cloudStore.putAsset(rec);
  bus.emit("cloud:assetsChanged", { id: rec.id });
  return true;
}

export function contentDeletedThumb() {
  if (_contentDeletedThumb) return _contentDeletedThumb;
  try {
    const c = document.createElement("canvas");
    c.width = 128;
    c.height = 96;
    const g = c.getContext("2d");
    g.fillStyle = "#3a3f4a";
    g.fillRect(0, 0, 128, 96);
    g.strokeStyle = "#565d6b";
    g.lineWidth = 2;
    g.strokeRect(4, 4, 120, 88);
    g.fillStyle = "#aab1bf";
    g.font = "bold 13px sans-serif";
    g.textAlign = "center";
    g.fillText("Content", 64, 44);
    g.fillText("Deleted", 64, 60);
    _contentDeletedThumb = c.toDataURL("image/png");
  } catch (_) {
    _contentDeletedThumb = null;
  }
  return _contentDeletedThumb;
}

export async function getThumbnail(asset) {
  if (!asset) return null;
  if (asset.status === "Rejected") return contentDeletedThumb();
  if (asset.kind !== "image") return null;
  const cached = _thumbCache.get(asset.id);
  if (cached) return cached;
  try {
    const dataUri = await cloudStore.readAssetData(asset.id);
    if (!dataUri) return null;
    const thumb = await new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const c = document.createElement("canvas");
          const scale = Math.min(1, 128 / Math.max(1, img.width), 96 / Math.max(1, img.height));
          c.width = Math.max(1, Math.round(img.width * scale));
          c.height = Math.max(1, Math.round(img.height * scale));
          c.getContext("2d").drawImage(img, 0, 0, c.width, c.height);
          resolve(c.toDataURL("image/png"));
        } catch (_) {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = dataUri;
    });
    if (thumb) cacheThumb(asset.id, thumb);
    return thumb;
  } catch (_) {
    return null;
  }
}

export function canUseInUniverse(asset, universeId) {
  if (!asset) return false;
  if (asset.isPublic) return true;
  if (!universeId) return true;
  return String(asset.universeId) === String(universeId);
}

export async function insertIntoProject(asset, currentUniverseId) {
  if (!asset) return { ok: false, reason: "Asset inv\u00e1lido." };
  if (!canUseInUniverse(asset, currentUniverseId)) {
    return { ok: false, reason: "Este asset pertence a outro Universe e n\u00e3o \u00e9 p\u00fablico (IsPublic desativado)." };
  }
  if (asset.status === "Pending") {
    return { ok: false, reason: "Asset ainda em modera\u00e7\u00e3o (Pending). Aguarde alguns segundos." };
  }
  const section = KIND_SECTION[asset.kind];
  if (!section) return { ok: false, reason: "Tipo de asset n\u00e3o insert\u00e1vel." };
  if (asset.status === "Rejected") {


    const cd = asset.kind === "image" ? contentDeletedThumb() : null;
    const rec = assetStore.addImported({
      name: "[Content Deleted] " + asset.name,
      section,
      ext: asset.kind === "image" ? "png" : asset.ext,
      size: 0,
      dataUri: cd,
      mime: cd ? "image/png" : null,
    });
    return { ok: true, placeholder: true, record: rec };
  }
  const dataUri = await cloudStore.readAssetData(asset.id);
  if (!dataUri) return { ok: false, reason: "Conte\u00fado do asset n\u00e3o encontrado na nuvem." };
  const rec = assetStore.addImported({
    name: asset.name,
    section,
    ext: asset.ext,
    size: asset.size,
    dataUri,
    mime: asset.mime || null,
  });
  return { ok: true, record: rec };
}
