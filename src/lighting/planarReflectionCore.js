export const PLANAR_CACHE_KEY = "rswPlanar1";


export const PLANAR_MAX_SIZE = 1280;

export const PLANAR_SCALE = 0.5;


export const WATER_F0 = 0.02;

export const MIRROR_GAIN = 0.94;

export const PLANAR_CLIP_BIAS = 0.003;

export const WATER_PLANAR_DISTORT = 0.035;

export const MIRROR_SURFACE_OFFSET = 0.02;


export const TEXTURE_BIAS_ROWS = Object.freeze([
  0.5, 0.0, 0.0, 0.5,
  0.0, 0.5, 0.0, 0.5,
  0.0, 0.0, 0.5, 0.5,
  0.0, 0.0, 0.0, 1.0,
]);

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : (d || 0);
}


function fmt(v) {
  const n = Number(v);
  if (!Number.isFinite(n)) return "0.0";
  const s = String(n);
  return s.indexOf(".") >= 0 || s.indexOf("e") >= 0 ? s : s + ".0";
}


export function planarEligible(opts) {
  const o = opts || {};
  if (o.flag === false) return false;
  if (o.weak === true) return false;
  if (o.flag === true) return true;
  return o.renderStyle === "Realistic";
}


export function planarGrabPlan(opts) {
  const w = Math.max(1, Math.floor(num(opts && opts.w, 0)) || 1);
  const h = Math.max(1, Math.floor(num(opts && opts.h, 0)) || 1);
  const scale = Math.min(PLANAR_SCALE, PLANAR_MAX_SIZE / Math.max(w, h));
  return {
    w: Math.max(8, Math.floor(w * scale)),
    h: Math.max(8, Math.floor(h * scale)),
    scale,
  };
}


export function shouldRenderPlanar(opts) {
  const o = opts || {};
  const bit = o.interleaveBit ? 1 : 0;
  if (o.hasPlane !== true) return { render: false, nextBit: bit };
  const nextBit = (bit + 1) & 1;
  if (o.camSame === true && nextBit === 1) return { render: false, nextBit };
  return { render: true, nextBit };
}


export function axesFromOrientationDeg(deg) {
  const d = Array.isArray(deg) ? deg : [0, 0, 0];
  const rx = (num(d[0], 0) * Math.PI) / 180;
  const ry = (num(d[1], 0) * Math.PI) / 180;
  const rz = (num(d[2], 0) * Math.PI) / 180;
  const cx = Math.cos(rx), sx = Math.sin(rx);
  const cy = Math.cos(ry), sy = Math.sin(ry);
  const cz = Math.cos(rz), sz = Math.sin(rz);

  const m00 = cy * cz + sy * sx * sz;
  const m01 = -cy * sz + sy * sx * cz;
  const m02 = sy * cx;
  const m10 = cx * sz;
  const m11 = cx * cz;
  const m12 = -sx;
  const m20 = -sy * cz + cy * sx * sz;
  const m21 = sy * sz + cy * sx * cz;
  const m22 = cy * cx;
  return {
    right: [m00, m10, m20],
    up: [m01, m11, m21],
    back: [m02, m12, m22],
    look: [-m02, -m12, -m22],
  };
}

