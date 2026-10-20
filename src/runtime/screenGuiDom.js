import { bus } from "../core/eventBus.js";
import { Events } from "../datamodel/instance.js";

import { registerFrameCallback } from "../core/frameDriver.js";
import {
  MAX_GUIS,
  MAX_CHILDREN,
  isGuiObject,
  guiVisible,
  isButton,
  colorCss,
  computeRect,
  sortByZIndex,
  layoutOverrides,
  findStroke,
  effectiveButtonImage,
  num,
  clamp01,
} from "../viewport/worldGuiCore.js";
import {
  GUI_FONT_STACK,
  GUI_TOPBAR_INSET_Y,
  fontShorthandFor,
  layoutTextFor,
  setLiveGuiViewport,
} from "./guiMetrics.js";


import { extractAssetId, buildEndpoints } from "../audio/audioCdn.js";
import { filterAllowedProxyPrefixesOrUndefined } from "./cdnProxyPolicy.js";

import { assetStore } from "../assets/assetStore.js";


import { guiFontLoader } from "./guiFonts.js";
import { decalImageResolver, rbxassetDataUri } from "./guiImageAssets.js";

export const SCREENGUI_LAYER_CLASS = "rsw-screengui-layer";
const MAX_TEXT_CHARS = 4000;                                             


export function collectScreenGuis(playerGui) {
  if (!playerGui || !playerGui.getChildren) return [];
  const out = [];
  for (const c of playerGui.getChildren()) {
    if (!c || c.className !== "ScreenGui") continue;
    if (c.hasProperty && c.hasProperty("Enabled") && c.getProperty("Enabled") === false) continue;
    out.push(c);
    if (out.length >= MAX_GUIS) break;
  }
  const dOf = (g) => (g.hasProperty && g.hasProperty("DisplayOrder") ? num(g.getProperty("DisplayOrder"), 0) : 0);
  out.sort((a, b) => dOf(a) - dOf(b));
  return out;
}


export function clipsFor(inst) {
  if (inst.className === "ScrollingFrame") return true;
  return !!(inst.hasProperty && inst.hasProperty("ClipsDescendants") && inst.getProperty("ClipsDescendants") === true);
}


export function buildRenderList(gui, viewport) {
  const nodes = [];
  let count = 0;
  const visit = (inst, parentNode, parentRect, parentClip, forcedRect) => {
    if (count >= MAX_CHILDREN || !isGuiObject(inst) || !guiVisible(inst)) return;
    count += 1;
    const rect = forcedRect || computeRect(inst, parentRect);
    const node = {
      inst,
      parent: parentNode,
      rect,
      clips: clipsFor(inst),
      clip: parentClip || null,
      z: inst.hasProperty && inst.hasProperty("ZIndex") ? num(inst.getProperty("ZIndex"), 1) : 1,
      seq: nodes.length,
    };
    nodes.push(node);
    let cr = rect;
    if (inst.className === "ScrollingFrame") {
      const cp = inst.getProperty("CanvasPosition") || { x: 0, y: 0 };
      cr = { x: rect.x - num(cp.x), y: rect.y - num(cp.y), w: rect.w, h: rect.h };
    }

    const childClip = node.clips ? intersectRects(parentClip, rect) : parentClip || null;
    const over = layoutOverrides(inst, cr);
    for (const c of sortByZIndex(inst.getChildren())) visit(c, node, cr, childClip, over ? over.get(c) : undefined);
  };
  const rootRect = {
    x: num(viewport && viewport.x, 0),
    y: num(viewport && viewport.y, 0),
    w: Math.max(1, num(viewport && viewport.w, 1)),
    h: Math.max(1, num(viewport && viewport.h, 1)),
  };
  const rootOver = layoutOverrides(gui, rootRect);
  for (const c of sortByZIndex(gui.getChildren())) visit(c, null, rootRect, null, rootOver ? rootOver.get(c) : undefined);
  return nodes;
}


