import { ease, sanitizeEasing } from "./easing.js";

import { deepCloneJsonValue } from "../core/deepCloneJsonValue.js";

export const DEFAULT_FPS = 30;
export const DEFAULT_DURATION = 1;                                          
export const MIN_DURATION = 0.1;
export const MAX_DURATION = 600;                                       
export const TIME_EPSILON = 1e-4;


export const PRIORITIES = Object.freeze([
  "Action4",
  "Action3",
  "Action2",
  "Action",
  "Movement",
  "Idle",
  "Core",
]);
export const DEFAULT_PRIORITY = "Idle";


export const INTERP_MODES = Object.freeze(["Linear", "Constant", "Cubic"]);
export const DEFAULT_INTERP = "Cubic";

export const ROTATION_TYPES = Object.freeze(["Euler", "Quaternion"]);
export const DEFAULT_ROTATION_TYPE = "Euler";

export const CURVE_VALUE_LIMIT = 1e6;


export const CURVE_CHANNELS = Object.freeze([
  { key: "px", kind: "pos", axis: "x", label: "Position X", color: "#e0584f" },
  { key: "py", kind: "pos", axis: "y", label: "Position Y", color: "#35e07a" },
  { key: "pz", kind: "pos", axis: "z", label: "Position Z", color: "#4c8bf5" },
  { key: "rx", kind: "rot", axis: "x", label: "Rotation X", color: "#e0584f" },
  { key: "ry", kind: "rot", axis: "y", label: "Rotation Y", color: "#35e07a" },
  { key: "rz", kind: "rot", axis: "z", label: "Rotation Z", color: "#4c8bf5" },
]);

function channelDef(chKey) {
  for (const c of CURVE_CHANNELS) if (c.key === chKey) return c;
  return null;
}


export function channelValue(kf, chKey) {
  const ch = channelDef(chKey);
  if (!ch || !kf) return 0;
  const v = ch.kind === "pos" ? kf.pos : kf.rot;
  return num(v && v[ch.axis], 0);
}
export function setChannelValue(kf, chKey, value) {
  const ch = channelDef(chKey);
  if (!ch || !kf) return;
  const v = ch.kind === "pos" ? (kf.pos = vec(kf.pos)) : (kf.rot = vec(kf.rot));
  let n = num(value, 0);
  if (n > CURVE_VALUE_LIMIT) n = CURVE_VALUE_LIMIT;
  if (n < -CURVE_VALUE_LIMIT) n = -CURVE_VALUE_LIMIT;
  v[ch.axis] = n;
}

function validTan(v) {
  return Number.isFinite(v) ? v : null;
}


export function ensureKfCurve(kf, nextKf, interpHint) {
  if (!kf) return kf;
  if (INTERP_MODES.indexOf(kf.interp) === -1) {
    if (INTERP_MODES.indexOf(interpHint) !== -1) {




      kf.interp = interpHint;
    } else if (nextKf && INTERP_MODES.indexOf(nextKf.interp) !== -1) {


      kf.interp = nextKf.interp;
    } else {






      const src = nextKf || kf;
      if (src.style === "Linear") kf.interp = "Linear";
      else if (src.style === "Constant") kf.interp = "Constant";
      else kf.interp = "Cubic";
    }
  }
  const prev = kf.tan && typeof kf.tan === "object" ? kf.tan : {};
  const tan = {};
  for (const ch of CURVE_CHANNELS) {
    const t = prev[ch.key];
    tan[ch.key] = t && typeof t === "object"
      ? { i: validTan(t.i), o: validTan(t.o) }
      : { i: null, o: null };
  }
  kf.tan = tan;
  return kf;
}


export function ensureCurveData(clip) {
  if (!clip) return clip;
  clip.curveMode = true;
  if (ROTATION_TYPES.indexOf(clip.rotationType) === -1) clip.rotationType = DEFAULT_ROTATION_TYPE;
  for (const key in clip.tracks) {
    const kfs = clip.tracks[key].keyframes;


    const had = kfs.map((k) => INTERP_MODES.indexOf(k.interp) !== -1);
    for (let i = 0; i < kfs.length; i++) {
      const hint = i > 0 && had[i - 1] && !had[i] ? kfs[i - 1].interp : null;
      ensureKfCurve(kfs[i], kfs[i + 1] || null, hint);
    }
  }
  return clip;
}

