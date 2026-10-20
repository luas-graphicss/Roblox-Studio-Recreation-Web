import { buildMegaLightsDepthGlsl } from "./megaLightsDepthGlsl.js";

import { resolveMegaLightsPerfOptions } from "./megaLightsPerf/megaLightsPerfOptions.js";
import {
  buildLightBoundsUniformGlsl,
  buildLightBoundsEarlyOutGlsl,
} from "./megaLightsPerf/megaLightsLightBoundsGlsl.js";
import { buildScreenTraceLoopGlsl } from "./megaLightsPerf/megaLightsScreenTraceGlsl.js";
import {
  buildViewPositionFromDepthHelperGlsl,
  buildViewPositionAssignmentGlsl,
} from "./megaLightsPerf/megaLightsViewPositionGlsl.js";
import { buildReservoirWeightGlsl } from "./megaLightsPerf/megaLightsReservoirWeightGlsl.js";
import {
  buildLightRangeRejectGlsl,
  buildFalloffWindowGlsl,
} from "./megaLightsPerf/megaLightsFalloffWindowGlsl.js";
import {
  buildDepthSliceUniformGlsl,
  buildDepthSliceLookupGlsl,
} from "./megaLightsPerf/megaLightsDepthSliceGlsl.js";
import {
  createDepthSliceScaleBias,
  computeDepthSliceScaleBias,
  depthSliceFromScaleBias,
} from "./megaLightsPerf/megaLightsDepthSliceCore.js";


export const CL_X = 16;                                                   
export const CL_Y = 9;                              
export const CL_Z = 24;                                            
export const CL_TOTAL = CL_X * CL_Y * CL_Z;                


export const CL_TEX_CLUSTER = CL_TOTAL;            


export const CL_IDX_TEX_W = 4096;
export const CL_IDX_TEX_H = 4;
export const CL_MAX_INDEX_ENTRIES = CL_IDX_TEX_W * CL_IDX_TEX_H;         
export const CL_MAX_LIGHTS_PER_CELL = 32;                          


export const CL_MAX_LIGHTS = 512;


export const CL_SPEC_STRENGTH_DEFAULT = 0.6;


export const CL_DEFAULTS = Object.freeze({
  specStrength: CL_SPEC_STRENGTH_DEFAULT,
});

export function sanitizeClusterSettings(opts) {
  const o = opts || {};
  const num = (v, lo, hi, dv) =>
    Number.isFinite(Number(v)) ? Math.min(hi, Math.max(lo, Number(v))) : dv;
  return {
    specStrength: num(o.specStrength, 0, 1, CL_DEFAULTS.specStrength),
  };
}


const _depthSliceScaleBias = createDepthSliceScaleBias();

export function clZSlice(viewZNeg, near, far) {


  const scaleBias = computeDepthSliceScaleBias(near, far, CL_Z, _depthSliceScaleBias);
  return depthSliceFromScaleBias(viewZNeg, near, scaleBias.scale, scaleBias.bias, CL_Z);
}

export function clXYSlice(ndcX, ndcY) {

  const tx = Math.floor(((ndcX + 1) * 0.5) * CL_X);
  const ty = Math.floor(((1 - ndcY) * 0.5) * CL_Y);                               
  return {
    tx: Math.min(Math.max(tx, 0), CL_X - 1),
    ty: Math.min(Math.max(ty, 0), CL_Y - 1),
  };
}

export function clCellIndex(tx, ty, tz) {
  return tz * (CL_X * CL_Y) + ty * CL_X + tx;
}


