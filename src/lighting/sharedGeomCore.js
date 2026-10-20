export const GEOM_DIVISOR = 2;


export const GEOM_BILATERAL_K = 8;


export const GEOM_SKY_EPS = 0.98;


export function geomTargetSize(w, h) {
  const iw = Number.isFinite(w) && w > 0 ? Math.floor(w) : 1;
  const ih = Number.isFinite(h) && h > 0 ? Math.floor(h) : 1;
  return {
    w: Math.max(1, Math.floor(iw / GEOM_DIVISOR)),
    h: Math.max(1, Math.floor(ih / GEOM_DIVISOR)),
  };
}


export function octEncodeJs(x, y, z) {
  const s = Math.abs(x) + Math.abs(y) + Math.abs(z);
  const inv = 1 / Math.max(s, 1e-6);
  let ex = x * inv;
  let ey = y * inv;
  const ez = z * inv;
  if (ez < 0) {
    const wx = (1 - Math.abs(ey)) * (ex >= 0 ? 1 : -1);
    const wy = (1 - Math.abs(ex)) * (ey >= 0 ? 1 : -1);
    ex = wx;
    ey = wy;
  }
  return [ex * 0.5 + 0.5, ey * 0.5 + 0.5];
}


export function octDecodeJs(u, v) {
  const fx = u * 2 - 1;
  const fy = v * 2 - 1;
  let nx = fx;
  let ny = fy;
  const nz = 1 - Math.abs(fx) - Math.abs(fy);
  const t = Math.min(Math.max(-nz, 0), 1);
  nx += nx >= 0 ? -t : t;
  ny += ny >= 0 ? -t : t;
  const len = Math.hypot(nx, ny, nz) || 1;
  return [nx / len, ny / len, nz / len];
}


export function packDepth16Js(d01) {
  const d = Math.min(Math.max(Number.isFinite(d01) ? d01 : 0, 0), 1);
  const hi = Math.floor(d * 255) / 255;
  const lo = d * 255 - Math.floor(d * 255);
  return [hi, lo];
}


export function unpackDepth16Js(hi, lo) {
  return hi + lo / 255;
}


export function viewPosFromDepthJs(u, v, dist, invP00, invP11) {
  const ndcX = u * 2 - 1;
  const ndcY = v * 2 - 1;
  return [ndcX * invP00 * dist, ndcY * invP11 * dist, -dist];
}


export function normalFromNeighborsJs(pc, pl, pr, pu, pd) {
  const dx = Math.abs(pr[2] - pc[2]) < Math.abs(pc[2] - pl[2])
    ? [pr[0] - pc[0], pr[1] - pc[1], pr[2] - pc[2]]
    : [pc[0] - pl[0], pc[1] - pl[1], pc[2] - pl[2]];
  const dy = Math.abs(pu[2] - pc[2]) < Math.abs(pc[2] - pd[2])
    ? [pu[0] - pc[0], pu[1] - pc[1], pu[2] - pc[2]]
    : [pc[0] - pd[0], pc[1] - pd[1], pc[2] - pd[2]];

  let nx = dy[1] * dx[2] - dy[2] * dx[1];
  let ny = dy[2] * dx[0] - dy[0] * dx[2];
  let nz = dy[0] * dx[1] - dy[1] * dx[0];
  const len = Math.hypot(nx, ny, nz) || 1;
  nx /= len;
  ny /= len;
  nz /= len;
  if (nz < 0) {
    nx = -nx;
    ny = -ny;
    nz = -nz;
  }
  return [nx, ny, nz];
}


export function bilateralDepthWeightJs(dCenter, dSample, k = GEOM_BILATERAL_K) {
  const dcRaw = Number.isFinite(dCenter) ? dCenter : 0;
  const ds = Number.isFinite(dSample) ? dSample : 0;
  return Math.exp((-k * Math.abs(ds - dcRaw)) / Math.max(dcRaw, 1e-3));
}


export function glslFloatGeom(v) {
  const n = Number.isFinite(v) ? v : 0;
  const s = String(n);
  return s.includes(".") || s.includes("e") || s.includes("E") ? s : s + ".0";
}


export function buildGeomVert() {
  return `
varying vec2 vUv;
void main() {
  vUv = uv;
  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
}
`;
}


export function buildGeomFrag() {
  return `
#include <packing>
varying vec2 vUv;
uniform sampler2D tDepth;
uniform float uNear;
uniform float uFar;
uniform vec2 uInvProj;
uniform vec2 uTexel;
float rswGDist(vec2 uv) {
  float z = unpackRGBAToDepth(texture2D(tDepth, uv));
  return -perspectiveDepthToViewZ(z, uNear, uFar);
}
vec3 rswGViewPos(vec2 uv) {
  float d = rswGDist(uv);
  vec2 ndc = uv * 2.0 - 1.0;
  return vec3(ndc * uInvProj * d, -d);
}
vec2 rswGOctEncode(vec3 n) {
  n /= max(abs(n.x) + abs(n.y) + abs(n.z), 1e-6);
  if (n.z < 0.0) {
    n.xy = (1.0 - abs(n.yx)) * vec2(n.x >= 0.0 ? 1.0 : -1.0, n.y >= 0.0 ? 1.0 : -1.0);
  }
  return n.xy * 0.5 + 0.5;
}
void main() {
  vec3 pc = rswGViewPos(vUv);
  vec2 ex = vec2(uTexel.x, 0.0);
  vec2 ey = vec2(0.0, uTexel.y);
  vec3 pr = rswGViewPos(vUv + ex);
  vec3 pl = rswGViewPos(vUv - ex);
  vec3 pu = rswGViewPos(vUv + ey);
  vec3 pd = rswGViewPos(vUv - ey);
  vec3 dx = abs(pr.z - pc.z) < abs(pc.z - pl.z) ? pr - pc : pc - pl;
  vec3 dy = abs(pu.z - pc.z) < abs(pc.z - pd.z) ? pu - pc : pc - pd;
  vec3 n = normalize(cross(dy, dx));
  if (n.z < 0.0) n = -n;
  float dist = -pc.z;
  float d01 = clamp(dist / uFar, 0.0, 1.0);
  if (d01 >= ${glslFloatGeom(GEOM_SKY_EPS)}) {
    n = vec3(0.0, 0.0, 1.0);
    d01 = 1.0;
  }
  vec2 enc = rswGOctEncode(n);
  float hi = floor(d01 * 255.0) / 255.0;
  float lo = d01 * 255.0 - floor(d01 * 255.0);
  gl_FragColor = vec4(enc, hi, lo);
}
`;
}


export function geomSampleGlsl() {
  return `
vec3 rswGeomNormal(vec2 uv) {
  vec2 f = texture2D(tGeom, uv).rg * 2.0 - 1.0;
  vec3 n = vec3(f.x, f.y, 1.0 - abs(f.x) - abs(f.y));
  float t = clamp(-n.z, 0.0, 1.0);
  n.x += n.x >= 0.0 ? -t : t;
  n.y += n.y >= 0.0 ? -t : t;
  return normalize(n);
}
float rswGeomDist(vec2 uv) {
  vec2 ba = texture2D(tGeom, uv).ba;
  return (ba.x + ba.y / 255.0) * uFar;
}
float rswGeomBilateralW(float dCenter, float dSample) {
  return exp(-${glslFloatGeom(GEOM_BILATERAL_K)} * abs(dSample - dCenter) / max(dCenter, 1e-3));
}
`;
}
