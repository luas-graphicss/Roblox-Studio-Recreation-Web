import { bus } from "../core/eventBus.js";
import { store } from "../core/state.js";
import { commands } from "../core/commands.js";
import { selection } from "../core/selection.js";
import { logger } from "../core/logger.js";

import { deepCloneJsonValue } from "../core/deepCloneJsonValue.js";
import { setStatus } from "../core/project.js";
import { getService, createInstance, makeVector3 } from "../datamodel/index.js";
import { Events } from "../datamodel/instance.js";
import { sanitizeName } from "../datamodel/types.js";
import { getSelectedCharacter, getSelectedHumanoid, getSelectedSkinnedRig } from "../avatar/avatarOps.js";
import { updateIKForRig, isIKApplying, setIKExcludedRig } from "./ikRuntime.js";                            


import { sanitizeBoneTransform } from "../assets/skinRegistry.js";

import {
  ensureEvents as _ensureEvents,
  addEvent as _addEventModel,
  removeEvent as _removeEventModel,
  moveEvent as _moveEventModel,
  updateEvent as _updateEventModel,
  findEvent as _findEventModel,
  eventNameExists as _eventNameExistsModel,
  MAX_EVENTS,
} from "./animationModel.js";
import {
  createClip,
  cloneClip,
  evaluateClip,
  makeKeyframe,
  upsertKeyframe,
  removeKeyframe,
  moveKeyframe,
  findKeyframe,
  ensureTrack,
  clampTime,
  sanitizeDuration,
  timeToFrame,
  PRIORITIES,
  DEFAULT_FPS,
  ensureCurveData,
  ensureKfCurve,
  hasCurveData,
  generateCurve as modelGenerateCurve,
  setChannelValue,
  channelValue,
  CURVE_CHANNELS,
  CURVE_VALUE_LIMIT,
  INTERP_MODES,
  ROTATION_TYPES,
} from "./animationModel.js";

import { EASING_STYLES, EASING_DIRECTIONS } from "./easing.js";


export const AnimEvents = Object.freeze({
  SessionChanged: "anim:session",                   
  ClipChanged: "anim:clip",              
  TimeChanged: "anim:time",                                 
  PlaybackChanged: "anim:playback",                            
  SelectionChanged: "anim:selection",                
  Saved: "anim:saved",                        
});

const SAVES_FOLDER = "AnimSaves";


let session = null;


let _previewIK = true;                                                        
let _applyingPose = false;                                              
let _rafId = null;
let _lastTs = 0;
let _pendingPose = null;                                                          
let _propUnsub = null;
let _destroyUnsub = null;
let _selUnsub = null;

function live(inst) {
  return inst && inst.__isInstance && !inst.isDestroyed();
}

function readVec(inst, prop) {
  const v = inst.getProperty(prop) || {};
  return { x: Number(v.x) || 0, y: Number(v.y) || 0, z: Number(v.z) || 0 };
}


function posePropNames(inst) {
  return inst && inst.className === "Bone"
    ? { pos: "Transform", rot: "TransformRotation" }
    : { pos: "Position", rot: "Rotation" };
}


export function getSelectableRig() {
  const char = getSelectedCharacter();
  if (live(char)) {
    const hum = getSelectedHumanoid();
    if (live(hum)) {
      const rt = hum.getProperty("RigType");
      if (rt === "R6" || rt === "R15") return { rig: char, humanoid: hum, rigType: rt };
    }
  }


  const skinned = getSelectedSkinnedRig();
  if (live(skinned)) return { rig: skinned, humanoid: null, rigType: "Skinned" };
  return null;
}

export function canOpen() {
  return !!getSelectableRig() && !isOpen();
}

export function isOpen() {
  return !!session;
}


function collectAnimatableParts(rig) {
  const parts = [];
  const seen = new Set();
  const push = (inst) => {
    if (live(inst) && inst.hasProperty("Position") && !seen.has(inst.id)) {
      seen.add(inst.id);
      parts.push({ key: inst.id, name: inst.name, inst });
    }
  };
  const root = rig.findFirstChild("HumanoidRootPart", true);
  push(root);
  const motors = rig.getDescendants().filter((d) => d.className === "Motor6D");
  for (const m of motors) {
    const p1 = m.getProperty("Part1");
    push(p1);
  }

  for (const d of rig.getDescendants()) {
    if (d.className === "Bone") push(d);
  }
  return parts;
}

function snapshotBasePose(parts) {
  const map = new Map();
  for (const p of parts) {
    const names = posePropNames(p.inst);
    const entry = { pos: readVec(p.inst, names.pos), rot: readVec(p.inst, names.rot) };


    if (p.inst.className === "Bone") {
      entry.posFull = sanitizeBoneTransform(p.inst.getProperty("Transform"));
    }
    map.set(p.key, entry);
  }
  return map;
}


export function open() {
  if (session) return true;
  const found = getSelectableRig();
  if (!found) {
    logger.warn("Animation Editor: selecione um rig válido (R6, R15 ou mesh com Bones) antes de abrir.");
    return false;
  }
  const parts = collectAnimatableParts(found.rig);
  if (!parts.length) {
    logger.warn("Animation Editor: o rig selecionado não possui partes animáveis.");
    return false;
  }
  session = {
    rig: found.rig,
    humanoid: found.humanoid,
    rigType: found.rigType,
    parts,
    partMap: new Map(parts.map((p) => [p.key, p.inst])),
    basePose: snapshotBasePose(parts),
    clip: createClip({
      name: found.rig.name + " Animation",
      targetRigName: found.rig.name,
      targetRigType: found.rigType,
    }),
    time: 0,
    playing: false,
    loop: false,
    speed: 1,
    selectedTrackKey: null,
    dirty: false,
    savedInstanceId: null,
    poseCache: new Map(),
  };


  _propUnsub = bus.on(Events.PropertyChanged, onPartPropertyChanged);

  _destroyUnsub = bus.on(Events.Destroying, onAnyDestroying);

  _selUnsub = bus.on("selection:changed", onSelectionChanged);

  logger.info('Animation Editor aberto para "' + found.rig.name + '" (' + found.rigType + ").");
  setIKExcludedRig(found.rig);                                                     
  bus.emit(AnimEvents.SessionChanged, { open: true, rigId: found.rig.id });
  setTime(0);
  emitClipChanged("open");
  return true;
}


