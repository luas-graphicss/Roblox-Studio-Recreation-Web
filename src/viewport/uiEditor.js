import { store } from "../core/state.js";
import { bus } from "../core/eventBus.js";
import { logger } from "../core/logger.js";
import { selection } from "../core/selection.js";
import { commands } from "../core/commands.js";
import { getService, makeUDim2, makeVector2, Events } from "../datamodel/index.js";


import { GUI_TOPBAR_INSET_Y, guiFontFor, fontShorthandFor } from "../runtime/guiMetrics.js";
import { guiFontLoader } from "../runtime/guiFonts.js";

const NOMINAL_W = 1280;
const NOMINAL_H = 720;
const DRAG_THRESHOLD = 3;                                  

function el(tag, cls) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  return n;
}

function live(inst) {
  return !!(inst && inst.__isInstance === true && typeof inst.isDestroyed === "function" && !inst.isDestroyed());
}


function isGuiObject(inst) {
  return !!(inst && typeof inst.hasProperty === "function" && inst.hasProperty("Size") && inst.hasProperty("Position"));
}

function clamp01(n) {
  return Math.min(1, Math.max(0, Number.isFinite(n) ? n : 0));
}

function colorCss(c, transparency) {
  if (!c) return "transparent";
  const r = Math.round(clamp01(c.r) * 255);
  const g = Math.round(clamp01(c.g) * 255);
  const b = Math.round(clamp01(c.b) * 255);
  const a = 1 - clamp01(transparency || 0);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

export function createUIEditor({ container }) {
  if (!container) {
    logger.warn("UI Editor: container ausente.");
    return { el: null, refresh() {}, destroy() {}, setVisible() {} };
  }

  const overlay = el("div", "rsw-uieditor");
  overlay.hidden = true;
  const screenEl = el("div", "rsw-uieditor__screen");
  const rulerX = el("div", "rsw-uieditor__ruler rsw-uieditor__ruler--x");
  const rulerY = el("div", "rsw-uieditor__ruler rsw-uieditor__ruler--y");
  const handlesEl = el("div", "rsw-uieditor__handles");


  const topbarEl = el("div", "rsw-uieditor__topbar");
  topbarEl.appendChild(el("div", "rsw-uieditor__topbar-pill"));
  screenEl.appendChild(topbarEl);
  screenEl.appendChild(handlesEl);
  overlay.append(rulerX, rulerY, screenEl);
  container.appendChild(overlay);


  function applyGuidesVisibility() {
    const show = typeof store.getViewOption === "function" ? store.getViewOption("showGuides") !== false : true;
    rulerX.style.display = show ? "" : "none";
    rulerY.style.display = show ? "" : "none";
  }
  applyGuidesVisibility();
  const offGuides = store.subscribe((_state, change) => {
    if (change && change.key === "viewOptions" && change.option === "showGuides") applyGuidesVisibility();
  });

  let scale = 1;                                                 
  let originX = 0;                                        
  let originY = 0;
  const rectMap = new Map();                                                             
  let drag = null;

  function visible() {
    return !overlay.hidden;
  }


  function computeScale() {
    const cw = container.clientWidth || 1;
    const ch = container.clientHeight || 1;
    scale = Math.min(cw / NOMINAL_W, ch / NOMINAL_H);
    if (!Number.isFinite(scale) || scale <= 0) scale = 0.1;
    const sw = NOMINAL_W * scale;
    const sh = NOMINAL_H * scale;
    originX = Math.round((cw - sw) / 2);
    originY = Math.round((ch - sh) / 2);
    screenEl.style.left = `${originX}px`;
    screenEl.style.top = `${originY}px`;
    screenEl.style.width = `${Math.round(sw)}px`;
    screenEl.style.height = `${Math.round(sh)}px`;

    topbarEl.style.height = `${Math.max(1, Math.round(GUI_TOPBAR_INSET_Y * scale))}px`;
  }


  function computeRect(inst, parentRect) {
    const size = inst.getProperty("Size") || { xScale: 0, xOffset: 100, yScale: 0, yOffset: 100 };
    const pos = inst.getProperty("Position") || { xScale: 0, xOffset: 0, yScale: 0, yOffset: 0 };
    const anchor = inst.getProperty("AnchorPoint") || { x: 0, y: 0 };
    const w = parentRect.w * (size.xScale || 0) + (size.xOffset || 0);
    const h = parentRect.h * (size.yScale || 0) + (size.yOffset || 0);
    const x = parentRect.x + parentRect.w * (pos.xScale || 0) + (pos.xOffset || 0) - (anchor.x || 0) * w;
    const y = parentRect.y + parentRect.h * (pos.yScale || 0) + (pos.yOffset || 0) - (anchor.y || 0) * h;
    return { x, y, w, h };
  }

  function offscreen(rect) {
    return rect.x + rect.w < 0 || rect.y + rect.h < 0 || rect.x > NOMINAL_W || rect.y > NOMINAL_H;
  }

  function styleElement(d, inst, rect) {
    d.style.left = `${rect.x * scale}px`;
    d.style.top = `${rect.y * scale}px`;
    d.style.width = `${Math.max(0, rect.w) * scale}px`;
    d.style.height = `${Math.max(0, rect.h) * scale}px`;
    const zi = inst.getProperty("ZIndex");
    if (Number.isFinite(zi)) d.style.zIndex = String(Math.max(0, Math.min(10000, zi)));
    const bg = inst.hasProperty("BackgroundColor3") ? inst.getProperty("BackgroundColor3") : null;
    const bt = inst.hasProperty("BackgroundTransparency") ? inst.getProperty("BackgroundTransparency") : 0;
    d.style.background = bg ? colorCss(bg, bt) : "transparent";
    const border = inst.hasProperty("BorderSizePixel") ? inst.getProperty("BorderSizePixel") : 0;
    d.style.border = border > 0 ? `${Math.max(1, border * scale)}px solid rgba(0,0,0,0.5)` : "none";
    if (inst.hasProperty("ClipsDescendants") && inst.getProperty("ClipsDescendants")) d.style.overflow = "hidden";
    else d.style.overflow = "visible";

    if (inst.hasProperty("Text")) {
      const txt = inst.getProperty("Text");
      d.dataset.text = typeof txt === "string" ? txt : "";
      const tc = inst.hasProperty("TextColor3") ? inst.getProperty("TextColor3") : null;
      const ts = inst.hasProperty("TextSize") ? inst.getProperty("TextSize") : 14;
      const label = el("span", "rsw-uieditor__text");
      label.textContent = typeof txt === "string" ? txt : "";
      if (tc) label.style.color = colorCss(tc, 0);


      const font = guiFontFor(inst);
      guiFontLoader.ensureFont(font);
      label.style.font = fontShorthandFor(font, Math.max(6, (ts || 14) * scale));
      d.appendChild(label);
    } else if (inst.hasProperty("Image")) {


      const imgLayer = el("div", "rsw-uieditor__img");
      d.appendChild(imgLayer);
    }
  }

  function renderEl(inst, parentRect) {
    if (!live(inst) || !isGuiObject(inst)) return;

    if (inst.hasProperty("Visible") && inst.getProperty("Visible") === false) return;
    const rect = computeRect(inst, parentRect);
    if (offscreen(rect)) return;                                    
    const d = el("div", "rsw-uieditor__el");
    d.dataset.uiid = inst.id;
    styleElement(d, inst, rect);
    if (selection.isSelected(inst)) d.classList.add("is-selected");
    screenEl.insertBefore(d, handlesEl);                                     
    rectMap.set(inst.id, { inst, el: d, rect });
    for (const child of inst.getChildren()) renderEl(child, rect);
  }

  function render() {
    if (!visible()) return;
    rectMap.clear();

    for (const node of [...screenEl.children]) {
      if (node !== handlesEl && node !== topbarEl) screenEl.removeChild(node);
    }
    const dm = store.getDataModel();
    if (!dm) {
      renderHandles();
      return;
    }
    const sg = getService(dm, "StarterGui");
    if (sg) {
      for (const child of sg.getChildren()) {
        if (child.className !== "ScreenGui") continue;
        if (child.hasProperty("Enabled") && child.getProperty("Enabled") === false) continue;


        const ignore = child.hasProperty("IgnoreGuiInset") && child.getProperty("IgnoreGuiInset") === true;
        const insetY = ignore ? 0 : Math.min(GUI_TOPBAR_INSET_Y, NOMINAL_H - 1);
        const screenRect = { x: 0, y: insetY, w: NOMINAL_W, h: NOMINAL_H - insetY };
        for (const c of child.getChildren()) renderEl(c, screenRect);
      }
    }
    renderHandles();
  }


  const HANDLE_DIRS = [
    ["nw", -1, -1], ["n", 0, -1], ["ne", 1, -1],
    ["w", -1, 0], ["e", 1, 0],
    ["sw", -1, 1], ["s", 0, 1], ["se", 1, 1],
  ];

  function selectedGuiEntry() {
    const ids = selection.ids();
    for (const id of ids) {
      const entry = rectMap.get(id);
      if (entry) return entry;
    }
    return null;
  }

  function renderHandles() {
    handlesEl.replaceChildren();
    const entry = selectedGuiEntry();
    if (!entry) {
      handlesEl.hidden = true;
      return;
    }
    handlesEl.hidden = false;
    const r = entry.rect;
    handlesEl.style.left = `${r.x * scale}px`;
    handlesEl.style.top = `${r.y * scale}px`;
    handlesEl.style.width = `${Math.max(0, r.w) * scale}px`;
    handlesEl.style.height = `${Math.max(0, r.h) * scale}px`;
    for (const [name, dx, dy] of HANDLE_DIRS) {
      const h = el("div", `rsw-uieditor__handle rsw-uieditor__handle--${name}`);
      h.dataset.dirx = String(dx);
      h.dataset.diry = String(dy);
      h.style.left = `${((dx + 1) / 2) * 100}%`;
      h.style.top = `${((dy + 1) / 2) * 100}%`;
      h.addEventListener("pointerdown", (e) => startResize(e, entry, dx, dy));
      handlesEl.appendChild(h);
    }
  }


  function findUIDragDetector(inst) {
    let cur = inst;
    let depth = 0;
    while (cur && depth < 8 && isGuiObject(cur)) {
      const dd = cur.getChildren().find(
        (c) => c.className === "UIDragDetector" && !c.isDestroyed() && c.getProperty("Enabled") === true,
      );
      if (dd) return { dd, host: cur };
      cur = cur.getParent ? cur.getParent() : null;
      depth += 1;
    }
    return null;
  }

  function uiddBoundaryClamp(dd, u) {
    const min = dd.getProperty("BoundaryMin") || { xScale: 0, xOffset: 0, yScale: 0, yOffset: 0 };
    const max = dd.getProperty("BoundaryMax") || { xScale: 0, xOffset: 0, yScale: 0, yOffset: 0 };
    const zero = (b) => !b.xScale && !b.xOffset && !b.yScale && !b.yOffset;
    if (zero(min) && zero(max)) return u;
    const pair = (lo, hi) => (lo <= hi ? [lo, hi] : [hi, lo]);
    const [xsLo, xsHi] = pair(min.xScale || 0, max.xScale || 0);
    const [xoLo, xoHi] = pair(min.xOffset || 0, max.xOffset || 0);
    const [ysLo, ysHi] = pair(min.yScale || 0, max.yScale || 0);
    const [yoLo, yoHi] = pair(min.yOffset || 0, max.yOffset || 0);
    const cl = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
    return makeUDim2(cl(u.xScale, xsLo, xsHi), cl(u.xOffset, xoLo, xoHi), cl(u.yScale, ysLo, ysHi), cl(u.yOffset, yoLo, yoHi));
  }

  function fireUIDD(dd, type, args) {
    bus.emit("gameplay:event", { instance: dd, type, args: args || [] });
  }

  function startUIDrag(e, host, dd) {
    e.stopPropagation();
    e.preventDefault();
    const response = String(dd.getProperty("ResponseStyle") || "Offset");
    const style = String(dd.getProperty("DragStyle") || "TranslatePlane");
    const startPos = host.getProperty("Position") || { xScale: 0, xOffset: 0, yScale: 0, yOffset: 0 };
    const startSize = host.getProperty("Size") || { xScale: 0, xOffset: 100, yScale: 0, yOffset: 100 };
    const startRot = host.hasProperty("Rotation") ? Number(host.getProperty("Rotation")) || 0 : 0;
    const startClient = { x: e.clientX, y: e.clientY };
    let last = { x: e.clientX, y: e.clientY };
    fireUIDD(dd, "DragStart", [makeVector2(e.clientX, e.clientY)]);
    const onMoveW = (ev) => {
      if (!live(dd) || !live(host)) {
        cleanup(ev);
        return;
      }
      const k = scale > 0 ? 1 / scale : 1;
      let dx = (ev.clientX - startClient.x) * k;
      let dy = (ev.clientY - startClient.y) * k;
      if (style === "TranslateLine") {
        if (Math.abs(dx) >= Math.abs(dy)) dy = 0;
        else dx = 0;
      }
      if (style === "Rotate") {
        let ang = startRot + (ev.clientX - startClient.x) * 0.5;
        const maxA = Number(dd.getProperty("MaxDragAngle"));
        const minA = Number(dd.getProperty("MinDragAngle"));
        if (Number.isFinite(maxA) && maxA !== 0) ang = Math.min(ang, maxA);
        if (Number.isFinite(minA) && minA !== 0) ang = Math.max(ang, minA);
        if (host.hasProperty("Rotation")) host.setProperty("Rotation", ang);
      } else if (style !== "Scriptable" && response !== "Custom") {
        if (response === "Scale") {
          host.setProperty(
            "Size",
            uiddBoundaryClamp(dd, makeUDim2(startSize.xScale, startSize.xOffset + dx, startSize.yScale, startSize.yOffset + dy)),
          );
        } else {
          host.setProperty(
            "Position",
            uiddBoundaryClamp(dd, makeUDim2(startPos.xScale, startPos.xOffset + dx, startPos.yScale, startPos.yOffset + dy)),
          );
        }
      }
      fireUIDD(dd, "DragContinue", [
        makeVector2(ev.clientX, ev.clientY),
        makeVector2(ev.clientX - last.x, ev.clientY - last.y),
      ]);
      last = { x: ev.clientX, y: ev.clientY };
    };
    const cleanup = (ev) => {
      window.removeEventListener("pointermove", onMoveW, true);
      window.removeEventListener("pointerup", cleanup, true);
      if (live(dd)) fireUIDD(dd, "DragEnd", [makeVector2(ev ? ev.clientX : last.x, ev ? ev.clientY : last.y)]);
    };
    window.addEventListener("pointermove", onMoveW, true);
    window.addEventListener("pointerup", cleanup, true);
  }

  function startMove(e, entry) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const inst = entry.inst;
    const startPos = inst.getProperty("Position") || { xScale: 0, xOffset: 0, yScale: 0, yOffset: 0 };
    drag = {
      kind: "move",
      inst,
      entry,
      startX: e.clientX,
      startY: e.clientY,
      startPos,
      moved: false,
      raf: false,
      lastDx: 0,
      lastDy: 0,
    };
    try { screenEl.setPointerCapture(e.pointerId); } catch (_) {            }
    drag.pointerId = e.pointerId;
  }

  function startResize(e, entry, dirX, dirY) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.preventDefault();
    const inst = entry.inst;
    drag = {
      kind: "resize",
      inst,
      entry,
      dirX,
      dirY,
      startX: e.clientX,
      startY: e.clientY,
      startSize: inst.getProperty("Size") || { xScale: 0, xOffset: 100, yScale: 0, yOffset: 100 },
      startPos: inst.getProperty("Position") || { xScale: 0, xOffset: 0, yScale: 0, yOffset: 0 },
      moved: false,
      raf: false,
      lastDx: 0,
      lastDy: 0,
    };
    try { handlesEl.setPointerCapture(e.pointerId); } catch (_) {            }
    drag.pointerId = e.pointerId;
  }

  function applyDragPreview() {



    if (!drag) return;
    drag.raf = false;
    const ndx = drag.lastDx / scale;               
    const ndy = drag.lastDy / scale;
    const d = drag.entry.el;
    if (drag.kind === "move") {
      const baseRect = drag.entry.rect;
      d.style.left = `${(baseRect.x + ndx) * scale}px`;
      d.style.top = `${(baseRect.y + ndy) * scale}px`;
      handlesEl.style.left = `${(baseRect.x + ndx) * scale}px`;
      handlesEl.style.top = `${(baseRect.y + ndy) * scale}px`;
    } else {
      const r = previewResizeRect(ndx, ndy);
      d.style.left = `${r.x * scale}px`;
      d.style.top = `${r.y * scale}px`;
      d.style.width = `${Math.max(0, r.w) * scale}px`;
      d.style.height = `${Math.max(0, r.h) * scale}px`;
      handlesEl.style.left = `${r.x * scale}px`;
      handlesEl.style.top = `${r.y * scale}px`;
      handlesEl.style.width = `${Math.max(0, r.w) * scale}px`;
      handlesEl.style.height = `${Math.max(0, r.h) * scale}px`;
    }
  }

  function previewResizeRect(ndx, ndy) {
    const base = drag.entry.rect;
    let { x, y, w, h } = base;
    if (drag.dirX === 1) w = Math.max(0, base.w + ndx);
    else if (drag.dirX === -1) { w = Math.max(0, base.w - ndx); x = base.x + (base.w - w); }
    if (drag.dirY === 1) h = Math.max(0, base.h + ndy);
    else if (drag.dirY === -1) { h = Math.max(0, base.h - ndy); y = base.y + (base.h - h); }
    return { x, y, w, h };
  }

  function onMove(e) {
    if (!drag) return;
    drag.lastDx = e.clientX - drag.startX;
    drag.lastDy = e.clientY - drag.startY;
    if (!drag.moved && Math.hypot(drag.lastDx, drag.lastDy) >= DRAG_THRESHOLD) drag.moved = true;
    if (!drag.moved) return;
    if (!drag.raf) {
      drag.raf = true;
      requestAnimationFrame(applyDragPreview);            
    }
  }

  function onUp() {
    if (!drag) return;
    const d = drag;
    drag = null;
    if (!d.moved) {
      render();                                           
      return;
    }
    const ndx = Math.round(d.lastDx / scale);
    const ndy = Math.round(d.lastDy / scale);
    const inst = d.inst;
    if (d.kind === "move") {
      const p = d.startPos;
      const newPos = makeUDim2(p.xScale, p.xOffset + ndx, p.yScale, p.yOffset + ndy);
      const oldPos = inst.getProperty("Position");
      commands.execute({
        name: "Mover elemento de UI",
        do() { return inst.setProperty("Position", newPos); },
        undo() { inst.setProperty("Position", oldPos); },
      });
    } else {
      const s = d.startSize;
      const p = d.startPos;


      const anchor = (inst.hasProperty("AnchorPoint") && inst.getProperty("AnchorPoint")) || { x: 0, y: 0 };
      const ax = Number(anchor.x) || 0;
      const ay = Number(anchor.y) || 0;
      let xOff = s.xOffset;
      let yOff = s.yOffset;
      let pxOff = p.xOffset;
      let pyOff = p.yOffset;
      if (d.dirX === 1) { xOff = s.xOffset + ndx; pxOff = p.xOffset + ndx * ax; }
      else if (d.dirX === -1) { xOff = s.xOffset - ndx; pxOff = p.xOffset + ndx * (1 - ax); }
      if (d.dirY === 1) { yOff = s.yOffset + ndy; pyOff = p.yOffset + ndy * ay; }
      else if (d.dirY === -1) { yOff = s.yOffset - ndy; pyOff = p.yOffset + ndy * (1 - ay); }
      const newSize = makeUDim2(s.xScale, xOff, s.yScale, yOff);
      const newPos = makeUDim2(p.xScale, pxOff, p.yScale, pyOff);
      const oldSize = inst.getProperty("Size");
      const oldPos = inst.getProperty("Position");
      commands.execute({
        name: "Redimensionar elemento de UI",
        do() {
          const a = inst.setProperty("Size", newSize);
          const b = inst.setProperty("Position", newPos);
          return a || b;
        },
        undo() {
          inst.setProperty("Size", oldSize);
          inst.setProperty("Position", oldPos);
        },
      });
    }

  }


  screenEl.addEventListener("pointerdown", (e) => {
    const t = e.target;
    if (!t || typeof t.closest !== "function") return;
    if (t.closest(".rsw-uieditor__handle")) return;                             
    const elNode = t.closest("[data-uiid]");
    if (!elNode) {

      e.stopPropagation();
      selection.clear();
      return;
    }
    const id = elNode.dataset.uiid;
    const entry = rectMap.get(id);
    if (!entry) return;
    selection.selectSingle(entry.inst);                                           
    const fresh = rectMap.get(id);
    if (fresh) {
      const uidd = findUIDragDetector(fresh.inst);
      if (uidd) startUIDrag(e, uidd.host, uidd.dd);
      else startMove(e, fresh);
    }
  });

  screenEl.addEventListener("pointermove", (e) => { if (drag) e.stopPropagation(); onMove(e); });
  screenEl.addEventListener("pointerup", (e) => { if (drag) e.stopPropagation(); onUp(); });
  screenEl.addEventListener("pointercancel", onUp);
  handlesEl.addEventListener("pointermove", onMove);
  handlesEl.addEventListener("pointerup", onUp);
  handlesEl.addEventListener("pointercancel", onUp);

  overlay.addEventListener("contextmenu", (e) => e.preventDefault());
  overlay.addEventListener("wheel", (e) => e.stopPropagation());


  const offSel = bus.on("selection:changed", () => { if (visible()) render(); });
  const offProp = bus.on(Events.PropertyChanged, () => { if (visible()) render(); });
  const offAdd = bus.on(Events.ChildAdded, () => { if (visible()) render(); });
  const offRem = bus.on(Events.ChildRemoved, () => { if (visible()) render(); });
  const offDel = bus.on(Events.Destroying, () => { if (visible()) render(); });

  function setVisible(on) {
    overlay.hidden = !on;
    container.classList.toggle("rsw-viewport--uimode", !!on);
    if (on) {
      guiFontLoader.start();                                                
      computeScale();
      render();
    }
  }


  const offFonts = guiFontLoader.onChanged(() => { if (visible()) render(); });

  function refresh() {
    if (!visible()) return;
    computeScale();
    render();
  }

  function destroy() {
    [offSel, offProp, offAdd, offRem, offDel, offGuides, offFonts].forEach((f) => { if (typeof f === "function") f(); });
    if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
  }

  return { el: overlay, refresh, destroy, setVisible, render };
}
