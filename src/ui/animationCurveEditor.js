import { createIcon } from "./icons.js";

import { createListenerScope } from "../core/listenerScope.js";
import { openConfirm } from "./modal.js";
import {
  getClip,
  getCurrentTime,
  setTime,
  getSelectedTrackKey,
  setSelectedTrack,
  selectPartForTrack,
  deleteKeyframes,
  duplicateKeyframes,
  pasteKeyframes,
  markEndKeyframe,
  getRotationType,
  setRotationType,
  setInterpolation,
  zeroTangents,
  resetTangents,
  setTangentValue,
  setKeyframeChannelValue,
  dragCurveKeyframes,
  generateCurveForSelection,
} from "../animation/animationStore.js";
import {
  CURVE_CHANNELS,
  INTERP_MODES,
  ROTATION_TYPES,
  channelValue,
  evaluateChannelValue,
  evaluateTrackCurve,
  resolvedTangent,
  isTangentSet,
  formatSecFrames,
} from "../animation/animationModel.js";

const NS = "http://www.w3.org/2000/svg";
const GEN_KINDS = ["Bounce", "Elastic"];
const GEN_DIRS = ["In", "Out", "InOut"];
const PAD_L = 46;                              
const PAD_R = 14;
const PAD_T = 12;
const PAD_B = 24;                            
const TAN_PX = 46;                                            

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}
function svgEl(tag, attrs) {
  const e = document.createElementNS(NS, tag);
  if (attrs) for (const k in attrs) e.setAttribute(k, String(attrs[k]));
  return e;
}
function chMeta(chKey) {
  return CURVE_CHANNELS.find((c) => c.key === chKey) || null;
}
function clamp(v, a, b) { return v < a ? a : v > b ? b : v; }


