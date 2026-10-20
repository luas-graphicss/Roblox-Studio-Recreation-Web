import { bus } from "../core/eventBus.js";

import { createListenerScope } from "../core/listenerScope.js";
import { createIcon } from "./icons.js";
import { openConfirm, makeButton, openModal } from "./modal.js";
import {
  AnimEvents,
  open as storeOpen,
  close as storeClose,
  isOpen,
  isDirty,
  getClip,
  getAnimatableParts,
  getCurrentTime,
  isPlaying,
  getSpeed,
  getSelectedTrackKey,
  setTime,
  play,
  pause,
  stop,
  togglePlay,
  rewind,
  setLoopPlayback,
  setSpeed,
  setSelectedTrack,
  selectPartForTrack,
  addKeyframeAtCurrent,
  addKeyframeAtTime,
  deleteKeyframes,
  moveKeyframes,
  duplicateKeyframes,
  pasteKeyframes,
  setKeyframeEasing,
  markEndKeyframe,
  renameClip,
  setDuration,
  setLooping,
  setPriority,
  save as storeSave,
  publish as storePublish,

  getEvents,
  getMaxEvents,
  eventNameExists,
  addAnimationEvent,
  updateAnimationEvent,
  moveAnimationEvents,
  deleteAnimationEvents,
  duplicateAnimationEvents,
  pasteAnimationEvents,
  getEventTrackVisible,
  setEventTrackVisible,
  getPreviewIK,
  setPreviewIK,
} from "../animation/animationStore.js";
import {
  formatSecFrames,
  timeToFrame,
  PRIORITIES,
} from "../animation/animationModel.js";
import { EASING_STYLES, EASING_DIRECTIONS } from "../animation/easing.js";

let ui = null;                            
let unsubs = [];


const ANIM_MIN_H = 140;                       
const ANIM_MAX_FRAC = 0.72;                                        
const ANIM_H_KEY = "rsw.animEditor.height";
const ANIM_DEFAULT_H = 300;

function readStoredHeight() {
  try {
    const v = parseInt(window.localStorage.getItem(ANIM_H_KEY) || "", 10);
    return Number.isFinite(v) && v >= ANIM_MIN_H ? v : ANIM_DEFAULT_H;
  } catch (_) { return ANIM_DEFAULT_H; }
}
function storeHeight(h) {
  try { window.localStorage.setItem(ANIM_H_KEY, String(Math.round(h))); } catch (_) {}
}
let animHeight = readStoredHeight();

function clampDockHeight(h, ws) {
  const wsH = ws ? ws.getBoundingClientRect().height : 0;
  const max = wsH > 0 ? Math.max(ANIM_MIN_H, Math.min(wsH * ANIM_MAX_FRAC, wsH - 240)) : Number.MAX_SAFE_INTEGER;
  return Math.min(max, Math.max(ANIM_MIN_H, h));
}


const panelListeners = createListenerScope("animationEditor");

const menuListeners = createListenerScope("animationEditorMenu");


function mountPanel(root) {
  const ws = document.querySelector(".rsw-workspace");
  if (!ws) {
    root.classList.add("rsw-anim--floating");
    document.body.appendChild(root);
    return null;
  }
  const splitter = el("div", "rsw-splitter rsw-splitter--row rsw-anim__splitter");
  splitter.setAttribute("role", "separator");
  splitter.setAttribute("aria-orientation", "horizontal");
  root.classList.add("rsw-anim--docked");
  ws.appendChild(splitter);
  ws.appendChild(root);
  root.style.flex = `0 0 ${clampDockHeight(animHeight, ws)}px`;
  wireDockResize(splitter, root, ws);

  const onWinResize = () => {
    if (!ui || !ui.root) return;
    ui.root.style.flex = `0 0 ${clampDockHeight(animHeight, ws)}px`;
  };


  panelListeners.add(window, "resize", onWinResize);
  return splitter;
}

function wireDockResize(splitter, root, ws) {
  splitter.addEventListener("pointerdown", (e) => {
    if (e && typeof e.preventDefault === "function") e.preventDefault();
    const startY = e.clientY;
    const startH = root.getBoundingClientRect().height;
    const wsH = ws.getBoundingClientRect().height;
    const maxH = Math.max(ANIM_MIN_H, Math.min(wsH * ANIM_MAX_FRAC, wsH - 240));
    const overlay = el("div", "rsw-resize-overlay");
    overlay.style.cursor = "row-resize";
    document.body.appendChild(overlay);
    let latest = startH;
    let raf = 0;
    const onMove = (ev) => {
      const delta = startY - ev.clientY;                                       
      latest = Math.min(maxH, Math.max(ANIM_MIN_H, startH + delta));
      if (!raf) {
        raf = requestAnimationFrame(() => { raf = 0; root.style.flex = `0 0 ${latest}px`; });
      }
    };
    const onUp = () => {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      if (raf) cancelAnimationFrame(raf);
      if (overlay.remove) overlay.remove();
      animHeight = Math.round(latest);
      storeHeight(animHeight);
    };
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
  });
}
let selectedKfs = [];                        
let clipboard = null;                                                                     
let lastClickRef = null;                          


let selectedEvents = [];                                                        
let selectedEventSet = new Set();                                         
let eventClipboard = null;                           
let lastEventClickId = null;                                              


let lastInteraction = "keyframes";                          
const EVENT_REASONS = new Set([
  "Adicionar evento", "Editar evento", "Mover evento",
  "Deletar evento", "Duplicar evento", "Colar evento",
]);
const EVENT_DUP_OFFSET = 0.05;                                           

function el(tag, cls, text) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text != null) e.textContent = text;
  return e;
}


export function openAnimationEditor() {
  if (ui) return true;             
  if (!isOpen() && !storeOpen()) return false;                                  
  buildUI();
  bindEvents();
  fullRender();
  return true;
}

export async function requestCloseAnimationEditor() {
  if (!ui) return;
  if (isDirty()) {
    const choice = await openConfirm({
      title: "Fechar Animation Editor",
      message: "Há alterações não salvas nesta animação. O que deseja fazer?",
      buttons: [
        { label: "Salvar", value: "save", kind: "primary" },
        { label: "Descartar", value: "discard", kind: "danger" },
        { label: "Cancelar", value: "cancel", kind: "default" },
      ],
    });
    if (choice === "cancel" || choice == null) return;
    if (choice === "save") storeSave();
  }
  destroyUI();
  storeClose();
}

