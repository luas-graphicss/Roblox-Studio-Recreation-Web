import {
  CLIPMAP_VERSION,
  CLIPMAP_LIMITS,
  sanitizeClipmapConfig,
  basisFor,
  levelWindow,
  densityTable,
  densityAtDistance,
  speculativeGroundPoints,
  pagesForPoints,
  pagesTouchedByAabb,
  pageKey,
  createClipmapAtlas,
  atlasAlloc,
  atlasStats,
  worldToLightUv,
} from "../lighting/clipmapCore.js";


import { planRenderQueue } from "../lighting/clipmapRenderCore.js";


const sample = {
  seq: 0,
  on: 0,
  levels: 0,
  frames: 0,
  requested: 0,
  newlyAllocated: 0,
  reused: 0,
  evictions: 0,
  dirtyQueued: 0,
  invalidations: 0,
  stableFrames: 0,
};

export function getSunClipmapSample() {
  return sample;
}

export function createSunClipmap(deps) {
  const d = deps && typeof deps === "object" ? deps : {};
  void d;                                                           
  let enabled = false;
  let disposed = false;
  const cfg = sanitizeClipmapConfig(null);
  let atlas = null;
  let lastBasis = null;


  const dirty = new Set();
  let dirtyOverflow = false;


  let renderMode = false;
  const freshKeys = [];                                                      
  const winByLevel = [];                                                    
  let winSigAll = "";
  let tableDirty = true;
  let camU = 0;
  let camV = 0;
  let lastQueue = [];
  const stats = {
    frames: 0,
    invalidations: 0,
    invalidatedPages: 0,
    lastRequested: 0,
    lastNew: 0,
    lastReused: 0,
    lastDirtyCleared: 0,
    stableFrames: 0,
  };
  const tmpForward = { x: 0, y: 0, z: -1 };
  const tmpDir = { x: 0, y: 1, z: 0 };
  const tmpCam = { x: 0, y: 0, z: 0 };

  function publish() {
    sample.seq++;
    sample.on = enabled && !disposed ? 1 : 0;
    sample.levels = cfg.levels;
    sample.frames = stats.frames;
    sample.requested = stats.lastRequested;
    sample.newlyAllocated = stats.lastNew;
    sample.reused = stats.lastReused;
    sample.evictions = atlas ? atlas.evictions : 0;
    sample.dirtyQueued = dirty.size;
    sample.invalidations = stats.invalidations;
    sample.stableFrames = stats.stableFrames;
  }

  function reset() {
    dirty.clear();
    dirtyOverflow = false;
    stats.frames = 0;
    stats.invalidations = 0;
    stats.invalidatedPages = 0;
    stats.lastRequested = 0;
    stats.lastNew = 0;
    stats.lastReused = 0;
    stats.lastDirtyCleared = 0;
    stats.stableFrames = 0;
    lastBasis = null;
    freshKeys.length = 0;
    winByLevel.length = 0;
    winSigAll = "";
    tableDirty = true;
    lastQueue = [];
  }

  function setEnabled(on) {
    const want = on === true && !disposed;
    if (want === enabled) return;
    enabled = want;
    atlas = enabled ? createClipmapAtlas(cfg) : null;
    reset();
    publish();
  }

  function isActive() {
    return enabled && !disposed;
  }


  function noteAabb(aabb) {
    if (!enabled || disposed || !aabb) return false;
    const basis = lastBasis || basisFor(tmpDir.x, tmpDir.y, tmpDir.z);
    const touched = pagesTouchedByAabb(aabb, basis, cfg);
    if (!touched || touched.length === 0) return false;
    let marked = 0;
    for (const t of touched) {
      for (let cc = t.c0; cc <= t.c1; cc++) {
        for (let rr = t.r0; rr <= t.r1; rr++) {
          if (dirty.size >= CLIPMAP_LIMITS.maxTrackedDirty) {


            dirtyOverflow = true;
            break;
          }
          dirty.add(pageKey(t.level, cc, rr));
          marked++;
        }
        if (dirtyOverflow) break;
      }
      if (dirtyOverflow) break;
    }
    stats.invalidations++;
    stats.invalidatedPages += marked;
    publish();
    return marked > 0 || dirtyOverflow;
  }


  function noteRegion(aabb) {
    return noteAabb(aabb);
  }


  function frame(camera, sun) {
    if (!enabled || disposed) return;
    const cam = camera && camera.position ? camera.position : null;
    if (!cam) return;
    tmpCam.x = Number(cam.x) || 0;
    tmpCam.y = Number(cam.y) || 0;
    tmpCam.z = Number(cam.z) || 0;
    const e = camera.matrixWorld && camera.matrixWorld.elements ? camera.matrixWorld.elements : null;
    if (e && Number.isFinite(e[8] + e[9] + e[10])) {

      tmpForward.x = -e[8];
      tmpForward.y = -e[9];
      tmpForward.z = -e[10];
    }
    const t = sun && sun.target && sun.target.position ? sun.target.position : null;
    const sp = sun && sun.position ? sun.position : null;
    if (sp) {
      tmpDir.x = (Number(sp.x) || 0) - (t ? Number(t.x) || 0 : 0);
      tmpDir.y = (Number(sp.y) || 0) - (t ? Number(t.y) || 0 : 0);
      tmpDir.z = (Number(sp.z) || 0) - (t ? Number(t.z) || 0 : 0);
    }
    lastBasis = basisFor(tmpDir.x, tmpDir.y, tmpDir.z);
    if (renderMode) {


      const uv = worldToLightUv(tmpCam.x, tmpCam.y, tmpCam.z, lastBasis);
      camU = uv.u;
      camV = uv.v;
      let sig = "";
      for (let n = 0; n < cfg.levels; n++) {
        const w = levelWindow(cfg, n, tmpCam.x, tmpCam.y, tmpCam.z, lastBasis);
        winByLevel[n] = w;
        sig += w.signature + ";";
      }
      if (sig !== winSigAll) {
        winSigAll = sig;
        tableDirty = true;
      }
      freshKeys.length = 0;
    }
    const pts = speculativeGroundPoints(tmpCam, tmpForward, cfg);
    const req = pagesForPoints(pts, tmpCam, lastBasis, cfg);
    let fresh = 0;
    let reused = 0;
    let cleared = 0;
    if (dirtyOverflow) {
      if (renderMode) {


        dirtyOverflow = false;
        invalidateAll();
      } else {


        cleared = dirty.size;
        dirty.clear();
        dirtyOverflow = false;
      }
    }
    for (const k of req.keys) {
      const r = atlasAlloc(atlas, k);
      if (r.fresh) {
        fresh++;
        if (renderMode) {


          freshKeys.push(k);
          if (r.evicted) dirty.delete(r.evicted);
          tableDirty = true;
        }
      } else {
        reused++;
      }


      if (!renderMode && dirty.size > 0 && dirty.delete(k)) cleared++;
    }
    stats.lastRequested = req.keys.length;
    stats.lastNew = fresh;
    stats.lastReused = reused;
    stats.lastDirtyCleared = cleared;
    stats.frames++;


    stats.stableFrames = fresh === 0 ? stats.stableFrames + 1 : 0;
    publish();
  }


  function setRenderMode(on) {
    renderMode = on === true;
  }

  function slotForKey(k) {
    if (!atlas || !atlas.map) return -1;
    const v = atlas.map.get(k);
    if (typeof v === "number") return v;
    if (v && typeof v.slot === "number") return v.slot;
    return -1;
  }


  function invalidateAll() {
    if (!atlas || !atlas.map) return 0;
    let n = 0;
    for (const k of atlas.map.keys()) {
      if (dirty.size >= CLIPMAP_LIMITS.maxTrackedDirty) break;
      dirty.add(k);
      n++;
    }
    if (n > 0) {
      stats.invalidations++;
      stats.invalidatedPages += n;
      tableDirty = true;
      publish();
    }
    return n;
  }


  const renderState = { cfg, basis: null, camU: 0, camV: 0, windows: winByLevel, atlasMap: null, dirty };
  function getRenderState() {
    renderState.basis = lastBasis;
    renderState.camU = camU;
    renderState.camV = camV;
    renderState.atlasMap = atlas ? atlas.map : null;
    return renderState;
  }


  function tableNeedsRebuild() {
    const t = tableDirty;
    tableDirty = false;
    return t;
  }


  function takeRenderQueue(budget) {
    lastQueue = [];
    if (!enabled || disposed || !renderMode || !atlas) return lastQueue;
    const dirtyArr = dirty.size > 0 ? Array.from(dirty) : [];
    const plan = planRenderQueue(freshKeys, dirtyArr, slotForKey, budget);
    for (const k of plan.deferredFreshKeys) {
      if (dirty.size < CLIPMAP_LIMITS.maxTrackedDirty) dirty.add(k);
    }
    for (const k of plan.consumedKeys) dirty.delete(k);
    for (const k of plan.droppedKeys) dirty.delete(k);
    freshKeys.length = 0;
    if (plan.items.length > 0) tableDirty = true;
    lastQueue = plan.items;
    publish();
    return lastQueue;
  }

  function getStats() {
    const a = atlasStats(atlas);
    return {
      version: CLIPMAP_VERSION,
      on: isActive() ? 1 : 0,
      planningOnly: !renderMode,                                                
      renderMode: renderMode ? 1 : 0,
      levels: cfg.levels,
      gridPerLevel: cfg.gridPerLevel,
      pageSize: cfg.pageSize,
      virtualRes: cfg.virtualRes,
      level0Half: cfg.level0Half,
      atlas: {
        size: cfg.atlasSize,
        capacity: a.capacity,
        used: a.used,
        evictions: a.evictions,
      },
      lastFrame: {
        requested: stats.lastRequested,
        newlyAllocated: stats.lastNew,
        reused: stats.lastReused,
        dirtyCleared: stats.lastDirtyCleared,
      },
      frames: stats.frames,
      stableFrames: stats.stableFrames,
      invalidations: stats.invalidations,
      invalidatedPages: stats.invalidatedPages,
      dirtyQueued: dirty.size,
      dirtyOverflow,
      density: densityTable(cfg),
      densityAt10: densityAtDistance(cfg, 10),
      densityAt1000: densityAtDistance(cfg, 1000),
    };
  }

  function dispose() {
    disposed = true;
    enabled = false;
    atlas = null;
    reset();
    publish();
  }

  publish();
  return {
    setEnabled,
    isActive,
    frame,
    noteAabb,
    noteRegion,

    setRenderMode,
    invalidateAll,
    getRenderState,
    tableNeedsRebuild,
    takeRenderQueue,
    getStats,
    dispose,
  };
}