export function close(reason) {
  if (!session) return;
  stopPlayback();
  restoreBasePose();
  if (_propUnsub) _propUnsub();
  if (_destroyUnsub) _destroyUnsub();
  if (_selUnsub) _selUnsub();
  _propUnsub = _destroyUnsub = _selUnsub = null;
  _pendingPose = null;
  const name = session.clip ? session.clip.name : "";
  session = null;
  setIKExcludedRig(null);            
  bus.emit(AnimEvents.SessionChanged, { open: false });
  if (reason === "rig-destroyed") {
    logger.warn("Animation Editor fechado: o rig foi destruído durante a edição.");
  } else {
    logger.info('Animation Editor fechado ("' + name + '").');
  }
}

export function isDirty() {
  return !!(session && session.dirty);
}


export function getSession() {
  return session;
}
export function getClip() {
  return session ? session.clip : null;
}
export function getAnimatableParts() {
  return session ? session.parts.slice() : [];
}
export function getCurrentTime() {
  return session ? session.time : 0;
}
export function getCurrentFrame() {
  return session ? timeToFrame(session.time, session.clip.fps) : 0;
}
export function isPlaying() {
  return !!(session && session.playing);
}
export function getSpeed() {
  return session ? session.speed : 1;
}
export function getSelectedTrackKey() {
  return session ? session.selectedTrackKey : null;
}
export function getAnimatablePartIds() {
  return session ? session.parts.map((p) => p.key) : [];
}
export function getRigId() {
  return session && live(session.rig) ? session.rig.id : null;
}


function invalidatePoseCache() {
  if (session) session.poseCache.clear();
}


function applyPoseAtTime(time) {
  if (!session) return;


  const fps = session.clip.fps || DEFAULT_FPS;                                  
  const cacheKey = Math.round(time * 1e4);
  let poses = session.poseCache.get(cacheKey);
  if (!poses) {
    poses = evaluateClip(session.clip, time);
    session.poseCache.set(cacheKey, poses);


    if (session.poseCache.size > 4096) session.poseCache.clear();
  }
  _applyingPose = true;
  try {
    for (const p of session.parts) {
      if (!live(p.inst)) continue;
      const pose = poses[p.key] || session.basePose.get(p.key);
      if (!pose) continue;


      const names = posePropNames(p.inst);
      p.inst._setInternal(names.pos, makeVector3(pose.pos.x, pose.pos.y, pose.pos.z));
      p.inst._setInternal(names.rot, makeVector3(pose.rot.x, pose.rot.y, pose.rot.z));
    }
  } finally {
    _applyingPose = false;
  }

  if (_previewIK) {
    _applyingPose = true;
    try {
      updateIKForRig(session.rig, 1 / fps);
    } catch (_) {

    } finally {
      _applyingPose = false;
    }
  }
}


export function getPreviewIK() {
  return _previewIK;
}

export function setPreviewIK(on) {
  _previewIK = !!on;
  if (!session) return;
  try {
    applyPoseAtTime(session.time || 0);
  } catch (_) {

  }
}


function restoreBasePose() {
  if (!session) return;
  _applyingPose = true;
  try {
    for (const p of session.parts) {
      if (!live(p.inst)) continue;
      const base = session.basePose.get(p.key);
      if (!base) continue;
      const names = posePropNames(p.inst);


      if (base.posFull) {
        p.inst._setInternal(names.pos, sanitizeBoneTransform(base.posFull));
      } else {
        p.inst._setInternal(names.pos, makeVector3(base.pos.x, base.pos.y, base.pos.z));
      }
      p.inst._setInternal(names.rot, makeVector3(base.rot.x, base.rot.y, base.rot.z));
    }
  } finally {
    _applyingPose = false;
  }
}


function onPartPropertyChanged(payload) {
  if (!session || session.playing) return;
  if (_applyingPose) return;
  if (isIKApplying()) return;                                                                                                          
  const inst = payload && payload.instance;

  const prop = payload && (payload.property || payload.name);
  if (!inst) return;
  const names = posePropNames(inst);
  if (prop !== names.pos && prop !== names.rot) return;
  if (!session.partMap.has(inst.id)) return;                              


  if (!_pendingPose) {
    _pendingPose = new Set();
    queueMicrotask(flushPendingPose);
  }
  _pendingPose.add(inst.id);
}

function flushPendingPose() {
  const keys = _pendingPose;
  _pendingPose = null;
  if (!session || !keys || !keys.size) return;
  const time = session.time;
  const entries = [];
  for (const key of keys) {
    const inst = session.partMap.get(key);
    if (!live(inst)) continue;
    entries.push({
      key,
      name: inst.name,
      pos: readVec(inst, posePropNames(inst).pos),
      rot: readVec(inst, posePropNames(inst).rot),
    });
  }
  if (!entries.length) return;
  commitClip("Criar keyframe (pose)", (clip) => {
    for (const e of entries) {
      const kf = makeKeyframe(time, e.pos, e.rot);


      upsertKeyframe(clip, e.key, e.name, kf, { preserveEasing: true });
    }
  });

  const lastKey = entries[entries.length - 1].key;
  setSelectedTrack(lastKey);
}


