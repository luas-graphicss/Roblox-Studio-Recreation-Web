export const MAX_GUIS = 100;
export const MAX_CHILDREN = 50;
export const MAX_CANVAS = 1024;
export const MIN_CANVAS = 16;

const CANVAS_LADDER = [16, 32, 64, 96, 128, 192, 256, 384, 512, 768, 1024];

export const clamp01 = (v, fb) => {
  const n = Number(v);
  if (!Number.isFinite(n)) return fb;
  return n < 0 ? 0 : n > 1 ? 1 : n;
};

export const num = (v, d = 0) => (Number.isFinite(Number(v)) ? Number(v) : d);

export function isGuiObject(inst) {
  return !!(inst && inst.hasProperty && inst.hasProperty("Size") && inst.hasProperty("Position"));
}

export function guiVisible(inst) {
  return !(inst.hasProperty("Visible") && inst.getProperty("Visible") === false);
}

export function isButton(inst) {
  return inst.className === "TextButton" || inst.className === "ImageButton";
}

export function colorCss(c, transparency) {
  const r = Math.round(clamp01(c && c.r, 1) * 255);
  const g = Math.round(clamp01(c && c.g, 1) * 255);
  const b = Math.round(clamp01(c && c.b, 1) * 255);
  return `rgba(${r}, ${g}, ${b}, ${1 - clamp01(transparency, 0)})`;
}

export function computeRect(inst, parentRect) {
  const size = inst.getProperty("Size") || { xScale: 0, xOffset: 100, yScale: 0, yOffset: 50 };
  const pos = inst.getProperty("Position") || { xScale: 0, xOffset: 0, yScale: 0, yOffset: 0 };
  const anchor = inst.getProperty("AnchorPoint") || { x: 0, y: 0 };
  const w = parentRect.w * (size.xScale || 0) + (size.xOffset || 0);
  const h = parentRect.h * (size.yScale || 0) + (size.yOffset || 0);
  const x = parentRect.x + parentRect.w * (pos.xScale || 0) + (pos.xOffset || 0) - (anchor.x || 0) * w;
  const y = parentRect.y + parentRect.h * (pos.yScale || 0) + (pos.yOffset || 0) - (anchor.y || 0) * h;
  return { x, y, w, h };
}

export function contentKey(gui) {
  const parts = [];
  const visit = (inst, depth) => {
    if (parts.length >= MAX_CHILDREN * 8 || depth > 6) return;
    if (isGuiObject(inst)) {
      const size = inst.getProperty("Size") || {};
      const pos = inst.getProperty("Position") || {};
      const bg = inst.hasProperty("BackgroundColor3") ? inst.getProperty("BackgroundColor3") : null;
      parts.push(
        inst.className, inst.name,
        size.xScale, size.xOffset, size.yScale, size.yOffset,
        pos.xScale, pos.xOffset, pos.yScale, pos.yOffset,
        bg ? `${bg.r},${bg.g},${bg.b}` : "",
        inst.hasProperty("BackgroundTransparency") ? inst.getProperty("BackgroundTransparency") : "",
        inst.hasProperty("Text") ? String(inst.getProperty("Text")).slice(0, 200) : "",
        inst.hasProperty("TextColor3") ? JSON.stringify(inst.getProperty("TextColor3")) : "",
        inst.hasProperty("TextSize") ? inst.getProperty("TextSize") : "",

        inst.hasProperty("TextScaled") && inst.getProperty("TextScaled") === true ? 1 : 0,
        inst.hasProperty("TextTransparency") ? inst.getProperty("TextTransparency") : "",
        inst.hasProperty("TextStrokeTransparency") ? inst.getProperty("TextStrokeTransparency") : "",
        inst.hasProperty("TextStrokeColor3") ? JSON.stringify(inst.getProperty("TextStrokeColor3")) : "",
        inst.hasProperty("CanvasPosition") ? JSON.stringify(inst.getProperty("CanvasPosition")) : "",
        inst.hasProperty("ZIndex") ? num(inst.getProperty("ZIndex"), 1) : "",

        inst.hasProperty("HoverImage") ? String(inst.getProperty("HoverImage")) : "",
        inst.hasProperty("PressedImage") ? String(inst.getProperty("PressedImage")) : "",
        inst.hasProperty("LayoutOrder") ? num(inst.getProperty("LayoutOrder"), 0) : "",
        guiVisible(inst) ? 1 : 0,
      );
    } else if (inst.className === "UIStroke" || inst.className === "UIListLayout" || inst.className === "UIGridLayout") {


      parts.push(
        inst.className,
        inst.hasProperty("Enabled") && inst.getProperty("Enabled") === false ? 0 : 1,
        inst.hasProperty("Color") ? JSON.stringify(inst.getProperty("Color")) : "",
        inst.hasProperty("Thickness") ? num(inst.getProperty("Thickness"), 1) : "",
        inst.hasProperty("Transparency") ? inst.getProperty("Transparency") : "",
        inst.hasProperty("LineJoinMode") ? String(inst.getProperty("LineJoinMode")) : "",
        inst.hasProperty("FillDirection") ? String(inst.getProperty("FillDirection")) : "",
        inst.hasProperty("Padding") ? JSON.stringify(inst.getProperty("Padding")) : "",
        inst.hasProperty("CellSize") ? JSON.stringify(inst.getProperty("CellSize")) : "",
        inst.hasProperty("CellPadding") ? JSON.stringify(inst.getProperty("CellPadding")) : "",
        inst.hasProperty("FillDirectionMaxCells") ? num(inst.getProperty("FillDirectionMaxCells"), 0) : "",
        inst.hasProperty("StartCorner") ? String(inst.getProperty("StartCorner")) : "",
      );
    }
    for (const c of inst.getChildren()) visit(c, depth + 1);
  };
  visit(gui, 0);
  return parts.join("|");
}