export function intersectRects(a, b) {
  if (!a) return b ? { x: b.x, y: b.y, w: Math.max(0, b.w), h: Math.max(0, b.h) } : null;
  if (!b) return a;
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const right = Math.min(a.x + Math.max(0, a.w), b.x + Math.max(0, b.w));
  const bottom = Math.min(a.y + Math.max(0, a.h), b.y + Math.max(0, b.h));
  return { x, y, w: Math.max(0, right - x), h: Math.max(0, bottom - y) };
}


export function zIndexBehaviorOf(gui) {
  const v = gui && gui.hasProperty && gui.hasProperty("ZIndexBehavior") ? String(gui.getProperty("ZIndexBehavior")) : "Sibling";
  return v === "Global" ? "Global" : "Sibling";
}


export function globalPaintOrder(nodes) {
  return nodes.slice().sort((a, b) => (a.z - b.z) || (a.seq - b.seq));
}


export function resolveImageUrl(image) {
  const s = String(image == null ? "" : image).trim();
  if (!s) return null;
  if (/^(https?:|data:|blob:)/i.test(s)) return s;
  if (/^(\.\/|assets\/|\/)/i.test(s) && !s.includes("..")) return s;
  return null;
}


export function imageUrlCandidates(image, opts) {
  const cfg = opts || {};
  const s = String(image == null ? "" : image).trim();
  if (!s || s.length > 2048) return [];


  if (/^rbxasset:\/\//i.test(s)) {
    const tile = typeof cfg.lookupRbxasset === "function" ? cfg.lookupRbxasset(s) : null;
    return typeof tile === "string" && tile ? [tile] : [];
  }
  const id = extractAssetId(s);
  if (id) {
    const out = [];
    const local = typeof cfg.lookupLocal === "function" ? cfg.lookupLocal(id) : null;
    if (typeof local === "string" && local) out.push(local);
    for (const url of buildEndpoints(id, cfg.proxies)) out.push(url);
    return out;
  }
  const direct = resolveImageUrl(s);
  return direct ? [direct] : [];
}


let active = false;
let o = {};
let log = console;
let layerEl = null;
let canvasEl = null;


let unregisterFrameCallback = null;

let viewportBoxDirty = true;
let lastViewportBoxCheckAtMs = 0;
let canvasResizeObserver = null;
let offs = [];
let structureDirty = true;
let dirtyGuis = new Set();                                  
let guiStates = new Map();                                       
let lastPlayerGui = null;
let vpW = 0;
let vpH = 0;
let suppressBlur = false;                                                                  
let uidSeq = 1;
const uids = new WeakMap();                                                 

function uidOf(inst) {
  let u = uids.get(inst);
  if (!u) {
    u = uidSeq++;
    uids.set(inst, u);
  }
  return u;
}

function alive(inst) {
  return !!inst && !inst._destroyed;
}


function fire(inst, type, args) {
  bus.emit("gameplay:event", { instance: inst, type, args: args || [] });
}

function inputManagerOf() {
  try {
    return typeof o.getInputManager === "function" ? o.getInputManager() : null;
  } catch {
    return null;
  }
}

function currentPlayerGui() {
  try {
    const lp = typeof o.getLocalPlayer === "function" ? o.getLocalPlayer() : null;
    return lp && lp.findFirstChild ? lp.findFirstChild("PlayerGui") : null;
  } catch {
    return null;
  }
}


function owningScreenGui(inst) {
  let cur = inst;
  let guard = 0;
  while (cur && guard++ < 64) {
    if (cur.className === "ScreenGui") return cur;
    cur = cur.getParent ? cur.getParent() : null;
  }
  return null;
}

function markDirtyFor(inst) {
  if (!inst) return;
  const gui = owningScreenGui(inst);
  if (!gui) return;

  if (inst === gui) structureDirty = true;
  dirtyGuis.add(gui);
}

