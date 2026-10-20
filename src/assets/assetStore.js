import { bus } from "../core/eventBus.js";
import { logger } from "../core/logger.js";

export const MAX_IMPORT_BYTES = 50 * 1024 * 1024;        


export const SECTIONS = Object.freeze([
  "places",
  "images",
  "meshes",
  "accessories",
  "packages",
  "audio",
  "videos",
  "fonts",
  "animations",
]);

export const SECTION_LABELS = Object.freeze({
  places: "Places",
  images: "Images",
  meshes: "Meshes",
  accessories: "Avatar/Accessories",
  packages: "Packages",
  audio: "Audio",
  videos: "Videos",
  fonts: "Fonts",
  animations: "Animations",
});


const ACCEPT = Object.freeze({





  images: { ext: ["png", "jpg", "jpeg", "bmp", "tga", "hdr", "exr", "ies", "cube"], mime: "image/" },
  meshes: { ext: ["glb", "gltf", "fbx", "obj"], mime: null },
  audio: { ext: ["mp3", "ogg", "wav"], mime: "audio/" },
  videos: { ext: ["mp4", "webm"], mime: "video/" },
  fonts: { ext: ["ttf", "otf"], mime: null },
});


const MIME_EXCEPTIONS = Object.freeze({
  ogg: ["video/ogg", "application/ogg"],


  hdr: ["application/octet-stream", "image/vnd.radiance", "image/x-hdr"],
  exr: ["application/octet-stream", "image/x-exr", "image/aces"],


  ies: ["text/plain", "application/octet-stream", "application/ies"],


  cube: ["text/plain", "application/octet-stream"],
});


export const SECTION_ASSET_TYPE = Object.freeze({
  images: "Decal",
  meshes: "Mesh",
  accessories: "Accessory",
  audio: "Audio",
  videos: "Video",
  fonts: "Font",
  animations: "Animation",
  packages: "Package",
  places: "Place",
});


export function acceptAttribute() {
  const exts = [];
  for (const k of Object.keys(ACCEPT)) {
    for (const e of ACCEPT[k].ext) exts.push("." + e);
  }
  return exts.join(",");
}

export function extOf(name) {
  const m = /\.([a-z0-9]+)$/i.exec(String(name || ""));
  return m ? m[1].toLowerCase() : "";
}


export function cleanAssetName(name, fallback = "asset") {
  const s = String(name == null ? "" : name)
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim()
    .slice(0, 100)
    .trim();
  return s || fallback;
}


const NON_TEXTURE_IMAGE_EXTS = Object.freeze(["ies", "cube", "hdr", "exr"]);
export function isRenderableImageExt(ext) {
  const e = String(ext || "").toLowerCase();
  if (!e) return true;                                                            
  if (!ACCEPT.images.ext.includes(e)) return true;                                                       
  return !NON_TEXTURE_IMAGE_EXTS.includes(e);
}


export function sectionForExt(ext) {
  const e = String(ext || "").toLowerCase();
  for (const sec of Object.keys(ACCEPT)) {
    if (ACCEPT[sec].ext.includes(e)) return sec;
  }
  return null;
}


export function validateImport(file) {
  if (!file || typeof file !== "object")
    return { ok: false, reason: "Arquivo inv\u00e1lido." };
  const name = String(file.name || "");
  const ext = extOf(name);
  const section = sectionForExt(ext);
  if (!section) {
    return {
      ok: false,
      reason: `Tipo de arquivo n\u00e3o suportado: .${ext || "?"}`,
    };
  }
  const size = Number(file.size) || 0;
  if (size > MAX_IMPORT_BYTES) {
    return {
      ok: false,
      reason: `Arquivo excede o limite de ${Math.round(MAX_IMPORT_BYTES / 1024 / 1024)}MB.`,
    };
  }

  if (section === "images" && size > 20 * 1024 * 1024) {
    return {
      ok: false,
      reason: "Imagens (texturas) s\u00e3o limitadas a 20MB por arquivo.",
    };
  }

  const mimePrefix = ACCEPT[section].mime;
  const mime = String(file.type || "").toLowerCase();
  const mimeExceptions = MIME_EXCEPTIONS[ext] || [];
  if (mimePrefix && mime && !mime.startsWith(mimePrefix) && !mimeExceptions.includes(mime)) {
    return {
      ok: false,
      reason: `MIME "${mime}" incompat\u00edvel com .${ext}.`,
    };
  }
  return { ok: true, section, ext };
}

class AssetStore {
  constructor() {
    this._sections = {};
    for (const s of SECTIONS) this._sections[s] = [];
    this._recent = [];                                                      
    this._favorites = new Set();                                


    this._seq = 2000000;
    this._seeded = false;
  }