function boundsInto(out, lx, ly, lz, range, near, far, projM00, projM11) {


  const viewZNeg = -lz;
  const zNear = Math.max(viewZNeg - range, near);
  const zFar = Math.min(viewZNeg + range, far);
  if (zFar <= near || zNear >= far) return false;                                   


  const invZ = viewZNeg > 0.001 ? 1 / viewZNeg : 0;
  const ndcCX = lx * projM00 * invZ;
  const ndcCY = ly * projM11 * invZ;


  const closestZ = Math.max(viewZNeg - range, near);
  const angRadius = range / Math.max(closestZ, 0.001);
  const ndcRX = angRadius * projM00;
  const ndcRY = angRadius * projM11;


  const txA = clamp(Math.floor(((ndcCX - ndcRX + 1) * 0.5) * CL_X), 0, CL_X - 1);
  const txB = clamp(Math.floor(((ndcCX + ndcRX + 1) * 0.5) * CL_X), 0, CL_X - 1);
  const tyA = clamp(Math.floor(((1 - (ndcCY + ndcRY)) * 0.5) * CL_Y), 0, CL_Y - 1);
  const tyB = clamp(Math.floor(((1 - (ndcCY - ndcRY)) * 0.5) * CL_Y), 0, CL_Y - 1);

  out.txMin = Math.min(txA, txB);
  out.txMax = Math.max(txA, txB);
  out.tyMin = Math.min(tyA, tyB);
  out.tyMax = Math.max(tyA, tyB);
  out.tzMin = clamp(clZSlice(zNear, near, far), 0, CL_Z - 1);
  out.tzMax = clamp(clZSlice(zFar, near, far), 0, CL_Z - 1);
  return true;
}

export function clLightBounds(lx, ly, lz, range, near, far, projM00, projM11) {
  const out = { txMin: 0, txMax: 0, tyMin: 0, tyMax: 0, tzMin: 0, tzMax: 0 };
  return boundsInto(out, lx, ly, lz, range, near, far, projM00, projM11) ? out : null;
}

function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }


const _cellCount = new Int32Array(CL_TOTAL);
const _cellOffset = new Int32Array(CL_TOTAL);


let _lightIdxHighWater = 0;
const _vPool = [];
for (let _i = 0; _i < CL_MAX_LIGHTS; _i++) {
  _vPool.push({ lIdx: 0, txMin: 1, txMax: 0, tyMin: 1, tyMax: 0, tzMin: 1, tzMax: 0 });
}

export function packClusterBuffers(lights, viewElements, projM00, projM11, near, far, clusterOut, lightIdxOut, maxLights) {
  const e = viewElements;


  const clearedIdxFloats = Math.min(lightIdxOut.length, _lightIdxHighWater * 4);
  if (clearedIdxFloats > 0) lightIdxOut.fill(0, 0, clearedIdxFloats);
  _lightIdxHighWater = 0;

  if (!Array.isArray(lights) || !e || lights.length === 0) {
    clusterOut.fill(0);                                                      
    return { count: 0, totalIdx: 0 };
  }

  const mReq = Number(maxLights);
  const cap = Math.min(CL_MAX_LIGHTS, Number.isFinite(mReq) && mReq > 0 ? Math.floor(mReq) : CL_MAX_LIGHTS);


  let count = 0;
  for (let i = 0; i < lights.length && count < cap; i++) {
    const l = lights[i];
    if (!l) continue;
    const range = Number(l.range) || 0;
    const inten = Number(l.intensity) || 0;
    if (range <= 0 || inten <= 0) continue;
    const wx = Number(l.x) || 0;
    const wy = Number(l.y) || 0;
    const wz = Number(l.z) || 0;

    const vx = e[0]*wx + e[4]*wy + e[8]*wz + e[12];
    const vy = e[1]*wx + e[5]*wy + e[9]*wz + e[13];
    const vz = e[2]*wx + e[6]*wy + e[10]*wz + e[14];
    const slot = _vPool[count];
    slot.lIdx = count;
    if (!boundsInto(slot, vx, vy, vz, range, near, far, projM00, projM11)) {

      slot.txMin = 1; slot.txMax = 0;
      slot.tyMin = 1; slot.tyMax = 0;
      slot.tzMin = 1; slot.tzMax = 0;
    }
    count++;
  }


  _cellCount.fill(0);
  for (let i = 0; i < count; i++) {
    const v = _vPool[i];
    for (let tz = v.tzMin; tz <= v.tzMax; tz++) {
      for (let ty = v.tyMin; ty <= v.tyMax; ty++) {
        for (let tx = v.txMin; tx <= v.txMax; tx++) {
          const ci = clCellIndex(tx, ty, tz);
          if (_cellCount[ci] < CL_MAX_LIGHTS_PER_CELL) _cellCount[ci]++;
        }
      }
    }
  }


  let totalIdx = 0;
  for (let c = 0; c < CL_TOTAL; c++) {
    _cellOffset[c] = totalIdx;
    totalIdx += _cellCount[c];
    if (totalIdx >= CL_MAX_INDEX_ENTRIES) {

      totalIdx = CL_MAX_INDEX_ENTRIES;
      for (let c2 = c + 1; c2 < CL_TOTAL; c2++) {
        _cellOffset[c2] = CL_MAX_INDEX_ENTRIES;
        _cellCount[c2] = 0;
      }
      break;
    }
  }


  _cellCount.fill(0);                     
  for (let i = 0; i < count; i++) {
    const v = _vPool[i];
    for (let tz = v.tzMin; tz <= v.tzMax; tz++) {
      for (let ty = v.tyMin; ty <= v.tyMax; ty++) {
        for (let tx = v.txMin; tx <= v.txMax; tx++) {
          const ci = clCellIndex(tx, ty, tz);
          const slot = _cellOffset[ci] + _cellCount[ci];
          if (slot < CL_MAX_INDEX_ENTRIES && _cellCount[ci] < CL_MAX_LIGHTS_PER_CELL) {
            lightIdxOut[slot * 4] = v.lIdx;                                           
            _cellCount[ci]++;
          }
        }
      }
    }
  }


  for (let c = 0; c < CL_TOTAL; c++) {
    clusterOut[c * 4 + 0] = _cellOffset[c];
    clusterOut[c * 4 + 1] = _cellCount[c];
    clusterOut[c * 4 + 2] = 0;                                              
    clusterOut[c * 4 + 3] = 0;
  }

  _lightIdxHighWater = totalIdx;
  return { count, totalIdx };
}