function installListeners() {
  offs.push(bus.on(Events.PropertyChanged, (e) => {
    if (e && e.instance) markDirtyFor(e.instance);
  }));
  const onTree = (e) => {
    if (!e) return;
    const parent = e.parent || null;
    if (parent && parent.className === "PlayerGui") structureDirty = true;
    markDirtyFor(e.child || null);
    markDirtyFor(parent);
  };
  offs.push(bus.on(Events.ChildAdded, onTree));
  offs.push(bus.on(Events.ChildRemoved, onTree));
  offs.push(bus.on(Events.Destroying, (e) => {
    if (e && e.instance) markDirtyFor(e.instance);
  }));
  offs.push(bus.on("project:loaded", () => {
    structureDirty = true;
  }));
}


function withFocusGuard(fn) {
  const ae = typeof document !== "undefined" ? document.activeElement : null;
  const mine = ae && layerEl && layerEl.contains(ae) ? ae : null;
  suppressBlur = true;
  try {
    fn();
  } finally {
    if (mine && document.activeElement !== mine) {
      try { mine.focus({ preventScroll: true }); } catch {            }
    }
    suppressBlur = false;
  }
}


const VIEWPORT_BOX_RECHECK_INTERVAL_MS = 250;

function invalidateViewportBox() {
  viewportBoxDirty = true;
}

function syncViewportBoxIfNeeded(frameTimestampMs) {
  const timestampMs = typeof frameTimestampMs === "number" ? frameTimestampMs : 0;
  if (timestampMs - lastViewportBoxCheckAtMs >= VIEWPORT_BOX_RECHECK_INTERVAL_MS) {
    lastViewportBoxCheckAtMs = timestampMs;
    viewportBoxDirty = true;
  }
  if (!viewportBoxDirty) return;
  viewportBoxDirty = false;
  syncViewportBox();
}

function syncViewportBox() {
  if (!layerEl) return;
  let r = null;
  try {
    r = canvasEl && canvasEl.isConnected ? canvasEl.getBoundingClientRect() : null;
  } catch {
    r = null;
  }
  if (!r || r.width < 1 || r.height < 1) {
    if (layerEl.style.display !== "none") layerEl.style.display = "none";
    vpW = 0;
    vpH = 0;
    return;
  }
  const w = Math.round(r.width);
  const h = Math.round(r.height);
  if (layerEl.style.display !== "") layerEl.style.display = "";
  const s = layerEl.style;

  s.left = `${Math.round(r.left)}px`;
  s.top = `${Math.round(r.top)}px`;
  s.width = `${w}px`;
  s.height = `${h}px`;
  if (w !== vpW || h !== vpH) {
    vpW = w;
    vpH = h;
    for (const gui of guiStates.keys()) dirtyGuis.add(gui);
  }
}

function destroyGuiState(st) {
  try { st.el.remove(); } catch {            }
  st.els.clear();
  st.imgs.clear();
}

function syncStructure(pg) {
  structureDirty = false;
  const guis = pg ? collectScreenGuis(pg) : [];
  const seen = new Set(guis);
  for (const [gui, st] of guiStates) {
    if (!seen.has(gui)) {
      destroyGuiState(st);
      guiStates.delete(gui);
      dirtyGuis.delete(gui);
    }
  }
  withFocusGuard(() => {
    for (const gui of guis) {
      let st = guiStates.get(gui);
      if (!st) {
        const el = document.createElement("div");
        el.className = "rsw-screengui";
        el.dataset.name = String(gui.name || "ScreenGui");
        const s = el.style;
        s.position = "absolute";
        s.inset = "0";
        s.overflow = "hidden";
        s.pointerEvents = "none";
        st = { el, els: new Map(), imgs: new Map(), sig: "" };
        guiStates.set(gui, st);
        dirtyGuis.add(gui);
      }
      layerEl.appendChild(st.el);                                         
    }
  });
}

function findCorner(inst) {
  for (const c of inst.getChildren()) {
    if (c.className === "UICorner") return c;
  }
  return null;
}

