import { createRtShadows } from "./rtShadows.js";
import {
  RT_SUN_VERSION,
  RT_MASK_MAX_DIM,
  RT_MAX_PARTS,
  RT_TRACE_TMIN,
  maskDimsFor,
  giBoxesToRtParts,
  unpackDepthRgba,
  worldFromPixel,
  decideRtTier,
  mixRamp,
} from "../lighting/rtSunCore.js";
import {
  RT_FULL_VERSION,
  RT_FULL_MAX_DIM,
  RT_FULL_MAX_TEXELS,
  RT_FULL_TILE,
  RT_FULL_BATCH,
  RT_DENOISE_ITERATIONS,
  RT_DENOISE_SIGMA_Z,
  TILE_LIT,
  TILE_SHADOW,
  fullResDimsFor,
  classifyTiles,
  denoiseMaskPass,
} from "../lighting/rtFullResCore.js";


import {
  RT_C2_ORIGINS_PER_FRAME,
  decideSpatialBackend,
  spatialEmaStep,
  maskDiffStats,
} from "../lighting/rtParityCore.js";


import {
  RT_ULTRA_VERSION,
  decideFullResGate,
  traceAbChunk,
  traceAbStep,
} from "../lighting/rtUltraCore.js";


import {
  RT_IDLE_VERSION,
  RT_IDLE_DELAY_MS,
  RT_IDLE_TICK_MS,
  RT_IDLE_MS_PER_RAY_DEFAULT,
  rtIdleGate,
  rtIdleRaysPerTick,
  rtIdleMsPerRayStep,
} from "../lighting/rtIdleCore.js";


import {
  RETRACE_VERSION,
  retraceBudgetForTier,
  tileDeltaError,
  retraceOrder,
  reprojectMask,
  buildRetraceTexelOrder,
} from "../lighting/retraceCore.js";

function num(v, d) {
  const n = Number(v);
  return Number.isFinite(n) ? n : d;
}

function clamp(v, lo, hi) {
  return v < lo ? lo : v > hi ? hi : v;
}

