import { extractAssetId, buildEndpoints } from "../audio/audioCdn.js";
import { filterAllowedProxyPrefixesOrUndefined } from "./cdnProxyPolicy.js";


const BASE_STACK = "system-ui, sans-serif";
const SANS = `"Source Sans 3", "Source Sans Pro", "Segoe UI", ${BASE_STACK}`;
const GOTHAM = `Gotham, Montserrat, Futura, "Segoe UI", ${BASE_STACK}`;
const MONO = `"Roboto Mono", Consolas, Menlo, "Courier New", monospace`;
const ARIAL = `Arial, Arimo, Helvetica, ${BASE_STACK}`;


export const GUI_WEBFONT_CSS_URL =
  "https://fonts.googleapis.com/css2" +
  "?family=Source+Sans+3:ital,wght@0,300;0,400;0,600;0,700;1,400" +
  "&family=Montserrat:wght@300;500;700;900" +
  "&family=Roboto:wght@300;400;700" +
  "&family=Roboto+Mono" +
  "&family=Titillium+Web" +
  "&family=Oswald:wght@500" +
  "&family=Nunito" +
  "&family=Merriweather" +
  "&family=Ubuntu" +
  "&family=Arimo:wght@400;700" +
  "&display=swap";

export const CUSTOM_FONT_LIMITS = Object.freeze({
  maxBytes: 10 * 1024 * 1024,                                      
  timeoutMs: 15000,
  negativeTtlMs: 5 * 60 * 1000,                                        
  maxFaces: 4,                                         
});


const WEIGHT_NAMES = Object.freeze({
  thin: 100,
  extralight: 200,
  ultralight: 200,
  light: 300,
  regular: 400,
  normal: 400,
  medium: 500,
  semibold: 600,
  demibold: 600,
  bold: 700,
  extrabold: 800,
  ultrabold: 800,
  heavy: 900,
  black: 900,
});


export function fontWeightNumber(v, fallback = 400) {
  if (v == null) return fallback;
  const n = Number(v);
  if (Number.isFinite(n)) return Math.max(100, Math.min(900, Math.round(n / 100) * 100));
  const m = /([a-z]+)\s*$/i.exec(String(v).trim());
  if (m && WEIGHT_NAMES[m[1].toLowerCase()] != null) return WEIGHT_NAMES[m[1].toLowerCase()];
  return fallback;
}

export function fontStyleNormalized(v) {
  return /italic|oblique/i.test(String(v == null ? "" : v)) ? "italic" : "normal";
}


export function parseFontFaceValue(v) {
  if (v == null) return null;
  let o = v;
  if (typeof v === "string") {
    const s = v.trim();
    if (!s) return null;
    if (s.startsWith("{")) {
      try {
        o = JSON.parse(s);
      } catch {
        return null;
      }
    } else {
      o = { family: s };
    }
  }
  if (typeof o !== "object" || Array.isArray(o)) return null;
  const fam = o.family != null ? o.family : o.Family;
  const family = String(fam == null ? "" : fam).trim();
  if (!family || family.length > 512) return null;
  return {
    family,
    weight: fontWeightNumber(o.weight != null ? o.weight : o.Weight, 400),
    style: fontStyleNormalized(o.style != null ? o.style : o.Style),
  };
}





export function fontFamilyRef(family) {
  const s = String(family == null ? "" : family).trim();
  if (!s) return null;
  const m = /^rbxasset:\/\/fonts\/families\/([^/\\]+?)\.json$/i.exec(s);
  if (m) return { kind: "builtin", name: m[1] };
  const m2 = /^rbxasset:\/\/fonts\/([^/\\]+?)\.(?:ttf|otf)$/i.exec(s);
  if (m2) return { kind: "builtin", name: m2[1] };
  const id = extractAssetId(s);
  if (id) return { kind: "asset", id };
  if (/^[A-Za-z0-9 _-]{2,64}$/.test(s)) return { kind: "builtin", name: s };
  return null;
}

export function customFontFamilyName(id) {
  return `RbxFont_${String(id)}`;
}

const normKey = (name) => String(name == null ? "" : name).toLowerCase().replace(/[^a-z0-9]/g, "");
const B = (stack, lazy) => Object.freeze(lazy ? { stack, lazy } : { stack });


