import { store } from "../core/state.js";
import { bus } from "../core/eventBus.js";
import { setRenderSample } from "../core/renderStats.js";
import { logger } from "../core/logger.js";


import {
  markViewportStageLive,
  markViewportStageUnavailable,
} from "./viewportReadiness.js";


import { registerViewportInitializer } from "./viewportStartup.js";
import { waitForViewportPresentation } from "./viewportPresentation.js";
import { viewportPreparationProgress } from "./viewportPreparationProgress.js";
import { yieldToBrowserPaint } from "../boot/browserPaint.js";
import { runCooperativeWork } from "../boot/cooperativeWork.js";

import { createShaderHealGate } from "../lighting/shaderHealCore.js";
import { settings } from "../config/settings.js";

import { startVisibilityAwareInterval } from "../core/visibilityAwareInterval.js";


import { registerFrameCallback } from "../core/frameDriver.js";
import { isDebugSurfaceEnabled } from "../core/debugSurface.js";
import { getService, makeVector3 } from "../datamodel/index.js";
import { commands } from "../core/commands.js";
import { selection } from "../core/selection.js";
import {
  insertObject,
  cloneSelection,
  deleteSelection,
  setSpawnAnchorProvider,
} from "./objectOps.js";
import {
  cutSelection,
  copySelection,
  pasteInto,
  hasClipboard,
  getWorkspaceRoot,
} from "../core/editOps.js";
import { openContextMenu } from "../ui/contextMenu.js";
import { getPluginContextMenuItems } from "../plugins/pluginHost.js";            
import { createSceneSync } from "./sceneSync.js";
import { computeVisualBox } from "./objectBounds.js";                      
import { resolveMeshData, loadMeshInto, getSharedObjGeometry,
  getSharedGltfProto } from "./meshLoader.js";
import { buildCsgLods } from "./csgLod.js";
import { getSharedMeshLods } from "./meshLod.js";

import { getSkin, registerSkin } from "../assets/skinRegistry.js";
import { assetStore } from "../assets/assetStore.js";
import {
  initSkinning,
  bindSkinnedGroup,
  bindLoadedSkinnedScene,
  unbindSkinnedGroup,
  updateSkinning,
  disposeSkinning,
  resolveBoneWorld,
  skinnedPoseAtRest,                                             
  collectBonePoseOffsets,                                                    
} from "./skinning.js";
import { Events } from "../datamodel/instance.js";                               
import { computePosePalette } from "./skinnedPaletteCore.js";             
import { initBoneGizmos } from "./boneGizmos.js";
import { updateIK, clearIKState } from "../animation/ikRuntime.js";            
import { initIkGizmos } from "./ikGizmos.js";            
import { initAvatarGizmos } from "./avatarGizmos.js";            
import { initClimateRender, setClimateQualityScale } from "./climateRender.js";                         

import { applyPartMaterial, syncAppearance, makeAssetTexture, geoForMeshType, syncNeonEmissive } from "./appearanceRender.js";
import { createCameraRig } from "./cameraRig.js";
import { playtest } from "../runtime/playtest.js";                                
import { getSchedulerJobStats } from "../runtime/scheduler.js";                        
import { setProjection, clearProjection } from "./projection.js";                                            
import { buildGizmos } from "./gizmos.js";
import { AnimEvents, getAnimatablePartIds } from "../animation/animationStore.js";
import { createTerrainRenderer } from "./terrainRender.js";


import { createRefractionPass } from "./refractionPass.js";
import { refractionEligible } from "../lighting/refractionCore.js";

import { createPlanarReflections } from "./planarReflections.js";
import { planarEligible } from "../lighting/planarReflectionCore.js";
import { createTerrainController } from "./terrainTools.js";
import { createRegionController } from "./regionTools.js";
import { terrainStore } from "../terrain/terrainStore.js";
import { VOXEL_SIZE, isWaterMaterial, materialColorRGB } from "../terrain/materials.js";
import { collectTerrainGiBoxes, TERRAIN_GI_MAX_BOXES } from "../lighting/terrainGiBoxes.js";
import { createViewportSelection } from "./viewportSelect.js";
import { CSG } from "./csg.js";
import { createUIEditor } from "./uiEditor.js";

function el(tag, className) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  return node;
}

const MAX_RENDER_OBJECTS = 50000;
const SELECTION_COLOR = 0x3b9eff;

import { createLightingRenderer } from "./lightingRender.js";
import { createInstancedParts } from "./instancedParts.js";

import { createComplexInstanced } from "./complexInstanced.js";
import { createDecalCarriers } from "./decalCarriers.js";            
import { createPostFX } from "./postfx.js";
import { createCinematicPostProcessHost } from "./cinematicPostProcessHost.js";
import { observeViewportResolution } from "./observeViewportResolution.js";

import { createMotionVectorsPass } from "./motionVectors.js";


import { initEffectsRenderer, setEffectsQualityScale, getEffectsQualityScale } from "./effectsRender.js";


import {
  resolutionScaleFor,
  shadowScaleFor,
  particleScaleFor,
  drawDistanceFor,
  createAutoQualityController,
} from "./playQualityCore.js";
import { initAdornRenderer } from "./adornRender.js";
import { initWorldGuiRenderer } from "./worldGuiRender.js";
import { initPathfindingRenderer } from "./pathfindingRender.js";            
import { initSpatialQueryRenderer } from "./spatialQueryRender.js";            
import { initStreamingRenderer } from "./streamingRender.js";            

import { initAudioEngine, stepAudioSpatial, hasActiveSpatialSources } from "../audio/audioEngine.js";

export function buildViewport(container) {
  if (!container) {
    logger.warn("Viewport: contêiner ausente.");
    return null;
  }


  container.classList.add("rsw-viewport--host");
  container.replaceChildren();
  const canvasWrap = el("div", "rsw-viewport__canvas");
  const overlay = el("div", "rsw-viewport__overlay");
  container.append(canvasWrap, overlay);

  const rig = createCameraRig();
  const sync = createSceneSync({
    getWorkspace: () => getService(store.getDataModel(), "Workspace"),
    maxObjects: MAX_RENDER_OBJECTS,
  });
  sync.start();


  setSpawnAnchorProvider(() => rig.getTarget());


  container.addEventListener("pointerenter", () => container.classList.add("is-focused"));
  container.addEventListener("pointerleave", () => container.classList.remove("is-focused"));

  let requestRender = () => {};                                            



  const uiEditor = createUIEditor({ container });
  uiEditor.setVisible(store.get("uiEditorMode") === true);
  const offUiMode = store.subscribe((state, change) => {
    if (change && change.key === "uiEditorMode") {
      uiEditor.setVisible(state.uiEditorMode === true);
      requestRender();
    }
  });


  const liveSel = () =>
    selection
      .get()
      .filter(
        (i) => i && typeof i.isDestroyed === "function" && !i.isDestroyed(),
      );


  function focusCameraOnSelection() {
    const recs =
      typeof sync.getSelectedRecords === "function" ? sync.getSelectedRecords() : [];
    if (recs && recs.length && typeof rig.frame === "function") {
      rig.frame(recs);
      requestRender();
    }
  }


  function moveSelectionTo(getPos) {
    const targets = liveSel().filter(
      (i) =>
        typeof i.hasProperty === "function" &&
        i.hasProperty("Position") &&
        !(typeof i.isLocked === "function" && i.isLocked()),
    );
    if (!targets.length) return;
    const olds = targets.map((i) => ({ i, old: i.getProperty("Position") }));
    const dest = getPos();
    if (!dest) return;
    commands.execute({
      name: "Mover seleção",
      do() {
        let any = false;
        for (const e of olds) {
          if (!e.i.isDestroyed()) {
            if (e.i.setProperty("Position", makeVector3(dest.x, dest.y, dest.z)))
              any = true;
          }
        }
        return any;
      },
      undo() {
        for (const e of olds) {
          if (!e.i.isDestroyed() && e.old) {
            e.i.setProperty("Position", makeVector3(e.old.x, e.old.y, e.old.z));
          }
        }
      },
    });
  }

  function openViewportMenu(x, y) {
    const hasSel = liveSel().length > 0;
    const items = [
      { label: "Insert Part", icon: "part", onSelect: () => insertObject("Part") },
      { label: "Insert Model", icon: "model", onSelect: () => insertObject("Model") },
      { label: "Insert Folder", icon: "folder", onSelect: () => insertObject("Folder") },
      { type: "separator" },
      { label: "Cut", shortcut: "Ctrl+X", disabled: !hasSel, onSelect: () => cutSelection() },
      { label: "Copy", shortcut: "Ctrl+C", disabled: !hasSel, onSelect: () => copySelection() },
      {
        label: "Paste",
        icon: "duplicate",
        shortcut: "Ctrl+V",
        disabled: !hasClipboard(),
        onSelect: () => pasteInto(getWorkspaceRoot()),
      },
      { label: "Duplicate", icon: "duplicate", shortcut: "Ctrl+D", disabled: !hasSel, onSelect: () => cloneSelection() },
      { label: "Delete", icon: "trash", shortcut: "Del", disabled: !hasSel, onSelect: () => deleteSelection() },
      { type: "separator" },
      { label: "Move to Camera", icon: "move", disabled: !hasSel, onSelect: () => moveSelectionTo(() => rig.getTarget()) },
      { label: "Move Camera to Selection", icon: "camera", disabled: !hasSel, onSelect: () => focusCameraOnSelection() },
      { label: "Reset Position", disabled: !hasSel, onSelect: () => moveSelectionTo(() => ({ x: 0, y: 0, z: 0 })) },
    ];
    const pluginItems = getPluginContextMenuItems();
    if (pluginItems.length) items.push({ type: "separator" }, ...pluginItems);
    openContextMenu({ x, y, items });
  }

  const detachControls = attachControls(
    container,
    rig,
    () => requestRender(),
    (x, y) => openViewportMenu(x, y),
  );

  let stage = null;
  let disposed = false;

  const unregisterViewportInitializer = registerViewportInitializer(async ({ reportProgress }) => {
    await yieldToBrowserPaint();
    let THREE;
    try {
      THREE = await import("three");
      reportProgress(0.1);
    } catch (err) {
      showFallback(overlay, "Não foi possível carregar o motor 3D (Three.js). Verifique a conexão.");
      logger.warn(`Viewport: Three.js indisponível (${err && err.message ? err.message : err}).`);

      markViewportStageUnavailable("three-import-failed");
      return;
    }
    if (disposed) return;


    const retryDelaysMs = [0, 700, 1800, 3500, 7000];
    for (let attempt = 0; attempt < retryDelaysMs.length; attempt++) {
      if (retryDelaysMs[attempt] > 0) {
        await new Promise((resolve) => setTimeout(resolve, retryDelaysMs[attempt]));
      }
      if (disposed) return;
      try {
        stage = await createThreeStage(THREE, canvasWrap, rig, sync, {
          reportProgress: (progress) => reportProgress(0.1 + progress * 0.7),
        });
        requestRender = stage.requestRender;
        overlay.replaceChildren();                         
        sync.setSink(stage.sink);

        await runCooperativeWork((function* () {
          const records = sync.getRecords();
          let completedRecords = 0;
          for (const record of records) {
            stage.sink.add(record);
            completedRecords += 1;
            reportProgress(0.8 + 0.2 * completedRecords / records.length);
            yield;
          }
          stage.sink.selection?.(sync.getSelectedIds());
        })());
        stage.start();

        return stage;
      } catch (err) {
        const lastAttempt = attempt === retryDelaysMs.length - 1;
        if (lastAttempt) {
          showFallback(overlay, "Falha ao inicializar o Viewport 3D. A GPU foi reiniciada pelo sistema; recarregue a aba se o problema persistir.");
          logger.error("Viewport: erro ao iniciar Three.js:", err);


          markViewportStageUnavailable("webgl-context-unavailable");
        } else {
          showFallback(overlay, "Reiniciando o Viewport 3D\u2026");
          logger.warn(`Viewport: contexto WebGL indisponível (tentativa ${attempt + 1}/${retryDelaysMs.length}) — nova tentativa em instantes.`);
        }
      }
    }
  });

  function dispose() {
    disposed = true;
    unregisterViewportInitializer();
    markViewportStageUnavailable("viewport-disposed");
    detachControls();
    if (typeof offUiMode === "function") offUiMode();
    if (uiEditor && typeof uiEditor.destroy === "function") uiEditor.destroy();
    sync.stop();
    if (stage) stage.dispose();
  }

  return { container, rig, sync, refresh: () => requestRender(), dispose };
}