function forceCloseUI() {

  destroyUI();
}

export function isAnimationEditorOpen() {
  return !!ui;
}


function buildUI() {
  const root = el("div", "rsw-anim");


  const header = el("div", "rsw-anim__header");
  const titleIcon = createIcon("run", 16);
  titleIcon.classList.add("rsw-anim__titleicon");
  const nameInput = el("input", "rsw-anim__name");
  nameInput.type = "text";
  nameInput.spellcheck = false;
  nameInput.setAttribute("aria-label", "Nome da animação");
  let nameTimer = null;
  nameInput.addEventListener("input", () => {

    if (nameTimer) clearTimeout(nameTimer);
    nameTimer = setTimeout(() => {
      nameTimer = null;
      renameClip(nameInput.value);
    }, 350);
  });
  nameInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter") {
      if (nameTimer) clearTimeout(nameTimer);
      renameClip(nameInput.value);
      nameInput.blur();
    }
  });

  const headSpacer = el("div", "rsw-anim__spacer");
  const saveBtn = makeButton("Salvar", "primary", () => storeSave());
  saveBtn.classList.add("rsw-anim__hbtn");
  const publishBtn = makeButton("Publish", "default", openPublishDialog);
  publishBtn.classList.add("rsw-anim__hbtn");
  const closeBtn = el("button", "rsw-anim__close");
  closeBtn.type = "button";
  closeBtn.appendChild(createIcon("close", 14));
  closeBtn.title = "Fechar editor";
  closeBtn.addEventListener("click", () => { requestCloseAnimationEditor(); });

  header.append(titleIcon, nameInput, headSpacer, saveBtn, publishBtn, closeBtn);


  const toolbar = el("div", "rsw-anim__toolbar");

  const mkCtrl = (icon, title, onClick) => {
    const b = el("button", "rsw-anim__ctrl");
    b.type = "button";
    b.title = title;
    b.appendChild(createIcon(icon, 16));
    b.addEventListener("click", onClick);
    return b;
  };
  const rewindBtn = mkCtrl("undo", "Voltar ao início", () => rewind());
  const playBtn = mkCtrl("play", "Play / Pause (Espaço)", () => togglePlay());
  const stopBtn = mkCtrl("stop", "Stop", () => stop());
  const loopBtn = mkCtrl("redo", "Loop de playback", () => setLoopPlayback(!ui.loopPlayback));

  const speedSel = el("select", "rsw-anim__select");
  speedSel.title = "Velocidade de preview";
  [["0.25", "0.25×"], ["0.5", "0.5×"], ["1", "1× (normal)"], ["2", "2×"]].forEach(([v, lbl]) => {
    const o = el("option", null, lbl); o.value = v; if (v === "1") o.selected = true; speedSel.appendChild(o);
  });
  speedSel.addEventListener("change", () => setSpeed(parseFloat(speedSel.value)));

  const timeLabel = el("div", "rsw-anim__time", "0:00");
  timeLabel.title = "Tempo atual (segundos:frames)";

  const durWrap = el("label", "rsw-anim__field");
  durWrap.appendChild(el("span", "rsw-anim__field-lbl", "Duração (s)"));
  const durInput = el("input", "rsw-anim__num");
  durInput.type = "number"; durInput.min = "0.1"; durInput.step = "0.1";
  durInput.addEventListener("change", () => setDuration(parseFloat(durInput.value)));
  durWrap.appendChild(durInput);

  const prioWrap = el("label", "rsw-anim__field");
  prioWrap.appendChild(el("span", "rsw-anim__field-lbl", "Prioridade"));
  const prioSel = el("select", "rsw-anim__select");
  PRIORITIES.forEach((p) => { const o = el("option", null, p); o.value = p; prioSel.appendChild(o); });
  prioSel.addEventListener("change", () => setPriority(prioSel.value));
  prioWrap.appendChild(prioSel);

  const loopAnimWrap = el("label", "rsw-anim__check");
  const loopAnimChk = el("input");
  loopAnimChk.type = "checkbox";
  loopAnimChk.addEventListener("change", () => setLooping(loopAnimChk.checked));
  loopAnimWrap.append(loopAnimChk, el("span", null, "Looping"));

  const addKfBtn = makeButton("+ Keyframe", "default", () => addKeyframeAtCurrent());
  addKfBtn.classList.add("rsw-anim__hbtn");
  addKfBtn.title = "Adicionar keyframe na parte selecionada (no frame atual)";


  const addEventBtn = makeButton("+ Evento", "default", () => openEventDialog(null));
  addEventBtn.classList.add("rsw-anim__hbtn");
  addEventBtn.title = "Add Event at Current Time — adiciona um marcador de evento no tempo atual";

  const viewBtn = mkCtrl("command", "View — opções de visualização", (e) => {
    e.stopPropagation();
    openViewMenu(viewBtn);
  });
  viewBtn.classList.add("rsw-anim__viewbtn");

  const eventToggleBtn = mkCtrl("effect", "Mostrar/ocultar track de eventos", () => toggleEventTrack());
  eventToggleBtn.classList.add("rsw-anim__evtoggle");


  const ikBtn = mkCtrl("uiconstraint", "Preview with IK: aplica IKControls sobre a pose", () => {
    setPreviewIK(!getPreviewIK());
    ikBtn.classList.toggle("rsw-anim__ctrl--active", getPreviewIK());
  });
  if (getPreviewIK()) ikBtn.classList.add("rsw-anim__ctrl--active");
  toolbar.append(
    rewindBtn, playBtn, stopBtn, loopBtn, speedSel,
    el("div", "rsw-anim__sep"), timeLabel,
    el("div", "rsw-anim__sep"), durWrap, prioWrap, loopAnimWrap,
    el("div", "rsw-anim__spacer"), viewBtn, ikBtn, eventToggleBtn, addEventBtn, addKfBtn,
  );


  const bodyEl = el("div", "rsw-anim__body");

  const trackList = el("div", "rsw-anim__tracks");
  const trackHead = el("div", "rsw-anim__tracks-head", "Tracks");
  const trackScroll = el("div", "rsw-anim__tracks-scroll");
  trackList.append(trackHead, trackScroll);

  const timeline = el("div", "rsw-anim__timeline");
  const ruler = el("div", "rsw-anim__ruler");
  const lanes = el("div", "rsw-anim__lanes");
  const scrubber = el("div", "rsw-anim__scrubber");
  const boxSel = el("div", "rsw-anim__boxsel");
  boxSel.style.display = "none";


  const eventTrack = el("div", "rsw-anim__events");
  eventTrack.setAttribute("role", "group");
  eventTrack.setAttribute("aria-label", "Track de eventos");
  const eventTag = el("span", "rsw-anim__events-tag", "Events");
  eventTrack.appendChild(eventTag);                                                 

  timeline.append(ruler, lanes, eventTrack, scrubber, boxSel);

  const easing = buildEasingPanel();

  bodyEl.append(trackList, timeline, easing.el);

  root.append(header, toolbar, bodyEl);

  ui = {
    root, splitter: null, nameInput, saveBtn, publishBtn,
    playBtn, loopBtn, speedSel, timeLabel, durInput, prioSel, loopAnimChk,
    trackScroll, ruler, lanes, scrubber, boxSel, timeline,
    easing,
    eventTrack, eventTag,
    eventToggleBtn,
    loopPlayback: false,
    laneEls: new Map(),                            
    kfEls: new Map(),                   
    eventEls: new Map(),                      
  };
  ui.splitter = mountPanel(root);                                                


  setupTimelineInteractions();

  setupEventTrackInteractions();

  applyEventTrackVisibility();

  panelListeners.add(document, "keydown", onKeyDown, true);
}