export function studsPerPixel(dist, fovDeg, viewportHpx) {
  const d = Math.max(0.001, num(dist, 1));
  const fov = Math.min(160, Math.max(1, num(fovDeg, 70)));
  const h = Math.max(1, num(viewportHpx, 600));
  return (2 * d * Math.tan((fov * Math.PI) / 360)) / h;
}

export function applyCameraOffset(base, so, right, up, back, out) {
  const o = out || {};
  const x = num(so && so.x);
  const y = num(so && so.y);
  const z = num(so && so.z);
  o.x = base.x + right.x * x + up.x * y + back.x * z;
  o.y = base.y + right.y * x + up.y * y + back.y * z;
  o.z = base.z + right.z * x + up.z * y + back.z * z;
  return o;
}

export function viewDepth(pos, camPos, forward) {
  return (pos.x - camPos.x) * forward.x + (pos.y - camPos.y) * forward.y + (pos.z - camPos.z) * forward.z;
}




export const FIXED_SIZE_PPS = 50;



export const MAX_TEXT_SIZE = 100;

export function billboardWorldSize(size, dist, fovDeg, viewportHpx, fixedWorldSize) {
  const s = size || {};
  const spp = studsPerPixel(dist, fovDeg, viewportHpx);
  const per = fixedWorldSize ? 1 / FIXED_SIZE_PPS : spp;
  const w = num(s.xScale) + num(s.xOffset) * per;
  const h = num(s.yScale) + num(s.yOffset) * per;
  return { w: Math.max(0.01, w), h: Math.max(0.01, h), spp };
}



export function billboardTopLift(partSizeY, quadH, gap = 0.15) {
  return Math.abs(num(partSizeY)) / 2 + Math.max(0.01, num(quadH)) / 2 + Math.max(0, num(gap, 0.15));
}

export function pickCanvasDim(px) {
  const p = Math.max(MIN_CANVAS, Math.min(MAX_CANVAS, Math.round(num(px, MIN_CANVAS))));
  for (const step of CANVAS_LADDER) {
    if (step >= p) return step;
  }
  return MAX_CANVAS;
}

