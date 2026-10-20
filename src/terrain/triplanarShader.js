import { ATLAS_TILE, ATLAS_COLS, ATLAS_ROWS } from "./terrainTextures.js";

export const TRIPLANAR_CACHE_KEY = "rswTri905";                                            
export const TRIPLANAR_TEX_SCALE = 12;                               

const f = (v) => {
  const s = String(v);
  return s.includes(".") || s.includes("e") ? s : s + ".0";
};

export function buildTriplanarVertexPars() {
  return [
    "attribute vec3 rswMats;",
    "attribute vec3 rswWeights;",
    "varying vec3 vRswMats;",
    "varying vec3 vRswWeights;",
    "varying vec3 vRswPos;",
    "varying vec3 vRswNrm;",
  ].join("\n");
}

export function buildTriplanarVertexMain() {
  return [
    "vRswMats = rswMats;",
    "vRswWeights = rswWeights;",
    "vRswPos = position;",
    "vRswNrm = normal;",
  ].join("\n");
}







export function buildTriplanarFragPars(layout) {
  const cols = f(layout && layout.cols ? layout.cols : ATLAS_COLS);
  const rows = f(layout && layout.rows ? layout.rows : ATLAS_ROWS);
  const margin = f(0.5 / (layout && layout.tile ? layout.tile : ATLAS_TILE));
  return [
    "uniform sampler2D uRswAtlas;",
    "uniform float uRswTexScale;",
    "varying vec3 vRswMats;",
    "varying vec3 vRswWeights;",
    "varying vec3 vRswPos;",
    "varying vec3 vRswNrm;",
    "vec2 rswTileUv(const in float mat, const in vec2 uv) {",
    "\tfloat m = clamp(floor(mat + 0.5), 0.0, " + cols + " * " + rows + " - 1.0);",
    "\tfloat col = mod(m, " + cols + ");",
    "\tfloat row = floor(m / " + cols + ");",
    "\tvec2 f = fract(uv) * (1.0 - " + margin + " * 2.0) + " + margin + ";",
    "\treturn vec2((col + f.x) / " + cols + ", (row + f.y) / " + rows + ");",
    "}",
    "vec3 rswTriSample(const in float mat, const in vec3 p, const in vec3 bw) {",
    "\tvec3 tx = texture2D(uRswAtlas, rswTileUv(mat, p.zy)).rgb;",
    "\tvec3 ty = texture2D(uRswAtlas, rswTileUv(mat, p.xz)).rgb;",
    "\tvec3 tz = texture2D(uRswAtlas, rswTileUv(mat, p.xy)).rgb;",
    "\treturn tx * bw.x + ty * bw.y + tz * bw.z;",
    "}",
  ].join("\n");
}




export function buildTriplanarFragMain() {
  return [
    "{",




    "\tvec3 rswBw = abs(vRswNrm) + vec3(1e-5);",
    "\trswBw = pow(rswBw, vec3(4.0));",
    "\trswBw /= (rswBw.x + rswBw.y + rswBw.z);",
    "\tvec3 rswP = vRswPos / max(uRswTexScale, 0.001);",
    "\tvec3 rswW = max(vRswWeights - vec3(0.02), vec3(0.0));",
    "\trswW /= max(rswW.x + rswW.y + rswW.z, 1e-4);",
    "\tvec3 rswTex = rswTriSample(vRswMats.x, rswP, rswBw) * rswW.x",
    "\t\t+ rswTriSample(vRswMats.y, rswP, rswBw) * rswW.y",
    "\t\t+ rswTriSample(vRswMats.z, rswP, rswBw) * rswW.z;",
    "\tfloat rswLuma = dot(diffuseColor.rgb, vec3(0.299, 0.587, 0.114));",


    "\tfloat rswFar = smoothstep(120.0, 420.0, length(vViewPosition));",
    "\tdiffuseColor.rgb = mix(rswTex * (0.72 + rswLuma * 0.56), diffuseColor.rgb, rswFar);",
    "}",
  ].join("\n");
}
