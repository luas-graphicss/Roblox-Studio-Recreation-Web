import {
  BYTE_HISTORY_RANGE,
  MAX_HISTORY_FRAMES,
  blendAlpha,
} from "../lighting/shadowDenoiseCore.js";


import { buildTemporalVelocityGlsl } from "../lighting/motionVectorsCore.js";

const VERT = [
  "varying vec2 vUv;",
  "void main() {",
  "  vUv = uv;",
  "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
  "}",
].join("\n");

export function createShadowDenoisePass({ THREE, camera, FullScreenQuad, sharedDepth, getMotionVectors }) {


  if (!sharedDepth) throw new Error("createShadowDenoisePass: sharedDepth é obrigatório");
  const quad = new FullScreenQuad(null);
  const accumMat = new THREE.ShaderMaterial({
    uniforms: {
      tCurrent: { value: null },
      tHistory: { value: null },
      tDepth: { value: null },
      uInvViewProj: { value: new THREE.Matrix4() },
      uPrevViewProj: { value: new THREE.Matrix4() },
      uTexel: { value: new THREE.Vector2(1 / 1024, 1 / 1024) },
      uAlpha: { value: 1 },
      uHistoryValid: { value: 0 },

      uByteEnc: { value: 0 },
      uByteRange: { value: BYTE_HISTORY_RANGE },


      tVelocity: { value: null },
      uMvOn: { value: 0 },
      uTemporalAlpha: { value: 0 },
    },
    vertexShader: VERT,
    fragmentShader: buildTemporalVelocityGlsl(),
    depthTest: false,
    depthWrite: false,
  });
  const copyMat = new THREE.ShaderMaterial({


    uniforms: {
      tDiffuse: { value: null },
      uByteEnc: { value: 0 },
      uByteRange: { value: BYTE_HISTORY_RANGE },
    },
    vertexShader: VERT,
    fragmentShader: [
      "uniform sampler2D tDiffuse;",
      "uniform float uByteEnc;",
      "uniform float uByteRange;",
      "varying vec2 vUv;",
      "void main() {",
      "  vec4 c = texture2D(tDiffuse, vUv);",
      "  gl_FragColor = vec4(mix(c.rgb, c.rgb * c.rgb * uByteRange, uByteEnc), c.a);",
      "}",
    ].join("\n"),
    depthTest: false,
    depthWrite: false,
  });
  const curVP = new THREE.Matrix4();
  const prevVP = new THREE.Matrix4();
  const invVP = new THREE.Matrix4();

  let histA = null;                   
  let histB = null;                                 
  let allocW = 0;
  let allocH = 0;
  let frames = 0;                                          
  let historyValid = false;
  let lastResetCount = null;
  let halfDepth = false;                                                   


  let byteHistory = false;


  let mvOn = false;

  function makeRT(w, h) {
    return new THREE.WebGLRenderTarget(Math.max(1, w | 0), Math.max(1, h | 0), {
      type: byteHistory ? THREE.UnsignedByteType : THREE.HalfFloatType,
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
  }

  function release() {
    if (histA) histA.dispose();
    if (histB) histB.dispose();
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
    release();
    allocW = w;
    allocH = h;
    histA = makeRT(w, h);
    histB = makeRT(w, h);
    reset();
  }

  function blit(r, material, target) {
    quad.material = material;
    r.setRenderTarget(target);
    quad.render(r);
  }

  const pass = {
    enabled: false,
    needsSwap: true,
    clear: false,
    renderToScreen: false,
    setSize() {

    },


    applyState(state) {
      const s = state || {};
      const active = !!s.active;

      mvOn = !!s.mvOn;


      halfDepth = !!s.halfDepth;


      const byteWanted = !!s.byteHistory;
      if (byteWanted !== byteHistory) {
        byteHistory = byteWanted;
        if (histA) release();                                          
      }
      if (s.resetCount !== undefined && s.resetCount !== lastResetCount) {
        if (lastResetCount !== null) reset();                                 
        lastResetCount = s.resetCount;
      }
      if (active && !pass.enabled) reset();                                
      pass.enabled = active;
      if (!active) {
        historyValid = false;


        if (histA) release();
      }
    },
    isConverged() {
      return !pass.enabled || frames >= MAX_HISTORY_FRAMES;
    },
    debugState() {
      return { enabled: pass.enabled, frames, historyValid, alpha: blendAlpha(frames), mvOn };
    },
    render(r, writeBuffer, readBuffer) {
      const pw = Math.max(1, readBuffer.width | 0);
      const ph = Math.max(1, readBuffer.height | 0);
      ensure(pw, ph);


      const depthTex = halfDepth
        ? sharedDepth.acquire(r, Math.max(1, pw >> 1), Math.max(1, ph >> 1))
        : sharedDepth.acquire(r, pw, ph);

      curVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      invVP.copy(curVP).invert();
      const u = accumMat.uniforms;
      u.tCurrent.value = readBuffer.texture;
      u.tHistory.value = histA.texture;
      u.tDepth.value = depthTex;
      u.uInvViewProj.value.copy(invVP);
      u.uPrevViewProj.value.copy(historyValid ? prevVP : curVP);
      u.uTexel.value.set(1 / pw, 1 / ph);
      u.uAlpha.value = blendAlpha(frames);
      u.uHistoryValid.value = historyValid ? 1 : 0;


      u.uByteEnc.value = byteHistory ? 1 : 0;
      copyMat.uniforms.uByteEnc.value = byteHistory ? 1 : 0;


      const mvTex = (mvOn && getMotionVectors ? getMotionVectors() : null) || null;
      u.tVelocity.value = mvTex;
      u.uMvOn.value = mvTex ? 1 : 0;
      blit(r, accumMat, histB);

      copyMat.uniforms.tDiffuse.value = histB.texture;
      blit(r, copyMat, this.renderToScreen ? null : writeBuffer);
      const swap = histA;
      histA = histB;
      histB = swap;
      prevVP.copy(curVP);
      frames = Math.min(frames + 1, MAX_HISTORY_FRAMES);
      historyValid = true;
    },
    dispose() {
      release();
      accumMat.dispose();
      copyMat.dispose();
      quad.dispose();
    },
  };
  return pass;
}