function attachControls(container, rig, requestRender, onContextRequest) {
  let mode = null;                   
  let lastX = 0;
  let lastY = 0;

  let rightDown = false;
  let rightMoved = false;
  let rdX = 0;
  let rdY = 0;
  const CTX_THRESHOLD = 4;


  const pressed = new Set();
  const MOVE_CODES = { KeyW: 1, KeyS: 1, KeyA: 1, KeyD: 1, KeyQ: 1, KeyE: 1 };


  let unregisterFlyCameraFrameCallback = null;
  let flyLast = 0;

  function isTypingTarget(t) {
    if (!t || !t.tagName) return false;
    const tag = t.tagName;
    return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || t.isContentEditable === true;
  }

  function flyTick(ts) {


    if (!rightDown || pressed.size === 0) { stopFly(); return; }
    const now = typeof ts === "number"
      ? ts
      : (typeof performance !== "undefined" ? performance.now() : Date.now());
    let dt = flyLast ? (now - flyLast) / 1000 : 0;
    flyLast = now;
    if (dt > 0.05) dt = 0.05;                                       

    let f = 0, r = 0, u = 0;
    if (pressed.has("KeyW")) f += 1;
    if (pressed.has("KeyS")) f -= 1;
    if (pressed.has("KeyD")) r += 1;
    if (pressed.has("KeyA")) r -= 1;
    if (pressed.has("KeyE")) u += 1;
    if (pressed.has("KeyQ")) u -= 1;

    if (f || r || u) {
      const st = rig.getState ? rig.getState() : null;
      const radius = st && Number.isFinite(st.radius) ? st.radius : 64;

      let speed = Math.min(Math.max(radius, 16), 400) * 1.6;             
      if (pressed.has("ShiftLeft") || pressed.has("ShiftRight")) speed *= 3;
      const dist = speed * dt;
      if (typeof rig.moveLocal === "function") rig.moveLocal(f * dist, r * dist, u * dist);
      requestRender();
    }
  }

  function startFly() {
    if (unregisterFlyCameraFrameCallback) return;
    flyLast = 0;
    unregisterFlyCameraFrameCallback = registerFrameCallback(
      "input",
      flyTick,
      "viewport:flyCamera",
    );
  }

  function stopFly() {
    flyLast = 0;
    if (!unregisterFlyCameraFrameCallback) return;
    unregisterFlyCameraFrameCallback();
    unregisterFlyCameraFrameCallback = null;
  }

  const onKeyDown = (e) => {
    if (isTypingTarget(e.target)) return;
    if (playtest.isCameraActive()) return;                                         
    if (e.code === "ShiftLeft" || e.code === "ShiftRight") { pressed.add(e.code); return; }
    if (!MOVE_CODES[e.code]) return;
    pressed.add(e.code);
    if (rightDown) { e.preventDefault(); startFly(); }
  };
  const onKeyUp = (e) => { pressed.delete(e.code); };
  const onBlur = () => { pressed.clear(); };

  const onContext = (e) => e.preventDefault();
  const onDown = (e) => {
    if (playtest.isCameraActive()) return;                                       
    const isRight = e.button === 2;
    const isMiddle = e.button === 1;
    if (isRight) {
      rightDown = true;
      rightMoved = false;
      rdX = e.clientX;
      rdY = e.clientY;
      startFly();                                                                   
    }
    if (!isRight && !isMiddle) return;                                                         
    mode = isMiddle || (isRight && e.shiftKey) ? "pan" : "orbit";
    lastX = e.clientX;
    lastY = e.clientY;
    if (container.setPointerCapture && e.pointerId != null) {
      try { container.setPointerCapture(e.pointerId); } catch (_) {            }
    }
    e.preventDefault();
  };
  const smoothPrev = { x: 0, y: 0 };
  const onMove = (e) => {
    if (rightDown && !rightMoved) {
      if (Math.hypot(e.clientX - rdX, e.clientY - rdY) > CTX_THRESHOLD) rightMoved = true;
    }
    if (!mode) return;
    const dx = e.clientX - lastX;
    const dy = e.clientY - lastY;
    lastX = e.clientX;
    lastY = e.clientY;
    if (mode === "orbit") {
      const rawSens = Number(settings.get("cameraSensitivity"));
      const sens = Number.isFinite(rawSens) && rawSens > 0 ? rawSens : 1;
      let mdx = dx * sens;
      let mdy = dy * sens;
      if (settings.get("cameraInvertY") === true) mdy = -mdy;
      if (settings.get("cameraSmoothing") !== false) {
        mdx = (mdx + smoothPrev.x) / 2;
        mdy = (mdy + smoothPrev.y) / 2;
      }
      smoothPrev.x = mdx;
      smoothPrev.y = mdy;
      rig.orbit(mdx, mdy);
    } else {
      rig.pan(dx, dy);
    }
    requestRender();
  };
  const onUp = (e) => {
    mode = null;
    if (container.releasePointerCapture && e.pointerId != null) {
      try { container.releasePointerCapture(e.pointerId); } catch (_) {            }
    }

    if (e.button === 2 && rightDown && !rightMoved && typeof onContextRequest === "function") {
      onContextRequest(e.clientX, e.clientY);
    }
    if (e.button === 2) rightDown = false;
  };
  const onWheel = (e) => {
    e.preventDefault();
    if (playtest.isCameraActive()) return;                                       
    rig.zoom(e.deltaY);
    requestRender();
  };

  container.addEventListener("contextmenu", onContext);
  container.addEventListener("pointerdown", onDown);
  container.addEventListener("pointermove", onMove);
  container.addEventListener("pointerup", onUp);
  container.addEventListener("pointercancel", onUp);
  container.addEventListener("wheel", onWheel, { passive: false });
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);

  return function detach() {
    container.removeEventListener("contextmenu", onContext);
    container.removeEventListener("pointerdown", onDown);
    container.removeEventListener("pointermove", onMove);
    container.removeEventListener("pointerup", onUp);
    container.removeEventListener("pointercancel", onUp);
    container.removeEventListener("wheel", onWheel);
    window.removeEventListener("keydown", onKeyDown);
    window.removeEventListener("keyup", onKeyUp);
    window.removeEventListener("blur", onBlur);
    stopFly();
  };
}

function showFallback(overlay, message) {
  const box = el("div", "rsw-viewport__fallback");
  const title = el("div", "rsw-viewport__fallback-title");
  title.textContent = "Viewport 3D";
  const msg = el("div", "rsw-viewport__fallback-msg");
  msg.textContent = message;                                         
  box.append(title, msg);
  overlay.replaceChildren(box);
}


const MAX_PIXEL_RATIO = 2;
const PIXEL_RATIO_SCALE_BY_QUALITY = { high: 1, medium: 0.66, low: 0.5 };
const MIN_PIXEL_RATIO_BY_QUALITY = { high: 1, medium: 1, low: 0.75 };

function pixelRatioBase() {
  const quality = settings.get("renderQuality");
  const deviceRatio = Math.min(globalThis.devicePixelRatio || 1, MAX_PIXEL_RATIO);
  const qualityScale = PIXEL_RATIO_SCALE_BY_QUALITY[quality] || 1;
  const minimumRatio = MIN_PIXEL_RATIO_BY_QUALITY[quality] || 1;
  return Math.max(minimumRatio, deviceRatio * qualityScale);
}


let playGfxQuality = 0;
let playGfxActive = false;                                                     
const playAutoCtl = createAutoQualityController();


function effectivePlayQuality() {
  if (playGfxQuality >= 1) return playGfxQuality;
  return playGfxActive ? playAutoCtl.level() : 0;
}


let tierRenderScale = 1;

function pixelRatioFor() {
  const base = pixelRatioBase();
  const q = effectivePlayQuality();
  const tierScale = tierRenderScale > 0 && tierRenderScale <= 1 ? tierRenderScale : 1;
  if (q >= 1) return Math.max(0.25, base * resolutionScaleFor(q) * tierScale);
  return Math.max(0.25, base * tierScale);
}

