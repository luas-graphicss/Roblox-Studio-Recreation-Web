export const TYPE_COLORS = Object.freeze({
  Model: "#3b82f6",
  Decal: "#ec4899",
  Audio: "#22c55e",
  Mesh: "#f59e0b",
  Accessory: "#d946ef",                                            
  Plugin: "#a855f7",
  Animation: "#06b6d4",
  Video: "#ef4444",
  Font: "#64748b",
});

const TYPE_GLYPH = Object.freeze({
  Model: "\u25A0",         
  Decal: "\u25C8",           
  Audio: "\u266A",                
  Mesh: "\u25C7",            
  Accessory: "\u2726",                                
  Plugin: "\u2699",              
  Animation: "\u21BB",                 
  Video: "\u25B6",        
  Font: "A",
});


function esc(s) {
  return String(s == null ? "" : s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}


export function initials(name) {
  const words = String(name || "?")
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return "?";
  if (words.length === 1) return Array.from(words[0]).slice(0, 2).join("").toUpperCase();
  return (Array.from(words[0])[0] + Array.from(words[1])[0]).toUpperCase();
}


function shade(hex, delta) {
  const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || ""));
  if (!m) return hex || "#888888";
  const n = parseInt(m[1], 16);
  const clamp = (v) => Math.max(0, Math.min(255, v));
  const r = clamp(((n >> 16) & 0xff) + delta);
  const g = clamp(((n >> 8) & 0xff) + delta);
  const b = clamp((n & 0xff) + delta);
  return "#" + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

export function thumbColor(asset) {
  if (asset && asset.thumbColor) return asset.thumbColor;
  return (asset && TYPE_COLORS[asset.assetType]) || "#888888";
}


export function thumbDataUri(asset, size) {


  const s = Number(size) >= 1 ? Math.floor(size) : 120;
  const base = thumbColor(asset);
  const c1 = shade(base, 28);
  const c2 = shade(base, -42);
  const glyph = (asset && TYPE_GLYPH[asset.assetType]) || "\u25A0";
  const ini = initials(asset && asset.name);
  const gid = "g" + Math.abs(hashStr((asset && asset.id) || ini)).toString(36);
  const svg =
    '<svg xmlns="http://www.w3.org/2000/svg" width="' +
    s +
    '" height="' +
    s +
    '" viewBox="0 0 120 120">' +
    '<defs><linearGradient id="' +
    gid +
    '" x1="0" y1="0" x2="1" y2="1">' +
    '<stop offset="0" stop-color="' +
    esc(c1) +
    '"/><stop offset="1" stop-color="' +
    esc(c2) +
    '"/></linearGradient></defs>' +
    '<rect width="120" height="120" rx="10" fill="url(#' +
    gid +
    ')"/>' +
    '<text x="60" y="54" font-family="Segoe UI, Arial, sans-serif" font-size="46" font-weight="700" fill="#ffffff" fill-opacity="0.92" text-anchor="middle" dominant-baseline="middle">' +
    esc(ini) +
    "</text>" +
    '<text x="60" y="96" font-family="Segoe UI, Arial, sans-serif" font-size="16" fill="#ffffff" fill-opacity="0.85" text-anchor="middle">' +
    esc(glyph) +
    "</text>" +
    "</svg>";
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}

function hashStr(str) {
  let h = 0;
  const s = String(str || "");
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h |= 0;
  }
  return h;
}
