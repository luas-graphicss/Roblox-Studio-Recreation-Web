import {
  BYTE_HISTORY_RANGE,
  MAX_HISTORY_FRAMES,
  blendAlpha,
  buildTemporalGlsl,
} from "../lighting/shadowDenoiseCore.js";
import {
  SUN_MASK_MAX_CASCADES,
  SUN_MASK_PASS_VERT,
  buildSunMaskPassGlsl,
  maskCapK,
  maskDims,
  maskTaps,
} from "../lighting/sunMaskCore.js";
import { createSharedDepth } from "./sharedDepth.js";


const DEPTH_IDLE_FRAMES = 61;

export function createSunShadowMask({ THREE, scene, camera }) {
  if (!THREE || !scene || !camera) {

    throw new Error("createSunShadowMask: THREE, scene e camera são obrigatórios");
  }
  const depth = createSharedDepth({ THREE, scene, camera });


  const quadScene = new THREE.Scene();
  const quadCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
  const quadGeo = new THREE.PlaneGeometry(2, 2);
  const quadMesh = new THREE.Mesh(quadGeo, null);
  quadMesh.frustumCulled = false;
  quadScene.add(quadMesh);

  const maskMat = new THREE.ShaderMaterial({
    uniforms: {
      tDepth: { value: null },
      uInvViewProj: { value: new THREE.Matrix4() },
      uMaskMap0: { value: null },
      uMaskMap1: { value: null },
      uMaskMap2: { value: null },
      uMaskMap3: { value: null },
      uMaskMtx0: { value: new THREE.Matrix4() },
      uMaskMtx1: { value: new THREE.Matrix4() },
      uMaskMtx2: { value: new THREE.Matrix4() },
      uMaskMtx3: { value: new THREE.Matrix4() },
      uMaskCount: { value: 1 },
      uMaskBlend: { value: 0.08 },
      uMaskScale: { value: new THREE.Vector4(1, 1, 1, 1) },
      uMaskCapK: { value: new THREE.Vector4(1, 1, 1, 1) },
      uMaskBias: { value: new THREE.Vector4(0, 0, 0, 0) },
      uMaskTexel: { value: new THREE.Vector4(1 / 2048, 1 / 2048, 1 / 2048, 1 / 2048) },
      uMaskTan: { value: 0.02 },
      uMaskFrame: { value: 0 },
      uMaskTaps: { value: maskTaps().taps },
      uMaskBlockers: { value: maskTaps().blockers },
    },
    vertexShader: SUN_MASK_PASS_VERT,
    fragmentShader: buildSunMaskPassGlsl(),
    depthTest: false,
    depthWrite: false,
  });

  const accumMat = new THREE.ShaderMaterial({
    uniforms: {
      tCurrent: { value: null },
      tHistory: { value: null },
      tDepth: { value: null },
      uInvViewProj: { value: new THREE.Matrix4() },
      uPrevViewProj: { value: new THREE.Matrix4() },
      uTexel: { value: new THREE.Vector2(1 / 512, 1 / 512) },
      uAlpha: { value: 1 },
      uHistoryValid: { value: 0 },


      uByteEnc: { value: 0 },
      uByteRange: { value: BYTE_HISTORY_RANGE },
    },
    vertexShader: SUN_MASK_PASS_VERT,
    fragmentShader: buildTemporalGlsl(),
    depthTest: false,
    depthWrite: false,
  });

  const curVP = new THREE.Matrix4();
  const prevVP = new THREE.Matrix4();
  const invVP = new THREE.Matrix4();


  const maskMapUniforms = [
    maskMat.uniforms.uMaskMap0,
    maskMat.uniforms.uMaskMap1,
    maskMat.uniforms.uMaskMap2,
    maskMat.uniforms.uMaskMap3,
  ];
  const maskMtxUniforms = [
    maskMat.uniforms.uMaskMtx0,
    maskMat.uniforms.uMaskMtx1,
    maskMat.uniforms.uMaskMtx2,
    maskMat.uniforms.uMaskMtx3,
  ];
  const cfgScales = [];
  const cfgBiasArr = [0, 0, 0, 0];
  const cfgTexelArr = [1 / 2048, 1 / 2048, 1 / 2048, 1 / 2048];

  let maskRT = null;                                       
  let histA = null;                                           
  let histB = null;                    
  let allocW = 0;
  let allocH = 0;
  let frames = 0;
  let historyValid = false;
  let lastResetCount = null;
  let curTaps = maskTaps();
  let active = false;


  const capsScratch = [1, 1, 1, 1];
  const tapsScratch = { taps: curTaps.taps, blockers: curTaps.blockers };
  const dimsScratch = { w: 8, h: 8 };

  function makeRT(w, h) {


    return new THREE.WebGLRenderTarget(Math.max(1, w | 0), Math.max(1, h | 0), {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
  }

  function releaseTargets() {
    if (maskRT) maskRT.dispose();
    if (histA) histA.dispose();
    if (histB) histB.dispose();
    maskRT = null;
    histA = null;
    histB = null;
    allocW = 0;
    allocH = 0;
  }

  function reset() {
    frames = 0;
    historyValid = false;
  }

  function ensure(w, h) {
    if (allocW === w && allocH === h && histA) return;
    releaseTargets();
    allocW = w;
    allocH = h;
    maskRT = makeRT(w, h);
    histA = makeRT(w, h);
    histB = makeRT(w, h);
    reset();
  }

  function blit(renderer, material, target) {
    quadMesh.material = material;
    renderer.setRenderTarget(target);
    renderer.render(quadScene, quadCam);
  }

  function num(v, d) {
    const n = Number(v);
    return Number.isFinite(n) ? n : d;
  }


  function configure(args) {
    const a = args || {};
    const cascades = Array.isArray(a.cascades) ? a.cascades : [];
    const u = maskMat.uniforms;
    u.uMaskBlend.value = num(a.blend, 0.08);
    u.uMaskTan.value = num(a.tan, 0.02);
    const t = maskTaps(a.taps, a.blockers, tapsScratch);
    curTaps = t;
    u.uMaskTaps.value = t.taps;
    u.uMaskBlockers.value = t.blockers;
    u.uMaskFrame.value = Math.floor(num(a.frame, 0));

    const scales = cfgScales;
    scales.length = 0;
    const biasArr = cfgBiasArr;
    biasArr[0] = 0; biasArr[1] = 0; biasArr[2] = 0; biasArr[3] = 0;
    const texelArr = cfgTexelArr;
    texelArr[0] = 1 / 2048; texelArr[1] = 1 / 2048; texelArr[2] = 1 / 2048; texelArr[3] = 1 / 2048;
    const mapUniforms = maskMapUniforms;
    const mtxUniforms = maskMtxUniforms;
    let slots = 0;
    for (let c = 0; c < cascades.length && slots < SUN_MASK_MAX_CASCADES; c++) {
      const cd = cascades[c];
      if (!(cd && cd.light && cd.light.shadow && cd.light.shadow.map)) continue;
      mapUniforms[slots].value = cd.light.shadow.map.texture;

      mtxUniforms[slots].value.copy(cd.light.shadow.matrix);
      scales[slots] = num(cd.scale, 1);
      biasArr[slots] = num(cd.bias, cd.light.shadow.bias || 0);
      const ms = (cd.light.shadow.mapSize ? cd.light.shadow.mapSize.x : 2048);
      texelArr[slots] = num(cd.texel, 1 / ms);
      slots += 1;
    }
    for (let c = slots; c < SUN_MASK_MAX_CASCADES; c++) mapUniforms[c].value = null;
    u.uMaskCount.value = slots;
    const capKBase = num(a.capKBase, scales[0] || 1);
    const caps = maskCapK(scales, capKBase, capsScratch);

    u.uMaskScale.value.set(scales[0] || 1, scales[1] || 1, scales[2] || 1, scales[3] || 1);
    u.uMaskCapK.value.set(caps[0], caps[1], caps[2], caps[3]);
    u.uMaskBias.value.set(biasArr[0], biasArr[1], biasArr[2], biasArr[3]);
    u.uMaskTexel.value.set(texelArr[0], texelArr[1], texelArr[2], texelArr[3]);
  }


  function render(renderer, drawW, drawH, scale) {
    const dims = maskDims(drawW, drawH, dimsScratch, scale);
    const mw = dims.w;
    const mh = dims.h;

    const u = maskMat.uniforms;
    let hasMap = false;
    const mapUniforms = maskMapUniforms;                                          
    const n = Math.round(u.uMaskCount.value);
    for (let c = 0; c < n; c++) {
      if (mapUniforms[c].value) { hasMap = true; break; }
    }
    if (!hasMap) return false;

    ensure(mw, mh);
    depth.beginFrame();
    const depthTex = depth.acquire(renderer, mw, mh);
    const savedTarget = renderer.getRenderTarget();
    try {

      curVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      invVP.copy(curVP).invert();
      u.tDepth.value = depthTex;
      u.uInvViewProj.value.copy(invVP);
      blit(renderer, maskMat, maskRT);


      const au = accumMat.uniforms;
      au.tCurrent.value = maskRT.texture;
      au.tHistory.value = histA.texture;
      au.tDepth.value = depthTex;
      au.uInvViewProj.value.copy(invVP);
      au.uPrevViewProj.value.copy(historyValid ? prevVP : curVP);
      au.uTexel.value.set(1 / mw, 1 / mh);
      au.uAlpha.value = blendAlpha(frames);
      au.uHistoryValid.value = historyValid ? 1 : 0;
      blit(renderer, accumMat, histB);


      const swap = histA;
      histA = histB;
      histB = swap;
      prevVP.copy(curVP);
      frames = Math.min(frames + 1, MAX_HISTORY_FRAMES);
      historyValid = true;
      active = true;
    } finally {
      renderer.setRenderTarget(savedTarget);
    }
    return true;
  }


  function texture() {
    return histA ? histA.texture : null;
  }


  function applyReset(resetCount) {
    if (resetCount !== lastResetCount) {
      if (lastResetCount !== null) reset();
      lastResetCount = resetCount;
    }
  }


  function release() {
    if (active) {
      releaseTargets();
      reset();
      active = false;
      for (let i = 0; i < DEPTH_IDLE_FRAMES; i++) depth.beginFrame();
    }
  }

  function debugState() {
    return {
      active,
      frames,
      historyValid,
      alpha: blendAlpha(frames),
      maskW: allocW,
      maskH: allocH,
      taps: curTaps.taps,
      blockers: curTaps.blockers,
    };
  }

  function dispose() {
    releaseTargets();
    depth.dispose();
    maskMat.dispose();
    accumMat.dispose();
    quadGeo.dispose();
  }

  return { configure, render, texture, applyReset, release, debugState, dispose };
}