export function billboardCanvasSize(wStuds, hStuds, spp, dpr = 1) {
  const safe = Math.max(1e-6, num(spp, 1));
  const scale = Math.min(3, Math.max(0.5, num(dpr, 1) || 1));
  const pw = Math.max(1, num(wStuds) / safe);
  const ph = Math.max(1, num(hStuds) / safe);
  return { cw: pickCanvasDim(pw * scale), ch: pickCanvasDim(ph * scale), pw, ph };
}

export function shouldShowBillboard({ enabled, hasAnchor, dist, maxDistance }) {
  if (enabled === false || !hasAnchor) return false;
  const md = num(maxDistance, 0);
  if (md > 0 && num(dist, 0) > md) return false;
  return true;
}

export function lightBrightness(li) {
  return 1 - 0.35 * clamp01(li, 0);
}


const NON_DRAW_PROPS = new Set([
  "StudsOffset", "StudsOffsetWorldSpace", "MaxDistance", "AlwaysOnTop",
  "LightInfluence", "Brightness", "Enabled", "Adornee", "FixedWorldSize",
  "Active", "Face", "Archivable", "Locked",
]);

export function propAffectsDraw(prop) {
  return !NON_DRAW_PROPS.has(String(prop));
}


export function createHeatTracker({ windowMs = 700, hotAfter = 3, coolMs = 1500, maxIds = 400 } = {}) {
  const map = new Map();
  return {
    record(id, now) {
      const t = num(now, 0);
      let e = map.get(id);
      if (!e) {


        if (map.size >= maxIds) map.clear();
        e = { times: [], hotUntil: 0 };
        map.set(id, e);
      }
      e.times.push(t);
      while (e.times.length && t - e.times[0] > windowMs) e.times.shift();
      if (e.times.length > 32) e.times.splice(0, e.times.length - 32);
      const wasHot = e.hotUntil > t;
      if (e.times.length >= hotAfter) e.hotUntil = t + coolMs;
      const hot = e.hotUntil > t;
      return { hot, becameHot: hot && !wasHot, hotUntil: e.hotUntil };
    },
    isHot(id, now) {
      const e = map.get(id);
      return !!e && e.hotUntil > num(now, 0);
    },
    clear() {
      map.clear();
    },
  };
}

export function needsBillboardRedraw(prev, next) {
  if (!prev || !next) return true;
  if (prev.key !== next.key) return true;
  if (prev.cw !== next.cw || prev.ch !== next.ch) return true;
  const rw = next.pw / Math.max(1e-6, prev.pw);
  const rh = next.ph / Math.max(1e-6, prev.ph);
  return rw < 0.87 || rw > 1.15 || rh < 0.87 || rh > 1.15;
}


export function sortByZIndex(children) {
  const zOf = (c) => (c.hasProperty && c.hasProperty("ZIndex") ? num(c.getProperty("ZIndex"), 1) : 1);
  let needs = false;
  let prev = null;
  for (const c of children) {
    const z = zOf(c);
    if (prev != null && z < prev) {
      needs = true;
      break;
    }
    prev = z;
  }
  if (!needs) return children;
  return children.slice().sort((a, b) => zOf(a) - zOf(b));
}


export function lineJoinFor(mode) {
  const m = String(mode == null ? "Round" : mode);
  return m === "Bevel" ? "bevel" : m === "Miter" ? "miter" : "round";
}


export function findStroke(inst) {
  for (const c of inst.getChildren()) {
    if (c.className === "UIStroke" && !(c.hasProperty("Enabled") && c.getProperty("Enabled") === false)) return c;
  }
  return null;
}



export function effectiveButtonImage(inst, state) {
  const read = (k) => (inst && inst.hasProperty && inst.hasProperty(k) ? String(inst.getProperty(k) || "") : "");
  const s = state || {};
  if (s.pressed) {
    const p = read("PressedImage");
    if (p) return p;
  }
  if (s.pressed || s.hover) {
    const h = read("HoverImage");
    if (h) return h;
  }
  return read("Image");
}


export function stateSwapsImage(inst) {
  if (!inst || !inst.hasProperty) return false;
  const h = inst.hasProperty("HoverImage") ? String(inst.getProperty("HoverImage") || "") : "";
  const p2 = inst.hasProperty("PressedImage") ? String(inst.getProperty("PressedImage") || "") : "";
  return h !== "" || p2 !== "";
}


