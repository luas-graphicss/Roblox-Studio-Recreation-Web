import * as THREE from "three";
import { createWorldGuiMaterial } from "./worldGuiMaterialFactory.js";
import { bus } from "../core/eventBus.js";
import { store } from "../core/state.js";
import { Events } from "../datamodel/index.js";
import { engine } from "../runtime/engine.js";
import {
  MAX_GUIS,
  MAX_CANVAS,
  num,
  applyCameraOffset,
  viewDepth,
  propAffectsDraw,
  createHeatTracker,
  drawGuiTree,
  hitTestButtons,
  pickScrollTarget,
  isButton,
  stateSwapsImage,
  allowedImageSrc,
  billboardWorldSize,
  billboardTopLift,
  billboardCanvasSize,
  shouldShowBillboard,
  lightBrightness,
  needsBillboardRedraw,
} from "./worldGuiCore.js";


import { guiFontFor, fontShorthandFor } from "../runtime/guiMetrics.js";

const rasterFontFor = (inst, ts) => fontShorthandFor(guiFontFor(inst), ts);

const FACE_INFO = {
  Front: { n: [0, 0, -1], u: [-1, 0, 0], v: [0, 1, 0], dims: ["x", "y"] },
  Back: { n: [0, 0, 1], u: [1, 0, 0], v: [0, 1, 0], dims: ["x", "y"] },
  Right: { n: [1, 0, 0], u: [0, 0, -1], v: [0, 1, 0], dims: ["z", "y"] },
  Left: { n: [-1, 0, 0], u: [0, 0, 1], v: [0, 1, 0], dims: ["z", "y"] },
  Top: { n: [0, 1, 0], u: [1, 0, 0], v: [0, 0, -1], dims: ["x", "z"] },
  Bottom: { n: [0, -1, 0], u: [1, 0, 0], v: [0, 0, 1], dims: ["x", "z"] },
};

function isInst(x) {
  return !!(x && typeof x.isDestroyed === "function" && !x.isDestroyed());
}

function isBasePart(inst) {
  return !!(inst && inst.hasProperty && inst.hasProperty("Size") && inst.hasProperty("Anchored"));
}

function fireButton(inst) {
  bus.emit("gameplay:event", { instance: inst, type: "MouseButton1Click", args: [] });
  bus.emit("gameplay:event", { instance: inst, type: "Activated", args: [] });
}


let focusedBox = null;
function setFocusedBox(inst) {
  if (focusedBox === inst) return;
  if (focusedBox && typeof focusedBox.isDestroyed === "function" && !focusedBox.isDestroyed()) {
    bus.emit("gameplay:event", { instance: focusedBox, type: "FocusLost", args: [false] });
  }
  focusedBox = inst || null;
  if (focusedBox) {
    bus.emit("gameplay:event", { instance: focusedBox, type: "Focused", args: [] });
  }
}