const BUILTIN_FONT_FAMILIES = Object.freeze({
  sourcesanspro: B(SANS),
  sourcesans: B(SANS),
  gothamssm: B(GOTHAM),
  gotham: B(GOTHAM),
  arial: B(ARIAL),
  arimo: B(ARIAL),
  helvetica: B(ARIAL),
  legacy: B(ARIAL),
  roboto: B(`Roboto, "Segoe UI", ${BASE_STACK}`),
  robotomono: B(MONO),
  inconsolata: B(MONO),
  code: B(MONO),
  robotocondensed: B(`"Roboto Condensed", "Arial Narrow", ${BASE_STACK}`, "Roboto+Condensed"),
  oswald: B(`Oswald, "Arial Narrow", ${BASE_STACK}`),
  titilliumweb: B(`"Titillium Web", ${SANS}`),
  nunito: B(`Nunito, "Trebuchet MS", ${BASE_STACK}`),
  merriweather: B(`Merriweather, Georgia, "Times New Roman", serif`),
  ubuntu: B(`Ubuntu, "Segoe UI", ${BASE_STACK}`),
  montserrat: B(`Montserrat, "Segoe UI", ${BASE_STACK}`),
  amaticsc: B(`"Amatic SC", cursive`, "Amatic+SC:wght@400;700"),
  balthazar: B(`Balthazar, serif`, "Balthazar"),
  bangers: B(`Bangers, cursive`, "Bangers"),
  creepster: B(`Creepster, cursive`, "Creepster"),
  denkone: B(`"Denk One", ${BASE_STACK}`, "Denk+One"),
  fondamento: B(`Fondamento, cursive`, "Fondamento:ital@0;1"),
  fredokaone: B(`"Fredoka One", Fredoka, ${BASE_STACK}`, "Fredoka+One"),
  grenzegotisch: B(`"Grenze Gotisch", serif`, "Grenze+Gotisch"),
  indieflower: B(`"Indie Flower", cursive`, "Indie+Flower"),
  josefinsans: B(`"Josefin Sans", ${BASE_STACK}`, "Josefin+Sans:ital,wght@0,300;0,400;0,700;1,400"),
  jura: B(`Jura, ${BASE_STACK}`, "Jura"),
  kalam: B(`Kalam, cursive`, "Kalam:wght@300;400;700"),
  luckiestguy: B(`"Luckiest Guy", cursive`, "Luckiest+Guy"),
  michroma: B(`Michroma, ${BASE_STACK}`, "Michroma"),
  patrickhand: B(`"Patrick Hand", cursive`, "Patrick+Hand"),
  permanentmarker: B(`"Permanent Marker", cursive`, "Permanent+Marker"),
  specialelite: B(`"Special Elite", monospace`, "Special+Elite"),
  pressstart2p: B(`"Press Start 2P", monospace`, "Press+Start+2P"),
  arcade: B(`"Press Start 2P", monospace`, "Press+Start+2P"),
  bodoni: B(`"Libre Bodoni", "Bodoni MT", Didot, serif`, "Libre+Bodoni:ital,wght@0,400;0,700;1,400"),
  garamond: B(`"EB Garamond", Garamond, serif`, "EB+Garamond:ital,wght@0,400;0,700;1,400"),
  cartoon: B(`"Comic Neue", "Comic Sans MS", cursive`, "Comic+Neue:wght@400;700"),
  highway: B(`Overpass, "Arial Narrow", ${BASE_STACK}`, "Overpass:wght@400;600;700"),
  scifi: B(`Michroma, ${BASE_STACK}`, "Michroma"),
  fantasy: B(`"Grenze Gotisch", fantasy, serif`, "Grenze+Gotisch"),
  antique: B(`"Special Elite", serif`, "Special+Elite"),
});


export function resolveFontFaceFont(value) {
  const ff = parseFontFaceValue(value);
  if (!ff) return null;
  const ref = fontFamilyRef(ff.family);
  if (!ref) return null;
  if (ref.kind === "asset") {
    return Object.freeze({
      family: `"${customFontFamilyName(ref.id)}", ${SANS}`,
      weight: ff.weight,
      style: ff.style,
      variant: "normal",
      assetId: ref.id,
    });
  }
  const entry = BUILTIN_FONT_FAMILIES[normKey(ref.name)] || null;
  return Object.freeze({
    family: entry ? entry.stack : SANS,
    weight: ff.weight,
    style: ff.style,
    variant: "normal",
    lazyGoogle: entry && entry.lazy ? entry.lazy : undefined,
  });
}


