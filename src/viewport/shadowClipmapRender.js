import { pageWorldSize, scissorForSlot, orthoBoundsForPage, worldToLightUv } from "../lighting/clipmapCore.js";
import { CLIPMAP_RENDER_VERSION, CLIPMAP_RENDER_LIMITS, clipPagesBudgetForTier, buildTableData, tableSizeFor } from "../lighting/clipmapRenderCore.js";

export function createSunClipmapRender(deps) {
  const d = deps && typeof deps === "object" ? deps : {};
  const THREE = d.THREE || null;
  const renderer = d.renderer || null;
  const supported = !!(THREE && renderer && typeof THREE.WebGLRenderTarget === "function" && typeof THREE.MeshDepthMaterial === "function" && typeof THREE.DataTexture === "function" && typeof THREE.OrthographicCamera === "function");
  let enabled = false;
  let disposed = false;
  let atlasRt = null;
  let tableTex = null;
  let tableData = null;
  let depthMat = null;
  let pageCam = null;
  let tmpColor = null;
  let curAtlasSize = 0;
  let lastOn = false;
  let lastEpoch = "";
  let lastPcss = null;
  const hidden = [];
  const clipArgs = { on: false, atlas: null, table: null, winCU: 0, winCV: 0, winHX: 0, winHY: 0, camU: 0, camV: 0, pw0: 0, grid: 0, invAtlas: 0, pagePx: 0, blend: CLIPMAP_RENDER_LIMITS.blendFraction, levels: 0, half0: 0 };
  const stats = { version: CLIPMAP_RENDER_VERSION, supported: supported, on: 0, frames: 0, budget: 0, lastBatch: 0, pagesRendered: 0, tableRebuilds: 0, tableEntries: 0, epochInvalidations: 0, atlasSize: 0, errors: 0 };

  function setEnabled(on) {
    enabled = on === true && supported && !disposed;
  }

  function isEnabled() {
    return enabled;
  }

  function disposeGpu() {
    if (atlasRt && typeof atlasRt.dispose === "function") atlasRt.dispose();
    if (tableTex && typeof tableTex.dispose === "function") tableTex.dispose();
    if (depthMat && typeof depthMat.dispose === "function") depthMat.dispose();
    atlasRt = null;
    tableTex = null;
    tableData = null;
    depthMat = null;
    pageCam = null;
    curAtlasSize = 0;
  }

  function ensureResources(cfg) {
    if (!supported) return false;
    if (atlasRt && curAtlasSize === cfg.atlasSize) return true;
    disposeGpu();
    atlasRt = new THREE.WebGLRenderTarget(cfg.atlasSize, cfg.atlasSize, {
      depthBuffer: true,
      stencilBuffer: false,
      minFilter: THREE.NearestFilter,
      magFilter: THREE.NearestFilter,
      wrapS: THREE.ClampToEdgeWrapping,
      wrapT: THREE.ClampToEdgeWrapping,
    });
    if (atlasRt.texture) {
      atlasRt.texture.generateMipmaps = false;
      atlasRt.texture.name = "rswClipmapAtlas";
    }
    const ts = tableSizeFor(cfg);
    tableData = new Uint8Array(ts.width * ts.height * 4);
    tableTex = new THREE.DataTexture(tableData, ts.width, ts.height, THREE.RGBAFormat, THREE.UnsignedByteType);
    tableTex.minFilter = THREE.NearestFilter;
    tableTex.magFilter = THREE.NearestFilter;
    tableTex.generateMipmaps = false;
    tableTex.needsUpdate = true;
    depthMat = new THREE.MeshDepthMaterial({ depthPacking: THREE.RGBADepthPacking });
    pageCam = new THREE.OrthographicCamera(-1, 1, 1, -1, 0.1, 1000);
    tmpColor = typeof THREE.Color === "function" ? new THREE.Color() : null;
    curAtlasSize = cfg.atlasSize;
    stats.atlasSize = cfg.atlasSize;
    return true;
  }

  function setUniformsOff() {
    if (lastPcss && typeof lastPcss.setClipmap === "function") {
      clipArgs.on = false;
      lastPcss.setClipmap(clipArgs);
    }
    lastOn = false;
    stats.on = 0;
  }


  function epochFor(sun, scam) {
    const t = sun && sun.target && sun.target.position ? sun.target.position : null;
    const p = sun && sun.position ? sun.position : null;
    let dx = 0;
    let dy = 1;
    let dz = 0;
    if (p) {
      dx = (Number(p.x) || 0) - (t ? Number(t.x) || 0 : 0);
      dy = (Number(p.y) || 0) - (t ? Number(t.y) || 0 : 0);
      dz = (Number(p.z) || 0) - (t ? Number(t.z) || 0 : 0);
    }
    const l = Math.hypot(dx, dy, dz) || 1;
    const nf = scam ? Math.round((Number(scam.near) || 0) / 4) + ":" + Math.round((Number(scam.far) || 0) / 4) : "";
    return Math.round((dx / l) * 256) + "," + Math.round((dy / l) * 256) + "," + Math.round((dz / l) * 256) + "|" + nf;
  }

  function rebuildTable(st) {
    if (!tableData || !tableTex) return;
    const ds = st.dirty && typeof st.dirty.has === "function" ? st.dirty : null;
    const isDirty = ds ? function (k) { return ds.has(k); } : null;
    const n = buildTableData(st.cfg, st.atlasMap, st.windows, isDirty, tableData);
    if (n >= 0) {
      tableTex.needsUpdate = true;
      stats.tableRebuilds++;
      stats.tableEntries = n;
    }
  }

  function renderPages(scene, scam, st, items) {
    const cfg = st.cfg;
    let done = 0;
    const prevTarget = typeof renderer.getRenderTarget === "function" ? renderer.getRenderTarget() : null;
    const prevOverride = scene.overrideMaterial;
    const prevAuto = renderer.shadowMap ? renderer.shadowMap.autoUpdate : false;
    let prevAlpha = 1;
    let hasColor = false;
    if (tmpColor && typeof renderer.getClearColor === "function" && typeof renderer.getClearAlpha === "function") {
      renderer.getClearColor(tmpColor);
      prevAlpha = renderer.getClearAlpha();
      hasColor = true;
    }
    hidden.length = 0;
    try {


      scene.traverse(function (o) {
        if (!o || o === scene) return;
        const drawable = o.isMesh === true || o.isLine === true || o.isPoints === true || o.isSprite === true;
        if (drawable && o.visible === true && o.castShadow !== true) {
          o.visible = false;
          hidden.push(o);
        }
      });
      if (renderer.shadowMap) renderer.shadowMap.autoUpdate = false;
      if (hasColor) renderer.setClearColor(0xffffff, 1);
      pageCam.position.setFromMatrixPosition(scam.matrixWorld);
      pageCam.quaternion.setFromRotationMatrix(scam.matrixWorld);
      pageCam.near = Number(scam.near) || 0.1;
      pageCam.far = Number(scam.far) || 1000;
      const cuv = worldToLightUv(pageCam.position.x, pageCam.position.y, pageCam.position.z, st.basis);
      scene.overrideMaterial = depthMat;
      for (let i = 0; i < items.length; i++) {
        const it = items[i];
        const ob = orthoBoundsForPage(cfg, it.level, it.col, it.row);
        pageCam.left = ob.left - cuv.u;
        pageCam.right = ob.right - cuv.u;
        pageCam.bottom = ob.bottom - cuv.v;
        pageCam.top = ob.top - cuv.v;
        pageCam.updateProjectionMatrix();
        pageCam.updateMatrixWorld(true);
        const sc = scissorForSlot(cfg, it.slot);
        atlasRt.viewport.set(sc.x, sc.y, sc.w, sc.h);
        atlasRt.scissor.set(sc.x, sc.y, sc.w, sc.h);
        atlasRt.scissorTest = true;
        renderer.setRenderTarget(atlasRt);                                      
        renderer.clear(true, true, false);
        renderer.render(scene, pageCam);
        done++;
        stats.pagesRendered++;
      }
    } catch (e) {
      void e;                                                               
      stats.errors++;
    } finally {
      scene.overrideMaterial = prevOverride;
      for (let i = 0; i < hidden.length; i++) hidden[i].visible = true;
      hidden.length = 0;
      if (atlasRt) {
        atlasRt.scissorTest = false;
        atlasRt.viewport.set(0, 0, curAtlasSize, curAtlasSize);
        atlasRt.scissor.set(0, 0, curAtlasSize, curAtlasSize);
      }
      if (typeof renderer.setRenderTarget === "function") renderer.setRenderTarget(prevTarget || null);
      if (hasColor && tmpColor) renderer.setClearColor(tmpColor, prevAlpha);
      if (renderer.shadowMap) renderer.shadowMap.autoUpdate = prevAuto;
    }
    return done;
  }

  function syncUniforms(st, scam, pcss) {
    if (!pcss || typeof pcss.setClipmap !== "function") return;
    const cfg = st.cfg;
    let camU = 0;
    let camV = 0;
    if (scam.matrixWorld && scam.matrixWorld.elements) {
      const e = scam.matrixWorld.elements;
      const uv = worldToLightUv(Number(e[12]) || 0, Number(e[13]) || 0, Number(e[14]) || 0, st.basis);
      camU = uv.u;
      camV = uv.v;
    }
    clipArgs.on = true;
    clipArgs.atlas = atlasRt ? atlasRt.texture : null;
    clipArgs.table = tableTex;
    clipArgs.winCU = camU + ((Number(scam.left) || 0) + (Number(scam.right) || 0)) * 0.5;
    clipArgs.winCV = camV + ((Number(scam.bottom) || 0) + (Number(scam.top) || 0)) * 0.5;
    clipArgs.winHX = ((Number(scam.right) || 0) - (Number(scam.left) || 0)) * 0.5;
    clipArgs.winHY = ((Number(scam.top) || 0) - (Number(scam.bottom) || 0)) * 0.5;
    clipArgs.camU = st.camU;
    clipArgs.camV = st.camV;
    clipArgs.pw0 = pageWorldSize(cfg, 0);
    clipArgs.grid = cfg.gridPerLevel;
    clipArgs.invAtlas = cfg.atlasSize > 0 ? 1 / cfg.atlasSize : 0;
    clipArgs.pagePx = cfg.pageSize;
    clipArgs.blend = CLIPMAP_RENDER_LIMITS.blendFraction;
    clipArgs.levels = cfg.levels;
    clipArgs.half0 = cfg.level0Half;
    pcss.setClipmap(clipArgs);
  }


  function frame(scene, camera, sun, ctl, tier, pcss) {
    void camera;
    if (disposed || !supported) return;
    lastPcss = pcss || lastPcss;
    const ctlOk = !!(ctl && typeof ctl.isActive === "function" && ctl.isActive());
    if (ctl && typeof ctl.setRenderMode === "function") ctl.setRenderMode(enabled && ctlOk);
    if (!enabled || !ctlOk || !scene || !sun) {
      if (lastOn) setUniformsOff();
      return;
    }
    const st = typeof ctl.getRenderState === "function" ? ctl.getRenderState() : null;
    const scam = sun.shadow && sun.shadow.camera ? sun.shadow.camera : null;
    if (!st || !st.cfg || !st.basis || !scam || !scam.matrixWorld || !scam.matrixWorld.elements) {
      if (lastOn) setUniformsOff();
      return;
    }
    if (!ensureResources(st.cfg)) return;
    const ep = epochFor(sun, scam);
    if (ep !== lastEpoch) {
      if (lastEpoch !== "" && typeof ctl.invalidateAll === "function") {
        ctl.invalidateAll();
        stats.epochInvalidations++;
      }
      lastEpoch = ep;
    }
    const budget = clipPagesBudgetForTier(tier);
    stats.budget = budget;
    const queue = typeof ctl.takeRenderQueue === "function" ? ctl.takeRenderQueue(budget) : null;
    let rendered = 0;
    if (queue && queue.length > 0) rendered = renderPages(scene, scam, st, queue);
    const needTable = (typeof ctl.tableNeedsRebuild === "function" && ctl.tableNeedsRebuild()) || rendered > 0;
    if (needTable) rebuildTable(st);
    syncUniforms(st, scam, pcss);
    stats.frames++;
    stats.lastBatch = rendered;
    stats.on = 1;
    lastOn = true;
  }

  function getStats() {
    return Object.assign({}, stats);
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    enabled = false;
    setUniformsOff();
    disposeGpu();
  }

  return { setEnabled, isEnabled, frame, getStats, dispose };
}
