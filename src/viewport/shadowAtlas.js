import {
  SA_PAD,
  SA_META_TEXELS,
  SA_ML_MAX,
  SA_META_TEX_W,
  SA_TOP_MAX,
  SA_DEFAULT_BIAS,
  SA_DEFAULT_SAMPLES,
  saAtlasSizeFor,
  saResFor,
  saStepRes,
  saSlotUv,
  saWriteMetaEntry,
  saClearMetaEntry,
  buildAtlasGlsl,
  createSaAllocator,
} from "../lighting/shadowAtlasCore.js";


import { createAtlasMetaUploadGate } from "../lighting/llAtlasMetaUploadGate.js";
import { createMsmAtlasFrameScheduler } from './msmAtlasFrameScheduler.js';

export { buildAtlasGlsl, SA_META_TEX_W, SA_META_TEXELS, SA_ML_MAX, SA_TOP_MAX,
  SA_DEFAULT_BIAS, SA_DEFAULT_SAMPLES };


export function createShadowAtlas(opts) {
  const o = opts || {};
  const THREE = o.THREE;
  if (!THREE) throw new Error("createShadowAtlas: THREE é obrigatório");
  const renderer = o.renderer;
  const maxTex = Number(o.maxTextureSize) ||
    (renderer && renderer.capabilities ? renderer.capabilities.maxTextureSize : 4096);
  const atlasSize = saAtlasSizeFor(maxTex, !!o.allow8k);


  if (!atlasSize) {
    return {
      enabled: false,
      frame() {},
      getMetaTex() { return null; },
      getAtlasTex() { return null; },
      getAtlasSize() { return 0; },
      getTopList() { return []; },
      getStats() { return { atlasSize: 0, slots: 0, evictions: 0, fails: 0, topCount: 0, frames: 0 }; },
      dispose() {},
    };
  }


  let rt = null;
  function ensureRt() {
    if (rt) return rt;
    rt = new THREE.WebGLRenderTarget(atlasSize, atlasSize, {
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      format: THREE.RGBAFormat,
      type: THREE.UnsignedByteType,
      depthBuffer: true,
      stencilBuffer: false,
    });
    rt.texture.generateMipmaps = false;
    rt.texture.name = 'rsw-shadow-atlas';
    return rt;
  }


  const metaData = new Float32Array(SA_META_TEX_W * 4);
  const metaTex = new THREE.DataTexture(
    metaData, SA_META_TEX_W, 1, THREE.RGBAFormat, THREE.FloatType
  );
  metaTex.minFilter = THREE.NearestFilter;
  metaTex.magFilter = THREE.NearestFilter;
  metaTex.generateMipmaps = false;
  metaTex.name = 'rsw-atlas-meta';

  const alloc = createSaAllocator(atlasSize);
  const msmScheduler = createMsmAtlasFrameScheduler();
  let topList = [];                                                      
  let frameStats = { atlasSize, slots: 0, evictions: 0, fails: 0, topCount: 0, frames: 0 };


  const tileCamera = new THREE.PerspectiveCamera(90, 1, 0.5, 1000);


  const tileVP = new THREE.Matrix4();

  const oldScissor = new THREE.Vector4();
  const oldViewport = new THREE.Vector4();
  const oldClearColor = new THREE.Color();


  let metaZeroed = true;
  let frameCount = 0;


  const metaUploadGate = createAtlasMetaUploadGate();
  function clearAllMeta(force = false) {
    if (metaZeroed && !force) return;
    metaData.fill(0);
    metaTex.needsUpdate = true;


    metaUploadGate.markUploaded(metaData);
    metaZeroed = true;
  }


  const prevRes = new Map();


  const prevPlacement = new Map();
  let prevAtlasRt = null;


  function frame(state, rdr) {
    frameCount++;
    frameStats.frames = frameCount;
    const r = rdr || renderer;


    if (!state || !state.atlasWanted || !r || typeof state.renderSceneDepth !== "function") {
      clearAllMeta();
      if (topList.length) topList = [];
      frameStats.slots = 0;
      frameStats.topCount = 0;
      frameStats.msmSchedule = null;
      msmScheduler.reset();
      return;
    }

    const lights = Array.isArray(state.lights) ? state.lights : [];
    const threeSpots = Array.isArray(state.spotThreeLights) ? state.spotThreeLights : [];
    const n = Math.min(lights.length, SA_ML_MAX);


    const spotById = new Map();
    for (const sl of threeSpots) {
      if (sl && sl.isSpotLight && sl.userData && sl.userData.__rswAtlasId) {
        spotById.set(sl.userData.__rswAtlasId, sl);
      }
    }


    const requests = [];
    const rankById = new Map();
    for (let i = 0; i < n; i++) {
      const l = lights[i];
      if (!l || !l.id || !spotById.has(l.id)) continue;
      const pr = prevRes.get(l.id) || 0;


      const plannedRes = state.resolutionByLightId ? Number(state.resolutionByLightId[l.id]) || 0 : 0;
      const want = plannedRes > 0 ? plannedRes : saResFor(i, n);
      const res = saStepRes(pr, want);
      prevRes.set(l.id, res);
      rankById.set(l.id, i);
      requests.push({ id: l.id, rank: i, res });
    }

    for (const id of prevRes.keys()) {
      if (!rankById.has(id)) prevRes.delete(id);
    }


    const cubeFaceList = Array.isArray(state.cubeFaces) ? state.cubeFaces : [];
    const cubeFaceById = new Map();
    for (const face of cubeFaceList) {
      if (!face || !face.id) continue;
      const faceMetaRow = Math.floor(Number(face.metaRow) || 0);
      if (faceMetaRow < 0 || faceMetaRow >= SA_ML_MAX) continue;
      const faceRes = Math.max(1, Math.floor(Number(face.res) || 0));
      cubeFaceById.set(face.id, face);
      requests.push({ id: face.id, rank: faceMetaRow, res: faceRes });
    }

    const plan = alloc.plan(requests);


    topList = plan.placed
      .filter((p) => rankById.has(p.id))
      .slice()
      .sort((a, b) => {
        const ra = rankById.get(a.id);
        const rb = rankById.get(b.id);
        return (ra === undefined ? 999 : ra) - (rb === undefined ? 999 : rb);
      })
      .slice(0, SA_TOP_MAX);


    const oldScissorTest = r.getScissorTest();
    r.getScissor(oldScissor);
    r.getViewport(oldViewport);
    r.getClearColor(oldClearColor);
    const oldClearAlpha = r.getClearAlpha();
    const oldRT = r.getRenderTarget();
    const atlasRt = ensureRt();
    const msmSchedule = msmScheduler.plan({ request: state.msmSchedule, placements: plan.placed,
      spotById, cubeFaceById, rankById, lights, atlasTarget: atlasRt });
    let msmRenderedPages = 0;
    const hookBegin = typeof state.renderSceneDepth.begin === "function" ? state.renderSceneDepth.begin : null;
    const hookEnd = typeof state.renderSceneDepth.end === "function" ? state.renderSceneDepth.end : null;
    const writtenRanks = new Set();
    const hadData = !metaZeroed;
    let completed = false;
    let hookAttempted = false;
    try {
    r.setRenderTarget(atlasRt);


    const redrawPolicy = msmSchedule ? { persistent: true }
      : state.redrawPolicy && state.redrawPolicy.persistent === true ? state.redrawPolicy : null;
    if (!redrawPolicy || prevAtlasRt !== atlasRt) {
      prevPlacement.clear();
      prevAtlasRt = atlasRt;
    }

    if (!redrawPolicy) {


      r.setScissorTest(false);
      r.setClearColor(0xffffff, 1);
      r.clear(true, true, false);
      r.setScissorTest(true);
    } else {


      r.setClearColor(0xffffff, 1);
      r.setScissorTest(true);
    }


    const shouldRedrawTile = (placed) => {
      if (msmSchedule) return msmSchedule.shouldRender(placed.id);
      if (!redrawPolicy) return true;
      const seen = prevPlacement.get(placed.id);
      if (!seen || seen.x !== placed.x || seen.y !== placed.y || seen.res !== placed.res) return true;
      return !redrawPolicy.dirtyIds || redrawPolicy.dirtyIds[placed.id] === true;
    };


    hookAttempted = true;
    if (hookBegin) hookBegin(r);
    for (const placed of plan.placed) {

      if (msmSchedule && !msmSchedule.canPublish(placed.id)) continue;


      const cubeFace = cubeFaceById.get(placed.id);
      if (cubeFace) {
        const cubeMetaRow = Math.floor(Number(cubeFace.metaRow) || 0);
        const cubeRange = Math.max(0.1, Number(cubeFace.range) || 0);
        const cubeNear = Math.min(Math.max(0.05, cubeRange * 0.01), cubeRange * 0.5);
        tileCamera.up.set(cubeFace.upX, cubeFace.upY, cubeFace.upZ);
        tileCamera.position.set(cubeFace.x, cubeFace.y, cubeFace.z);
        tileCamera.lookAt(
          cubeFace.x + cubeFace.forwardX,
          cubeFace.y + cubeFace.forwardY,
          cubeFace.z + cubeFace.forwardZ
        );
        tileCamera.fov = Math.min(175, (Number(cubeFace.halfAngleRad) || 0.79) * 2 * 180 / Math.PI);
        tileCamera.near = cubeNear;
        tileCamera.far = cubeRange;
        tileCamera.aspect = 1;
        tileCamera.updateProjectionMatrix();
        tileCamera.updateMatrixWorld(true);
        r.setScissor(placed.x, placed.y, placed.res, placed.res);
        r.setViewport(placed.x, placed.y, placed.res, placed.res);

        if (shouldRedrawTile(placed)) {
          if (redrawPolicy) r.clear(true, true, false);
          state.renderSceneDepth(r, tileCamera);
          msmRenderedPages += 1;
          prevPlacement.set(placed.id, { x: placed.x, y: placed.y, res: placed.res });
        }
        tileVP.multiplyMatrices(tileCamera.projectionMatrix, tileCamera.matrixWorldInverse);
        const cubeUvs = saSlotUv(placed.x, placed.y, placed.res, atlasSize, SA_PAD);
        saWriteMetaEntry(metaData, cubeMetaRow, tileVP.elements, cubeUvs);
        writtenRanks.add(cubeMetaRow);

        tileCamera.up.set(0, 1, 0);
        continue;
      }
      const sl = spotById.get(placed.id);
      const rank = rankById.get(placed.id);
      if (!sl || rank === undefined) continue;


      const sp = sl.position;
      const ti = sl.target && sl.target.position ? sl.target.position : { x: 0, y: 0, z: 0 };


      const mlRef = lights[rank];
      const range = Math.max(0.1, (mlRef && Number(mlRef.range)) || sl.distance || 1);
      const angle = sl.angle || 0.8;
      const near = Math.min(Math.max(0.05, range * 0.01), range * 0.5);

      tileCamera.position.set(sp.x, sp.y, sp.z);
      tileCamera.lookAt(ti.x, ti.y, ti.z);
      tileCamera.fov = Math.min(175, (angle * 2 * 180 / Math.PI) * 1.01);                         
      tileCamera.near = near;
      tileCamera.far = range;
      tileCamera.aspect = 1;
      tileCamera.updateProjectionMatrix();
      tileCamera.updateMatrixWorld(true);


      r.setScissor(placed.x, placed.y, placed.res, placed.res);
      r.setViewport(placed.x, placed.y, placed.res, placed.res);


      if (shouldRedrawTile(placed)) {
        if (redrawPolicy) r.clear(true, true, false);
        state.renderSceneDepth(r, tileCamera);
        msmRenderedPages += 1;
        prevPlacement.set(placed.id, { x: placed.x, y: placed.y, res: placed.res });
      }


      tileVP.multiplyMatrices(tileCamera.projectionMatrix, tileCamera.matrixWorldInverse);
      const uvs = saSlotUv(placed.x, placed.y, placed.res, atlasSize, SA_PAD);
      saWriteMetaEntry(metaData, rank, tileVP.elements, uvs);
      writtenRanks.add(rank);
    }
    completed = true;
    } finally {
      try { if (hookAttempted && hookEnd) hookEnd(r); }
      catch (error) { completed = false; throw error; }
      finally {
        if (!completed) {
          if (msmSchedule) msmScheduler.rejectDraws(msmSchedule.selected);

          clearAllMeta(true); prevPlacement.clear();
          frameStats.msmSchedule = msmSchedule ? { ...msmScheduler.describe(), actualRenderedPages: msmRenderedPages, drawFailed: true } : null;
        }
        r.setRenderTarget(oldRT);
        r.setScissorTest(oldScissorTest);
        r.setScissor(oldScissor.x, oldScissor.y, oldScissor.z, oldScissor.w);
        r.setViewport(oldViewport.x, oldViewport.y, oldViewport.z, oldViewport.w);
        r.setClearColor(oldClearColor, oldClearAlpha);
        tileCamera.up.set(0, 1, 0);
      }
    }


    for (let i = 0; i < SA_ML_MAX; i++) {
      if (!writtenRanks.has(i)) saClearMetaEntry(metaData, i);
    }


    if (writtenRanks.size > 0 || hadData) {
      if (metaUploadGate.shouldUpload(metaData)) metaTex.needsUpdate = true;
    }
    metaZeroed = writtenRanks.size === 0;

    const als = alloc.stats();
    frameStats.slots = als.slots;
    frameStats.evictions = als.evictions;
    frameStats.fails = als.fails;
    frameStats.topCount = topList.length;
    frameStats.msmSchedule = msmSchedule ? { ...msmScheduler.describe(), actualRenderedPages: msmRenderedPages } : null;
  }

  function getMetaTex() { return metaTex; }
  function getAtlasTex() { return rt ? rt.texture : null; }
  function getAtlasSize() { return atlasSize; }
  function getTopList() { return topList; }
  function getStats() { return frameStats; }

  function dispose() {
    if (rt) { rt.dispose(); rt = null; }
    metaTex.dispose();
    prevRes.clear();
    prevPlacement.clear();
    prevAtlasRt = null;
    msmScheduler.reset();
  }

  return { enabled: true, frame, getMetaTex, getAtlasTex, getAtlasSize, getTopList, getStats, dispose };
}