export function mlSpecWeightAt(light, px, py, pz, specStrength) {
  const st = Math.min(1, Math.max(0, Number(specStrength) || 0));
  if (st <= 0) return 0;
  const dx = (Number(light.x) || 0) - px;
  const dy = (Number(light.y) || 0) - py;
  const dz = (Number(light.z) || 0) - pz;
  const d2 = dx*dx + dy*dy + dz*dz;
  const r = Number(light.range) || 0;
  if (r <= 0 || d2 >= r*r) return 0;
  const lum =
    Math.max(Number(light.r)||0, Number(light.g)||0, Number(light.b)||0) *
    (Number(light.intensity)||0);
  const d = Math.sqrt(d2);
  const dr = d / r;
  const win = Math.max(0, 1 - dr*dr*dr*dr);

  const dSpec = Math.max(d, 0.1);
  return st * lum * win * win / (dSpec * Math.sqrt(dSpec));
}


export function buildClusterFrag(mlMaxLights, mlTexWidth, mlWeightMin, mlGolden, opts) {
  const CX = String(CL_X), CY = String(CL_Y), CZ = String(CL_Z);
  const CT = String(CL_TOTAL);
  const IDXW = String(CL_IDX_TEX_W);
  const IDXH = String(CL_IDX_TEX_H);
  const IDXMAX = String(CL_MAX_INDEX_ENTRIES);
  const MPC = String(CL_MAX_LIGHTS_PER_CELL);
  const WML = mlTexWidth.toFixed(1);
  const WMIN = mlWeightMin.toFixed(6);
  const GOLDEN = mlGolden.toFixed(11);
  const MLMAX = String(mlMaxLights);


  const oAtlas = opts || {};
  const atlasGlsl = typeof oAtlas.atlasGlsl === "string" ? oAtlas.atlasGlsl : "";
  const withAtlas = atlasGlsl.length > 0;
  const KOFF = (Number(oAtlas.kOffset) || 0).toFixed(16);


  const perf = resolveMegaLightsPerfOptions(oAtlas.perf);


  const reservoirWeightGlsl = buildReservoirWeightGlsl({
    specularWeightUniformGate: perf.specularWeightUniformGate,
  });


  const lightRangeRejectGlsl = buildLightRangeRejectGlsl({
    sqrtFree: perf.sqrtFreeFalloffWindow,
  });
  const falloffWindowGlsl = buildFalloffWindowGlsl({
    sqrtFree: perf.sqrtFreeFalloffWindow,
  });

  return [
    "precision highp float;",
    "varying vec2 vUv;",
    "uniform sampler2D tDiffuse;",
    "uniform sampler2D tDepth;",
    "uniform sampler2D tLights;       // megaLights DataTexture (pos+color, view space)",
    "uniform sampler2D uClusterTex;   // CL_TOTAL×1 RGBA float: R=firstIdx,G=count",
    "uniform sampler2D uLightIdxTex;  // CL_IDX_TEX_W×CL_IDX_TEX_H RGBA float: R=lightIdx (linha-major)",
    "uniform int uCount;",
    "uniform float uBase;",
    "uniform float uStrength;",
    "uniform float uSteps;",
    "uniform float uDistance;",
    "uniform float uThickness;",
    "uniform float uFrame;",
    "uniform mat4 uProj;",
    "uniform mat4 uInvProj;",
    "uniform float uNear;",
    "uniform float uFar;",
    "uniform float uClusterOn;         // 0=bypass, 1=cluster",
    "uniform float uSpecStrength;      // boost especular [0,1]",
    "uniform float uProjM00;           // projectionMatrix[0]",
    "uniform float uProjM11;           // projectionMatrix[5]",
    ...(perf.lightBoundsCulling ? buildLightBoundsUniformGlsl() : []),
    ...(perf.precomputedDepthSlice ? buildDepthSliceUniformGlsl() : []),
    "const float RSW_ML_W = " + WML + ";",
    "const float RSW_CL_TOTAL = " + CT + ".0;",
    "const float RSW_CL_IDX_W = " + IDXW + ".0;",
    "const float RSW_CL_IDX_H = " + IDXH + ".0;",
    "const float RSW_CL_IDX_MAX = " + IDXMAX + ".0;",
    "const float RSW_CL_X = " + CX + ".0;",
    "const float RSW_CL_Y = " + CY + ".0;",
    "const float RSW_CL_Z = " + CZ + ".0;",

    buildMegaLightsDepthGlsl(),
    "vec3 rswViewPos(const in vec2 uv, const in float depthRaw) {",
    "  vec2 ndc = uv*2.0-1.0;",
    "  vec4 t = uInvProj*vec4(ndc,-1.0,1.0);",
    "  vec3 ray = t.xyz/t.w;",
    "  float vz = (uNear*uFar)/((uFar-uNear)*depthRaw - uFar);",
    "  return ray*(vz/ray.z);",
    "}",


    ...buildViewPositionFromDepthHelperGlsl({ reuseUnpackedDepth: perf.reusedUnpackedDepth }),
    "vec4 rswLight(const in float texel) {",
    "  return texture2D(tLights, vec2((texel+0.5)/RSW_ML_W, 0.5));",
    "}",

    "vec2 rswClusterLookup(const in vec3 P) {",
    "  float viewZNeg = -P.z;",
    ...buildDepthSliceLookupGlsl({ precomputed: perf.precomputedDepthSlice }),
    "  tz = clamp(tz, 0.0, RSW_CL_Z-1.0);",
    "  vec2 ndc;",
    "  ndc.x = P.x*uProjM00/(-P.z);",
    "  ndc.y = P.y*uProjM11/(-P.z);",
    "  float tx = floor(((ndc.x+1.0)*0.5)*RSW_CL_X);",
    "  float ty = floor(((1.0-ndc.y)*0.5)*RSW_CL_Y);",
    "  tx = clamp(tx, 0.0, RSW_CL_X-1.0);",
    "  ty = clamp(ty, 0.0, RSW_CL_Y-1.0);",
    "  float ci = tz*(RSW_CL_X*RSW_CL_Y) + ty*RSW_CL_X + tx;",
    "  float u = (ci+0.5)/RSW_CL_TOTAL;",
    "  vec4 cell = texture2D(uClusterTex, vec2(u, 0.5));",
    "  return vec2(cell.r, cell.g); // (firstIdx, count)",
    "}",
    "float rswLightIdxAt(const in float slot) {",
    "  float ix = mod(slot, RSW_CL_IDX_W);",
    "  float iy = floor(slot / RSW_CL_IDX_W);",
    "  return texture2D(uLightIdxTex, vec2((ix+0.5)/RSW_CL_IDX_W, (iy+0.5)/RSW_CL_IDX_H)).r;",
    "}",


    ...(withAtlas ? [
      atlasGlsl,
      "float rswPick0 = -1.0;",
      "float rswPick1 = -1.0;",
      "float rswPick2 = -1.0;",
      "float rswPick3 = -1.0;",
      "const float RSW_KOFF_F19 = " + KOFF + ";",
      "void rswPickK(const in float li, const in float w, const in float wsumNow, const in float rnd0) {",
      "  if (uAtlasOn < 0.5) return;",
      "  if (uSamplesK > 1.5) { float r1 = fract(rnd0 + RSW_KOFF_F19 + li*" + GOLDEN + "); if (r1*wsumNow <= w) rswPick1 = li; }",
      "  if (uSamplesK > 2.5) { float r2 = fract(rnd0 + 2.0*RSW_KOFF_F19 + li*" + GOLDEN + "); if (r2*wsumNow <= w) rswPick2 = li; }",
      "  if (uSamplesK > 3.5) { float r3 = fract(rnd0 + 3.0*RSW_KOFF_F19 + li*" + GOLDEN + "); if (r3*wsumNow <= w) rswPick3 = li; }",
      "}",
    ] : []),
    "void main() {",
    "  vec4 base = texture2D(tDiffuse, vUv);",
    "  gl_FragColor = base;",
    "  if (uCount <= 0) return;",
    "  float dRaw = rswUnpack(texture2D(tDepth, vUv));",
    "  if (dRaw >= 0.9999) return;",
    "  vec2 depthGradient = rswDepthGradient(vUv, dRaw);",
    "  dRaw = rswAlignDepth(dRaw, vUv, depthGradient);",
    ...buildViewPositionAssignmentGlsl({ reuseUnpackedDepth: perf.reusedUnpackedDepth }),


    ...(perf.lightBoundsCulling ? buildLightBoundsEarlyOutGlsl() : []),
    "  float rnd0 = fract(52.9829189*fract(dot(gl_FragCoord.xy+vec2(uFrame*5.588238),vec2(0.06711056,0.00583715))));",
    "  float wsum = 0.0;",
    "  vec3 lPos = vec3(0.0);",
    "  bool has = false;",

    "  if (uClusterOn > 0.5) {",
    "    vec2 cl = rswClusterLookup(P);",
    "    float firstIdx = cl.x;",
    "    int cellCount = int(cl.y);",
    "    for (int ci = 0; ci < " + MPC + "; ci++) {",
    "      if (ci >= cellCount) break;",
    "      float slot = firstIdx + float(ci);",
    "      if (slot >= RSW_CL_IDX_MAX) break;",
    "      float li = rswLightIdxAt(slot);",
    "      if (li < 0.0 || li >= float(uCount)) continue;",
    "      vec4 t0 = rswLight(li*2.0);",
    "      float r = t0.w;",
    "      vec3 dv = t0.xyz - P;",
    "      float d2 = dot(dv,dv);",
    ...lightRangeRejectGlsl,
    "      vec4 t1 = rswLight(li*2.0+1.0);",
    "      float lum = max(t1.x,max(t1.y,t1.z));",
    ...falloffWindowGlsl,

    ...reservoirWeightGlsl,
    "      if (w < " + WMIN + ") continue;",
    "      wsum += w;",
    "      float ri = fract(rnd0+li*" + GOLDEN + ");",


    withAtlas
      ? "      if (ri*wsum <= w) { has=true; lPos=t0.xyz; rswPick0=li; }\n      rswPickK(li, w, wsum, rnd0);"
      : "      if (ri*wsum <= w) { has=true; lPos=t0.xyz; }",
    "    }",
    "  } else {",

    "    for (int i = 0; i < " + MLMAX + "; i++) {",
    "      if (i >= uCount) break;",
    "      vec4 t0 = rswLight(float(i*2));",
    "      float r = t0.w;",
    "      vec3 dv = t0.xyz - P;",
    "      float d2 = dot(dv,dv);",
    ...lightRangeRejectGlsl,
    "      vec4 t1 = rswLight(float(i*2+1));",
    "      float lum = max(t1.x,max(t1.y,t1.z));",
    ...falloffWindowGlsl,
    ...reservoirWeightGlsl,
    "      if (w < " + WMIN + ") continue;",
    "      wsum += w;",
    "      float ri = fract(rnd0+float(i)*" + GOLDEN + ");",
    withAtlas
      ? "      if (ri*wsum <= w) { has=true; lPos=t0.xyz; rswPick0=float(i); }\n      rswPickK(float(i), w, wsum, rnd0);"
      : "      if (ri*wsum <= w) { has=true; lPos=t0.xyz; }",
    "    }",
    "  }",
    "  if (!has || wsum <= 0.0) return;",
    "  vec3 toL = lPos - P;",
    "  float dist = length(toL);",
    "  vec3 dir = toL/max(dist,1e-4);",
    "  float maxT = min(dist-0.05, uDistance);",


    ...(withAtlas ? [
      "  bool rswAtlasPath = false;",
      "  float rswAtlasBlocked = 0.0;",
      "  vec3 rswAtlasTint = vec3(1.0);",
      "  if (uAtlasOn > 0.5) {",
      "    float sCnt = 0.0; float sBlk = 0.0; bool noSlot0 = false;",
      "    float sv0 = (rswPick0 >= 0.0) ? rswSaVis(rswPick0, P) : -1.0;",
      "    if (sv0 >= 0.0) { sBlk += 1.0 - sv0; sCnt += 1.0; } else { noSlot0 = true; }",
      "    if (uSamplesK > 1.5 && rswPick1 >= 0.0) { float sv1 = rswSaVis(rswPick1, P); if (sv1 >= 0.0) { sBlk += 1.0 - sv1; sCnt += 1.0; } }",
      "    if (uSamplesK > 2.5 && rswPick2 >= 0.0) { float sv2 = rswSaVis(rswPick2, P); if (sv2 >= 0.0) { sBlk += 1.0 - sv2; sCnt += 1.0; } }",
      "    if (uSamplesK > 3.5 && rswPick3 >= 0.0) { float sv3 = rswSaVis(rswPick3, P); if (sv3 >= 0.0) { sBlk += 1.0 - sv3; sCnt += 1.0; } }",
      "    if (sCnt > 0.0 && !noSlot0) {",
      "      rswAtlasPath = true;",
      "      rswAtlasBlocked = clamp(sBlk / sCnt, 0.0, 1.0);",
      "      rswAtlasTint = rswSaTint(P, lPos);",
      "    }",
      "  }",
      "  float blocked = 0.0;",
      "  if (!rswAtlasPath) {",
      "  if (maxT <= 0.02) return;",
    ] : [
      "  if (maxT <= 0.02) return;",
      "  float blocked = 0.0;",
    ]),
    ...buildScreenTraceLoopGlsl({ hoistProjection: perf.hoistedScreenTraceProjection }),
    "  if (blocked <= 0.0) return;",
    ...(withAtlas ? [
      "  }",
    ] : []),
    "  vec2 eb = min(vUv,1.0-vUv);",
    "  float edge = clamp(min(eb.x,eb.y)/0.08,0.0,1.0);",
    ...(withAtlas ? [


      "  vec3 blockedV = rswAtlasPath ? clamp(vec3(1.0) - (1.0 - rswAtlasBlocked)*rswAtlasTint, 0.0, 1.0) : vec3(blocked);",
      "  vec3 f3 = vec3(1.0) - clamp(blockedV*uStrength*edge, 0.0, 1.0)*(wsum/(wsum+max(uBase,0.001)));",
      "  gl_FragColor = vec4(base.rgb*f3,base.a);",
    ] : [
      "  float f = 1.0-clamp(blocked*uStrength*edge,0.0,1.0)*(wsum/(wsum+max(uBase,0.001)));",
      "  gl_FragColor = vec4(base.rgb*f,base.a);",
    ]),
    "}",
  ].join("\n");
}
