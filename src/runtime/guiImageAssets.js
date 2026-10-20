import { extractAssetId, buildEndpoints } from "../audio/audioCdn.js";
import { filterAllowedProxyPrefixesOrUndefined } from "./cdnProxyPolicy.js";

export const DECAL_RESOLVE_LIMITS = Object.freeze({
  maxBytes: 4 * 1024 * 1024,
  timeoutMs: 15000,
  negativeTtlMs: 60 * 1000,
  maxCache: 256,
});


export function looksLikeRobloxXml(text) {
  const s = String(text == null ? "" : text).replace(/^\uFEFF/, "").trimStart();
  if (!s.startsWith("<")) return false;
  return /<roblox[\s>!]/i.test(s.slice(0, 4096));
}


export function extractImageIdFromDecalXml(text, ownId) {
  const s = String(text == null ? "" : text).slice(0, 2 * 1024 * 1024);
  const own = String(ownId == null ? "" : ownId);
  const tryAll = (re) => {
    let m;
    while ((m = re.exec(s))) {
      const id = extractAssetId(String(m[1] || "").trim());
      if (id && id !== own) return id;
    }
    return null;
  };
  return (
    tryAll(/<Content[^>]*name="(?:Texture|Image|Graphic|TextureId)"[^>]*>\s*<url>([^<]+)<\/url>/gi) ||
    tryAll(/<url>\s*([^<]+?)\s*<\/url>/gi)
  );
}


export function createDecalResolver(deps) {
  const d = deps || {};
  const fetchImpl = typeof d.fetchImpl === "function" ? d.fetchImpl : null;
  const now = typeof d.now === "function" ? d.now : () => Date.now();
  const limits = { ...DECAL_RESOLVE_LIMITS, ...(d.limits || {}) };
  const endpointsFor = typeof d.endpointsFor === "function" ? d.endpointsFor : (id) => buildEndpoints(id, undefined);
  const positive = new Map();                 
  const negative = new Map();                          
  const inflight = new Map();
  const stats = { fetches: 0, resolved: 0, negatives: 0 };

  async function fetchText(url) {
    stats.fetches += 1;
    const ac = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ac ? setTimeout(() => { try { ac.abort(); } catch {            } }, limits.timeoutMs) : null;
    try {
      const res = await fetchImpl(url, ac ? { signal: ac.signal } : undefined);
      if (!res || !res.ok) return null;
      const len = Number(res.headers && res.headers.get ? res.headers.get("content-length") : 0);
      if (Number.isFinite(len) && len > limits.maxBytes) return null;
      const buf = await res.arrayBuffer();
      if (!buf || buf.byteLength < 8 || buf.byteLength > limits.maxBytes) return null;
      try {
        return new TextDecoder("utf-8", { fatal: false }).decode(buf);
      } catch {
        return null;
      }
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  function resolve(rawId) {
    const raw = String(rawId == null ? "" : rawId);
    const sid = extractAssetId(/^\d+$/.test(raw) ? `rbxassetid://${raw}` : raw);
    if (!sid || !fetchImpl) return Promise.resolve(null);
    if (positive.has(sid)) return Promise.resolve(positive.get(sid));
    const until = negative.get(sid);
    if (until != null && now() < until) return Promise.resolve(null);
    if (inflight.has(sid)) return inflight.get(sid);
    const p = (async () => {
      for (const url of endpointsFor(sid)) {
        const text = await fetchText(url);
        if (!text) continue;                                             
        if (!looksLikeRobloxXml(text)) break;                                         
        const imageId = extractImageIdFromDecalXml(text, sid);
        if (imageId) {
          if (positive.size >= limits.maxCache) positive.clear();
          positive.set(sid, imageId);
          stats.resolved += 1;
          return imageId;
        }
        break;                                                              
      }
      if (negative.size >= limits.maxCache) negative.clear();
      negative.set(sid, now() + limits.negativeTtlMs);
      stats.negatives += 1;
      return null;
    })().finally(() => inflight.delete(sid));
    inflight.set(sid, p);
    return p;
  }

  return { resolve, stats };
}



export function guiImageProxies() {
  try {
    const configured = globalThis.ROBLOX_IMAGE_CDN_PROXIES || globalThis.ROBLOX_AUDIO_CDN_PROXIES;
    return filterAllowedProxyPrefixesOrUndefined(configured);
  } catch {
    return undefined;
  }
}

let browserResolver = null;


export function decalImageResolver() {
  if (!browserResolver) {
    browserResolver = createDecalResolver({
      fetchImpl: typeof fetch === "function" ? (u, o) => fetch(u, o) : null,
      endpointsFor: (id) => buildEndpoints(id, guiImageProxies()),
    });
  }
  return browserResolver;
}





export function rbxassetTileSpec(path) {
  const p = String(path == null ? "" : path).replace(/^rbxasset:\/\//i, "").toLowerCase();
  let h = 2166136261 >>> 0;
  for (let i = 0; i < p.length; i++) {
    h ^= p.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  const hue = h % 360;
  const hue2 = (hue + 40 + ((h >>> 9) % 80)) % 360;
  const cells = [];
  for (let i = 0; i < 16; i++) cells.push(((h >>> i) & 1) === 1);
  return { key: p, hue, hue2, cells };
}

const TILE_SIZE = 64;
const tileCache = new Map();                              


export function rbxassetDataUri(path) {
  if (typeof document === "undefined" || !document.createElement) return null;
  const spec = rbxassetTileSpec(path);
  const hit = tileCache.get(spec.key);
  if (hit) return hit;
  try {
    const c = document.createElement("canvas");
    c.width = TILE_SIZE;
    c.height = TILE_SIZE;
    const ctx = c.getContext("2d");
    if (!ctx) return null;
    ctx.fillStyle = `hsl(${spec.hue}, 42%, 34%)`;
    ctx.fillRect(0, 0, TILE_SIZE, TILE_SIZE);
    ctx.fillStyle = `hsl(${spec.hue2}, 55%, 52%)`;
    const cell = TILE_SIZE / 4;
    for (let i = 0; i < 16; i++) {
      if (!spec.cells[i]) continue;
      ctx.fillRect((i % 4) * cell, Math.floor(i / 4) * cell, cell, cell);
    }
    ctx.strokeStyle = "rgba(0, 0, 0, 0.35)";
    ctx.lineWidth = 2;
    ctx.strokeRect(1, 1, TILE_SIZE - 2, TILE_SIZE - 2);
    const uri = c.toDataURL("image/png");
    if (tileCache.size >= 128) tileCache.clear();
    tileCache.set(spec.key, uri);
    return uri;
  } catch {
    return null;
  }
}