export function hasCurveData(clip) {
  return !!(clip && clip.curveMode);
}


function autoSlope(kfs, i, chKey) {
  const n = kfs.length;
  if (n < 2) return 0;
  const cur = kfs[i];
  const prev = i > 0 ? kfs[i - 1] : null;
  const next = i < n - 1 ? kfs[i + 1] : null;
  if (prev && next) {
    const dt = next.time - prev.time;
    return dt > TIME_EPSILON ? (channelValue(next, chKey) - channelValue(prev, chKey)) / dt : 0;
  }
  if (next) {
    const dt = next.time - cur.time;
    return dt > TIME_EPSILON ? (channelValue(next, chKey) - channelValue(cur, chKey)) / dt : 0;
  }
  if (prev) {
    const dt = cur.time - prev.time;
    return dt > TIME_EPSILON ? (channelValue(cur, chKey) - channelValue(prev, chKey)) / dt : 0;
  }
  return 0;
}

function tanOf(kf, chKey, side) {
  const t = kf && kf.tan && kf.tan[chKey];
  return t && Number.isFinite(t[side]) ? t[side] : null;
}


function outTangent(kfs, i, chKey) {
  const o = tanOf(kfs[i], chKey, "o");
  if (o != null) return o;
  const inn = tanOf(kfs[i], chKey, "i");
  if (inn != null) return inn;
  return autoSlope(kfs, i, chKey);
}
function inTangent(kfs, i, chKey) {
  const inn = tanOf(kfs[i], chKey, "i");
  if (inn != null) return inn;
  const o = tanOf(kfs[i], chKey, "o");
  if (o != null) return o;
  return autoSlope(kfs, i, chKey);
}


export function resolvedTangent(kfs, i, chKey, side) {
  if (i < 0 || i >= kfs.length) return 0;
  return side === "i" ? inTangent(kfs, i, chKey) : outTangent(kfs, i, chKey);
}
export function isTangentSet(kf, chKey, side) {
  return tanOf(kf, chKey, side) != null;
}

function safeNum(v, fb) {
  if (!Number.isFinite(v)) return fb;
  if (v > CURVE_VALUE_LIMIT) return CURVE_VALUE_LIMIT;
  if (v < -CURVE_VALUE_LIMIT) return -CURVE_VALUE_LIMIT;
  return v;
}


export function evaluateChannelValue(kfs, chKey, time) {
  if (!kfs || !kfs.length) return 0;


  if (!Number.isFinite(time)) time = 0;
  if (time <= kfs[0].time) return channelValue(kfs[0], chKey);
  const last = kfs[kfs.length - 1];
  if (time >= last.time) return channelValue(last, chKey);
  let i = 0;
  for (; i < kfs.length - 1; i++) {
    if (time >= kfs[i].time && time <= kfs[i + 1].time) break;
  }
  const a = kfs[i];
  const b = kfs[i + 1];
  const dt = b.time - a.time;
  const s = dt > TIME_EPSILON ? (time - a.time) / dt : 0;
  const va = channelValue(a, chKey);
  const vb = channelValue(b, chKey);
  const mode = INTERP_MODES.indexOf(a.interp) !== -1 ? a.interp : DEFAULT_INTERP;
  if (mode === "Constant") return va;
  if (mode === "Linear") return safeNum(va + (vb - va) * s, va);

  const m0 = outTangent(kfs, i, chKey);
  const m1 = inTangent(kfs, i + 1, chKey);
  const s2 = s * s;
  const s3 = s2 * s;
  const h00 = 2 * s3 - 3 * s2 + 1;
  const h10 = s3 - 2 * s2 + s;
  const h01 = -2 * s3 + 3 * s2;
  const h11 = s3 - s2;
  return safeNum(h00 * va + h10 * dt * m0 + h01 * vb + h11 * dt * m1, va);
}


function eulerToQuat(rx, ry, rz) {
  const x = (num(rx, 0) * Math.PI) / 180;
  const y = (num(ry, 0) * Math.PI) / 180;
  const z = (num(rz, 0) * Math.PI) / 180;
  const c1 = Math.cos(x / 2), s1 = Math.sin(x / 2);
  const c2 = Math.cos(y / 2), s2 = Math.sin(y / 2);
  const c3 = Math.cos(z / 2), s3 = Math.sin(z / 2);

  return {
    x: s1 * c2 * c3 + c1 * s2 * s3,
    y: c1 * s2 * c3 - s1 * c2 * s3,
    z: c1 * c2 * s3 + s1 * s2 * c3,
    w: c1 * c2 * c3 - s1 * s2 * s3,
  };
}