function buildEasingPanel() {
  const root = el("div", "rsw-anim__easing");
  root.appendChild(el("div", "rsw-anim__easing-head", "Easing"));
  const info = el("div", "rsw-anim__easing-info", "Selecione uma keyframe");
  root.appendChild(info);

  const styleWrap = el("label", "rsw-anim__field rsw-anim__field--col");
  styleWrap.appendChild(el("span", "rsw-anim__field-lbl", "Style"));
  const styleSel = el("select", "rsw-anim__select");
  EASING_STYLES.forEach((s) => { const o = el("option", null, s); o.value = s; styleSel.appendChild(o); });
  styleWrap.appendChild(styleSel);

  const dirWrap = el("label", "rsw-anim__field rsw-anim__field--col");
  dirWrap.appendChild(el("span", "rsw-anim__field-lbl", "Direction"));
  const dirSel = el("select", "rsw-anim__select");
  EASING_DIRECTIONS.forEach((d) => { const o = el("option", null, d); o.value = d; dirSel.appendChild(o); });
  dirWrap.appendChild(dirSel);

  styleSel.addEventListener("change", () => applyEasingToSelection(styleSel.value, null));
  dirSel.addEventListener("change", () => applyEasingToSelection(null, dirSel.value));

  root.append(styleWrap, dirWrap);


  const ops = el("div", "rsw-anim__easing-ops");
  ops.append(
    makeButton("Duplicar", "default", () => { if (selectedKfs.length) duplicateKeyframes(selectedKfs); }),
    makeButton("Deletar", "danger", () => { if (selectedKfs.length) { deleteKeyframes(selectedKfs); selectedKfs = []; } }),
    makeButton('Marcar "End"', "default", () => {
      if (selectedKfs.length === 1) markEndKeyframe(selectedKfs[0].trackKey, selectedKfs[0].kfId);
    }),
  );
  root.appendChild(ops);

  return { el: root, info, styleSel, dirWrap, styleWrap, dirSel, ops };
}

function applyEasingToSelection(style, dir) {
  if (!selectedKfs.length) return;
  setKeyframeEasing(selectedKfs, style, dir);
}


function bindEvents() {
  unsubs.push(bus.on(AnimEvents.ClipChanged, (p) => {


    if (p && EVENT_REASONS.has(p.reason)) {
      pruneEventSelection();
      renderEvents();
    } else {
      fullRender();
    }
  }));
  unsubs.push(bus.on(AnimEvents.TimeChanged, (p) => updateTimeUI(p)));
  unsubs.push(bus.on(AnimEvents.PlaybackChanged, (p) => updatePlaybackUI(p)));
  unsubs.push(bus.on(AnimEvents.SelectionChanged, (p) => updateTrackHighlight(p && p.trackKey)));
  unsubs.push(bus.on("anim:force-close", () => forceCloseUI()));

  unsubs.push(bus.on("anim:event-track-visibility", () => applyEventTrackVisibility()));
  unsubs.push(bus.on("anim:marker-flash", (p) => flashEventMarker(p && p.id)));
}

function destroyUI() {
  if (!ui) return;


  closeAnyMenu();
  panelListeners.disposeAll();
  for (const u of unsubs) { try { u(); } catch (_) {} }
  unsubs = [];
  if (ui.splitter && ui.splitter.parentNode) ui.splitter.parentNode.removeChild(ui.splitter);
  if (ui.root && ui.root.parentNode) ui.root.parentNode.removeChild(ui.root);
  ui = null;
  selectedKfs = [];
  lastClickRef = null;
  clearEventSelection();
  eventClipboard = null;
  lastEventClickId = null;
  lastInteraction = "keyframes";
}


function fullRender() {
  if (!ui) return;
  const clip = getClip();
  if (!clip) return;

  if (document.activeElement !== ui.nameInput) ui.nameInput.value = clip.name;
  if (document.activeElement !== ui.durInput) ui.durInput.value = String(clip.duration);
  ui.prioSel.value = clip.priority;
  ui.loopAnimChk.checked = !!clip.looping;

  renderRuler(clip);
  renderTracks(clip);
  pruneEventSelection();
  renderEvents();
  applyEventTrackVisibility();
  updateTimeUI({ time: getCurrentTime(), frame: timeToFrame(getCurrentTime(), clip.fps), fromPlayback: false });
  updateEasingPanel();
}

