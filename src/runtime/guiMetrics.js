import { resolveFontFaceFont } from "./guiFonts.js";

export const NOMINAL_W = 1280;
export const NOMINAL_H = 720;
const PPS_FALLBACK = 50;
const MAX_TEXT_SIZE = 100;


export const GUI_FONT_STACK = "system-ui, sans-serif";


const FONT_SANS = `"Source Sans 3", "Source Sans Pro", "Segoe UI", ${GUI_FONT_STACK}`;
const FONT_GOTHAM = `Gotham, Montserrat, Futura, "Segoe UI", ${GUI_FONT_STACK}`;
const F = (family, weight = 400, style = "normal", variant = "normal") =>
  Object.freeze({ family, weight, style, variant });
const GUI_FONT_MAP = Object.freeze({
  Legacy: F(`Arial, Arimo, Helvetica, ${GUI_FONT_STACK}`),
  Arial: F(`Arial, Arimo, Helvetica, ${GUI_FONT_STACK}`),
  ArialBold: F(`Arial, Arimo, Helvetica, ${GUI_FONT_STACK}`, 700),
  SourceSans: F(FONT_SANS),
  SourceSansBold: F(FONT_SANS, 700),
  SourceSansItalic: F(FONT_SANS, 400, "italic"),
  SourceSansSemibold: F(FONT_SANS, 600),
  SourceSansLight: F(FONT_SANS, 300),
  SourceSansSmallcaps: F(FONT_SANS, 400, "normal", "small-caps"),
  Roboto: F(`Roboto, "Segoe UI", ${GUI_FONT_STACK}`),
  RobotoBold: F(`Roboto, "Segoe UI", ${GUI_FONT_STACK}`, 700),
  RobotoLight: F(`Roboto, "Segoe UI", ${GUI_FONT_STACK}`, 300),
  RobotoMono: F(`"Roboto Mono", Consolas, Menlo, "Courier New", monospace`),
  GothamBlack: F(FONT_GOTHAM, 900),
  GothamBold: F(FONT_GOTHAM, 700),
  GothamMedium: F(FONT_GOTHAM, 500),
  GothamLight: F(FONT_GOTHAM, 300),
  TitilliumWeb: F(`"Titillium Web", ${FONT_SANS}`),
  Oswald: F(`Oswald, "Arial Narrow", ${GUI_FONT_STACK}`, 500),
  Nunito: F(`Nunito, "Trebuchet MS", ${GUI_FONT_STACK}`),
  Merriweather: F(`Merriweather, Georgia, "Times New Roman", serif`),
  Ubuntu: F(`Ubuntu, "Segoe UI", ${GUI_FONT_STACK}`),
});
const GUI_FONT_DEFAULT = GUI_FONT_MAP.SourceSans;


export function guiFontFor(inst) {


  if (inst && inst.hasProperty && inst.hasProperty("FontFace")) {
    const ff = resolveFontFaceFont(inst.getProperty("FontFace"));
    if (ff) return ff;
  }
  const name = inst && inst.hasProperty && inst.hasProperty("Font") ? String(inst.getProperty("Font")) : "";
  return GUI_FONT_MAP[name] || GUI_FONT_DEFAULT;
}


export function fontShorthandFor(font, ts) {
  const f = font || GUI_FONT_DEFAULT;
  const style = f.style && f.style !== "normal" ? f.style + " " : "";
  const variant = f.variant && f.variant !== "normal" ? f.variant + " " : "";
  const weight = f.weight && f.weight !== 400 ? f.weight + " " : "";
  return `${style}${variant}${weight}${ts}px ${f.family}`;
}


export const GUI_TOPBAR_INSET_Y = 44;


export function screenGuiRootRect(gui) {
  const live = liveGuiViewportSize();
  const base = live
    ? { x: 0, y: 0, w: Math.max(1, num(live.w, NOMINAL_W)), h: Math.max(1, num(live.h, NOMINAL_H)) }
    : { x: 0, y: 0, w: NOMINAL_W, h: NOMINAL_H };
  const ignore = !!(gui && gui.hasProperty && gui.hasProperty("IgnoreGuiInset") && gui.getProperty("IgnoreGuiInset") === true);
  if (ignore) return base;
  const inset = Math.min(GUI_TOPBAR_INSET_Y, base.h - 1);
  return { x: 0, y: inset, w: base.w, h: base.h - inset };
}





let liveViewport = null;

export function setLiveGuiViewport(provider) {
  liveViewport = typeof provider === "function" ? provider : null;
}