function commitClip(name, mutator) {
  if (!session) return false;
  const before = cloneClip(session.clip);
  const working = cloneClip(session.clip);
  const result = mutator(working);
  if (result === false) return false;


  if (working && working.curveMode) ensureCurveData(working);
  const after = cloneClip(working);
  return commands.execute({
    name,
    do() {
      if (!session) return;
      session.clip = cloneClip(after);
      afterClipChange(name);
    },
    undo() {
      if (!session) return;
      session.clip = cloneClip(before);
      afterClipChange(name);
    },
  });
}

function afterClipChange(reason) {
  if (!session) return;
  session.dirty = true;
  invalidatePoseCache();

  applyPoseAtTime(session.time);


  syncSavedInstanceLater();
  emitClipChanged(reason);
}

function emitClipChanged(reason) {
  bus.emit(AnimEvents.ClipChanged, { reason: reason || "" });
}


export function setTime(time, fromPlayback) {
  if (!session) return;
  const prev = session.time;
  const t = clampTime(session.clip, time);
  session.time = t;
  applyPoseAtTime(t);

  processMarkers(prev, t, !!fromPlayback);
  bus.emit(AnimEvents.TimeChanged, {
    time: t,
    frame: timeToFrame(t, session.clip.fps),
    fromPlayback: !!fromPlayback,
  });
}


const MARKER_CONTINUOUS_STEP = 0.34;                     


function processMarkers(prev, cur, fromPlayback) {
  if (!session || !session.clip) return;
  const evs = session.clip.events;
  if (!evs || !evs.length) return;
  if (cur <= prev) return;                        
  const continuous = fromPlayback || cur - prev <= MARKER_CONTINUOUS_STEP;
  if (!continuous) return;                                           

  for (let i = 0; i < evs.length; i++) {
    const ev = evs[i];
    if (ev.time > cur) break;


    if ((ev.time > prev || (prev === 0 && ev.time === 0)) && ev.time <= cur) fireMarker(ev);
  }
}


function fireMarker(ev) {
  const param = ev.param || "";


  if (session && session.savedInstanceId) {
    bus.emit("anim:marker", { instanceId: session.savedInstanceId, name: ev.name, param });
  }

  bus.emit("anim:marker-flash", { id: ev.id });

  logger.info(
    'Animation Event "' + ev.name + '" disparado' +
      (param ? ' (param: "' + param + '")' : "") + ".",
  );
}

export function play() {
  if (!session || session.playing) return;


  if (session.time >= session.clip.duration - 1e-9) setTime(0);
  session.playing = true;
  _lastTs = (typeof performance !== "undefined" ? performance.now() : Date.now());
  bus.emit(AnimEvents.PlaybackChanged, playbackState());
  _rafId = requestFrame(tick);
}

export function pause() {
  if (!session || !session.playing) return;
  session.playing = false;
  cancelFrame(_rafId);
  _rafId = null;
  bus.emit(AnimEvents.PlaybackChanged, playbackState());
}

export function stop() {
  if (!session) return;
  pause();
  setTime(0);
}

function stopPlayback() {
  if (session && session.playing) {
    session.playing = false;
    bus.emit(AnimEvents.PlaybackChanged, playbackState());
  }
  cancelFrame(_rafId);
  _rafId = null;
}

export function togglePlay() {
  if (!session) return;
  if (session.playing) pause();
  else play();
}

export function rewind() {
  setTime(0);
}

export function setLoopPlayback(on) {
  if (!session) return;
  session.loop = !!on;
  bus.emit(AnimEvents.PlaybackChanged, playbackState());
}

export function setSpeed(mult) {
  if (!session) return;
  const m = Number(mult);


  session.speed = Number.isFinite(m) && m > 0 ? Math.min(m, 100) : 1;
  bus.emit(AnimEvents.PlaybackChanged, playbackState());
}

function playbackState() {
  return session
    ? { playing: session.playing, loop: session.loop, speed: session.speed }
    : { playing: false, loop: false, speed: 1 };
}

function tick() {
  if (!session || !session.playing) return;
  const now = typeof performance !== "undefined" ? performance.now() : Date.now();
  const dt = ((now - _lastTs) / 1000) * session.speed;
  _lastTs = now;
  let t = session.time + dt;
  const dur = session.clip.duration;
  if (t >= dur) {
    if (session.loop) {


      setTime(dur, true);
      session.time = 0;
      setTime(dur > 0 ? t % dur : 0, true);
      _rafId = requestFrame(tick);
      return;
    } else {
      setTime(dur, true);
      pause();
      return;
    }
  }
  setTime(t, true);
  _rafId = requestFrame(tick);
}

function requestFrame(fn) {
  if (typeof requestAnimationFrame === "function") return requestAnimationFrame(fn);
  return setTimeout(() => fn(), 16);
}
function cancelFrame(id) {
  if (id == null) return;
  if (typeof cancelAnimationFrame === "function") cancelAnimationFrame(id);
  else clearTimeout(id);
}


export function setSelectedTrack(key) {
  if (!session) return;
  session.selectedTrackKey = key || null;
  bus.emit(AnimEvents.SelectionChanged, { trackKey: session.selectedTrackKey });
}


export function selectPartForTrack(key) {
  if (!session) return;
  const inst = session.partMap.get(key);
  if (live(inst)) selection.selectSingle(inst);
  setSelectedTrack(key);
}

function onSelectionChanged(payload) {
  if (!session) return;
  const items = (payload && payload.items) || [];
  const match = items.find((it) => it && session.partMap.has(it.id));
  if (match) {
    session.selectedTrackKey = match.id;
    bus.emit(AnimEvents.SelectionChanged, { trackKey: match.id });
  }
}