function renderRuler(clip) {
  const ruler = ui.ruler;
  ruler.textContent = "";
  const dur = clip.duration;
  const secs = Math.ceil(dur);
  for (let s = 0; s <= secs; s++) {
    const t = Math.min(s, dur);
    const tick = el("div", "rsw-anim__tick");
    tick.style.left = pct(t / dur) + "%";
    tick.appendChild(el("span", "rsw-anim__tick-lbl", formatSecFrames(t, clip.fps)));
    ruler.appendChild(tick);
  }
}

function pct(v) {
  const n = Math.max(0, Math.min(1, v || 0));
  return (n * 100).toFixed(3);
}


function renderTracks(clip) {
  const parts = getAnimatableParts();
  ui.trackScroll.textContent = "";
  ui.lanes.textContent = "";
  ui.laneEls.clear();
  ui.kfEls.clear();

  const selKey = getSelectedTrackKey();
  for (const part of parts) {
    const hasTrack = !!clip.tracks[part.key];

    const row = el("div", "rsw-anim__track" + (hasTrack ? " rsw-anim__track--active" : ""));
    row.dataset.key = part.key;
    const dot = el("span", "rsw-anim__track-dot");
    const label = el("span", "rsw-anim__track-name", part.name);
    row.append(dot, label);
    row.addEventListener("click", () => selectPartForTrack(part.key));
    if (part.key === selKey) row.classList.add("rsw-anim__track--sel");
    ui.trackScroll.appendChild(row);


    const lane = el("div", "rsw-anim__lane");
    lane.dataset.key = part.key;
    if (part.key === selKey) lane.classList.add("rsw-anim__lane--sel");

    lane.addEventListener("dblclick", (e) => {
      const t = xToTime(e.clientX);
      addKeyframeAtTime(part.key, t);
    });
    ui.lanes.appendChild(lane);
    ui.laneEls.set(part.key, lane);


    const track = clip.tracks[part.key];
    if (track) {
      for (const kf of track.keyframes) {
        const dia = el("div", "rsw-anim__kf");
        dia.style.left = pct(kf.time / clip.duration) + "%";
        dia.dataset.kfId = kf.id;
        dia.dataset.trackKey = part.key;
        if (kf.label === "End") dia.classList.add("rsw-anim__kf--end");
        if (isSelectedKf(part.key, kf.id)) dia.classList.add("rsw-anim__kf--sel");
        attachKeyframeHandlers(dia, part.key, kf);
        lane.appendChild(dia);
        ui.kfEls.set(kf.id, dia);
      }
    }
  }
}


function isSelectedKf(trackKey, kfId) {
  return selectedKfs.some((r) => r.trackKey === trackKey && r.kfId === kfId);
}

function attachKeyframeHandlers(dia, trackKey, kf) {
  let dragging = false;
  let moved = false;
  let startX = 0;

  dia.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    if (e.button !== 0) return;

    if (e.ctrlKey || e.metaKey) {
      toggleKfSelection(trackKey, kf.id);
    } else if (e.shiftKey && lastClickRef && lastClickRef.trackKey === trackKey) {
      selectKfRange(trackKey, lastClickRef.kfId, kf.id);
    } else if (!isSelectedKf(trackKey, kf.id)) {
      selectedKfs = [{ trackKey, kfId: kf.id }];
    }
    lastClickRef = { trackKey, kfId: kf.id };
    refreshKfSelectionVisuals();
    updateEasingPanel();

    dragging = true; moved = false; startX = e.clientX;
    const onMove = (me) => {
      const dx = me.clientX - startX;
      if (Math.abs(dx) > 2) moved = true;
    };
    const onUp = (ue) => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseup", onUp, true);
      dragging = false;
      if (moved) {
        const clip = getClip();
        const deltaTime = (ue.clientX - startX) / laneWidth() * clip.duration;
        moveKeyframes(selectedKfs.slice(), deltaTime);
      }
    };
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);
  });

  dia.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!isSelectedKf(trackKey, kf.id)) {
      selectedKfs = [{ trackKey, kfId: kf.id }];
      refreshKfSelectionVisuals();
      updateEasingPanel();
    }
    openKeyframeMenu(e.clientX, e.clientY);
  });
}

function toggleKfSelection(trackKey, kfId) {
  const i = selectedKfs.findIndex((r) => r.trackKey === trackKey && r.kfId === kfId);
  if (i >= 0) selectedKfs.splice(i, 1);
  else selectedKfs.push({ trackKey, kfId });
}

function selectKfRange(trackKey, fromId, toId) {
  const clip = getClip();
  const track = clip.tracks[trackKey];
  if (!track) return;
  const ids = track.keyframes.map((k) => k.id);
  const a = ids.indexOf(fromId);
  const b = ids.indexOf(toId);
  if (a === -1 || b === -1) return;
  const [lo, hi] = a < b ? [a, b] : [b, a];
  for (let i = lo; i <= hi; i++) {
    if (!isSelectedKf(trackKey, ids[i])) selectedKfs.push({ trackKey, kfId: ids[i] });
  }
}

function refreshKfSelectionVisuals() {
  if (!ui) return;
  ui.kfEls.forEach((dia, kfId) => {
    const tk = dia.dataset.trackKey;
    dia.classList.toggle("rsw-anim__kf--sel", isSelectedKf(tk, kfId));
  });
}

function updateEasingPanel() {
  if (!ui) return;
  const e = ui.easing;
  if (selectedKfs.length === 0) {
    e.info.textContent = "Selecione uma keyframe";
    e.styleSel.disabled = true; e.dirSel.disabled = true;
    return;
  }
  e.styleSel.disabled = false; e.dirSel.disabled = false;
  if (selectedKfs.length === 1) {
    const clip = getClip();
    const t = clip.tracks[selectedKfs[0].trackKey];
    const kf = t && t.keyframes.find((k) => k.id === selectedKfs[0].kfId);
    if (kf) {
      e.info.textContent = (t.partName || "") + " @ " + formatSecFrames(kf.time, clip.fps);
      e.styleSel.value = kf.style;
      e.dirSel.value = kf.dir;
    }
  } else {
    e.info.textContent = selectedKfs.length + " keyframes selecionadas";
  }
}