export function liveGuiViewportSize() {
  if (!liveViewport) return null;
  try {
    const v = liveViewport();
    const w = Number(v && v.w);
    const h = Number(v && v.h);
    if (Number.isFinite(w) && w >= 1 && Number.isFinite(h) && h >= 1) return { w, h };
  } catch {

  }
  return null;
}

function rootScreenRect() {
  const live = liveGuiViewportSize();
  return live ? { x: 0, y: 0, w: live.w, h: live.h } : { x: 0, y: 0, w: NOMINAL_W, h: NOMINAL_H };
}

const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

function isGuiObject(inst) {
  return !!(inst && inst.hasProperty && inst.hasProperty("Size") && inst.hasProperty("Position"));
}

function visible(inst) {
  return !(inst.hasProperty && inst.hasProperty("Visible") && inst.getProperty("Visible") === false);
}

function getParentSafe(inst) {
  try {
    return inst && inst.getParent ? inst.getParent() : null;
  } catch {
    return null;
  }
}

function resolveUDim(u, basis) {
  if (!u) return 0;
  const scale = num(u.scale != null ? u.scale : u.Scale, 0);
  const offset = num(u.offset != null ? u.offset : u.Offset, 0);
  return basis * scale + offset;
}

function resolveUDim2(u, w, h) {
  if (!u) return { x: 0, y: 0 };
  return {
    x: w * num(u.xScale, 0) + num(u.xOffset, 0),
    y: h * num(u.yScale, 0) + num(u.yOffset, 0),
  };
}


export function rectFor(inst, parentRect) {
  const size = inst.getProperty("Size") || { xScale: 0, xOffset: 100, yScale: 0, yOffset: 50 };
  const pos = inst.getProperty("Position") || { xScale: 0, xOffset: 0, yScale: 0, yOffset: 0 };
  const anchor = inst.getProperty("AnchorPoint") || { x: 0, y: 0 };
  const w = parentRect.w * num(size.xScale) + num(size.xOffset);
  const h = parentRect.h * num(size.yScale) + num(size.yOffset);
  const x = parentRect.x + parentRect.w * num(pos.xScale) + num(pos.xOffset) - num(anchor.x) * w;
  const y = parentRect.y + parentRect.h * num(pos.yScale) + num(pos.yOffset) - num(anchor.y) * h;
  return { x, y, w, h };
}


const FACE_DIMS = {
  Front: ["x", "y"], Back: ["x", "y"],
  Left: ["z", "y"], Right: ["z", "y"],
  Top: ["x", "z"], Bottom: ["x", "z"],
};

function surfaceCanvasDims(gui) {
  const cs = gui.getProperty("CanvasSize") || { x: 800, y: 600 };
  const mode = String(gui.hasProperty("SizingMode") ? gui.getProperty("SizingMode") : "FixedSize");
  if (mode === "PixelsPerStud") {
    const pps = Math.max(1, num(gui.getProperty("PixelsPerStud"), PPS_FALLBACK));
    const ad = gui.hasProperty("Adornee") ? gui.getProperty("Adornee") : null;
    const part = ad && ad.getProperty ? ad : getParentSafe(gui);
    const size = part && part.getProperty ? part.getProperty("Size") : null;
    if (size && Number.isFinite(Number(size.x))) {
      const dims = FACE_DIMS[String(gui.getProperty("Face") || "Front")] || FACE_DIMS.Front;
      const fw = Math.max(0.05, Math.abs(num(size[dims[0]], 1)));
      const fh = Math.max(0.05, Math.abs(num(size[dims[1]], 1)));
      return { w: Math.max(1, fw * pps), h: Math.max(1, fh * pps) };
    }
  }
  return { w: Math.max(1, num(cs.x, 800)), h: Math.max(1, num(cs.y, 600)) };
}


export function computeGuiRect(inst) {
  if (!isGuiObject(inst)) return null;
  const chain = [];
  let cur = inst;
  let root = null;
  let guard = 0;
  while (cur && guard++ < 64) {
    if (isGuiObject(cur)) {
      chain.push(cur);
      cur = getParentSafe(cur);
      continue;
    }
    root = cur;
    break;
  }

  let rect = root && root.className === "ScreenGui" ? screenGuiRootRect(root) : rootScreenRect();
  if (root && root.className === "SurfaceGui") {
    const d = surfaceCanvasDims(root);
    rect = { x: 0, y: 0, w: d.w, h: d.h };
  } else if (root && root.className === "BillboardGui") {
    const s = root.getProperty("Size") || {};
    rect = {
      x: 0, y: 0,
      w: Math.max(1, num(s.xScale) * PPS_FALLBACK + num(s.xOffset)),
      h: Math.max(1, num(s.yScale) * PPS_FALLBACK + num(s.yOffset)),
    };
  }
  for (let i = chain.length - 1; i >= 0; i--) {
    const node = chain[i];
    rect = rectFor(node, rect);

    if (i > 0 && node.className === "ScrollingFrame") {
      const cp = node.getProperty("CanvasPosition") || { x: 0, y: 0 };
      rect = { x: rect.x - num(cp.x), y: rect.y - num(cp.y), w: rect.w, h: rect.h };
    }
  }
  return rect;
}