export function addKeyframeAtCurrent(trackKey) {
  if (!session) return false;
  const key = trackKey || session.selectedTrackKey;
  if (!key) {
    logger.warn("Selecione uma parte do rig (track) antes de adicionar keyframe.");
    return false;
  }
  const inst = session.partMap.get(key);
  const part = session.parts.find((p) => p.key === key);


  const propNames = posePropNames(inst);


  const baseEntry = session.basePose.get(key) || {
    pos: { x: 0, y: 0, z: 0 },
    rot: { x: 0, y: 0, z: 0 },
  };
  const pos = live(inst) ? readVec(inst, propNames.pos) : baseEntry.pos;
  const rot = live(inst) ? readVec(inst, propNames.rot) : baseEntry.rot;
  const time = session.time;
  return commitClip("Adicionar keyframe", (clip) => {

    upsertKeyframe(clip, key, part ? part.name : key, makeKeyframe(time, pos, rot), { preserveEasing: true });
  });
}


export function addKeyframeAtTime(trackKey, time) {
  if (!session || !trackKey) return false;
  const part = session.parts.find((p) => p.key === trackKey);
  const poses = evaluateClip(session.clip, time);
  let pose = poses[trackKey];
  if (!pose) {
    const base = session.basePose.get(trackKey);
    pose = base ? { pos: base.pos, rot: base.rot } : { pos: { x: 0, y: 0, z: 0 }, rot: { x: 0, y: 0, z: 0 } };
  }
  return commitClip("Adicionar keyframe", (clip) => {

    upsertKeyframe(clip, trackKey, part ? part.name : trackKey, makeKeyframe(time, pose.pos, pose.rot), { preserveEasing: true });
  });
}

export function deleteKeyframes(list) {
  if (!session || !list || !list.length) return false;
  return commitClip("Deletar keyframe(s)", (clip) => {
    for (const ref of list) removeKeyframe(clip, ref.trackKey, ref.kfId);
  });
}


export function moveKeyframes(list, deltaTime) {
  if (!session || !list || !list.length) return false;
  return commitClip("Mover keyframe(s)", (clip) => {
    for (const ref of list) {
      const kf = findKeyframe(clip, ref.trackKey, ref.kfId);
      if (kf) moveKeyframe(clip, ref.trackKey, ref.kfId, kf.time + deltaTime);
    }
  });
}


export function duplicateKeyframes(list, deltaTime) {
  if (!session || !list || !list.length) return false;
  const d = deltaTime != null ? deltaTime : 1 / (session.clip.fps || DEFAULT_FPS);
  return commitClip("Duplicar keyframe(s)", (clip) => {
    for (const ref of list) {
      const kf = findKeyframe(clip, ref.trackKey, ref.kfId);
      const track = clip.tracks[ref.trackKey];
      if (kf && track) {
        const nk = upsertKeyframe(clip, ref.trackKey, track.partName, makeKeyframe(kf.time + d, kf.pos, kf.rot, kf.style, kf.dir, kf.label));


        if (kf.interp) nk.interp = kf.interp;
        if (kf.tan) nk.tan = deepCloneJsonValue(kf.tan);
      }
    }
  });
}


export function pasteKeyframes(clipboard, baseTime) {
  if (!session || !clipboard || !clipboard.items || !clipboard.items.length) return false;
  const minT = clipboard.items.reduce((m, k) => Math.min(m, k.time), Infinity);
  return commitClip("Colar keyframe(s)", (clip) => {
    for (const item of clipboard.items) {
      const track = clip.tracks[item.trackKey];
      const partName = track ? track.partName : item.partName || item.trackKey;
      const t = baseTime + (item.time - minT);
      const nk = upsertKeyframe(clip, item.trackKey, partName, makeKeyframe(t, item.pos, item.rot, item.style, item.dir, item.label));


      if (item.interp && INTERP_MODES.indexOf(item.interp) !== -1) nk.interp = item.interp;
      if (item.tan && typeof item.tan === "object") nk.tan = deepCloneJsonValue(item.tan);
    }
  });
}

export function setKeyframeEasing(list, style, dir) {
  if (!session || !list || !list.length) return false;


  const st = style && EASING_STYLES.indexOf(style) !== -1 ? style : null;
  const dr = dir && EASING_DIRECTIONS.indexOf(dir) !== -1 ? dir : null;
  if (!st && !dr) return false;
  return commitClip("Mudar easing", (clip) => {
    for (const ref of list) {
      const kf = findKeyframe(clip, ref.trackKey, ref.kfId);
      if (kf) {
        if (st) kf.style = st;
        if (dr) kf.dir = dr;
      }
    }
  });
}


const CURVE_VIEW_KEY = "rsw.animEditor.curveView";

export function isCurveMode() {
  return !!(session && session.clip && session.clip.curveMode);
}
export function getRotationType() {
  return session && session.clip && ROTATION_TYPES.indexOf(session.clip.rotationType) !== -1
    ? session.clip.rotationType
    : "Euler";
}

export function readLastCurveView() {
  try { return window.localStorage.getItem(CURVE_VIEW_KEY) === "1"; } catch (_) { return false; }
}
export function storeLastCurveView(on) {
  try { window.localStorage.setItem(CURVE_VIEW_KEY, on ? "1" : "0"); } catch (_) {}
}


export function clipHasCurves() {
  return hasCurveData(session && session.clip);
}


export function enterCurveMode() {
  if (!session) return false;
  if (session.clip.curveMode) return false;
  return commitClip("Entrar no modo de curvas", (clip) => {
    ensureCurveData(clip);
  });
}


export function exitCurveMode() {
  if (!session) return false;
  if (!session.clip.curveMode) return false;
  return commitClip("Sair do modo de curvas", (clip) => {
    clip.curveMode = false;
  });
}


export function setRotationType(type) {
  if (!session) return false;
  if (ROTATION_TYPES.indexOf(type) === -1) return false;
  if (type === getRotationType()) return false;
  return commitClip("Alterar tipo de rotação", (clip) => {
    ensureCurveData(clip);
    clip.rotationType = type;
  });
}


