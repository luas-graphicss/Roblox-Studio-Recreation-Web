import { bus } from "../core/eventBus.js";
import { terrainStore, TerrainEvents, REGION_TOOL } from "../terrain/terrainStore.js";
import { VOXEL_SIZE } from "../terrain/materials.js";
import {
  REGION_LIMITS, regionFromVoxelCorners, regionBoxToWorld,
  worldPointToVoxel, fitRegionYToTerrain,
} from "../terrain/regionCore.js";

export function createRegionController({ THREE, host, camera, scene, requestRender, getRaycastTargets }) {
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const ground = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  const dragPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);


  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const faceMat = new THREE.MeshBasicMaterial({
    color: 0x4c8bf5, transparent: true, opacity: 0.14,
    depthTest: false, depthWrite: false, side: THREE.DoubleSide,
  });
  const faceMesh = new THREE.Mesh(boxGeo, faceMat);
  faceMesh.renderOrder = 998;
  const edgeGeo = new THREE.EdgesGeometry(boxGeo);
  const edgeMat = new THREE.LineBasicMaterial({ color: 0x4c8bf5, transparent: true, opacity: 0.9, depthTest: false });
  const edgeLines = new THREE.LineSegments(edgeGeo, edgeMat);
  edgeLines.renderOrder = 999;
  const group = new THREE.Group();
  group.add(faceMesh);
  group.add(edgeLines);
  group.visible = false;
  group.userData.__rswRegionAdorn = true;
  scene.add(group);

  let dragging = false;
  let anchorVoxel = null;                                   
  let liveBox = null;                                       

  const isRegionTool = () => terrainStore.getActiveTool() === REGION_TOOL;

  function setNdcFromEvent(e) {
    const r = host.getBoundingClientRect();
    ndc.x = ((e.clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((e.clientY - r.top) / r.height) * 2 + 1;
  }


  function pointerToWorld(e) {
    setNdcFromEvent(e);
    raycaster.setFromCamera(ndc, camera);
    const targets = typeof getRaycastTargets === "function" ? (getRaycastTargets() || []) : [];
    if (targets.length) {
      const hits = raycaster.intersectObjects(targets, true);
      if (hits && hits.length) { const p = hits[0].point; return [p.x, p.y, p.z]; }
    }
    const out = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(ground, out)) return [out.x, out.y, out.z];
    return null;
  }


  function pointerToDragPlane(e) {
    setNdcFromEvent(e);
    raycaster.setFromCamera(ndc, camera);
    const out = new THREE.Vector3();
    if (raycaster.ray.intersectPlane(dragPlane, out)) return [out.x, out.y, out.z];
    return null;
  }

  function updateAdorn(box) {
    if (!box) { group.visible = false; requestRender(); return; }
    const w = regionBoxToWorld(box);
    group.position.set((w.min[0] + w.max[0]) / 2, (w.min[1] + w.max[1]) / 2, (w.min[2] + w.max[2]) / 2);
    group.scale.set(w.max[0] - w.min[0], w.max[1] - w.min[1], w.max[2] - w.min[2]);
    group.visible = true;
    requestRender();
  }

  function currentBoxFromEvent(e) {
    if (!anchorVoxel) return liveBox;
    const p = pointerToDragPlane(e);
    if (!p) return liveBox;
    const cur = worldPointToVoxel(p[0], 0, p[2]);

    return regionFromVoxelCorners(anchorVoxel, [cur[0], anchorVoxel[1], cur[2]]);
  }

  function onPointerDown(e) {
    if (!isRegionTool() || e.button !== 0) return;
    const p = pointerToWorld(e);
    if (!p) return;
    e.preventDefault();
    e.stopPropagation();


    const dir = raycaster.ray.direction;
    anchorVoxel = worldPointToVoxel(p[0] + dir.x * 0.01, p[1] + dir.y * 0.01, p[2] + dir.z * 0.01);
    anchorVoxel[0] = Math.max(-REGION_LIMITS.MAX_HALF_X, Math.min(REGION_LIMITS.MAX_HALF_X, anchorVoxel[0]));
    anchorVoxel[1] = Math.max(REGION_LIMITS.MIN_Y, Math.min(REGION_LIMITS.MAX_Y, anchorVoxel[1]));
    anchorVoxel[2] = Math.max(-REGION_LIMITS.MAX_HALF_Z, Math.min(REGION_LIMITS.MAX_HALF_Z, anchorVoxel[2]));
    dragPlane.set(new THREE.Vector3(0, 1, 0), -(anchorVoxel[1] * VOXEL_SIZE + VOXEL_SIZE / 2));
    dragging = true;
    liveBox = regionFromVoxelCorners(anchorVoxel, anchorVoxel);
    updateAdorn(liveBox);
    try { host.setPointerCapture(e.pointerId); } catch (_) {            }
  }

  function onPointerMove(e) {
    if (!dragging) return;
    e.preventDefault();
    e.stopPropagation();
    const next = currentBoxFromEvent(e);
    if (next) { liveBox = next; updateAdorn(liveBox); }
  }

  function onPointerUp(e) {
    if (!dragging) return;
    e.preventDefault();
    e.stopPropagation();
    dragging = false;
    try { host.releasePointerCapture(e.pointerId); } catch (_) {            }
    const next = currentBoxFromEvent(e) || liveBox;
    anchorVoxel = null;
    liveBox = null;
    if (!next) { updateAdorn(terrainStore.getRegionSelection()); return; }
    const fitted = fitRegionYToTerrain(terrainStore.getData(), next);

    terrainStore.setRegionSelection(fitted);
  }

  function onPointerCancel() {
    if (!dragging) return;
    dragging = false;
    anchorVoxel = null;
    liveBox = null;
    updateAdorn(terrainStore.getRegionSelection());
  }


  function onKeyDown(e) {
    if (e.defaultPrevented || e.key !== "Escape" || !isRegionTool()) return;
    const t = e.target;
    const tag = t && t.tagName ? t.tagName.toLowerCase() : "";
    if (tag === "input" || tag === "textarea" || tag === "select" || (t && t.isContentEditable)) return;
    e.preventDefault();
    if (terrainStore.getRegionSelection()) terrainStore.setRegionSelection(null);
    else terrainStore.setTool(null);
  }

  host.addEventListener("pointerdown", onPointerDown, true);
  host.addEventListener("pointermove", onPointerMove, true);
  host.addEventListener("pointerup", onPointerUp, true);
  host.addEventListener("pointercancel", onPointerCancel, true);
  window.addEventListener("keydown", onKeyDown);

  const offRegion = bus.on(TerrainEvents.RegionChanged, (p) => {
    if (!dragging) updateAdorn(p && p.region ? p.region : null);
  });
  const offTool = bus.on(TerrainEvents.ToolChanged, () => {
    if (!isRegionTool()) {
      dragging = false;
      anchorVoxel = null;
      liveBox = null;
      updateAdorn(terrainStore.getRegionSelection());
    }
  });

  function dispose() {
    host.removeEventListener("pointerdown", onPointerDown, true);
    host.removeEventListener("pointermove", onPointerMove, true);
    host.removeEventListener("pointerup", onPointerUp, true);
    host.removeEventListener("pointercancel", onPointerCancel, true);
    window.removeEventListener("keydown", onKeyDown);
    if (typeof offRegion === "function") offRegion();
    if (typeof offTool === "function") offTool();
    scene.remove(group);
    boxGeo.dispose();
    edgeGeo.dispose();
    faceMat.dispose();
    edgeMat.dispose();
  }

  return { isActive: () => dragging, dispose };
}