export const MAX_IMAGE_URL = 2048;
export function allowedImageSrc(src) {
  const s = String(src == null ? "" : src);
  if (!s || s.length > MAX_IMAGE_URL) return false;
  return /^(https?:|data:|blob:)/i.test(s);
}


export function scrollCanvasPosition(inst, dx, dy, view, canvas) {
  const cur = (inst.hasProperty("CanvasPosition") ? inst.getProperty("CanvasPosition") : null) || { x: 0, y: 0 };
  const x0 = num(cur.x);
  const y0 = num(cur.y);
  if (inst.hasProperty("ScrollingEnabled") && inst.getProperty("ScrollingEnabled") === false) {
    return { x: x0, y: y0 };
  }
  const dir = String(inst.hasProperty("ScrollingDirection") ? inst.getProperty("ScrollingDirection") : "XY") || "XY";
  const gx = dir === "Y" ? 0 : num(dx);
  const gy = dir === "X" ? 0 : num(dy);
  const maxX = Math.max(0, num(canvas && canvas.w) - num(view && view.w));
  const maxY = Math.max(0, num(canvas && canvas.h) - num(view && view.h));
  return {
    x: Math.min(maxX, Math.max(0, x0 + gx)),
    y: Math.min(maxY, Math.max(0, y0 + gy)),
  };
}


function subtreeClipsCanvas(c) {
  if (c.className === "ScrollingFrame") return true;
  return !!(c.hasProperty && c.hasProperty("ClipsDescendants") && c.getProperty("ClipsDescendants") === true);
}

export function autoCanvasContentExtent(inst, view) {
  const rect = { x: 0, y: 0, w: Math.max(0, num(view && view.w)), h: Math.max(0, num(view && view.h)) };
  const kids = typeof inst.getChildren === "function" ? inst.getChildren() : [];
  if (!kids.length) return { w: 0, h: 0 };
  let maxX = 0;
  let maxY = 0;
  let budget = MAX_CHILDREN;
  const visit = (container, contRect) => {
    if (typeof container.getChildren !== "function") return;
    const over = layoutOverrides(container, contRect);
    for (const c of sortByZIndex(container.getChildren())) {
      if (budget <= 0) return;
      if (!isGuiObject(c) || !guiVisible(c)) continue;
      budget -= 1;
      const r = (over && over.get(c)) || computeRect(c, contRect);
      maxX = Math.max(maxX, r.x + r.w);
      maxY = Math.max(maxY, r.y + r.h);
      if (!subtreeClipsCanvas(c)) visit(c, r);
    }
  };
  visit(inst, rect);
  return { w: Math.max(0, maxX), h: Math.max(0, maxY) };
}


export function resolveCanvasSize(inst, view) {
  const cs = (inst.hasProperty("CanvasSize") ? inst.getProperty("CanvasSize") : null) || {};
  let w = Math.max(0, num(view && view.w) * num(cs.xScale) + num(cs.xOffset));
  let h = Math.max(0, num(view && view.h) * num(cs.yScale) + num(cs.yOffset));
  const auto = String(inst.hasProperty("AutomaticCanvasSize") ? inst.getProperty("AutomaticCanvasSize") : "None") || "None";
  if (auto === "X" || auto === "Y" || auto === "XY") {
    const ext = autoCanvasContentExtent(inst, view);
    if (auto !== "Y") w = Math.max(w, ext.w);
    if (auto !== "X") h = Math.max(h, ext.h);
  }
  return { w, h };
}


export function wheelScrollDelta(inst, deltaX, deltaY, view, canvas) {
  const dir = String(inst.hasProperty("ScrollingDirection") ? inst.getProperty("ScrollingDirection") : "XY") || "XY";
  const dx = num(deltaX);
  const dy = num(deltaY);
  if (dx !== 0 || dy === 0) return { dx, dy };
  if (dir === "X") return { dx: dy, dy: 0 };
  if (dir === "XY" && view && canvas) {
    const courseY = num(canvas.h) - num(view.h) > 0.5;
    const courseX = num(canvas.w) - num(view.w) > 0.5;
    if (!courseY && courseX) return { dx: dy, dy: 0 };
  }
  return { dx, dy };
}