function openKeyframeMenu(x, y) {
  closeAnyMenu();
  const menu = el("div", "rsw-anim__menu");
  const item = (label, fn, kind) => {
    const it = el("div", "rsw-anim__menu-item" + (kind ? " rsw-anim__menu-item--" + kind : ""), label);
    it.addEventListener("click", () => { closeAnyMenu(); fn(); });
    menu.appendChild(it);
  };
  item("Duplicar", () => duplicateKeyframes(selectedKfs.slice()));
  item("Copiar", () => copySelection());
  item("Colar aqui", () => { if (clipboard) pasteKeyframes(clipboard, getCurrentTime()); });
  item('Marcar como "End"', () => {
    if (selectedKfs.length === 1) markEndKeyframe(selectedKfs[0].trackKey, selectedKfs[0].kfId);
  });
  const sub = el("div", "rsw-anim__menu-sub");
  sub.appendChild(el("div", "rsw-anim__menu-sublbl", "Easing Style"));
  EASING_STYLES.forEach((s) => {
    const it = el("div", "rsw-anim__menu-item", s);
    it.addEventListener("click", () => { closeAnyMenu(); applyEasingToSelection(s, null); });
    sub.appendChild(it);
  });
  menu.appendChild(sub);
  item("Deletar", () => { deleteKeyframes(selectedKfs.slice()); selectedKfs = []; }, "danger");

  menu.style.left = x + "px";
  menu.style.top = y + "px";
  document.body.appendChild(menu);
  ui._menu = menu;


  setTimeout(() => {
    if (!ui || !ui._menu) return;                                  
    menuListeners.add(document, "mousedown", closeAnyMenu, true);
  }, 0);
}

function closeAnyMenu() {


  menuListeners.disposeAll();
  if (ui && ui._menu && ui._menu.parentNode) ui._menu.parentNode.removeChild(ui._menu);
  if (ui) ui._menu = null;
}

function copySelection() {
  const clip = getClip();
  const items = [];
  for (const ref of selectedKfs) {
    const track = clip.tracks[ref.trackKey];
    const kf = track && track.keyframes.find((k) => k.id === ref.kfId);
    if (kf) items.push({ trackKey: ref.trackKey, partName: track.partName, time: kf.time, pos: kf.pos, rot: kf.rot, style: kf.style, dir: kf.dir });
  }
  clipboard = items.length ? { items } : clipboard;
}


function laneWidth() {
  return ui.lanes.getBoundingClientRect().width || 1;
}
function timelineRect() {
  return ui.timeline.getBoundingClientRect();
}
function xToTime(clientX) {
  const clip = getClip();
  const r = ui.lanes.getBoundingClientRect();
  const ratio = (clientX - r.left) / (r.width || 1);
  return Math.max(0, Math.min(1, ratio)) * clip.duration;
}

function setupTimelineInteractions() {

  const startScrub = (e) => {
    if (e.button !== 0) return;
    setTime(xToTime(e.clientX));
    const onMove = (me) => setTime(xToTime(me.clientX));
    const onUp = () => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseup", onUp, true);
    };
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);
  };
  ui.ruler.addEventListener("mousedown", startScrub);


  ui.lanes.addEventListener("mousedown", (e) => {
    if (e.button !== 0 || e.target !== ui.lanes && !e.target.classList.contains("rsw-anim__lane")) {

    }
    if (e.target.classList.contains("rsw-anim__kf")) return;                          
    const rect = timelineRect();
    const x0 = e.clientX, y0 = e.clientY;
    let isBox = false;
    if (!(e.ctrlKey || e.metaKey || e.shiftKey)) {

      setTime(xToTime(e.clientX));
    }
    const onMove = (me) => {
      const dx = me.clientX - x0, dy = me.clientY - y0;
      if (!isBox && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) isBox = true;
      if (isBox) {
        ui.boxSel.style.display = "block";
        const left = Math.min(x0, me.clientX) - rect.left;
        const top = Math.min(y0, me.clientY) - rect.top;
        ui.boxSel.style.left = left + "px";
        ui.boxSel.style.top = top + "px";
        ui.boxSel.style.width = Math.abs(dx) + "px";
        ui.boxSel.style.height = Math.abs(dy) + "px";
      } else {
        setTime(xToTime(me.clientX));
      }
    };
    const onUp = (ue) => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseup", onUp, true);
      if (isBox) {
        selectKeyframesInBox(x0, y0, ue.clientX, ue.clientY, e.ctrlKey || e.metaKey);
        ui.boxSel.style.display = "none";
      }
    };
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);
  });
}

function selectKeyframesInBox(x0, y0, x1, y1, additive) {
  if (!additive) selectedKfs = [];
  const lo = { x: Math.min(x0, x1), y: Math.min(y0, y1) };
  const hi = { x: Math.max(x0, x1), y: Math.max(y0, y1) };
  ui.kfEls.forEach((dia, kfId) => {
    const r = dia.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx >= lo.x && cx <= hi.x && cy >= lo.y && cy <= hi.y) {
      const tk = dia.dataset.trackKey;
      if (!isSelectedKf(tk, kfId)) selectedKfs.push({ trackKey: tk, kfId });
    }
  });
  refreshKfSelectionVisuals();
  updateEasingPanel();
}


function updateTimeUI(p) {
  if (!ui) return;
  const clip = getClip();
  if (!clip) return;
  const time = p ? p.time : getCurrentTime();
  ui.scrubber.style.left = pct(time / clip.duration) + "%";
  ui.timeLabel.textContent = formatSecFrames(time, clip.fps);
}

function updatePlaybackUI(p) {
  if (!ui) return;
  const playing = p ? p.playing : isPlaying();
  ui.loopPlayback = p ? !!p.loop : ui.loopPlayback;

  ui.playBtn.textContent = "";
  ui.playBtn.appendChild(createIcon(playing ? "pause" : "play", 16));
  ui.loopBtn.classList.toggle("rsw-anim__ctrl--active", !!ui.loopPlayback);
  if (p && p.speed != null) ui.speedSel.value = String(p.speed);
}