export function moveKeyframesTimeValue(list, deltaTime, chKey, deltaValue) {
  if (!session || !list || !list.length) return false;
  const dt = Number.isFinite(deltaTime) ? deltaTime : 0;
  const dv = Number.isFinite(deltaValue) ? deltaValue : 0;
  const hasCh = !!chKey && CURVE_CHANNELS.some((c) => c.key === chKey);
  if (dt === 0 && (!hasCh || dv === 0)) return false;
  return commitClip("Mover keyframe(s)", (clip) => {
    for (const ref of list) {
      const kf = findKeyframe(clip, ref.trackKey, ref.kfId);
      if (!kf) continue;
      if (hasCh && dv !== 0) setChannelValue(kf, chKey, channelValue(kf, chKey) + dv);
      if (dt !== 0) moveKeyframe(clip, ref.trackKey, ref.kfId, kf.time + dt);
    }
  });
}


export function dragCurveKeyframes(moveList, deltaTime, chKey, valueList, deltaValue) {
  if (!session) return false;
  const dt = Number.isFinite(deltaTime) ? deltaTime : 0;
  const dv = Number.isFinite(deltaValue) ? deltaValue : 0;
  const hasCh = !!chKey && CURVE_CHANNELS.some((c) => c.key === chKey);
  const moves = Array.isArray(moveList) ? moveList : [];
  const vals = Array.isArray(valueList) ? valueList : [];
  if ((dt === 0 || !moves.length) && (!hasCh || dv === 0 || !vals.length)) return false;
  return commitClip("Mover keyframe(s)", (clip) => {
    if (hasCh && dv !== 0) {
      for (const ref of vals) {
        const kf = findKeyframe(clip, ref.trackKey, ref.kfId);
        if (kf) setChannelValue(kf, chKey, channelValue(kf, chKey) + dv);
      }
    }
    if (dt !== 0) {
      for (const ref of moves) {
        const kf = findKeyframe(clip, ref.trackKey, ref.kfId);
        if (kf) moveKeyframe(clip, ref.trackKey, ref.kfId, kf.time + dt);
      }
    }
  });
}


export function setKeyframeChannelValue(trackKey, kfId, chKey, value) {
  if (!session) return false;
  if (!CURVE_CHANNELS.some((c) => c.key === chKey)) return false;
  if (!Number.isFinite(value)) return false;
  return commitClip("Editar valor da keyframe", (clip) => {
    const kf = findKeyframe(clip, trackKey, kfId);
    if (!kf) return false;
    ensureKfCurve(kf);
    setChannelValue(kf, chKey, value);
  });
}


export function setTangentValue(trackKey, kfId, chKey, side, value) {
  if (!session) return false;
  if (!CURVE_CHANNELS.some((c) => c.key === chKey)) return false;
  if (side !== "i" && side !== "o") return false;
  if (value != null && !Number.isFinite(value)) return false;
  let v = value;
  if (v != null) {
    if (v > CURVE_VALUE_LIMIT) v = CURVE_VALUE_LIMIT;
    if (v < -CURVE_VALUE_LIMIT) v = -CURVE_VALUE_LIMIT;
  }
  return commitClip("Mover tangente", (clip) => {
    const kf = findKeyframe(clip, trackKey, kfId);
    if (!kf) return false;
    ensureKfCurve(kf);
    kf.tan[chKey][side] = v;
  });
}


export function zeroTangents(list, chKey) {
  if (!session || !list || !list.length) return false;

  const chans = chKey
    ? CURVE_CHANNELS.filter((c) => c.key === chKey).map((c) => c.key)
    : CURVE_CHANNELS.map((c) => c.key);
  if (!chans.length) return false;
  return commitClip("Zerar tangente(s)", (clip) => {
    for (const ref of list) {
      const kf = findKeyframe(clip, ref.trackKey, ref.kfId);
      if (!kf) continue;
      ensureKfCurve(kf);
      for (const c of chans) { kf.tan[c].i = 0; kf.tan[c].o = 0; }
    }
  });
}


export function resetTangents(list, chKey) {
  if (!session || !list || !list.length) return false;

  const chans = chKey
    ? CURVE_CHANNELS.filter((c) => c.key === chKey).map((c) => c.key)
    : CURVE_CHANNELS.map((c) => c.key);
  if (!chans.length) return false;
  return commitClip("Resetar tangente(s)", (clip) => {
    for (const ref of list) {
      const kf = findKeyframe(clip, ref.trackKey, ref.kfId);
      if (!kf) continue;
      ensureKfCurve(kf);
      for (const c of chans) { kf.tan[c].i = null; kf.tan[c].o = null; }
    }
  });
}


export function setInterpolation(list, mode) {
  if (!session || !list || !list.length) return false;
  if (INTERP_MODES.indexOf(mode) === -1) return false;
  return commitClip("Mudar interpolação", (clip) => {
    for (const ref of list) {
      const kf = findKeyframe(clip, ref.trackKey, ref.kfId);
      if (!kf) continue;
      ensureKfCurve(kf);
      kf.interp = mode;
    }
  });
}


export function generateCurveForSelection(list, kind, dir) {
  if (!session || !list || !list.length) return false;
  const byTrack = {};
  for (const ref of list) {
    (byTrack[ref.trackKey] = byTrack[ref.trackKey] || []).push(ref.kfId);
  }
  const eligible = Object.keys(byTrack).some((k) => byTrack[k].length >= 2);
  if (!eligible) {
    logger.warn("Generate Curve: selecione 2 ou mais keyframes na mesma track.");
    return false;
  }
  return commitClip("Generate Curve (" + kind + " " + dir + ")", (clip) => {
    ensureCurveData(clip);
    modelGenerateCurve(clip, byTrack, kind, dir);
  });
}