function quatToEuler(q) {
  const { x, y, z, w } = q;
  const x2 = x + x, y2 = y + y, z2 = z + z;
  const xx = x * x2, xy = x * y2, xz = x * z2;
  const yy = y * y2, yz = y * z2, zz = z * z2;
  const wx = w * x2, wy = w * y2, wz = w * z2;
  const m11 = 1 - (yy + zz), m12 = xy - wz, m13 = xz + wy;
  const m22 = 1 - (xx + zz), m23 = yz - wx;
  const m32 = yz + wx, m33 = 1 - (xx + yy);
  const clamp = (v) => (v < -1 ? -1 : v > 1 ? 1 : v);
  let ex, ey, ez;
  ey = Math.asin(clamp(m13));
  if (Math.abs(m13) < 0.9999999) {
    ex = Math.atan2(-m23, m33);
    ez = Math.atan2(-m12, m11);
  } else {
    ex = Math.atan2(m32, m22);
    ez = 0;
  }
  const deg = 180 / Math.PI;
  return { x: ex * deg, y: ey * deg, z: ez * deg };
}

function quatSlerp(a, b, t) {
  let bx = b.x, by = b.y, bz = b.z, bw = b.w;
  let dot = a.x * bx + a.y * by + a.z * bz + a.w * bw;
  if (dot < 0) { dot = -dot; bx = -bx; by = -by; bz = -bz; bw = -bw; }
  if (dot > 0.9995) {

    const x = a.x + (bx - a.x) * t;
    const y = a.y + (by - a.y) * t;
    const z = a.z + (bz - a.z) * t;
    const w = a.w + (bw - a.w) * t;
    const len = Math.hypot(x, y, z, w) || 1;
    return { x: x / len, y: y / len, z: z / len, w: w / len };
  }
  const theta0 = Math.acos(dot);
  const theta = theta0 * t;
  const sin0 = Math.sin(theta0);
  const s0 = Math.sin(theta0 - theta) / sin0;
  const s1 = Math.sin(theta) / sin0;
  return {
    x: a.x * s0 + bx * s1,
    y: a.y * s0 + by * s1,
    z: a.z * s0 + bz * s1,
    w: a.w * s0 + bw * s1,
  };
}


function evaluateRotationQuat(kfs, time) {
  if (!kfs.length) return { x: 0, y: 0, z: 0 };


  if (!Number.isFinite(time)) time = 0;
  if (time <= kfs[0].time) return vec(kfs[0].rot);
  const last = kfs[kfs.length - 1];
  if (time >= last.time) return vec(last.rot);
  let i = 0;
  for (; i < kfs.length - 1; i++) {
    if (time >= kfs[i].time && time <= kfs[i + 1].time) break;
  }
  const a = kfs[i];
  const b = kfs[i + 1];
  const dt = b.time - a.time;
  let s = dt > TIME_EPSILON ? (time - a.time) / dt : 0;
  const mode = INTERP_MODES.indexOf(a.interp) !== -1 ? a.interp : DEFAULT_INTERP;
  if (mode === "Constant") return vec(a.rot);
  if (mode === "Cubic") s = s * s * (3 - 2 * s);                                
  const qa = eulerToQuat(a.rot.x, a.rot.y, a.rot.z);
  const qb = eulerToQuat(b.rot.x, b.rot.y, b.rot.z);
  return quatToEuler(quatSlerp(qa, qb, s));
}


export function evaluateTrackCurve(track, time, rotationType) {
  if (!track || !track.keyframes.length) return null;
  const kfs = track.keyframes;
  const pos = {
    x: evaluateChannelValue(kfs, "px", time),
    y: evaluateChannelValue(kfs, "py", time),
    z: evaluateChannelValue(kfs, "pz", time),
  };
  let rot;
  if (rotationType === "Quaternion") {
    rot = evaluateRotationQuat(kfs, time);
  } else {
    rot = {
      x: evaluateChannelValue(kfs, "rx", time),
      y: evaluateChannelValue(kfs, "ry", time),
      z: evaluateChannelValue(kfs, "rz", time),
    };
  }
  return { pos, rot };
}


