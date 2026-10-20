import {
  BYTE_HISTORY_RANGE,
  MAX_HISTORY_FRAMES,
  blendAlpha,
} from "../lighting/shadowDenoiseCore.js";
import { frameJitter } from "../lighting/skyVisCore.js";
import {
  SSR_F0,
  SSR_MIP_MAX,
  SSR_PASS_VERT,
  SSR_VERSION,
  buildSsrCompositeGlsl,
  buildSsrMarchGlsl,
  buildSsrTemporalGlsl,
  sanitizeSsrSettings,
  ssrDims,
} from "../lighting/ssrCore.js";

import { reflectionStackGlslChunk } from "../lighting/reflectionStackCore.js";


export const ssrStackShare = {
  uRswStkSsr: { value: null },
  uRswStkSsrOn: { value: 0 },
  uRswStkTexel: { value: { x: 0, y: 0 } },


  counts: { planar: 0, ssr: 0, probe: 0, sky: 0, total: 0, frame: -1, at: -Infinity },
};

function ssrNowMs() {
  return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
}


const COUNT_W = 96;
const COUNT_H = 54;
const COUNT_INTERVAL = 8;

export function createSsrPass({ THREE, camera, FullScreenQuad, sharedDepth }) {
  if (!sharedDepth) throw new Error("createSsrPass: sharedDepth é obrigatório");
  const quad = new FullScreenQuad(null);
  const settings = sanitizeSsrSettings(null);
  const dims = { w: 0, h: 0 };


  const copyMat = new THREE.ShaderMaterial({
    uniforms: { tDiffuse: { value: null } },
    vertexShader: SSR_PASS_VERT,
    fragmentShader: [
      "uniform sampler2D tDiffuse;",
      "varying vec2 vUv;",
      "void main() { gl_FragColor = texture2D(tDiffuse, vUv); }",
    ].join("\n"),
    depthTest: false,
    depthWrite: false,
  });

  const marchMat = new THREE.ShaderMaterial({
    uniforms: {
      tDepth: { value: null },
      tScene: { value: null },
      uProj: { value: new THREE.Matrix4() },
      uInvProj: { value: new THREE.Matrix4() },
      uDepthP: { value: new THREE.Vector2(-1, -0.2) },
      uTexel: { value: new THREE.Vector2(1, 1) },
      uSteps: { value: settings.steps },
      uThickness: { value: settings.thickness },
      uMaxDist: { value: settings.maxDist },
      uJitter: { value: 0 },
      uRough: { value: settings.rough },



      uRoughPx: { value: 0 },
      uMaxRough: { value: settings.maxRough },
      uMipMax: { value: SSR_MIP_MAX },
      uEdgeMargin: { value: settings.edgeMargin },
      uBackSoft: { value: settings.backSoft },
      uF0: { value: SSR_F0 },
    },
    vertexShader: SSR_PASS_VERT,
    fragmentShader: buildSsrMarchGlsl(),
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
      uTexel: { value: new THREE.Vector2(1, 1) },
      uAlpha: { value: 1 },
      uHistoryValid: { value: 0 },
      uByteEnc: { value: 0 },
      uByteRange: { value: BYTE_HISTORY_RANGE },
    },
    vertexShader: SSR_PASS_VERT,
    fragmentShader: buildSsrTemporalGlsl(),
    depthTest: false,
    depthWrite: false,
  });

  const compMat = new THREE.ShaderMaterial({
    uniforms: {
      tDiffuse: { value: null },
      tSsr: { value: null },
      uIntensity: { value: settings.intensity },
    },
    vertexShader: SSR_PASS_VERT,
    fragmentShader: buildSsrCompositeGlsl(),
    depthTest: false,
    depthWrite: false,
  });






  const countMat = new THREE.ShaderMaterial({
    uniforms: {
      tDepth: { value: null },
      tSsr: { value: null },
      uInvViewProj: { value: new THREE.Matrix4() },
      uSsrOn: { value: 0 },
      uPlanarOn: { value: 0 },
      uPlanarP: { value: new THREE.Vector3() },
      uPlanarN: { value: new THREE.Vector3(0, 1, 0) },
      uProbeOn: { value: 0 },
      uProbeBlend: { value: 1 },
      uBoxMin: { value: new THREE.Vector3(-1, -1, -1) },
      uBoxMax: { value: new THREE.Vector3(1, 1, 1) },
      uFeather: { value: 0.15 },
    },
    vertexShader: SSR_PASS_VERT,
    fragmentShader: [
      "uniform sampler2D tDepth;",
      "uniform sampler2D tSsr;",
      "uniform mat4 uInvViewProj;",
      "uniform float uSsrOn;",
      "uniform float uPlanarOn;",
      "uniform vec3 uPlanarP;",
      "uniform vec3 uPlanarN;",
      "uniform float uProbeOn;",
      "uniform float uProbeBlend;",
      "uniform vec3 uBoxMin;",
      "uniform vec3 uBoxMax;",
      "uniform float uFeather;",
      "varying vec2 vUv;",

      "float rswCntUnpack(const in vec4 v) {",
      "  const vec4 f = vec4(255.0 / (256.0 * 16777216.0), 255.0 / (256.0 * 65536.0), 255.0 / (256.0 * 256.0), 255.0 / 256.0);",
      "  return dot(v, f);",
      "}",
      reflectionStackGlslChunk(),
      "void main() {",
      "  float d = rswCntUnpack(texture2D(tDepth, vUv));",
      "  float skyPix = step(0.9999, d);",
      "  vec4 ndc = vec4(vUv * 2.0 - 1.0, d * 2.0 - 1.0, 1.0);",
      "  vec4 wp4 = uInvViewProj * ndc;",
      "  float wpw = abs(wp4.w) < 1e-8 ? 1e-8 : wp4.w;",
      "  vec3 wp = wp4.xyz / wpw;",

      "  float planarA = 0.0;",
      "  if (uPlanarOn > 0.5) {",
      "    float distPl = abs(dot(wp - uPlanarP, uPlanarN));",
      "    planarA = 1.0 - smoothstep(0.35, 0.75, distPl);",
      "  }",

      "  float probeA = 0.0;",
      "  if (uProbeOn > 0.5) {",
      "    vec3 pc = (uBoxMin + uBoxMax) * 0.5;",
      "    vec3 ph = max((uBoxMax - uBoxMin) * 0.5, vec3(1e-5));",
      "    vec3 pq = abs(wp - pc) / ph;",
      "    float dn = max(max(pq.x, pq.y), pq.z);",
      "    float f = clamp(uFeather, 0.01, 0.5);",
      "    float t = clamp((1.0 - dn) / f, 0.0, 1.0);",
      "    float s = t * t * (3.0 - 2.0 * t);",


      "    probeA = (dn >= 1.0 ? 0.0 : (dn <= 1.0 - f ? 1.0 : s)) * clamp(uProbeBlend, 0.0, 1.0);",
      "  }",
      "  float ssrA = clamp(texture2D(tSsr, vUv).a, 0.0, 1.0) * clamp(uSsrOn, 0.0, 1.0);",
      "  float live = 1.0 - skyPix;",
      "  vec4 w = rswReflStackWeights(planarA * live, ssrA * live, probeA * live, 1.0);",
      "  float bestW = 0.0;",
      "  float bestId = 0.0;",
      "  if (w.x > bestW) { bestW = w.x; bestId = 3.0; }",
      "  if (w.y > bestW) { bestW = w.y; bestId = 2.0; }",
      "  if (w.z > bestW) { bestW = w.z; bestId = 1.0; }",


      "  if (w.w > bestW) { bestW = w.w; bestId = 0.0; }",
      "  gl_FragColor = vec4(bestId / 3.0, bestW, 0.0, 1.0);",
      "}",
    ].join("\n"),
    depthTest: false,
    depthWrite: false,
  });


  let stackMode = false;
  const stk = {
    planarOn: 0, px: 0, py: 0, pz: 0, nx: 0, ny: 1, nz: 0,
    probeOn: 0, probeBlend: 1, minX: 0, minY: 0, minZ: 0, maxX: 0, maxY: 0, maxZ: 0,
    feather: 0.15,
  };
  let countRT = null;
  let countBuf = null;
  let countTick = 0;

  let sceneRT = null;                                 
  let marchRT = null;                                                  
  let histA = null;                                
  let histB = null;
  let histRead = null;
  let histWrite = null;
  let historyValid = false;
  let frames = 0;
  let frame = 0;


  let jitterTick = 0;
  let lastResetCount = -1;
  const viewProj = new THREE.Matrix4();
  const prevViewProj = new THREE.Matrix4();
  let prevValid = false;

  function makeRT(THREE_, w, h, mips) {
    const rt = new THREE_.WebGLRenderTarget(w, h, {
      type: THREE_.HalfFloatType,
      minFilter: mips ? THREE_.LinearMipmapLinearFilter : THREE_.LinearFilter,
      magFilter: THREE_.LinearFilter,
      depthBuffer: false,
      stencilBuffer: false,
    });
    rt.texture.generateMipmaps = !!mips;
    return rt;
  }

  function disposeTargets() {
    if (sceneRT) { sceneRT.dispose(); sceneRT = null; }
    if (marchRT) { marchRT.dispose(); marchRT = null; }
    if (histA) { histA.dispose(); histA = null; }
    if (histB) { histB.dispose(); histB = null; }
    histRead = null;
    histWrite = null;
    historyValid = false;
    frames = 0;
    prevValid = false;
  }

  function resetHistory() {
    historyValid = false;
    frames = 0;
    prevValid = false;
  }

  function ensureTargets(r, pw, ph) {
    ssrDims(pw, ph, dims);
    if (sceneRT && sceneRT.width === dims.w && sceneRT.height === dims.h) return;
    disposeTargets();
    const mips = !!(r && r.capabilities && r.capabilities.isWebGL2);
    sceneRT = makeRT(THREE, dims.w, dims.h, mips);
    marchRT = makeRT(THREE, dims.w, dims.h, false);
    histA = makeRT(THREE, dims.w, dims.h, false);
    histB = makeRT(THREE, dims.w, dims.h, false);
    histRead = histA;
    histWrite = histB;
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
      const persp = !!camera && camera.projectionMatrix.elements[15] === 0;
      if (!s.active || !persp) {
        if (pass.enabled) resetHistory();                                  
        pass.enabled = false;


        stackMode = false;
        ssrStackShare.uRswStkSsrOn.value = 0;
        ssrStackShare.uRswStkSsr.value = null;


        ssrStackShare.counts.total = 0;
        ssrStackShare.counts.at = -Infinity;
        return;
      }
      sanitizeSsrSettings(s, settings);
      const rc = Number(s.resetCount) || 0;
      if (rc !== lastResetCount) {
        lastResetCount = rc;
        resetHistory();
      }
      frame = Number(s.frame) || 0;

      stackMode = s.stack === 1;



      if (!stackMode) {
        ssrStackShare.counts.total = 0;
        ssrStackShare.counts.at = -Infinity;
      }
      stk.planarOn = s.stkPlanarOn === 1 ? 1 : 0;
      stk.px = Number(s.stkPlanarPx) || 0;
      stk.py = Number(s.stkPlanarPy) || 0;
      stk.pz = Number(s.stkPlanarPz) || 0;
      stk.nx = Number(s.stkPlanarNx) || 0;
      stk.ny = Number(s.stkPlanarNy) || 0;
      stk.nz = Number(s.stkPlanarNz) || 0;
      stk.probeOn = s.stkProbeOn === 1 ? 1 : 0;


      const rswPb = Number(s.stkProbeBlend);
      stk.probeBlend = Number.isFinite(rswPb) ? Math.max(0, Math.min(1, rswPb)) : stk.probeOn;
      stk.minX = Number(s.stkBoxMinX) || 0;
      stk.minY = Number(s.stkBoxMinY) || 0;
      stk.minZ = Number(s.stkBoxMinZ) || 0;
      stk.maxX = Number(s.stkBoxMaxX) || 0;
      stk.maxY = Number(s.stkBoxMaxY) || 0;
      stk.maxZ = Number(s.stkBoxMaxZ) || 0;
      stk.feather = Number(s.stkFeather) || 0.15;
      pass.enabled = true;
    },
    debugState() {
      return {
        version: SSR_VERSION,
        enabled: pass.enabled,
        frames,
        historyValid,
        w: dims.w,
        h: dims.h,
        steps: settings.steps,
      };
    },
    render(r, writeBuffer, readBuffer) {
      const pw = Math.max(1, readBuffer.width | 0);
      const ph = Math.max(1, readBuffer.height | 0);
      ensureTargets(r, pw, ph);


      const depthTex = sharedDepth.acquire(r, pw, ph);


      copyMat.uniforms.tDiffuse.value = readBuffer.texture;
      quad.material = copyMat;
      r.setRenderTarget(sceneRT);
      quad.render(r);


      const pe = camera.projectionMatrix.elements;
      const um = marchMat.uniforms;
      um.tDepth.value = depthTex;
      um.tScene.value = sceneRT.texture;
      um.uProj.value.copy(camera.projectionMatrix);
      um.uInvProj.value.copy(camera.projectionMatrix).invert();
      um.uDepthP.value.set(pe[10], pe[14]);
      um.uTexel.value.set(1 / dims.w, 1 / dims.h);
      um.uSteps.value = settings.steps;
      um.uThickness.value = settings.thickness;
      um.uMaxDist.value = settings.maxDist;
      jitterTick += 1;
      um.uJitter.value = frameJitter(frame + jitterTick);
      um.uRough.value = settings.rough;
      um.uMaxRough.value = settings.maxRough;
      um.uEdgeMargin.value = settings.edgeMargin;
      um.uBackSoft.value = settings.backSoft;


      um.uRoughPx.value = stackMode ? 1 : 0;
      quad.material = marchMat;
      r.setRenderTarget(marchRT);
      quad.render(r);


      viewProj.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
      if (!prevValid) {
        prevViewProj.copy(viewProj);
        prevValid = true;
      }
      const ua = accumMat.uniforms;
      ua.tCurrent.value = marchRT.texture;
      ua.tHistory.value = historyValid ? histRead.texture : marchRT.texture;
      ua.tDepth.value = depthTex;
      ua.uInvViewProj.value.copy(viewProj).invert();
      ua.uPrevViewProj.value.copy(prevViewProj);
      ua.uTexel.value.set(1 / dims.w, 1 / dims.h);
      ua.uAlpha.value = blendAlpha(frames);
      ua.uHistoryValid.value = historyValid ? 1 : 0;
      quad.material = accumMat;
      r.setRenderTarget(histWrite);
      quad.render(r);
      const sw = histRead;
      histRead = histWrite;
      histWrite = sw;
      historyValid = true;
      frames = Math.min(frames + 1, MAX_HISTORY_FRAMES);
      prevViewProj.copy(viewProj);


      ssrStackShare.uRswStkSsr.value = histRead.texture;
      ssrStackShare.uRswStkSsrOn.value = stackMode ? settings.intensity : 0;
      ssrStackShare.uRswStkTexel.value.x = 1 / pw;
      ssrStackShare.uRswStkTexel.value.y = 1 / ph;


      const uc = compMat.uniforms;
      uc.tDiffuse.value = readBuffer.texture;
      uc.tSsr.value = histRead.texture;


      uc.uIntensity.value = stackMode ? 0 : settings.intensity;
      quad.material = compMat;
      r.setRenderTarget(this.renderToScreen ? null : writeBuffer);
      quad.render(r);


      if (stackMode) {
        countTick += 1;
        if (countTick % COUNT_INTERVAL === 0) {
          if (!countRT) {
            countRT = new THREE.WebGLRenderTarget(COUNT_W, COUNT_H, {
              minFilter: THREE.NearestFilter,
              magFilter: THREE.NearestFilter,
              depthBuffer: false,
              stencilBuffer: false,
            });
            countRT.texture.generateMipmaps = false;
            countBuf = new Uint8Array(COUNT_W * COUNT_H * 4);
          }
          const ucn = countMat.uniforms;
          ucn.tDepth.value = depthTex;
          ucn.tSsr.value = histRead.texture;
          ucn.uInvViewProj.value.copy(viewProj).invert();
          ucn.uSsrOn.value = settings.intensity;
          ucn.uPlanarOn.value = stk.planarOn;
          ucn.uPlanarP.value.set(stk.px, stk.py, stk.pz);
          ucn.uPlanarN.value.set(stk.nx, stk.ny, stk.nz);
          ucn.uProbeOn.value = stk.probeOn;
          ucn.uProbeBlend.value = stk.probeBlend;
          ucn.uBoxMin.value.set(stk.minX, stk.minY, stk.minZ);
          ucn.uBoxMax.value.set(stk.maxX, stk.maxY, stk.maxZ);
          ucn.uFeather.value = stk.feather;
          quad.material = countMat;
          r.setRenderTarget(countRT);
          quad.render(r);
          let nPlanar = 0;
          let nSsr = 0;
          let nProbe = 0;
          let nSky = 0;
          try {
            r.readRenderTargetPixels(countRT, 0, 0, COUNT_W, COUNT_H, countBuf);
            for (let i = 0; i < countBuf.length; i += 4) {
              const id = Math.round((countBuf[i] * 3) / 255);
              if (id === 3) nPlanar++;
              else if (id === 2) nSsr++;
              else if (id === 1) nProbe++;
              else nSky++;
            }
            const c = ssrStackShare.counts;
            c.planar = nPlanar;
            c.ssr = nSsr;
            c.probe = nProbe;
            c.sky = nSky;
            c.total = nPlanar + nSsr + nProbe + nSky;
            c.frame = frame;
            c.at = ssrNowMs();
          } catch (_e) {                                                     }
          r.setRenderTarget(this.renderToScreen ? null : writeBuffer);
        }
      }
    },
    dispose() {
      disposeTargets();


      ssrStackShare.uRswStkSsr.value = null;
      ssrStackShare.uRswStkSsrOn.value = 0;
      ssrStackShare.counts.total = 0;
      ssrStackShare.counts.at = -Infinity;
      if (countRT) { countRT.dispose(); countRT = null; }
      countBuf = null;
      copyMat.dispose();
      marchMat.dispose();
      accumMat.dispose();
      compMat.dispose();
      countMat.dispose();
      quad.dispose();
    },
  };
  return pass;
}
