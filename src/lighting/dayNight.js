import { clampNumber } from "../utils/validate.js";


import { sunSkyMoonLux, sceneEv100 } from "./photometryCore.js";


export function wrapClockTime(v) {
  let c = Number(v);
  if (!Number.isFinite(c)) return 14;
  c = c % 24;
  if (c < 0) c += 24;
  return c;
}


export function timeOfDayToClockTime(str) {
  if (typeof str !== "string") return null;
  const m = /^\s*(\d{1,3}):(\d{1,2})(?::(\d{1,2})(?:\.\d+)?)?\s*$/.exec(str);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  const s = Number(m[3] || 0);
  if (!Number.isFinite(h) || !Number.isFinite(min) || !Number.isFinite(s)) return null;
  if (min >= 60 || s >= 60) return null;
  return wrapClockTime(h + min / 60 + s / 3600);
}


export function clockTimeToTimeOfDay(clock) {
  const c = wrapClockTime(clock);
  let total = Math.round(c * 3600);
  if (total >= 24 * 3600) total = 0;
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => (n < 10 ? "0" + n : String(n));
  return pad(h) + ":" + pad(m) + ":" + pad(s);
}


export const FACE_VECTORS = Object.freeze({
  Top: Object.freeze({ x: 0, y: 1, z: 0 }),
  Bottom: Object.freeze({ x: 0, y: -1, z: 0 }),
  Front: Object.freeze({ x: 0, y: 0, z: -1 }),
  Back: Object.freeze({ x: 0, y: 0, z: 1 }),
  Right: Object.freeze({ x: 1, y: 0, z: 0 }),
  Left: Object.freeze({ x: -1, y: 0, z: 0 }),
});


export function sunDirection(clockTime, latitudeDeg) {
  const c = wrapClockTime(clockTime);
  const lat = (clampNumber(latitudeDeg, -90, 90, 41.73) * Math.PI) / 180;
  const ha = ((c - 12) / 24) * Math.PI * 2;                                 

  const sinElev = Math.cos(ha) * Math.cos(lat);
  const elev = Math.asin(Math.max(-1, Math.min(1, sinElev)));
  const azim = Math.atan2(Math.sin(ha), Math.cos(ha) * Math.sin(lat));
  const ce = Math.cos(elev);
  return {
    x: ce * Math.sin(azim),
    y: Math.sin(elev),
    z: ce * Math.cos(azim),
  };
}

function lerp(a, b, t) { return a + (b - a) * t; }
function mixColor(a, b, t) {
  return { r: lerp(a.r, b.r, t), g: lerp(a.g, b.g, t), b: lerp(a.b, b.b, t) };
}
function col(r, g, b) { return { r, g, b }; }


function sampleRamp(stops, hour, mixFn) {
  const h = wrapClockTime(hour);
  for (let i = 0; i < stops.length; i++) {
    const a = stops[i];
    const b = stops[(i + 1) % stops.length];
    const end = b[0] <= a[0] ? b[0] + 24 : b[0];
    const cur = h < a[0] ? h + 24 : h;
    if (cur >= a[0] && cur <= end) {
      const t = end === a[0] ? 0 : (cur - a[0]) / (end - a[0]);
      return mixFn(a[1], b[1], t);
    }
  }
  return stops[0][1];
}

const SKY_TOP = [
  [0, col(0.02, 0.03, 0.09)],                                
  [5, col(0.05, 0.06, 0.16)],
  [6, col(0.22, 0.18, 0.36)],                        
  [7, col(0.32, 0.52, 0.84)],
  [12, col(0.27, 0.56, 0.89)],                 
  [17, col(0.3, 0.5, 0.8)],
  [18, col(0.3, 0.24, 0.4)],              
  [19, col(0.07, 0.08, 0.2)],
  [20, col(0.02, 0.03, 0.1)],         
];
const SKY_HORIZON = [
  [0, col(0.06, 0.08, 0.16)],
  [5, col(0.16, 0.12, 0.2)],
  [6, col(1.0, 0.62, 0.36)],                                   
  [7, col(0.78, 0.85, 0.95)],
  [12, col(0.74, 0.86, 0.97)],
  [17, col(0.95, 0.75, 0.5)],
  [18, col(1.0, 0.45, 0.2)],                               
  [19, col(0.25, 0.15, 0.22)],
  [20, col(0.07, 0.09, 0.18)],
];
const SUN_COLOR = [
  [0, col(0.45, 0.55, 0.85)],                           
  [5, col(0.55, 0.6, 0.85)],
  [6, col(1.0, 0.6, 0.35)],             
  [7.5, col(1.0, 0.92, 0.78)],
  [12, col(1.0, 0.98, 0.92)],                            
  [16.5, col(1.0, 0.93, 0.8)],
  [18, col(1.0, 0.5, 0.25)],              
  [19, col(0.5, 0.5, 0.8)],
  [20, col(0.4, 0.5, 0.85)],                          
];
const SUN_INTENSITY = [
  [0, 0.16], [5, 0.18], [6, 0.55], [7, 0.95], [12, 1.0],
  [17, 0.9], [18, 0.55], [19, 0.2], [20, 0.15],
];
const STAR_ALPHA = [
  [0, 1], [4.5, 1], [6, 0.25], [7, 0], [17.5, 0], [18.5, 0.3], [20, 0.9], [21, 1],
];
const AMBIENT_NIGHT = [
  [0, 0.32], [5, 0.35], [7, 0.9], [12, 1.0], [17, 0.95], [19, 0.5], [21, 0.32],
];


export function skyStateAt(clockTime) {
  const h = wrapClockTime(clockTime);
  return {
    isDay: h >= 6 && h < 18,
    skyTop: sampleRamp(SKY_TOP, h, mixColor),
    skyHorizon: sampleRamp(SKY_HORIZON, h, mixColor),
    sunColor: sampleRamp(SUN_COLOR, h, mixColor),
    sunIntensity: sampleRamp(SUN_INTENSITY, h, lerp),
    starAlpha: sampleRamp(STAR_ALPHA, h, lerp),
    ambientFactor: sampleRamp(AMBIENT_NIGHT, h, lerp),
  };
}


export function physicalLightStateAt(clockTime, latitudeDeg) {
  const dir = sunDirection(clockTime, latitudeDeg);
  const sunElevDeg = (Math.asin(Math.max(-1, Math.min(1, dir.y))) * 180) / Math.PI;
  const lux = sunSkyMoonLux(sunElevDeg);
  return Object.freeze({
    sunElevDeg,
    sunLux: lux.sunLux,
    skyLux: lux.skyLux,
    moonLux: lux.moonLux,
    nightLux: lux.nightLux,
    ev100: sceneEv100(sunElevDeg),
  });
}