function updateTrackHighlight(trackKey) {
  if (!ui) return;
  ui.trackScroll.querySelectorAll(".rsw-anim__track").forEach((row) => {
    row.classList.toggle("rsw-anim__track--sel", row.dataset.key === trackKey);
  });
  ui.laneEls.forEach((lane, key) => {
    lane.classList.toggle("rsw-anim__lane--sel", key === trackKey);
  });
}


function onKeyDown(e) {
  if (!ui) return;
  const tag = (e.target && e.target.tagName) || "";
  const typing = tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
  if (typing) return;

  if (e.code === "Space") {
    e.preventDefault();
    togglePlay();
    return;
  }


  if (lastInteraction === "events") {
    if (e.key === "Delete" || e.key === "Backspace") {
      if (selectedEvents.length) { e.preventDefault(); deleteSelectedEvents(); }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
      if (selectedEvents.length) { e.preventDefault(); copyEvents(); }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
      if (eventClipboard && eventClipboard.length) {
        e.preventDefault();
        pasteAnimationEvents(eventClipboard, snapTimeToFrame(getCurrentTime()));
      }
      return;
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
      if (selectedEvents.length) {
        e.preventDefault();
        duplicateAnimationEvents(selectedEvents.slice(), EVENT_DUP_OFFSET);
      }
      return;
    }
  }

  if (e.key === "Delete" || e.key === "Backspace") {
    if (selectedKfs.length) {
      e.preventDefault();
      deleteKeyframes(selectedKfs.slice());
      selectedKfs = [];
    }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "c") {
    if (selectedKfs.length) { e.preventDefault(); copySelection(); }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "v") {
    if (clipboard) { e.preventDefault(); pasteKeyframes(clipboard, getCurrentTime()); }
    return;
  }
  if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "d") {
    if (selectedKfs.length) { e.preventDefault(); duplicateKeyframes(selectedKfs.slice()); }
    return;
  }
}


function eventTrackRect() {
  return ui.eventTrack.getBoundingClientRect();
}
function eventXToTime(clientX) {
  const clip = getClip();
  if (!clip) return 0;
  const r = eventTrackRect();
  const ratio = (clientX - r.left) / (r.width || 1);
  return Math.max(0, Math.min(1, ratio)) * clip.duration;
}


function snapTimeToFrame(time) {
  const clip = getClip();
  if (!clip || !clip.fps) return time;
  const snapped = Math.round(time * clip.fps) / clip.fps;
  return Math.max(0, Math.min(clip.duration, snapped));
}

function isSelectedEvent(id) { return selectedEventSet.has(id); }
function setEventSelection(ids) {
  selectedEvents = ids.slice();
  selectedEventSet = new Set(selectedEvents);
}
function clearEventSelection() {
  selectedEvents = [];
  selectedEventSet = new Set();
}

function pruneEventSelection() {
  const ids = new Set(getEvents().map((e) => e.id));
  selectedEvents = selectedEvents.filter((id) => ids.has(id));
  selectedEventSet = new Set(selectedEvents);
}


function renderEvents() {
  if (!ui) return;
  const clip = getClip();
  if (!clip) return;
  ui.eventEls.forEach((elm) => { if (elm.parentNode) elm.parentNode.removeChild(elm); });
  ui.eventEls.clear();
  const events = getEvents();
  const dur = clip.duration || 1;
  for (const ev of events) {

    if (ev.time < 0 || ev.time > dur) continue;
    const flag = el("div", "rsw-anim__event");
    flag.style.left = pct(ev.time / dur) + "%";
    flag.dataset.evId = ev.id;
    flag.title = ev.name + (ev.param ? ' ("' + ev.param + '")' : "") + " @ " + formatSecFrames(ev.time, clip.fps);
    const dot = el("span", "rsw-anim__event-flag");
    const lbl = el("span", "rsw-anim__event-lbl", ev.name);                           
    flag.append(dot, lbl);
    if (isSelectedEvent(ev.id)) flag.classList.add("rsw-anim__event--sel");
    attachEventHandlers(flag, ev);
    ui.eventTrack.appendChild(flag);
    ui.eventEls.set(ev.id, flag);
  }
}

function refreshEventSelectionVisuals() {
  if (!ui) return;
  ui.eventEls.forEach((elm, id) => {
    elm.classList.toggle("rsw-anim__event--sel", isSelectedEvent(id));
  });
}

function selectEventRange(fromId, toId) {
  const ids = getEvents().map((e) => e.id);
  const a = ids.indexOf(fromId), b = ids.indexOf(toId);
  if (a === -1 || b === -1) return;
  const [lo, hi] = a < b ? [a, b] : [b, a];
  for (let i = lo; i <= hi; i++) {
    if (!isSelectedEvent(ids[i])) { selectedEvents.push(ids[i]); selectedEventSet.add(ids[i]); }
  }
}

function attachEventHandlers(flag, ev) {
  flag.addEventListener("mousedown", (e) => {
    e.stopPropagation();
    if (e.button !== 0) return;
    lastInteraction = "events";
    if (e.ctrlKey || e.metaKey) {
      if (isSelectedEvent(ev.id)) {
        selectedEvents = selectedEvents.filter((x) => x !== ev.id);
        selectedEventSet.delete(ev.id);
      } else {
        selectedEvents.push(ev.id); selectedEventSet.add(ev.id);
      }
    } else if (e.shiftKey && lastEventClickId) {
      selectEventRange(lastEventClickId, ev.id);
    } else if (!isSelectedEvent(ev.id)) {
      setEventSelection([ev.id]);
    }
    lastEventClickId = ev.id;
    refreshEventSelectionVisuals();

    let moved = false;
    const startX = e.clientX;
    const startTime = ev.time;
    const onMove = (me) => {
      const dx = me.clientX - startX;
      if (Math.abs(dx) > 2) moved = true;
      if (!moved) return;

      const clip = getClip();
      const deltaT = (dx / (eventTrackRect().width || 1)) * clip.duration;
      const t = snapTimeToFrame(startTime + deltaT);
      flag.style.left = pct(t / clip.duration) + "%";
    };
    const onUp = (ue) => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseup", onUp, true);
      if (!moved) return;
      const clip = getClip();
      const rawDelta = ((ue.clientX - startX) / (eventTrackRect().width || 1)) * clip.duration;
      const snappedTarget = snapTimeToFrame(startTime + rawDelta);
      const delta = snappedTarget - startTime;
      const ids = selectedEvents.length ? selectedEvents.slice() : [ev.id];

      if (delta !== 0) moveAnimationEvents(ids, delta);
      else renderEvents();                                         
    };
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);
  });

  flag.addEventListener("dblclick", (e) => {
    e.stopPropagation();
    lastInteraction = "events";
    openEventDialog(ev);
  });

  flag.addEventListener("contextmenu", (e) => {
    e.preventDefault();
    e.stopPropagation();
    lastInteraction = "events";
    if (!isSelectedEvent(ev.id)) { setEventSelection([ev.id]); refreshEventSelectionVisuals(); }
    openEventMenu(e.clientX, e.clientY, ev);
  });
}