export function createAtlasDepthRenderer(opts) {
  const o = opts || {};
  const THREE = o.THREE;
  const scene = o.scene;
  if (!THREE || !scene || typeof scene.traverse !== "function") return null;
  const depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
  depthMat.name = "rsw-atlas-depth";


  if (THREE.DoubleSide !== undefined) depthMat.side = THREE.DoubleSide;
  const hidden = [];
  let saved = null;
  function isNonCaster(obj) {
    if (obj.visible === false) return false;                           
    if (obj.isLine || obj.isSprite || obj.isPoints) return true;                       
    if (!obj.isMesh) return false;                                     
    if (obj.castShadow === false) return true;                     
    const m = Array.isArray(obj.material) ? obj.material[0] : obj.material;
    if (m && m.transparent === true) return true;                                   
    return false;
  }
  const hook = function renderSceneDepth(r, tileCamera) {
    if (!r || !tileCamera) return;
    r.render(scene, tileCamera);
  };
  hook.begin = function begin(r) {
    if (saved) return;                                                  
    saved = {
      override: scene.overrideMaterial,
      background: scene.background,
      fog: scene.fog,
      shadowAuto: r && r.shadowMap ? r.shadowMap.autoUpdate : null,
      shadowNeeds: r && r.shadowMap ? r.shadowMap.needsUpdate : null,
    };
    scene.overrideMaterial = depthMat;
    scene.background = null;
    scene.fog = null;
    if (r && r.shadowMap) {
      r.shadowMap.autoUpdate = false;
      r.shadowMap.needsUpdate = false;
    }
    hidden.length = 0;
    scene.traverse(function (obj) {
      if (isNonCaster(obj)) {
        hidden.push(obj);
        obj.visible = false;
      }
    });
  };
  hook.end = function end(r) {
    if (!saved) return;
    for (let i = 0; i < hidden.length; i++) hidden[i].visible = true;
    hidden.length = 0;
    scene.overrideMaterial = saved.override;
    scene.background = saved.background;
    scene.fog = saved.fog;
    if (r && r.shadowMap && saved.shadowAuto !== null) {
      r.shadowMap.autoUpdate = saved.shadowAuto;
      r.shadowMap.needsUpdate = saved.shadowNeeds;
    }
    saved = null;
  };
  hook.dispose = function dispose() {
    depthMat.dispose();
    hidden.length = 0;
    saved = null;
  };
  return hook;
}
