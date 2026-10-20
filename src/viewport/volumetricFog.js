import {
  VOL_FOG_MAX_LIGHTS,
  VOL_FOG_PASS_VERT,
  VOL_FOG_VERSION,
  buildVolFogCompositeGlsl,
  buildVolFogMarchGlsl,
  sanitizeVolFogSettings,
  volFogDims,
} from "../lighting/volumetricFogCore.js";
import {
  BYTE_HISTORY_RANGE,
  MAX_HISTORY_FRAMES,
  blendAlpha,
  buildTemporalGlsl,
  sunResetNeeded,
} from "../lighting/shadowDenoiseCore.js";
import { frameJitter } from "../lighting/skyVisCore.js";


import { createLocalVolumetricPassExtension } from "./llVolumetricLocalPass.js";

function num(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export function createVolumetricFogPass({ THREE, camera, FullScreenQuad, sharedDepth, localLightPatchRegistry }) {
  if (!sharedDepth) throw new Error("createVolumetricFogPass: sharedDepth é obrigatório");
  const quad = new FullScreenQuad(null);
  const settings = sanitizeVolFogSettings();


  const localVolumetric = createLocalVolumetricPassExtension({
    THREE,
    registry: localLightPatchRegistry || null,
  });

  const marchMat = new THREE.ShaderMaterial({
    uniforms: {
      tDepth: { value: null },
      uInvViewProj: { value: new THREE.Matrix4() },
      uCamPos: { value: new THREE.Vector3() },
      uSunDir: { value: new THREE.Vector3(0, 1, 0) },
      uSunColor: { value: new THREE.Vector3(0, 0, 0) },
      uAmbColor: { value: new THREE.Vector3(0, 0, 0) },
      uDensity: { value: settings.density },
      uAniso: { value: settings.aniso },
      uHeightFalloff: { value: settings.heightFalloff },
      uHeightRef: { value: settings.heightRef },
      uSteps: { value: settings.steps },
      uJitter: { value: 0 },
      uMaxDist: { value: settings.maxDist },
      uShadowOn: { value: 0 },
      uMaskMap0: { value: null },
      uMaskMap1: { value: null },
      uMaskMap2: { value: null },
      uMaskMap3: { value: null },
      uMaskMtx0: { value: new THREE.Matrix4() },
      uMaskMtx1: { value: new THREE.Matrix4() },
      uMaskMtx2: { value: new THREE.Matrix4() },
      uMaskMtx3: { value: new THREE.Matrix4() },
      uMaskBias: { value: new THREE.Vector4(0.0015, 0.0015, 0.0015, 0.0015) },
      uMaskCount: { value: 0 },
      uVolLightPosR: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
      uVolLightColI: { value: [new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4(), new THREE.Vector4()] },
      uVolLightCount: { value: 0 },


      ...localVolumetric.uniforms,
    },
    vertexShader: VOL_FOG_PASS_VERT,


    fragmentShader: localVolumetric.fragmentShader || buildVolFogMarchGlsl(),
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
    vertexShader: VOL_FOG_PASS_VERT,
    fragmentShader: buildTemporalGlsl(),
    depthTest: false,
    depthWrite: false,
  });

  const compMat = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      tFog: { value: null },
      tFogRaw: { value: null },
    },
    vertexShader: VOL_FOG_PASS_VERT,
    fragmentShader: buildVolFogCompositeGlsl(),
    depthTest: false,
    depthWrite: false,
  });


  const maskMapUniforms = [
    marchMat.uniforms.uMaskMap0,
    marchMat.uniforms.uMaskMap1,
    marchMat.uniforms.uMaskMap2,
    marchMat.uniforms.uMaskMap3,
  ];
  const maskMtxUniforms = [
    marchMat.uniforms.uMaskMtx0,
    marchMat.uniforms.uMaskMtx1,
    marchMat.uniforms.uMaskMtx2,
    marchMat.uniforms.uMaskMtx3,
  ];

  let marchRT = null;                                                         
  let histA = null;                             
  let histB = null;                    
  let allocW = 0;
  let allocH = 0;
  let frames = 0;
  let historyValid = false;
  let lastResetCount = null;
  let prevVPValid = false;
  const curVP = new THREE.Matrix4();
  const invVP = new THREE.Matrix4();
  const prevVP = new THREE.Matrix4();
  const prevSun = new THREE.Vector3(0, 1, 0);
  let prevSunValid = false;
  let state = null;
  const dimsScratch = { w: 8, h: 8 };
  const settingsScratch = {};

  function makeRT(w, h) {


    return new THREE.WebGLRenderTarget(Math.max(1, w | 0), Math.max(1, h | 0), {
      type: THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
  }

  function releaseTargets() {
    if (marchRT) marchRT.dispose();
    if (histA) histA.dispose();
    if (histB) histB.dispose();
    marchRT = null;
    histA = null;
    histB = null;
    allocW = 0;
    allocH = 0;
  }

  function resetHistory() {
    frames = 0;
    historyValid = false;
  }

  const pass = {
    enabled: false,
    needsSwap: true,
    clear: false,
    renderToScreen: false,
    setSize() {

    },


    applyState(st) {
      const s = st || null;
      const persp = !!camera && camera.projectionMatrix.elements[15] === 0;
      if (!s || !s.active || !persp) {
        pass.enabled = false;
        state = null;
        return;
      }
      if (!pass.enabled) {


        resetHistory();
        prevVPValid = false;
        prevSunValid = false;
      }

      if (s.resetCount !== lastResetCount) {
        lastResetCount = s.resetCount;
        resetHistory();
      }


      const sx = num(s.sunX, 0);
      const sy = num(s.sunY, 1);
      const sz = num(s.sunZ, 0);
      if (prevSunValid && sunResetNeeded(prevSun.x * sx + prevSun.y * sy + prevSun.z * sz)) {
        resetHistory();
      }
      prevSun.set(sx, sy, sz);
      prevSunValid = true;
      state = s;
      pass.enabled = true;
    },


    getLocalVolumetricExtension() {
      return localVolumetric;
    },
    debugState() {
      return {
        enabled: pass.enabled,
        frames,
        historyValid,
        w: allocW,
        h: allocH,
        version: VOL_FOG_VERSION,

        localVolumetric: localVolumetric.status({
          tier: state ? state.tier : null,
          technology: state ? state.technology : null,
        }),
      };
    },
    render(r, writeBuffer, readBuffer) {
      const st = state;
      if (!st) return;                                                     
      const pw = Math.max(1, readBuffer.width | 0);
      const ph = Math.max(1, readBuffer.height | 0);
      const depthTex = sharedDepth.acquire(r, pw, ph);
      const dims = volFogDims(pw, ph, dimsScratch);
      if (allocW !== dims.w || allocH !== dims.h || !histA) {
        releaseTargets();
        allocW = dims.w;
        allocH = dims.h;
        marchRT = makeRT(dims.w, dims.h);
        histA = makeRT(dims.w, dims.h);
        histB = makeRT(dims.w, dims.h);
        resetHistory();
      }
      curVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      invVP.copy(curVP).invert();


      const s = sanitizeVolFogSettings(st, settingsScratch);
      const mu = marchMat.uniforms;
      mu.tDepth.value = depthTex;
      mu.uInvViewProj.value.copy(invVP);
      mu.uCamPos.value.set(num(st.camX, 0), num(st.camY, 0), num(st.camZ, 0));
      const sl = Math.sqrt(prevSun.x * prevSun.x + prevSun.y * prevSun.y + prevSun.z * prevSun.z);
      if (sl > 1e-6) {
        mu.uSunDir.value.set(prevSun.x / sl, prevSun.y / sl, prevSun.z / sl);
      } else {
        mu.uSunDir.value.set(0, 1, 0);
      }
      mu.uSunColor.value.set(Math.max(num(st.sunR, 0), 0), Math.max(num(st.sunG, 0), 0), Math.max(num(st.sunB, 0), 0));


      mu.uAmbColor.value.set(Math.max(num(st.ambR, 0), 0), Math.max(num(st.ambG, 0), 0), Math.max(num(st.ambB, 0), 0));
      mu.uDensity.value = s.density;
      mu.uAniso.value = s.aniso;
      mu.uHeightFalloff.value = s.heightFalloff;
      mu.uHeightRef.value = s.heightRef;
      mu.uSteps.value = s.steps;
      mu.uMaxDist.value = s.maxDist;
      mu.uJitter.value = frameJitter(num(st.frame, 0));
      const cascades = Array.isArray(st.cascades) ? st.cascades : [];
      let mc = 0;
      for (let i = 0; i < 4; i++) {
        const c = i < cascades.length ? cascades[i] : null;
        if (c && c.map && c.matrix) {
          maskMapUniforms[i].value = c.map;
          maskMtxUniforms[i].value.copy(c.matrix);
          if (i === 0) mu.uMaskBias.value.x = num(c.bias, 0.0015);
          if (i === 1) mu.uMaskBias.value.y = num(c.bias, 0.0015);
          if (i === 2) mu.uMaskBias.value.z = num(c.bias, 0.0015);
          if (i === 3) mu.uMaskBias.value.w = num(c.bias, 0.0015);
          mc = i + 1;
        } else {
          maskMapUniforms[i].value = null;
        }
      }
      mu.uMaskCount.value = mc;
      mu.uShadowOn.value = st.shadowsOn !== false && mc > 0 ? 1 : 0;
      const lights = Array.isArray(st.lights) ? st.lights : [];
      let lc = 0;
      for (let i = 0; i < VOL_FOG_MAX_LIGHTS; i++) {
        const posR = mu.uVolLightPosR.value[i];
        const colI = mu.uVolLightColI.value[i];
        const L = i < lights.length ? lights[i] : null;
        if (L) {
          posR.set(num(L.x, 0), num(L.y, 0), num(L.z, 0), num(L.range, 0) > 0 ? num(L.range, 0) : 60);
          colI.set(Math.max(num(L.r, 0), 0), Math.max(num(L.g, 0), 0), Math.max(num(L.b, 0), 0), Math.max(num(L.intensity, 0), 0));
          lc = i + 1;
        } else {
          posR.set(0, 0, 0, 0);
          colI.set(0, 0, 0, 0);
        }
      }


      localVolumetric.syncFrame({
        plan: st.localVolumetric,
        camera,
        tier: st.tier,
        technology: st.technology,
      });
      mu.uVolLightCount.value = lc;
      quad.material = marchMat;
      r.setRenderTarget(marchRT);
      quad.render(r);


      const au = accumMat.uniforms;
      au.tCurrent.value = marchRT.texture;
      au.tHistory.value = histA.texture;
      au.tDepth.value = depthTex;
      au.uInvViewProj.value.copy(invVP);
      au.uPrevViewProj.value.copy(prevVPValid ? prevVP : curVP);
      au.uTexel.value.set(1 / dims.w, 1 / dims.h);
      au.uAlpha.value = historyValid ? blendAlpha(frames) : 1;
      au.uHistoryValid.value = historyValid ? 1 : 0;
      quad.material = accumMat;
      r.setRenderTarget(histB);
      quad.render(r);
      const swapRT = histA;
      histA = histB;
      histB = swapRT;
      frames = Math.min(frames + 1, MAX_HISTORY_FRAMES);
      historyValid = true;
      prevVP.copy(curVP);
      prevVPValid = true;


      const cu = compMat.uniforms;
      cu.tDiffuse.value = readBuffer.texture;
      cu.tFog.value = histA.texture;                                   
      cu.tFogRaw.value = marchRT.texture;                                   
      quad.material = compMat;
      r.setRenderTarget(this.renderToScreen ? null : writeBuffer);
      quad.render(r);
    },
    dispose() {
      releaseTargets();
      marchMat.dispose();
      accumMat.dispose();
      compMat.dispose();
      quad.dispose();
    },
  };
  return pass;
}