export function markEndKeyframe(trackKey, kfId) {
  if (!session) return false;
  return commitClip("Renomear keyframe final", (clip) => {
    const kf = findKeyframe(clip, trackKey, kfId);
    if (!kf) return false;
    kf.label = "End";
  });
}


export function renameClip(name) {
  if (!session) return false;
  const clean = sanitizeName(name, "Animation");
  if (clean === session.clip.name) return false;
  return commitClip("Renomear animação", (clip) => {
    clip.name = clean;

  });
}

export function setDuration(seconds) {
  if (!session) return false;
  const d = sanitizeDuration(seconds);
  if (Math.abs(d - session.clip.duration) < 1e-6) return false;
  return commitClip("Alterar duração", (clip) => {
    clip.duration = d;

    for (const key in clip.tracks) {
      for (const kf of clip.tracks[key].keyframes) kf.time = clampTime(clip, kf.time);
    }


    if (Array.isArray(clip.events) && clip.events.length) {
      for (const ev of clip.events) ev.time = clampTime(clip, ev.time);
      clip.events.sort((a, b) => a.time - b.time);
    }
  });
}

export function setLooping(on) {
  if (!session) return false;
  const val = !!on;
  if (val === session.clip.looping) return false;
  return commitClip("Alterar looping", (clip) => {
    clip.looping = val;
  });
}

export function setPriority(priority) {
  if (!session) return false;
  if (PRIORITIES.indexOf(priority) === -1) return false;
  if (priority === session.clip.priority) return false;
  return commitClip("Alterar prioridade", (clip) => {
    clip.priority = priority;
  });
}


function ensureSavesFolder() {
  const dm = store.getDataModel();
  const ss = getService(dm, "ServerStorage");
  if (!ss) return null;
  let folder = ss.findFirstChild(SAVES_FOLDER, false);
  if (!live(folder)) {
    folder = createInstance("Folder", { name: SAVES_FOLDER, parent: ss });
  }
  return folder;
}

function findSavedInstance() {
  if (!session || !session.savedInstanceId) return null;
  const dm = store.getDataModel();
  const ss = getService(dm, "ServerStorage");
  if (!ss) return null;
  const found = ss.getDescendants().find((d) => d.id === session.savedInstanceId);
  return live(found) ? found : null;
}

function writeClipToInstance(inst, clip) {

  Object.defineProperty(inst, "_clipData", {
    value: cloneClip(clip),
    writable: true,
    enumerable: false,
    configurable: true,
  });
  inst.setProperty("Loop", !!clip.looping);
  inst.setProperty("Priority", clip.priority);
  inst.setProperty("Duration", clip.duration);
  inst.setProperty("AssetId", clip.publishedAssetId || 0);
}


let _syncTimer = null;
function syncSavedInstanceLater() {
  if (_syncTimer) clearTimeout(_syncTimer);
  _syncTimer = setTimeout(() => {
    _syncTimer = null;


    if (!session || !session.clip) return;
    const inst = findSavedInstance();
    if (inst && inst.name !== session.clip.name) {
      inst.setProperty("Name", session.clip.name);
    }
  }, 200);
}


export function save() {
  if (!session) return false;
  const folder = ensureSavesFolder();
  if (!folder) {
    logger.warn("Não foi possível acessar ServerStorage para salvar a animação.");
    return false;
  }
  const clipSnapshot = cloneClip(session.clip);
  const name = sanitizeName(clipSnapshot.name, "Animation");
  const existing = findSavedInstance();

  if (existing) {

    const prevClip = existing._clipData ? cloneClip(existing._clipData) : null;
    const prevName = existing.name;
    commands.execute({
      name: "Sobrescrever animação",
      do() {
        existing.setProperty("Name", name);
        writeClipToInstance(existing, clipSnapshot);
      },
      undo() {
        existing.setProperty("Name", prevName);
        if (prevClip) writeClipToInstance(existing, prevClip);
      },
    });
    if (session) session.dirty = false;
    logger.info('Animação "' + name + '" sobrescrita em ServerStorage/' + SAVES_FOLDER + ".");
    setStatus('Animação "' + name + '" salva');
    bus.emit(AnimEvents.Saved, { instanceId: existing.id, name });
    return true;
  }


  let created = null;
  commands.execute({
    name: "Salvar animação",
    do() {
      if (!created) {
        created = createInstance("KeyframeSequence", { name, parent: folder });
        writeClipToInstance(created, clipSnapshot);
      } else {
        created.setParent(folder);
      }
      if (session) session.savedInstanceId = created.id;
    },
    undo() {
      if (created) created.setParent(null);
      if (session) session.savedInstanceId = null;
    },
  });
  if (session) session.dirty = false;
  logger.info('Animação "' + name + '" salva em ServerStorage/' + SAVES_FOLDER + ".");
  setStatus('Animação "' + name + '" salva');
  bus.emit(AnimEvents.Saved, { instanceId: created ? created.id : null, name });
  return true;
}


function genAssetId() {
  return Math.floor(1e9 + Math.random() * 8e9);
}

export function publish(meta) {
  if (!session) return null;
  const name = sanitizeName(meta && meta.name, session.clip.name);
  const desc = sanitizeName(meta && meta.description, "");
  const creator = sanitizeName(meta && meta.creator, "Me");
  const assetId = genAssetId();

  commitClip("Publicar animação", (clip) => {
    clip.name = name;
    clip.publishedAssetId = assetId;
    const endTime = clip.duration;
    for (const key in clip.tracks) {
      const track = clip.tracks[key];
      if (!track.keyframes.length) continue;
      const last = track.keyframes[track.keyframes.length - 1];
      if (Math.abs(last.time - endTime) <= 1e-3) {
        last.label = "End";
      } else {
        const kf = makeKeyframe(endTime, last.pos, last.rot, last.style, last.dir, "End");
        upsertKeyframe(clip, key, track.partName, kf);
      }
    }
  });

  save();
  logger.info(
    'Animação "' + name + '" publicada (simulado). Asset ID: ' + assetId + " — criador: " + (creator || "Me") + "."
  );
  if (desc) logger.info("Descrição: " + desc);
  setStatus("Publicado — Asset ID " + assetId);
  return { assetId, name, description: desc, creator };
}


