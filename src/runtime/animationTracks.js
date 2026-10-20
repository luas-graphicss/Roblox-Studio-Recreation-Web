import { bus } from "../core/eventBus.js";

import { registerFrameCallback } from "../core/frameDriver.js";
import { logger as baseLogger } from "../core/logger.js";
import { Events, getService, createInstance } from "../datamodel/index.js";
import { evaluateClip, PRIORITIES } from "../animation/animationModel.js";

const DEFAULT_FADE = 0.1;                                                             

let active = false;
let dataModel = null;
let log = baseLogger;
let isPausedFn = null;
let unregisterFrameCallback = null;
let lastTs = 0;
let busOffs = [];
let syncing = false;                                                          


const tracks = new Map();

function setInternal(track, prop, value) {
  syncing = true;
  try { track._setInternal(prop, value); } catch (_) {          }
  syncing = false;
}

function emitTrack(track, type, args) {
  bus.emit("animtrack:event", { track, type, args: args || [] });
}

function emitAnimator(animator, type, args) {
  bus.emit("animtrack:event", { animator, type, args: args || [] });
}


export function ensureAnimator(hum) {
  if (!hum || typeof hum.getChildren !== "function") return null;
  let animator = hum.getChildren().find((c) => c.className === "Animator") || null;
  if (!animator) {
    try { animator = createInstance("Animator", { name: "Animator", parent: hum }); } catch (_) { animator = null; }
  }
  return animator;
}


function resolveKeyframeSequence(animation) {

  try {
    const child = animation.getChildren().find((c) => c.className === "KeyframeSequence");
    if (child) return child;
  } catch (_) {          }

  let raw = "";
  try { raw = String(animation.getProperty("AnimationId") || ""); } catch (_) { raw = ""; }
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const m = trimmed.match(/(\d+)\s*$/);
  const numId = m ? Number(m[1]) : null;
  const ss = dataModel ? getService(dataModel, "ServerStorage") : null;
  const folder = ss && ss.findFirstChild ? ss.findFirstChild("AnimSaves") : null;
  if (!folder || typeof folder.getChildren !== "function") return null;
  const list = folder.getChildren().filter((c) => c.className === "KeyframeSequence");
  let ks = null;
  if (numId != null && numId > 0) {
    ks = list.find((k) => Number(k.getProperty("AssetId")) === numId) || null;
  }
  if (!ks) {
    ks = list.find((k) => String(k.getProperty("Name") || "") === trimmed) || null;
  }
  return ks;
}


