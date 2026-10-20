import {
  clampPcssOptions,
  buildPcssGlsl,
  buildPcssGlslCompare,
  buildPcssReturn,
  buildPointPcssGlsl,
  buildPointPcssReturn,
  parseGetShadowSignature,
  parseGetPointShadowSignature,
  sunTanFromSoftness,
  pointAngFromSoftness,
  depthUvScale,
  clampRuntimeTaps,
  PCSS_TEMPORAL_TAPS,
  PCSS_TEMPORAL_BLOCKERS,
  PCSS_PLANE_BIAS_CAP,
  PCSS_PLANE_BIAS_CAP_MAX,
} from "../lighting/pcssCore.js";
import {
  CSM_BLEND_FRACTION,
  buildCsmGlsl,
  buildCsmReturn,
} from "../lighting/csmCore.js";


import {
  buildRtMaskGlsl,
  buildRtReturn,
} from "../lighting/rtSunCore.js";

import {
  buildSunMaskFetchGlsl,
  buildSunMaskReturn,
} from "../lighting/sunMaskCore.js";


import {
  buildSmLiteGlsl,
  buildSmLiteReturn,
  smLitePenumbraTexels,
  SM_LITE_PEN_DEFAULT,
} from "../lighting/smPcssLiteCore.js";


import {
  buildShadowEdgeFilterGlsl,
  buildShadowEdgeFilterReturn,
  shadowEdgeWidthTexels,
  SHADOW_EDGE_DEFAULT_WIDTH_TEXELS,
} from "../lighting/shadowEdgeFilterCore.js";


import {
  injectSmrtIntoPcss,
  SMRT_STEPS_MIN,
  SMRT_STEPS_MAX,
} from "../lighting/smrtCore.js";





import {
  CLIPMAP_GLSL_UNIFORMS,
  buildClipmapGlsl,
} from "../lighting/clipmapCore.js";
import {
  CLIPMAP_SAMPLE_GLSL_UNIFORMS,
  buildClipmapSampleGlsl,
  buildClipmapSampleReturn,
} from "../lighting/clipmapRenderCore.js";

const ANCHOR_TOP = "#ifdef USE_SHADOWMAP";
const ANCHOR_GET_SHADOW = "float getShadow(";
const ANCHOR_GET_POINT = "float getPointShadow(";
const ANCHOR_INCLUDE = "#include <shadowmap_pars_fragment>";


function rswVec4Flat(THREE) {
  return THREE && typeof THREE.Vector4 === "function"
    ? new THREE.Vector4(0, 0, 0, 0)
    : { x: 0, y: 0, z: 0, w: 0, set(x, y, z, w) { this.x = x; this.y = y; this.z = z; this.w = w; } };
}