export function generateCurve(clip, refsByTrack, kind, dir) {
  if (!clip) return clip;
  const styleName = kind === "Elastic" ? "Elastic" : "Bounce";
  const direction = EASING_DIRECTION_OK(dir) ? dir : "Out";
  const fps = clip.fps || DEFAULT_FPS;
  for (const trackKey in refsByTrack) {
    const track = clip.tracks[trackKey];
    if (!track) continue;
    const selIds = new Set(refsByTrack[trackKey]);
    const selKfs = track.keyframes.filter((k) => selIds.has(k.id)).sort((a, b) => a.time - b.time);
    if (selKfs.length < 2) continue;
    const start = selKfs[0];
    const end = selKfs[selKfs.length - 1];
    const span = end.time - start.time;
    if (span <= TIME_EPSILON) continue;

    track.keyframes = track.keyframes.filter(
      (k) => k.time <= start.time + TIME_EPSILON || k.time >= end.time - TIME_EPSILON,
    );
    const steps = Math.max(6, Math.min(90, Math.round(span * fps)));
    for (let i = 1; i < steps; i++) {
      const alpha = i / steps;
      const t = start.time + alpha * span;
      const e = ease(styleName, direction, alpha);


      const kf = makeKeyframe(t, lerpVec(start.pos, end.pos, e), lerpAnglesRaw(start.rot, end.rot, e), "Linear", "Out");
      kf.interp = "Linear";                                                    
      ensureKfCurve(kf);
      track.keyframes.push(kf);
    }
    start.interp = "Linear";
    ensureKfCurve(start);
    ensureKfCurve(end);
    sortTrack(track);
  }
  touch(clip);
  return clip;
}

function EASING_DIRECTION_OK(dir) {
  return dir === "In" || dir === "Out" || dir === "InOut";
}

let __clipSeq = 0;
let __kfSeq = 0;

function uid(prefix) {
  let seq;
  if (prefix === "kf") seq = ++__kfSeq;
  else seq = ++__clipSeq;
  return `${prefix}_${seq.toString(36)}_${Math.random()
    .toString(36)
    .slice(2, 7)}`;
}

function num(v, fb) {
  return Number.isFinite(v) ? v : fb;
}

function vec(v) {
  const o = v && typeof v === "object" ? v : {};
  return { x: num(o.x, 0), y: num(o.y, 0), z: num(o.z, 0) };
}


function vecLimit(v) {
  const o = vec(v);
  return { x: safeNum(o.x, 0), y: safeNum(o.y, 0), z: safeNum(o.z, 0) };
}

export const MIN_FPS = 1;
export const MAX_FPS = 240;


export function sanitizeFps(f) {
  const v = Number(f);
  if (!Number.isFinite(v)) return DEFAULT_FPS;
  return Math.min(MAX_FPS, Math.max(MIN_FPS, Math.round(v)));
}


export function sanitizeDuration(d) {
  const v = Number(d);
  if (!Number.isFinite(v)) return DEFAULT_DURATION;
  return Math.min(MAX_DURATION, Math.max(MIN_DURATION, v));
}


export function timeToFrame(time, fps) {
  return Math.round(num(time, 0) * (fps || DEFAULT_FPS));
}
export function frameToTime(frame, fps) {
  return num(frame, 0) / (fps || DEFAULT_FPS);
}


export function formatSecFrames(time, fps) {
  const f = fps || DEFAULT_FPS;
  const totalFrames = Math.max(0, Math.round(num(time, 0) * f));
  const secs = Math.floor(totalFrames / f);
  const frames = totalFrames % f;
  return `${secs}:${frames < 10 ? "0" : ""}${frames}`;
}


export function createClip(opts = {}) {
  const now = Date.now();
  return {
    id: uid("clip"),
    name: typeof opts.name === "string" && opts.name.trim() ? opts.name.trim() : "Animation",
    fps: sanitizeFps(opts.fps != null ? opts.fps : DEFAULT_FPS),
    duration: sanitizeDuration(opts.duration != null ? opts.duration : DEFAULT_DURATION),
    looping: !!opts.looping,
    priority: PRIORITIES.indexOf(opts.priority) !== -1 ? opts.priority : DEFAULT_PRIORITY,
    targetRigName: typeof opts.targetRigName === "string" ? opts.targetRigName : "",
    targetRigType: typeof opts.targetRigType === "string" ? opts.targetRigType : "",
    createdAt: now,
    modifiedAt: now,
    publishedAssetId: null,
    tracks: {},
  };
}