function namedKeyframesOf(ks) {
  const out = [];
  const cd = ks ? ks._clipData : null;
  if (cd) {
    const kfs = Array.isArray(cd.keyframes) ? cd.keyframes : [];
    for (const kf of kfs) {
      const name = String((kf && kf.name) || "");
      const time = Number(kf && kf.time);
      if (name && name !== "Keyframe" && Number.isFinite(time)) out.push({ time: Math.max(0, time), name });
    }
    const evs = Array.isArray(cd.events) ? cd.events : [];
    for (const ev of evs) {
      const name = String((ev && ev.name) || "");
      const time = Number(ev && ev.time);
      if (name && Number.isFinite(time)) out.push({ time: Math.max(0, time), name });
    }
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}


export function animLoadAnimation(animator, animation) {
  if (!animator || animator.className !== "Animator") return null;
  if (!animation || animation.className !== "Animation" || typeof animation.getProperty !== "function") return null;
  const ks = resolveKeyframeSequence(animation);
  const cd = ks ? ks._clipData : null;
  let length = ks ? Number(ks.getProperty("Duration")) : 0;
  if (!Number.isFinite(length) || length <= 0) length = cd && Number(cd.duration) > 0 ? Number(cd.duration) : 1;
  let track = null;
  try {
    track = createInstance("AnimationTrack", { name: String(animation.getProperty("Name") || "AnimationTrack") });
  } catch (e) {
    log.warn("LoadAnimation: " + ((e && e.message) || e), { source: "Animator" });
    return null;
  }
  setInternal(track, "Length", length);
  setInternal(track, "IsPlaying", false);
  setInternal(track, "Speed", 1);
  setInternal(track, "WeightCurrent", 0);
  setInternal(track, "WeightTarget", 0);
  setInternal(track, "TimePosition", 0);
  if (ks) {
    setInternal(track, "Looped", ks.getProperty("Loop") === true);
    setInternal(track, "Priority", String(ks.getProperty("Priority") || "Idle"));
  }
  tracks.set(track, {
    animator,
    animation,

    clip: cd && cd.tracks ? cd : null,
    keyframes: namedKeyframesOf(ks),
    length,
    time: 0,
    speed: 1,
    playing: false,
    pendingEnded: false,


    weight: 0,
    fading: false,
    fadeFrom: 0,
    fadeTo: 0,
    fadeDur: 0,
    fadeElapsed: 0,
  });
  return track;
}

export function animGetPlayingTracks(animator) {
  const out = [];
  for (const [track, st] of tracks) {
    if (st.animator === animator && st.playing) out.push(track);
  }
  return out;
}


function normFade(fadeTime) {
  const f = Number(fadeTime);
  return Number.isFinite(f) && f >= 0 ? f : DEFAULT_FADE;
}


function startFade(track, st, target, dur) {

  if (!Number.isFinite(target) || !Number.isFinite(dur)) {
    throw new Error("startFade: weight/fadeTime não-finito (" + target + ", " + dur + ")");
  }
  const to = Math.max(0, Math.min(1, target));
  setInternal(track, "WeightTarget", to);                                       
  if (dur > 0 && Math.abs(to - st.weight) > 1e-9) {
    st.fading = true;
    st.fadeFrom = st.weight;
    st.fadeTo = to;
    st.fadeDur = dur;
    st.fadeElapsed = 0;
    return;
  }
  st.fading = false;
  st.weight = to;
  setInternal(track, "WeightCurrent", to);
}

export function animTrackPlay(track, fadeTime, weight, speed) {
  const st = tracks.get(track);
  if (!st) return false;
  const w = weight == null ? 1 : Math.max(0, Math.min(1, Number(weight) || 0));
  if (speed != null && Number.isFinite(Number(speed))) {
    st.speed = Number(speed);
    setInternal(track, "Speed", st.speed);
  }
  if (!st.playing && st.time >= st.length) {
    st.time = 0;                                               
    setInternal(track, "TimePosition", 0);
  }
  st.playing = true;
  st.pendingEnded = false;                                                       
  startFade(track, st, w, normFade(fadeTime));                                         
  setInternal(track, "IsPlaying", true);
  emitAnimator(st.animator, "AnimationPlayed", [track]);
  return true;
}

export function animTrackStop(track, fadeTime) {
  const st = tracks.get(track);
  if (!st) return false;
  if (!st.playing) return true;
  st.playing = false;
  setInternal(track, "IsPlaying", false);
  emitTrack(track, "Stopped", []);
  st.pendingEnded = true;                                                        
  startFade(track, st, 0, normFade(fadeTime));
  return true;
}

export function animTrackAdjustSpeed(track, speed) {
  const st = tracks.get(track);
  if (!st) return false;
  const s = Number(speed);
  st.speed = Number.isFinite(s) ? s : 1;
  setInternal(track, "Speed", st.speed);
  return true;
}

export function animTrackAdjustWeight(track, weight, fadeTime) {
  const st = tracks.get(track);
  if (!st) return false;


  if (st.pendingEnded && !st.playing) return true;
  const w = Number(weight);
  startFade(track, st, Number.isFinite(w) ? w : 1, normFade(fadeTime));
  return true;
}

export function animGetTimeOfKeyframe(track, keyframeName) {
  const st = tracks.get(track);
  if (!st) return null;
  const target = String(keyframeName == null ? "" : keyframeName);
  const kf = st.keyframes.find((k) => k.name === target);
  return kf ? kf.time : null;
}
















const DEG2RAD = Math.PI / 180;
const MIN_RENDER_WEIGHT = 1e-3;                                                


function priorityIndex(track) {
  let p = "Idle";
  try { p = String(track.getProperty("Priority") || "Idle"); } catch (_) { p = "Idle"; }
  const i = PRIORITIES.indexOf(p);
  return i === -1 ? PRIORITIES.indexOf("Idle") : i;
}

export function animClipPoseFor(humOrAnimator) {
  if (!active || !humOrAnimator) return null;
  let animator = humOrAnimator;
  if (animator.className !== "Animator") {
    if (typeof animator.getChildren !== "function") return null;
    animator = animator.getChildren().find((c) => c.className === "Animator") || null;
    if (!animator) return null;
  }
  let list = null;
  for (const [track, st] of tracks) {
    if (st.animator !== animator || !st.clip) continue;
    if (st.weight <= MIN_RENDER_WEIGHT) continue;                               
    (list || (list = [])).push({ track, st });
  }
  if (!list) return null;

  list.sort((a, b) => priorityIndex(b.track) - priorityIndex(a.track));


  const acc = new Map();
  for (const { st } of list) {
    const w = Math.min(1, st.weight);
    const t = Math.max(0, Math.min(st.length, st.time));
    try {
      const poses = evaluateClip(st.clip, t);
      for (const key in poses) {
        const tr = st.clip.tracks[key];


        if (!tr || typeof tr.partName !== "string") {
          throw new Error("clipe sem partName na track " + key);
        }
        const name = tr.partName;
        if (!name) continue;
        const rx = Number(poses[key] && poses[key].rot ? poses[key].rot.x : NaN);
        if (!Number.isFinite(rx)) continue;                                        
        let e = acc.get(name);
        if (!e) { e = { c: 0, k: 1 }; acc.set(name, e); }
        e.c = e.c * (1 - w) + rx * DEG2RAD * w;
        e.k = e.k * (1 - w);
      }
    } catch (e) {
      log.warn("AnimationTrack: pose do clipe ignorada: " + ((e && e.message) || e), { source: "Animator" });
    }
  }
  if (!acc.size) return null;
  const parts = new Map();
  let key = "";
  for (const [name, e] of acc) {
    const w = 1 - e.k;
    if (w <= MIN_RENDER_WEIGHT) continue;
    const p = e.c / w;
    parts.set(name, { p, w });
    key += name + ":" + Math.round(p * 200) + ":" + Math.round(w * 100) + ";";
  }
  return parts.size ? { key, parts } : null;
}


function onPropertyChanged(p) {
  if (!active || syncing || !p || !p.instance) return;
  const inst = p.instance;
  if (inst.className !== "AnimationTrack") return;
  const st = tracks.get(inst);
  if (!st) return;
  if (p.property === "TimePosition") {
    const t = Number(inst.getProperty("TimePosition"));
    if (Number.isFinite(t)) st.time = Math.max(0, Math.min(st.length, t));
  }
}


function fireKeyframesCrossed(track, st, from, to) {
  for (const kf of st.keyframes) {
    if (kf.time > from && kf.time <= to) emitTrack(track, "KeyframeReached", [kf.name]);
  }
}

function finishNonLooped(track, st, endTime) {
  st.playing = false;
  setInternal(track, "IsPlaying", false);
  emitTrack(track, "Stopped", []);
  st.pendingEnded = true;                                                    
  startFade(track, st, 0, DEFAULT_FADE);
  return endTime;
}


function tickFade(track, st, dt) {
  if (st.fading && dt > 0) {
    st.fadeElapsed += dt;
    const k = Math.min(1, st.fadeElapsed / st.fadeDur);
    st.weight = st.fadeFrom + (st.fadeTo - st.fadeFrom) * k;
    if (k >= 1) {
      st.weight = st.fadeTo;
      st.fading = false;
    }
    setInternal(track, "WeightCurrent", st.weight);
  }
  if (st.pendingEnded && !st.playing && !st.fading && st.weight <= 0) {
    st.pendingEnded = false;
    emitTrack(track, "Ended", []);
  }
}

function tickTrack(track, st, dt) {
  tickFade(track, st, dt);
  if (!st.playing || dt <= 0) return;
  const looped = track.getProperty("Looped") === true;
  const prev = st.time;
  let next = prev + dt * st.speed;
  if (st.speed >= 0) {
    if (next < st.length) {
      fireKeyframesCrossed(track, st, prev, next);
    } else if (looped && st.length > 0) {
      fireKeyframesCrossed(track, st, prev, st.length);
      next = next % st.length;
      emitTrack(track, "DidLoop", []);
      fireKeyframesCrossed(track, st, -1e-9, next);
    } else {
      fireKeyframesCrossed(track, st, prev, st.length);
      next = finishNonLooped(track, st, st.length);
    }
  } else if (next > 0) {

    for (const kf of st.keyframes) {
      if (kf.time >= next && kf.time < prev) emitTrack(track, "KeyframeReached", [kf.name]);
    }
  } else if (looped && st.length > 0) {
    next = st.length;
    emitTrack(track, "DidLoop", []);
  } else {
    next = finishNonLooped(track, st, 0);
  }
  st.time = next;
  setInternal(track, "TimePosition", next);
}

function tick(ts) {
  if (!active) return;
  if (isPausedFn && isPausedFn()) {
    lastTs = ts;
    return;
  }
  const dt = Math.min(0.05, Math.max(0, (ts - lastTs) / 1000)) || 0;
  lastTs = ts;
  animStep(dt);
}


export function animStep(dt) {
  for (const [track, st] of tracks) {
    try { tickTrack(track, st, dt); } catch (e) {
      log.warn("AnimationTrack: " + ((e && e.message) || e), { source: "Animator" });
    }
  }
}


export const animationTracks = {
  isActive: () => active,

  start(opts) {
    if (active) this.stop();
    active = true;
    dataModel = (opts && opts.dataModel) || null;
    log = (opts && opts.logger) || baseLogger;
    isPausedFn = opts && typeof opts.isPaused === "function" ? opts.isPaused : null;
    lastTs = typeof performance !== "undefined" && performance.now ? performance.now() : 0;
    busOffs.push(bus.on(Events.PropertyChanged, onPropertyChanged));
    unregisterFrameCallback = registerFrameCallback("animation", tick, "animationTracks:step");
  },

  stop() {
    active = false;
    if (unregisterFrameCallback) {
      unregisterFrameCallback();
      unregisterFrameCallback = null;
    }
    for (const off of busOffs) {
      try { off(); } catch (_) {          }
    }
    busOffs = [];
    tracks.clear();
    dataModel = null;
    isPausedFn = null;
  },
};