export function pickScrollTarget(frames, cx, cy, deltaX, deltaY, isAlive, wheelRemap, scale) {
  const sx = scale && Number.isFinite(scale.x) && scale.x > 0 ? scale.x : 1;
  const sy = scale && Number.isFinite(scale.y) && scale.y > 0 ? scale.y : 1;
  for (let i = frames.length - 1; i >= 0; i--) {
    const f = frames[i];
    if (!f || cx < f.x || cx > f.x + f.w || cy < f.y || cy > f.y + f.h) continue;
    if (isAlive && !isAlive(f.inst)) continue;
    const cur = (f.inst.hasProperty("CanvasPosition") ? f.inst.getProperty("CanvasPosition") : null) || { x: 0, y: 0 };
    const view = { w: f.w, h: f.h };
    const canvas = resolveCanvasSize(f.inst, view);
    const g = wheelRemap === true ? wheelScrollDelta(f.inst, deltaX, deltaY, view, canvas) : { dx: num(deltaX), dy: num(deltaY) };
    const next = scrollCanvasPosition(f.inst, g.dx * sx, g.dy * sy, view, canvas);
    if (Math.abs(next.x - num(cur.x)) > 1e-6 || Math.abs(next.y - num(cur.y)) > 1e-6) {
      return { inst: f.inst, next };
    }
  }
  return null;
}




export function layoutGridRects(layout, count, rect) {
  const n = Math.max(0, Math.floor(num(count, 0)));
  const cs = (layout.hasProperty("CellSize") ? layout.getProperty("CellSize") : null) || {};
  const cp = (layout.hasProperty("CellPadding") ? layout.getProperty("CellPadding") : null) || {};
  const cw = Math.max(1, rect.w * num(cs.xScale) + num(cs.xOffset, 100));
  const ch = Math.max(1, rect.h * num(cs.yScale) + num(cs.yOffset, 100));
  const px = Math.max(0, rect.w * num(cp.xScale) + num(cp.xOffset, 5));
  const py = Math.max(0, rect.h * num(cp.yScale) + num(cp.yOffset, 5));
  const horizontal = String(layout.hasProperty("FillDirection") ? layout.getProperty("FillDirection") : "Horizontal") !== "Vertical";
  const avail = horizontal ? rect.w : rect.h;
  const stepMain = horizontal ? cw + px : ch + py;
  const padMain = horizontal ? px : py;
  let cap = Math.max(1, Math.floor((avail + padMain) / Math.max(1, stepMain)));
  const maxCells = Math.max(0, Math.floor(num(layout.hasProperty("FillDirectionMaxCells") ? layout.getProperty("FillDirectionMaxCells") : 0, 0)));
  if (maxCells > 0) cap = Math.min(cap, maxCells);
  const corner = String(layout.hasProperty("StartCorner") ? layout.getProperty("StartCorner") : "TopLeft");
  const mirrorX = corner === "TopRight" || corner === "BottomRight";
  const mirrorY = corner === "BottomLeft" || corner === "BottomRight";
  const out = [];
  for (let i = 0; i < n; i++) {
    const main = i % cap;
    const cross = Math.floor(i / cap);
    const col = horizontal ? main : cross;
    const row = horizontal ? cross : main;
    let x = col * (cw + px);
    let y = row * (ch + py);
    if (mirrorX) x = rect.w - cw - x;
    if (mirrorY) y = rect.h - ch - y;
    out.push({ x: rect.x + x, y: rect.y + y, w: cw, h: ch });
  }
  return out;
}


export function layoutListRects(layout, sizes, rect) {
  const pd = (layout.hasProperty("Padding") ? layout.getProperty("Padding") : null) || {};
  const horizontal = String(layout.hasProperty("FillDirection") ? layout.getProperty("FillDirection") : "Vertical") === "Horizontal";
  const pad = Math.max(0, (horizontal ? rect.w : rect.h) * num(pd.scale) + num(pd.offset, 0));
  const out = [];
  let acc = 0;
  for (const s of sizes || []) {
    const w = Math.max(0, num(s && s.w));
    const h = Math.max(0, num(s && s.h));
    out.push(horizontal ? { x: rect.x + acc, y: rect.y, w, h } : { x: rect.x, y: rect.y + acc, w, h });
    acc += (horizontal ? w : h) + pad;
  }
  return out;
}