function onAnyDestroying(payload) {
  if (!session) return;
  const inst = payload && payload.instance;
  if (!inst) return;
  if (inst.id === session.rig.id || !live(session.rig)) {
    close("rig-destroyed");
    bus.emit("anim:force-close", {});
  }
}


const EVENT_TRACK_KEY = "rsw.animEditor.eventTrack";
let _eventTrackVisible = readEventTrackVisible();
function readEventTrackVisible() {
  try {
    return window.localStorage.getItem(EVENT_TRACK_KEY) !== "0";
  } catch (_) {
    return true;
  }
}
export function getEventTrackVisible() {
  return _eventTrackVisible;
}
export function setEventTrackVisible(on) {
  _eventTrackVisible = !!on;
  try {
    window.localStorage.setItem(EVENT_TRACK_KEY, _eventTrackVisible ? "1" : "0");
  } catch (_) {}
  bus.emit("anim:event-track-visibility", { visible: _eventTrackVisible });
}


export function getEvents() {
  if (!session || !session.clip) return [];
  _ensureEvents(session.clip);
  return session.clip.events;
}
export function getMaxEvents() {
  return MAX_EVENTS;
}

export function eventNameExists(name, exceptId) {
  if (!session || !session.clip) return false;
  return _eventNameExistsModel(session.clip, name, exceptId);
}


export function addAnimationEvent(time, name, param) {
  if (!session) return false;
  _ensureEvents(session.clip);
  if (session.clip.events.length >= MAX_EVENTS) {
    logger.warn("Limite de " + MAX_EVENTS + " marcadores de evento atingido.");
    return false;
  }
  return commitClip("Adicionar evento", (clip) => {
    const ev = _addEventModel(clip, time, name, param);
    return ev ? undefined : false;
  });
}
export function updateAnimationEvent(id, name, param) {
  if (!session) return false;
  return commitClip("Editar evento", (clip) => {
    return _updateEventModel(clip, id, { name, param }) ? undefined : false;
  });
}

export function moveAnimationEvents(ids, deltaTime) {
  if (!session || !ids || !ids.length) return false;
  const dt = Number(deltaTime);
  if (!Number.isFinite(dt) || dt === 0) return false;
  return commitClip("Mover evento", (clip) => {
    let any = false;
    for (const id of ids) {
      const ev = _findEventModel(clip, id);
      if (ev && _moveEventModel(clip, id, ev.time + dt)) any = true;
    }
    return any ? undefined : false;
  });
}
export function deleteAnimationEvents(ids) {
  if (!session || !ids || !ids.length) return false;
  return commitClip("Deletar evento", (clip) => {
    let any = false;
    for (const id of ids) if (_removeEventModel(clip, id)) any = true;
    return any ? undefined : false;
  });
}

export function duplicateAnimationEvents(ids, deltaTime) {
  if (!session || !ids || !ids.length) return false;
  const off = Number.isFinite(deltaTime) ? deltaTime : 0;
  return commitClip("Duplicar evento", (clip) => {
    let any = false;
    for (const id of ids) {
      const src = _findEventModel(clip, id);
      if (!src) continue;
      if (_addEventModel(clip, src.time + off, src.name, src.param)) any = true;
    }
    return any ? undefined : false;
  });
}

export function pasteAnimationEvents(items, baseTime) {
  if (!session || !items || !items.length) return false;
  const t0 = Math.min.apply(null, items.map((i) => i.time));
  const base = Number.isFinite(baseTime) ? baseTime : 0;
  return commitClip("Colar evento", (clip) => {
    let any = false;
    for (const it of items) {
      if (_addEventModel(clip, base + (it.time - t0), it.name, it.param)) any = true;
    }
    return any ? undefined : false;
  });
}


const CLIP_FILE_FORMAT = "rsw-animation";
const MAX_IMPORT_TRACKS = 200;
const MAX_IMPORT_KEYFRAMES = 20000;


export function exportClipData() {
  if (!session) return null;
  return {
    format: CLIP_FILE_FORMAT,
    version: 1,
    exportedAt: new Date().toISOString(),
    clip: cloneClip(session.clip),
  };
}

function findSavesFolder() {
  const dm = store.getDataModel();
  const ss = dm ? getService(dm, "ServerStorage") : null;
  if (!ss || typeof ss.getChildren !== "function") return null;
  const folder = ss.getChildren().find((c) => c.name === SAVES_FOLDER && !c.isDestroyed());
  return folder || null;
}


export function listSavedAnimations() {
  const folder = findSavesFolder();
  if (!folder) return [];
  const out = [];
  for (const ch of folder.getChildren()) {
    if (!ch || ch.isDestroyed() || ch.className !== "KeyframeSequence" || !ch._clipData) continue;
    out.push({
      id: ch.id,
      name: ch.name,
      duration: Number(ch._clipData.duration) || 0,
    });
  }
  return out;
}


export function importSavedAnimation(instanceId) {
  const folder = findSavesFolder();
  const inst = folder ? folder.getChildren().find((c) => c.id === instanceId) : null;
  if (!inst || inst.isDestroyed() || !inst._clipData) {
    return { ok: false, error: "Animação salva não encontrada." };
  }
  return importClipData({ format: CLIP_FILE_FORMAT, version: 1, clip: inst._clipData }, inst.name, inst.id);
}