export function cloneClip(clip) {
  if (!clip) return null;
  return deepCloneJsonValue(clip);
}


export function touch(clip) {
  if (clip) clip.modifiedAt = Date.now();
  return clip;
}


export function ensureTrack(clip, partKey, partName) {
  if (!clip.tracks[partKey]) {
    clip.tracks[partKey] = { partName: partName || partKey, keyframes: [] };
  } else if (partName) {
    clip.tracks[partKey].partName = partName;
  }
  return clip.tracks[partKey];
}

function sortTrack(track) {
  track.keyframes.sort((a, b) => a.time - b.time);
}


export function makeKeyframe(time, pos, rot, style, dir, label) {
  const e = sanitizeEasing(style, dir);
  return {
    id: uid("kf"),
    time: num(time, 0),
    pos: vecLimit(pos),
    rot: vecLimit(rot),
    style: e.style,
    dir: e.direction,
    label: typeof label === "string" ? label : "",
  };
}


export function upsertKeyframe(clip, partKey, partName, kf, opts) {
  const track = ensureTrack(clip, partKey, partName);
  const t = clampTime(clip, kf.time);
  const existing = track.keyframes.find((k) => Math.abs(k.time - t) <= TIME_EPSILON);
  if (existing) {
    existing.pos = vecLimit(kf.pos);
    existing.rot = vecLimit(kf.rot);


    if (!opts || !opts.preserveEasing) {
      if (kf.style) existing.style = kf.style;
      if (kf.dir) existing.dir = kf.dir;
    }


    if (typeof kf.label === "string" && kf.label) existing.label = kf.label;
    touch(clip);
    return existing;
  }
  const nk = { ...kf, time: t };
  track.keyframes.push(nk);
  sortTrack(track);
  touch(clip);
  return nk;
}


export function clampTime(clip, time) {
  const d = sanitizeDuration(clip.duration);
  let t = num(time, 0);
  if (t < 0) t = 0;
  if (t > d) t = d;
  return t;
}

export function findKeyframe(clip, partKey, kfId) {
  const track = clip.tracks[partKey];
  if (!track) return null;
  return track.keyframes.find((k) => k.id === kfId) || null;
}

export function removeKeyframe(clip, partKey, kfId) {
  const track = clip.tracks[partKey];
  if (!track) return false;
  const i = track.keyframes.findIndex((k) => k.id === kfId);
  if (i === -1) return false;
  track.keyframes.splice(i, 1);

  if (track.keyframes.length === 0) delete clip.tracks[partKey];
  touch(clip);
  return true;
}


export function moveKeyframe(clip, partKey, kfId, newTime) {
  const kf = findKeyframe(clip, partKey, kfId);
  if (!kf) return false;
  kf.time = clampTime(clip, newTime);
  sortTrack(clip.tracks[partKey]);
  touch(clip);
  return true;
}


export function countKeyframes(clip) {
  let n = 0;
  for (const key in clip.tracks) n += clip.tracks[key].keyframes.length;
  return n;
}


export function allKeyframeTimes(clip) {
  const set = new Set();
  for (const key in clip.tracks) {
    for (const k of clip.tracks[key].keyframes) set.add(Math.round(k.time * 1e4) / 1e4);
  }
  return [...set].sort((a, b) => a - b);
}


export function evaluateTrack(track, time) {
  if (!track || !track.keyframes.length) return null;
  const kfs = track.keyframes;
  if (time <= kfs[0].time) return { pos: vec(kfs[0].pos), rot: vec(kfs[0].rot) };
  const last = kfs[kfs.length - 1];
  if (time >= last.time) return { pos: vec(last.pos), rot: vec(last.rot) };
  let a = kfs[0];
  let b = kfs[kfs.length - 1];
  for (let i = 0; i < kfs.length - 1; i++) {
    if (time >= kfs[i].time && time <= kfs[i + 1].time) {
      a = kfs[i];
      b = kfs[i + 1];
      break;
    }
  }
  const span = b.time - a.time;
  const alpha = span > TIME_EPSILON ? (time - a.time) / span : 0;
  const e = ease(b.style, b.dir, alpha);
  return {
    pos: lerpVec(a.pos, b.pos, e),


    rot: lerpAngles(a.rot, b.rot, e),
  };
}