let measureCtx = null;
function getMeasureCtx() {
  if (measureCtx) return measureCtx;
  try {
    if (typeof document !== "undefined" && document.createElement) {
      const c = document.createElement("canvas");
      measureCtx = (c && c.getContext && c.getContext("2d")) || null;
    }
  } catch {
    measureCtx = null;
  }
  return measureCtx;
}


export function lineWidth(text, ts, font) {
  const ctx = getMeasureCtx();
  if (ctx) {
    try {
      ctx.font = fontShorthandFor(font, ts);
      const m = ctx.measureText(text);
      if (m && Number.isFinite(m.width)) return m.width;
    } catch {

    }
  }
  return text.length * ts * 0.55;
}



export function wrapLines(text, ts, maxW, font) {
  const out = [];
  for (const raw of String(text).split("\n")) {
    if (maxW <= 0 || lineWidth(raw, ts, font) <= maxW || raw === "") {
      out.push(raw);
      continue;
    }
    let line = "";
    for (const word of raw.split(" ")) {
      const probe = line ? line + " " + word : word;
      if (line && lineWidth(probe, ts, font) > maxW) {
        out.push(line);
        line = word;
      } else {
        line = probe;
      }
    }
    if (line) out.push(line);
  }
  return out.length ? out : [""];
}


export function fitTextSize(text, rectW, rectH, font) {
  const w = Math.max(0, num(rectW, 0));
  const h = Math.max(0, num(rectH, 0));
  const t = String(text == null ? "" : text);
  if (!t || w < 1 || h < 1) return 1;
  const cap = Math.max(1, Math.min(MAX_TEXT_SIZE, Math.floor(h)));
  const fits = (ts) => {
    const lines = wrapLines(t, ts, w, font);
    if (lines.length * ts > h) return false;
    for (const l of lines) {
      if (lineWidth(l, ts, font) > w) return false;
    }
    return true;
  };
  let lo = 1;
  let hi = cap;
  let best = 1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (fits(mid)) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best;
}


export function layoutTextFor(inst, rect) {
  const text = String(inst.hasProperty("Text") && inst.getProperty("Text") != null ? inst.getProperty("Text") : "");
  const scaled = inst.hasProperty("TextScaled") && inst.getProperty("TextScaled") === true;
  const wrapped = scaled || (inst.hasProperty("TextWrapped") && inst.getProperty("TextWrapped") === true);

  const font = guiFontFor(inst);
  const ts = scaled
    ? fitTextSize(text, rect.w, rect.h, font)
    : Math.max(1, Math.min(MAX_TEXT_SIZE, num(inst.hasProperty("TextSize") ? inst.getProperty("TextSize") : 14, 14)));
  const lines = !text
    ? [""]
    : wrapped && rect.w > 0
      ? wrapLines(text, ts, rect.w, font)
      : String(text).split("\n");
  return { text, ts, lines, wrapped, scaled, font };
}


export function measureTextBounds(inst) {
  const rect = computeGuiRect(inst) || { x: 0, y: 0, w: 0, h: 0 };
  const t = layoutTextFor(inst, rect);
  if (!t.text) return { x: 0, y: 0 };
  let w = 0;
  for (const l of t.lines) w = Math.max(w, lineWidth(l, t.ts, t.font));
  return { x: Math.ceil(Math.max(0, w)), y: Math.ceil(Math.max(t.ts, t.lines.length * t.ts)) };
}


function layoutSiblings(layout) {
  const parent = getParentSafe(layout);
  if (!parent || !parent.getChildren) return { parent: null, items: [] };
  const items = [];
  for (const c of parent.getChildren()) {
    if (isGuiObject(c) && visible(c)) items.push(c);
  }
  return { parent, items };
}

function parentContentRect(parent) {
  if (isGuiObject(parent)) {
    const r = computeGuiRect(parent);
    if (r) return r;
  }
  if (parent && parent.className === "ScreenGui") return screenGuiRootRect(parent);
  if (parent && parent.className === "SurfaceGui") {
    const d = surfaceCanvasDims(parent);
    return { x: 0, y: 0, w: d.w, h: d.h };
  }
  return rootScreenRect();
}