async function createThreeStage(THREE, host, rig, sync, { reportProgress = () => {} } = {}) {

  let dirty = true;
  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });


  renderer.setClearColor(0x000000, 0);                                           
  renderer.setPixelRatio(pixelRatioFor());
  host.appendChild(renderer.domElement);


  renderer.domElement.addEventListener("webglcontextlost", (ev) => {
    ev.preventDefault();
    logger.warn("Viewport: contexto WebGL perdido — aguardando restauração automática.");
  });
  renderer.domElement.addEventListener("webglcontextrestored", () => {
    logger.warn("Viewport: contexto WebGL restaurado.");
    requestRender();
  });

  reportProgress(0.1);
  await yieldToBrowserPaint();
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(70, 1, 0.1, 100000);


  const projVec = new THREE.Vector3();


  let screenRaycaster = null;
  const screenNdc = new THREE.Vector2();
  const projector = {
    container: host,


    screenToRay(clientX, clientY) {
      const rect = host.getBoundingClientRect();
      if (!rect.width || !rect.height) return null;
      screenNdc.set(
        ((clientX - rect.left) / rect.width) * 2 - 1,
        -((clientY - rect.top) / rect.height) * 2 + 1,
      );
      if (!screenRaycaster) screenRaycaster = new THREE.Raycaster();
      screenRaycaster.setFromCamera(screenNdc, camera);
      const o = screenRaycaster.ray.origin;
      const d = screenRaycaster.ray.direction;
      return {
        origin: { x: o.x, y: o.y, z: o.z },
        dir: { x: d.x, y: d.y, z: d.z },
      };
    },
    project(x, y, z) {
      const w = host.clientWidth || 1;
      const h = host.clientHeight || 1;
      projVec.set(x, y, z).project(camera);
      const dx = x - camera.position.x;
      const dy = y - camera.position.y;
      const dz = z - camera.position.z;
      return {
        x: (projVec.x * 0.5 + 0.5) * w,
        y: (-projVec.y * 0.5 + 0.5) * h,
        visible: projVec.z > -1 && projVec.z < 1,
        dist: Math.sqrt(dx * dx + dy * dy + dz * dz),
      };
    },
  };
  setProjection(projector);


  reportProgress(0.2);
  await yieldToBrowserPaint();
  const lightingCtl = createLightingRenderer({
    THREE,
    scene,
    camera,
    renderer,
    getSceneRenderTarget: () => postfx.getSceneRenderTarget(),
    getMeshes: () => ({
      get: (id) => meshes.get(id) || promotePart(id, "light"),


      values: function* () {
        yield* meshes.values();
        yield* pooled.getRaycastMeshes();
      },
    }),
    getCameraTarget: () => rig.getTarget(),
    requestRender: () => requestRender(),


    setPoolLightingModel: (kind, spec) => {
      try {
        if (instanced.setLightingModel(kind, spec)) requestRender();
      } catch (_) {

      }
    },


    getTerrainBounds: () => {
      const data = terrainStore.getData();
      const b = data && data.getBounds ? data.getBounds() : null;
      if (!b) return null;
      return {
        min: [(b.min[0] - 1) * VOXEL_SIZE, (b.min[1] - 1) * VOXEL_SIZE, (b.min[2] - 1) * VOXEL_SIZE],
        max: [(b.max[0] + 2) * VOXEL_SIZE, (b.max[1] + 2) * VOXEL_SIZE, (b.max[2] + 2) * VOXEL_SIZE],
      };
    },


    getTerrainGiBoxes: (budget) => {
      const data = terrainStore.getData();
      const b = data && data.getBounds ? data.getBounds() : null;
      if (!b) return null;
      return collectTerrainGiBoxes({
        bounds: b,
        voxelSize: VOXEL_SIZE,
        maxBoxes: Math.min(budget || 0, TERRAIN_GI_MAX_BOXES),
        getOcc: (x, y, z) => data.getOcc(x, y, z),
        getMat: (x, y, z) => data.getMat(x, y, z),
        isWater: (m) => isWaterMaterial(m),
        colorOf: (m) => materialColorRGB(m),
      });
    },
  });

  reportProgress(0.4);
  await yieldToBrowserPaint();
  const postfxOptions = {
    THREE,
    renderer,
    scene,
    camera,
    getGrade: () => lightingCtl.getGradeState(),
    getSunInfo: () => lightingCtl.getSunScreenInfo(),

    getShadowTemporal: () => lightingCtl.getShadowTemporalState(),

    getMegaLights: () => lightingCtl.getMegaLightsState(),

    getVolumetricFog: () => lightingCtl.getVolumetricFogState(),

    getSsr: () => lightingCtl.getSsrState(),

    getAoState: () => lightingCtl.getAoState(),

    setAoMask: (m) => lightingCtl.setAoMask(m),


    getLocalLightPatchRegistry: () => lightingCtl.getLocalLightPatchRegistry(),
    setLocalVolumetricPassExtension: (extension) => lightingCtl.setLocalVolumetricPassExtension(extension),


    getPostfxDiet: () => lightingCtl.getPostfxDietState(),


    getHdrPipeline: () => lightingCtl.getHdrPipelineState(),


    getUpscaleSharpen: () => lightingCtl.getUpscaleSharpenState(),


    getAutoExposure: () => lightingCtl.getAutoExposureState(),


    getLocalExposure: () => lightingCtl.getLocalExposureState(),


    getLensFlare: () => lightingCtl.getLensFlareState(),


    getSmLiteFx: () => lightingCtl.getSmLiteFxState(),


    getFilmFx: () => lightingCtl.getFilmFxState(),

    getTsrState: () => lightingCtl.getTsrState ? lightingCtl.getTsrState() : null,
    getMotionVectors: () => mvPass ? mvPass.getTexture() : null,
    getSubstrateScreen: () => (lightingCtl.getSubstrateScreen ? lightingCtl.getSubstrateScreen() : null),


    getPassTiming: () => lightingCtl.getPassTiming(),
    requestRender: () => requestRender(),
  };
  const postfx = createCinematicPostProcessHost({
    options: postfxOptions,
    legacy: createPostFX(postfxOptions),
    readHostState: () => lightingCtl.getCinematicPostProcessState(),
    viewId: () => (playGfxActive ? "play" : "edit"),
  });
  if (isDebugSurfaceEnabled() && typeof window !== "undefined" && !window.__rswCinematicPostQa) {
    window.__rswCinematicPostQa = {
      snapshot: () => postfx.snapshot(),
      active: () => postfx.isCinematicActive(),
      reset: (reason) => postfx.reset(reason),
    };
  }


  const mvPass = createMotionVectorsPass({ THREE, renderer, scene, camera });


  renderer.domElement.addEventListener("webglcontextrestored", () => {




    lightingCtl.reopenShaderPatches("contexto WebGL restaurado");
    lightingCtl.markShadowsDirty();
    lightingCtl.markGiDirty();
  });


  if (renderer.debug) {


    const shaderHealGate = createShaderHealGate({});
    renderer.domElement.addEventListener("webglcontextlost", () => {
      shaderHealGate.onContextLost(Date.now());
    });

    window.__rswShaderHealQa = { get: () => shaderHealGate.debug(), gate: shaderHealGate };
    renderer.debug.onShaderError = (gl, program, glVertexShader, glFragmentShader) => {


      if (gl && typeof gl.isContextLost === "function" && gl.isContextLost()) return;
      let info = "";
      try {
        info = [
          gl.getProgramInfoLog(program) || "",
          gl.getShaderInfoLog(glVertexShader) || "",
          gl.getShaderInfoLog(glFragmentShader) || "",
        ].join("\n").trim();
      } catch (_) {                              }
      const decision = shaderHealGate.onShaderError(info.length === 0, Date.now());
      if (decision === "heal") {
        logger.error("Viewport: shader falhou ao compilar na GPU:", info);


        lightingCtl.disableShaderPatches("shader falhou ao compilar");
        requestRender();
        return;
      }
      if (decision === "defer") {
        logger.warn("Viewport: shader falhou SEM info log (suspeita de TDR) — heal adiado " + shaderHealGate.graceMs + " ms para confirmar que o contexto está vivo.");
        setTimeout(() => {
          const lost = !!(gl && typeof gl.isContextLost === "function" && gl.isContextLost());
          if (shaderHealGate.onDeferTimer(Date.now(), lost) !== "heal") return;
          logger.error("Viewport: shader falhou ao compilar na GPU (sem info log, contexto vivo).");
          lightingCtl.disableShaderPatches("shader falhou ao compilar (sem log, contexto vivo)");
          requestRender();
        }, shaderHealGate.graceMs);
        return;
      }

      logger.warn("Viewport: falha de shader ignorada pelo gate F31 (rajada/TDR em andamento).");
    };
  }

  reportProgress(0.55);
  await yieldToBrowserPaint();
  const effectsCtl = initEffectsRenderer({
    scene,
    camera,
    renderer,
    requestRender: () => requestRender(),


    sampleLight: (x, y, z, out) => lightingCtl.sampleLightAt(x, y, z, out),
  });


  const pathfindingCtl = initPathfindingRenderer({
    THREE,
    scene,
    requestRender: () => requestRender(),
    getWorkspace: () => getService(store.getDataModel(), "Workspace"),
  });


  const spatialQueryCtl = initSpatialQueryRenderer({
    THREE,
    scene,
    requestRender: () => requestRender(),
  });


  const streamingCtl = initStreamingRenderer({
    THREE,
    scene,
    requestRender: () => requestRender(),
    getInstanced: () => pooled,
  });


  const audioCtl = initAudioEngine({ getCamera: () => camera });


  reportProgress(0.7);
  await yieldToBrowserPaint();
  const gridGroup = new THREE.Group();
  const gridMajor = new THREE.GridHelper(2048, 64, 0x4a5160, 0x2a2f3a);
  const gridMinor = new THREE.GridHelper(2048, 256, 0x2a2f3a, 0x20242d);
  gridMinor.position.y = -0.01;
  setGridOpacity(gridMajor, 0.85);
  setGridOpacity(gridMinor, 0.4);
  gridGroup.add(gridMinor, gridMajor);
  gridGroup.visible = settings.get("gridVisible") !== false;
  scene.add(gridGroup);


  const GRID_PALETTES = {
    default: [0x4a5160, 0x2a2f3a, 0x2a2f3a, 0x20242d],
    blue: [0x3a5a8c, 0x24344c, 0x24344c, 0x1c2838],
    green: [0x3a7a4a, 0x24452c, 0x24452c, 0x1c3322],
    amber: [0x8c6a2a, 0x4c3a1c, 0x4c3a1c, 0x382c16],
  };
  let gridMajorEl = gridMajor;
  let gridMinorEl = gridMinor;
  function rebuildGrid() {
    const colorKey = store.getViewOption("gridColor") || "default";
    const viewCell = store.getViewOption("gridCellSize");
    const cell = (viewCell && viewCell !== 8 ? viewCell : Number(settings.get("gridSize"))) || 8;
    const pal = GRID_PALETTES[colorKey] || GRID_PALETTES.default;
    for (const g of [gridMajorEl, gridMinorEl]) {
      if (!g) continue;
      gridGroup.remove(g);
      if (g.geometry && g.geometry.dispose) g.geometry.dispose();
      if (g.material && g.material.dispose) g.material.dispose();
    }
    const minorDiv = Math.max(2, Math.round(2048 / cell));
    const majorDiv = Math.max(1, Math.round(2048 / (cell * 4)));
    gridMajorEl = new THREE.GridHelper(2048, majorDiv, pal[0], pal[1]);
    gridMinorEl = new THREE.GridHelper(2048, minorDiv, pal[2], pal[3]);
    gridMinorEl.position.y = -0.01;
    setGridOpacity(gridMajorEl, 0.85);
    setGridOpacity(gridMinorEl, 0.4);
    gridGroup.add(gridMinorEl, gridMajorEl);
    requestRender();
  }


  let _wireMat = null;
  let _normalsMat = null;
  let _depthMat = null;
  let _detailMat = null;
  function overrideForMode(mode) {
    if (mode === "wireframe") {
      if (!_wireMat) _wireMat = new THREE.MeshBasicMaterial({ color: 0x8fd0ff, wireframe: true });
      return _wireMat;
    }
    if (mode === "normals") {
      if (!_normalsMat) _normalsMat = new THREE.MeshNormalMaterial();
      return _normalsMat;
    }
    if (mode === "shadowmap") {
      if (!_depthMat) _depthMat = new THREE.MeshDepthMaterial();
      return _depthMat;
    }
    return null;
  }
  function detailMaterial() {
    if (!_detailMat) {
      _detailMat = new THREE.MeshBasicMaterial({ color: 0x10131a, wireframe: true, transparent: true, opacity: 0.55 });
    }
    return _detailMat;
  }


  let swappedMode = null;                                 
  function swapNode(n, mode) {
    if (!n.isMesh || !n.material || Array.isArray(n.material)) return;
    if (n.userData.__origMat) return;
    const orig = n.material;
    let color;
    if (mode === "albedo") color = orig.color ? orig.color.clone() : new THREE.Color(0xffffff);
    else {
      const r = typeof orig.roughness === "number" ? Math.min(1, Math.max(0, orig.roughness)) : 1;
      color = new THREE.Color(r, r, r);
    }
    n.userData.__origMat = orig;
    const flat = new THREE.MeshBasicMaterial({ color });


    if (orig.transparent) {
      flat.transparent = true;
      flat.opacity = typeof orig.opacity === "number" ? orig.opacity : 1;
    }
    if (orig.side !== undefined) flat.side = orig.side;


    flat.visible = orig.visible;
    n.material = flat;
  }
  function restoreNode(n) {
    if (n.userData && n.userData.__origMat) {
      if (n.material && n.material.dispose) n.material.dispose();
      n.material = n.userData.__origMat;
      delete n.userData.__origMat;
    }
  }
  function swapObj(obj, mode) {
    if (typeof obj.traverse === "function") obj.traverse((n) => swapNode(n, mode));
    else swapNode(obj, mode);
  }
  function restoreObj(obj) {
    if (typeof obj.traverse === "function") obj.traverse(restoreNode);
    else restoreNode(obj);
  }
  function maybeSwapMaterial(obj) {
    if (swappedMode) swapObj(obj, swappedMode);
  }
  function applyMaterialMode() {
    const mode = store.getViewOption("renderMode");
    const want = mode === "albedo" || mode === "roughness" ? mode : null;
    if (want === swappedMode) {
      requestRender();
      return;
    }
    for (const obj of meshes.values()) restoreObj(obj);
    swappedMode = want;
    if (want) for (const obj of meshes.values()) swapObj(obj, want);

    try {
      instanced.setFlatMode(!!want);
      complexInst.setFlatMode(!!want);
      decalCarriers.setFlatMode(!!want);            
    } catch (_) {

    }
    requestRender();
  }


  function applySelectionBoxVisibility() {
    const on = store.getViewOption("showSelectionBoxes") !== false;
    for (const b of boxes.values()) b.visible = on;
    requestRender();
  }


  const bboxes = new Map();                   
  const BBOX_COLOR = 0xb8bdc6;
  let bboxDirty = false;
  let bboxLastRefresh = 0;
  function refreshBoundingBoxes(force) {
    const t = typeof performance !== "undefined" ? performance.now() : Date.now();


    if (!force && !bboxDirty && t - bboxLastRefresh < 1000) return;
    bboxLastRefresh = t;
    bboxDirty = false;
    for (const [id, b] of bboxes) {
      if (!meshes.has(id)) {
        scene.remove(b);
        disposeObject(b);
        bboxes.delete(id);
      }
    }
    for (const [id, obj] of meshes) {
      if (cameraIds.has(id)) continue;
      let b = bboxes.get(id);
      if (!b) {
        b = new THREE.BoxHelper(obj, BBOX_COLOR);
        if (b.material) {
          b.material.transparent = true;
          b.material.opacity = 0.35;
        }
        bboxes.set(id, b);
        scene.add(b);
      } else {
        b.setFromObject(obj);
      }
    }
  }
  function applyBoundingBoxes() {
    const on = !!store.getViewOption("showBoundingBoxes");
    if (!on) {
      for (const b of bboxes.values()) {
        scene.remove(b);
        disposeObject(b);
      }
      bboxes.clear();
      requestRender();
      return;
    }
    refreshBoundingBoxes(true);
    requestRender();
  }


  const cameraIds = new Set();
  function applyGizmoVisibility() {
    const on = store.getViewOption("showGizmos") !== false;
    for (const id of cameraIds) {
      const obj = meshes.get(id);
      if (obj) obj.visible = on;
    }
    requestRender();
  }


  let hoverHelper = null;
  let hoverId = null;
  let hoverLastCast = 0;
  let hoverRaycaster = null;
  const hoverNdc = new THREE.Vector2();
  function clearHover() {
    if (hoverHelper) {
      scene.remove(hoverHelper);
      disposeObject(hoverHelper);
      hoverHelper = null;
    }
    if (hoverId != null) {
      const prev = hoverId;
      hoverId = null;
      demotePart(prev, "hover");
      requestRender();
    }
  }
  function onHoverMove(e) {
    if (store.getViewOption("showHoverHighlight") === false) {
      clearHover();
      return;
    }
    if (e.buttons || playtest.isCameraActive()) {
      clearHover();
      return;
    }
    const t = Date.now();
    if (t - hoverLastCast < 60) return;                            
    hoverLastCast = t;
    const rect = host.getBoundingClientRect();
    if (!rect.width || !rect.height) return;
    hoverNdc.set(
      ((e.clientX - rect.left) / rect.width) * 2 - 1,
      -((e.clientY - rect.top) / rect.height) * 2 + 1,
    );
    if (!hoverRaycaster) hoverRaycaster = new THREE.Raycaster();
    hoverRaycaster.setFromCamera(hoverNdc, camera);
    const hits = hoverRaycaster.intersectObjects(
      [...meshes.values(), ...pooled.getRaycastMeshes()],
      true,
    );
    let target = null;
    let id = null;
    for (const hit of hits) {
      let n = hit.object;
      if (n && n.userData && n.userData.__rswPool) {
        const pid = hit.instanceId != null ? pooled.idFromHit(n, hit.instanceId) : null;
        if (pid == null) continue;
        id = pid;
        break;
      }
      while (n && !(n.userData && n.userData.rswId)) n = n.parent;
      if (n && n.visible !== false) {
        target = n;
        id = n.userData.rswId;
        break;
      }
    }
    if (id === hoverId) return;
    clearHover();
    if (id != null && !target) target = promotePart(id, "hover");
    if (target) {
      hoverId = id;


      hoverHelper = new THREE.Box3Helper(computeVisualBox(target, new THREE.Box3()), 0xffd24a);
      if (hoverHelper.material) {
        hoverHelper.material.depthTest = false;
        hoverHelper.material.transparent = true;
        hoverHelper.material.opacity = 0.9;
      }
      hoverHelper.renderOrder = 998;
      scene.add(hoverHelper);
      requestRender();
    }
  }
  function onHoverLeave() {
    clearHover();
  }
  host.addEventListener("pointermove", onHoverMove);
  host.addEventListener("pointerleave", onHoverLeave);


  const tagHelpers = new Map();                      
  let tagHiIds = [];
  let tagHiColor = 0x4aa3ff;
  let tagBatchPending = false;
  function clearTagHighlight() {
    for (const h of tagHelpers.values()) {
      scene.remove(h);
      disposeObject(h);
    }
    tagHelpers.clear();
  }
  function rebuildTagHighlight() {
    tagBatchPending = false;
    clearTagHighlight();
    if (!tagHiIds || !tagHiIds.length) {
      requestRender();
      return;
    }
    const wanted = new Set(tagHiIds);
    for (const obj of meshes.values()) {
      const id = obj && obj.userData ? obj.userData.rswId : null;
      if (id == null || !wanted.has(id)) continue;
      if (obj.visible === false) continue;
      const helper = new THREE.BoxHelper(obj, tagHiColor);
      if (helper.material) {
        helper.material.depthTest = false;
        helper.material.transparent = true;
        helper.material.opacity = 0.95;
      }
      helper.renderOrder = 997;
      scene.add(helper);
      tagHelpers.set(id, helper);
    }
    requestRender();
  }
  function scheduleTagHighlight() {
    if (tagBatchPending) return;
    tagBatchPending = true;
    const raf =
      typeof requestAnimationFrame === "function"
        ? requestAnimationFrame
        : (fn) => setTimeout(fn, 16);
    raf(rebuildTagHighlight);
  }
  function parseHexColor(c, fallback) {
    if (typeof c === "number" && Number.isFinite(c)) return c;
    if (typeof c === "string") {
      const m = /^#?([0-9a-fA-F]{6})$/.exec(c.trim());
      if (m) return parseInt(m[1], 16);
    }
    return fallback;
  }
  const offTagHi = bus.on("tageditor:highlight", (p) => {
    const ids = p && Array.isArray(p.ids) ? p.ids.slice(0, 5000) : [];
    tagHiColor = parseHexColor(p && p.color, 0x4aa3ff);
    tagHiIds = ids;
    scheduleTagHighlight();
  });
  const offTagClear = bus.on("tageditor:clearHighlight", () => {
    tagHiIds = [];
    scheduleTagHighlight();
  });


  let perfEl = null;
  let stopPerfTextInterval = null;
  const perfFrames = [];                                                 
  const perfDurs = [];                                           
  function perfOnFrameRendered(start) {
    if (!store.getViewOption("perfStats")) return;                          
    const end = typeof performance !== "undefined" ? performance.now() : Date.now();
    perfFrames.push(end);
    if (perfFrames.length > 60) perfFrames.shift();
    perfDurs.push(Math.max(0, end - start));
    if (perfDurs.length > 60) perfDurs.shift();
  }
  function updatePerfText() {
    if (!perfEl) return;
    let fps = 0;
    if (perfFrames.length >= 2) {
      const span = perfFrames[perfFrames.length - 1] - perfFrames[0];
      if (span > 0) fps = ((perfFrames.length - 1) * 1000) / span;
    }
    let ft = 0;
    if (perfDurs.length) {
      let sum = 0;
      for (const d of perfDurs) sum += d;
      ft = sum / perfDurs.length;
    }
    const info = renderer.info && renderer.info.render ? renderer.info.render : {};
    const lines = [
      "FPS: " + (fps ? fps.toFixed(0) : "--"),
      "Frame Time: " + ft.toFixed(2) + " ms",
      "Draw Calls: " + (info.calls != null ? info.calls : "--"),
      "Triangles: " + (info.triangles != null ? info.triangles : "--"),
    ];
    try {
      const stats = getSchedulerJobStats();
      const phys = stats.find((s) => s.name === "Physics Simulation");
      if (phys && phys.runs) lines.push("Physics: " + phys.ema.toFixed(2) + " ms");
      let script = 0;
      let any = false;
      for (const s of stats) {
        if ((s.name === "Stepped" || s.name === "Heartbeat" || s.name === "RenderStepped" || s.name === "Wait Resume") && s.runs) {
          script += s.ema;
          any = true;
        }
      }
      if (any) lines.push("Script: " + script.toFixed(2) + " ms");
    } catch (_) {

    }
    const mem = typeof performance !== "undefined" ? performance.memory : null;
    if (mem && mem.usedJSHeapSize) {
      lines.push("Memory: " + (mem.usedJSHeapSize / 1048576).toFixed(1) + " MB");
    }
    const text = lines.join("\n");
    if (perfEl.textContent !== text) perfEl.textContent = text;


  }
  function updatePerfVisibility() {
    const on = !!store.getViewOption("perfStats");
    if (on) {
      if (!perfEl) {
        perfEl = document.createElement("div");
        perfEl.className = "rsw-perfstats";
        try {
          if (globalThis.getComputedStyle && globalThis.getComputedStyle(host).position === "static") {
            host.style.position = "relative";
          }
        } catch (_) {

        }
        host.appendChild(perfEl);
      }
      perfEl.hidden = false;


      if (!stopPerfTextInterval) stopPerfTextInterval = startVisibilityAwareInterval(updatePerfText, 500);
      updatePerfText();
    } else {
      if (perfEl) perfEl.hidden = true;
      if (stopPerfTextInterval) {
        stopPerfTextInterval();
        stopPerfTextInterval = null;
      }
      perfFrames.length = 0;
      perfDurs.length = 0;
    }
  }


  const offViewOpts = store.subscribe((_st, change) => {
    if (!change || change.key !== "viewOptions") return;
    const opt = change.option;
    if (opt === "renderMode") applyMaterialMode();
    else if (opt === "gridColor" || opt === "gridCellSize") rebuildGrid();
    else if (opt === "showSelectionBoxes") applySelectionBoxVisibility();
    else if (opt === "showBoundingBoxes") applyBoundingBoxes();
    else if (opt === "showGizmos") applyGizmoVisibility();
    else if (opt === "perfStats") updatePerfVisibility();
    else if (opt === "showHoverHighlight" && !store.getViewOption("showHoverHighlight")) clearHover();
    requestRender();
  });

  if (store.getViewOption("gridColor") !== "default" || store.getViewOption("gridCellSize") !== 8) rebuildGrid();
  if (store.getViewOption("perfStats")) updatePerfVisibility();



  const axisScene = new THREE.Scene();
  const axisCam = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  axisScene.add(new THREE.AxesHelper(1.4));                               


  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const ballGeo = new THREE.SphereGeometry(0.5, 24, 16);
  const cylGeo = new THREE.CylinderGeometry(0.5, 0.5, 1, 24);
  cylGeo.rotateZ(Math.PI / 2);                                                     
  const wedgeGeo = makeWedgeGeometry(THREE);
  const sharedGeos = new Set([boxGeo, ballGeo, cylGeo, wedgeGeo]);

  function geoForShape(shape) {
    switch (shape) {
      case "Ball":
        return ballGeo;
      case "Cylinder":
        return cylGeo;
      case "Wedge":
        return wedgeGeo;
      default:
        return boxGeo;
    }
  }


  const csgLodMeshes = new Set();
  const lodTmpVec = new THREE.Vector3();
  const lodTmpScale = new THREE.Vector3();

  function registerLodLevels(mesh, lods, shared) {
    if (!mesh || !lods || lods.length < 2) return false;
    mesh.userData.__rswLods = lods;
    mesh.userData.__rswLodsShared = !!shared;
    mesh.userData.__rswLodLevel = 0;
    csgLodMeshes.add(mesh);
    return true;
  }

  function registerCsgLods(mesh, geo) {
    let lods = null;
    try {
      lods = buildCsgLods(THREE, geo);
    } catch (_) {
      lods = null;
    }
    registerLodLevels(mesh, lods, false);
  }

  function registerMeshPartLods(group) {
    const content = group && group.userData ? group.userData.__meshContent : null;
    if (!content || group.userData.__disposed) return;
    content.traverse((node) => {
      if (!node.isMesh || node.isSkinnedMesh || !node.geometry) return;
      if (node.userData && node.userData.__rswLods) return;
      let lods = null;
      try {
        lods = getSharedMeshLods(THREE, node.geometry);
      } catch (_) {
        lods = null;
      }
      if (lods && lods[0] && lods[0].geo === node.geometry) {
        registerLodLevels(node, lods, true);
      }
    });
  }

  function updateCsgLods() {
    for (const mesh of csgLodMeshes) {
      const lods = mesh.userData ? mesh.userData.__rswLods : null;
      if (!lods || !mesh.parent) continue;
      mesh.getWorldPosition(lodTmpVec);
      const d = camera.position.distanceTo(lodTmpVec);
      lodTmpScale.setFromMatrixScale(mesh.matrixWorld);
      const s = Math.max(lodTmpScale.x, lodTmpScale.y, lodTmpScale.z) || 1;
      const cur = mesh.userData.__rswLodLevel || 0;
      let level = 0;
      for (let i = lods.length - 1; i >= 1; i--) {

        const limit = lods[i].minDist * s * (cur >= i ? 0.9 : 1);
        if (d >= limit) {
          level = i;
          break;
        }
      }
      if (level !== cur) {
        mesh.userData.__rswLodLevel = level;
        mesh.geometry = lods[level].geo;
      }
    }
  }


  function disposeObject(obj) {
    if (!obj) return;
    const visit = (node) => {


      if (node.userData && node.userData.__rswLods) {
        csgLodMeshes.delete(node);
        if (!node.userData.__rswLodsShared) {
          for (const lvl of node.userData.__rswLods) {
            if (lvl && lvl.geo && lvl.geo !== node.geometry && lvl.geo.dispose) lvl.geo.dispose();
          }
        }
        node.userData.__rswLods = null;
        node.userData.__rswLodsShared = false;
      }
      if (
        node.geometry &&
        !sharedGeos.has(node.geometry) &&
        !(node.geometry.userData && node.geometry.userData.__rswShared) &&
        node.geometry.dispose
      ) {


        node.geometry.dispose();
      }
      if (node.material) {
        const mats = Array.isArray(node.material) ? node.material : [node.material];
        for (const m of mats) if (m && m.dispose) m.dispose();
      }
    };
    if (typeof obj.traverse === "function") obj.traverse(visit);
    else visit(obj);
  }

  const meshes = new Map();                  
  const boxes = new Map();                                         
  let selectedSet = new Set();


  const instanced = createInstancedParts({ THREE, scene, geoForShape });


  const decalCarriers = createDecalCarriers({
    THREE,
    scene,
    makeTexture: (assetId) => makeAssetTexture(THREE, assetId, () => requestRender()),
    requestRender: () => requestRender(),
  });


  function acceptsPooled(rec) {


    if (rec && rec.solid) return false;
    return instanced.accepts(rec) && decalCarriers.canHost(rec);
  }
  const promoted = new Map();                                    

  function addMeshForRecord(rec) {
    let obj;
    if (rec.kind === "camera") obj = makeCameraIcon();
    else obj = makePartMesh(rec);
    applyTransform(obj, rec);
    applyColor(obj, rec);
    refreshAppearance(obj, rec, null);
    obj.userData.rswId = rec.id;
    meshes.set(rec.id, obj);
    scene.add(obj);
    if (rec.kind === "camera") {
      cameraIds.add(rec.id);
      obj.visible = store.getViewOption("showGizmos") !== false;
    }
    maybeSwapMaterial(obj);


    try { lightingCtl.relightObject(obj); } catch (_e) {                    }
    if (store.getViewOption("showBoundingBoxes")) bboxDirty = true;
    return obj;
  }

  function removeMeshObject(id) {
    const obj = meshes.get(id);
    if (!obj) return;
    if (obj.userData) obj.userData.__disposed = true;
    restoreObj(obj);
    scene.remove(obj);
    disposeObject(obj);
    meshes.delete(id);
  }


  function poolPart(rec) {
    instanced.add(rec);
    if (decalCarriers.sync(rec)) return true;            
    instanced.remove(rec.id);
    decalCarriers.remove(rec.id);
    return false;
  }

  function promotePart(id, reason) {
    let obj = meshes.get(id) || null;
    if (!obj) {
      if (!instanced.has(id) && !complexInst.has(id)) return null;
      const rec = sync.getRecord(id);
      if (!rec) return null;
      instanced.remove(id);
      complexInst.remove(id);                                            
      decalCarriers.remove(id);                                                  
      obj = addMeshForRecord(rec);


      try { lightingCtl.markShadowsDirty(rec); } catch (_e) {                    }
      requestRender();
    }
    if (reason) {
      let set = promoted.get(id);
      if (!set) promoted.set(id, (set = new Set()));
      set.add(reason);
    }
    return obj;
  }

  function demotePart(id, reason) {
    const set = promoted.get(id);
    if (set) {
      if (reason) set.delete(reason);
      if (set.size) return;
      promoted.delete(id);
    }
    if (selectedSet.has(id) || hoverId === id || animHighlights.has(id)) return;
    if (!meshes.has(id)) return;
    const rec = sync.getRecord(id);
    if (!rec) return;
    if (acceptsPooled(rec)) {
      removeMeshObject(id);
      if (!poolPart(rec)) addMeshForRecord(rec);            


      try { lightingCtl.markShadowsDirty(rec); } catch (_e) {                    }
      requestRender();
      return;
    }


    if (complexInst.accepts(rec) && complexInst.add(rec)) {
      removeMeshObject(id);

      try { lightingCtl.markShadowsDirty(rec); } catch (_e) {                    }
      requestRender();
    }
  }

  const CSG_MAX_PARTS = 24;                                                  


  const meshPoolGate = (rec) => {
    try {
      return skinnedPoseAtRest(rec ? rec.instance : null);
    } catch (_) {
      return false;                                                
    }
  };
  const posePaletteDriver = {
    supported: () => {
      try {
        return !!(renderer && renderer.capabilities && renderer.capabilities.floatVertexTextures);
      } catch (_) {
        return false;                                                         
      }
    },
    fillRow: (instance, meta, out, off) =>
      computePosePalette(meta, collectBonePoseOffsets(instance), out, off),
  };
  const complexInst = createComplexInstanced({
    THREE,
    scene,
    buildCsgGeometry: (rec) => buildUnionGeometry(rec),
    resolveMeshProto,
    applyPoolMaterial: (mesh, rec) =>
      applyPartMaterial(THREE, mesh, rec, { requestRender: () => requestRender() }),


    makeTexture: (assetId, opts) => makeAssetTexture(THREE, assetId, () => requestRender(), opts),
    makeSpecialGeo: (meshType) => geoForMeshType(THREE, meshType),            
    requestRender: () => requestRender(),
    onMeshProtoReady: (meshId) => reevaluateMeshPartPool(meshId),
    meshPoolGate,                                                                   
    posePaletteDriver,                                                                  
    maxCsgParts: CSG_MAX_PARTS,
  });


  const pooled = {
    getRaycastMeshes: () => [
      ...instanced.getRaycastMeshes(),
      ...complexInst.getRaycastMeshes(),
    ],
    idFromHit: (mesh, instanceId) => {
      const id = instanced.idFromHit(mesh, instanceId);
      return id != null ? id : complexInst.idFromHit(mesh, instanceId);
    },


    pickByRay: (ray) => complexInst.pickByRay(ray),
    forEachCenter: (fn) => {
      instanced.forEachCenter(fn);
      complexInst.forEachCenter(fn);
    },
    applyHidden: (hidden) => {
      const a = instanced.applyHidden(hidden);
      const d = decalCarriers.applyHidden(hidden);            
      const b = complexInst.applyHidden(hidden) || d;
      return a || b;
    },
  };


  function resolveMeshProto(meshId, onReady) {
    let data = null;
    try {
      data = resolveMeshData(meshId);
    } catch (_) {
      data = null;
    }
    if (!data) {
      onReady(null);
      return;
    }
    if (data.ext === "obj") {
      getSharedObjGeometry(THREE, data)
        .then((res) => onReady(res || null))
        .catch(() => onReady(null));
      return;
    }
    if (data.ext === "glb" || data.ext === "gltf") {
      getSharedGltfProto(THREE, data)
        .then((res) => onReady(res || null))
        .catch(() => onReady(null));
      return;
    }
    onReady(null);
  }


  function reevaluateMeshPartPool(meshId) {
    for (const [id, obj] of Array.from(meshes)) {
      if (!obj || !obj.userData) continue;
      const isMeshPart = !!obj.userData.isMeshPart;
      if (isMeshPart && (obj.userData.meshId || "") !== meshId) continue;
      if (promoted.has(id) || selectedSet.has(id) || hoverId === id || animHighlights.has(id)) {
        continue;
      }
      const rec = sync.getRecord(id);
      if (!rec) continue;
      if (!isMeshPart) {
        const sp = rec.appearance && rec.appearance.special;
        if (!sp || (sp.meshId || "") !== meshId) continue;
      }
      if (!complexInst.accepts(rec)) continue;
      if (complexInst.add(rec)) removeMeshObject(id);
    }
    requestRender();
  }


  function bakedSourceGeo(p) {
    const k = Math.PI / 180;
    const g = geoForShape(p.shape || "Block").clone();
    const rot = p.rotation || { x: 0, y: 0, z: 0 };
    const q = new THREE.Quaternion().setFromEuler(
      new THREE.Euler((rot.x || 0) * k, (rot.y || 0) * k, (rot.z || 0) * k),
    );
    const sx = Math.max(Math.abs(p.size.x), 0.05);
    const sy = Math.max(Math.abs(p.size.y), 0.05);
    const sz = Math.max(Math.abs(p.size.z), 0.05);
    const m = new THREE.Matrix4().compose(
      new THREE.Vector3(p.local.x, p.local.y, p.local.z),
      q,
      new THREE.Vector3(sx, sy, sz),
    );
    g.applyMatrix4(m);
    return g;
  }


  function applySmoothing(geo, angleDeg) {
    const pos = geo.getAttribute("position");
    const norm = geo.getAttribute("normal");
    if (!pos || !norm) return;
    const n = pos.count;
    const faceN = new Float32Array(n * 3);
    for (let f = 0; f + 2 < n; f += 3) {
      const ax = pos.getX(f), ay = pos.getY(f), az = pos.getZ(f);
      const bx = pos.getX(f + 1), by = pos.getY(f + 1), bz = pos.getZ(f + 1);
      const cx = pos.getX(f + 2), cy = pos.getY(f + 2), cz = pos.getZ(f + 2);
      let nx = (by - ay) * (cz - az) - (bz - az) * (cy - ay);
      let ny = (bz - az) * (cx - ax) - (bx - ax) * (cz - az);
      let nz = (bx - ax) * (cy - ay) - (by - ay) * (cx - ax);
      const l = Math.hypot(nx, ny, nz) || 1;
      nx /= l; ny /= l; nz /= l;
      for (let k = 0; k < 3; k++) {
        faceN[(f + k) * 3] = nx; faceN[(f + k) * 3 + 1] = ny; faceN[(f + k) * 3 + 2] = nz;
      }
    }
    const q = 1e4;
    const keyAt = (i) =>
      Math.round(pos.getX(i) * q) + "_" + Math.round(pos.getY(i) * q) + "_" + Math.round(pos.getZ(i) * q);
    const groups = new Map();
    for (let i = 0; i < n; i++) {
      const k = keyAt(i);
      let arr = groups.get(k);
      if (!arr) { arr = []; groups.set(k, arr); }
      arr.push(i);
    }
    const cosThresh = Math.cos(Math.min(180, Math.max(0, angleDeg)) * Math.PI / 180);
    const out = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const grp = groups.get(keyAt(i));
      const fx = faceN[i * 3], fy = faceN[i * 3 + 1], fz = faceN[i * 3 + 2];
      let sx = 0, sy = 0, sz = 0;
      for (const j of grp) {
        const gx = faceN[j * 3], gy = faceN[j * 3 + 1], gz = faceN[j * 3 + 2];
        if (j === i || fx * gx + fy * gy + fz * gz >= cosThresh) { sx += gx; sy += gy; sz += gz; }
      }
      const l = Math.hypot(sx, sy, sz) || 1;
      out[i * 3] = sx / l; out[i * 3 + 1] = sy / l; out[i * 3 + 2] = sz / l;
    }
    geo.setAttribute("normal", new THREE.Float32BufferAttribute(out, 3));
  }




  function nearestSourceColor(positives, x, y, z) {
    let best = null, bestD = Infinity;
    for (const p of positives) {
      const lx = p.local ? p.local.x : 0, ly = p.local ? p.local.y : 0, lz = p.local ? p.local.z : 0;
      const hx = Math.abs(p.size.x) / 2, hy = Math.abs(p.size.y) / 2, hz = Math.abs(p.size.z) / 2;
      const dx = Math.max(0, Math.abs(x - lx) - hx);
      const dy = Math.max(0, Math.abs(y - ly) - hy);
      const dz = Math.max(0, Math.abs(z - lz) - hz);
      const d = dx * dx + dy * dy + dz * dz;
      if (d < bestD) { bestD = d; best = p; }
    }
    return best && best.color ? best.color : { r: 0.64, g: 0.64, b: 0.64 };
  }


  function applyCsgShading(geo, rec) {
    const norm = geo.getAttribute("normal");
    const pos = geo.getAttribute("position");
    if (!norm) return;
    let lx = 0.4, ly = 1.0, lz = 0.55;
    const ll = Math.hypot(lx, ly, lz) || 1;
    lx /= ll; ly /= ll; lz /= ll;
    const usePartColor = !!(rec.csg && rec.csg.usePartColor);
    const positives =
      !usePartColor && rec.csg && Array.isArray(rec.csg.parts)
        ? rec.csg.parts.filter((p) => !p.negate)
        : [];
    const colors = new Float32Array(norm.count * 3);
    for (let i = 0; i < norm.count; i++) {
      const d = norm.getX(i) * lx + norm.getY(i) * ly + norm.getZ(i) * lz;
      const shade = 0.45 + 0.55 * Math.max(0, d);
      let cr = 1, cg = 1, cb = 1;
      if (positives.length && pos) {
        const sc = nearestSourceColor(positives, pos.getX(i), pos.getY(i), pos.getZ(i));
        cr = sc.r; cg = sc.g; cb = sc.b;
      }
      colors[i * 3] = shade * cr;
      colors[i * 3 + 1] = shade * cg;
      colors[i * 3 + 2] = shade * cb;
    }
    geo.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
  }


  function publishCsgCollider(rec, geo) {
    if (!rec || !rec.instance || !geo) return;
    const pos = geo.getAttribute("position");
    if (!pos || !pos.array) return;
    rec.instance._csgMesh = {
      positions: Array.from(pos.array),
      baseSize: rec.size ? { x: rec.size.x, y: rec.size.y, z: rec.size.z } : null,
    };
  }

  function buildUnionGeometry(rec) {
    const parts = rec.csg && Array.isArray(rec.csg.parts) ? rec.csg.parts : [];
    if (!parts.length || parts.length > CSG_MAX_PARTS) return null;
    const positives = parts.filter((p) => !p.negate);
    const negatives = parts.filter((p) => p.negate);
    if (!positives.length) return null;                                    

    let acc = null;
    try {
      for (const p of positives) {
        const g = bakedSourceGeo(p);
        const c = CSG.fromGeometry(THREE, g);
        if (g.dispose) g.dispose();
        acc = acc ? acc.union(c) : c;
      }
      for (const p of negatives) {
        const g = bakedSourceGeo(p);
        const c = CSG.fromGeometry(THREE, g);
        if (g.dispose) g.dispose();
        acc = acc.subtract(c);
      }
    } catch (err) {
      logger.warn(`CSG da Union falhou; usando caixa simples. (${err.message})`);
      return null;
    }
    const geo = CSG.toGeometry(THREE, acc);
    applySmoothing(geo, rec.csg && Number.isFinite(rec.csg.smoothingAngle) ? rec.csg.smoothingAngle : 50);
    applyCsgShading(geo, rec);
    publishCsgCollider(rec, geo);
    return geo;
  }


  const solidWarned = new Set();
  function warnSolidFallback(rec, why) {
    if (!rec || solidWarned.has(rec.id)) return;
    solidWarned.add(rec.id);
    logger.warn(`Union "${rec.name || rec.id}" sem geometria utilizável (${why}); usando a caixa do Size.`);
  }


  function tintSolidVertexColors(geo, colors) {
    const attr = geo.getAttribute("color");
    if (!attr || !colors || !colors.length) return;
    const clamp01 = (v) => (Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : 1);
    for (let i = 0; i < attr.count; i++) {
      attr.setX(i, attr.getX(i) * clamp01(Number(colors[i * 3])));
      attr.setY(i, attr.getY(i) * clamp01(Number(colors[i * 3 + 1])));
      attr.setZ(i, attr.getZ(i) * clamp01(Number(colors[i * 3 + 2])));
    }
    attr.needsUpdate = true;
  }


  function publishSolidCollider(rec, geo) {
    if (!rec || !rec.instance || !geo || rec.csg) return;
    const pos = geo.getAttribute("position");
    if (!pos || !pos.array) return;
    const bs = rec.solid && rec.solid.baseSize ? rec.solid.baseSize : rec.size;
    rec.instance._csgMesh = {
      positions: Array.from(pos.array),
      baseSize: bs ? { x: bs.x, y: bs.y, z: bs.z } : null,
    };
  }


  function buildSolidGeometry(rec) {
    const solid = rec && rec.solid;
    const positions = solid && Array.isArray(solid.positions) ? solid.positions : null;
    if (!positions || positions.length < 9) return null;
    let geo = null;
    try {
      const triFloats = positions.length - (positions.length % 9);
      const arr = new Float32Array(triFloats);
      for (let i = 0; i < triFloats; i++) {
        const v = Number(positions[i]);
        if (!Number.isFinite(v)) return null;                                 
        arr[i] = v;
      }
      geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.Float32BufferAttribute(arr, 3));
      geo.computeVertexNormals();                                                      
      applySmoothing(geo, Number.isFinite(solid.smoothingAngle) ? solid.smoothingAngle : 50);
      applyCsgShading(geo, rec);
      if (!solid.usePartColor && solid.colors) tintSolidVertexColors(geo, solid.colors);
      publishSolidCollider(rec, geo);
      return geo;
    } catch (err) {
      void err;                                                         
      if (geo && geo.dispose) geo.dispose();
      return null;
    }
  }


  function buildMeshPlaceholder(rec) {


    void rec;
    const group = new THREE.Group();
    const solid = new THREE.Mesh(
      new THREE.BoxGeometry(1, 1, 1),
      new THREE.MeshBasicMaterial({ color: 0x9aa0a8 }),
    );
    const wire = new THREE.Mesh(
      new THREE.BoxGeometry(1.001, 1.001, 1.001),
      new THREE.MeshBasicMaterial({
        color: 0x5b6470,
        wireframe: true,
        transparent: true,
        opacity: 0.8,
      }),
    );
    group.add(solid, wire);
    return group;
  }

  function loadMeshForGroup(group, rec) {


    const data = resolveMeshData(rec.meshId);
    if (!data) {
      let skin = getSkin(rec.meshId);
      if (!skin && rec.meshId) {
        try {
          const assetRec = assetStore.getById ? assetStore.getById(rec.meshId) : null;
          if (assetRec && assetRec.skin) skin = registerSkin(rec.meshId, assetRec.skin);
        } catch (_) {
          skin = null;
        }
      }
      if (skin) bindSkinnedGroup(group, rec, skin);
      return;                                                              
    }
    loadMeshInto(THREE, group, data, (info) => {

      if (info && info.size && rec.instance && typeof rec.instance._setInternal === "function") {
        try {
          rec.instance._setInternal(
            "MeshSize",
            makeVector3(info.size.x, info.size.y, info.size.z),
          );
        } catch (_) {

        }
      }


      if (info && info.hasSkin) {
        bindLoadedSkinnedScene(group, rec, group.userData.__meshContent || group);
      }
      syncAppearance(THREE, group, group.userData.__rswRec || rec, { requestRender });
      registerMeshPartLods(group);


      if (group.userData) group.userData.__litMode = null;
      requestRender();
      if (selectedSet.has(rec.id)) refreshBox(rec.id);
    });
  }

  function makeMeshPartObject(rec) {
    const group = new THREE.Group();
    group.userData.shape = "Mesh";
    group.userData.isMeshPart = true;
    group.userData.meshId = rec.meshId || "";
    const ph = buildMeshPlaceholder(rec);
    group.add(ph);
    group.userData.__placeholder = ph;
    loadMeshForGroup(group, rec);
    return group;
  }

  function resetMeshGroup(group, rec) {
    unbindSkinnedGroup(rec.id);                                                
    for (const child of group.children.slice()) {
      group.remove(child);
      disposeObject(child);
    }
    group.userData.__meshLoaded = false;
    group.userData.__meshContent = null;
    group.userData.meshId = rec.meshId || "";
    const ph = buildMeshPlaceholder(rec);
    group.add(ph);
    group.userData.__placeholder = ph;
    loadMeshForGroup(group, rec);
  }

  function makePartMesh(rec) {

    if (rec.isMeshPart) return makeMeshPartObject(rec);

    if (rec.csg) {


      const cached = complexInst.csgGeometryFor(rec);
      const geo = cached ? cached.geo : buildUnionGeometry(rec);
      if (geo) {
        const mat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(rec.color.r, rec.color.g, rec.color.b),
          vertexColors: true,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.userData.shape = "Union";
        mesh.userData.csg = true;
        mesh.frustumCulled = true;
        if (cached) {

          if (rec.instance && cached.positions) {
            rec.instance._csgMesh = {
              positions: cached.positions,
              baseSize: { x: cached.baseSize.x, y: cached.baseSize.y, z: cached.baseSize.z },
            };
          }
          if (cached.lods) registerLodLevels(mesh, cached.lods, true);
        } else {


          registerCsgLods(mesh, geo);
        }
        return mesh;
      }

    }


    if (rec.solid && !rec.csg) {
      const geo = buildSolidGeometry(rec);
      if (geo) {
        const mat = new THREE.MeshBasicMaterial({
          color: new THREE.Color(rec.color.r, rec.color.g, rec.color.b),
          vertexColors: true,
          side: THREE.DoubleSide,
        });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.userData.shape = "Union";
        mesh.userData.csg = true;                                        
        mesh.userData.solid = true;                                              
        mesh.frustumCulled = true;

        registerCsgLods(mesh, geo);
        return mesh;
      }

      warnSolidFallback(rec, "malha importada inválida");
    } else if (rec.className === "UnionOperation" && !rec.csg && !rec.solid) {

      warnSolidFallback(rec, "sem receita local nem malha importada");
    }
    const mat = new THREE.MeshBasicMaterial({ color: new THREE.Color(rec.color.r, rec.color.g, rec.color.b) });
    const shape = rec.shape || "Block";
    if (shape === "Wedge") mat.side = THREE.DoubleSide;
    const mesh = new THREE.Mesh(geoForShape(shape), mat);
    mesh.userData.shape = shape;
    mesh.frustumCulled = true;                                               

    if (rec.className === "SpawnLocation") {
      const deco = makeSpawnDecal();
      if (deco) mesh.add(deco);
    }
    return mesh;
  }


  function makeSpawnDecal() {
    if (typeof document === "undefined") return null;
    const cv = document.createElement("canvas");
    cv.width = 128;
    cv.height = 128;
    const ctx = cv.getContext("2d");
    if (!ctx) return null;
    ctx.clearRect(0, 0, 128, 128);
    ctx.fillStyle = "rgba(235, 235, 235, 0.95)";
    ctx.beginPath();
    ctx.arc(64, 64, 52, 0, Math.PI * 2);
    ctx.fill();
    ctx.strokeStyle = "rgba(55, 55, 55, 0.95)";
    ctx.lineWidth = 9;
    ctx.beginPath();
    ctx.arc(64, 64, 37, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fillStyle = "rgba(55, 55, 55, 0.95)";
    ctx.beginPath();
    ctx.arc(64, 64, 14, 0, Math.PI * 2);
    ctx.fill();
    const tex = new THREE.CanvasTexture(cv);
    const mat = new THREE.MeshBasicMaterial({
      map: tex,
      transparent: true,
      depthWrite: false,
      polygonOffset: true,
      polygonOffsetFactor: -1,
      polygonOffsetUnits: -1,
    });
    const plane = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.9), mat);
    plane.rotation.x = -Math.PI / 2;
    plane.position.y = 0.51;                                               
    plane.userData.rswDecal = true;
    return plane;
  }

  function makeCameraIcon() {
    const group = new THREE.Group();
    const bodyMat = new THREE.MeshBasicMaterial({ color: 0x2e8bff, wireframe: true });
    const body = new THREE.Mesh(boxGeo, bodyMat);
    body.scale.set(2.4, 2.4, 3.4);
    const lensMat = new THREE.MeshBasicMaterial({ color: 0x8fc2ff, wireframe: true });
    const lens = new THREE.Mesh(new THREE.ConeGeometry(1.4, 2, 16), lensMat);
    lens.rotation.x = Math.PI / 2;
    lens.position.z = 2.6;
    group.add(body, lens);
    return group;
  }


  const ghostMats = new Map();                                                    
  function ghostRestore() {
    for (const [m, saved] of ghostMats) {
      m.transparent = saved.transparent;
      m.opacity = saved.opacity;
      m.depthWrite = saved.depthWrite;
      m.needsUpdate = true;
    }
    ghostMats.clear();
  }

  function applyTransform(obj, rec) {
    obj.position.set(rec.position.x, rec.position.y, rec.position.z);
    if (rec.kind === "part") {
      const sx = Math.max(rec.size.x, 0.05);
      const sy = Math.max(rec.size.y, 0.05);
      const sz = Math.max(rec.size.z, 0.05);


      const solidBaked = !rec.csg && rec.solid && obj.userData && obj.userData.solid === true;
      if (rec.csg || solidBaked) {


        const bs = (rec.csg ? rec.csg.baseSize : rec.solid.baseSize) || rec.size;
        const rx = sx / Math.max(bs.x, 0.05);
        const ry = sy / Math.max(bs.y, 0.05);
        const rz = sz / Math.max(bs.z, 0.05);
        obj.scale.set(
          Number.isFinite(rx) && rx > 0 ? rx : 1,
          Number.isFinite(ry) && ry > 0 ? ry : 1,
          Number.isFinite(rz) && rz > 0 ? rz : 1,
        );
      } else {
        obj.scale.set(sx, sy, sz);
      }

      const rot = rec.rotation;
      if (rot) {
        const k = Math.PI / 180;
        obj.rotation.set(rot.x * k, rot.y * k, rot.z * k);
      }


      const ltm = Number.isFinite(rec.localTransparency) ? rec.localTransparency : 0;
      const t = rec.transparency + (1 - rec.transparency) * ltm;


      const matOp =
        obj.userData && Number.isFinite(obj.userData.__rswMatOpacity)
          ? obj.userData.__rswMatOpacity
          : 1;
      const eff = (1 - t) * matOp;
      if (obj.material) {


        const ghostSaved = ghostMats.get(obj.material);
        if (ghostSaved) {
          ghostSaved.transparent = eff < 1;
          ghostSaved.opacity = eff;
          obj.material.transparent = true;
          obj.material.opacity = Math.min(0.5, eff);
        } else {
          obj.material.transparent = eff < 1;
          obj.material.opacity = eff;
        }


        obj.material.visible = t < 1 && !obj.userData.__rswSurfaceHidden;
      }
      const hasDecalLayers = !!(
        rec.appearance &&
        Array.isArray(rec.appearance.layers) &&
        rec.appearance.layers.length
      );
      obj.visible = t < 1 || hasDecalLayers;
    }
  }

  function applyColor(obj, rec) {
    if (rec.kind === "part" && obj.material && obj.material.color) {


      const neon = !!(obj.userData && obj.userData.__rswNeon);
      const boost = neon ? 2.2 : 1;
      const cr = rec.color.r * boost;
      const cg = rec.color.g * boost;
      const cb = rec.color.b * boost;
      obj.material.color.setRGB(cr, cg, cb);


      syncNeonEmissive(obj.material, cr, cg, cb, neon);


      if (obj.userData && obj.userData.__origMat && obj.userData.__origMat.color) {
        obj.userData.__origMat.color.setRGB(cr, cg, cb);
        syncNeonEmissive(obj.userData.__origMat, cr, cg, cb, neon);
      }
    }
  }


  function refreshAppearance(obj, rec, keys) {
    obj.userData.__rswRec = rec;
    const all = !keys;
    if (
      all ||
      keys.indexOf("Material") !== -1 ||
      keys.indexOf("MaterialVariant") !== -1 ||
      keys.indexOf("SubstrateMaterial") !== -1 ||
      keys.indexOf("Size") !== -1
    ) {
      applyPartMaterial(THREE, obj, rec, { requestRender });
      applyColor(obj, rec);
      applyTransform(obj, rec);                                            
    }
    if (
      all ||
      keys.indexOf("Appearance") !== -1 ||
      keys.indexOf("Size") !== -1 ||
      keys.indexOf("TextureID") !== -1 ||
      keys.indexOf("DoubleSided") !== -1 ||
      keys.indexOf("MeshId") !== -1 ||
      keys.indexOf("Transparency") !== -1
    ) {
      syncAppearance(THREE, obj, rec, { requestRender });
      applyTransform(obj, rec);                                          
    }
  }

  function refreshBox(id) {
    const box = boxes.get(id);
    const obj = meshes.get(id);


    if (box && obj && box.box) computeVisualBox(obj, box.box);
  }

  function updateSelectionBoxes(idsSet) {
    selectedSet = idsSet || new Set();

    for (const [id, box] of boxes) {
      if (!selectedSet.has(id)) {
        scene.remove(box);
        disposeObject(box);
        boxes.delete(id);
        demotePart(id, null);
      }
    }

    for (const id of selectedSet) {
      if (boxes.has(id)) continue;
      const obj = meshes.get(id) || promotePart(id, null);
      if (!obj) continue;


      const helper = new THREE.Box3Helper(computeVisualBox(obj, new THREE.Box3()), SELECTION_COLOR);
      if (helper.material) {
        helper.material.depthTest = false;
        helper.material.transparent = true;
      }
      helper.renderOrder = 999;

      helper.visible = store.getViewOption("showSelectionBoxes") !== false;
      boxes.set(id, helper);
      scene.add(helper);
    }


    requestRender();
  }


  const sink = {
    add(rec) {
      lightingCtl.markShadowsDirty();                                         
      if (!selectedSet.has(rec.id)) {
        if (acceptsPooled(rec) && poolPart(rec)) {
          requestRender();
          return;
        }

        if (complexInst.accepts(rec) && complexInst.add(rec)) {
          requestRender();
          return;
        }
      }
      addMeshForRecord(rec);
      if (selectedSet.has(rec.id)) updateSelectionBoxes(selectedSet);
      requestRender();
    },
    update(rec, keys) {


      lightingCtl.markShadowsDirty(rec);
      if (instanced.has(rec.id)) {
        if (acceptsPooled(rec) && !selectedSet.has(rec.id)) {
          instanced.update(rec);
          if (decalCarriers.sync(rec)) {            
            requestRender();
            return;
          }
        }
        instanced.remove(rec.id);
        decalCarriers.remove(rec.id);            
        addMeshForRecord(rec);
        if (selectedSet.has(rec.id)) updateSelectionBoxes(selectedSet);
        requestRender();
        return;
      }


      if (complexInst.has(rec.id)) {
        if (
          complexInst.accepts(rec) &&
          !selectedSet.has(rec.id) &&
          complexInst.update(rec, keys)
        ) {
          requestRender();
          return;
        }
        complexInst.remove(rec.id);
        addMeshForRecord(rec);
        if (selectedSet.has(rec.id)) updateSelectionBoxes(selectedSet);
        requestRender();
        return;
      }
      const obj = meshes.get(rec.id);
      if (!obj) return;
      if (
        rec.kind === "part" &&
        !promoted.has(rec.id) &&
        !selectedSet.has(rec.id) &&
        hoverId !== rec.id &&
        !animHighlights.has(rec.id)
      ) {
        if (acceptsPooled(rec)) {
          removeMeshObject(rec.id);
          if (!poolPart(rec)) addMeshForRecord(rec);            
          requestRender();
          return;
        }

        if (complexInst.accepts(rec) && complexInst.add(rec)) {
          removeMeshObject(rec.id);
          requestRender();
          return;
        }
      }
      if (keys && keys.indexOf("MeshId") !== -1 && obj.userData && obj.userData.isMeshPart) {
        if ((rec.meshId || "") !== (obj.userData.meshId || "")) resetMeshGroup(obj, rec);
      }
      if (keys && keys.indexOf("Shape") !== -1 && rec.kind === "part") {
        const newShape = rec.shape || "Block";
        if (obj.userData.shape !== newShape) {
          obj.geometry = geoForShape(newShape);
          obj.userData.shape = newShape;
          if (obj.material) {
            obj.material.side = newShape === "Wedge" ? THREE.DoubleSide : THREE.FrontSide;
            obj.material.needsUpdate = true;
          }
        }
      }


      if (
        rec.solid && !rec.csg && obj.userData && obj.userData.solid === true &&
        keys && (keys.indexOf("UsePartColor") !== -1 || keys.indexOf("SmoothingAngle") !== -1)
      ) {
        removeMeshObject(rec.id);
        addMeshForRecord(rec);
        if (selectedSet.has(rec.id)) refreshBox(rec.id);
        requestRender();
        return;
      }
      applyTransform(obj, rec);
      if (keys && keys.indexOf("Color") !== -1) applyColor(obj, rec);

      if (
        keys &&
        (keys.indexOf("Material") !== -1 ||
          keys.indexOf("MaterialVariant") !== -1 ||
      keys.indexOf("SubstrateMaterial") !== -1 ||
          keys.indexOf("Appearance") !== -1 ||
          keys.indexOf("Size") !== -1 ||
          keys.indexOf("TextureID") !== -1 ||
          keys.indexOf("DoubleSided") !== -1 ||
          keys.indexOf("Transparency") !== -1)
      ) {
        refreshAppearance(obj, rec, keys);
      }
      if (selectedSet.has(rec.id)) refreshBox(rec.id);
      requestRender();
    },
    remove(id) {
      lightingCtl.markShadowsDirty();                                    
      promoted.delete(id);
      if (instanced.remove(id)) requestRender();
      if (decalCarriers.remove(id)) requestRender();            
      if (complexInst.remove(id)) requestRender();            
      const obj = meshes.get(id);
      if (obj) {
        if (obj.userData) obj.userData.__disposed = true;                      
        restoreObj(obj);                                                              
        scene.remove(obj);
        disposeObject(obj);
        meshes.delete(id);
      }
      const box = boxes.get(id);
      if (box) {
        scene.remove(box);
        disposeObject(box);
        boxes.delete(id);
      }

      cameraIds.delete(id);
      const bb = bboxes.get(id);
      if (bb) {
        scene.remove(bb);
        disposeObject(bb);
        bboxes.delete(id);
      }
      if (id === hoverId) clearHover();
      requestRender();
    },
    selection(idsSet) {
      updateSelectionBoxes(idsSet);
    },
  };


  function fallbackBoneWorld(bone) {
    let x = 0, y = 0, z = 0;
    let node = bone;
    let guard = 0;
    while (node && node.className === "Bone" && guard++ < 64) {
      const p = (node.getProperty && node.getProperty("Position")) || {};
      const t = (node.getProperty && node.getProperty("Transform")) || {};
      x += (Number(p.x) || 0) + (Number(t.x) || 0);
      y += (Number(p.y) || 0) + (Number(t.y) || 0);
      z += (Number(p.z) || 0) + (Number(t.z) || 0);
      node = typeof node.getParent === "function" ? node.getParent() : null;
    }
    let host = node;
    while (host && guard++ < 64 && !(host.hasProperty && host.hasProperty("Position") && typeof host.getProperty === "function")) {
      host = typeof host.getParent === "function" ? host.getParent() : null;
    }
    if (!host) return null;
    const hp = host.getProperty("Position") || { x: 0, y: 0, z: 0 };
    return {
      position: { x: (Number(hp.x) || 0) + x, y: (Number(hp.y) || 0) + y, z: (Number(hp.z) || 0) + z },
      parentQuat: { x: 0, y: 0, z: 0, w: 1 },
      parentScale: { x: 1, y: 1, z: 1 },
    };
  }

  function selectedBoneRecords() {
    const out = [];
    let sel = [];
    try { sel = selection.get() || []; } catch (_) { sel = []; }
    for (const inst of sel) {
      if (!inst || inst.className !== "Bone") continue;
      const info = resolveBoneWorld(inst) || fallbackBoneWorld(inst);
      if (!info) continue;
      out.push({ kind: "bone", id: inst.id, instance: inst, position: info.position, boneInfo: info });
    }
    return out;
  }

  const gizmos = buildGizmos({
    THREE,
    host,
    camera,
    getSelectedRecords: () => {
      const recs = sync.getSelectedRecords();
      const boneRecs = selectedBoneRecords();
      return boneRecs.length ? recs.concat(boneRecs) : recs;
    },
    requestRender: () => requestRender(),
  });


  initSkinning({ THREE, requestRender: () => requestRender() });


  function evictPooledSkinnedFor(boneInst) {
    let node = boneInst;
    let guard = 0;
    while (node && guard < 64) {
      guard += 1;
      const nid = node.id;
      if (nid != null && complexInst.has(nid)) {
        if (complexInst.markPoseDirty(nid)) return;                                  
        complexInst.remove(nid);
        const rec = sync.getRecord(nid);
        if (rec) addMeshForRecord(rec);
        requestRender();
        return;
      }
      node = typeof node.getParent === "function" ? node.getParent() : null;
    }
  }
  const offBoneEvict = [
    bus.on(Events.PropertyChanged, (p) => {
      const inst = p && p.instance;
      if (!inst || inst.className !== "Bone") return;
      if (
        p.property !== "Transform" &&
        p.property !== "TransformRotation" &&
        p.property !== "Position" &&
        p.property !== "Orientation"
      )
        return;
      evictPooledSkinnedFor(inst);
    }),
    bus.on(Events.ParentChanged, (p) => {
      const inst = p && p.instance;
      if (inst && inst.className === "Bone") evictPooledSkinnedFor(inst);
    }),
  ];
  const boneGizmos = initBoneGizmos({
    THREE,
    scene,
    camera,
    host,
    requestRender: () => requestRender(),
  });

  const ikGizmos = initIkGizmos({ THREE, scene, requestRender: () => requestRender() });
  const avatarGizmos = initAvatarGizmos({ THREE, scene, requestRender: () => requestRender() });

  const climateCtl = initClimateRender({ THREE, scene, camera, requestRender: () => requestRender(), meshFor: (id) => meshes.get(id) || promotePart(id, "adorn") });


  const adornCtl = initAdornRenderer({ scene, camera, renderer, requestRender: () => requestRender(), meshFor: (id) => meshes.get(id) || promotePart(id, "adorn") });


  const worldGuiCtl = initWorldGuiRenderer({ scene, camera, renderer, requestRender: () => requestRender(), meshFor: (id) => meshes.get(id) || promotePart(id, "adorn") });


  const viewportSelection = createViewportSelection({
    THREE,
    host,
    camera,
    meshes,
    instanced: pooled,
    sync,
    requestRender: () => requestRender(),
    isGizmoDragging: () => gizmos.isDragging(),
  });


  let unregisterRenderFrameCallback = null;
  function requestRender() {
    dirty = true;
  }


  const refractionPass = createRefractionPass({ THREE, scene });


  const planarPass = createPlanarReflections({ THREE, scene });


  if (typeof window !== "undefined") {
    window.__rswPlanarQa = { get: () => planarPass.getQa() };
  }
  reportProgress(0.85);
  await yieldToBrowserPaint();
  const terrainRenderer = createTerrainRenderer({
    THREE,
    scene,


    requestRender: () => {


      const tdata = terrainStore.getData();
      const editedReg = tdata && tdata.takeEditedRegion ? tdata.takeEditedRegion() : null;
      if (editedReg && !editedReg.all && editedReg.min && editedReg.max) {


        const minX = (editedReg.min[0] - 2) * VOXEL_SIZE;
        const minY = (editedReg.min[1] - 2) * VOXEL_SIZE;
        const minZ = (editedReg.min[2] - 2) * VOXEL_SIZE;
        const maxX = (editedReg.max[0] + 3) * VOXEL_SIZE;
        const maxY = (editedReg.max[1] + 3) * VOXEL_SIZE;
        const maxZ = (editedReg.max[2] + 3) * VOXEL_SIZE;
        lightingCtl.markShadowsDirty({
          terrainAabb: { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] },
        });
      } else {
        lightingCtl.markShadowsDirty();
      }
      lightingCtl.markGiDirty();
      requestRender();
    },


    requestAnimRender: () => requestRender(),

    patchMaterial: (mat) => lightingCtl.patchExternalMaterial(mat),
  });
  const terrainController = createTerrainController({
    THREE,
    host,
    camera,
    scene,
    requestRender: () => requestRender(),
    getRaycastTargets: () => {
      const terrain = terrainRenderer.getRaycastTargets();

      if (terrainStore.getIgnoreParts()) return terrain;

      const parts = [];
      scene.traverse((o) => { if (o && o.isMesh && o.userData && (o.userData.rswId || o.userData.__rswPool)) parts.push(o); });
      return terrain.concat(parts);
    },
  });


  const regionController = createRegionController({
    THREE,
    host,
    camera,
    scene,
    requestRender: () => requestRender(),
    getRaycastTargets: () => terrainRenderer.getRaycastTargets(),
  });


  const animHighlights = new Map();                      
  const ANIM_HL_COLOR = 0x35e07a;
  function addAnimHighlight(id) {
    if (animHighlights.has(id)) return;
    const obj = meshes.get(id) || promotePart(id, "anim");
    if (!obj) return;
    const edges = new THREE.EdgesGeometry(new THREE.BoxGeometry(1.06, 1.06, 1.06));
    const mat = new THREE.LineBasicMaterial({ color: ANIM_HL_COLOR, transparent: true, opacity: 0.95, depthTest: false });
    const line = new THREE.LineSegments(edges, mat);
    line.renderOrder = 999;
    line.userData.__animHL = true;
    obj.add(line);
    animHighlights.set(id, line);
  }
  function clearAnimHighlights() {
    const ids = [...animHighlights.keys()];
    animHighlights.forEach((line) => {
      if (line.parent) line.parent.remove(line);
      disposeObject(line);
    });
    animHighlights.clear();
    for (const id of ids) demotePart(id, "anim");
  }
  function refreshAnimHighlights() {
    clearAnimHighlights();
    for (const id of getAnimatablePartIds()) addAnimHighlight(id);
    requestRender();
  }
  bus.on(AnimEvents.SessionChanged, (p) => {
    if (p && p.open) refreshAnimHighlights();
    else { clearAnimHighlights(); requestRender(); }
  });


  const EDITOR_CAMERA_FAR = camera.far;                                       
  let appliedPlayGfx = null;                                          
  let playAutoPrevT = 0;                                                    
  let playGfxPending = false;                                       
  let tierScalePending = false;                                                    
  function applyPlayGfx(force) {
    const q = effectivePlayQuality();
    if (!force && q === appliedPlayGfx) return;
    appliedPlayGfx = q;
    const dist = drawDistanceFor(q);
    camera.far = Number.isFinite(dist) ? Math.min(dist, EDITOR_CAMERA_FAR) : EDITOR_CAMERA_FAR;
    lightingCtl.setPlayShadowScale(shadowScaleFor(q));
    setEffectsQualityScale(particleScaleFor(q));
    setClimateQualityScale(particleScaleFor(q));
    resize();                                                                   
  }
  function flushPlayGfx() {
    if (!playGfxPending) return;
    playGfxPending = false;
    applyPlayGfx();
  }
  bus.on("coregui:graphicsQuality", (p) => {
    const raw = p ? p.value : undefined;
    const v = Number(raw);


    if (!Number.isFinite(v) || v !== (v | 0) || v < 0 || v > 10) {
      logger.warn("Viewport: coregui:graphicsQuality inválido ignorado:", raw);
      return;
    }
    const active = !!(p && p.play === true);
    if (v === playGfxQuality && active === playGfxActive) return;
    playGfxQuality = v;
    playGfxActive = active;


    lightingCtl.setPlayModeActive(active);
    playAutoCtl.reset();                                                    
    applyPlayGfx(true);
  });


  if (isDebugSurfaceEnabled() && typeof window !== "undefined" && !window.__rswGfxQuality) {
    window.__rswGfxQuality = {
      quality: () => playGfxQuality,
      base: () => pixelRatioBase(),
      pixelRatio: () => renderer.getPixelRatio(),

      playActive: () => playGfxActive,
      effective: () => effectivePlayQuality(),
      autoLevel: () => playAutoCtl.level(),
      cameraFar: () => camera.far,
      shadowScale: () => lightingCtl.getPlayShadowScale(),
      particleScale: () => getEffectsQualityScale(),

      tierScale: () => tierRenderScale,
    };
  }

  function resize() {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    renderer.setDrawingBufferSize(w, h, pixelRatioFor());
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    postfx.setSize(w, h);

    sceneChangedFrame = true;
    requestRender();
  }


  let editorFovSaved = null;


  const __lastGoodPose = { p: { x: 20, y: 20, z: 20 }, t: { x: 0, y: 0, z: 0 } };
  let __lastBadPoseLog = 0;


  let __frameFails = 0;
  let __lastFrameFailLog = 0;


  const __ikArgs = { dataModel: null, cameraPos: { x: 0, y: 0, z: 0 }, cameraTarget: null };


  const __poseP = { x: 20, y: 20, z: 20 };
  const __poseT = { x: 0, y: 0, z: 0 };


  let sceneChangedFrame = true;
  let presentedFrameCount = 0;
  let preparingForDisplay = false;
  let presentationError = null;
  function renderFrame() {
    if (presentationError) return;
    if (store.get("appMode") !== "EDITOR" && !preparingForDisplay && !capturingThumbnail) return;
    try {
      __renderFrameBody();
      __frameFails = 0;
    } catch (err) {
      if (preparingForDisplay) {
        presentationError = err;
        return;
      }
      __frameFails += 1;
      const nowMs = performance.now();
      if (nowMs - __lastFrameFailLog > 2000) {
        __lastFrameFailLog = nowMs;
        logger.error("Viewport: erro no frame (isolado para não apagar a cena):", err);
      }
      if (__frameFails === 3) {
        lightingCtl.disableShaderPatches("exceções repetidas no frame");
      }
      try {
        renderer.render(scene, camera);
      } catch (_) {

      }
    }
  }


  const __boxGateQa = { runs: 0, skips: 0 };
  if (typeof globalThis !== "undefined") {
    globalThis.__rswBoxGateQa = __boxGateQa;
    globalThis.__rswCamPos = () => ({ x: camera.position.x, y: camera.position.y, z: camera.position.z });
  }

  function __renderFrameBody() {
    const __frameStart = typeof performance !== "undefined" ? performance.now() : Date.now();                        

    const pose = playtest.getCameraPose();

    const p = __poseP;
    const t = __poseT;
    if (pose) {
      p.x = pose.px; p.y = pose.py; p.z = pose.pz;
      t.x = pose.tx; t.y = pose.ty; t.z = pose.tz;
    } else {
      const rp = rig.getPosition();
      const rt = rig.getTarget();
      p.x = rp.x; p.y = rp.y; p.z = rp.z;
      t.x = rt.x; t.y = rt.y; t.z = rt.z;
    }


    if (!Number.isFinite(p.x + p.y + p.z + t.x + t.y + t.z)) {
      const nowBad = performance.now();
      if (nowBad - __lastBadPoseLog > 2000) {
        __lastBadPoseLog = nowBad;
        logger.error(
          "Viewport: pose de câmera inválida (NaN/Infinity) ignorada — verifique física/scripts.",
          { p: { ...p }, t: { ...t }, playtest: !!pose },
        );
      }
      p.x = __lastGoodPose.p.x; p.y = __lastGoodPose.p.y; p.z = __lastGoodPose.p.z;
      t.x = __lastGoodPose.t.x; t.y = __lastGoodPose.t.y; t.z = __lastGoodPose.t.z;
    } else {
      __lastGoodPose.p.x = p.x; __lastGoodPose.p.y = p.y; __lastGoodPose.p.z = p.z;
      __lastGoodPose.t.x = t.x; __lastGoodPose.t.y = t.y; __lastGoodPose.t.z = t.z;
    }

    if (p.x === t.x && p.y === t.y && p.z === t.z) t.z = t.z - 1;


    if (pose) {
      if (editorFovSaved === null) editorFovSaved = camera.fov;
      const gameFov = typeof playtest.getCameraFov === "function" ? playtest.getCameraFov() : 70;
      if (Number.isFinite(gameFov) && Math.abs(camera.fov - gameFov) > 0.01) {
        camera.fov = gameFov;
        camera.updateProjectionMatrix();
      }
    } else if (editorFovSaved !== null) {
      if (Math.abs(camera.fov - editorFovSaved) > 0.01) {
        camera.fov = editorFovSaved;
        camera.updateProjectionMatrix();
      }
      editorFovSaved = null;
    }
    camera.position.set(p.x, p.y, p.z);
    camera.lookAt(t.x, t.y, t.z);


    if (csgLodMeshes.size) updateCsgLods();

    complexInst.updateLods(camera.position);

    complexInst.sortTranslucent(camera.position);


    complexInst.updatePosePalettes();


    const skinnedPosed = updateSkinning(camera);
    if (boneGizmos) boneGizmos.update();

    __ikArgs.dataModel = store.getDataModel ? store.getDataModel() : null;
    __ikArgs.cameraPos.x = camera.position.x;
    __ikArgs.cameraPos.y = camera.position.y;
    __ikArgs.cameraPos.z = camera.position.z;
    updateIK(__ikArgs);
    if (ikGizmos) ikGizmos.update();
    if (avatarGizmos) avatarGizmos.update();
    if (climateCtl) climateCtl.update();
    if (adornCtl) adornCtl.update();
    if (worldGuiCtl) worldGuiCtl.update();

    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;


    const worldChangedFrame = !pose || sceneChangedFrame || skinnedPosed || animHighlights.size > 0;
    if (worldChangedFrame) {
      __boxGateQa.runs += 1;

      for (const id of boxes.keys()) refreshBox(id);


      if (store.getViewOption("showBoundingBoxes")) refreshBoundingBoxes(false);
    } else {
      __boxGateQa.skips += 1;
    }












    if ((pose && sceneChangedFrame) || animHighlights.size > 0) lightingCtl.markShadowsDirty();


    if (postfx.isPreparingForDisplay()) {
      requestRender();
      return;
    }
    lightingCtl.beforeRender();


    const __passTiming = typeof lightingCtl.getPassTiming === "function" ? lightingCtl.getPassTiming() : null;


    const __tierScale = typeof lightingCtl.getRenderScale === "function" ? lightingCtl.getRenderScale() : 1;
    if (__tierScale !== tierRenderScale) {
      tierRenderScale = __tierScale;
      if (!tierScalePending) {
        tierScalePending = true;
        const __flushTierScale = () => { tierScalePending = false; resize(); };
        if (typeof queueMicrotask === "function") queueMicrotask(__flushTierScale);
        else setTimeout(__flushTierScale, 0);
      }
    }


    if (typeof lightingCtl.isWarmingUp === "function" && lightingCtl.isWarmingUp()) return;


    const renderMode = store.getViewOption("renderMode") || "default";
    const modeOverride = overrideForMode(renderMode);


    if (!modeOverride) terrainRenderer.renderWaterGrab(renderer, camera);


    if (!modeOverride) {
      const __gEnv =
        typeof lightingCtl.getGlassRefractionEnv === "function"
          ? lightingCtl.getGlassRefractionEnv()
          : null;
      refractionPass.render(renderer, camera, {
        eligible: __gEnv
          ? refractionEligible({
              flag: __gEnv.flag,
              weak: __gEnv.weak,
              tier: __gEnv.tier,
              lightModel: __gEnv.lightModel,


              patchesDisabled: __gEnv.patchesDisabled,
            })
          : false,
        ior: __gEnv ? __gEnv.ior : null,
      });
    }


    if (!modeOverride) {
      const __pEnv =
        typeof lightingCtl.getPlanarReflectionsEnv === "function"
          ? lightingCtl.getPlanarReflectionsEnv()
          : null;
      planarPass.render(renderer, camera, {
        eligible: __pEnv
          ? planarEligible({
              flag: __pEnv.flag,
              weak: __pEnv.weak,
              renderStyle: __pEnv.renderStyle,
            })
          : false,
        waterMesh: terrainRenderer ? terrainRenderer.getWaterMesh && terrainRenderer.getWaterMesh() : null,
      });
    } else {


      planarPass.render(renderer, camera, { eligible: false, waterMesh: null });
    }
    const gridWasVisible = gridGroup.visible;
    if (modeOverride) {
      scene.overrideMaterial = modeOverride;
      gridGroup.visible = false;                                               
    }

    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, w, h);
    renderer.clear();
    if (__passTiming) __passTiming.begin("principal");


    if (mvPass) {
      const _tsrSt40 = lightingCtl.getTsrState ? lightingCtl.getTsrState() : null;
      mvPass.applyState(_tsrSt40);


      mvPass.render(renderer.domElement.width, renderer.domElement.height);
    }
    const __postfxUsed = modeOverride ? postfx.renderLegacy(w, h) : postfx.render(w, h);
    if (!__postfxUsed) renderer.render(scene, camera);
    lightingCtl.afterMegaLightsRender?.(typeof performance !== "undefined" ? performance.now() - __frameStart : 0);
    if (__passTiming) {
      if (__postfxUsed) __passTiming.setFrameFlag("postfx");
      __passTiming.end();
    }

    if (modeOverride) {
      scene.overrideMaterial = null;
      gridGroup.visible = gridWasVisible;
    }
    if (renderMode === "detail") {

      scene.overrideMaterial = detailMaterial();
      gridGroup.visible = false;
      const prevAuto = renderer.autoClear;
      renderer.autoClear = false;
      renderer.render(scene, camera);
      renderer.autoClear = prevAuto;
      scene.overrideMaterial = null;
      gridGroup.visible = gridWasVisible;
    }


    pathfindingCtl.update();
    spatialQueryCtl.update();

    streamingCtl.update();


    gizmos.update();


    if (!gizmos.isVisible || gizmos.isVisible()) {
      renderer.setViewport(0, 0, w, h);
      renderer.clearDepth();
      gizmos.render(renderer);
    }


    if (!capturingThumbnail && settings.get("showAxisIndicator") !== false) {


      const adx = p.x - t.x, ady = p.y - t.y, adz = p.z - t.z;
      const alen = Math.hypot(adx, ady, adz) || 1;
      axisCam.position.set((adx / alen) * 3.2, (ady / alen) * 3.2, (adz / alen) * 3.2);
      axisCam.lookAt(0, 0, 0);
      const s = Math.max(64, Math.min(96, Math.floor(Math.min(w, h) * 0.18)));
      renderer.setScissorTest(true);
      renderer.setViewport(12, 12, s, s);
      renderer.setScissor(12, 12, s, s);
      renderer.clearDepth();
      renderer.render(axisScene, axisCam);
      renderer.setScissorTest(false);
    }

    if (typeof lightingCtl.setLastFrameCost === "function") {
      const frameFinishedAt = typeof performance !== "undefined" ? performance.now() : Date.now();
      lightingCtl.setLastFrameCost(frameFinishedAt - __frameStart);
    }
    perfOnFrameRendered(__frameStart);                                       
    setRenderSample(performance.now() - __frameStart, typeof renderer !== "undefined" && renderer ? renderer.info : null);
    if (__passTiming) __passTiming.frameEnd();                               


    if (playGfxActive && playGfxQuality === 0) {
      const nowT = performance.now();
      if (playAutoPrevT > 0 && playAutoCtl.sample(nowT - playAutoPrevT, nowT)) {
        playGfxPending = true;
        if (typeof queueMicrotask === "function") queueMicrotask(flushPlayGfx);
        else setTimeout(flushPlayGfx, 0);
      }
      playAutoPrevT = nowT;
    } else if (playAutoPrevT !== 0) {
      playAutoPrevT = 0;
    }
    presentedFrameCount += 1;
    bus.emit("viewport:rendered");
  }


  function runViewportFrame() {
    if (store.get("appMode") !== "EDITOR" && !preparingForDisplay) return;


    if (hasActiveSpatialSources()) stepAudioSpatial(performance.now());

    if (!dirty && !playtest.isCameraActive()) return;
    sceneChangedFrame = dirty;
    dirty = false;
    renderFrame();
  }

  function startRenderFrameCallback() {
    if (unregisterRenderFrameCallback) return;
    unregisterRenderFrameCallback = registerFrameCallback(
      "render",
      runViewportFrame,
      "viewport:render",
    );
  }

  function stopRenderFrameCallback() {
    if (!unregisterRenderFrameCallback) return;
    unregisterRenderFrameCallback();
    unregisterRenderFrameCallback = null;
  }


  const stopObservingResolution = observeViewportResolution(host, resize);


  const offSettings = bus.on("settings:changed", (payload) => {
    if (!payload) return;
    if (payload.key === "gridVisible") {
      gridGroup.visible = payload.value !== false;
      requestRender();
    } else if (payload.key === "gridSize") {
      const v = Number(payload.value);
      if (Number.isFinite(v) && v > 0) gridGroup.scale.setScalar(v / 4);
      requestRender();
    } else if (payload.key === "renderQuality") {
      resize();
    } else if (payload.key === "showAxisIndicator") {
      requestRender();
    }
  });
  const initialGridSize = Number(settings.get("gridSize"));
  if (Number.isFinite(initialGridSize) && initialGridSize > 0 && initialGridSize !== 4) {
    gridGroup.scale.setScalar(initialGridSize / 4);
  }


  let capturingThumbnail = false;
  const offThumb = bus.on("viewport:thumbnail", (payload) => {
    if (!payload || typeof payload !== "object") return;
    try {
      capturingThumbnail = true;
      sceneChangedFrame = true;                                              
      renderFrame();
      const src = renderer.domElement;
      const sw = src.width || 1;
      const sh = src.height || 1;


      const optNum = (v, lo, hi, dflt) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt);
      const tw = Math.round(optNum(payload.width, 16, 1920, 256));
      const th = Math.round(optNum(payload.height, 16, 1080, 144));
      const maxBytes = Math.round(optNum(payload.maxBytes, 8 * 1024, 1024 * 1024, 64 * 1024));
      const cv = document.createElement("canvas");
      cv.width = tw;
      cv.height = th;
      const ctx = cv.getContext("2d");
      if (!ctx) return;
      ctx.fillStyle = "#1a1a1e";
      ctx.fillRect(0, 0, tw, th);

      ctx.imageSmoothingEnabled = true;
      try { ctx.imageSmoothingQuality = "high"; } catch (_) {                }
      const scale = Math.max(tw / sw, th / sh);
      const dw = sw * scale;
      const dh = sh * scale;
      ctx.drawImage(src, (tw - dw) / 2, (th - dh) / 2, dw, dh);
      let q = optNum(payload.quality, 0.25, 0.95, 0.7);
      let dataUrl = cv.toDataURL("image/jpeg", q);
      while (dataUrl.length > maxBytes * 1.3 && q > 0.25) {
        q -= 0.15;
        dataUrl = cv.toDataURL("image/jpeg", q);
      }
      if (dataUrl.length <= maxBytes * 1.4) payload.dataUrl = dataUrl;
    } catch (_e) {

    } finally {
      capturingThumbnail = false;
      requestRender();                                             
    }
  });

  const offPose = bus.on("viewport:cameraPose", (payload) => {
    if (!payload || typeof payload !== "object") return;
    const p = rig.getPosition();
    const t = rig.getTarget();
    const len = Math.hypot(t.x - p.x, t.y - p.y, t.z - p.z) || 1;
    payload.position = { x: p.x, y: p.y, z: p.z };
    payload.direction = { x: (t.x - p.x) / len, y: (t.y - p.y) / len, z: (t.z - p.z) / len };
  });

  const offCamReset = bus.on("camera:reset", (p) => {
    const raw = p && p.pose ? p.pose : p;                                           
    const cam = raw && raw.position && raw.direction ? raw : null;
    if (cam && typeof rig.setPose === "function") rig.setPose(cam.position, cam.direction, 64);
    else rig.reset();
    requestRender();
  });


  function selectedRecords() {
    const out = [];
    for (const id of selection.ids()) {
      const r = sync.getRecord(id);
      if (r) out.push(r);
    }
    return out;
  }
  const offCamView = bus.on("camera:view", (p) => {
    const dirs = {
      front: { x: 0, y: 0, z: -1 },
      back: { x: 0, y: 0, z: 1 },
      right: { x: -1, y: 0, z: 0 },
      left: { x: 1, y: 0, z: 0 },
      top: { x: 0, y: -1, z: 0 },
      bottom: { x: 0, y: 1, z: 0 },
    };
    const d = p && dirs[p.view];
    if (!d || typeof rig.setPose !== "function") return;
    const pos = rig.getPosition();
    const t = rig.getTarget();
    const r = Math.hypot(t.x - pos.x, t.y - pos.y, t.z - pos.z) || 64;
    rig.setPose({ x: t.x - d.x * r, y: t.y - d.y * r, z: t.z - d.z * r }, d, r);
    requestRender();
  });


  const offGhost = bus.on("gizmo:ghost", (p) => {
    if (p && p.active && Array.isArray(p.ids)) {
      for (const gid of p.ids) {
        const obj = meshes.get(gid);
        if (!obj) continue;                                                    
        obj.traverse((n) => {
          if (!n.isMesh || !n.material) return;
          const mats = Array.isArray(n.material) ? n.material : [n.material];
          for (const m of mats) {
            if (!m || ghostMats.has(m)) continue;
            ghostMats.set(m, { transparent: m.transparent, opacity: m.opacity, depthWrite: m.depthWrite });
            m.transparent = true;
            m.opacity = Math.min(0.5, Number.isFinite(m.opacity) ? m.opacity : 1);
            m.depthWrite = false;
            m.needsUpdate = true;
          }
        });
      }
    } else {
      ghostRestore();
    }
    requestRender();
  });
  const offCamFocus = bus.on("camera:focusSelection", () => {
    const recs = selectedRecords();
    if (!recs.length) return;
    let cx = 0, cy = 0, cz = 0, n = 0;
    for (const r of recs) {
      const pt = r && r.position;
      if (!pt || !Number.isFinite(pt.x)) continue;
      cx += pt.x; cy += pt.y; cz += pt.z; n += 1;
    }
    if (!n) return;
    rig.focus({ x: cx / n, y: cy / n, z: cz / n });
    requestRender();
  });
  const offCamFrame = bus.on("camera:frameSelection", () => {
    const recs = selectedRecords();
    rig.frame(recs.length ? recs : sync.getRecords(), 1.2);
    requestRender();
  });
  const offCamProj = bus.on("camera:toggleProjection", () => {
    const oldFov = camera.fov;
    const newFov = oldFov > 40 ? 15 : 70;
    const k = Math.tan((oldFov * Math.PI) / 360) / Math.tan((newFov * Math.PI) / 360);
    const pos = rig.getPosition();
    const t = rig.getTarget();
    const dx = pos.x - t.x;
    const dy = pos.y - t.y;
    const dz = pos.z - t.z;
    const r = Math.hypot(dx, dy, dz) || 64;
    const nr = Math.min(8000, Math.max(2, r * k));
    const d = { x: -dx / r, y: -dy / r, z: -dz / r };
    camera.fov = newFov;
    camera.updateProjectionMatrix();
    if (typeof rig.setPose === "function") {
      rig.setPose({ x: t.x - d.x * nr, y: t.y - d.y * nr, z: t.z - d.z * nr }, d, nr);
    }
    requestRender();
  });

  function start() {
    resize();
    rig.frame(sync.getRecords());                                            
    requestRender();
    startRenderFrameCallback();
  }

  function dispose() {
    clearProjection(projector);                                         
    stopRenderFrameCallback();
    stopObservingResolution();
    if (typeof offSettings === "function") offSettings();

    if (typeof offThumb === "function") offThumb();
    if (typeof offPose === "function") offPose();
    if (typeof offCamReset === "function") offCamReset();
    if (typeof offCamView === "function") offCamView();
    if (typeof offCamFocus === "function") offCamFocus();
    if (typeof offGhost === "function") offGhost();
    ghostRestore();                                                          
    if (typeof offCamFrame === "function") offCamFrame();
    if (typeof offCamProj === "function") offCamProj();
    disposeSkinning();            
    for (const off of offBoneEvict) {
      try {
        off();
      } catch (_) {

      }
    }             
    if (boneGizmos) boneGizmos.dispose();            
    if (ikGizmos) ikGizmos.dispose();            
    if (avatarGizmos) avatarGizmos.dispose();            
    if (climateCtl) climateCtl.dispose();            
    clearIKState();            

    if (typeof offViewOpts === "function") offViewOpts();
    if (stopPerfTextInterval) stopPerfTextInterval();
    if (perfEl && perfEl.remove) perfEl.remove();
    host.removeEventListener("pointermove", onHoverMove);
    host.removeEventListener("pointerleave", onHoverLeave);
    if (typeof offTagHi === "function") offTagHi();
    if (typeof offTagClear === "function") offTagClear();
    clearTagHighlight();
    if (hoverHelper) {
      scene.remove(hoverHelper);
      disposeObject(hoverHelper);
      hoverHelper = null;
    }
    for (const b of bboxes.values()) {
      scene.remove(b);
      disposeObject(b);
    }
    bboxes.clear();
    for (const m of [_wireMat, _normalsMat, _depthMat, _detailMat]) {
      if (m && m.dispose) m.dispose();
    }
    if (gizmos && typeof gizmos.dispose === "function") gizmos.dispose();
    if (viewportSelection && typeof viewportSelection.dispose === "function") viewportSelection.dispose();
    if (terrainController && typeof terrainController.dispose === "function") terrainController.dispose();
    if (regionController && typeof regionController.dispose === "function") regionController.dispose();
    if (terrainRenderer && typeof terrainRenderer.dispose === "function") terrainRenderer.dispose();

    if (refractionPass && typeof refractionPass.dispose === "function") refractionPass.dispose();

    if (planarPass && typeof planarPass.dispose === "function") planarPass.dispose();

    if (typeof window !== "undefined" && window.__rswPlanarQa) {
      try { delete window.__rswPlanarQa; } catch (_) { window.__rswPlanarQa = null; }
    }
    if (typeof window !== "undefined" && window.__rswCinematicPostQa) {
      try { delete window.__rswCinematicPostQa; } catch (_) { window.__rswCinematicPostQa = null; }
    }
    if (effectsCtl && typeof effectsCtl.dispose === "function") effectsCtl.dispose();
    if (adornCtl && typeof adornCtl.dispose === "function") adornCtl.dispose();
    if (worldGuiCtl && typeof worldGuiCtl.dispose === "function") worldGuiCtl.dispose();
    if (pathfindingCtl && typeof pathfindingCtl.dispose === "function") pathfindingCtl.dispose();
    if (spatialQueryCtl && typeof spatialQueryCtl.dispose === "function") spatialQueryCtl.dispose();
    if (audioCtl && typeof audioCtl.dispose === "function") audioCtl.dispose();
    if (postfx && typeof postfx.dispose === "function") postfx.dispose();

    if (mvPass && typeof mvPass.dispose === "function") mvPass.dispose();
    if (lightingCtl && typeof lightingCtl.dispose === "function") lightingCtl.dispose();
    instanced.dispose();
    decalCarriers.dispose();            
    complexInst.dispose();            
    for (const obj of meshes.values()) disposeObject(obj);
    for (const box of boxes.values()) disposeObject(box);
    meshes.clear();
    boxes.clear();
    for (const g of sharedGeos) g.dispose();
    renderer.dispose();
    if (renderer.domElement && renderer.domElement.remove) renderer.domElement.remove();
  }


  function isEngineWarmingUp() {
    if (!lightingCtl || typeof lightingCtl.isWarmingUp !== "function") return false;
    return lightingCtl.isWarmingUp() === true;
  }

  async function prepareForDisplay(options = {}) {
    presentationError = null;
    preparingForDisplay = true;
    try {
      await waitForViewportPresentation({
        requestRender,
        readFrameCount: () => presentedFrameCount,
        readPreparationError: () => presentationError || lightingCtl.getPreparationError?.(),
        readPreparationProgress: () => viewportPreparationProgress({
          lighting: lightingCtl.getPreparationState?.(),
          terrainPending: terrainRenderer.isPreparing?.() === true,
          postProcessingPending: postfx.isPreparingForDisplay(),
        }),
        isPreparing: () => lightingCtl.isPreparingForDisplay?.() === true ||
          terrainRenderer.isPreparing?.() === true || postfx.isPreparingForDisplay(),
        isUnavailable: () => renderer.getContext().isContextLost(),
        ...options,
      });
      markViewportStageLive();
    } catch (error) {
      presentationError = error;
      throw error;
    } finally {
      preparingForDisplay = false;
    }
  }

  reportProgress(1);
  return { sink, requestRender, start, dispose, scene, camera, isEngineWarmingUp, prepareForDisplay };
}


