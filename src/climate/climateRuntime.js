import { getService, createInstance, makeVector3, makeColor } from "../datamodel/index.js";
import { Enums } from "../datamodel/types.js";

export const MAX_WIND_MAGNITUDE = 500;
export const MAX_TRANSITION_TIME = 60;
export const MAX_WEATHER_PARTICLE_RATE = 900;
export const WEATHER_RADIUS = 50;

export const climateDebugState = {
  showWindVector: false,
  showWindShakeObjects: false,
  showWeatherBounds: false,
};

export const WEATHER_PROFILES = Object.freeze({
  Clear: { brightnessScale: 1, ambient: null, fogStart: null, fogEnd: null, fogColor: null, particles: null, sound: null, windBoost: 0 },
  Cloudy: { brightnessScale: 0.8, ambient: [0.42, 0.43, 0.46], fogStart: null, fogEnd: null, fogColor: null, particles: null, sound: "wind", windBoost: 4 },
  Rain: { brightnessScale: 0.7, ambient: [0.33, 0.35, 0.4], fogStart: 40, fogEnd: 420, fogColor: [0.6, 0.63, 0.68], particles: { kind: "rain", rate: 300, fall: 55, size: 0.32, horizontal: 1, color: [0.62, 0.72, 0.9] }, sound: "rain", windBoost: 8 },
  HeavyRain: { brightnessScale: 0.5, ambient: [0.2, 0.22, 0.28], fogStart: 18, fogEnd: 150, fogColor: [0.48, 0.51, 0.56], particles: { kind: "rain", rate: 900, fall: 85, size: 0.38, horizontal: 5, color: [0.55, 0.65, 0.85] }, sound: "heavyrain", windBoost: 18 },
  Snow: { brightnessScale: 0.85, ambient: [0.55, 0.58, 0.66], fogStart: 60, fogEnd: 520, fogColor: [0.82, 0.85, 0.9], particles: { kind: "snow", rate: 200, fall: 8, size: 0.5, horizontal: 2, color: [1, 1, 1] }, sound: "coldwind", windBoost: 6 },
  Blizzard: { brightnessScale: 0.6, ambient: [0.4, 0.48, 0.64], fogStart: 8, fogEnd: 90, fogColor: [0.75, 0.8, 0.9], particles: { kind: "snow", rate: 700, fall: 18, size: 0.55, horizontal: 26, color: [0.95, 0.97, 1] }, sound: "blizzard", windBoost: 45 },
  Fog: { brightnessScale: 0.75, ambient: [0.5, 0.5, 0.52], fogStart: 5, fogEnd: 70, fogColor: [0.8, 0.8, 0.82], particles: null, sound: "wind", windBoost: 2 },
  Sandstorm: { brightnessScale: 0.7, ambient: [0.55, 0.45, 0.28], fogStart: 10, fogEnd: 110, fogColor: [0.78, 0.62, 0.35], particles: { kind: "sand", rate: 600, fall: 2, size: 0.45, horizontal: 40, color: [0.85, 0.72, 0.42] }, sound: "sandstorm", windBoost: 35 },
});

const state = {
  dm: null,
  from: "Clear",
  to: "Clear",
  progress: 1,
  duration: 5,
  base: null,
  cachedWind: { x: 0, y: 0, z: 0 },
  windCurrent: { x: 0, y: 0, z: 0 },
  lastWindEvent: { x: 0, y: 0, z: 0 },
  lightingActive: false,
  windDriven: false,


  fromScale: 1,
  fromSnapshot: null,
  lastApplied: null,
  listeners: new Set(),
};

function clampNum(v, min, max, fb) {
  const n = Number(v);
  if (!Number.isFinite(n)) return fb;
  return Math.min(max, Math.max(min, n));
}

