import {
  DEFAULT_DEPTH_TOL,
  MAX_HISTORY_FRAMES,
  blendAlpha,
  buildReconstructGlsl,
  buildUpsampleGlsl,
  validateScale,
} from "../lighting/reconstructCore.js";

const VERT = [
  "varying vec2 vUv;",
  "void main() {",
  "  vUv = uv;",
  "  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);",
  "}",
].join("\n");


const IDLE_RELEASE_FRAMES = 60;

function num(v, def) {
  const n = Number(v);
  return Number.isFinite(n) ? n : def;
}

export function createMaskReconstruct({ THREE, camera, FullScreenQuad, sharedDepth }) {
  if (!THREE || !camera || !FullScreenQuad) {
    throw new Error("createMaskReconstruct: THREE, camera e FullScreenQuad sao obrigatorios");
  }
  if (!sharedDepth) {
    throw new Error("createMaskReconstruct: sharedDepth e obrigatorio (provedor unico de depth, Parte 162)");
  }
  const quad = new FullScreenQuad(null);
  const reconMat = new THREE.ShaderMaterial({
    uniforms: {
      tCurrent: { value: null },
      tHistory: { value: null },
      tDepth: { value: null },
      tPrevDepth: { value: null },
      uInvViewProj: { value: new THREE.Matrix4() },
      uPrevViewProj: { value: new THREE.Matrix4() },
      uTexel: { value: new THREE.Vector2(1 / 256, 1 / 256) },
      uAlpha: { value: 1 },
      uHistoryValid: { value: 0 },
      uDepthTol: { value: DEFAULT_DEPTH_TOL },
    },
    vertexShader: VERT,
    fragmentShader: buildReconstructGlsl(),
    depthTest: false,
    depthWrite: false,
  });
  const upMat = new THREE.ShaderMaterial({
    uniforms: {
      tMask: { value: null },
      tDepth: { value: null },
      uTexelLow: { value: new THREE.Vector2(1 / 256, 1 / 256) },
      uDepthTol: { value: DEFAULT_DEPTH_TOL },
    },
    vertexShader: VERT,
    fragmentShader: buildUpsampleGlsl(),
    depthTest: false,
    depthWrite: false,
  });
  const depthCopyMat = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: VERT,
    fragmentShader: [
      "uniform sampler2D tDiffuse;",
      "varying vec2 vUv;",
      "void main() {",
      "  gl_FragColor = texture2D(tDiffuse, vUv);",
      "}",
    ].join("\n"),
    depthTest: false,
    depthWrite: false,
  });
  const curVP = new THREE.Matrix4();
  const invVP = new THREE.Matrix4();
  let frameId = 0;
  const slots = new Map();

  function makeMaskRT(w, h) {


    return new THREE.WebGLRenderTarget(Math.max(1, w | 0), Math.max(1, h | 0), {
      minFilter: THREE.LinearFilter,
      magFilter: THREE.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
  }

  function makeDepthRT(w, h) {

    return new THREE.WebGLRenderTarget(Math.max(1, w | 0), Math.max(1, h | 0), {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
  }

  function resetSlot(s) {
    s.frames = 0;
    s.historyValid = false;
  }

  function releaseTargets(s) {
    if (s.histA) s.histA.dispose();
    if (s.histB) s.histB.dispose();
    if (s.depthA) s.depthA.dispose();
    if (s.depthB) s.depthB.dispose();
    if (s.outRT) s.outRT.dispose();
    s.histA = null;
    s.histB = null;
    s.depthA = null;
    s.depthB = null;
    s.outRT = null;
    s.lowW = 0;
    s.lowH = 0;
    s.fullW = 0;
    s.fullH = 0;
    resetSlot(s);
  }

  function getSlot(name) {
    let s = slots.get(name);
    if (!s) {
      s = {
        histA: null,
        histB: null,
        depthA: null,
        depthB: null,
        outRT: null,
        lowW: 0,
        lowH: 0,
        fullW: 0,
        fullH: 0,
        frames: 0,
        historyValid: false,
        prevVP: new THREE.Matrix4(),
        lastResetCount: null,
        usedFrameId: frameId,
      };
      slots.set(name, s);
    }
    return s;
  }

  function ensureTargets(s, lowW, lowH, fullW, fullH) {
    if (s.lowW !== lowW || s.lowH !== lowH || !s.histA) {
      if (s.histA) {
        s.histA.dispose();
        s.histB.dispose();
        s.depthA.dispose();
        s.depthB.dispose();
      }
      s.histA = makeMaskRT(lowW, lowH);
      s.histB = makeMaskRT(lowW, lowH);
      s.depthA = makeDepthRT(lowW, lowH);
      s.depthB = makeDepthRT(lowW, lowH);
      s.lowW = lowW;
      s.lowH = lowH;
      resetSlot(s);                                                             
    }
    if (s.fullW !== fullW || s.fullH !== fullH || !s.outRT) {
      if (s.outRT) s.outRT.dispose();
      s.outRT = makeMaskRT(fullW, fullH);
      s.fullW = fullW;
      s.fullH = fullH;
    }
  }


  function beginFrame() {
    frameId += 1;
    for (const s of slots.values()) {
      if (s.histA && frameId - s.usedFrameId > IDLE_RELEASE_FRAMES) {
        releaseTargets(s);
      }
    }
  }

  function blit(renderer, material, target) {
    quad.material = material;
    renderer.setRenderTarget(target);
    quad.render(renderer);
  }


  function run(renderer, opts) {
    const o = opts || {};
    if (!renderer) throw new Error("maskReconstruct.run: renderer obrigatorio");
    if (!o.current) {
      throw new Error("maskReconstruct.run: textura 'current' (mascara low-res do frame) e obrigatoria");
    }
    const fullW = num(o.fullW, 0) | 0;
    const fullH = num(o.fullH, 0) | 0;
    if (fullW < 2 || fullH < 2) throw new Error("maskReconstruct.run: fullW/fullH obrigatorios");
    const scale = validateScale(o.scale);
    const lowW = Math.max(1, Math.round(fullW / scale));
    const lowH = Math.max(1, Math.round(fullH / scale));
    const s = getSlot(String(o.slot || "default"));
    if (o.resetCount !== undefined && o.resetCount !== s.lastResetCount) {
      if (s.lastResetCount !== null) resetSlot(s);                                 
      s.lastResetCount = o.resetCount;
    }
    ensureTargets(s, lowW, lowH, fullW, fullH);
    s.usedFrameId = frameId;
    const tol = Math.max(num(o.depthTolerance, DEFAULT_DEPTH_TOL), 1e-6);
    const savedTarget = renderer.getRenderTarget();
    try {
      const depthTex = sharedDepth.acquire(renderer, fullW, fullH);
      curVP.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      invVP.copy(curVP).invert();
      const u = reconMat.uniforms;
      u.tCurrent.value = o.current;
      u.tHistory.value = s.histA.texture;
      u.tDepth.value = depthTex;
      u.tPrevDepth.value = s.depthA.texture;
      u.uInvViewProj.value.copy(invVP);
      u.uPrevViewProj.value.copy(s.historyValid ? s.prevVP : curVP);
      u.uTexel.value.set(1 / lowW, 1 / lowH);
      u.uAlpha.value = blendAlpha(s.frames);
      u.uHistoryValid.value = s.historyValid ? 1 : 0;
      u.uDepthTol.value = tol;
      blit(renderer, reconMat, s.histB);
      depthCopyMat.uniforms.tDiffuse.value = depthTex;
      blit(renderer, depthCopyMat, s.depthB);
      const uu = upMat.uniforms;
      uu.tMask.value = s.histB.texture;
      uu.tDepth.value = depthTex;
      uu.uTexelLow.value.set(1 / lowW, 1 / lowH);
      uu.uDepthTol.value = tol;
      blit(renderer, upMat, s.outRT);
      let t = s.histA;
      s.histA = s.histB;
      s.histB = t;
      t = s.depthA;
      s.depthA = s.depthB;
      s.depthB = t;
      s.prevVP.copy(curVP);
      s.frames = Math.min(s.frames + 1, MAX_HISTORY_FRAMES);
      s.historyValid = true;
      return {
        texture: s.outRT.texture,
        lowTexture: s.histA.texture,
        lowW,
        lowH,
        scale,
        frames: s.frames,
        converged: s.frames >= MAX_HISTORY_FRAMES,
      };
    } finally {
      renderer.setRenderTarget(savedTarget);
    }
  }

  function reset(name) {
    if (name === undefined) {
      for (const s of slots.values()) resetSlot(s);
      return;
    }
    const s = slots.get(String(name));
    if (s) resetSlot(s);
  }

  function release(name) {
    const s = slots.get(String(name));
    if (s) {
      releaseTargets(s);
      slots.delete(String(name));
    }
  }

  function isConverged(name) {
    const s = slots.get(String(name));
    return !!(s && s.frames >= MAX_HISTORY_FRAMES);
  }

  function debugState() {
    const out = {};
    for (const entry of slots) {
      const name = entry[0];
      const s = entry[1];
      out[name] = {
        frames: s.frames,
        historyValid: s.historyValid,
        allocated: !!s.histA,
        lowW: s.lowW,
        lowH: s.lowH,
        fullW: s.fullW,
        fullH: s.fullH,
        alpha: blendAlpha(s.frames),
      };
    }
    return { slots: out };
  }

  function dispose() {
    for (const s of slots.values()) releaseTargets(s);
    slots.clear();
    reconMat.dispose();
    upMat.dispose();
    depthCopyMat.dispose();
    quad.dispose();
  }

  return { beginFrame, run, reset, release, isConverged, debugState, dispose };
}