export function importClipData(data, sourceLabel, savedInstanceId) {
  if (!session) return { ok: false, error: "Abra o Animation Editor antes de importar." };
  const env = data && typeof data === "object" ? data : null;
  if (!env) return { ok: false, error: "Arquivo de animação inválido." };
  if (env.format != null && env.format !== CLIP_FILE_FORMAT) {
    return { ok: false, error: `Formato não reconhecido (esperado "${CLIP_FILE_FORMAT}").` };
  }
  const raw = env.clip && typeof env.clip === "object" ? env.clip : env;
  if (!raw.tracks || typeof raw.tracks !== "object" || Array.isArray(raw.tracks)) {
    return { ok: false, error: "Arquivo de animação inválido (sem tracks)." };
  }
  const trackKeys = Object.keys(raw.tracks);
  if (trackKeys.length > MAX_IMPORT_TRACKS) {
    return { ok: false, error: `Arquivo excede o limite de ${MAX_IMPORT_TRACKS} tracks.` };
  }

  const byName = new Map();
  for (const p of session.parts) {
    const k = String(p.name || "").toLowerCase();
    if (!byName.has(k)) byName.set(k, p);
  }


  let rawDuration = Number(raw.duration);
  if (!Number.isFinite(rawDuration) || rawDuration <= 0) {
    let maxT = 0;
    for (const key of trackKeys) {
      const tr = raw.tracks[key];
      if (!tr || typeof tr !== "object" || !Array.isArray(tr.keyframes)) continue;
      for (const kf of tr.keyframes) {
        const t = Number(kf && kf.time);
        if (Number.isFinite(t) && t > maxT) maxT = t;
      }
    }
    rawDuration = maxT > 0 ? maxT : null;
  }
  const built = createClip({
    name: sanitizeName(
      typeof raw.name === "string" && raw.name.trim() ? raw.name : String(sourceLabel || ""),
      "Imported Animation",
    ),
    fps: raw.fps,
    duration: rawDuration,
    looping: !!raw.looping,
    priority: raw.priority,
    targetRigName: session.rig && !session.rig.isDestroyed() ? session.rig.name : "",
    targetRigType: session.rigType,
  });
  let matched = 0;
  let skipped = 0;
  let kfCount = 0;
  for (const key of trackKeys) {
    const tr = raw.tracks[key];
    if (!tr || typeof tr !== "object" || !Array.isArray(tr.keyframes)) {
      skipped += 1;
      continue;
    }
    const target = byName.get(String(tr.partName || "").toLowerCase());
    if (!target) {
      skipped += 1;
      continue;
    }
    matched += 1;
    for (const kf of tr.keyframes) {
      if (!kf || typeof kf !== "object") continue;
      kfCount += 1;
      if (kfCount > MAX_IMPORT_KEYFRAMES) {
        return { ok: false, error: `Arquivo excede o limite de ${MAX_IMPORT_KEYFRAMES} keyframes.` };
      }
      const nk = upsertKeyframe(
        built,
        target.key,
        target.name,
        makeKeyframe(kf.time, kf.pos, kf.rot, kf.style, kf.dir, typeof kf.label === "string" ? kf.label : ""),
      );

      if (nk && kf.interp && INTERP_MODES.indexOf(kf.interp) !== -1) nk.interp = kf.interp;


      if (nk && kf.tan && typeof kf.tan === "object") {
        const rawTan = kf.tan;
        const sanTan = {};
        for (const ch of CURVE_CHANNELS) {
          const t = rawTan[ch.key];
          if (t && typeof t === "object") {
            const iv = t.i != null ? Number(t.i) : null;
            const ov = t.o != null ? Number(t.o) : null;
            sanTan[ch.key] = {
              i: iv !== null && Number.isFinite(iv) && Math.abs(iv) <= CURVE_VALUE_LIMIT ? iv : null,
              o: ov !== null && Number.isFinite(ov) && Math.abs(ov) <= CURVE_VALUE_LIMIT ? ov : null,
            };
          } else {
            sanTan[ch.key] = { i: null, o: null };
          }
        }
        nk.tan = sanTan;
      }
    }
  }
  if (!matched) {
    return { ok: false, error: "Nenhuma track corresponde às partes do rig atual." };
  }
  if (Array.isArray(raw.events) && raw.events.length) {
    _ensureEvents(built);
    for (const ev of raw.events) {
      if (ev && typeof ev === "object") _addEventModel(built, ev.time, ev.name, ev.param);
    }
  }
  if (raw.curveMode) {
    built.curveMode = true;
    built.rotationType = ROTATION_TYPES.indexOf(raw.rotationType) !== -1 ? raw.rotationType : "Euler";
    ensureCurveData(built);
  }




  const beforeClip = cloneClip(session.clip);
  const prevSaved = session.savedInstanceId;
  const nextSaved = savedInstanceId || null;
  const afterClip = cloneClip(built);
  const applied = commands.execute({
    name: "Import Animation",
    do() {
      if (!session) return;
      session.clip = cloneClip(afterClip);
      session.savedInstanceId = nextSaved;
      afterClipChange("Import Animation");
    },
    undo() {
      if (!session) return;
      session.clip = cloneClip(beforeClip);
      session.savedInstanceId = prevSaved;
      afterClipChange("Import Animation");
    },
  });
  if (!applied) return { ok: false, error: "Não foi possível aplicar a animação importada." };
  setTime(0);
  const src = sourceLabel ? ` de "${sourceLabel}"` : "";
  logger.info(
    `Animação importada${src}: ${matched} track(s) mapeada(s), ${skipped} ignorada(s), ${kfCount} keyframe(s).`,
  );
  return { ok: true, matched, skipped, keyframes: kfCount };
}