function dot3(a, b) {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

function scale3(a, s) {
  return [a[0] * s, a[1] * s, a[2] * s];
}

function add3(a, b) {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function sub3(a, b) {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}


export function mirrorPlaneFromPart(opts) {
  const o = opts || {};
  const size = Array.isArray(o.size) ? o.size.map((v) => Math.abs(num(v, 0))) : [0, 0, 0];
  const pos = Array.isArray(o.position) ? o.position.map((v) => num(v, 0)) : [0, 0, 0];
  const cam = Array.isArray(o.camPos) ? o.camPos.map((v) => num(v, 0)) : [0, 0, 0];
  const axes = [
    Array.isArray(o.right) ? o.right : [1, 0, 0],
    Array.isArray(o.up) ? o.up : [0, 1, 0],
    Array.isArray(o.back) ? o.back : [0, 0, 1],
  ];
  if (!(size[0] > 0) || !(size[1] > 0) || !(size[2] > 0)) return null;
  let minIdx = 0;
  if (size[1] < size[minIdx]) minIdx = 1;
  if (size[2] < size[minIdx]) minIdx = 2;
  const uIdx = minIdx === 0 ? 1 : 0;
  const vIdx = minIdx === 2 ? 1 : 2;
  let normal = axes[minIdx].slice();

  const toCam = sub3(cam, pos);
  if (dot3(normal, toCam) < 0) normal = scale3(normal, -1);
  const point = add3(pos, scale3(normal, size[minIdx] * 0.5));
  const w = size[uIdx];
  const h = size[vIdx];
  return {
    point,
    normal,
    area: w * h,
    uAxis: axes[uIdx].slice(),
    vAxis: axes[vIdx].slice(),
    w,
    h,
  };
}


export function planeWeight(opts) {
  const o = opts || {};
  const area = Math.max(0, num(o.area, 0));
  const dist = Math.max(1, num(o.dist, 1));
  const facing = Math.min(1, Math.max(0.05, num(o.facing, 1)));
  return (area * facing) / (dist * dist);
}


export function pickActivePlane(cands) {
  const list = Array.isArray(cands) ? cands : [];
  let best = -1;
  let bestW = 0;
  for (let i = 0; i < list.length; i++) {
    const w = Math.max(0, num(list[i] && list[i].weight, 0));
    if (w > bestW) {
      bestW = w;
      best = i;
    }
  }
  return best;
}


export function reflectPointAcrossPlane(p, planePoint, planeNormal) {
  const d = dot3(sub3(p, planePoint), planeNormal);
  return sub3(p, scale3(planeNormal, 2 * d));
}


export function reflectDirAcrossPlane(dir, n) {
  const d = dot3(dir, n);
  return sub3(dir, scale3(n, 2 * d));
}


export function obliqueClipProjection(elements, clipPlane, bias) {
  const e = elements;
  const p = clipPlane;
  const b = Number.isFinite(Number(bias)) ? Number(bias) : PLANAR_CLIP_BIAS;
  const sgn = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
  const qx = (sgn(p[0]) + e[8]) / e[0];
  const qy = (sgn(p[1]) + e[9]) / e[5];
  const qz = -1;
  const qw = (1 + e[10]) / e[14];
  const d = p[0] * qx + p[1] * qy + p[2] * qz + p[3] * qw;
  const s = 2 / d;
  e[2] = p[0] * s;
  e[6] = p[1] * s;
  e[10] = p[2] * s + 1 - b;
  e[14] = p[3] * s;
  return e;
}


export function buildWaterPlanarVertexPars() {
  return [
    "uniform mat4 uRswPlanarMat;",
    "varying vec4 vRswPlanarPos;",
  ].join("\n");
}


export function buildWaterPlanarVertexMain() {
  return "vRswPlanarPos = uRswPlanarMat * (modelMatrix * vec4(transformed, 1.0));";
}


export function buildWaterPlanarFragPars() {
  return [
    "uniform sampler2D uRswPlanar;",
    "uniform float uRswPlanarOn;",
    "varying vec4 vRswPlanarPos;",
  ].join("\n");
}


export function buildWaterPlanarFragMain() {
  return [
    "{",
    "\tif (uRswPlanarOn > 0.5 && vRswPlanarPos.w > 0.0001) {",
    "\t\tvec3 rswPN = normalize(normal);",
    "\t\tvec3 rswPV = normalize(vViewPosition);",
    "\t\tfloat rswPNdV = clamp(abs(dot(rswPN, rswPV)), 0.0, 1.0);",
    "\t\tfloat rswPF = " + fmt(WATER_F0) + " + " + fmt(1 - WATER_F0) + " * pow(1.0 - rswPNdV, 5.0);",
    "\t\tvec2 rswPUv = vRswPlanarPos.xy / vRswPlanarPos.w;",

    "\t\trswPUv += rswPN.xy * " + fmt(WATER_PLANAR_DISTORT) + ";",
    "\t\trswPUv = clamp(rswPUv, vec2(0.004), vec2(0.996));",
    "\t\tvec3 rswPRefl = texture2D(uRswPlanar, rswPUv).rgb;",
    "\t\tfloat rswPW = clamp(rswPF, 0.0, 1.0);",
    "\t\ttotalEmissiveRadiance = totalEmissiveRadiance * (1.0 - rswPW) + rswPRefl * rswPW;",
    "\t}",
    "}",
  ].join("\n");
}


export function buildMirrorOverlayVert() {
  return [
    "uniform mat4 uRswPlanarMat;",
    "varying vec4 vRswPlanarPos;",
    "void main() {",
    "\tvec4 rswWorld = modelMatrix * vec4(position, 1.0);",
    "\tvRswPlanarPos = uRswPlanarMat * rswWorld;",
    "\tgl_Position = projectionMatrix * viewMatrix * rswWorld;",
    "}",
  ].join("\n");
}

export function buildMirrorOverlayFrag() {
  return [
    "uniform sampler2D uRswPlanar;",
    "uniform float uRswPlanarOn;",
    "uniform float uRswMirrorGain;",
    "uniform vec3 uRswMirrorTint;",
    "varying vec4 vRswPlanarPos;",
    "void main() {",
    "\tif (uRswPlanarOn < 0.5 || vRswPlanarPos.w <= 0.0001) discard;",
    "\tvec2 rswUv = clamp(vRswPlanarPos.xy / vRswPlanarPos.w, vec2(0.0), vec2(1.0));",
    "\tvec3 rswC = texture2D(uRswPlanar, rswUv).rgb;",

    "\tvec2 rswEdge = min(rswUv, vec2(1.0) - rswUv);",
    "\tfloat rswFade = clamp(min(rswEdge.x, rswEdge.y) * 24.0, 0.35, 1.0);",
    "\tgl_FragColor = vec4(rswC * uRswMirrorTint * uRswMirrorGain * rswFade, 1.0);",
    "}",
  ].join("\n");
}