function wireButton(inst, el) {
  el.addEventListener("click", (e) => {
    if (!active || !alive(inst)) return;
    e.stopPropagation();
    fire(inst, "MouseButton1Click");
    fire(inst, "Activated");
  });
  if (inst.className === "ImageButton") {
    const setUi = (patch) => {
      const gui = owningScreenGui(inst);
      const st = gui ? guiStates.get(gui) : null;
      if (!gui || !st) return;
      const ui = st.imgs.get(inst) || { hover: false, pressed: false };
      Object.assign(ui, patch);
      st.imgs.set(inst, ui);
      dirtyGuis.add(gui);                                         
    };
    el.addEventListener("mouseenter", () => setUi({ hover: true }));
    el.addEventListener("mouseleave", () => setUi({ hover: false, pressed: false }));
    el.addEventListener("mousedown", () => setUi({ pressed: true }));
    el.addEventListener("mouseup", () => setUi({ pressed: false }));
  }
}

function wireTextBox(inst, el) {
  let enterPressed = false;
  el.addEventListener("focus", () => {
    if (!active || !alive(inst) || suppressBlur) return;
    enterPressed = false;
    const im = inputManagerOf();
    if (im && typeof im.setFocusedTextBox === "function") im.setFocusedTextBox(inst);

    try { el.value = String(inst.getProperty("Text") == null ? "" : inst.getProperty("Text")); } catch {            }
    fire(inst, "Focused");
  });
  el.addEventListener("input", () => {
    if (!active || !alive(inst)) return;
    try { inst.setProperty("Text", String(el.value || "").slice(0, MAX_TEXT_CHARS)); } catch {            }
  });
  el.addEventListener("keydown", (e) => {
    if (!active) return;
    if (e.key === "Enter" && el.tagName === "INPUT") {
      enterPressed = true;
      e.preventDefault();
      el.blur();
    } else if (e.key === "Escape") {
      enterPressed = false;
      e.preventDefault();
      el.blur();
    }


    e.stopPropagation();
  });
  el.addEventListener("blur", () => {
    if (!active || suppressBlur || !alive(inst)) return;
    const im = inputManagerOf();
    if (im && typeof im.getFocusedTextBox === "function" && im.getFocusedTextBox() === inst) {
      im.setFocusedTextBox(null);
    }
    fire(inst, "FocusLost", [enterPressed]);
    enterPressed = false;
  });
}


function wantsMultiLine(inst) {
  return inst.hasProperty("MultiLine") && inst.getProperty("MultiLine") === true;
}

function createElementFor(inst) {
  if (inst.className === "TextBox") {
    const multi = wantsMultiLine(inst);
    const el = document.createElement(multi ? "textarea" : "input");
    if (!multi) el.type = "text";
    el.style.resize = "none";
    wireTextBox(inst, el);
    return el;
  }
  const el = document.createElement("div");
  if (isButton(inst)) wireButton(inst, el);
  return el;
}


function remakeTextBoxEl(inst, oldEl, st) {
  const hadFocus = typeof document !== "undefined" && document.activeElement === oldEl;
  const value = String(oldEl.value == null ? "" : oldEl.value);
  suppressBlur = true;
  try {
    const el = createElementFor(inst);
    el.value = value;
    try { oldEl.remove(); } catch {            }
    st.els.set(inst, el);
    if (hadFocus) {
      st.el.appendChild(el);                                                 
      try { el.focus({ preventScroll: true }); } catch {            }
      try { el.setSelectionRange(value.length, value.length); } catch {            }
    }
    return el;
  } finally {
    suppressBlur = false;
  }
}