function setupEventTrackInteractions() {

  ui.eventTrack.addEventListener("contextmenu", (e) => {
    if (e.target.closest && e.target.closest(".rsw-anim__event")) return;
    e.preventDefault();
    e.stopPropagation();
    lastInteraction = "events";
    const t = snapTimeToFrame(eventXToTime(e.clientX));
    openEventTrackMenu(e.clientX, e.clientY, t);
  });

  ui.eventTrack.addEventListener("mousedown", (e) => {
    if (e.button !== 0) return;
    if (e.target.closest && e.target.closest(".rsw-anim__event")) return;
    lastInteraction = "events";
    const rect = timelineRect();
    const x0 = e.clientX, y0 = e.clientY;
    let isBox = false;
    const onMove = (me) => {
      const dx = me.clientX - x0, dy = me.clientY - y0;
      if (!isBox && (Math.abs(dx) > 4 || Math.abs(dy) > 4)) isBox = true;
      if (isBox) {
        ui.boxSel.style.display = "block";
        ui.boxSel.style.left = (Math.min(x0, me.clientX) - rect.left) + "px";
        ui.boxSel.style.top = (Math.min(y0, me.clientY) - rect.top) + "px";
        ui.boxSel.style.width = Math.abs(dx) + "px";
        ui.boxSel.style.height = Math.abs(dy) + "px";
      }
    };
    const onUp = (ue) => {
      document.removeEventListener("mousemove", onMove, true);
      document.removeEventListener("mouseup", onUp, true);
      if (isBox) {
        selectEventsInBox(x0, y0, ue.clientX, ue.clientY, e.ctrlKey || e.metaKey);
        ui.boxSel.style.display = "none";
      }
    };
    document.addEventListener("mousemove", onMove, true);
    document.addEventListener("mouseup", onUp, true);
  });
}

function selectEventsInBox(x0, y0, x1, y1, additive) {
  if (!additive) clearEventSelection();
  const lo = { x: Math.min(x0, x1), y: Math.min(y0, y1) };
  const hi = { x: Math.max(x0, x1), y: Math.max(y0, y1) };
  ui.eventEls.forEach((elm, id) => {
    const r = elm.getBoundingClientRect();
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    if (cx >= lo.x && cx <= hi.x && cy >= lo.y && cy <= hi.y) {
      if (!isSelectedEvent(id)) { selectedEvents.push(id); selectedEventSet.add(id); }
    }
  });
  refreshEventSelectionVisuals();
}

function spawnMenu(menu, x, y) {
  menu.style.left = x + "px";
  menu.style.top = y + "px";
  document.body.appendChild(menu);
  ui._menu = menu;


  setTimeout(() => {
    if (!ui || !ui._menu) return;                                  
    menuListeners.add(document, "mousedown", closeAnyMenu, true);
  }, 0);
}

function openEventTrackMenu(x, y, time) {
  closeAnyMenu();
  const menu = el("div", "rsw-anim__menu");
  const item = (label, fn, kind) => {
    const it = el("div", "rsw-anim__menu-item" + (kind ? " rsw-anim__menu-item--" + kind : ""), label);
    it.addEventListener("click", () => { closeAnyMenu(); fn(); });
    menu.appendChild(it);
  };
  item("Add Event", () => openEventDialog(null, time));
  if (eventClipboard && eventClipboard.length) {
    item("Colar aqui", () => pasteAnimationEvents(eventClipboard, time));
  }
  spawnMenu(menu, x, y);
}

function openEventMenu(x, y, ev) {
  closeAnyMenu();
  const menu = el("div", "rsw-anim__menu");
  const item = (label, fn, kind) => {
    const it = el("div", "rsw-anim__menu-item" + (kind ? " rsw-anim__menu-item--" + kind : ""), label);
    it.addEventListener("click", () => { closeAnyMenu(); fn(); });
    menu.appendChild(it);
  };
  item("Edit Event", () => openEventDialog(ev));
  item("Rename", () => openEventDialog(ev, null, true));
  item("Duplicate", () => duplicateAnimationEvents(
    selectedEvents.length ? selectedEvents.slice() : [ev.id], EVENT_DUP_OFFSET,
  ));
  item("Copy", () => copyEvents());
  if (eventClipboard && eventClipboard.length) {
    item("Colar aqui", () => pasteAnimationEvents(eventClipboard, snapTimeToFrame(getCurrentTime())));
  }
  item("Delete", () => deleteSelectedEvents(), "danger");
  spawnMenu(menu, x, y);
}

function copyEvents() {
  const ids = selectedEvents;
  if (!ids.length) return;
  const items = getEvents()
    .filter((e) => ids.indexOf(e.id) !== -1)
    .map((e) => ({ time: e.time, name: e.name, param: e.param }));
  if (items.length) eventClipboard = items;
}

async function deleteSelectedEvents() {
  if (!selectedEvents.length) return;
  const ids = selectedEvents.slice();

  if (ids.length > 5) {
    const ok = await openConfirm({
      title: "Deletar eventos",
      message: "Remover " + ids.length + " marcadores de evento selecionados?",
      buttons: [
        { label: "Deletar", value: true, kind: "danger" },
        { label: "Cancelar", value: false, kind: "default" },
      ],
    });
    if (!ok) return;
  }
  deleteAnimationEvents(ids);
  clearEventSelection();
}