function lerpVec(a, b, t) {
  const va = vec(a);
  const vb = vec(b);
  return {
    x: va.x + (vb.x - va.x) * t,
    y: va.y + (vb.y - va.y) * t,
    z: va.z + (vb.z - va.z) * t,
  };
}


function normDeg180(a) {
  let r = a % 360;
  if (r > 180) r -= 360;
  if (r < -180) r += 360;
  return r;
}


function lerpAngles(a, b, t) {
  const va = vec(a);
  const vb = vec(b);
  return {
    x: normDeg180(va.x + normDeg180(vb.x - va.x) * t),
    y: normDeg180(va.y + normDeg180(vb.y - va.y) * t),
    z: normDeg180(va.z + normDeg180(vb.z - va.z) * t),
  };
}


function lerpAnglesRaw(a, b, t) {
  const va = vec(a);
  const vb = vec(b);
  return {
    x: va.x + normDeg180(vb.x - va.x) * t,
    y: va.y + normDeg180(vb.y - va.y) * t,
    z: va.z + normDeg180(vb.z - va.z) * t,
  };
}


export function evaluateClip(clip, time) {
  const out = {};
  const curve = !!clip.curveMode;
  const rotType = clip.rotationType;
  for (const key in clip.tracks) {
    const track = clip.tracks[key];
    const pose = curve ? evaluateTrackCurve(track, time, rotType) : evaluateTrack(track, time);
    if (pose) out[key] = pose;
  }
  return out;
}


export const MAX_EVENTS = 200;
const EVENT_NAME_MAX = 64;
const EVENT_PARAM_MAX = 256;


export function sanitizeEventName(name) {
  let s = name == null ? "" : String(name);
  s = s.replace(/[\u0000-\u001F\u007F]/g, " ").trim();
  if (s.length > EVENT_NAME_MAX) s = s.slice(0, EVENT_NAME_MAX);
  return s || "Event";
}
export function sanitizeEventParam(param) {
  let s = param == null ? "" : String(param);
  s = s.replace(/[\u0000-\u001F\u007F]/g, " ");
  if (s.length > EVENT_PARAM_MAX) s = s.slice(0, EVENT_PARAM_MAX);
  return s;
}


export function ensureEvents(clip) {
  if (!clip) return [];
  if (!Array.isArray(clip.events)) clip.events = [];
  return clip.events;
}
function sortEvents(clip) {
  clip.events.sort((a, b) => a.time - b.time);
}
export function findEvent(clip, id) {
  ensureEvents(clip);
  return clip.events.find((e) => e.id === id) || null;
}

export function eventNameExists(clip, name, exceptId) {
  ensureEvents(clip);
  const n = sanitizeEventName(name);
  return clip.events.some((e) => e.id !== exceptId && e.name === n);
}

export function addEvent(clip, time, name, param) {
  ensureEvents(clip);
  if (clip.events.length >= MAX_EVENTS) return null;
  const ev = {
    id: uid("ev"),
    time: clampTime(clip, time),
    name: sanitizeEventName(name),
    param: sanitizeEventParam(param),
  };
  clip.events.push(ev);
  sortEvents(clip);                                                                      
  touch(clip);
  return ev;
}
export function removeEvent(clip, id) {
  ensureEvents(clip);
  const i = clip.events.findIndex((e) => e.id === id);
  if (i === -1) return false;
  clip.events.splice(i, 1);
  touch(clip);
  return true;
}
export function moveEvent(clip, id, newTime) {
  const ev = findEvent(clip, id);
  if (!ev) return false;
  ev.time = clampTime(clip, newTime);                                         
  sortEvents(clip);
  touch(clip);
  return true;
}
export function updateEvent(clip, id, fields) {
  const ev = findEvent(clip, id);
  if (!ev) return false;
  if (fields && fields.name != null) ev.name = sanitizeEventName(fields.name);
  if (fields && fields.param != null) ev.param = sanitizeEventParam(fields.param);
  touch(clip);
  return true;
}
