import {
  PAGE_LIMITS,
  PAGE_SIZE_PX,
  createPageTable,
  makeWindow,
  windowSignature,
  worldToUv,
  aabbToPageRect,
  aabbInsideWindow,
  invalidateRect,
  planPages,
  mergePagesToRects,
  scissorToOrtho,
  unionAabb,
} from "../lighting/shadowPagesCore.js";


const MAX_TRACKED_AABBS = 4096;

const MAX_SLOTS = 4;


const sample = {
  seq: 0,
  active: 0,
  csm: 0,
  grid: 0,
  pagesPending: 0,
  pagesRendered: 0,
  lastPagesRendered: 0,
  fullPasses: 0,
  partialPasses: 0,
  cascadeFullPasses: 0,
  lastRenderMs: 0,
  queuedRects: 0,
};

export function getSunShadowPageSample() {
  return sample;
}

export function createSunShadowPages({ THREE, renderer, scene, sun, getFocus, requestRender, getCascadeLights }) {
  const ok = !!(THREE && renderer && scene && sun);
  let enabled = false;
  let disposed = false;

  let csmOn = false;
  let csmCount = 1;

  const slots = [{ light: sun, table: null, win: null, sig: "none", queued: [] }];
  const lastAabb = new Map();                                          
  const stats = {
    pagesRendered: 0,
    lastPagesRendered: 0,
    fullPasses: 0,
    partialPasses: 0,
    cascadeFullPasses: 0,
    lastRenderMs: 0,
  };


  let depthMats = null;
  let subCam = null;
  let frustum = null;
  let projScreen = null;
  let prevClear = null;

  function nowMs() {
    return typeof performance !== "undefined" && performance.now ? performance.now() : Date.now();
  }

  function activeSlotCount() {
    return csmOn ? Math.max(1, Math.min(csmCount, MAX_SLOTS)) : 1;
  }


  function slotAt(c) {
    if (c === 0) return slots[0];
    if (!slots[c]) {
      const lights = typeof getCascadeLights === "function" ? getCascadeLights() : null;
      const light = lights && lights[c - 1] ? lights[c - 1] : null;
      if (!light) return null;
      slots[c] = { light, table: null, win: null, sig: "none", queued: [] };
    }
    return slots[c];
  }


  function queuedPagesOf(s) {
    if (!s || !s.queued || s.queued.length === 0) return 0;
    let n = 0;
    for (const r of s.queued) n += (r.c1 - r.c0 + 1) * (r.r1 - r.r0 + 1);
    return n;
  }

  function pendingTotal() {
    let t = 0;
    for (let c = 0; c < activeSlotCount(); c++) {
      const s = slots[c];
      if (!s) continue;
      if (s.table) t += s.table.dirtyCount;
      t += queuedPagesOf(s);
    }
    return t;
  }


  const MAX_QUEUED_RECTS = 64;
  function queueRect(slot, rect) {
    const q = slot.queued || (slot.queued = []);
    const last = q.length > 0 ? q[q.length - 1] : null;
    if (last && last.c0 === rect.c0 && last.r0 === rect.r0 && last.c1 === rect.c1 && last.r1 === rect.r1) {
      return 1;                                                      
    }
    if (last && q.length >= MAX_QUEUED_RECTS) {


      last.c0 = Math.min(last.c0, rect.c0);
      last.r0 = Math.min(last.r0, rect.r0);
      last.c1 = Math.max(last.c1, rect.c1);
      last.r1 = Math.max(last.r1, rect.r1);
      return 1;
    }
    q.push({ c0: rect.c0, r0: rect.r0, c1: rect.c1, r1: rect.r1 });
    return 1;
  }


  function flushQueued() {
    let applied = 0;
    for (let c = 0; c < slots.length; c++) {
      const s = slots[c];
      if (!s || !s.queued || s.queued.length === 0) continue;
      if (s.table) {
        for (const r of s.queued) applied += invalidateRect(s.table, r);
      }
      s.queued.length = 0;
    }
    return applied;
  }

  function publish() {
    sample.seq++;
    sample.active = enabled && !disposed ? 1 : 0;
    sample.csm = csmOn ? 1 : 0;
    sample.grid = slots[0].table ? slots[0].table.grid : 0;
    sample.pagesPending = pendingTotal();
    let qr = 0;
    for (const s of slots) {
      if (s && s.queued) qr += s.queued.length;
    }
    sample.queuedRects = qr;
    sample.pagesRendered = stats.pagesRendered;
    sample.lastPagesRendered = stats.lastPagesRendered;
    sample.fullPasses = stats.fullPasses;
    sample.partialPasses = stats.partialPasses;
    sample.cascadeFullPasses = stats.cascadeFullPasses;
    sample.lastRenderMs = stats.lastRenderMs;
  }

  function ensureThreeState() {
    if (depthMats) return;
    const mk = (side) => {
      const m = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
      m.side = side;
      return m;
    };
    depthMats = {
      [THREE.FrontSide]: mk(THREE.FrontSide),
      [THREE.BackSide]: mk(THREE.BackSide),
      [THREE.DoubleSide]: mk(THREE.DoubleSide),
    };
    subCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 10);
    subCam.matrixAutoUpdate = false;
    frustum = new THREE.Frustum();
    projScreen = new THREE.Matrix4();
    prevClear = new THREE.Color();
  }


  function depthMatFor(mat) {
    if (!mat) return depthMats[THREE.BackSide];
    if (mat.shadowSide !== null && mat.shadowSide !== undefined) {
      return depthMats[mat.shadowSide] || depthMats[THREE.BackSide];
    }
    if (mat.side === THREE.BackSide) return depthMats[THREE.FrontSide];
    if (mat.side === THREE.DoubleSide) return depthMats[THREE.DoubleSide];
    return depthMats[THREE.BackSide];
  }

  function setEnabled(on) {
    const want = !!on && ok && !disposed;
    if (want === enabled) return;
    enabled = want;

    for (const s of slots) {
      if (!s) continue;
      s.sig = "none";
      s.table = null;
      s.win = null;
      if (s.queued) s.queued.length = 0;
    }
    if (!enabled) lastAabb.clear();
    publish();
  }

  function isActive() {
    return enabled && !disposed;
  }

  function syncSlotWindow(slot, args) {


    const a0 = args || {};
    const rk = slot.rawKey || (slot.rawKey = new Float64Array(8));
    if (
      slot.table &&
      rk[0] === a0.cx && rk[1] === a0.cy && rk[2] === a0.cz &&
      rk[3] === a0.half && rk[4] === a0.mapSize &&
      rk[5] === a0.dirX && rk[6] === a0.dirY && rk[7] === a0.dirZ
    ) {
      return;
    }
    rk[0] = a0.cx; rk[1] = a0.cy; rk[2] = a0.cz;
    rk[3] = a0.half; rk[4] = a0.mapSize;
    rk[5] = a0.dirX; rk[6] = a0.dirY; rk[7] = a0.dirZ;
    const w = makeWindow(args);
    const s = windowSignature(w);
    if (s === slot.sig && slot.table) {


      return;
    }
    slot.sig = s;
    slot.win = w;
    slot.table = createPageTable(w.mapSize, PAGE_SIZE_PX);


    if (slot.queued) slot.queued.length = 0;
    publish();
  }


  function syncWindow(args) {
    if (!enabled || disposed) return;
    if (csmOn) syncCsm({ on: false, count: 1 });
    syncSlotWindow(slots[0], args);
  }


  function syncCsm(args) {
    if (!enabled || disposed) return;
    const a = args || {};
    const on = a.on === true;
    const count = Math.max(1, Math.min(MAX_SLOTS, Math.round(Number(a.count) || 1)));
    if (on === csmOn && count === csmCount) return;
    const modeChanged = on !== csmOn;
    csmOn = on;
    csmCount = count;
    for (let c = 1; c < slots.length; c++) {
      const s = slots[c];
      if (!s) continue;
      if (!csmOn || c >= count) {
        s.table = null;
        s.win = null;
        s.sig = "none";
        if (s.queued) s.queued.length = 0;
      }
    }


    if (modeChanged) {
      slots[0].sig = "none";
      slots[0].table = null;
      slots[0].win = null;
      if (slots[0].queued) slots[0].queued.length = 0;
    }
    publish();
  }


  function syncCascadeWindow(c, args) {
    if (!enabled || disposed || !csmOn) return;
    const idx = Math.round(Number(c) || 0);
    if (idx < 0 || idx >= activeSlotCount()) return;
    const slot = slotAt(idx);
    if (!slot) return;
    syncSlotWindow(slot, args);
  }


  function markSlots(aabb) {


    const cOuter = activeSlotCount() - 1;
    const outer = cOuter === 0 ? slots[0] : slotAt(cOuter);
    if (!outer || !outer.table || !outer.win) return false;
    if (!aabbInsideWindow(aabb, outer.win, outer.table, PAGE_LIMITS.padTexels)) return false;
    let okAll = true;
    let marked = 0;
    for (let c = 0; c < activeSlotCount(); c++) {
      const s = c === 0 ? slots[0] : slotAt(c);
      if (!s || !s.table || !s.win) {
        okAll = false;
        continue;
      }

      if (c > 0 && s.light && s.light.castShadow === false) continue;
      const rect = aabbToPageRect(aabb, s.win, s.table, PAGE_LIMITS.padTexels);


      if (rect) marked += queueRect(s, rect);
    }
    if (marked > 0) {
      publish();
      if (requestRender) requestRender();
    }
    return okAll;
  }


  function noteAabb(id, aabb) {
    if (!enabled || disposed || !aabb) return false;
    if (!slots[0].table || !slots[0].win) return false;
    const prev = lastAabb.get(id) || null;
    const union = unionAabb(prev, aabb);


    if (lastAabb.has(id)) {
      lastAabb.delete(id);
    } else if (lastAabb.size >= MAX_TRACKED_AABBS) {
      const oldest = lastAabb.keys().next().value;
      if (oldest !== undefined) lastAabb.delete(oldest);
    }
    lastAabb.set(id, aabb);


    if (!prev) return false;
    return markSlots(union);
  }


  function noteRegion(aabb) {
    if (!enabled || disposed || !aabb) return false;
    if (!slots[0].table || !slots[0].win) return false;
    return markSlots(aabb);
  }

  function validateSlot(slot) {
    if (slot && slot.table) {
      slot.table.state.fill(0);
      slot.table.dirtyCount = 0;
    }

    if (slot && slot.queued) slot.queued.length = 0;
  }


  function noteFullPass() {
    if (!enabled || disposed) return;
    for (let c = 0; c < slots.length; c++) validateSlot(slots[c]);
    stats.fullPasses++;
    stats.lastPagesRendered = 0;
    publish();
  }


  function noteCascadeFullPass(c) {
    if (!enabled || disposed) return;
    const idx = Math.round(Number(c) || 0);
    const slot = idx >= 0 && idx < slots.length ? slots[idx] : null;
    if (!slot || !slot.table) return;
    validateSlot(slot);
    stats.cascadeFullPasses++;
    publish();
  }


  function scheduleSlotFullPass(slot, c) {
    if (slot.light && slot.light.shadow) slot.light.shadow.needsUpdate = true;
    renderer.shadowMap.needsUpdate = true;
    validateSlot(slot);
    if (csmOn && c > 0) stats.cascadeFullPasses++;
    else stats.fullPasses++;
  }


  function renderPageObjects(node) {
    if (!node || node.visible === false) return;
    if (node.isMesh && node.castShadow) {
      const isPool = node.isInstancedMesh === true;
      if (!isPool || node.count > 0) {
        const cull = node.frustumCulled !== false && !isPool;
        if (!cull || frustum.intersectsObject(node)) {
          const geometry = node.geometry;
          const material = node.material;
          if (geometry && material) {
            node.modelViewMatrix.multiplyMatrices(subCam.matrixWorldInverse, node.matrixWorld);
            if (Array.isArray(material)) {
              const groups = geometry.groups || [];
              for (const group of groups) {
                const m = material[group.materialIndex];
                if (m && m.visible !== false) {
                  const dm = node.customDepthMaterial || depthMatFor(m);
                  renderer.renderBufferDirect(subCam, null, geometry, dm, node, group);
                }
              }
            } else if (material.visible !== false) {
              const dm = node.customDepthMaterial || depthMatFor(material);
              renderer.renderBufferDirect(subCam, null, geometry, dm, node, null);
            }
          }
        }
      }
    }
    const children = node.children;
    for (let i = 0; i < children.length; i++) renderPageObjects(children[i]);
  }


  function renderSlotPages(slot, c, budget) {
    const light = slot.light;
    const shadow = light ? light.shadow : null;
    const map = shadow ? shadow.map : null;


    if (!map || !map.texture || !shadow.camera || shadow.mapSize.x !== slot.win.mapSize) {
      scheduleSlotFullPass(slot, c);
      return 0;
    }

    const total = slot.table.grid * slot.table.grid;
    if (slot.table.dirtyCount > total * PAGE_LIMITS.fullRatio) {
      scheduleSlotFullPass(slot, c);
      return 0;
    }
    ensureThreeState();

    let fu = 0.5, fv = 0.5;
    const f = getFocus ? getFocus() : null;
    const uv = f ? worldToUv(f.x, f.y, f.z, slot.win) : null;
    if (uv) { fu = uv.u; fv = uv.v; }
    const plan = planPages(slot.table, budget, fu, fv);
    if (plan.pages.length === 0) return 0;
    const rects = mergePagesToRects(plan.pages, slot.table);


    const prevTarget = renderer.getRenderTarget();
    renderer.getClearColor(prevClear);
    const prevAlpha = renderer.getClearAlpha();
    renderer.setClearColor(0xffffff, 1);                                
    try {
      for (const rect of rects) {
        const o = scissorToOrtho(rect, slot.table, slot.win.half);
        if (!o) continue;
        subCam.left = o.left;
        subCam.right = o.right;
        subCam.top = o.top;
        subCam.bottom = o.bottom;
        subCam.near = shadow.camera.near;
        subCam.far = shadow.camera.far;
        subCam.updateProjectionMatrix();
        subCam.matrixWorld.copy(shadow.camera.matrixWorld);
        subCam.matrixWorldInverse.copy(shadow.camera.matrixWorldInverse);
        projScreen.multiplyMatrices(subCam.projectionMatrix, subCam.matrixWorldInverse);
        frustum.setFromProjectionMatrix(projScreen);
        map.viewport.set(rect.x, rect.y, rect.w, rect.h);
        map.scissor.set(rect.x, rect.y, rect.w, rect.h);
        map.scissorTest = true;
        renderer.setRenderTarget(map);
        renderer.clear(true, true, false);
        renderPageObjects(scene);
      }
    } finally {


      map.viewport.set(0, 0, slot.win.mapSize, slot.win.mapSize);
      map.scissor.set(0, 0, slot.win.mapSize, slot.win.mapSize);
      map.scissorTest = false;
      renderer.setRenderTarget(prevTarget);
      renderer.setClearColor(prevClear, prevAlpha);
    }
    return plan.pages.length;
  }


  function renderPending() {
    if (!enabled || disposed) return false;
    stats.lastPagesRendered = 0;
    if (pendingTotal() <= 0) return false;


    if (scene && typeof scene.updateMatrixWorld === "function") scene.updateMatrixWorld();
    const t0 = nowMs();
    let budget = PAGE_LIMITS.defaultBudget;
    let did = false;
    for (let c = 0; c < activeSlotCount() && budget > 0; c++) {
      const slot = c === 0 ? slots[0] : slotAt(c);
      if (!slot || !slot.table || !slot.win || slot.table.dirtyCount <= 0) continue;
      if (c > 0 && slot.light && slot.light.castShadow === false) continue;
      const done = renderSlotPages(slot, c, budget);
      if (done > 0) {
        budget -= done;
        stats.lastPagesRendered += done;
        stats.pagesRendered += done;
        stats.partialPasses++;
      }
      did = true;
    }


    const flushed = flushQueued();
    if (did) stats.lastRenderMs = nowMs() - t0;
    if (did || flushed > 0) publish();


    if (pendingTotal() > 0 && requestRender) requestRender();
    return did || flushed > 0;
  }

  function getStats() {
    const perSlot = [];
    for (let c = 0; c < activeSlotCount(); c++) {
      const s = slots[c];
      perSlot.push({
        cascade: c,
        grid: s && s.table ? s.table.grid : 0,
        pending: s && s.table ? s.table.dirtyCount : 0,
        queued: s && s.queued ? s.queued.length : 0,
      });
    }
    return {
      version: 2,
      active: enabled && !disposed ? 1 : 0,
      csm: csmOn ? 1 : 0,
      cascades: activeSlotCount(),
      grid: slots[0].table ? slots[0].table.grid : 0,
      pagesPending: pendingTotal(),
      queuedRects: (() => {
        let qr = 0;
        for (const s of slots) {
          if (s && s.queued) qr += s.queued.length;
        }
        return qr;
      })(),
      pagesRendered: stats.pagesRendered,
      lastPagesRendered: stats.lastPagesRendered,
      fullPasses: stats.fullPasses,
      partialPasses: stats.partialPasses,
      cascadeFullPasses: stats.cascadeFullPasses,
      lastRenderMs: stats.lastRenderMs,
      slots: perSlot,
    };
  }

  function dispose() {
    disposed = true;
    enabled = false;
    lastAabb.clear();
    for (const s of slots) {
      if (!s) continue;
      s.table = null;
      s.win = null;
      s.sig = "none";
      if (s.queued) s.queued.length = 0;
    }
    csmOn = false;
    csmCount = 1;
    if (depthMats) {
      for (const k of Object.keys(depthMats)) depthMats[k].dispose();
      depthMats = null;
    }
    publish();
  }

  publish();
  return {
    setEnabled,
    isActive,
    syncWindow,
    syncCsm,
    syncCascadeWindow,
    noteAabb,
    noteRegion,
    noteFullPass,
    noteCascadeFullPass,
    renderPending,
    getStats,
    dispose,
  };
}