function openEventDialog(existing, presetTime, _focusName) {
  const clip = getClip();
  if (!clip) return;
  const isEdit = !!existing;
  const body = el("div", "rsw-anim__evdlg");
  const mkField = (labelText, value) => {
    const wrap = el("label", "rsw-anim__field rsw-anim__field--col");
    wrap.appendChild(el("span", "rsw-anim__field-lbl", labelText));
    const input = el("input", "rsw-input");
    input.type = "text";
    input.spellcheck = false;
    if (value != null) input.value = value;
    wrap.appendChild(input);
    return { wrap, input };
  };
  const nameF = mkField("Nome do evento", isEdit ? existing.name : "");
  nameF.input.maxLength = 64;
  const paramF = mkField("Parâmetro (opcional)", isEdit ? existing.param : "");
  paramF.input.maxLength = 256;
  const hint = el("div", "rsw-anim__evdlg-hint", "");
  body.append(nameF.wrap, paramF.wrap, hint);

  const foot = el("div", "rsw-modal__btnrow");
  let handle = null;
  let busy = false;
  const confirm = async () => {
    if (busy) return;
    const name = nameF.input.value.trim();
    if (!name) { hint.textContent = "Informe um nome para o evento."; nameF.input.focus(); return; }
    const exceptId = isEdit ? existing.id : undefined;
    if (eventNameExists(name, exceptId)) {
      busy = true;
      const ok = await openConfirm({
        title: "Nome duplicado",
        message: 'Já existe um evento chamado "' + name + '". Criar mesmo assim?',
        buttons: [
          { label: "Continuar", value: true, kind: "primary" },
          { label: "Cancelar", value: false, kind: "default" },
        ],
      });
      busy = false;
      if (!ok) return;
    }
    if (isEdit) {
      updateAnimationEvent(existing.id, name, paramF.input.value);
    } else {
      const t = Number.isFinite(presetTime) ? presetTime : snapTimeToFrame(getCurrentTime());
      addAnimationEvent(t, name, paramF.input.value);
    }
    if (handle) handle.close();
  };
  const cancelBtn = makeButton("Cancelar", "default", () => handle && handle.close());
  const okBtn = makeButton(isEdit ? "Salvar" : "Adicionar", "primary", () => { confirm(); });
  foot.append(cancelBtn, okBtn);


  const onKey = (e) => {
    if (e.key === "Enter") { e.preventDefault(); confirm(); }
    else if (e.key === "Escape") { e.preventDefault(); if (handle) handle.close(); }
  };
  nameF.input.addEventListener("keydown", onKey);
  paramF.input.addEventListener("keydown", onKey);

  handle = openModal({ title: isEdit ? "Editar evento" : "Novo evento", body, footer: foot, width: 380 });
  setTimeout(() => { nameF.input.focus(); nameF.input.select(); }, 0);
}


const EVENT_TRACK_VISIBLE_CLASS = "has-event-track";

function applyEventTrackVisibility() {
  if (!ui) return;
  const isEventTrackVisible = getEventTrackVisible();
  ui.eventTrack.hidden = !isEventTrackVisible;
  ui.timeline.classList.toggle(EVENT_TRACK_VISIBLE_CLASS, isEventTrackVisible);
  if (ui.eventToggleBtn) {
    ui.eventToggleBtn.classList.toggle("rsw-anim__ctrl--active", isEventTrackVisible);
  }
}
function toggleEventTrack() {
  setEventTrackVisible(!getEventTrackVisible());

}
function openViewMenu(anchorBtn) {
  closeAnyMenu();
  const menu = el("div", "rsw-anim__menu");
  const visible = getEventTrackVisible();
  const it = el("div", "rsw-anim__menu-item", (visible ? "\u2713 " : "\u2003") + "Show Event Track");
  it.addEventListener("click", () => { closeAnyMenu(); toggleEventTrack(); });
  menu.appendChild(it);
  const r = anchorBtn.getBoundingClientRect();
  spawnMenu(menu, r.left, r.bottom + 2);
}


function flashEventMarker(id) {
  if (!ui || !id) return;
  const elm = ui.eventEls.get(id);
  if (!elm) return;
  elm.classList.remove("rsw-anim__event--firing");
  void elm.offsetWidth;                                      
  elm.classList.add("rsw-anim__event--firing");
  setTimeout(() => { if (elm) elm.classList.remove("rsw-anim__event--firing"); }, 360);
}


function openPublishDialog() {
  const clip = getClip();
  if (!clip) return;
  const body = el("div", "rsw-anim__pub");
  const mkField = (labelText, value, type) => {
    const wrap = el("label", "rsw-anim__field rsw-anim__field--col");
    wrap.appendChild(el("span", "rsw-anim__field-lbl", labelText));
    const input = type === "textarea" ? el("textarea", "rsw-anim__input") : el("input", "rsw-anim__input");
    if (type !== "textarea") input.type = "text";
    if (value != null) input.value = value;
    wrap.appendChild(input);
    return { wrap, input };
  };
  const nameF = mkField("Nome", clip.name);
  const descF = mkField("Descrição", "", "textarea");
  const creatorF = mkField("Criador", "Me");
  body.append(nameF.wrap, descF.wrap, creatorF.wrap);

  const foot = el("div", "rsw-modal__btnrow");
  let handle = null;
  const cancelBtn = makeButton("Cancelar", "default", () => handle && handle.close());
  const okBtn = makeButton("Publicar", "primary", () => {
    const res = storePublish({ name: nameF.input.value, description: descF.input.value, creator: creatorF.input.value });
    if (handle) handle.close();
    if (res) {
      openConfirm({
        title: "Publicado (simulado)",
        message: 'Animação "' + res.name + '" publicada.\nAsset ID: ' + res.assetId,
        buttons: [{ label: "OK", value: true, kind: "primary" }],
      });
    }
  });
  foot.append(cancelBtn, okBtn);

  handle = openModal({ title: "Publish to Roblox (simulado)", body, footer: foot, width: 460 });
}
