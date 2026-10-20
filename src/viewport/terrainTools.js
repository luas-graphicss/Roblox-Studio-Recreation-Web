import { terrainStore } from "../terrain/terrainStore.js";
import { createStroke, applyDab, finishStroke } from "../terrain/operations.js";
import { VOXEL_SIZE } from "../terrain/materials.js";

export function createTerrainController({ THREE, host, camera, scene, requestRender, getRaycastTargets }) {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const hit = new THREE.Vector3();

  let stroke = null;
  let dragging = false;
  let lastShape = null;
  let lastSize = -1;


  const previewMat = new THREE.MeshBasicMaterial({ color: 0x4c8bf5, wireframe: true, transparent: true, opacity: 0.6, depthTest: false });
  let preview = new THREE.Mesh(new THREE.SphereGeometry(1, 16, 12), previewMat);
  preview.visible = false;
  preview.renderOrder = 999;
  scene.add(preview);

  function rebuildPreviewGeometry(shape, sizeStuds) {
    if (shape === lastShape && sizeStuds === lastSize) return;
    lastShape = shape; lastSize = sizeStuds;
    if (preview.geometry) preview.geometry.dispose();
    const r = sizeStuds / 2;
    if (shape === "Box") preview.geometry = new THREE.BoxGeometry(sizeStuds, sizeStuds, sizeStuds);
    else if (shape === "Cylinder") preview.geometry = new THREE.CylinderGeometry(r, r, r * 1.4, 20, 1, true);
    else preview.geometry = new THREE.SphereGeometry(r, 20, 14);
  }

  function pointerToWorld(ev) {
    const rect = host.getBoundingClientRect();
    ndc.x = ((ev.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((ev.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const targets = (getRaycastTargets && getRaycastTargets()) || [];
    if (targets.length) {
      const inter = raycaster.intersectObjects(targets, false);
      if (inter.length) return inter[0].point;
    }
    if (raycaster.ray.intersectPlane(ground, hit)) return hit;
    return null;
  }

  function updatePreview(ev) {
    const tool = terrainStore.getActiveTool();
    if (!tool || !terrainStore.isBrushTool(tool)) { preview.visible = false; return; }
    const brush = terrainStore.getBrush();
    rebuildPreviewGeometry(brush.shape, brush.size);
    const p = pointerToWorld(ev);
    if (!p) { preview.visible = false; return; }
    let y = p.y;
    if (brush.pivot === "Base") y += brush.size / 2;
    preview.position.set(p.x, y, p.z);
    preview.visible = true;
    requestRender && requestRender();
  }

  function activeBrushTool() {
    const tool = terrainStore.getActiveTool();
    return tool && terrainStore.isBrushTool(tool) ? tool : null;
  }

  function onPointerDown(ev) {
    const tool = activeBrushTool();
    if (!tool) return;
    if (ev.button !== 0) return;                                           
    ev.stopPropagation();
    ev.preventDefault();
    const p = pointerToWorld(ev);
    if (!p) return;
    dragging = true;
    try { host.setPointerCapture(ev.pointerId); } catch (e) {}
    stroke = createStroke(tool, terrainStore.getMaterial());
    applyDab(stroke, [p.x, p.y, p.z]);
    terrainStore.notifyChanged();
    requestRender && requestRender();
  }

  function onPointerMove(ev) {
    if (!activeBrushTool()) { preview.visible = false; return; }
    updatePreview(ev);
    if (!dragging || !stroke) return;
    const p = pointerToWorld(ev);
    if (!p) return;
    ev.stopPropagation();
    applyDab(stroke, [p.x, p.y, p.z]);
    terrainStore.notifyChanged();
    requestRender && requestRender();
  }

  function onPointerUp(ev) {
    if (!dragging) return;
    if (ev.button !== 0) return;
    ev.stopPropagation();
    dragging = false;
    try { host.releasePointerCapture(ev.pointerId); } catch (e) {}
    if (stroke) { finishStroke(stroke); stroke = null; }
    requestRender && requestRender();
  }

  function onPointerLeave() { preview.visible = false; requestRender && requestRender(); }


  function onPointerCancel(ev) {
    preview.visible = false;
    if (dragging) {
      dragging = false;
      try { host.releasePointerCapture(ev.pointerId); } catch (e) {}
      if (stroke) { finishStroke(stroke); stroke = null; }
    }
    requestRender && requestRender();
  }

  const opts = { capture: true };
  host.addEventListener("pointerdown", onPointerDown, opts);
  host.addEventListener("pointermove", onPointerMove, opts);
  host.addEventListener("pointerup", onPointerUp, opts);
  host.addEventListener("pointercancel", onPointerCancel, opts);
  host.addEventListener("pointerleave", onPointerLeave);

  return {
    isActive() { return !!activeBrushTool(); },
    dispose() {
      host.removeEventListener("pointerdown", onPointerDown, opts);
      host.removeEventListener("pointermove", onPointerMove, opts);
      host.removeEventListener("pointerup", onPointerUp, opts);
      host.removeEventListener("pointercancel", onPointerCancel, opts);
      host.removeEventListener("pointerleave", onPointerLeave);
      if (preview.geometry) preview.geometry.dispose();
      previewMat.dispose();
      scene.remove(preview);
    },
  };
}