function finiteNum(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

function vecOf(v) {
  if (!v || typeof v !== "object") return { x: 0, y: 0, z: 0 };


  return { x: finiteNum(v.x), y: finiteNum(v.y), z: finiteNum(v.z) };
}

function magOf(v) {
  return Math.sqrt(v.x * v.x + v.y * v.y + v.z * v.z);
}

function clampWindVec(v) {
  const m = magOf(v);


  if (!Number.isFinite(m)) {
    const mx = Math.max(Math.abs(v.x), Math.abs(v.y), Math.abs(v.z));
    if (!Number.isFinite(mx) || !(mx > 0)) return { x: 0, y: 0, z: 0 };
    const nx = v.x / mx, ny = v.y / mx, nz = v.z / mx;
    const nm = Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (!(nm > 0)) return { x: 0, y: 0, z: 0 };
    const so = MAX_WIND_MAGNITUDE / nm;
    return { x: nx * so, y: ny * so, z: nz * so };
  }
  if (m <= MAX_WIND_MAGNITUDE) return { ...v };
  const s = MAX_WIND_MAGNITUDE / m;
  return { x: v.x * s, y: v.y * s, z: v.z * s };
}

function emit(name, a, b) {
  for (const fn of state.listeners) {
    try { fn(name, a, b); } catch (_) {          }
  }
}

export function onClimateEvent(fn) {
  if (typeof fn !== "function") return () => {};
  state.listeners.add(fn);
  return () => state.listeners.delete(fn);
}

export function ensureClimateService(dm) {
  if (!dm || typeof dm.findFirstChild !== "function") return null;
  const okSvc = (s) => !!s && s.className === "ClimateService" && !(s.isDestroyed && s.isDestroyed());
  let svc = dm.findFirstChild("ClimateService");
  if (okSvc(svc)) return svc;


  if (typeof dm.getChildren === "function") {
    for (const k of dm.getChildren()) {
      if (okSvc(k)) return k;
    }
  }
  try {
    svc = createInstance("ClimateService", { name: "ClimateService" });
    svc.setParent(dm);
    svc._locked = true;


    if (state.dm == null || state.dm === dm) {
      state.from = "Clear";
      state.to = "Clear";
      state.progress = 1;
      state.fromScale = 1;
      state.fromSnapshot = null;
    }
    return svc;
  } catch (_) {
    return null;
  }
}

function readSvc(svc) {
  const type = Enums.WeatherType.includes(svc.getProperty("WeatherType")) ? svc.getProperty("WeatherType") : "Clear";
  return {
    type,
    intensity: clampNum(svc.getProperty("Intensity"), 0, 1, 1),
    transition: clampNum(svc.getProperty("TransitionTime"), 0, MAX_TRANSITION_TIME, 5),
    windStrength: clampNum(svc.getProperty("WindStrength"), 0, 100, 0),
    windDirection: vecOf(svc.getProperty("WindDirection")),
    soundEnabled: svc.getProperty("AmbientSoundEnabled") === true,
  };
}

function startTransition(newType, duration) {
  if (newType === state.to) return;
  const old = state.to;


  const toW = state.progress;
  const fromW = (1 - state.progress) * state.fromScale;
  if (toW >= fromW) {
    state.from = state.to;
    state.fromScale = Math.max(0, Math.min(1, toW));
  } else {
    state.fromScale = Math.max(0, Math.min(1, fromW));
  }


  state.fromSnapshot = state.lightingActive && state.lastApplied ? { ...state.lastApplied } : null;
  state.to = newType;
  state.duration = clampNum(duration, 0, MAX_TRANSITION_TIME, 5);
  state.progress = state.duration <= 0.001 ? 1 : 0;
  emit("WeatherChanged", old, newType);
}

function captureBase(lighting) {
  const amb = lighting.getProperty("Ambient");
  const fogC = lighting.getProperty("FogColor");


  const chan = (c, key, fallback) => {
    const n = c ? Number(c[key]) : NaN;
    return Number.isFinite(n) ? n : fallback;
  };
  state.base = {
    ambient: { r: chan(amb, "r", 0), g: chan(amb, "g", 0), b: chan(amb, "b", 0) },
    brightness: clampNum(lighting.getProperty("Brightness"), 0, 10, 2),
    fogStart: clampNum(lighting.getProperty("FogStart"), 0, 1e6, 0),
    fogEnd: clampNum(lighting.getProperty("FogEnd"), 1, 1e6, 100000),
    fogColor: { r: chan(fogC, "r", 0.75), g: chan(fogC, "g", 0.75), b: chan(fogC, "b", 0.75) },
  };
}

function profileTargets(type, base, intensity) {
  const p = WEATHER_PROFILES[type] || WEATHER_PROFILES.Clear;
  const mixS = (b, t) => (t == null ? b : b + (t - b) * intensity);
  const mixC = (b, t) => (t == null ? { ...b } : {
    r: b.r + (t[0] - b.r) * intensity,
    g: b.g + (t[1] - b.g) * intensity,
    b: b.b + (t[2] - b.b) * intensity,
  });


  const mixFogEnd = (b, t) => {
    if (t == null) return b;
    const inv = (1 - intensity) / Math.max(1, b) + intensity / Math.max(1, t);
    return inv > 0 ? 1 / inv : b;
  };
  return {
    brightness: base.brightness * (1 + (p.brightnessScale - 1) * intensity),
    ambient: mixC(base.ambient, p.ambient),
    fogStart: mixS(base.fogStart, p.fogStart),
    fogEnd: mixFogEnd(base.fogEnd, p.fogEnd),
    fogColor: mixC(base.fogColor, p.fogColor),
  };
}

function lerp(a, b, t) {
  return a + (b - a) * t;
}

function writeNum(lighting, prop, v) {
  const cur = Number(lighting.getProperty(prop));
  if (!Number.isFinite(cur) || Math.abs(cur - v) > 0.002) {
    try { lighting.setProperty(prop, v); } catch (_) {          }
  }
}

function writeColor(lighting, prop, c) {
  const cur = lighting.getProperty(prop) || {};
  if (Math.abs((Number(cur.r) || 0) - c.r) > 0.004 || Math.abs((Number(cur.g) || 0) - c.g) > 0.004 || Math.abs((Number(cur.b) || 0) - c.b) > 0.004) {
    try { lighting.setProperty(prop, makeColor(c.r, c.g, c.b)); } catch (_) {          }
  }
}

function restoreBase(lighting) {
  if (!state.base) return;
  writeNum(lighting, "Brightness", state.base.brightness);
  writeNum(lighting, "FogStart", state.base.fogStart);
  writeNum(lighting, "FogEnd", state.base.fogEnd);
  writeColor(lighting, "Ambient", state.base.ambient);
  writeColor(lighting, "FogColor", state.base.fogColor);
}

function applyLighting(lighting, cfg) {
  if (!state.base) captureBase(lighting);
  const idleClear = state.to === "Clear" && state.from === "Clear" && state.progress >= 1;
  if (idleClear) {
    if (state.lightingActive) {
      restoreBase(lighting);
      state.lightingActive = false;
      state.lastApplied = null;
      state.fromSnapshot = null;
      return;
    }
    captureBase(lighting);
    return;
  }
  state.lightingActive = true;
  const tFrom = state.fromSnapshot || profileTargets(state.from, state.base, cfg.intensity);
  const tTo = profileTargets(state.to, state.base, cfg.intensity);
  const p = state.progress;
  const bright = lerp(tFrom.brightness, tTo.brightness, p);
  const fogStart = lerp(tFrom.fogStart, tTo.fogStart, p);


  const fogEndRaw = 1 / lerp(1 / Math.max(1, tFrom.fogEnd), 1 / Math.max(1, tTo.fogEnd), p);
  const fogEnd = Math.max(fogStart + 1, fogEndRaw);
  const amb = {
    r: lerp(tFrom.ambient.r, tTo.ambient.r, p),
    g: lerp(tFrom.ambient.g, tTo.ambient.g, p),
    b: lerp(tFrom.ambient.b, tTo.ambient.b, p),
  };
  const fogC = {
    r: lerp(tFrom.fogColor.r, tTo.fogColor.r, p),
    g: lerp(tFrom.fogColor.g, tTo.fogColor.g, p),
    b: lerp(tFrom.fogColor.b, tTo.fogColor.b, p),
  };
  writeNum(lighting, "Brightness", bright);
  writeNum(lighting, "FogStart", fogStart);
  writeNum(lighting, "FogEnd", fogEnd);
  writeColor(lighting, "Ambient", amb);
  writeColor(lighting, "FogColor", fogC);


  state.lastApplied = { brightness: bright, ambient: amb, fogStart, fogEnd, fogColor: fogC };
}

function updateWind(ws, cfg, dt) {
  const dir = cfg.windDirection;


  const dMax = Math.max(Math.abs(dir.x), Math.abs(dir.y), Math.abs(dir.z));
  let nDir = { x: 1, y: 0, z: 0 };
  if (dMax > 1e-4) {
    const px = dir.x / dMax, py = dir.y / dMax, pz = dir.z / dMax;
    const pm = Math.sqrt(px * px + py * py + pz * pz);
    if (pm > 0) nDir = { x: px / pm, y: py / pm, z: pz / pm };
  }
  const boostTo = (WEATHER_PROFILES[state.to] || WEATHER_PROFILES.Clear).windBoost;
  const boostFrom = (WEATHER_PROFILES[state.from] || WEATHER_PROFILES.Clear).windBoost;


  const toW = state.progress;
  const fromW = state.from === state.to ? 0 : (1 - state.progress) * state.fromScale;
  const boost = (boostFrom * fromW + boostTo * toW) * cfg.intensity;
  const strength = Math.min(MAX_WIND_MAGNITUDE, cfg.windStrength + boost);
  const drives = state.to !== "Clear" || state.progress < 1 || cfg.windStrength > 0;
  if (drives) state.windDriven = true;
  const climateDrives = drives || state.windDriven;
  const raw = vecOf(ws.getProperty("GlobalWind"));
  const clamped = clampWindVec(raw);
  if (Math.abs(clamped.x - raw.x) > 0.01 || Math.abs(clamped.y - raw.y) > 0.01 || Math.abs(clamped.z - raw.z) > 0.01) {
    try { ws.setProperty("GlobalWind", makeVector3(clamped.x, clamped.y, clamped.z)); } catch (_) {          }
  }
  if (climateDrives) {


    if (!drives && (Math.abs(clamped.x - state.windCurrent.x) > 0.5 || Math.abs(clamped.y - state.windCurrent.y) > 0.5 || Math.abs(clamped.z - state.windCurrent.z) > 0.5)) {
      state.windDriven = false;
      state.windCurrent = { ...clamped };
      state.cachedWind = { ...clamped };
      return;
    }
    const target = { x: nDir.x * strength, y: nDir.y * strength, z: nDir.z * strength };
    const k = 1 - Math.exp(-(dt || 0) * 1.8);
    state.windCurrent = {
      x: lerp(clamped.x, target.x, k),
      y: lerp(clamped.y, target.y, k),
      z: lerp(clamped.z, target.z, k),
    };
    const cw = state.windCurrent;
    if (Math.abs(cw.x - clamped.x) > 0.02 || Math.abs(cw.y - clamped.y) > 0.02 || Math.abs(cw.z - clamped.z) > 0.02) {
      try { ws.setProperty("GlobalWind", makeVector3(cw.x, cw.y, cw.z)); } catch (_) {          }
    } else if (Math.abs(target.x - clamped.x) > 0.005 || Math.abs(target.y - clamped.y) > 0.005 || Math.abs(target.z - clamped.z) > 0.005) {


      state.windCurrent = { x: target.x, y: target.y, z: target.z };
      try { ws.setProperty("GlobalWind", makeVector3(target.x, target.y, target.z)); } catch (_) {          }
    }
    state.cachedWind = { ...state.windCurrent };
    if (!drives && magOf(state.windCurrent) < 0.8) {
      state.windDriven = false;
      state.windCurrent = { x: 0, y: 0, z: 0 };
      state.cachedWind = { x: 0, y: 0, z: 0 };
      try { ws.setProperty("GlobalWind", makeVector3(0, 0, 0)); } catch (_) {          }
    }
  } else {
    state.cachedWind = clamped;
  }
  const lw = state.lastWindEvent;
  const d = Math.abs(state.cachedWind.x - lw.x) + Math.abs(state.cachedWind.y - lw.y) + Math.abs(state.cachedWind.z - lw.z);
  if (d > 1) {
    emit("WindChanged", { ...lw }, { ...state.cachedWind });
    state.lastWindEvent = { ...state.cachedWind };
  }
}

export function climateTick(dm, dt) {
  if (!dm) return;


  dt = Number.isFinite(dt) && dt > 0 ? dt : 0;


  if (state.dm && state.dm !== dm) resetTransientClimate();
  state.dm = dm;
  const svc = ensureClimateService(dm);
  const ws = getService(dm, "Workspace");
  const lighting = getService(dm, "Lighting");
  if (!svc || !ws) return;
  const cfg = readSvc(svc);
  if (cfg.type !== state.to) startTransition(cfg.type, cfg.transition);
  if (state.progress < 1) {
    const step = state.duration <= 0.001 ? 1 : (dt || 0) / state.duration;
    state.progress = Math.min(1, state.progress + step);
  }
  if (state.progress >= 1 && state.from !== state.to) {
    state.from = state.to;
    state.fromScale = 1;
    state.fromSnapshot = null;
  }
  updateWind(ws, cfg, dt);
  if (lighting) applyLighting(lighting, cfg);
}

export function getCachedWind() {
  return { ...state.cachedWind };
}

export function setWeather(dm, weatherType, intensity, transitionTime) {
  const svc = ensureClimateService(dm);
  if (!svc) return { ok: false, reason: "no-service" };
  const type = typeof weatherType === "string" && Enums.WeatherType.includes(weatherType) ? weatherType : null;
  if (!type) return { ok: false, reason: "invalid-weather" };
  const cur = readSvc(svc);
  const inten = intensity == null ? cur.intensity : clampNum(intensity, 0, 1, cur.intensity);
  const trans = transitionTime == null ? cur.transition : clampNum(transitionTime, 0, MAX_TRANSITION_TIME, cur.transition);
  try {
    svc.setProperty("Intensity", inten);
    svc.setProperty("TransitionTime", trans);
    svc.setProperty("WeatherType", type);
  } catch (_) {          }


  const applied = readSvc(svc);
  if (applied.type !== type) return { ok: false, reason: "write-failed" };
  startTransition(type, applied.transition);
  return { ok: true };
}

export function getCurrentWeather() {
  return state.to;
}

export function stopWeather(dm) {
  return setWeather(dm, "Clear");
}

export function getWindVector(dm) {
  if (dm) {
    const ws = getService(dm, "Workspace");
    if (ws) return clampWindVec(vecOf(ws.getProperty("GlobalWind")));
  }
  return { ...state.cachedWind };
}

export function weatherParticleLayers(dm) {
  const svc = dm ? ensureClimateService(dm) : (state.dm ? ensureClimateService(state.dm) : null);
  if (!svc) return [];
  const cfg = readSvc(svc);
  if (cfg.intensity <= 0) return [];
  const out = [];
  const push = (type, weight) => {
    const p = (WEATHER_PROFILES[type] || WEATHER_PROFILES.Clear).particles;
    if (!p || weight <= 0.01) return;
    const rate = Math.min(MAX_WEATHER_PARTICLE_RATE, p.rate * cfg.intensity * weight);
    if (rate < 1) return;
    out.push({ kind: p.kind, rate, fall: p.fall, size: p.size, horizontal: p.horizontal, color: p.color.slice(), radius: WEATHER_RADIUS });
  };
  push(state.to, state.progress);
  if (state.from !== state.to) push(state.from, (1 - state.progress) * state.fromScale);
  return out;
}

export function ambientSoundTarget(dm) {
  const svc = dm ? ensureClimateService(dm) : (state.dm ? ensureClimateService(state.dm) : null);
  if (!svc) return null;
  const cfg = readSvc(svc);
  if (!cfg.soundEnabled || cfg.intensity <= 0) return null;


  const toW = state.progress;
  const fromW = state.from === state.to ? 0 : (1 - state.progress) * state.fromScale;
  const pTo = WEATHER_PROFILES[state.to] || WEATHER_PROFILES.Clear;
  const pFrom = WEATHER_PROFILES[state.from] || WEATHER_PROFILES.Clear;
  const wTo = pTo.sound ? toW : -1;
  const wFrom = pFrom.sound ? fromW : -1;
  if (wTo <= 0 && wFrom <= 0) return null;
  const useTo = wTo >= wFrom;
  const p = useTo ? pTo : pFrom;
  const weight = useTo ? toW : fromW;
  return { kind: p.sound, level: Math.min(1, cfg.intensity * Math.max(0.15, weight)) };
}

export function readGrassLength(terrain) {
  if (!terrain || typeof terrain.getProperty !== "function") return 0.4;
  return clampNum(terrain.getProperty("GrassLength"), 0, 4, 0.4);
}

export function getClimateState() {
  return { from: state.from, to: state.to, progress: state.progress, duration: state.duration };
}

function resetTransientClimate() {
  state.dm = null;
  state.from = "Clear";
  state.to = "Clear";
  state.progress = 1;
  state.duration = 5;
  state.base = null;
  state.cachedWind = { x: 0, y: 0, z: 0 };
  state.windCurrent = { x: 0, y: 0, z: 0 };
  state.lastWindEvent = { x: 0, y: 0, z: 0 };
  state.lightingActive = false;
  state.windDriven = false;
  state.fromScale = 1;
  state.fromSnapshot = null;
  state.lastApplied = null;
}

export function resetClimate() {
  resetTransientClimate();
  state.listeners.clear();
}