export function sniffFontContainer(bytes) {
  const b = bytes instanceof Uint8Array ? bytes : bytes ? new Uint8Array(bytes) : null;
  if (!b || b.length < 4) return null;
  if (b[0] === 0x00 && b[1] === 0x01 && b[2] === 0x00 && b[3] === 0x00) return "ttf";
  const tag = String.fromCharCode(b[0], b[1], b[2], b[3]);
  if (tag === "OTTO") return "otf";
  if (tag === "true" || tag === "ttcf") return "ttf";
  if (tag === "wOFF") return "woff";
  if (tag === "wOF2") return "woff2";
  return null;
}


export function extractFontFamilyFaces(text, maxFaces = CUSTOM_FONT_LIMITS.maxFaces) {
  const s = String(text == null ? "" : text);
  if (!s || s.length > 256 * 1024) return [];
  let o = null;
  try {
    o = JSON.parse(s);
  } catch {
    return [];
  }
  const faces = o && (Array.isArray(o.faces) ? o.faces : Array.isArray(o.Faces) ? o.Faces : null);
  if (!faces) return [];
  const out = [];
  const seen = new Set();
  for (const f of faces) {
    if (out.length >= maxFaces) break;
    if (!f || typeof f !== "object") continue;
    const src = f.assetId != null ? f.assetId : f.AssetId != null ? f.AssetId : f.assetUri != null ? f.assetUri : f.AssetUri;
    const raw = typeof src === "number" ? `rbxassetid://${src}` : String(src == null ? "" : src);
    const id = extractAssetId(raw);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    out.push({
      id,
      weight: fontWeightNumber(f.weight != null ? f.weight : f.Weight, 400),
      style: fontStyleNormalized(f.style != null ? f.style : f.Style),
    });
  }
  return out;
}


export function pickFamilyFace(faces, want) {
  if (!Array.isArray(faces) || !faces.length) return null;
  const w = want && Number.isFinite(want.weight) ? want.weight : 400;
  const st = want && want.style === "italic" ? "italic" : "normal";
  let best = null;
  let bestScore = Infinity;
  for (const f of faces) {
    if (!f) continue;
    const score = Math.abs((Number(f.weight) || 400) - w) + (f.style === st ? 0 : 1000);
    if (score < bestScore) {
      bestScore = score;
      best = f;
    }
  }
  return best;
}

function decodeUtf8(bytes) {
  try {
    return new TextDecoder("utf-8", { fatal: false }).decode(bytes);
  } catch {
    return "";
  }
}