export function layoutOverrides(container, rect) {
  let layout = null;
  for (const c of container.getChildren()) {
    if ((c.className === "UIListLayout" || c.className === "UIGridLayout") && !(c.hasProperty("Enabled") && c.getProperty("Enabled") === false)) {
      layout = c;
      break;
    }
  }
  if (!layout) return null;
  const governed = [];
  for (const c of container.getChildren()) {
    if (isGuiObject(c) && guiVisible(c)) governed.push(c);
  }
  const lo = (c) => (c.hasProperty("LayoutOrder") ? num(c.getProperty("LayoutOrder"), 0) : 0);
  governed.sort((a, b) => lo(a) - lo(b));
  const map = new Map();
  if (layout.className === "UIGridLayout") {
    const rects = layoutGridRects(layout, governed.length, rect);
    for (let i = 0; i < governed.length; i++) map.set(governed[i], rects[i]);
  } else {
    const sizes = governed.map((c) => {
      const rr = computeRect(c, rect);
      return { w: rr.w, h: rr.h };
    });
    const rects = layoutListRects(layout, sizes, rect);
    for (let i = 0; i < governed.length; i++) map.set(governed[i], rects[i]);
  }
  return map;
}

export function drawGuiTree(ctx, gui, layoutW, layoutH, buttons, opts) {
  const o = opts || {};
  const textScale = Number.isFinite(o.textScale) && o.textScale > 0 ? o.textScale : 1;
  const minText = Number.isFinite(o.minText) ? o.minText : 8;


  const layer = o.layer === "static" || o.layer === "dynamic" ? o.layer : "all";
  const isHot = typeof o.isHot === "function" ? o.isHot : () => false;
  const clips = !(gui.hasProperty("ClipsDescendants") && gui.getProperty("ClipsDescendants") === false);
  let count = 0;
  const visit = (inst, parentRect, painting, forcedRect) => {
    if (count >= MAX_CHILDREN || !isGuiObject(inst) || !guiVisible(inst)) return;


    count += 1;
    const hot = layer !== "all" && isHot(inst);
    if (layer === "static" && hot) return;
    const paint = layer === "dynamic" ? painting || hot : true;

    const r = forcedRect || computeRect(inst, parentRect);
    if (clips && (r.x > layoutW || r.y > layoutH || r.x + r.w < 0 || r.y + r.h < 0)) return;
    if (paint) {
      if (inst.hasProperty("BackgroundColor3")) {
        const bt = clamp01(inst.hasProperty("BackgroundTransparency") ? inst.getProperty("BackgroundTransparency") : 0, 0);
        if (bt < 1) {
          ctx.fillStyle = colorCss(inst.getProperty("BackgroundColor3"), bt);
          ctx.fillRect(r.x, r.y, r.w, r.h);
        }
      }


      if (typeof o.getImage === "function" && inst.hasProperty("Image") && r.w > 0 && r.h > 0) {
        const src = effectiveButtonImage(inst, typeof o.buttonState === "function" ? o.buttonState(inst) : null);
        if (src && allowedImageSrc(src)) {
          const img = o.getImage(src);
          if (img) {
            const it = clamp01(inst.hasProperty("ImageTransparency") ? inst.getProperty("ImageTransparency") : 0, 0);
            if (it < 1) {
              const prevAlpha = Number.isFinite(ctx.globalAlpha) ? ctx.globalAlpha : 1;
              ctx.globalAlpha = prevAlpha * (1 - it);
              try {
                ctx.drawImage(img, r.x, r.y, r.w, r.h);
              } catch (_e) {


              }
              ctx.globalAlpha = prevAlpha;
            }
          }
        }
      }


      const strokeInst = findStroke(inst);
      if (strokeInst && r.w > 0 && r.h > 0) {
        const sTrans = clamp01(strokeInst.hasProperty("Transparency") ? strokeInst.getProperty("Transparency") : 0, 0);
        if (sTrans < 1) {
          ctx.strokeStyle = colorCss(strokeInst.hasProperty("Color") ? strokeInst.getProperty("Color") : { r: 0, g: 0, b: 0 }, sTrans);
          ctx.lineWidth = Math.max(1, num(strokeInst.hasProperty("Thickness") ? strokeInst.getProperty("Thickness") : 1, 1));
          ctx.lineJoin = lineJoinFor(strokeInst.hasProperty("LineJoinMode") ? strokeInst.getProperty("LineJoinMode") : "Round");
          ctx.strokeRect(r.x, r.y, r.w, r.h);
        }
      }
      if (inst.hasProperty("Text")) {


        const scaled = inst.hasProperty("TextScaled") && inst.getProperty("TextScaled") === true;
        const ts = scaled
          ? Math.max(minText, Math.min(MAX_TEXT_SIZE * textScale, r.h * 0.7))
          : Math.max(minText, num(inst.hasProperty("TextSize") ? inst.getProperty("TextSize") : 14, 14) * textScale);

        const tt = clamp01(inst.hasProperty("TextTransparency") ? inst.getProperty("TextTransparency") : 0, 0);
        if (tt < 1) {
          const txt = String(inst.getProperty("Text") == null ? "" : inst.getProperty("Text")).slice(0, 120);
          const tx = r.x + r.w / 2;
          const ty = r.y + r.h / 2;


          ctx.font = (typeof o.fontFor === "function" && o.fontFor(inst, ts)) || `${ts}px system-ui, sans-serif`;
          ctx.textAlign = "center";
          ctx.textBaseline = "middle";


          const st = clamp01(inst.hasProperty("TextStrokeTransparency") ? inst.getProperty("TextStrokeTransparency") : 1, 1);
          if (st < 1) {
            const sc = inst.hasProperty("TextStrokeColor3") ? inst.getProperty("TextStrokeColor3") : { r: 0, g: 0, b: 0 };
            ctx.strokeStyle = colorCss(sc, st);
            ctx.lineWidth = Math.max(1, ts / 12);
            ctx.lineJoin = "round";
            ctx.strokeText(txt, tx, ty);
          }
          ctx.fillStyle = inst.hasProperty("TextColor3") ? colorCss(inst.getProperty("TextColor3"), tt) : "#ffffff";
          ctx.fillText(txt, tx, ty);
        }
      }


      if (isButton(inst) || (o.collectTextBoxes === true && inst.className === "TextBox")) {
        buttons.push({ x: r.x, y: r.y, w: r.w, h: r.h, inst });
      }
    }


    let cr = r;
    if (inst.className === "ScrollingFrame") {
      const cp = inst.getProperty("CanvasPosition") || { x: 0, y: 0 };
      cr = { x: r.x - num(cp.x), y: r.y - num(cp.y), w: r.w, h: r.h };


      if (paint && Array.isArray(o.scrollFrames)) {
        o.scrollFrames.push({ x: r.x, y: r.y, w: r.w, h: r.h, inst });
      }
    }

    const over = layoutOverrides(inst, cr);
    for (const c of sortByZIndex(inst.getChildren())) visit(c, cr, paint, over ? over.get(c) : undefined);
  };
  const rootRect = { x: 0, y: 0, w: layoutW, h: layoutH };
  const rootOver = layoutOverrides(gui, rootRect);
  for (const c of sortByZIndex(gui.getChildren())) visit(c, rootRect, false, rootOver ? rootOver.get(c) : undefined);
  return count;
}

export function hitTestButtons(buttons, cx, cy, isAlive) {
  for (let i = buttons.length - 1; i >= 0; i--) {
    const b = buttons[i];
    if (cx >= b.x && cx <= b.x + b.w && cy >= b.y && cy <= b.y + b.h) {
      if (!isAlive || isAlive(b.inst)) return b.inst;
    }
  }
  return null;
}