function styleText(inst, node, el) {
  const t = layoutTextFor(inst, node.rect);
  const tt = clamp01(inst.hasProperty("TextTransparency") ? inst.getProperty("TextTransparency") : 0, 0);
  const xa = String(inst.hasProperty("TextXAlignment") ? inst.getProperty("TextXAlignment") : "Center");
  const ya = String(inst.hasProperty("TextYAlignment") ? inst.getProperty("TextYAlignment") : "Center");
  const s = el.style;


  guiFontLoader.ensureFont(t.font);
  s.font = fontShorthandFor(t.font, t.ts);
  s.lineHeight = `${t.ts}px`;
  s.color = tt >= 1 ? "transparent" : colorCss(inst.hasProperty("TextColor3") ? inst.getProperty("TextColor3") : { r: 0, g: 0, b: 0 }, tt);
  const strokeT = clamp01(inst.hasProperty("TextStrokeTransparency") ? inst.getProperty("TextStrokeTransparency") : 1, 1);
  if (strokeT < 1 && tt < 1) {
    const sc = inst.hasProperty("TextStrokeColor3") ? inst.getProperty("TextStrokeColor3") : { r: 0, g: 0, b: 0 };
    s.webkitTextStroke = `${Math.max(1, t.ts / 12).toFixed(1)}px ${colorCss(sc, strokeT)}`;
    s.paintOrder = "stroke fill";
  } else {
    s.webkitTextStroke = "";
    s.paintOrder = "";
  }
  if (el.tagName === "INPUT" || el.tagName === "TEXTAREA") {
    el.readOnly = inst.hasProperty("TextEditable") && inst.getProperty("TextEditable") === false;
    el.placeholder = String(inst.hasProperty("PlaceholderText") ? inst.getProperty("PlaceholderText") || "" : "").slice(0, 200);
    s.textAlign = xa === "Left" ? "left" : xa === "Right" ? "right" : "center";
    s.border = "none";
    s.padding = "0";
    if (document.activeElement !== el) {
      const cur = String(inst.getProperty("Text") == null ? "" : inst.getProperty("Text")).slice(0, MAX_TEXT_CHARS);
      if (el.value !== cur) el.value = cur;
    }
    return;
  }
  s.display = "flex";
  s.flexDirection = "row";
  s.alignItems = ya === "Top" ? "flex-start" : ya === "Bottom" ? "flex-end" : "center";
  s.justifyContent = xa === "Left" ? "flex-start" : xa === "Right" ? "flex-end" : "center";
  let span = el.__rswText;
  if (!span) {
    span = document.createElement("span");
    span.style.whiteSpace = "pre";
    span.style.pointerEvents = "none";
    el.__rswText = span;
    el.insertBefore(span, el.firstChild || null);
  }
  span.style.textAlign = xa === "Left" ? "left" : xa === "Right" ? "right" : "center";


  const joined = t.lines.join("\n").slice(0, MAX_TEXT_CHARS);
  if (span.textContent !== joined) span.textContent = joined;
}