  seed() {
    if (this._seeded) return;
    this._seeded = true;
    this._sections.places.push({
      id: "place://main",
      name: "Main Place",
      assetType: "Place",
      section: "places",
      size: 0,
      imported: new Date().toISOString(),
      dataUri: null,
      mime: null,
      builtin: true,
      thumbColor: "#6b7280",
    });
  }

  nextAssetId() {
    this._seq += 333;
    return "rbxassetid://" + this._seq;
  }

  list(section) {
    return (this._sections[section] || []).slice();
  }

  counts() {
    const out = {};
    for (const s of SECTIONS) out[s] = this._sections[s].length;
    return out;
  }

  getById(id) {
    for (const s of SECTIONS) {
      const hit = this._sections[s].find((a) => a.id === id);
      if (hit) return hit;
    }
    return null;
  }


  addImported({ name, section, ext, size, dataUri, mime, thumb, skinned, skin }) {


    const cleanName = cleanAssetName(name);
    const rec = {
      id: this.nextAssetId(),
      name: cleanName,
      assetType: SECTION_ASSET_TYPE[section] || "Model",
      section,
      ext: ext || extOf(cleanName),
      size: Number(size) || 0,
      imported: new Date().toISOString(),
      dataUri: dataUri || null,
      mime: mime || null,
      skinned: Boolean(skinned),                                         
      skin: skin || null,                                                          
      thumb: thumb || null,                                              
      creator: "Me",
      local: true,
    };
    if (!this._sections[section]) this._sections[section] = [];
    this._sections[section].unshift(rec);
    bus.emit("assets:changed", { section, action: "add", asset: rec });
    logger.info(`Asset importado: ${rec.name} (${section}).`);
    return rec;
  }

  rename(id, newName) {
    const a = this.getById(id);
    if (!a || a.builtin) return false;


    const cleaned = cleanAssetName(newName, "");
    if (!cleaned) return false;
    a.name = cleaned;
    bus.emit("assets:changed", { section: a.section, action: "rename", asset: a });
    return true;
  }

  remove(id) {
    for (const s of SECTIONS) {
      const idx = this._sections[s].findIndex((a) => a.id === id);
      if (idx >= 0) {
        const [rec] = this._sections[s].splice(idx, 1);
        if (rec && rec.builtin) {
          this._sections[s].splice(idx, 0, rec);                      
          return false;
        }
        bus.emit("assets:changed", { section: s, action: "remove", asset: rec });
        return true;
      }
    }
    return false;
  }


  restoreLocal(records) {
    for (const s of SECTIONS) {
      this._sections[s] = this._sections[s].filter((a) => a.builtin);
    }
    const list = Array.isArray(records) ? records : [];


    for (const r of list) {
      if (!r || typeof r !== "object") continue;
      const m = /^rbxassetid:\/\/(\d+)$/.exec(String(r.id || ""));
      if (m) this._seq = Math.max(this._seq, Number(m[1]));
    }


    const builtinIds = new Set();
    for (const s of SECTIONS) {
      for (const a of this._sections[s]) if (a && a.id) builtinIds.add(a.id);
    }
    const seen = new Set();
    for (const r of list) {
      if (!r || typeof r !== "object") continue;
      const section = SECTIONS.includes(r.section) ? r.section : null;
      if (!section) continue;
      let id = String(r.id || "");
      if (id && builtinIds.has(id)) continue;
      if (!id || seen.has(id)) id = this.nextAssetId();
      seen.add(id);
      const rec = {
        id,
        name: cleanAssetName(r.name),
        assetType: String(r.assetType || SECTION_ASSET_TYPE[section] || "Model"),
        section,
        ext: r.ext || null,
        size: Number(r.size) || 0,


        imported: typeof r.imported === "string" && r.imported ? r.imported : new Date().toISOString(),
        dataUri: r.dataUri || null,
        mime: r.mime || null,


        skinned: Boolean(r.skinned),
        skin: r.skin && typeof r.skin === "object" ? r.skin : null,
        thumb: typeof r.thumb === "string" ? r.thumb : null,
        creator: "Me",
        local: true,
      };
      this._sections[section].push(rec);
    }
    bus.emit("assets:changed", { section: null, action: "restore", asset: null });
  }


  addRecent(id) {
    if (!id) return;
    this._recent = [id, ...this._recent.filter((x) => x !== id)].slice(0, 40);
    bus.emit("assets:recentChanged", { id });
  }
  recentIds() {
    return this._recent.slice();
  }
  toggleFavorite(id) {
    if (!id) return false;
    if (this._favorites.has(id)) this._favorites.delete(id);
    else this._favorites.add(id);
    bus.emit("assets:favoritesChanged", { id });
    return this._favorites.has(id);
  }
  isFavorite(id) {
    return this._favorites.has(id);
  }
  favoriteIds() {
    return Array.from(this._favorites);
  }
}

export const assetStore = new AssetStore();