export function createRtSunShadows({ THREE, renderer, scene, camera, pcss, requestRender }) {
  const supported = !!(
    THREE &&
    typeof THREE.DataTexture === "function" &&
    typeof THREE.WebGLRenderTarget === "function" &&
    typeof THREE.MeshDepthMaterial === "function" &&
    renderer &&
    typeof renderer.readRenderTargetPixels === "function" &&
    pcss &&
    pcss.rtSupported === true &&
    typeof pcss.setRt === "function"
  );

  const rt = createRtShadows({});
  let disposed = false;
  let failed = false;
  let enabled = false;
  let sceneReady = false;


  let pendingBoxes = null;


  let maskW = 0;
  let maskH = 0;
  let maskData = null;
  let maskTex = null;
  let depthRT = null;
  let pix = null;
  let origins = null;
  let visPending = null;
  let activeIdx = null;
  let activeCount = 0;


  let lastCamSig = "";
  let stableCount = 0;
  let cursor = -1;                                                     
  let converged = false;
  let mixNow = 0;
  let mixTarget = 0;
  let traceToken = 0;
  let frameCounter = 0;
  let invW = 0;
  let invH = 0;


  const FULL_TILES_PER_FRAME = 4096;                                         
  let fullPhase = "idle";                                                                                     
  let fullFailed = false;                                                       
  let fullReady = false;
  let fullW = 0;
  let fullH = 0;
  let fullPix = null;
  let fullDepth = null;
  let fullValid = null;
  let visFull = null;
  let visTmp = null;
  let fullMaskData = null;
  let fullTex = null;
  let fullDepthRT = null;
  let fullInvVp = null;
  let fullCamX = 0;
  let fullCamY = 0;
  let fullCamZ = 0;
  let tileInfo = null;
  let tileRangeRel = null;
  let traceList = null;
  let traceCount = 0;
  let traceCursor = 0;
  let fullBusy = false;
  let denoiseIter = 0;
  let denoiseCursor = 0;
  let fullBatches = 0;
  let fullStartMs = 0;
  let fullMs = 0;


  let spatialMode = "auto";
  let spatialDecided = "cpu";                                     
  let spatialFailed = false;                                               
  let spatialBusy = false;
  let spatialCpuMsEma = 0;                                                   
  let spatialCpuPasses = 0;
  let spatialCpuAccumMs = 0;                                      
  let spatialGpuMsLast = 0;
  let spatialGpuMsEma = 0;


  let spatialGpuPrepMs = 0;
  let spatialGpuPasses = 0;
  let spatialLastDiff = null;                                        
  let abPending = false;
  let originsFull = null;                                                        
  let originsCursor = 0;
  let visAb = null;                                                      
  let fullWorldPerTexel = 0.002;


  let tierName = "ultra";
  let fullForced = false;
  let fullGate = { on: false, reason: "init" };
  let traceParity = "off";                
  let abTrace = null;                                               
  let traceAbDiff = null;                                                         
  let traceAbInfo = null;                                      


  let gpuKicked = false;
  let gpuBusy = false;
  let gpuFailed = false;

  const sunDirArr = [0, 1, 0];
  let sunTan = 0.01;


  let idleWeak = false;
  let idleSinceMs = 0;                                                      
  let idleTimer = null;                                                   
  let idleMsPerRay = RT_IDLE_MS_PER_RAY_DEFAULT;
  let idleTicks = 0;
  let idleLastTickMs = 0;
  let idleLastIdleMs = 0;
  let idleReason = "off";
  let idleListenersOn = false;
  let onBattery = false;                                                    
  let batteryRef = null;
  let batteryHandler = null;
  let visHandler = null;

  function idleNow() {
    try {
      if (typeof performance !== "undefined" && typeof performance.now === "function") {
        return performance.now();
      }
    } catch (_e) {                                }
    return Date.now();
  }

  function isDocHidden() {
    try {
      return typeof document !== "undefined" && document.hidden === true;
    } catch (_e) {
      return false;
    }
  }

  function clearIdleTimer() {
    if (idleTimer === null) return;
    try { clearTimeout(idleTimer); } catch (_e) {            }
    idleTimer = null;
  }


  function armIdleTimer(ms) {
    clearIdleTimer();
    try {
      idleTimer = setTimeout(() => {
        idleTimer = null;
        if (!disposed && enabled && idleWeak) requestRender();
      }, Math.max(16, num(ms, RT_IDLE_DELAY_MS)));
    } catch (_e) {
      idleTimer = null;
    }
  }


  function initIdleListeners() {
    if (idleListenersOn) return;
    idleListenersOn = true;
    try {
      if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
        visHandler = () => {
          if (!disposed && enabled && idleWeak && !isDocHidden()) requestRender();
        };
        document.addEventListener("visibilitychange", visHandler);
      }
    } catch (_e) {
      visHandler = null;
    }
    try {
      if (typeof navigator !== "undefined" && typeof navigator.getBattery === "function") {
        navigator.getBattery().then((b) => {
          if (!b || disposed) return;
          batteryRef = b;
          batteryHandler = () => {
            const was = onBattery;
            onBattery = b.charging === false;
            if (was && !onBattery && !disposed && enabled && idleWeak) requestRender();
          };
          batteryHandler();
          try { b.addEventListener("chargingchange", batteryHandler); } catch (_e) {                      }
        }).catch(() => {});
      }
    } catch (_e) {                                               }
  }

  const stats = {
    version: RT_SUN_VERSION,
    backend: "off",
    tris: 0,
    buildMs: 0,
    lastError: null,
  };

  const depthMat = supported ? new THREE.MeshDepthMaterial() : null;
  if (depthMat) {
    depthMat.depthPacking = THREE.RGBADepthPacking;
    depthMat.blending = THREE.NoBlending;
  }
  const tmpSize = supported && typeof THREE.Vector2 === "function" ? new THREE.Vector2() : null;
  const tmpColor = supported && typeof THREE.Color === "function" ? new THREE.Color() : null;
  const tmpView = supported ? new THREE.Matrix4() : null;
  const tmpVP = supported ? new THREE.Matrix4() : null;
  const invVpM = supported ? new THREE.Matrix4() : null;


  const maskVP = supported ? new THREE.Matrix4() : null;
  let histReady = false;
  let retraceTier = "off";                                               
  let retracing = false;
  let retraceTexelCap = 0;                                                     
  let retraceTileArea = 256;
  let retraceBudgetTiles = 0;
  let retraceTilesTotal = 0;
  let retraceTilesTraced = 0;
  let retracePasses = 0;                                      

  function fail(msg) {
    failed = true;
    enabled = false;
    stats.lastError = String(msg || "erro");
    pushOff();
  }

  function push() {


    const tex = fullReady && fullTex ? fullTex : maskTex;


    const on = enabled && !failed && (!idleWeak || mixNow > 0);
    pcss.setRt({ on, mix: mixNow, tex, invW, invH });
  }

  function pushOff() {
    if (pcss && typeof pcss.setRt === "function") {
      pcss.setRt({ on: false, mix: 0, tex: null, invW: 0, invH: 0 });
    }
  }

  function invalidate() {


    idleSinceMs = idleNow();
    if (idleWeak && enabled && !disposed) armIdleTimer(RT_IDLE_DELAY_MS + 32);
    traceToken++;
    gpuBusy = false;
    converged = false;
    cursor = -1;
    stableCount = 0;
    mixNow = 0;
    mixTarget = 0;


    fullPhase = "idle";
    fullReady = false;
    fullBusy = false;
    fullBatches = 0;


    abPending = false;
    originsCursor = 0;
    spatialBusy = false;
    spatialCpuAccumMs = 0;
    spatialGpuPrepMs = 0;


    abTrace = null;


    retracing = false;
    retraceTexelCap = 0;
    histReady = false;
  }

  function allocate(w, h) {
    maskW = w;
    maskH = h;
    if (depthRT) depthRT.dispose();
    depthRT = new THREE.WebGLRenderTarget(w, h, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });
    if (maskTex) maskTex.dispose();
    maskData = new Uint8Array(w * h * 4).fill(255);
    maskTex = new THREE.DataTexture(maskData, w, h);
    maskTex.minFilter = THREE.LinearFilter;
    maskTex.magFilter = THREE.LinearFilter;
    maskTex.wrapS = THREE.ClampToEdgeWrapping;
    maskTex.wrapT = THREE.ClampToEdgeWrapping;
    maskTex.generateMipmaps = false;
    maskTex.flipY = false;
    maskTex.unpackAlignment = 1;
    maskTex.needsUpdate = true;
    pix = new Uint8Array(w * h * 4);
    origins = new Float32Array(w * h * 4);
    visPending = new Float32Array(w * h);
    activeIdx = new Int32Array(w * h);
    activeCount = 0;
    invalidate();
  }


  function cameraSignature() {
    const p = camera.position;
    const q = camera.quaternion;
    const pe = camera.projectionMatrix.elements;
    return (
      Math.round(p.x * 100) + "," + Math.round(p.y * 100) + "," + Math.round(p.z * 100) + "|" +
      Math.round(q.x * 2048) + "," + Math.round(q.y * 2048) + "," + Math.round(q.z * 2048) + "," + Math.round(q.w * 2048) + "|" +
      Math.round(num(pe[0], 0) * 512) + "," + Math.round(num(pe[5], 0) * 512) + "," +
      Math.round(num(pe[10], 0) * 512) + "," + Math.round(num(pe[14], 0) * 8) + "|" + maskW + "x" + maskH
    );
  }


  function captureOrigins() {
    const prevRT = renderer.getRenderTarget();
    const prevOverride = scene.overrideMaterial;
    const prevBg = scene.background;
    let prevAlpha = 1;
    if (tmpColor) {
      renderer.getClearColor(tmpColor);
      prevAlpha = renderer.getClearAlpha();
    }
    try {
      scene.overrideMaterial = depthMat;
      scene.background = null;
      renderer.setRenderTarget(depthRT);
      renderer.setClearColor(0xffffff, 1);
      renderer.clear(true, true, false);
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(depthRT, 0, 0, maskW, maskH, pix);
    } finally {
      renderer.setRenderTarget(prevRT);
      if (tmpColor) renderer.setClearColor(tmpColor, prevAlpha);
      scene.overrideMaterial = prevOverride;
      scene.background = prevBg;
    }
    tmpView.copy(camera.matrixWorld).invert();
    tmpVP.multiplyMatrices(camera.projectionMatrix, tmpView);
    invVpM.copy(tmpVP).invert();
    const e = invVpM.elements;
    const camX = camera.position.x;
    const camY = camera.position.y;
    const camZ = camera.position.z;
    activeCount = 0;
    for (let iy = 0; iy < maskH; iy++) {
      for (let ix = 0; ix < maskW; ix++) {
        const i = iy * maskW + ix;
        const q = i * 4;
        visPending[i] = 1;
        const d = unpackDepthRgba(pix[q], pix[q + 1], pix[q + 2], pix[q + 3]);
        if (d >= 0.9995) {
          origins[q + 3] = 0;
          continue;
        }
        const pos = worldFromPixel(ix, iy, maskW, maskH, d, e);
        if (!pos) {
          origins[q + 3] = 0;
          continue;
        }


        const vx = camX - pos[0];
        const vy = camY - pos[1];
        const vz = camZ - pos[2];
        const vd = Math.hypot(vx, vy, vz);
        const esc = vd > 1e-6 ? clamp(vd * 0.0015, 0.02, 0.5) / vd : 0;
        origins[q] = pos[0] + vx * esc;
        origins[q + 1] = pos[1] + vy * esc;
        origins[q + 2] = pos[2] + vz * esc;
        origins[q + 3] = 1;
        activeIdx[activeCount++] = i;
      }
    }
    cursor = 0;
  }

  function sliceOrigins(from, count) {
    const out = new Float32Array(count * 4);
    for (let k = 0; k < count; k++) {
      const ti = activeIdx[from + k];
      out[k * 4] = origins[ti * 4];
      out[k * 4 + 1] = origins[ti * 4 + 1];
      out[k * 4 + 2] = origins[ti * 4 + 2];
      out[k * 4 + 3] = 0;
    }
    return out;
  }

  function finishPass() {
    for (let i = 0; i < maskW * maskH; i++) {
      const byte = Math.round(clamp(visPending[i], 0, 1) * 255);
      const q = i * 4;
      maskData[q] = byte;


      maskData[q + 1] = origins[q + 3] > 0 ? 255 : 0;
      maskData[q + 2] = byte;
      maskData[q + 3] = 255;
    }
    maskTex.needsUpdate = true;
    converged = true;
    mixTarget = 1;


    if (maskVP) maskVP.copy(tmpVP);
    histReady = true;
    if (retracing) {
      retracing = false;
      retraceTexelCap = 0;
      retracePasses++;
    }
  }


  function applyRetraceBootstrap() {
    if (!histReady || !maskVP || activeCount === 0) {
      retracing = false;
      retraceTexelCap = 0;
      return;
    }


    const rp = reprojectMask({ w: maskW, h: maskH, origins, mask: maskData, prevVp: maskVP.elements });
    const de = tileDeltaError({ w: maskW, h: maskH, prev: rp.prev, cur: rp.vis, valid: rp.valid });
    const tilesTotal = de.grid.tilesX * de.grid.tilesY;
    retraceBudgetTiles = retraceBudgetForTier(retraceTier, tilesTotal);
    if (retraceBudgetTiles <= 0) {


      retracing = false;
      retraceTexelCap = 0;
      return;
    }
    const order = retraceOrder({ err: de.err, budget: tilesTotal, minErr: 0 });
    const reordered = buildRetraceTexelOrder({ w: maskW, grid: de.grid, order, activeIdx, activeCount });
    for (let k = 0; k < activeCount; k++) activeIdx[k] = reordered[k];


    const n = maskW * maskH;
    for (let i = 0; i < n; i++) {
      const q = i * 4;
      const okTexel = rp.valid[i] === 1 && origins[q + 3] > 0;
      const v = okTexel ? rp.vis[i] : 1;
      visPending[i] = v;
      const byte = Math.round(clamp(v, 0, 1) * 255);
      maskData[q] = byte;
      maskData[q + 1] = okTexel ? 255 : 0;
      maskData[q + 2] = byte;
      maskData[q + 3] = 255;
    }
    maskTex.needsUpdate = true;
    if (maskVP) maskVP.copy(tmpVP);                                                   
    retraceTileArea = Math.max(1, de.grid.tile * de.grid.tile);
    retraceTexelCap = Math.max(1, retraceBudgetTiles * retraceTileArea);
    retraceTilesTotal = tilesTotal;
    retraceTilesTraced = 0;


    mixTarget = 1;
  }

  function frameInner(args) {
    const a = args || {};
    if (tmpSize) {
      renderer.getDrawingBufferSize(tmpSize);
    }
    const dbw = Math.max(1, Math.round(tmpSize ? tmpSize.x : 1));
    const dbh = Math.max(1, Math.round(tmpSize ? tmpSize.y : 1));
    invW = 1 / dbw;
    invH = 1 / dbh;
    const dims = maskDimsFor(dbw, dbh, RT_MASK_MAX_DIM);
    if (dims.w !== maskW || dims.h !== maskH) allocate(dims.w, dims.h);
    const sig = cameraSignature();
    if (sig !== lastCamSig) {
      lastCamSig = sig;


      const wantRetrace = histReady && !idleWeak;
      invalidate();
      if (wantRetrace) {
        retracing = true;
        histReady = true;                                                
      }
      push();
      return;
    }
    stableCount++;


    if (idleWeak) {
      const idleMs = idleNow() - idleSinceMs;
      idleLastIdleMs = idleMs;
      const gate = rtIdleGate({ weak: true, idleMs, hidden: isDocHidden(), onBattery });
      idleReason = gate.reason;
      if (!gate.run) {
        push();
        if (gate.retryInMs > 0) armIdleTimer(gate.retryInMs);
        return;
      }
    } else {
      idleReason = "perfil-forte";
    }
    if (!sceneReady) {


      push();
      return;
    }
    if (stableCount < 2) {


      push();
      requestRender();
      return;
    }
    if (converged) {
      const prev = mixNow;
      mixNow = mixRamp(mixNow, mixTarget);


      let fullPending = false;
      try {


        fullPending = idleWeak ? false : stepFullRes(dbw, dbh);
      } catch (err) {
        fullFailed = true;
        fullPhase = "idle";
        stats.lastError = "fullres: " + (err && err.message ? err.message : String(err));
      }


      let abWork = false;
      try {
        abWork = idleWeak ? false : stepTraceAb();
      } catch (err) {
        abTrace = null;
        stats.lastError = "trace-ab: " + (err && err.message ? err.message : String(err));
      }
      push();
      if (mixNow !== prev || fullPending || abWork) requestRender();
      return;
    }
    if (cursor < 0) {
      captureOrigins();


      if (retracing) applyRetraceBootstrap();
    }
    if (activeCount === 0) {
      finishPass();
      push();
      requestRender();
      return;
    }


    if (retracing && mixTarget > mixNow) mixNow = mixRamp(mixNow, mixTarget);


    const tier = decideRtTier({
      webgpuReady: !idleWeak && !gpuFailed && rt.getStats().gpuReady === true,
      emaMs: a.emaMs,
    });
    stats.backend = tier.backend;
    if (tier.backend === "gpu") {
      if (!gpuBusy) {
        gpuBusy = true;
        const token = traceToken;
        const from = cursor;
        const count = activeCount - cursor;
        const batch = sliceOrigins(from, count);


        const passFrame = frameCounter++;
        const passSamples = tier.samples;


        rt.traceSunBatchGpu(batch, [-sunDirArr[0], -sunDirArr[1], -sunDirArr[2]], {
          tanHalfAngle: sunTan,
          samples: passSamples,
          frame: passFrame,
          tMin: RT_TRACE_TMIN,
        }).then((vis) => {
          gpuBusy = false;
          if (disposed || token !== traceToken) return;
          if (!vis || vis.length !== count) {
            gpuFailed = true;                                     
            requestRender();
            return;
          }
          for (let k = 0; k < count; k++) visPending[activeIdx[from + k]] = vis[k];


          if (traceParity === "ab" && !idleWeak && count > 0) {
            abTrace = {
              from,
              count,
              cursor: 0,
              visGpu: vis.slice(),
              visCpu: new Float32Array(count),
              samples: passSamples,
              frame: passFrame,
              tanHalf: sunTan,
              chunks: 0,
              ms: 0,
            };
          }
          cursor = activeCount;
          finishPass();
          push();
          requestRender();
        }).catch((err) => {
          gpuBusy = false;
          gpuFailed = true;
          stats.lastError = "gpu: " + (err && err.message ? err.message : String(err));
          requestRender();
        });
      }
      push();
      return;
    }


    const raysBudget = idleWeak ? rtIdleRaysPerTick(idleMsPerRay, RT_IDLE_TICK_MS) : tier.raysPerFrame;
    const texels = Math.max(idleWeak ? 16 : 64, Math.floor(raysBudget / Math.max(1, tier.samples)));
    let take = Math.min(texels, activeCount - cursor);


    if (retracing && retraceTexelCap > 0) take = Math.min(take, retraceTexelCap);
    const batch = sliceOrigins(cursor, take);
    const tickT0 = idleWeak ? idleNow() : 0;

    const vis = rt.traceSunBatchCpu(batch, [-sunDirArr[0], -sunDirArr[1], -sunDirArr[2]], {
      tanHalfAngle: sunTan,
      samples: tier.samples,
      frame: frameCounter++,
      tMin: RT_TRACE_TMIN,
    });


    if (idleWeak) {
      const tickMs = idleNow() - tickT0;
      idleLastTickMs = tickMs;
      idleTicks++;
      idleMsPerRay = rtIdleMsPerRayStep(idleMsPerRay, tickMs, take * Math.max(1, tier.samples));
    }
    for (let k = 0; k < take; k++) visPending[activeIdx[cursor + k]] = vis[k];


    if (retracing) {
      for (let k = 0; k < take; k++) {
        const ti = activeIdx[cursor + k];
        const tq = ti * 4;
        const tb = Math.round(clamp(visPending[ti], 0, 1) * 255);
        maskData[tq] = tb;
        maskData[tq + 1] = 255;
        maskData[tq + 2] = tb;
      }
      maskTex.needsUpdate = true;
      retraceTilesTraced = Math.min(retraceTilesTotal, retraceTilesTraced + take / retraceTileArea);
    }
    cursor += take;
    if (cursor >= activeCount) finishPass();
    push();
    requestRender();
  }


  function ensureFullBuffers(dbw, dbh) {
    const dims = fullResDimsFor(dbw, dbh, RT_FULL_MAX_DIM, RT_FULL_MAX_TEXELS);
    if (dims.w === fullW && dims.h === fullH && visFull) return;
    fullW = dims.w;
    fullH = dims.h;
    const n = fullW * fullH;
    if (fullDepthRT) fullDepthRT.dispose();
    fullDepthRT = new THREE.WebGLRenderTarget(fullW, fullH, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      depthBuffer: true,
      stencilBuffer: false,
    });
    fullPix = new Uint8Array(n * 4);
    fullDepth = new Float32Array(n);
    fullValid = new Uint8Array(n);
    visFull = new Float32Array(n);
    visTmp = new Float32Array(n);
    fullMaskData = new Uint8Array(n * 4).fill(255);
    if (fullTex) fullTex.dispose();
    fullTex = new THREE.DataTexture(fullMaskData, fullW, fullH);
    fullTex.minFilter = THREE.LinearFilter;
    fullTex.magFilter = THREE.LinearFilter;
    fullTex.wrapS = THREE.ClampToEdgeWrapping;
    fullTex.wrapT = THREE.ClampToEdgeWrapping;
    fullTex.generateMipmaps = false;
    fullTex.flipY = false;
    fullTex.unpackAlignment = 1;
    traceList = new Int32Array(n);
    tileRangeRel = null;                                                    

    originsFull = null;
    visAb = null;
    originsCursor = 0;
  }


  function fullCaptureDepth() {
    const prevRT = renderer.getRenderTarget();
    const prevOverride = scene.overrideMaterial;
    const prevBg = scene.background;
    let prevAlpha = 1;
    if (tmpColor) {
      renderer.getClearColor(tmpColor);
      prevAlpha = renderer.getClearAlpha();
    }
    try {
      scene.overrideMaterial = depthMat;
      scene.background = null;
      renderer.setRenderTarget(fullDepthRT);
      renderer.setClearColor(0xffffff, 1);
      renderer.clear(true, true, false);
      renderer.render(scene, camera);
      renderer.readRenderTargetPixels(fullDepthRT, 0, 0, fullW, fullH, fullPix);
    } finally {
      renderer.setRenderTarget(prevRT);
      if (tmpColor) renderer.setClearColor(tmpColor, prevAlpha);
      scene.overrideMaterial = prevOverride;
      scene.background = prevBg;
    }
    tmpView.copy(camera.matrixWorld).invert();
    tmpVP.multiplyMatrices(camera.projectionMatrix, tmpView);
    invVpM.copy(tmpVP).invert();
    fullInvVp = invVpM.elements.slice(0, 16);
    fullCamX = camera.position.x;
    fullCamY = camera.position.y;
    fullCamZ = camera.position.z;


    fullWorldPerTexel = (2 * Math.tan((num(camera.fov, 70) * Math.PI) / 360)) / Math.max(1, fullH);
    const tX = Math.ceil(fullW / RT_FULL_TILE);
    const tY = Math.ceil(fullH / RT_FULL_TILE);
    if (!tileRangeRel || tileRangeRel.length !== tX * tY) tileRangeRel = new Float32Array(tX * tY);
    const tMinD = new Float32Array(tX * tY).fill(Infinity);
    const tMaxD = new Float32Array(tX * tY);
    for (let iy = 0; iy < fullH; iy++) {
      const rowT = ((iy / RT_FULL_TILE) | 0) * tX;
      for (let ix = 0; ix < fullW; ix++) {
        const i = iy * fullW + ix;
        const q = i * 4;
        const d = unpackDepthRgba(fullPix[q], fullPix[q + 1], fullPix[q + 2], fullPix[q + 3]);
        if (d >= 0.9995) {
          fullDepth[i] = 1;
          fullValid[i] = 0;
          continue;
        }
        fullDepth[i] = d;
        fullValid[i] = 1;
        const t = rowT + ((ix / RT_FULL_TILE) | 0);
        if (d < tMinD[t]) tMinD[t] = d;
        if (d > tMaxD[t]) tMaxD[t] = d;
      }
    }
    for (let t = 0; t < tX * tY; t++) {
      tileRangeRel[t] = tMinD[t] === Infinity ? 0 : (tMaxD[t] - tMinD[t]) / Math.max(0.02, tMinD[t]);
    }
  }


  function fullClassify() {
    const lowN = maskW * maskH;
    const lowValidArr = new Uint8Array(lowN);
    for (let i = 0; i < lowN; i++) lowValidArr[i] = origins[i * 4 + 3] > 0 ? 1 : 0;
    tileInfo = classifyTiles({
      lowVis: visPending,
      lowValid: lowValidArr,
      lowW: maskW,
      lowH: maskH,
      fullW,
      fullH,
      tile: RT_FULL_TILE,
      tileRangeRel,
    });
    traceCount = 0;
    traceCursor = 0;
    const st = tileInfo.state;
    const tX = tileInfo.tilesX;
    for (let ty = 0; ty < tileInfo.tilesY; ty++) {
      for (let tx = 0; tx < tX; tx++) {
        const s = st[ty * tX + tx];
        const x1 = Math.min(fullW, (tx + 1) * RT_FULL_TILE);
        const y1 = Math.min(fullH, (ty + 1) * RT_FULL_TILE);
        for (let y = ty * RT_FULL_TILE; y < y1; y++) {
          for (let x = tx * RT_FULL_TILE; x < x1; x++) {
            const i = y * fullW + x;
            if (!fullValid[i]) {
              visFull[i] = 1;                                               
            } else if (s === TILE_LIT) {
              visFull[i] = 1;
            } else if (s === TILE_SHADOW) {
              visFull[i] = 0;
            } else {
              visFull[i] = 1;
              traceList[traceCount++] = i;
            }
          }
        }
      }
    }
  }


  function fullKickBatch() {
    if (fullBusy) return;
    const take = Math.min(RT_FULL_BATCH, traceCount - traceCursor);
    if (take <= 0) return;
    const from = traceCursor;
    const batch = new Float32Array(take * 4);
    for (let k = 0; k < take; k++) {
      const i = traceList[from + k];
      const ix = i % fullW;
      const iy = (i / fullW) | 0;
      const pos = worldFromPixel(ix, iy, fullW, fullH, fullDepth[i], fullInvVp);
      const o = k * 4;
      if (!pos) {


        fullValid[i] = 0;
        batch[o] = fullCamX;
        batch[o + 1] = fullCamY;
        batch[o + 2] = fullCamZ;
        continue;
      }


      const vx = fullCamX - pos[0];
      const vy = fullCamY - pos[1];
      const vz = fullCamZ - pos[2];
      const vd = Math.hypot(vx, vy, vz);
      const esc = vd > 1e-6 ? clamp(vd * 0.0015, 0.02, 0.5) / vd : 0;
      batch[o] = pos[0] + vx * esc;
      batch[o + 1] = pos[1] + vy * esc;
      batch[o + 2] = pos[2] + vz * esc;
    }
    fullBusy = true;
    const token = traceToken;

    rt.traceSunBatchGpu(batch, [-sunDirArr[0], -sunDirArr[1], -sunDirArr[2]], {
      tanHalfAngle: sunTan,
      samples: 1,
      frame: frameCounter++,
      tMin: RT_TRACE_TMIN,
    }).then((vis) => {
      fullBusy = false;
      if (disposed || token !== traceToken) return;
      if (!vis || vis.length !== take) {
        fullFailed = true;
        stats.lastError = "fullres: lote GPU falhou (" + (rt.getStats().lastError || "sem motivo") + ")";
        fullPhase = "idle";
        requestRender();
        return;
      }
      for (let k = 0; k < take; k++) visFull[traceList[from + k]] = vis[k];
      traceCursor = from + take;
      fullBatches++;

      if (traceCursor >= traceCount) beginDenoisePhase();
      requestRender();
    }).catch((err) => {
      fullBusy = false;
      if (disposed || token !== traceToken) return;
      fullFailed = true;
      stats.lastError = "fullres: " + (err && err.message ? err.message : String(err));
      fullPhase = "idle";
      requestRender();
    });
  }


  function beginDenoisePhase() {
    spatialDecided = decideSpatialBackend({
      mode: spatialMode,
      gpuReady: rt.getStats().spatialReady === true,
      failed: spatialFailed,
      traced: traceCount,
      cpuMsEma: spatialCpuMsEma,
      cpuPasses: spatialCpuPasses,
      gpuMsEma: spatialGpuMsEma,
      gpuPasses: spatialGpuPasses,
    });
    if (spatialDecided === "gpu") {
      originsCursor = 0;
      spatialGpuPrepMs = 0;
      fullPhase = "origins";
      return;
    }
    abPending = spatialDecided === "ab";
    if (abPending) {

      if (!visAb || visAb.length !== fullW * fullH) visAb = new Float32Array(fullW * fullH);
      visAb.set(visFull);
    }
    fullPhase = "denoise";
    denoiseIter = 0;
    denoiseCursor = 0;
    spatialCpuAccumMs = 0;
    visTmp.set(visFull);                                          
  }


  function fullOriginsStep() {
    const t0 = idleNow();                                                 
    const n = fullW * fullH;
    if (!originsFull || originsFull.length !== n * 4) {
      originsFull = new Float32Array(n * 4);
      originsCursor = 0;
    }
    const to = Math.min(n, originsCursor + RT_C2_ORIGINS_PER_FRAME);
    for (let i = originsCursor; i < to; i++) {
      const q = i * 4;
      if (!fullValid[i]) {
        originsFull[q + 3] = 0;
        continue;
      }
      const pos = worldFromPixel(i % fullW, (i / fullW) | 0, fullW, fullH, fullDepth[i], fullInvVp);
      if (!pos) {
        originsFull[q + 3] = 0;
        continue;
      }
      originsFull[q] = pos[0];
      originsFull[q + 1] = pos[1];
      originsFull[q + 2] = pos[2];
      originsFull[q + 3] = 1;
    }
    originsCursor = to;
    spatialGpuPrepMs += idleNow() - t0;
    if (originsCursor >= n) fullKickSpatial();
  }


  function spatialFallbackToCpu(reason) {
    spatialFailed = true;
    spatialDecided = "cpu";
    stats.lastError = "fullres-c2: " + reason;
    if (abPending) {
      abPending = false;
      fullPhase = "upload";                                                   
      return;
    }
    fullPhase = "denoise";
    denoiseIter = 0;
    denoiseCursor = 0;
    spatialCpuAccumMs = 0;
    visTmp.set(visFull);
  }


  function fullKickSpatial() {
    if (spatialBusy) return;
    spatialBusy = true;
    fullPhase = "spatialWait";
    const token = traceToken;
    const input = abPending ? visAb : visFull;
    const t0 = idleNow();
    rt.denoiseSpatialGpu(input, originsFull, fullW, fullH, {
      camPos: [fullCamX, fullCamY, fullCamZ],
      worldPerTexel: fullWorldPerTexel,
    }).then((res) => {
      spatialBusy = false;
      if (disposed || token !== traceToken) return;                            
      if (!res || res.length !== fullW * fullH) {
        spatialFallbackToCpu("kernel espacial falhou (" + (rt.getStats().lastError || "sem motivo") + ")");
        requestRender();
        return;
      }


      spatialGpuMsLast = idleNow() - t0 + spatialGpuPrepMs;
      spatialGpuPrepMs = 0;
      spatialGpuMsEma = spatialEmaStep(spatialGpuMsEma, spatialGpuMsLast);
      spatialGpuPasses++;
      if (abPending) {


        abPending = false;
        try {
          spatialLastDiff = maskDiffStats(visFull, res, fullValid);
        } catch (_e) {
          spatialLastDiff = null;
        }
      } else {
        visFull.set(res);
      }
      fullPhase = "upload";
      requestRender();
    }).catch((err) => {
      spatialBusy = false;
      if (disposed || token !== traceToken) return;
      spatialFallbackToCpu(err && err.message ? err.message : String(err));
      requestRender();
    });
  }


  function fullDenoiseStep() {
    const tilesTotal = tileInfo ? tileInfo.tilesX * tileInfo.tilesY : 0;
    if (tilesTotal <= 0) {
      fullPhase = "upload";
      return;
    }
    const t0 = idleNow();                                                       
    const to = Math.min(tilesTotal, denoiseCursor + FULL_TILES_PER_FRAME);
    denoiseMaskPass({
      src: visFull,
      dst: visTmp,
      depth: fullDepth,
      valid: fullValid,
      w: fullW,
      h: fullH,
      tile: RT_FULL_TILE,
      tileState: tileInfo.state,
      tileFrom: denoiseCursor,
      tileTo: to,
      step: denoiseIter === 0 ? 1 : 2,                                     
      sigmaZ: RT_DENOISE_SIGMA_Z,
    });
    denoiseCursor = to;
    spatialCpuAccumMs += idleNow() - t0;
    if (denoiseCursor >= tilesTotal) {
      const swap = visFull;
      visFull = visTmp;
      visTmp = swap;
      denoiseIter++;
      denoiseCursor = 0;
      if (denoiseIter >= RT_DENOISE_ITERATIONS) {

        spatialCpuMsEma = spatialEmaStep(spatialCpuMsEma, spatialCpuAccumMs);
        spatialCpuPasses++;
        spatialCpuAccumMs = 0;
        if (abPending) {

          originsCursor = 0;
          spatialGpuPrepMs = 0;
          fullPhase = "origins";
        } else {
          fullPhase = "upload";
        }
      } else {
        visTmp.set(visFull);                                 
      }
    }
  }

  function fullUpload() {
    const n = fullW * fullH;
    for (let i = 0; i < n; i++) {
      const v = visFull[i];
      const byte = Math.round((v < 0 ? 0 : v > 1 ? 1 : v) * 255);
      const q = i * 4;
      fullMaskData[q] = byte;
      fullMaskData[q + 1] = fullValid[i] ? 255 : 0;
      fullMaskData[q + 2] = byte;
      fullMaskData[q + 3] = 255;
    }
    fullTex.needsUpdate = true;
    fullReady = true;
    fullPhase = "done";
    fullMs = Date.now() - fullStartMs;
  }


  function stepFullRes(dbw, dbh) {
    if (fullFailed || gpuFailed || failed) return false;
    if (fullPhase === "done") {


      const dims = fullResDimsFor(dbw, dbh, RT_FULL_MAX_DIM, RT_FULL_MAX_TEXELS);
      if (dims.w !== fullW || dims.h !== fullH) {
        fullReady = false;                                                               
        fullPhase = "idle";
        return true;
      }
      return false;
    }


    fullGate = decideFullResGate({
      tier: tierName,
      gpuReady: rt.getStats().gpuReady === true,
      weak: idleWeak,
      forced: fullForced,
      failed: fullFailed,
    });
    if (!fullGate.on) return false;                                                 
    if (fullPhase === "idle") {
      const dims = fullResDimsFor(dbw, dbh, RT_FULL_MAX_DIM, RT_FULL_MAX_TEXELS);
      if (dims.w <= maskW * 2 && dims.h <= maskH * 2) return false;                                   
      fullStartMs = Date.now();
      fullPhase = "depth";
      return true;
    }
    if (fullPhase === "depth") {
      ensureFullBuffers(dbw, dbh);
      fullCaptureDepth();
      fullPhase = "classify";
      return true;
    }
    if (fullPhase === "classify") {
      fullClassify();
      if (traceCount > 0) {
        fullPhase = "trace";
      } else {
        beginDenoisePhase();                                            
      }
      return true;
    }
    if (fullPhase === "trace") {
      fullKickBatch();
      return true;
    }
    if (fullPhase === "denoise") {
      fullDenoiseStep();
      return true;
    }
    if (fullPhase === "origins") {
      fullOriginsStep();
      return true;
    }
    if (fullPhase === "spatialWait") {

      return true;
    }
    if (fullPhase === "upload") {
      fullUpload();
      return false;
    }
    return false;
  }


  function stepTraceAb() {
    if (!abTrace) return false;
    const chunk = traceAbChunk({ samples: abTrace.samples });
    const st = traceAbStep({ cursor: abTrace.cursor, total: abTrace.count, chunk });
    const t0 = idleNow();
    for (let k = st.from; k < st.from + st.take; k++) {
      const q = activeIdx[abTrace.from + k] * 4;
      abTrace.visCpu[k] = rt.sunVisibility(
        [origins[q], origins[q + 1], origins[q + 2]],
        [-sunDirArr[0], -sunDirArr[1], -sunDirArr[2]],
        {
          tanHalfAngle: abTrace.tanHalf,
          samples: abTrace.samples,
          frame: abTrace.frame,
          tMin: RT_TRACE_TMIN,
          px: k % 4096,
          py: Math.floor(k / 4096),
        },
      );
    }
    abTrace.ms += idleNow() - t0;
    abTrace.cursor = st.from + st.take;
    abTrace.chunks++;
    if (st.done || abTrace.cursor >= abTrace.count) {
      try {
        traceAbDiff = maskDiffStats(abTrace.visGpu, abTrace.visCpu);
      } catch (_e) {
        traceAbDiff = null;
      }
      traceAbInfo = {
        n: abTrace.count,
        chunks: abTrace.chunks,
        ms: Math.round(abTrace.ms * 100) / 100,
        samples: abTrace.samples,
        frame: abTrace.frame,
      };
      abTrace = null;
      return false;
    }
    return true;
  }


  function setEnabled(on) {
    if (disposed) return;
    const want = !!on && supported && !failed;
    if (want === enabled) return;
    enabled = want;
    if (enabled) {
      invalidate();
      if (pendingBoxes) {


        const b = pendingBoxes;
        pendingBoxes = null;
        syncScene(b);
      }
      if (!gpuKicked) {
        gpuKicked = true;

        try {
          rt.initGpu().then(() => {
            if (!disposed && enabled) requestRender();
          }).catch(() => {});
        } catch (_e) {                                     }
      }
      requestRender();
    } else {


      clearIdleTimer();
      pushOff();
    }
  }

  function isEnabled() {
    return enabled;
  }


  function setIdlePolicy(policy) {
    if (disposed) return;
    const weak = !!(policy && policy.weak === true);
    if (weak === idleWeak) return;
    idleWeak = weak;
    idleReason = weak ? "aguardando-ocio" : "off";
    if (weak) {
      initIdleListeners();
    } else {
      clearIdleTimer();
    }
    invalidate();
    if (enabled) {
      push();
      requestRender();
    }
  }


  function setSpatialBackend(mode) {
    if (disposed) return;
    const m = mode === "cpu" || mode === "gpu" || mode === "ab" || mode === "auto" ? mode : "auto";
    if (m === spatialMode) return;
    spatialMode = m;
    invalidate();
    if (enabled) {
      push();
      requestRender();
    }
  }


  function refreshFullGate() {
    const was = fullGate.on;
    fullGate = decideFullResGate({
      tier: tierName,
      gpuReady: rt.getStats().gpuReady === true,
      weak: idleWeak,
      forced: fullForced,
      failed: fullFailed,
    });
    if (was && !fullGate.on && (fullPhase !== "idle" || fullReady)) {
      traceToken++;                                                             
      fullPhase = "idle";
      fullReady = false;
      fullBusy = false;
      abPending = false;
      spatialBusy = false;
      originsCursor = 0;
      spatialGpuPrepMs = 0;
      spatialCpuAccumMs = 0;
      if (enabled) {
        push();
        requestRender();
      }
    } else if (!was && fullGate.on && enabled) {
      requestRender();                                               
    }
  }


  function setShadowTier(name) {
    if (disposed) return;
    const t = typeof name === "string" && name ? name.toLowerCase() : "";
    if (t === tierName) return;
    tierName = t;
    refreshFullGate();
  }


  function setFullResPolicy(policy) {
    if (disposed) return;
    const f = !!(policy && policy.force === true);
    if (f === fullForced) return;
    fullForced = f;
    refreshFullGate();
  }


  function setTraceParity(mode) {
    if (disposed) return;
    const m = mode === "ab" ? "ab" : "off";
    if (m === traceParity) return;
    traceParity = m;
    if (m === "off") abTrace = null;
    if (enabled) requestRender();
  }


  function setSun(dir, tanHalf) {
    if (disposed || failed) return;
    const d = Array.isArray(dir) ? dir : [0, 1, 0];
    let x = num(d[0], 0);
    let y = num(d[1], 1);
    let z = num(d[2], 0);
    const l = Math.hypot(x, y, z);
    if (l < 1e-6) {
      x = 0; y = 1; z = 0;
    } else {
      x /= l; y /= l; z /= l;
    }
    const t = clamp(num(tanHalf, 0.01), 0.001, 0.2);
    const dot = x * sunDirArr[0] + y * sunDirArr[1] + z * sunDirArr[2];
    if (dot < 0.99995 || Math.abs(t - sunTan) > 5e-4) {
      sunDirArr[0] = x;
      sunDirArr[1] = y;
      sunDirArr[2] = z;
      sunTan = t;
      invalidate();
      if (enabled) requestRender();
    }
  }


  function syncScene(boxes) {
    if (disposed || failed || !supported) return;
    if (!enabled) {


      pendingBoxes = Array.isArray(boxes) ? boxes : [];
      sceneReady = false;
      return;
    }
    pendingBoxes = null;
    try {
      rt.setParts(giBoxesToRtParts(boxes, RT_MAX_PARTS));
      const s = rt.getStats();
      stats.tris = s.triCount;
      stats.buildMs = s.buildMs;
      sceneReady = true;
      invalidate();
      if (enabled) requestRender();
    } catch (err) {
      fail("syncScene: " + (err && err.message ? err.message : String(err)));
    }
  }


  function frame(args) {
    if (disposed || failed || !enabled || !supported) return;
    try {
      frameInner(args);
    } catch (err) {
      fail("frame: " + (err && err.message ? err.message : String(err)));
    }
  }

  function getStats() {
    const s = rt.getStats();
    return {
      version: RT_SUN_VERSION,
      supported,
      enabled,
      failed,
      backend: stats.backend,
      converged,
      mix: mixNow,
      coverage: activeCount > 0 ? clamp(Math.max(cursor, 0) / activeCount, 0, 1) : converged ? 1 : 0,
      maskW,
      maskH,
      active: activeCount,
      tris: stats.tris,
      buildMs: stats.buildMs,
      lastTraceMs: s.lastTraceMs,
      fullRes: {
        version: RT_FULL_VERSION,
        phase: fullPhase,
        ready: fullReady,
        failed: fullFailed,
        w: fullW,
        h: fullH,
        tiles: tileInfo ? { lit: tileInfo.lit, shadow: tileInfo.shadow, trace: tileInfo.trace } : null,
        traced: traceCount,
        batches: fullBatches,
        ms: fullMs,

        spatial: {
          mode: spatialMode,
          decided: spatialDecided,
          failed: spatialFailed,
          ready: s.spatialReady === true,
          cpuMsEma: Math.round(spatialCpuMsEma * 100) / 100,
          cpuPasses: spatialCpuPasses,
          gpuMsLast: Math.round(spatialGpuMsLast * 100) / 100,
          gpuMsEma: Math.round(spatialGpuMsEma * 100) / 100,
          gpuPasses: spatialGpuPasses,
          lastDiff: spatialLastDiff,
        },

        gate: {
          version: RT_ULTRA_VERSION,
          on: fullGate.on,
          reason: fullGate.reason,
          tier: tierName,
          forced: fullForced,
        },
      },

      traceAb: {
        mode: traceParity,
        running: abTrace !== null,
        cursor: abTrace ? abTrace.cursor : 0,
        total: abTrace ? abTrace.count : 0,
        diff: traceAbDiff,
        info: traceAbInfo,
      },


      retrace: {
        version: RETRACE_VERSION,
        tier: retraceTier,
        retracing,
        histReady,
        budgetTiles: retraceBudgetTiles,
        texelCap: retraceTexelCap,
        tilesTotal: retraceTilesTotal,
        tilesTraced: Math.round(retraceTilesTraced),
        passes: retracePasses,
      },
      gpuReady: s.gpuReady === true,

      idle: {
        version: RT_IDLE_VERSION,
        weak: idleWeak,
        reason: idleReason,
        idleMs: Math.round(idleLastIdleMs),
        ticks: idleTicks,
        lastTickMs: Math.round(idleLastTickMs * 100) / 100,
        msPerRay: Math.round(idleMsPerRay * 1e5) / 1e5,
        tickBudgetMs: RT_IDLE_TICK_MS,
        delayMs: RT_IDLE_DELAY_MS,
        onBattery,
        hidden: isDocHidden(),
        mix: Math.round(mixNow * 1000) / 1000,
        converged,
        backend: stats.backend,
      },
      lastError: stats.lastError || s.lastError || null,
    };
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    enabled = false;

    clearIdleTimer();
    try {
      if (visHandler && typeof document !== "undefined" && typeof document.removeEventListener === "function") {
        document.removeEventListener("visibilitychange", visHandler);
      }
    } catch (_e) {            }
    visHandler = null;
    try {
      if (batteryRef && batteryHandler && typeof batteryRef.removeEventListener === "function") {
        batteryRef.removeEventListener("chargingchange", batteryHandler);
      }
    } catch (_e) {            }
    batteryRef = null;
    batteryHandler = null;
    pushOff();
    if (depthRT) {
      depthRT.dispose();
      depthRT = null;
    }
    if (maskTex) {
      maskTex.dispose();
      maskTex = null;
    }
    if (fullDepthRT) {
      fullDepthRT.dispose();
      fullDepthRT = null;
    }
    if (fullTex) {
      fullTex.dispose();
      fullTex = null;
    }
    if (depthMat) depthMat.dispose();

    originsFull = null;
    visAb = null;
    spatialLastDiff = null;

    abTrace = null;
    traceAbDiff = null;
    traceAbInfo = null;
    rt.dispose();
  }


  function setRetraceTier(tier) {
    if (disposed) return;
    const t = typeof tier === "string" && tier ? tier : "off";
    if (t === retraceTier) return;
    retraceTier = t;
  }

  return { supported, setEnabled, isEnabled, setIdlePolicy, setSpatialBackend, setShadowTier, setFullResPolicy, setTraceParity, setRetraceTier, setSun, syncScene, frame, getStats, dispose };
}