function localImageFor(id) {
  try {
    const rec = assetStore.getById("rbxassetid://" + id);
    if (!rec) return null;
    if (typeof rec.dataUri === "string" && /^data:image\//i.test(rec.dataUri)) return rec.dataUri;
    if (typeof rec.thumb === "string" && /^data:/i.test(rec.thumb)) return rec.thumb;
    return null;
  } catch {
    return null;
  }
}


function imageProxies() {
  try {
    const configured = globalThis.ROBLOX_IMAGE_CDN_PROXIES || globalThis.ROBLOX_AUDIO_CDN_PROXIES;
    return filterAllowedProxyPrefixesOrUndefined(configured);
  } catch {
    return undefined;
  }
}

function styleImage(inst, el, st) {
  const isBtn = inst.className === "ImageButton";
  const ui = st.imgs.get(inst) || { hover: false, pressed: false };
  if (isBtn) st.imgs.set(inst, ui);
  const raw = isBtn ? effectiveButtonImage(inst, ui) : String(inst.hasProperty("Image") ? inst.getProperty("Image") || "" : "");


  const cands = imageUrlCandidates(raw, { lookupLocal: localImageFor, proxies: imageProxies(), lookupRbxasset: rbxassetDataUri });
  let img = el.__rswImg;
  if (cands.length) {
    if (!img) {
      img = document.createElement("img");
      img.draggable = false;
      img.alt = "";
      const is = img.style;
      is.position = "absolute";
      is.inset = "0";
      is.width = "100%";
      is.height = "100%";
      is.pointerEvents = "none";
      img.addEventListener("error", () => {
        const list = img.__rswCands || [];
        const next = (img.__rswIdx || 0) + 1;
        if (next < list.length) {
          img.__rswIdx = next;
          img.setAttribute("src", list[next]);
          return;
        }
        img.style.visibility = "hidden";                                                    


        const key = img.__rswKey;
        const id = extractAssetId(String(key == null ? "" : key));
        if (!id || img.__rswDecalHop) return;
        img.__rswDecalHop = true;
        decalImageResolver().resolve(id).then((imageId) => {
          if (!active || !imageId || img.__rswKey !== key || !img.isConnected) return;
          const hop = imageUrlCandidates(`rbxassetid://${imageId}`, { lookupLocal: localImageFor, proxies: imageProxies() });
          if (!hop.length) return;
          img.__rswCands = hop;
          img.__rswIdx = 0;
          img.style.visibility = "";
          img.setAttribute("src", hop[0]);
        }).catch(() => {                                         });
      });
      img.addEventListener("load", () => {
        img.style.visibility = "";
      });
      el.__rswImg = img;
      el.insertBefore(img, el.firstChild || null);
    }

    if (img.__rswKey !== raw) {
      img.__rswKey = raw;
      img.__rswCands = cands;
      img.__rswIdx = 0;
      img.__rswDecalHop = false;                                             
      img.style.visibility = "";
      img.setAttribute("src", cands[0]);
    }
    const scale = String(inst.hasProperty("ScaleType") ? inst.getProperty("ScaleType") : "Stretch");
    img.style.objectFit = scale === "Fit" ? "contain" : scale === "Crop" ? "cover" : "fill";
    const it = clamp01(inst.hasProperty("ImageTransparency") ? inst.getProperty("ImageTransparency") : 0, 0);
    img.style.opacity = String(1 - it);
  } else if (img) {
    try { img.remove(); } catch {            }
    el.__rswImg = null;
  }
}

function styleNode(node, el, st, flat) {
  const inst = node.inst;
  const r = node.rect;

  const px = !flat && node.parent ? node.parent.rect.x : 0;
  const py = !flat && node.parent ? node.parent.rect.y : 0;
  const s = el.style;
  s.position = "absolute";
  s.left = `${(r.x - px).toFixed(1)}px`;
  s.top = `${(r.y - py).toFixed(1)}px`;
  s.width = `${Math.max(0, r.w).toFixed(1)}px`;
  s.height = `${Math.max(0, r.h).toFixed(1)}px`;
  s.boxSizing = "border-box";
  s.margin = "0";
  s.overflow = !flat && node.clips ? "hidden" : "visible";


  if (flat && node.clip) {
    const cl = node.clip;
    const top = Math.max(0, cl.y - r.y);
    const left = Math.max(0, cl.x - r.x);
    const right = Math.max(0, r.x + Math.max(0, r.w) - (cl.x + cl.w));
    const bottom = Math.max(0, r.y + Math.max(0, r.h) - (cl.y + cl.h));
    s.clipPath = top || left || right || bottom
      ? `inset(${top.toFixed(1)}px ${right.toFixed(1)}px ${bottom.toFixed(1)}px ${left.toFixed(1)}px)`
      : "";
  } else if (s.clipPath) {
    s.clipPath = "";
  }
  const hasBg = inst.hasProperty("BackgroundColor3");
  const bt = hasBg ? clamp01(inst.hasProperty("BackgroundTransparency") ? inst.getProperty("BackgroundTransparency") : 0, 0) : 1;
  s.background = hasBg && bt < 1 ? colorCss(inst.getProperty("BackgroundColor3"), bt) : "transparent";
  const stroke = findStroke(inst);
  if (stroke) {
    const sTrans = clamp01(stroke.hasProperty("Transparency") ? stroke.getProperty("Transparency") : 0, 0);
    const th = Math.max(1, num(stroke.hasProperty("Thickness") ? stroke.getProperty("Thickness") : 1, 1));
    s.outline = sTrans < 1 ? `${th}px solid ${colorCss(stroke.hasProperty("Color") ? stroke.getProperty("Color") : { r: 0, g: 0, b: 0 }, sTrans)}` : "none";
    s.outlineOffset = sTrans < 1 ? `${-Math.ceil(th / 2)}px` : "";
  } else {
    s.outline = "none";
    s.outlineOffset = "";
  }
  const corner = findCorner(inst);
  if (corner) {
    const cu = corner.getProperty("CornerRadius") || {};
    const base = Math.min(Math.max(0, r.w), Math.max(0, r.h));
    const rad = Math.max(0, base * num(cu.scale, 0) + num(cu.offset, 0));
    s.borderRadius = rad > 0 ? `${rad.toFixed(1)}px` : "0";
  } else {
    s.borderRadius = "0";
  }
  const interactive = isButton(inst) || inst.className === "TextBox" ||
    (inst.hasProperty("Active") && inst.getProperty("Active") === true);
  s.pointerEvents = interactive ? "auto" : "none";
  s.cursor = isButton(inst) ? "pointer" : "";
  if (inst.hasProperty("Text")) styleText(inst, node, el);
  if (inst.className === "ImageLabel" || inst.className === "ImageButton") styleImage(inst, el, st);
}

function renderGui(gui, st) {


  const ignore = gui.hasProperty && gui.hasProperty("IgnoreGuiInset") && gui.getProperty("IgnoreGuiInset") === true;
  const insetY = ignore ? 0 : Math.min(GUI_TOPBAR_INSET_Y, Math.max(0, vpH - 1));
  const nodes = buildRenderList(gui, { x: 0, y: insetY, w: vpW, h: Math.max(1, vpH - insetY) });

  const flat = zIndexBehaviorOf(gui) === "Global";
  const ordered = flat ? globalPaintOrder(nodes) : nodes;
  const seen = new Set();
  const order = [];
  for (const node of ordered) {
    seen.add(node.inst);
    order.push(uidOf(node.inst));
    let el = st.els.get(node.inst);
    if (!el) {
      el = createElementFor(node.inst);
      st.els.set(node.inst, el);
    } else if (node.inst.className === "TextBox") {

      const wantTag = wantsMultiLine(node.inst) ? "TEXTAREA" : "INPUT";
      if (el.tagName !== wantTag) {
        el = remakeTextBoxEl(node.inst, el, st);
        st.sig = "";                                                       
      }
    }
    styleNode(node, el, st, flat);
  }
  for (const [inst, el] of st.els) {
    if (!seen.has(inst)) {
      try { el.remove(); } catch {            }
      st.els.delete(inst);
      st.imgs.delete(inst);
    }
  }


  const sig = (flat ? "G|" : "S|") + order.join(",");
  if (sig !== st.sig) {
    st.sig = sig;
    withFocusGuard(() => {
      for (const node of ordered) {
        const el = st.els.get(node.inst);
        const parentEl = !flat && node.parent ? st.els.get(node.parent.inst) : st.el;
        if (el && parentEl) parentEl.appendChild(el);
      }
    });
  }
}

function frame(frameTimestampMs) {
  if (!active) return;
  syncViewportBoxIfNeeded(frameTimestampMs);
  const pg = currentPlayerGui();
  if (pg !== lastPlayerGui) {
    lastPlayerGui = pg;
    structureDirty = true;
  }
  if (structureDirty) syncStructure(pg);
  if (vpW >= 1 && vpH >= 1 && dirtyGuis.size) {
    for (const gui of dirtyGuis) {
      const st = guiStates.get(gui);
      if (st && alive(gui)) renderGui(gui, st);
    }
    dirtyGuis.clear();
  }
}


export const screenGuiDom = {
  start(options) {
    if (active) this.stop();
    if (typeof document === "undefined") return;                                
    o = options || {};
    log = o.logger || console;
    active = true;
    canvasEl = document.querySelector(".rsw-viewport__canvas");
    layerEl = document.createElement("div");
    layerEl.className = SCREENGUI_LAYER_CLASS;
    const s = layerEl.style;
    s.position = "fixed";
    s.left = "0";
    s.top = "0";
    s.width = "0";
    s.height = "0";
    s.overflow = "hidden";
    s.zIndex = "5";                                                                
    s.pointerEvents = "none";
    s.fontFamily = GUI_FONT_STACK;
    document.body.appendChild(layerEl);
    if (!canvasEl) {
      try { log.warn("screenGuiDom: canvas do viewport nao encontrado; camada ficara oculta.", { source: "Playtest" }); } catch {            }
    }


    setTimeout(() => {
      try {
        if (!active || !canvasEl) return;
        const tb = document.querySelector(".rsw-cg__topbar");
        if (!tb) return;
        const tr = tb.getBoundingClientRect();
        const cr = canvasEl.getBoundingClientRect();
        if (tr.height < 1 || cr.height < 1) return;
        const real = Math.round(tr.bottom - cr.top);
        if (Math.abs(real - GUI_TOPBAR_INSET_Y) > 2) {
          log.warn(`screenGuiDom: inset real da topbar (${real}px) difere de GUI_TOPBAR_INSET_Y (${GUI_TOPBAR_INSET_Y}px) — atualize a constante em guiMetrics.js.`, { source: "Playtest" });
        }
      } catch {            }
    }, 1000);
    guiStates = new Map();
    dirtyGuis = new Set();
    structureDirty = true;
    lastPlayerGui = null;
    vpW = 0;
    vpH = 0;

    setLiveGuiViewport(() => (vpW >= 1 && vpH >= 1 ? { w: vpW, h: vpH } : null));
    installListeners();


    guiFontLoader.start();
    offs.push(guiFontLoader.onChanged(() => {
      for (const gui of guiStates.keys()) dirtyGuis.add(gui);
    }));

    viewportBoxDirty = true;
    lastViewportBoxCheckAtMs = 0;
    if (canvasEl && typeof ResizeObserver === "function") {
      canvasResizeObserver = new ResizeObserver(invalidateViewportBox);
      canvasResizeObserver.observe(canvasEl);
    }
    if (typeof window !== "undefined" && window.addEventListener) {
      window.addEventListener("resize", invalidateViewportBox);
      window.addEventListener("scroll", invalidateViewportBox, true);
      offs.push(() => {
        window.removeEventListener("resize", invalidateViewportBox);
        window.removeEventListener("scroll", invalidateViewportBox, true);
      });
    }
    unregisterFrameCallback = registerFrameCallback("overlay", frame, "screenGuiDom:layer");
  },

  stop() {
    if (!active && !layerEl) return;
    active = false;
    if (typeof unregisterFrameCallback === "function") unregisterFrameCallback();
    unregisterFrameCallback = null;
    if (canvasResizeObserver) {
      try { canvasResizeObserver.disconnect(); } catch {            }
      canvasResizeObserver = null;
    }
    viewportBoxDirty = true;
    setLiveGuiViewport(null);
    for (const off of offs) {
      try { off(); } catch {            }
    }
    offs = [];
    try {
      const ae = typeof document !== "undefined" ? document.activeElement : null;
      if (ae && layerEl && layerEl.contains(ae)) {
        suppressBlur = true;
        try { ae.blur(); } catch {            }
        suppressBlur = false;
      }
    } catch {            }
    if (layerEl) { try { layerEl.remove(); } catch {            } }
    layerEl = null;
    canvasEl = null;
    guiStates = new Map();
    dirtyGuis = new Set();
    structureDirty = true;
    lastPlayerGui = null;
    vpW = 0;
    vpH = 0;
    o = {};
    log = console;
  },

  isActive: () => active,
  getViewportSize: () => (vpW >= 1 && vpH >= 1 ? { w: vpW, h: vpH } : null),
};