export function createCustomFontLoader(deps) {
  const d = deps || {};
  const fetchImpl = typeof d.fetchImpl === "function" ? d.fetchImpl : null;
  const now = typeof d.now === "function" ? d.now : () => Date.now();
  const limits = { ...CUSTOM_FONT_LIMITS, ...(d.limits || {}) };
  const endpointsFor = typeof d.endpointsFor === "function" ? d.endpointsFor : (id) => buildEndpoints(id, undefined);
  const negative = new Map();                                                  
  const inflight = new Map();
  const stats = { fetches: 0, resolved: 0, negatives: 0, jsonHops: 0 };

  async function fetchBytes(url) {
    stats.fetches += 1;
    const ac = typeof AbortController === "function" ? new AbortController() : null;
    const timer = ac ? setTimeout(() => { try { ac.abort(); } catch {            } }, limits.timeoutMs) : null;
    try {
      const res = await fetchImpl(url, ac ? { signal: ac.signal } : undefined);
      if (!res || !res.ok) return null;
      const len = Number(res.headers && res.headers.get ? res.headers.get("content-length") : 0);
      if (Number.isFinite(len) && len > limits.maxBytes) return null;
      const buf = await res.arrayBuffer();
      if (!buf || buf.byteLength < 4 || buf.byteLength > limits.maxBytes) return null;
      return new Uint8Array(buf);
    } catch {
      return null;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  async function fetchOnLadder(id) {
    for (const url of endpointsFor(String(id))) {
      const bytes = await fetchBytes(url);
      if (bytes) return bytes;
    }
    return null;
  }

  function resolve(id, want) {
    const raw = String(id == null ? "" : id);
    const sid = extractAssetId(/^\d+$/.test(raw) ? `rbxassetid://${raw}` : raw);
    if (!fetchImpl || !sid) return Promise.resolve(null);
    const neg = negative.get(sid);
    if (neg != null && (neg === Infinity || now() < neg)) return Promise.resolve(null);
    if (inflight.has(sid)) return inflight.get(sid);
    const p = (async () => {
      const bytes = await fetchOnLadder(sid);
      if (!bytes) {
        negative.set(sid, now() + limits.negativeTtlMs);
        stats.negatives += 1;
        return null;
      }
      if (sniffFontContainer(bytes)) {
        stats.resolved += 1;
        return {
          faces: [{
            bytes,
            weight: want && Number.isFinite(want.weight) ? want.weight : 400,
            style: want && want.style === "italic" ? "italic" : "normal",
          }],
        };
      }
      const head = decodeUtf8(bytes.subarray(0, 64)).replace(/^\uFEFF/, "").trimStart();
      if (head.startsWith("{")) {
        const faces = extractFontFamilyFaces(decodeUtf8(bytes), limits.maxFaces);
        const face = pickFamilyFace(faces, want);
        if (face && face.id !== sid) {
          stats.jsonHops += 1;                                           
          const fb = await fetchOnLadder(face.id);
          if (fb && sniffFontContainer(fb)) {
            stats.resolved += 1;
            return { faces: [{ bytes: fb, weight: face.weight, style: face.style }] };
          }
        }
      }
      negative.set(sid, Infinity);                                              
      stats.negatives += 1;
      return null;
    })().finally(() => inflight.delete(sid));
    inflight.set(sid, p);
    return p;
  }

  return { resolve, stats };
}


function createGuiFontLoaderSingleton() {
  const subs = new Set();
  const injected = new Set();
  const customState = new Map();                                   
  let started = false;
  let loader = null;

  const hasDoc = () => typeof document !== "undefined" && !!document.head;

  function notify() {
    for (const cb of Array.from(subs)) {
      try {
        cb();
      } catch {

      }
    }
  }

  function injectCssOnce(href, key) {
    if (!hasDoc() || injected.has(key)) return;
    injected.add(key);
    try {
      if (document.querySelector(`link[data-rsw-fonts="${key}"]`)) return;
      const link = document.createElement("link");
      link.rel = "stylesheet";
      link.href = href;
      link.setAttribute("data-rsw-fonts", key);
      document.head.appendChild(link);
    } catch {

    }
  }


  function start() {
    if (started || !hasDoc()) return;
    started = true;
    injectCssOnce(GUI_WEBFONT_CSS_URL, "core");
    try {
      if (document.fonts && typeof document.fonts.addEventListener === "function") {
        document.fonts.addEventListener("loadingdone", notify);
      }
    } catch {

    }
  }


  function fontProxies() {
    try {
      const configured =
        globalThis.ROBLOX_FONT_CDN_PROXIES || globalThis.ROBLOX_IMAGE_CDN_PROXIES || globalThis.ROBLOX_AUDIO_CDN_PROXIES;
      return filterAllowedProxyPrefixesOrUndefined(configured);
    } catch {
      return undefined;
    }
  }

  function requestCustom(font) {
    const id = String(font.assetId);
    if (customState.has(id)) return;
    if (!hasDoc() || typeof fetch !== "function" || typeof FontFace !== "function") {
      customState.set(id, "fail");
      return;
    }
    customState.set(id, "loading");
    if (!loader) {
      loader = createCustomFontLoader({
        fetchImpl: (u, opts) => fetch(u, opts),
        endpointsFor: (aid) => buildEndpoints(aid, fontProxies()),
      });
    }
    loader
      .resolve(id, { weight: font.weight, style: font.style })
      .then(async (r) => {
        if (!r || !r.faces || !r.faces.length) {
          customState.set(id, "fail");
          return;
        }
        let added = false;
        for (const face of r.faces) {
          try {
            const ff = new FontFace(customFontFamilyName(id), face.bytes, {
              weight: String(face.weight || 400),
              style: face.style === "italic" ? "italic" : "normal",
            });
            await ff.load();
            document.fonts.add(ff);
            added = true;
          } catch {

          }
        }
        customState.set(id, added ? "ok" : "fail");
        if (added) notify();                                                
      })
      .catch(() => {
        customState.set(id, "fail");
      });
  }


  function ensureFont(font) {
    if (!font || !hasDoc()) return;
    start();
    if (font.lazyGoogle) {
      injectCssOnce("https://fonts.googleapis.com/css2?family=" + font.lazyGoogle + "&display=swap", `https://fonts.googleapis.com/css2?family=${font.lazyGoogle}&display=swap`, `lazy:${font.lazyGoogle}`);
    }
    if (font.assetId) requestCustom(font);
  }

  function onChanged(cb) {
    if (typeof cb !== "function") return () => {};
    subs.add(cb);
    return () => subs.delete(cb);
  }

  return {
    start,
    ensureFont,
    onChanged,
    customStatus: (id) => customState.get(String(id)) || null,
    isStarted: () => started,
  };
}


export const guiFontLoader = createGuiFontLoaderSingleton();