export function createPcssShadows({ THREE, weakGpu }) {


  const csmScaleDefault = depthUvScale(1, 1500, 360);
  const csmScaleValue =
    THREE && typeof THREE.Vector4 === "function"
      ? new THREE.Vector4(csmScaleDefault, csmScaleDefault, csmScaleDefault, csmScaleDefault)
      : {
          x: csmScaleDefault,
          y: csmScaleDefault,
          z: csmScaleDefault,
          w: csmScaleDefault,
          set(x, y, z, w) {
            this.x = x;
            this.y = y;
            this.z = z;
            this.w = w;
          },
        };
  const uniforms = {
    uRswPcssOn: { value: 0 },
    uRswPcssTan: { value: sunTanFromSoftness(0.2, 1) },
    uRswPcssScale: { value: depthUvScale(1, 1500, 360) },

    uRswPcssPtAng: { value: pointAngFromSoftness(0.2, 1) },


    uRswPcssFrame: { value: 0 },
    uRswPcssTemporal: { value: 0 },
    uRswPcssTaps: { value: clampRuntimeTaps().taps },
    uRswPcssBlockerTaps: { value: clampRuntimeTaps().blockers },


    uRswPcssPlaneCap: { value: PCSS_PLANE_BIAS_CAP },

    uRswCsmOn: { value: 0 },
    uRswCsmCount: { value: 1 },
    uRswCsmScale: { value: csmScaleValue },
    uRswCsmBlend: { value: CSM_BLEND_FRACTION },


    uRswRtOn: { value: 0 },
    uRswRtMix: { value: 0 },
    uRswRtTex: { value: null },
    uRswRtInvRes: {
      value:
        THREE && typeof THREE.Vector2 === "function"
          ? new THREE.Vector2(0, 0)
          : { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; } },
    },

    uRswSunMaskOn: { value: 0 },
    uRswSunMaskTex: { value: null },
    uRswSunMaskInvRes: {
      value:
        THREE && typeof THREE.Vector2 === "function"
          ? new THREE.Vector2(0, 0)
          : { x: 0, y: 0, set(x, y) { this.x = x; this.y = y; } },
    },

    uRswSmLitePen: { value: SM_LITE_PEN_DEFAULT },


    uRswSmLiteCH: { value: 0 },


    uRswShadowEdgeOn: { value: 0 },
    uRswShadowEdgeWidth: { value: SHADOW_EDGE_DEFAULT_WIDTH_TEXELS },


    uRswSmrtOn: { value: 0 },
    uRswSmrtSteps: { value: SMRT_STEPS_MIN },



    uRswClipOn: { value: 0 },
    uRswClipLevels: { value: 8 },
    uRswClipHalf0: { value: 8 },
    uRswClipAtlas: { value: null },
    uRswClipTable: { value: null },
    uRswClipWinA: { value: rswVec4Flat(THREE) },
    uRswClipCam: { value: rswVec4Flat(THREE) },
    uRswClipAtl: { value: rswVec4Flat(THREE) },
  };


  let patchGen = 0;


  const baseChunk =
    THREE && THREE.ShaderChunk ? THREE.ShaderChunk.shadowmap_pars_fragment : null;
  const signature = parseGetShadowSignature(baseChunk);
  const getShadowIdx =
    typeof baseChunk === "string" ? baseChunk.indexOf(ANCHOR_GET_SHADOW) : -1;
  const getShadowBrace =
    getShadowIdx !== -1 ? baseChunk.indexOf("{", getShadowIdx) : -1;
  const supported =
    signature.ok &&
    typeof baseChunk === "string" &&
    baseChunk.indexOf(ANCHOR_TOP) !== -1 &&
    getShadowBrace !== -1;


  const pointSignature = parseGetPointShadowSignature(baseChunk);
  const pointSupported =
    supported && signature.samplerType === "sampler2D" && pointSignature.ok;


  const csmSupported =
    supported && signature.samplerType === "sampler2D" && signature.hasRadius === true;


  const rtSupported = csmSupported;

  const maskSupported = csmSupported;


  const smLiteSupported =
    supported && signature.samplerType === "sampler2D" && signature.hasRadius === true;


  const shadowEdgeSupported =
    supported && signature.samplerType === "sampler2D" && signature.hasRadius === true;


  const clipmapSupported = csmSupported && !weakGpu;


  let smrtSupported = false;
  let patchedChunk = "";
  if (supported) {
    const opts = clampPcssOptions(weakGpu ? { samples: 12, blockerSamples: 10 } : {});
    let glsl =
      signature.samplerType === "sampler2DShadow"
        ? buildPcssGlslCompare(opts)
        : buildPcssGlsl(opts);
    if (signature.samplerType === "sampler2D" && !weakGpu) {
      const smrtInj = injectSmrtIntoPcss(glsl);
      smrtSupported = smrtInj.ok === true;
      if (smrtSupported) glsl = smrtInj.glsl;
    }
    const withGlsl = baseChunk.replace(ANCHOR_TOP, ANCHOR_TOP + "\n" + glsl);
    const brace = withGlsl.indexOf("{", withGlsl.indexOf(ANCHOR_GET_SHADOW));
    patchedChunk = withGlsl.slice(0, brace + 1) + buildPcssReturn(signature) + withGlsl.slice(brace + 1);
    if (pointSupported) {
      const ptIdx = patchedChunk.indexOf(ANCHOR_GET_POINT);
      if (ptIdx !== -1) {
        patchedChunk =
          patchedChunk.slice(0, ptIdx) + buildPointPcssGlsl() + "\n" + patchedChunk.slice(ptIdx);
        const ptBrace = patchedChunk.indexOf("{", patchedChunk.indexOf(ANCHOR_GET_POINT));
        patchedChunk =
          patchedChunk.slice(0, ptBrace + 1) + buildPointPcssReturn() + patchedChunk.slice(ptBrace + 1);
      }
    }
    if (csmSupported) {


      const gsIdx = patchedChunk.indexOf(ANCHOR_GET_SHADOW);
      if (gsIdx !== -1) {
        patchedChunk =
          patchedChunk.slice(0, gsIdx) + buildCsmGlsl() + "\n" + patchedChunk.slice(gsIdx);
        const gsBrace = patchedChunk.indexOf("{", patchedChunk.indexOf(ANCHOR_GET_SHADOW));
        patchedChunk =
          patchedChunk.slice(0, gsBrace + 1) + buildCsmReturn() + patchedChunk.slice(gsBrace + 1);
      }


      if (clipmapSupported) {
        const clIdx = patchedChunk.indexOf(ANCHOR_GET_SHADOW);
        if (clIdx !== -1) {
          patchedChunk =
            patchedChunk.slice(0, clIdx) +
            CLIPMAP_GLSL_UNIFORMS +
            CLIPMAP_SAMPLE_GLSL_UNIFORMS +
            buildClipmapGlsl() +
            "\n" +
            buildClipmapSampleGlsl() +
            "\n" +
            patchedChunk.slice(clIdx);
          const clBrace = patchedChunk.indexOf("{", patchedChunk.indexOf(ANCHOR_GET_SHADOW));
          patchedChunk =
            patchedChunk.slice(0, clBrace + 1) + buildClipmapSampleReturn() + patchedChunk.slice(clBrace + 1);
        }
      }


      const rt2Idx = patchedChunk.indexOf(ANCHOR_GET_SHADOW);
      if (rt2Idx !== -1) {
        patchedChunk =
          patchedChunk.slice(0, rt2Idx) + buildRtMaskGlsl() + "\n" + patchedChunk.slice(rt2Idx);
        const rt2Brace = patchedChunk.indexOf("{", patchedChunk.indexOf(ANCHOR_GET_SHADOW));
        patchedChunk =
          patchedChunk.slice(0, rt2Brace + 1) + buildRtReturn() + patchedChunk.slice(rt2Brace + 1);
      }


      const maskIdx = patchedChunk.indexOf(ANCHOR_GET_SHADOW);
      if (maskIdx !== -1) {
        patchedChunk =
          patchedChunk.slice(0, maskIdx) + buildSunMaskFetchGlsl() + "\n" + patchedChunk.slice(maskIdx);
        const maskBrace = patchedChunk.indexOf("{", patchedChunk.indexOf(ANCHOR_GET_SHADOW));
        patchedChunk =
          patchedChunk.slice(0, maskBrace + 1) + buildSunMaskReturn() + patchedChunk.slice(maskBrace + 1);
      }
    }


    if (smLiteSupported) {
      const slIdx = patchedChunk.indexOf(ANCHOR_GET_SHADOW);
      if (slIdx !== -1) {
        patchedChunk =
          patchedChunk.slice(0, slIdx) + buildSmLiteGlsl() + "\n" + patchedChunk.slice(slIdx);
        const slBrace = patchedChunk.indexOf("{", patchedChunk.indexOf(ANCHOR_GET_SHADOW));
        patchedChunk =
          patchedChunk.slice(0, slBrace + 1) + buildSmLiteReturn() + patchedChunk.slice(slBrace + 1);
      }
    }


    if (shadowEdgeSupported) {
      const edgeIdx = patchedChunk.indexOf(ANCHOR_GET_SHADOW);
      if (edgeIdx !== -1) {
        patchedChunk =
          patchedChunk.slice(0, edgeIdx) + buildShadowEdgeFilterGlsl() + "\n" + patchedChunk.slice(edgeIdx);
        const edgeBrace = patchedChunk.indexOf("{", patchedChunk.indexOf(ANCHOR_GET_SHADOW));
        patchedChunk =
          patchedChunk.slice(0, edgeBrace + 1) + buildShadowEdgeFilterReturn() + patchedChunk.slice(edgeBrace + 1);
      }
    }
  }


  function patchMaterial(mat) {
    if (!supported || !mat || (mat.userData && mat.userData.__rswPcss)) return;
    if (!mat.userData) mat.userData = {};
    mat.userData.__rswPcss = true;
    const prev = mat.onBeforeCompile;
    mat.onBeforeCompile = function (shader, rendererArg) {
      if (typeof prev === "function") prev.call(this, shader, rendererArg);
      shader.uniforms.uRswPcssOn = uniforms.uRswPcssOn;
      shader.uniforms.uRswPcssTan = uniforms.uRswPcssTan;
      shader.uniforms.uRswPcssScale = uniforms.uRswPcssScale;
      shader.uniforms.uRswPcssPtAng = uniforms.uRswPcssPtAng;
      shader.uniforms.uRswPcssFrame = uniforms.uRswPcssFrame;
      shader.uniforms.uRswPcssTemporal = uniforms.uRswPcssTemporal;
      shader.uniforms.uRswPcssTaps = uniforms.uRswPcssTaps;
      shader.uniforms.uRswPcssBlockerTaps = uniforms.uRswPcssBlockerTaps;
      shader.uniforms.uRswPcssPlaneCap = uniforms.uRswPcssPlaneCap;
      shader.uniforms.uRswCsmOn = uniforms.uRswCsmOn;
      shader.uniforms.uRswCsmCount = uniforms.uRswCsmCount;
      shader.uniforms.uRswCsmScale = uniforms.uRswCsmScale;
      shader.uniforms.uRswCsmBlend = uniforms.uRswCsmBlend;

      shader.uniforms.uRswRtOn = uniforms.uRswRtOn;
      shader.uniforms.uRswRtMix = uniforms.uRswRtMix;
      shader.uniforms.uRswRtTex = uniforms.uRswRtTex;
      shader.uniforms.uRswRtInvRes = uniforms.uRswRtInvRes;

      shader.uniforms.uRswSunMaskOn = uniforms.uRswSunMaskOn;
      shader.uniforms.uRswSunMaskTex = uniforms.uRswSunMaskTex;
      shader.uniforms.uRswSunMaskInvRes = uniforms.uRswSunMaskInvRes;

      shader.uniforms.uRswSmLitePen = uniforms.uRswSmLitePen;


      shader.uniforms.uRswSmLiteCH = uniforms.uRswSmLiteCH;


      shader.uniforms.uRswShadowEdgeOn = uniforms.uRswShadowEdgeOn;
      shader.uniforms.uRswShadowEdgeWidth = uniforms.uRswShadowEdgeWidth;


      shader.uniforms.uRswSmrtOn = uniforms.uRswSmrtOn;
      shader.uniforms.uRswSmrtSteps = uniforms.uRswSmrtSteps;


      shader.uniforms.uRswClipOn = uniforms.uRswClipOn;
      shader.uniforms.uRswClipLevels = uniforms.uRswClipLevels;
      shader.uniforms.uRswClipHalf0 = uniforms.uRswClipHalf0;
      shader.uniforms.uRswClipAtlas = uniforms.uRswClipAtlas;
      shader.uniforms.uRswClipTable = uniforms.uRswClipTable;
      shader.uniforms.uRswClipWinA = uniforms.uRswClipWinA;
      shader.uniforms.uRswClipCam = uniforms.uRswClipCam;
      shader.uniforms.uRswClipAtl = uniforms.uRswClipAtl;
      if (shader.fragmentShader.indexOf(ANCHOR_INCLUDE) !== -1) {
        shader.fragmentShader = shader.fragmentShader.replace(ANCHOR_INCLUDE, patchedChunk);
      }
    };
    const prevKey = mat.customProgramCacheKey;
    const gen = patchGen;
    mat.customProgramCacheKey = function () {
      const base = typeof prevKey === "function" ? prevKey.call(this) : "";


      return base + "|rswPcss" + (pointSupported ? "3p" : "2") + (csmSupported ? "m1" : "") + (rtSupported ? "r1" : "") + (maskSupported ? "s1" : "") + (smLiteSupported ? "l2" : "") + (shadowEdgeSupported ? "e20" : "") + (smrtSupported ? "t1" : "") + (clipmapSupported ? "v17" : "") + (signature.samplerType === "sampler2DShadow" ? "c" : "d") + "pt1" + "g" + gen;
    };
    mat.needsUpdate = true;
  }

  function setEnabled(on) {
    uniforms.uRswPcssOn.value = on ? 1 : 0;
  }


  function setSun(args) {
    const a = args || {};
    uniforms.uRswPcssTan.value = sunTanFromSoftness(a.softness, a.boost);
    uniforms.uRswPcssScale.value = depthUvScale(a.near, a.far, a.frustumSize);
    uniforms.uRswPcssPtAng.value = pointAngFromSoftness(a.softness, a.boost);
  }


  let temporalPrevOn = null;
  let temporalPrevExtra = -1;
  let temporalPrevStaticKey = -1;                                              
  function setTemporal(args) {
    const a = args || {};
    const on = !!a.on;
    const f = Number(a.frame);
    uniforms.uRswPcssTemporal.value = on ? 1 : 0;
    uniforms.uRswPcssFrame.value = Number.isFinite(f) && f >= 0 ? Math.floor(f) : 0;


    const bo = Number.isFinite(a.boost) ? Math.min(1, Math.max(0, a.boost)) : 0;
    const bt = Number.isFinite(a.boostTaps) ? Math.min(8, Math.max(0, Math.floor(a.boostTaps))) : 0;
    const extra = on && bo > 0 && bt > 0 ? Math.round(bo * bt) : 0;


    const stTapsRaw = Number.isFinite(Number(a.staticTaps)) ? Number(a.staticTaps) : -1;
    const stBlockRaw = Number.isFinite(Number(a.staticBlockers)) ? Number(a.staticBlockers) : -1;
    const stKey = stTapsRaw * 1000 + stBlockRaw;
    if (on === temporalPrevOn && extra === temporalPrevExtra && stKey === temporalPrevStaticKey) return;
    temporalPrevOn = on;
    temporalPrevExtra = extra;
    temporalPrevStaticKey = stKey;
    const t = on ? clampRuntimeTaps(PCSS_TEMPORAL_TAPS + extra, PCSS_TEMPORAL_BLOCKERS) : clampRuntimeTaps(a.staticTaps, a.staticBlockers);
    uniforms.uRswPcssTaps.value = t.taps;
    uniforms.uRswPcssBlockerTaps.value = t.blockers;
  }


  function setPlaneBiasCap(v) {
    const n = Number(v);
    const cap = Number.isFinite(n) && n > 0
      ? Math.min(PCSS_PLANE_BIAS_CAP_MAX, Math.max(PCSS_PLANE_BIAS_CAP, n))
      : PCSS_PLANE_BIAS_CAP;
    uniforms.uRswPcssPlaneCap.value = cap;
  }

  function bumpGeneration() {
    patchGen += 1;
  }


  function setCsm(args) {
    const a = args || {};
    uniforms.uRswCsmOn.value = a.on && csmSupported ? 1 : 0;
    const n = Number(a.count);
    uniforms.uRswCsmCount.value = Math.max(1, Math.min(4, Number.isFinite(n) ? Math.round(n) : 1));
    const s = Array.isArray(a.scales) ? a.scales : [];
    const fallback = uniforms.uRswPcssScale.value;
    const sane = function (x) {
      const v = Number(x);
      return Number.isFinite(v) && v > 0 ? v : fallback;
    };
    uniforms.uRswCsmScale.value.set(sane(s[0]), sane(s[1]), sane(s[2]), sane(s[3]));
    const b = Number(a.blend);
    uniforms.uRswCsmBlend.value = Number.isFinite(b) ? Math.min(0.15, Math.max(0.02, b)) : CSM_BLEND_FRACTION;
  }


  function setRt(args) {
    const a = args || {};
    uniforms.uRswRtOn.value = (a.on && rtSupported) ? 1 : 0;
    uniforms.uRswRtMix.value = Math.max(0, Math.min(1, Number(a.mix) || 0));
    uniforms.uRswRtTex.value = a.tex || null;
    const iw = Number(a.invW);
    const ih = Number(a.invH);
    uniforms.uRswRtInvRes.value.set(
      Number.isFinite(iw) ? iw : 0,
      Number.isFinite(ih) ? ih : 0
    );
  }


  function setSunMask(args) {
    const a = args || {};
    uniforms.uRswSunMaskOn.value = (a.on && maskSupported) ? 1 : 0;
    uniforms.uRswSunMaskTex.value = a.tex || null;
    const iw = Number(a.invW);
    const ih = Number(a.invH);
    uniforms.uRswSunMaskInvRes.value.set(
      Number.isFinite(iw) ? iw : 0,
      Number.isFinite(ih) ? ih : 0
    );
  }


  function setSmLiteSoftness(softness) {
    uniforms.uRswSmLitePen.value = smLitePenumbraTexels(softness);
  }


  function setSmLiteContact(on) {
    uniforms.uRswSmLiteCH.value = on === true ? 1 : 0;
  }


  function setShadowEdge(args) {
    const options = args || {};
    const on = options.on === true && shadowEdgeSupported;
    uniforms.uRswShadowEdgeOn.value = on ? 1 : 0;
    if (!on) return;
    uniforms.uRswShadowEdgeWidth.value = shadowEdgeWidthTexels(options.softness);
  }


  function setSmrt(args) {
    const a = args || {};
    uniforms.uRswSmrtOn.value = a.on && smrtSupported ? 1 : 0;
    const s = Number(a.steps);
    uniforms.uRswSmrtSteps.value = Number.isFinite(s)
      ? Math.min(SMRT_STEPS_MAX, Math.max(SMRT_STEPS_MIN, Math.round(s)))
      : SMRT_STEPS_MIN;
  }


  function setClipmap(args) {
    const a = args || {};
    const on = a.on === true && clipmapSupported;
    uniforms.uRswClipOn.value = on ? 1 : 0;
    if (!on) return;
    const nz = (v, d) => {
      const n = Number(v);
      return Number.isFinite(n) ? n : d;
    };
    uniforms.uRswClipLevels.value = Math.max(1, Math.round(nz(a.levels, 8)));
    const h0 = nz(a.half0, 8);
    uniforms.uRswClipHalf0.value = h0 > 0 ? h0 : 8;
    uniforms.uRswClipAtlas.value = a.atlas || null;
    uniforms.uRswClipTable.value = a.table || null;
    uniforms.uRswClipWinA.value.set(nz(a.winCU, 0), nz(a.winCV, 0), nz(a.winHX, 0), nz(a.winHY, 0));
    uniforms.uRswClipCam.value.set(nz(a.camU, 0), nz(a.camV, 0), nz(a.pw0, 0.5), nz(a.grid, 32));
    uniforms.uRswClipAtl.value.set(nz(a.invAtlas, 0), nz(a.pagePx, 128), nz(a.blend, 0.1), 0);
  }

  return { supported, pointSupported, csmSupported, rtSupported, maskSupported, smLiteSupported, shadowEdgeSupported, smrtSupported, clipmapSupported, patchMaterial, setEnabled, setSun, setTemporal, setPlaneBiasCap, setCsm, setRt, setSunMask, setSmLiteSoftness, setSmLiteContact, setSmrt, setClipmap, setShadowEdge, uniforms, bumpGeneration };
}