export function createCurveEditor() {

  let visible = false;
  const root = el("div", "rsw-curve");
  root.style.display = "none";


  let selPoints = [];
  let lastClickPoint = null;                  

  const selChannels = new Set();                    
  let clipboard = null;


  const view = { t0: 0, t1: 1, vMin: -1, vMax: 1 };
  let viewInit = false;
  let lastDuration = -1;


  const expanded = new Set();                        
  const channelOff = new Set();                                   
  const filters = { posOnly: false, rotOnly: false, selectedOnly: false, hideEmpty: false, focusSelected: false };


  let sideListEl = null;
  let graphWrap = null;
  let svg = null;
  let gGrid, gCurves, gTangents, gPoints, gScrub, gBox;
  let propsEl = null;
  let rotSel = null;
  let menuEl = null;


  const menuListeners = createListenerScope("animationCurveEditorMenu");
  let ro = null;
  let geo = { gx: PAD_L, gy: PAD_T, gw: 10, gh: 10, w: 10, h: 10 };


  function xFromTime(t) {
    const span = view.t1 - view.t0 || 1;
    return geo.gx + ((t - view.t0) / span) * geo.gw;
  }
  function timeFromX(px) {
    const span = view.t1 - view.t0 || 1;
    return view.t0 + ((px - geo.gx) / geo.gw) * span;
  }
  function yFromVal(v) {
    const span = view.vMax - view.vMin || 1;
    return geo.gy + ((view.vMax - v) / span) * geo.gh;
  }
  function valFromY(py) {
    const span = view.vMax - view.vMin || 1;
    return view.vMax - ((py - geo.gy) / geo.gh) * span;
  }
  function localPt(ev) {
    const r = svg.getBoundingClientRect();
    return { x: ev.clientX - r.left, y: ev.clientY - r.top };
  }


  function tracksWithKfs(clip) {
    const out = [];
    for (const key in clip.tracks) {
      const tr = clip.tracks[key];
      if (tr && tr.keyframes && tr.keyframes.length) out.push({ key, track: tr });
    }
    return out;
  }
  function channelIsEmpty(track, chKey) {
    const kfs = track.keyframes;
    if (!kfs.length) return true;
    let mn = Infinity, mx = -Infinity;
    for (const kf of kfs) {
      const v = channelValue(kf, chKey);
      if (v < mn) mn = v;
      if (v > mx) mx = v;
    }
    return mx - mn < 1e-6;
  }
  function channelVisible(trackKey, track, ch) {
    if (channelOff.has(trackKey + ":" + ch.key)) return false;
    if (filters.posOnly && ch.kind !== "pos") return false;
    if (filters.rotOnly && ch.kind !== "rot") return false;
    if (filters.selectedOnly && !selChannels.has(trackKey + ":" + ch.key)) return false;
    if (filters.hideEmpty && channelIsEmpty(track, ch.key)) return false;
    return true;
  }
  function visibleChannels(clip) {
    const selTrack = getSelectedTrackKey();
    const list = [];
    for (const { key, track } of tracksWithKfs(clip)) {
      if (filters.focusSelected && selTrack && key !== selTrack) continue;
      if (!expanded.has(key)) continue;
      for (const ch of CURVE_CHANNELS) {
        if (channelVisible(key, track, ch)) list.push({ trackKey: key, partName: track.partName, track, ch });
      }
    }
    return list;
  }


  function refitValue(chans, clip) {
    let mn = Infinity, mx = -Infinity;
    for (const c of chans) {
      for (const kf of c.track.keyframes) {
        const v = channelValue(kf, c.ch.key);
        if (v < mn) mn = v;
        if (v > mx) mx = v;
      }
    }
    if (!isFinite(mn) || !isFinite(mx)) { mn = -1; mx = 1; }
    if (mx - mn < 1e-6) { mn -= 1; mx += 1; }
    const pad = (mx - mn) * 0.12;
    view.vMin = mn - pad;
    view.vMax = mx + pad;
    view.t0 = 0;
    view.t1 = clip.duration || 1;
  }
  function resetZoom() {
    const clip = getClip();
    if (!clip) return;
    refitValue(visibleChannels(clip), clip);
    drawGraph();
  }


  function buildSide() {
    const side = el("div", "rsw-curve__side");


    const filt = el("div", "rsw-curve__filters");
    const mkToggle = (label, fkey, title) => {
      const b = el("button", "rsw-curve__filt", label);
      b.type = "button";
      if (title) b.title = title;
      b.addEventListener("click", () => {
        filters[fkey] = !filters[fkey];
        b.classList.toggle("rsw-curve__filt--on", filters[fkey]);
        render();
      });
      return b;
    };
    filt.append(
      mkToggle("Pos", "posOnly", "Mostrar apenas posicao"),
      mkToggle("Rot", "rotOnly", "Mostrar apenas rotacao"),
      mkToggle("Sel", "selectedOnly", "Mostrar apenas canais selecionados"),
      mkToggle("Vazios", "hideEmpty", "Ocultar canais sem variacao"),
      mkToggle("Foco", "focusSelected", "Focar na parte selecionada"),
    );
    const zoomBtn = el("button", "rsw-curve__filt", "Reset zoom");
    zoomBtn.type = "button";
    zoomBtn.title = "Resetar zoom/pan da curva";
    zoomBtn.addEventListener("click", resetZoom);
    filt.appendChild(zoomBtn);


    const rotWrap = el("label", "rsw-curve__rot");
    rotWrap.appendChild(el("span", "rsw-curve__rot-lbl", "Rotacao"));
    rotSel = el("select", "rsw-curve__rotsel");
    ROTATION_TYPES.forEach((t) => { const o = el("option", null, t); o.value = t; rotSel.appendChild(o); });
    rotSel.addEventListener("change", onRotationChange);
    rotWrap.appendChild(rotSel);
    filt.appendChild(rotWrap);

    side.appendChild(filt);

    sideListEl = el("div", "rsw-curve__tracklist");
    side.appendChild(sideListEl);


    propsEl = el("div", "rsw-curve__props");
    side.appendChild(propsEl);
    return side;
  }

  async function onRotationChange() {
    const next = rotSel.value;
    const cur = getRotationType();
    if (next === cur) return;
    if (cur === "Quaternion" && next === "Euler") {
      const ok = await openConfirm({
        title: "Converter rotacao para Euler",
        message: "Converter de Quaternion para Euler muda a forma de edicao (eixos independentes) e pode alterar levemente o movimento entre keyframes. Deseja continuar?",
        buttons: [
          { label: "Converter", value: true, kind: "primary" },
          { label: "Cancelar", value: false, kind: "default" },
        ],
      });
      if (!ok) { rotSel.value = cur; return; }
    }
    setRotationType(next);
  }

  function buildTrackList(clip) {
    sideListEl.textContent = "";
    const selTrack = getSelectedTrackKey();
    const rows = tracksWithKfs(clip);
    if (!rows.length) {
      sideListEl.appendChild(el("div", "rsw-curve__empty", "Nenhuma keyframe ainda. Pose o rig no Viewport para criar curvas."));
      return;
    }
    for (const { key, track } of rows) {
      if (filters.focusSelected && selTrack && key !== selTrack) continue;
      const isOpen = expanded.has(key);
      const head = el("div", "rsw-curve__trk" + (key === selTrack ? " rsw-curve__trk--sel" : ""));
      head.dataset.key = key;
      const caret = el("button", "rsw-curve__caret");
      caret.type = "button";
      caret.appendChild(createIcon(isOpen ? "caretDown" : "caretRight", 10));
      caret.setAttribute("aria-label", isOpen ? "Recolher track" : "Expandir track");
      caret.addEventListener("click", (e) => {
        e.stopPropagation();
        if (expanded.has(key)) expanded.delete(key); else expanded.add(key);
        render();
      });
      const name = el("span", "rsw-curve__trk-name");
      name.textContent = track.partName || key;
      head.append(caret, name);
      head.addEventListener("click", () => { selectPartForTrack(key); });
      sideListEl.appendChild(head);

      if (!isOpen) continue;
      for (const ch of CURVE_CHANNELS) {
        if (filters.posOnly && ch.kind !== "pos") continue;
        if (filters.rotOnly && ch.kind !== "rot") continue;
        const empty = channelIsEmpty(track, ch.key);
        if (filters.hideEmpty && empty) continue;
        const id = key + ":" + ch.key;
        const crow = el("div", "rsw-curve__chrow" + (selChannels.has(id) ? " rsw-curve__chrow--sel" : ""));
        const dot = el("span", "rsw-curve__dot");
        dot.style.background = ch.color;
        const lbl = el("span", "rsw-curve__ch-name");
        lbl.textContent = ch.label + (empty ? " (vazio)" : "");
        const eye = el("button", "rsw-curve__eye" + (channelOff.has(id) ? " rsw-curve__eye--off" : ""));
        eye.type = "button";
        eye.title = channelOff.has(id) ? "Mostrar canal" : "Ocultar canal";
        eye.appendChild(createIcon("eye", 12));
        eye.addEventListener("click", (e) => {
          e.stopPropagation();
          if (channelOff.has(id)) channelOff.delete(id); else channelOff.add(id);
          render();
        });
        crow.append(dot, lbl, eye);
        crow.addEventListener("click", (e) => {
          if (e.ctrlKey || e.metaKey) {
            if (selChannels.has(id)) selChannels.delete(id); else selChannels.add(id);
          } else {
            selChannels.clear();
            selChannels.add(id);
          }
          buildTrackList(clip);
          if (filters.selectedOnly) drawGraph();
        });
        sideListEl.appendChild(crow);
      }
    }
  }


  function buildGraph() {
    graphWrap = el("div", "rsw-curve__graph");
    svg = svgEl("svg", { class: "rsw-curve__svg" });
    gGrid = svgEl("g", { class: "rsw-curve__grid" });
    gCurves = svgEl("g", { class: "rsw-curve__lines" });
    gTangents = svgEl("g", { class: "rsw-curve__tangents" });
    gPoints = svgEl("g", { class: "rsw-curve__pts" });
    gScrub = svgEl("g", { class: "rsw-curve__scrubg" });
    gBox = svgEl("g", { class: "rsw-curve__boxg" });
    svg.append(gGrid, gCurves, gTangents, gPoints, gScrub, gBox);
    graphWrap.appendChild(svg);
    wireGraphInteractions();
    return graphWrap;
  }

  function measure() {
    const r = graphWrap.getBoundingClientRect();
    const w = Math.max(120, Math.round(r.width));
    const h = Math.max(80, Math.round(r.height));
    geo = { w, h, gx: PAD_L, gy: PAD_T, gw: w - PAD_L - PAD_R, gh: h - PAD_T - PAD_B };
    svg.setAttribute("width", String(w));
    svg.setAttribute("height", String(h));
    svg.setAttribute("viewBox", "0 0 " + w + " " + h);
  }

  function clearGroup(g) { while (g.firstChild) g.removeChild(g.firstChild); }

  function drawGrid(clip) {
    clearGroup(gGrid);

    gGrid.appendChild(svgEl("rect", { x: geo.gx, y: geo.gy, width: geo.gw, height: geo.gh, class: "rsw-curve__bg" }));

    const dur = clip.duration || 1;
    const span = view.t1 - view.t0 || 1;
    const targetTicks = clamp(Math.round(geo.gw / 90), 3, 14);
    const rawStep = span / targetTicks;
    const step = niceStep(rawStep);
    const first = Math.ceil(view.t0 / step) * step;
    for (let t = first; t <= view.t1 + 1e-6; t += step) {
      const x = xFromTime(t);
      if (x < geo.gx - 0.5 || x > geo.gx + geo.gw + 0.5) continue;
      gGrid.appendChild(svgEl("line", { x1: x, y1: geo.gy, x2: x, y2: geo.gy + geo.gh, class: "rsw-curve__gl" }));
      const lab = svgEl("text", { x: x, y: geo.gy + geo.gh + 15, class: "rsw-curve__axlbl rsw-curve__axlbl--t" });
      lab.textContent = formatSecFrames(clamp(t, 0, dur), clip.fps);
      gGrid.appendChild(lab);
    }

    const vspan = view.vMax - view.vMin || 1;
    const vstep = niceStep(vspan / clamp(Math.round(geo.gh / 40), 2, 10));
    const vfirst = Math.ceil(view.vMin / vstep) * vstep;
    for (let v = vfirst; v <= view.vMax + 1e-6; v += vstep) {
      const y = yFromVal(v);
      if (y < geo.gy - 0.5 || y > geo.gy + geo.gh + 0.5) continue;
      const zero = Math.abs(v) < vstep * 0.5;
      gGrid.appendChild(svgEl("line", { x1: geo.gx, y1: y, x2: geo.gx + geo.gw, y2: y, class: zero ? "rsw-curve__gl rsw-curve__gl--zero" : "rsw-curve__gl" }));
      const lab = svgEl("text", { x: geo.gx - 6, y: y + 3, class: "rsw-curve__axlbl rsw-curve__axlbl--v" });
      lab.textContent = fmtVal(v);
      gGrid.appendChild(lab);
    }
  }
  function niceStep(raw) {
    if (!(raw > 0)) return 1;
    const pow = Math.pow(10, Math.floor(Math.log10(raw)));
    const n = raw / pow;
    const m = n < 1.5 ? 1 : n < 3 ? 2 : n < 7 ? 5 : 10;
    return m * pow;
  }
  function fmtVal(v) {
    const a = Math.abs(v);
    if (a !== 0 && (a < 0.01 || a >= 1e5)) return v.toExponential(1);
    return (Math.round(v * 100) / 100).toString();
  }

  function curveSampleValue(chans, c, t, rotType) {
    if (c.ch.kind === "rot" && rotType === "Quaternion") {
      const pose = evaluateTrackCurve(c.track, t, rotType);
      return pose.rot[c.ch.axis];
    }
    return evaluateChannelValue(c.track.keyframes, c.ch.key, t);
  }

  function drawCurves(clip, chans, rotType) {
    clearGroup(gCurves);
    const dur = clip.duration || 1;
    const t0 = Math.max(view.t0, 0);
    const t1 = Math.min(view.t1, dur);
    const samples = clamp(Math.round(geo.gw / 3), 12, 600);
    for (const c of chans) {
      const segmented = c.ch.kind === "rot" && rotType === "Quaternion";
      let d = "";
      for (let i = 0; i <= samples; i++) {
        const t = t0 + ((t1 - t0) * i) / samples;
        const v = curveSampleValue(chans, c, t, rotType);
        const x = xFromTime(t);
        const y = yFromVal(v);
        d += (i === 0 ? "M" : "L") + x.toFixed(1) + " " + y.toFixed(1) + " ";
      }
      const path = svgEl("path", { d: d.trim(), fill: "none", stroke: c.ch.color, class: "rsw-curve__path" + (segmented ? " rsw-curve__path--seg" : "") });
      path.style.stroke = c.ch.color;
      gCurves.appendChild(path);
    }
  }

  function pointSelected(trackKey, kfId, chKey) {
    return selPoints.some((p) => p.trackKey === trackKey && p.kfId === kfId && p.chKey === chKey);
  }

  function drawPoints(clip, chans, rotType) {
    clearGroup(gPoints);
    clearGroup(gTangents);
    const dur = clip.duration || 1;
    for (const c of chans) {
      const kfs = c.track.keyframes;
      const allowTan = rotType === "Euler" || c.ch.kind === "pos";
      for (let i = 0; i < kfs.length; i++) {
        const kf = kfs[i];
        const val = channelValue(kf, c.ch.key);
        const x = xFromTime(kf.time);
        const y = yFromVal(val);
        if (x < geo.gx - 8 || x > geo.gx + geo.gw + 8) continue;
        const sel = pointSelected(c.trackKey, kf.id, c.ch.key);

        if (sel && allowTan && (kf.interp === "Cubic" || kf.interp == null)) {
          drawTangentHandle(c, kfs, i, kf, x, y, "o");
          drawTangentHandle(c, kfs, i, kf, x, y, "i");
        }
        const pt = svgEl("circle", {
          cx: x.toFixed(1), cy: y.toFixed(1), r: sel ? 5 : 4,
          class: "rsw-curve__pt" + (sel ? " rsw-curve__pt--sel" : "") + (kf.label === "End" ? " rsw-curve__pt--end" : ""),
        });
        pt.style.fill = c.ch.color;
        pt.dataset.tk = c.trackKey;
        pt.dataset.kf = kf.id;
        pt.dataset.ch = c.ch.key;
        gPoints.appendChild(pt);
      }
    }
  }

  function drawTangentHandle(c, kfs, i, kf, x, y, side) {
    const dur = getClip().duration || 1;
    const offT = ((view.t1 - view.t0) || 1) * 0.05;
    const slope = resolvedTangent(kfs, i, c.ch.key, side);
    const set = isTangentSet(kf, c.ch.key, side);
    const dirSign = side === "o" ? 1 : -1;
    const ht = kf.time + dirSign * offT;
    const hv = channelValue(kf, c.ch.key) + slope * (dirSign * offT);
    const hx = xFromTime(ht);
    const hy = yFromVal(hv);
    const line = svgEl("line", { x1: x.toFixed(1), y1: y.toFixed(1), x2: hx.toFixed(1), y2: hy.toFixed(1), class: "rsw-curve__tanline" });
    gTangents.appendChild(line);
    const dot = svgEl("rect", {
      x: (hx - 3.5).toFixed(1), y: (hy - 3.5).toFixed(1), width: 7, height: 7,
      class: "rsw-curve__tan" + (set ? " rsw-curve__tan--set" : " rsw-curve__tan--auto"),
    });
    dot.dataset.tk = c.trackKey;
    dot.dataset.kf = kf.id;
    dot.dataset.ch = c.ch.key;
    dot.dataset.side = side;
    gTangents.appendChild(dot);
  }

  function drawScrub() {
    clearGroup(gScrub);
    const t = getCurrentTime();
    const x = clamp(xFromTime(t), geo.gx, geo.gx + geo.gw);
    const line = svgEl("line", { x1: x.toFixed(1), y1: geo.gy, x2: x.toFixed(1), y2: geo.gy + geo.gh, class: "rsw-curve__scrub" });
    gScrub.appendChild(line);
  }

  function drawGraph() {
    if (!visible || !svg) return;
    const clip = getClip();
    if (!clip) return;
    measure();
    const rotType = getRotationType();
    const chans = visibleChannels(clip);
    drawGrid(clip);
    drawCurves(clip, chans, rotType);
    drawPoints(clip, chans, rotType);
    drawScrub();
  }


  function findChannelOf(trackKey, chKey, clip) {
    const tr = clip.tracks[trackKey];
    if (!tr) return null;
    const ch = chMeta(chKey);
    return ch ? { trackKey, partName: tr.partName, track: tr, ch } : null;
  }

  function wireGraphInteractions() {
    svg.addEventListener("pointerdown", onPointerDown);
    svg.addEventListener("wheel", onWheel, { passive: false });
    svg.addEventListener("contextmenu", onContextMenu);
  }

  function onWheel(ev) {
    ev.preventDefault();
    const p = localPt(ev);
    const factor = ev.deltaY < 0 ? 0.85 : 1.18;
    if (ev.shiftKey) {

      const vAt = valFromY(p.y);
      view.vMin = vAt - (vAt - view.vMin) * factor;
      view.vMax = vAt + (view.vMax - vAt) * factor;
    } else {

      const tAt = timeFromX(p.x);
      view.t0 = tAt - (tAt - view.t0) * factor;
      view.t1 = tAt + (view.t1 - tAt) * factor;
    }
    drawGraph();
  }

  function onPointerDown(ev) {
    if (ev.button === 2) return;                     
    closeMenu();
    const target = ev.target;
    const p = localPt(ev);

    if (ev.button === 1 || ev.altKey) { startPan(ev); return; }

    if (target && target.dataset && target.dataset.side) {
      startTangentDrag(ev, target);
      return;
    }

    if (target && target.dataset && target.dataset.kf) {
      onPointMouseDown(ev, target);
      return;
    }

    startBoxOrScrub(ev, p);
  }

  function startPan(ev) {
    ev.preventDefault();
    const startT0 = view.t0, startT1 = view.t1, startVMin = view.vMin, startVMax = view.vMax;
    const start = localPt(ev);
    const spanT = startT1 - startT0, spanV = startVMax - startVMin;
    const move = (e) => {
      const cur = localPt(e);
      const dt = ((cur.x - start.x) / geo.gw) * spanT;
      const dv = ((cur.y - start.y) / geo.gh) * spanV;
      view.t0 = startT0 - dt; view.t1 = startT1 - dt;
      view.vMin = startVMin + dv; view.vMax = startVMax + dv;
      drawGraph();
    };
    const up = () => { window.removeEventListener("pointermove", move); window.removeEventListener("pointerup", up); };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function onPointMouseDown(ev, node) {
    ev.preventDefault();
    const ref = { trackKey: node.dataset.tk, kfId: node.dataset.kf, chKey: node.dataset.ch };
    const clip = getClip();
    if (ev.ctrlKey || ev.metaKey) {
      const idx = selPoints.findIndex((q) => q.trackKey === ref.trackKey && q.kfId === ref.kfId && q.chKey === ref.chKey);
      if (idx >= 0) selPoints.splice(idx, 1); else selPoints.push(ref);
    } else if (ev.shiftKey && lastClickPoint && lastClickPoint.chKey === ref.chKey && lastClickPoint.trackKey === ref.trackKey) {

      const tr = clip.tracks[ref.trackKey];
      const order = tr.keyframes.map((k) => k.id);
      const a = order.indexOf(lastClickPoint.kfId);
      const b = order.indexOf(ref.kfId);
      if (a >= 0 && b >= 0) {
        const lo = Math.min(a, b), hi = Math.max(a, b);
        for (let i = lo; i <= hi; i++) {
          const kid = order[i];
          if (!pointSelected(ref.trackKey, kid, ref.chKey)) selPoints.push({ trackKey: ref.trackKey, kfId: kid, chKey: ref.chKey });
        }
      }
    } else {
      if (!pointSelected(ref.trackKey, ref.kfId, ref.chKey)) selPoints = [ref];
    }
    lastClickPoint = ref;
    setSelectedTrack(ref.trackKey);
    drawGraph();
    updateProps();
    startPointDrag(ev, ref);
  }

  function startPointDrag(ev, ref) {
    const start = localPt(ev);
    const startTime = timeFromX(start.x);
    const startVal = valFromY(start.y);
    let moved = false;
    const dragChan = ref.chKey;

    const moveSet = new Map();
    for (const p of selPoints) moveSet.set(p.trackKey + ":" + p.kfId, { trackKey: p.trackKey, kfId: p.kfId });
    const moveList = Array.from(moveSet.values());

    const valueList = selPoints.filter((p) => p.chKey === dragChan).map((p) => ({ trackKey: p.trackKey, kfId: p.kfId }));
    const move = (e) => {
      const cur = localPt(e);
      const dt = timeFromX(cur.x) - startTime;
      const dv = valFromY(cur.y) - startVal;
      if (Math.abs(cur.x - start.x) > 2 || Math.abs(cur.y - start.y) > 2) moved = true;

      if (moved) previewDrag(dt, dv, dragChan, moveList, valueList);
    };
    const up = (e) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!moved) return;
      const cur = localPt(e);
      const dt = timeFromX(cur.x) - startTime;
      const dv = valFromY(cur.y) - startVal;
      dragCurveKeyframes(moveList, dt, dragChan, valueList, dv);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function previewDrag(dt, dv, dragChan, moveList, valueList) {

    const moveKeys = new Set(moveList.map((m) => m.trackKey + ":" + m.kfId));
    const valKeys = new Set(valueList.map((m) => m.trackKey + ":" + m.kfId));
    const dxPx = (dt / ((view.t1 - view.t0) || 1)) * geo.gw;
    const dyPx = -(dv / ((view.vMax - view.vMin) || 1)) * geo.gh;
    gPoints.querySelectorAll("circle").forEach((node) => {
      const id = node.dataset.tk + ":" + node.dataset.kf;
      let tx = 0, ty = 0;
      if (moveKeys.has(id)) tx = dxPx;
      if (valKeys.has(id) && node.dataset.ch === dragChan) ty = dyPx;
      node.setAttribute("transform", tx || ty ? "translate(" + tx.toFixed(1) + " " + ty.toFixed(1) + ")" : "");
    });
  }

  function startTangentDrag(ev, node) {
    ev.preventDefault();
    const trackKey = node.dataset.tk, kfId = node.dataset.kf, chKey = node.dataset.ch, side = node.dataset.side;
    const clip = getClip();
    const tr = clip.tracks[trackKey];
    const kf = tr && tr.keyframes.find((k) => k.id === kfId);
    if (!kf) return;
    const offT = ((view.t1 - view.t0) || 1) * 0.05;
    const kfVal = channelValue(kf, chKey);
    const dirSign = side === "o" ? 1 : -1;
    let moved = false;
    const move = (e) => {
      moved = true;
      const cur = localPt(e);
      const hv = valFromY(cur.y);

      const slope = (hv - kfVal) / (dirSign * offT);

      const hx = xFromTime(kf.time + dirSign * offT);
      const hy = yFromVal(kfVal + slope * (dirSign * offT));
      node.setAttribute("x", (hx - 3.5).toFixed(1));
      node.setAttribute("y", (hy - 3.5).toFixed(1));
    };
    const up = (e) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!moved) return;
      const cur = localPt(e);
      const hv = valFromY(cur.y);
      const slope = (hv - kfVal) / (dirSign * offT);
      setTangentValue(trackKey, kfId, chKey, side, slope);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function startBoxOrScrub(ev, p0) {
    ev.preventDefault();
    let moved = false;
    const rect = svgEl("rect", { class: "rsw-curve__boxsel", x: p0.x, y: p0.y, width: 0, height: 0 });
    const move = (e) => {
      const cur = localPt(e);
      if (Math.abs(cur.x - p0.x) > 3 || Math.abs(cur.y - p0.y) > 3) {
        if (!moved) { moved = true; gBox.appendChild(rect); }
      }
      if (moved) {
        const x = Math.min(p0.x, cur.x), y = Math.min(p0.y, cur.y);
        rect.setAttribute("x", x); rect.setAttribute("y", y);
        rect.setAttribute("width", Math.abs(cur.x - p0.x)); rect.setAttribute("height", Math.abs(cur.y - p0.y));
      }
    };
    const up = (e) => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      if (!moved) {


        const clip = getClip();
        if (!clip) return;
        const t = clamp(timeFromX(p0.x), 0, clip.duration || 0);
        setTime(t);
        return;
      }
      const cur = localPt(e);
      selectInBox(Math.min(p0.x, cur.x), Math.min(p0.y, cur.y), Math.abs(cur.x - p0.x), Math.abs(cur.y - p0.y), e.ctrlKey || e.metaKey);
      if (rect.parentNode) rect.parentNode.removeChild(rect);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  function selectInBox(x, y, w, h, additive) {
    if (!additive) selPoints = [];
    gPoints.querySelectorAll("circle").forEach((node) => {
      const cx = parseFloat(node.getAttribute("cx")); const cy = parseFloat(node.getAttribute("cy"));
      if (cx >= x && cx <= x + w && cy >= y && cy <= y + h) {
        const ref = { trackKey: node.dataset.tk, kfId: node.dataset.kf, chKey: node.dataset.ch };
        if (!pointSelected(ref.trackKey, ref.kfId, ref.chKey)) selPoints.push(ref);
      }
    });
    drawGraph();
    updateProps();
  }


  function onContextMenu(ev) {
    ev.preventDefault();
    const target = ev.target;
    if (target && target.dataset && (target.dataset.kf || target.dataset.side)) {
      const ref = { trackKey: target.dataset.tk, kfId: target.dataset.kf, chKey: target.dataset.ch };
      if (!pointSelected(ref.trackKey, ref.kfId, ref.chKey)) {
        selPoints = [ref];
        lastClickPoint = ref;
        drawGraph();
        updateProps();
      }
    }
    openMenu(ev.clientX, ev.clientY);
  }

  function distinctKfs() {
    const m = new Map();
    for (const p of selPoints) m.set(p.trackKey + ":" + p.kfId, { trackKey: p.trackKey, kfId: p.kfId });
    return Array.from(m.values());
  }
  function focusedChannel() {
    if (!selPoints.length) return null;
    const ch = selPoints[0].chKey;
    return selPoints.every((p) => p.chKey === ch) ? ch : null;
  }

  function closeMenu() {


    menuListeners.disposeAll();
    if (menuEl && menuEl.parentNode) menuEl.parentNode.removeChild(menuEl);
    menuEl = null;
  }


  function onMenuOutsidePointerDown(ev) {
    if (menuEl && !menuEl.contains(ev.target)) closeMenu();
  }
  function openMenu(cx, cy) {
    closeMenu();
    const refs = distinctKfs();
    const hasSel = refs.length > 0;
    const menu = el("div", "rsw-curve__menu");
    const item = (label, enabled, onClick, danger) => {
      const it = el("div", "rsw-curve__mi" + (danger ? " rsw-curve__mi--danger" : "") + (enabled ? "" : " rsw-curve__mi--off"), label);
      if (enabled) it.addEventListener("click", () => { closeMenu(); onClick(); });
      return it;
    };
    const sep = () => el("div", "rsw-curve__msep");
    const lbl = (t) => el("div", "rsw-curve__mlbl", t);

    menu.appendChild(item("Delete Keyframe", hasSel, () => { deleteKeyframes(refs); selPoints = []; }, true));
    menu.appendChild(item("Copy", hasSel, doCopy));
    menu.appendChild(item("Paste", !!clipboard, doPaste));
    menu.appendChild(item("Duplicate", hasSel, () => duplicateKeyframes(refs)));
    menu.appendChild(sep());
    menu.appendChild(lbl("Interpolation Mode"));
    INTERP_MODES.forEach((m) => menu.appendChild(item(m, hasSel, () => setInterpolation(refs, m))));
    menu.appendChild(sep());
    menu.appendChild(item("Set Tangent To Zero", hasSel, () => zeroTangents(refs, focusedChannel())));
    menu.appendChild(item("Reset Tangent (Auto)", hasSel, () => resetTangents(refs, focusedChannel())));
    menu.appendChild(sep());
    menu.appendChild(lbl("Generate Curve"));
    GEN_KINDS.forEach((kind) => GEN_DIRS.forEach((dir) => {
      menu.appendChild(item(kind + " " + dir, hasSel, () => generateCurveForSelection(refs, kind, dir)));
    }));
    menu.appendChild(sep());
    menu.appendChild(item("Rename Final Keyframe to End", hasSel, () => {
      const ref = refs[refs.length - 1];
      markEndKeyframe(ref.trackKey, ref.kfId);
    }));

    document.body.appendChild(menu);
    const mw = menu.offsetWidth || 220, mh = menu.offsetHeight || 320;
    menu.style.left = Math.min(cx, window.innerWidth - mw - 6) + "px";
    menu.style.top = Math.min(cy, window.innerHeight - mh - 6) + "px";
    menuEl = menu;


    setTimeout(() => {
      if (!menuEl) return;                                  
      menuListeners.add(document, "pointerdown", onMenuOutsidePointerDown, true);
    }, 0);
  }

  function doCopy() {
    const clip = getClip();
    const refs = distinctKfs();
    const items = [];
    for (const ref of refs) {
      const tr = clip.tracks[ref.trackKey];
      const kf = tr && tr.keyframes.find((k) => k.id === ref.kfId);
      if (kf) items.push({ trackKey: ref.trackKey, partName: tr.partName, time: kf.time, pos: kf.pos, rot: kf.rot, style: kf.style, dir: kf.dir });
    }
    clipboard = items.length ? { items } : null;
  }
  function doPaste() {
    if (!clipboard) return;
    pasteKeyframes(clipboard, getCurrentTime());
  }


  function updateProps() {
    if (!propsEl) return;
    propsEl.textContent = "";
    const clip = getClip();
    if (!clip || !selPoints.length) {
      propsEl.appendChild(el("div", "rsw-curve__phint", "Selecione uma keyframe para editar valor, interpolacao e tangentes."));
      return;
    }
    const ref = selPoints[selPoints.length - 1];
    const tr = clip.tracks[ref.trackKey];
    const kf = tr && tr.keyframes.find((k) => k.id === ref.kfId);
    if (!kf) return;
    const ch = chMeta(ref.chKey);
    propsEl.appendChild(el("div", "rsw-curve__phead", (tr.partName || ref.trackKey) + " - " + (ch ? ch.label : ref.chKey)));

    const grid = el("div", "rsw-curve__pgrid");

    grid.appendChild(el("span", "rsw-curve__plbl", "Tempo"));
    grid.appendChild(el("span", "rsw-curve__pval", formatSecFrames(kf.time, clip.fps)));
    grid.appendChild(el("span", "rsw-curve__plbl", "Valor"));
    const valIn = el("input", "rsw-curve__pnum");
    valIn.type = "number"; valIn.step = "0.01"; valIn.value = String(Math.round(channelValue(kf, ref.chKey) * 1000) / 1000);
    valIn.addEventListener("change", () => { const v = parseFloat(valIn.value); if (Number.isFinite(v)) setKeyframeChannelValue(ref.trackKey, ref.kfId, ref.chKey, v); });
    grid.appendChild(valIn);

    grid.appendChild(el("span", "rsw-curve__plbl", "Interp"));
    const interpSel = el("select", "rsw-curve__psel");
    INTERP_MODES.forEach((m) => { const o = el("option", null, m); o.value = m; if ((kf.interp || "Cubic") === m) o.selected = true; interpSel.appendChild(o); });
    interpSel.addEventListener("change", () => setInterpolation(distinctKfs(), interpSel.value));
    grid.appendChild(interpSel);

    grid.appendChild(el("span", "rsw-curve__plbl", "Tan In"));
    grid.appendChild(tanInput(ref, "i", kf));
    grid.appendChild(el("span", "rsw-curve__plbl", "Tan Out"));
    grid.appendChild(tanInput(ref, "o", kf));
    propsEl.appendChild(grid);

    const ops = el("div", "rsw-curve__pops");
    const b1 = el("button", "rsw-curve__pbtn", "Zerar tangente");
    b1.type = "button";
    b1.addEventListener("click", () => zeroTangents(distinctKfs(), focusedChannel()));
    const b2 = el("button", "rsw-curve__pbtn", "Auto tangente");
    b2.type = "button";
    b2.addEventListener("click", () => resetTangents(distinctKfs(), focusedChannel()));
    ops.append(b1, b2);
    propsEl.appendChild(ops);
  }
  function tanInput(ref, side, kf) {
    const inp = el("input", "rsw-curve__pnum");
    inp.type = "number"; inp.step = "0.1";
    const set = isTangentSet(kf, ref.chKey, side);
    const slope = kf.tan && kf.tan[ref.chKey] ? kf.tan[ref.chKey][side] : null;
    inp.value = set && slope != null ? String(Math.round(slope * 1000) / 1000) : "";
    inp.placeholder = "auto";
    inp.addEventListener("change", () => {
      const raw = inp.value.trim();
      if (raw === "") { resetTangents([{ trackKey: ref.trackKey, kfId: ref.kfId }], ref.chKey); return; }
      const v = parseFloat(raw);
      if (Number.isFinite(v)) setTangentValue(ref.trackKey, ref.kfId, ref.chKey, side, v);
    });
    return inp;
  }


  function buildLegend() {
    const leg = el("div", "rsw-curve__legend");
    [["X", CURVE_CHANNELS.find((c) => c.axis === "x").color], ["Y", CURVE_CHANNELS.find((c) => c.axis === "y").color], ["Z", CURVE_CHANNELS.find((c) => c.axis === "z").color]].forEach(([ax, color]) => {
      const item = el("span", "rsw-curve__leg-item");
      const dot = el("span", "rsw-curve__leg-dot");
      dot.style.background = color;
      item.append(dot, el("span", null, ax));
      leg.appendChild(item);
    });
    const seg = el("span", "rsw-curve__leg-note", "Linhas tracejadas = rotacao Quaternion (segmentada)");
    leg.appendChild(seg);
    return leg;
  }


  function build() {
    const side = buildSide();
    const main = el("div", "rsw-curve__main");
    main.appendChild(buildGraph());
    main.appendChild(buildLegend());
    root.append(side, main);

    if (typeof ResizeObserver !== "undefined") {
      let raf = 0;
      ro = new ResizeObserver(() => { if (raf) return; raf = requestAnimationFrame(() => { raf = 0; drawGraph(); }); });
      ro.observe(graphWrap);
    }
  }
  build();


  function render() {
    if (!visible) return;
    const clip = getClip();
    if (!clip) { sideListEl.textContent = ""; clearAll(); return; }

    pruneSelection(clip);

    if (!expanded.size) {
      const sel = getSelectedTrackKey();
      const rows = tracksWithKfs(clip);
      if (sel && clip.tracks[sel]) expanded.add(sel);
      else if (rows.length) expanded.add(rows[0].key);
    }
    if (rotSel) rotSel.value = getRotationType();
    if (!viewInit || clip.duration !== lastDuration) {
      refitValue(visibleChannels(clip), clip);
      viewInit = true;
      lastDuration = clip.duration;
    }
    buildTrackList(clip);
    drawGraph();
    updateProps();
  }
  function pruneSelection(clip) {
    selPoints = selPoints.filter((p) => {
      const tr = clip.tracks[p.trackKey];
      return tr && tr.keyframes.some((k) => k.id === p.kfId);
    });
  }
  function clearAll() {
    if (gGrid) [gGrid, gCurves, gTangents, gPoints, gScrub, gBox].forEach(clearGroup);
  }
  function updateTime() {
    if (!visible || !svg) return;
    drawScrub();
  }
  function focusTrack(trackKey) {
    if (!visible) return;
    if (trackKey) expanded.add(trackKey);
    render();
    if (trackKey && sideListEl) {
      const row = sideListEl.querySelector('.rsw-curve__trk[data-key="' + cssEscape(trackKey) + '"]');
      if (row && row.scrollIntoView) row.scrollIntoView({ block: "nearest" });
    }
  }
  function cssEscape(s) { return String(s).replace(/["\\]/g, "\\$&"); }
  function setVisible(on) {
    visible = !!on;
    root.style.display = visible ? "" : "none";
    if (visible) render();
    else closeMenu();
  }
  function destroy() {
    closeMenu();
    if (ro) { try { ro.disconnect(); } catch (_) {} ro = null; }
  }

  function deleteSelection() {
    const refs = distinctKfs();
    if (refs.length) { deleteKeyframes(refs); selPoints = []; }
  }
  function hasSelection() { return selPoints.length > 0; }

  return {
    el: root,
    render,
    updateTime,
    focusTrack,
    setVisible,
    destroy,
    deleteSelection,
    hasSelection,
    copySelection: doCopy,
    pasteClipboard: doPaste,
    duplicateSelection: () => { const r = distinctKfs(); if (r.length) duplicateKeyframes(r); },
  };
}