export function layoutAbsoluteContentSize(layout) {
  const cls = layout.className;
  const { parent, items } = layoutSiblings(layout);
  if (!parent || items.length === 0) return { x: 0, y: 0 };
  const rect = parentContentRect(parent);
  const horizontal = String(layout.hasProperty("FillDirection") ? layout.getProperty("FillDirection") : (cls === "UIGridLayout" ? "Horizontal" : "Vertical")) === "Horizontal";
  if (cls === "UIGridLayout") {
    const cell = resolveUDim2(layout.getProperty("CellSize") || { xOffset: 100, yOffset: 100 }, rect.w, rect.h);
    const pad = resolveUDim2(layout.getProperty("CellPadding") || {}, rect.w, rect.h);
    const cw = Math.max(1, cell.x);
    const ch = Math.max(1, cell.y);
    const px = Math.max(0, pad.x);
    const py = Math.max(0, pad.y);
    const maxCells = Math.max(0, Math.floor(num(layout.hasProperty("FillDirectionMaxCells") ? layout.getProperty("FillDirectionMaxCells") : 0, 0)));
    const avail = horizontal ? rect.w : rect.h;
    const cellSpan = horizontal ? cw + px : ch + py;
    let perLine = Math.max(1, Math.floor((avail + (horizontal ? px : py)) / Math.max(1, cellSpan)));
    if (maxCells > 0) perLine = Math.min(perLine, maxCells);
    perLine = Math.min(perLine, items.length);
    const lines = Math.ceil(items.length / perLine);
    const mainSpan = perLine * (horizontal ? cw : ch) + (perLine - 1) * (horizontal ? px : py);
    const crossSpan = lines * (horizontal ? ch : cw) + (lines - 1) * (horizontal ? py : px);
    return horizontal
      ? { x: Math.ceil(mainSpan), y: Math.ceil(crossSpan) }
      : { x: Math.ceil(crossSpan), y: Math.ceil(mainSpan) };
  }

  const padding = resolveUDim(layout.hasProperty("Padding") ? layout.getProperty("Padding") : null, horizontal ? rect.w : rect.h);
  let main = 0;
  let cross = 0;
  for (const item of items) {
    const s = resolveUDim2(item.getProperty("Size") || {}, rect.w, rect.h);
    const iw = Math.max(0, s.x);
    const ih = Math.max(0, s.y);
    main += horizontal ? iw : ih;
    cross = Math.max(cross, horizontal ? ih : iw);
  }
  main += Math.max(0, padding) * Math.max(0, items.length - 1);
  return horizontal
    ? { x: Math.ceil(main), y: Math.ceil(cross) }
    : { x: Math.ceil(cross), y: Math.ceil(main) };
}


const CANVAS_MEASURE_MAX_NODES = 200;


function canvasSubtreeClips(c) {
  if (c.className === "ScrollingFrame") return true;
  return !!(c.hasProperty && c.hasProperty("ClipsDescendants") && c.getProperty("ClipsDescendants") === true);
}

export function absoluteCanvasSize(sf) {
  const rect = computeGuiRect(sf) || { x: 0, y: 0, w: 0, h: 0 };
  const base = resolveUDim2(sf.getProperty("CanvasSize") || {}, rect.w, rect.h);
  let w = Math.max(0, base.x);
  let h = Math.max(0, base.y);
  const auto = String(sf.hasProperty("AutomaticCanvasSize") ? sf.getProperty("AutomaticCanvasSize") : "None");
  if (auto === "X" || auto === "Y" || auto === "XY") {
    const viewport = { x: 0, y: 0, w: rect.w, h: rect.h };
    let maxX = 0;
    let maxY = 0;
    let budget = CANVAS_MEASURE_MAX_NODES;
    const walk = (container, contRect) => {
      for (const c of container.getChildren ? container.getChildren() : []) {
        if (budget <= 0) return;
        if (!isGuiObject(c) || !visible(c)) continue;
        budget -= 1;
        const r = rectFor(c, contRect);
        maxX = Math.max(maxX, r.x + r.w);
        maxY = Math.max(maxY, r.y + r.h);
        if (!canvasSubtreeClips(c)) walk(c, r);
      }
    };
    walk(sf, viewport);
    if (auto === "X" || auto === "XY") w = Math.max(w, maxX);
    if (auto === "Y" || auto === "XY") h = Math.max(h, maxY);
  }
  return { x: Math.ceil(w), y: Math.ceil(h) };
}