export function initWorldGuiRenderer({ scene, camera, renderer, requestRender, meshFor }) {
  const surfaceGroup = new THREE.Group();
  surfaceGroup.name = "WorldGuiGroup";
  scene.add(surfaceGroup);
  const billboardGroup = new THREE.Group();
  billboardGroup.name = "BillboardGuiGroup";
  scene.add(billboardGroup);


  const quadGeo = new THREE.PlaneGeometry(1, 1);

  const billboards = new Map();
  const surfaces = new Map();
  const subs = [];
  const scratch = new THREE.Vector3();
  const vRight = new THREE.Vector3();
  const vUp = new THREE.Vector3();
  const vBack = new THREE.Vector3();
  const offOut = { x: 0, y: 0, z: 0 };
  let structureDirty = true;
  let disposed = false;


  const nowMs = () => (typeof performance !== "undefined" && performance.now ? performance.now() : Date.now());
  const heat = createHeatTracker({});


  const MAX_IMG_CACHE = 64;                                                  
  const imgCache = new Map();                      
  function markAllContent() {
    for (const ctl of billboards.values()) ctl.markContent();
    for (const ctl of surfaces.values()) ctl.markContent();
    if (requestRender) requestRender();
  }
  function getImage(src) {
    if (!allowedImageSrc(src)) return null;
    let e = imgCache.get(src);
    if (e) return e.ok ? e.img : null;
    if (typeof Image === "undefined") return null;                        
    if (imgCache.size >= MAX_IMG_CACHE) imgCache.clear();                              
    e = { img: null, ok: false };
    imgCache.set(src, e);
    const img = new Image();


    img.crossOrigin = "anonymous";
    img.onload = () => {
      e.img = img;
      e.ok = true;
      if (!disposed) markAllContent();
    };
    img.onerror = () => {
      e.ok = false;                                              
    };
    img.src = src;
    return null;
  }


  const pointer = { hoverInst: null, hoverCtl: null, pressedInst: null, pressedCtl: null, lastMoveMs: 0 };
  function buttonStateFor(inst) {
    return { hover: pointer.hoverInst === inst, pressed: pointer.pressedInst === inst };
  }
  function setPointerState(hoverInst, hoverCtl, pressedInst, pressedCtl) {
    const dirty = new Set();
    if (pointer.hoverInst !== hoverInst) {
      if (pointer.hoverInst && pointer.hoverCtl && stateSwapsImage(pointer.hoverInst)) dirty.add(pointer.hoverCtl);
      if (hoverInst && hoverCtl && stateSwapsImage(hoverInst)) dirty.add(hoverCtl);
    }
    if (pointer.pressedInst !== pressedInst) {
      if (pointer.pressedInst && pointer.pressedCtl && stateSwapsImage(pointer.pressedInst)) dirty.add(pointer.pressedCtl);
      if (pressedInst && pressedCtl && stateSwapsImage(pressedInst)) dirty.add(pressedCtl);
    }
    pointer.hoverInst = hoverInst || null;
    pointer.hoverCtl = hoverInst ? hoverCtl || null : null;
    pointer.pressedInst = pressedInst || null;
    pointer.pressedCtl = pressedInst ? pressedCtl || null : null;
    if (dirty.size) {
      for (const ctl of dirty) ctl.markContent();
      if (requestRender) requestRender();
    }
  }


  function resolveAnchor(gui) {
    const ad = gui.hasProperty("Adornee") ? gui.getProperty("Adornee") : null;
    const node = isInst(ad) ? ad : gui.getParent && gui.getParent();
    if (!isInst(node)) return null;
    let part = null;
    let attach = null;
    if (isBasePart(node)) {
      part = node;
    } else if (node.className === "Attachment") {
      const pp = node.getParent && node.getParent();
      if (isInst(pp) && isBasePart(pp)) {
        part = pp;
        const ap = node.getProperty("Position");
        attach = ap && Number.isFinite(ap.x) ? ap : { x: 0, y: 0, z: 0 };
      }
    }
    return part ? { part, attach } : null;
  }

  function anchorWorldPos(gui) {
    const anchor = resolveAnchor(gui);
    if (!anchor) return null;
    const pos = anchor.part.getProperty("Position") || { x: 0, y: 0, z: 0 };
    const at = anchor.attach || { x: 0, y: 0, z: 0 };
    const sw = gui.getProperty("StudsOffsetWorldSpace") || { x: 0, y: 0, z: 0 };
    return {
      x: pos.x + at.x + num(sw.x),
      y: pos.y + at.y + num(sw.y),
      z: pos.z + at.z + num(sw.z),
      part: anchor.part,
      onAttachment: !!anchor.attach,
    };
  }

  function viewportHeightPx() {
    const dom = renderer && renderer.domElement;
    if (!dom) return 600;
    const css = num(dom.clientHeight, 0);
    if (css > 0) return css;
    const pr = typeof renderer.getPixelRatio === "function" ? num(renderer.getPixelRatio(), 1) || 1 : 1;
    const buf = num(dom.height, 0);
    return buf > 0 ? buf / pr : 600;
  }


  function makeBillboard(gui) {
    const canvas = document.createElement("canvas");
    const texture = new THREE.CanvasTexture(canvas);
    const mat = createWorldGuiMaterial(texture);
    const mesh = new THREE.Mesh(quadGeo, mat);
    mesh.userData.billboardGuiId = gui.id;
    billboardGroup.add(mesh);
    const buttons = [];                   
    const dynButtons = [];                                       
    const scrollFrames = [];                                                   
    const dynScrollFrames = [];                                    
    const staticCanvas = document.createElement("canvas");
    let contentDirty = true;
    let dynamicDirty = false;
    let hotDeadline = 0;
    let last = null;
    let onTopState = null;
    let layoutW = 1;
    let layoutH = 1;


    const staticHotIds = new Set();

    function isHot(inst) {
      return heat.isHot(inst.id, nowMs());
    }


    function isHotForStatic(inst) {
      const h = isHot(inst);
      if (h && inst.id != null) staticHotIds.add(inst.id);
      return h;
    }

    function redrawStatic(cw, ch, pw, ph) {
      if (staticCanvas.width !== cw) staticCanvas.width = cw;
      if (staticCanvas.height !== ch) staticCanvas.height = ch;
      const ctx = staticCanvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      ctx.setTransform(cw / pw, 0, 0, ch / ph, 0, 0);
      buttons.length = 0;
      scrollFrames.length = 0;
      staticHotIds.clear();
      drawGuiTree(ctx, gui, pw, ph, buttons, { fontFor: rasterFontFor, textScale: 1, minText: 6, layer: "static", isHot: isHotForStatic, collectTextBoxes: true, getImage, buttonState: buttonStateFor, scrollFrames });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
    }

    function compose(cw, ch, pw, ph) {
      if (canvas.width !== cw) canvas.width = cw;
      if (canvas.height !== ch) canvas.height = ch;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      ctx.drawImage(staticCanvas, 0, 0);
      ctx.setTransform(cw / pw, 0, 0, ch / ph, 0, 0);
      dynButtons.length = 0;
      dynScrollFrames.length = 0;
      drawGuiTree(ctx, gui, pw, ph, dynButtons, { fontFor: rasterFontFor, textScale: 1, minText: 6, layer: "dynamic", isHot, collectTextBoxes: true, getImage, buttonState: buttonStateFor, scrollFrames: dynScrollFrames });
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      texture.needsUpdate = true;
      if (requestRender) requestRender();
    }

    function update() {
      if (gui.isDestroyed()) {
        mesh.visible = false;
        structureDirty = true;
        return;
      }
      const enabled = !gui.hasProperty("Enabled") || gui.getProperty("Enabled") !== false;
      const base = enabled ? anchorWorldPos(gui) : null;
      if (!base) {
        mesh.visible = false;
        return;
      }
      vRight.set(1, 0, 0).applyQuaternion(camera.quaternion);
      vUp.set(0, 1, 0).applyQuaternion(camera.quaternion);
      vBack.set(0, 0, 1).applyQuaternion(camera.quaternion);
      const so = gui.getProperty("StudsOffset") || { x: 0, y: 0, z: 0 };
      const pos = applyCameraOffset(base, so, vRight, vUp, vBack, offOut);
      scratch.set(pos.x, pos.y, pos.z);
      const depth = -viewDepth(scratch, camera.position, vBack);
      if (depth < 0.05) {
        mesh.visible = false;
        return;
      }
      const dist = scratch.distanceTo(camera.position);
      const show = shouldShowBillboard({
        enabled,
        hasAnchor: true,
        dist,
        maxDistance: gui.hasProperty("MaxDistance") ? gui.getProperty("MaxDistance") : 0,
      });
      if (!show) {
        mesh.visible = false;
        return;
      }
      const size = gui.getProperty("Size") || { xScale: 0, xOffset: 200, yScale: 0, yOffset: 100 };
      const fixed = gui.hasProperty("FixedWorldSize") && gui.getProperty("FixedWorldSize") === true;
      const dims = billboardWorldSize(size, depth, camera.fov, viewportHeightPx(), fixed);


      if (!base.onAttachment && base.part) {
        const ps = base.part.getProperty("Size") || { x: 0, y: 0, z: 0 };
        scratch.y += billboardTopLift(ps.y, dims.h);
      }
      mesh.position.copy(scratch);
      mesh.quaternion.copy(camera.quaternion);
      mesh.scale.set(dims.w, dims.h, 1);
      mesh.visible = true;
      const onTop = gui.hasProperty("AlwaysOnTop") && gui.getProperty("AlwaysOnTop") === true;
      if (onTop !== onTopState) {
        onTopState = onTop;
        mat.depthTest = !onTop;
        mat.fog = !onTop;
        mat.needsUpdate = true;
        mesh.renderOrder = onTop ? 950 : 10;
      }
      const userBright = Math.max(0, Math.min(1, num(gui.hasProperty("Brightness") ? gui.getProperty("Brightness") : 1, 1)));
      const bright = userBright * lightBrightness(gui.hasProperty("LightInfluence") ? gui.getProperty("LightInfluence") : 0);
      if (Math.abs(mat.color.r - bright) > 0.001) mat.color.setScalar(bright);
      const dpr = typeof renderer.getPixelRatio === "function" ? renderer.getPixelRatio() : 1;
      const res = billboardCanvasSize(dims.w, dims.h, dims.spp, dpr);
      const next = { key: "", cw: res.cw, ch: res.ch, pw: res.pw, ph: res.ph };
      const tNow = nowMs();
      if (hotDeadline && tNow >= hotDeadline) {

        hotDeadline = 0;
        contentDirty = true;
      }
      if (!contentDirty && staticHotIds.size) {


        for (const id of staticHotIds) {
          if (!heat.isHot(id, tNow)) {
            contentDirty = true;
            break;
          }
        }
      }
      if (contentDirty || needsBillboardRedraw(last, next)) {
        last = next;
        layoutW = res.pw;
        layoutH = res.ph;
        contentDirty = false;
        dynamicDirty = false;
        redrawStatic(res.cw, res.ch, res.pw, res.ph);
        compose(res.cw, res.ch, res.pw, res.ph);
      } else if (dynamicDirty) {
        dynamicDirty = false;
        compose(last.cw, last.ch, last.pw, last.ph);
      }
    }


    function targetAt(uv) {
      const cx = uv.x * layoutW;
      const cy = (1 - uv.y) * layoutH;
      return hitTestButtons(dynButtons, cx, cy, isInst) || hitTestButtons(buttons, cx, cy, isInst);
    }

    function click(uv) {
      if (!engine.running) return;
      const target = targetAt(uv);


      if (target && target.className === "TextBox") {
        if (!target.hasProperty("TextEditable") || target.getProperty("TextEditable") !== false) setFocusedBox(target);
        return;
      }
      setFocusedBox(null);
      if (target) fireButton(target);
    }


    function scrollAt(uv, deltaX, deltaY, wheelRemap, scale) {
      if (!engine.running) return false;
      const cx = uv.x * layoutW;
      const cy = (1 - uv.y) * layoutH;
      const hit = pickScrollTarget(scrollFrames.concat(dynScrollFrames), cx, cy, deltaX, deltaY, isInst, wheelRemap, scale);
      if (!hit) return false;
      hit.inst.setProperty("CanvasPosition", { x: hit.next.x, y: hit.next.y });
      return true;
    }

    return {
      update,
      click,
      targetAt,
      scrollAt,
      layoutSize: () => ({ w: layoutW, h: layoutH }),
      mesh,
      markContent: () => { contentDirty = true; },
      markDynamic: () => { dynamicDirty = true; },
      noteHot: (until) => { if (until > hotDeadline) hotDeadline = until; },
      dispose: () => {
        billboardGroup.remove(mesh);
        mat.dispose();
        texture.dispose();
      },
    };
  }


  function makeSurface(gui) {
    const canvas = document.createElement("canvas");
    const texture = new THREE.CanvasTexture(canvas);


    const mat = createWorldGuiMaterial(texture);
    const mesh = new THREE.Mesh(quadGeo, mat);
    mesh.userData.surfaceGuiId = gui.id;
    surfaceGroup.add(mesh);
    const buttons = [];                   
    const dynButtons = [];                                       
    const scrollFrames = [];                                                   
    const dynScrollFrames = [];                                    
    const staticCanvas = document.createElement("canvas");
    let contentDirty = true;
    let dynamicDirty = false;
    let hotDeadline = 0;
    let lastW = 0;
    let lastH = 0;

    const staticHotIds = new Set();

    function isHot(inst) {
      return heat.isHot(inst.id, nowMs());
    }


    function isHotForStatic(inst) {
      const h = isHot(inst);
      if (h && inst.id != null) staticHotIds.add(inst.id);
      return h;
    }


    function redrawStatic(cw, ch) {
      if (staticCanvas.width !== cw) staticCanvas.width = cw;
      if (staticCanvas.height !== ch) staticCanvas.height = ch;
      const ctx = staticCanvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      buttons.length = 0;
      scrollFrames.length = 0;
      staticHotIds.clear();
      drawGuiTree(ctx, gui, cw, ch, buttons, { fontFor: rasterFontFor, textScale: cw / 400, minText: 8, layer: "static", isHot: isHotForStatic, collectTextBoxes: true, getImage, buttonState: buttonStateFor, scrollFrames });
    }

    function compose(cw, ch) {
      if (canvas.width !== cw) canvas.width = cw;
      if (canvas.height !== ch) canvas.height = ch;
      const ctx = canvas.getContext("2d");
      if (!ctx) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, cw, ch);
      ctx.drawImage(staticCanvas, 0, 0);
      dynButtons.length = 0;
      dynScrollFrames.length = 0;
      drawGuiTree(ctx, gui, cw, ch, dynButtons, { fontFor: rasterFontFor, textScale: cw / 400, minText: 8, layer: "dynamic", isHot, collectTextBoxes: true, getImage, buttonState: buttonStateFor, scrollFrames: dynScrollFrames });
      texture.needsUpdate = true;
      if (requestRender) requestRender();
    }

    function update() {
      if (gui.isDestroyed()) {
        mesh.visible = false;
        structureDirty = true;
        return;
      }
      const ad = gui.hasProperty("Adornee") ? gui.getProperty("Adornee") : null;
      const parent = isInst(ad) && isBasePart(ad) ? ad : gui.getParent && gui.getParent();
      const enabled = !gui.hasProperty("Enabled") || gui.getProperty("Enabled") !== false;
      if (!enabled || !isInst(parent) || !isBasePart(parent)) {
        mesh.visible = false;
        return;
      }
      const src = meshFor ? meshFor(parent.id) : null;
      if (!src) {
        mesh.visible = false;
        return;
      }
      const face = FACE_INFO[String(gui.getProperty("Face") || "Front")] || FACE_INFO.Front;
      const size = parent.getProperty("Size") || { x: 1, y: 1, z: 1 };
      const fw = Math.max(0.05, Math.abs(size[face.dims[0]]));
      const fh = Math.max(0.05, Math.abs(size[face.dims[1]]));
      src.updateWorldMatrix(true, false);
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scl = new THREE.Vector3();
      src.matrixWorld.decompose(pos, quat, scl);
      const n = new THREE.Vector3(...face.n);
      const half = Math.abs(n.x) * Math.abs(size.x) / 2 + Math.abs(n.y) * Math.abs(size.y) / 2 + Math.abs(n.z) * Math.abs(size.z) / 2;
      const nWorld = n.clone().applyQuaternion(quat);
      mesh.position.copy(pos).add(nWorld.multiplyScalar(half + 0.02));
      const m = new THREE.Matrix4().makeBasis(
        new THREE.Vector3(...face.u),
        new THREE.Vector3(...face.v),
        new THREE.Vector3(...face.n),
      );
      mesh.quaternion.copy(quat).multiply(new THREE.Quaternion().setFromRotationMatrix(m));
      mesh.scale.set(fw, fh, 1);
      mesh.visible = true;
      const onTop = gui.hasProperty("AlwaysOnTop") && gui.getProperty("AlwaysOnTop") === true;
      mat.depthTest = !onTop;
      mesh.renderOrder = onTop ? 940 : 0;
      const sBright = Math.max(0, Math.min(1, num(gui.hasProperty("Brightness") ? gui.getProperty("Brightness") : 1, 1))) *
        lightBrightness(gui.hasProperty("LightInfluence") ? gui.getProperty("LightInfluence") : 0);
      if (Math.abs(mat.color.r - sBright) > 0.001) mat.color.setScalar(sBright);
      const canvasSize = gui.getProperty("CanvasSize") || { x: 800, y: 600 };
      const pps = num(gui.getProperty("PixelsPerStud"), 50);


      const sizing = String(gui.hasProperty("SizingMode") ? gui.getProperty("SizingMode") : "FixedSize");
      let cw = Math.round(num(canvasSize.x, 800));
      let ch = Math.round(num(canvasSize.y, 600));
      if (sizing === "PixelsPerStud" || cw <= 0 || ch <= 0) {
        cw = Math.round(fw * pps);
        ch = Math.round(fh * pps);
      }
      cw = Math.min(MAX_CANVAS, Math.max(16, cw));
      ch = Math.min(MAX_CANVAS, Math.max(16, ch));
      const tNow = nowMs();
      if (hotDeadline && tNow >= hotDeadline) {
        hotDeadline = 0;
        contentDirty = true;
      }
      if (!contentDirty && staticHotIds.size) {
        for (const id of staticHotIds) {
          if (!heat.isHot(id, tNow)) {
            contentDirty = true;
            break;
          }
        }
      }
      if (contentDirty || cw !== lastW || ch !== lastH) {
        lastW = cw;
        lastH = ch;
        contentDirty = false;
        dynamicDirty = false;
        redrawStatic(cw, ch);
        compose(cw, ch);
      } else if (dynamicDirty) {
        dynamicDirty = false;
        compose(cw, ch);
      }
    }


    function targetAt(uv) {
      const cx = uv.x * canvas.width;
      const cy = (1 - uv.y) * canvas.height;
      return hitTestButtons(dynButtons, cx, cy, isInst) || hitTestButtons(buttons, cx, cy, isInst);
    }

    function click(uv) {
      if (!engine.running) return;
      const target = targetAt(uv);


      if (target && target.className === "TextBox") {
        if (!target.hasProperty("TextEditable") || target.getProperty("TextEditable") !== false) setFocusedBox(target);
        return;
      }
      setFocusedBox(null);
      if (target) fireButton(target);
    }


    function scrollAt(uv, deltaX, deltaY, wheelRemap, scale) {
      if (!engine.running) return false;
      const cx = uv.x * canvas.width;
      const cy = (1 - uv.y) * canvas.height;
      const hit = pickScrollTarget(scrollFrames.concat(dynScrollFrames), cx, cy, deltaX, deltaY, isInst, wheelRemap, scale);
      if (!hit) return false;
      hit.inst.setProperty("CanvasPosition", { x: hit.next.x, y: hit.next.y });
      return true;
    }

    return {
      update,
      click,
      targetAt,
      scrollAt,
      layoutSize: () => ({ w: canvas.width, h: canvas.height }),
      mesh,
      markContent: () => { contentDirty = true; },
      markDynamic: () => { dynamicDirty = true; },
      noteHot: (until) => { if (until > hotDeadline) hotDeadline = until; },
      dispose: () => {
        surfaceGroup.remove(mesh);
        mat.dispose();
        texture.dispose();
      },
    };
  }

  function collect(className) {
    const dm = store.getDataModel();
    const out = [];
    if (!dm) return out;
    const visit = (i) => {
      if (out.length >= MAX_GUIS) return;
      if (i.className === className && !i.isDestroyed()) out.push(i);
      for (const c of i.getChildren()) visit(c);
    };
    visit(dm);
    return out;
  }

  function syncStructure() {
    structureDirty = false;
    const sync = (map, className, factory) => {
      const found = collect(className);
      const alive = new Set();
      for (const inst of found) {
        alive.add(inst.id);
        if (!map.has(inst.id)) map.set(inst.id, factory(inst));
      }
      for (const [id, ctl] of [...map]) {
        if (!alive.has(id)) {
          ctl.dispose();
          map.delete(id);
        }
      }
    };
    sync(billboards, "BillboardGui", makeBillboard);
    sync(surfaces, "SurfaceGui", makeSurface);
  }

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();


  function pickWorldGuiTarget(e) {
    const el = renderer && renderer.domElement;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const meshes = [];
    for (const s of surfaces.values()) {
      if (s.mesh.visible) meshes.push(s.mesh);
    }
    for (const b of billboards.values()) {
      if (b.mesh.visible) meshes.push(b.mesh);
    }
    if (!meshes.length) return null;
    const hits = raycaster.intersectObjects(meshes, false);
    if (!hits.length || !hits[0].uv) return null;
    const hit = hits[0];
    const ctl = surfaces.get(hit.object.userData.surfaceGuiId) || billboards.get(hit.object.userData.billboardGuiId);


    return ctl ? { ctl, uv: hit.uv, mesh: hit.object, point: hit.point } : null;
  }

  function onPointerDown(e) {
    if (disposed || e.button !== 0 || !engine.running) return;
    if (!surfaces.size && !billboards.size) return;
    const picked = pickWorldGuiTarget(e);

    if (!picked) {
      setFocusedBox(null);
      setPointerState(null, null, null, null);
      return;
    }


    const target = picked.ctl.targetAt(picked.uv);
    const btn = target && isButton(target) ? target : null;
    setPointerState(btn, btn ? picked.ctl : null, btn, btn ? picked.ctl : null);
    picked.ctl.click(picked.uv);
  }


  function onPointerMove(e) {
    if (disposed || !engine.running) return;
    if (!surfaces.size && !billboards.size) return;
    const t = nowMs();
    if (t - pointer.lastMoveMs < 16) return;
    pointer.lastMoveMs = t;
    const picked = pickWorldGuiTarget(e);
    const target = picked ? picked.ctl.targetAt(picked.uv) : null;
    const btn = target && isButton(target) ? target : null;
    setPointerState(btn, btn ? picked.ctl : null, pointer.pressedInst, pointer.pressedCtl);
  }

  function onPointerUp(e) {
    if (disposed || e.button !== 0) return;
    if (pointer.pressedInst) setPointerState(pointer.hoverInst, pointer.hoverCtl, null, null);
  }

  function onPointerLeave() {
    if (disposed) return;
    setPointerState(null, null, null, null);
  }

  const dom = renderer && renderer.domElement;
  if (dom && typeof dom.addEventListener === "function") {
    dom.addEventListener("pointerdown", onPointerDown);

    dom.addEventListener("pointermove", onPointerMove);
    dom.addEventListener("pointerup", onPointerUp);
    dom.addEventListener("pointerleave", onPointerLeave);
  }


  const WHEEL_LINE_PX = 32;                              
  const WHEEL_PAGE_PX = 120;                               
  const WHEEL_SCALE_MIN = 1 / 64;                                     
  const WHEEL_SCALE_MAX = 64;                                     
  const WHEEL_EPS = 0.01;                                         
  const wheelAxis = new THREE.Vector3();
  const wheelP0 = new THREE.Vector3();
  const wheelP1 = new THREE.Vector3();
  function wheelAxisScale(mesh, point, rectW, rectH, axisCol, layoutPx) {
    wheelP0.copy(point).project(camera);
    wheelAxis.setFromMatrixColumn(mesh.matrixWorld, axisCol);
    wheelP1.copy(point).addScaledVector(wheelAxis, WHEEL_EPS).project(camera);
    const screenPx = Math.hypot((wheelP1.x - wheelP0.x) * rectW * 0.5, (wheelP1.y - wheelP0.y) * rectH * 0.5);
    const canvasPerScreen = (WHEEL_EPS * Math.max(1, layoutPx)) / screenPx;
    if (!Number.isFinite(canvasPerScreen) || canvasPerScreen <= 0) return 1;
    return Math.min(WHEEL_SCALE_MAX, Math.max(WHEEL_SCALE_MIN, canvasPerScreen));
  }
  function onWheel(e) {
    if (disposed || !engine.running) return;
    if (!surfaces.size && !billboards.size) return;
    const k = e.deltaMode === 1 ? WHEEL_LINE_PX : e.deltaMode === 2 ? WHEEL_PAGE_PX : 1;
    const dX = (Number(e.deltaX) || 0) * k;
    const dY = (Number(e.deltaY) || 0) * k;
    if (!dX && !dY) return;
    const picked = pickWorldGuiTarget(e);
    if (!picked) return;
    let scale = null;
    const el = renderer && renderer.domElement;
    const rect = el && typeof el.getBoundingClientRect === "function" ? el.getBoundingClientRect() : null;
    if (rect && rect.width && rect.height && picked.mesh && picked.point) {
      const dims = picked.ctl.layoutSize();
      scale = {
        x: wheelAxisScale(picked.mesh, picked.point, rect.width, rect.height, 0, dims.w),
        y: wheelAxisScale(picked.mesh, picked.point, rect.width, rect.height, 1, dims.h),
      };
    }
    if (picked.ctl.scrollAt(picked.uv, dX, dY, true, scale)) {
      e.preventDefault();
      e.stopImmediatePropagation();
    }
  }


  let gesture = null;
  function onGestureStart(e) {
    if (disposed || !engine.running) return;
    if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
    if (!surfaces.size && !billboards.size) return;
    const picked = pickWorldGuiTarget(e);
    if (picked) gesture = { ctl: picked.ctl, uv: { x: picked.uv.x, y: picked.uv.y } };
  }
  function onGestureMove(e) {
    if (!gesture || disposed) return;
    if (!engine.running) {
      gesture = null;
      return;
    }
    if (e.pointerType !== "touch" && e.pointerType !== "pen") return;
    const picked = pickWorldGuiTarget(e);
    if (!picked || picked.ctl !== gesture.ctl) return;
    const from = gesture.uv;
    const to = { x: picked.uv.x, y: picked.uv.y };
    const dims = gesture.ctl.layoutSize();
    const dX = (from.x - to.x) * dims.w;
    const dY = (to.y - from.y) * dims.h;                                        
    gesture.uv = to;
    if (dX || dY) gesture.ctl.scrollAt(from, dX, dY, false);
  }
  function onGestureEnd() {
    gesture = null;
  }
  const win = typeof window !== "undefined" ? window : null;
  if (win && typeof win.addEventListener === "function") {

    win.addEventListener("wheel", onWheel, { capture: true, passive: false });
    win.addEventListener("pointerup", onGestureEnd, true);
    win.addEventListener("pointercancel", onGestureEnd, true);
  }
  if (dom && typeof dom.addEventListener === "function") {
    dom.addEventListener("pointerdown", onGestureStart);
    dom.addEventListener("pointermove", onGestureMove);
  }

  const isWorldGui = (inst) => !!inst && (inst.className === "BillboardGui" || inst.className === "SurfaceGui");
  const guiRootOf = (inst) => {
    let cur = inst;
    for (let i = 0; cur && i < 8; i++) {
      if (isWorldGui(cur)) return cur;
      cur = typeof cur.getParent === "function" ? cur.getParent() : null;
    }
    return null;
  };
  const ctlOf = (root) => (root ? billboards.get(root.id) || surfaces.get(root.id) : null);


  const markDirty = (p) => {
    structureDirty = true;
    for (const cand of [p && p.instance, p && p.child, p && p.parent]) {
      const ctl = ctlOf(guiRootOf(cand));
      if (ctl) ctl.markContent();
    }
    if (requestRender) requestRender();
  };
  subs.push(bus.on(Events.ChildAdded, markDirty));
  subs.push(bus.on(Events.ChildRemoved, markDirty));
  subs.push(bus.on(Events.Destroying, markDirty));


  subs.push(bus.on(Events.PropertyChanged, (p) => {
    const inst = p && p.instance;
    if (!inst) return;
    const root = guiRootOf(inst);
    if (!root) return;
    const ctl = ctlOf(root);
    if (ctl && propAffectsDraw(p.property)) {
      if (inst === root) {
        ctl.markContent();
      } else {
        const h = heat.record(inst.id, nowMs());
        ctl.noteHot(h.hotUntil);
        if (h.hot && !h.becameHot) ctl.markDynamic();
        else ctl.markContent();
      }
    }
    if (requestRender) requestRender();
  }));
  subs.push(bus.on("project:loaded", () => {
    structureDirty = true;
    heat.clear();

    focusedBox = null;


    pointer.hoverInst = null;
    pointer.hoverCtl = null;
    pointer.pressedInst = null;
    pointer.pressedCtl = null;
    imgCache.clear();

    gesture = null;
    if (requestRender) requestRender();
  }));

  function update() {
    if (disposed) return;
    if (structureDirty) syncStructure();


    if (pointer.hoverInst || pointer.pressedInst) {
      if (!engine.running) {
        setPointerState(null, null, null, null);
      } else {
        const h = pointer.hoverInst && isInst(pointer.hoverInst) ? pointer.hoverInst : null;
        const pr = pointer.pressedInst && isInst(pointer.pressedInst) ? pointer.pressedInst : null;
        if (h !== pointer.hoverInst || pr !== pointer.pressedInst) {
          setPointerState(h, h ? pointer.hoverCtl : null, pr, pr ? pointer.pressedCtl : null);
        }
      }
    }
    for (const ctl of billboards.values()) ctl.update();
    for (const ctl of surfaces.values()) ctl.update();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const off of subs) {
      if (typeof off === "function") off();
    }
    if (dom && typeof dom.removeEventListener === "function") {
      dom.removeEventListener("pointerdown", onPointerDown);
      dom.removeEventListener("pointermove", onPointerMove);
      dom.removeEventListener("pointerup", onPointerUp);
      dom.removeEventListener("pointerleave", onPointerLeave);

      dom.removeEventListener("pointerdown", onGestureStart);
      dom.removeEventListener("pointermove", onGestureMove);
    }
    if (win && typeof win.removeEventListener === "function") {
      win.removeEventListener("wheel", onWheel, { capture: true });
      win.removeEventListener("pointerup", onGestureEnd, true);
      win.removeEventListener("pointercancel", onGestureEnd, true);
    }
    gesture = null;
    for (const ctl of billboards.values()) ctl.dispose();
    for (const ctl of surfaces.values()) ctl.dispose();
    billboards.clear();
    surfaces.clear();
    imgCache.clear();
    scene.remove(surfaceGroup);
    scene.remove(billboardGroup);
    quadGeo.dispose();
  }

  return { update, dispose };
}