function makeWedgeGeometry(THREE) {
  const g = new THREE.BufferGeometry();
  const positions = new Float32Array([
    -0.5, -0.5, -0.5,
    -0.5, -0.5, 0.5,
    -0.5, 0.5, -0.5,
    0.5, -0.5, -0.5,
    0.5, -0.5, 0.5,
    0.5, 0.5, -0.5,
  ]);
  const index = [
    0, 2, 1,
    3, 4, 5,
    0, 1, 4, 0, 4, 3,
    0, 5, 2, 0, 3, 5,
    1, 2, 5, 1, 5, 4,
  ];
  g.setAttribute("position", new THREE.BufferAttribute(positions, 3));
  g.setIndex(index);
  g.computeVertexNormals();
  return g;
}

function setGridOpacity(grid, opacity) {
  if (grid && grid.material) {
    grid.material.transparent = true;
    grid.material.opacity = opacity;
  }
}

function centroid(records) {
  let x = 0, y = 0, z = 0, n = 0;
  for (const r of records) {
    if (!r || !r.position) continue;
    x += r.position.x;
    y += r.position.y;
    z += r.position.z;
    n += 1;
  }
  if (!n) return { x: 0, y: 0, z: 0 };
  return { x: x / n, y: y / n, z: z / n };
}

function normalize(x, y, z) {
  const len = Math.hypot(x, y, z) || 1;
  return { x: x / len, y: y / len, z: z / len };
}
