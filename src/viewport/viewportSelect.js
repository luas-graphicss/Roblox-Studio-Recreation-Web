import { selection } from "../core/selection.js";
import { tools } from "./tools.js";
import { paintPick } from "../editor/materialPaint.js";                        
import { expandBoxWithSkeleton } from "./objectBounds.js";                      

const DRAG_THRESHOLD = 5;                                   

function isInstance(i) {
  return (
    i &&
    i.__isInstance === true &&
    typeof i.isDestroyed === "function" &&
    !i.isDestroyed()
  );
}

export function createViewportSelection(opts) {
  const { THREE, host, camera, meshes, instanced, sync, requestRender, isGizmoDragging } =
    opts || {};
  if (!THREE || !host || !camera || !meshes) {
    return { dispose() {} };
  }

  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const tmp = new THREE.Vector3();

  let down = null;                                  
  let boxEl = null;                          
  let boxing = false;                                         

  function gizmoBusy() {
    return typeof isGizmoDragging === "function" && isGizmoDragging();
  }

  function render() {
    if (typeof requestRender === "function") requestRender();
  }

  function instById(id) {
    if (id == null || !sync || typeof sync.getRecord !== "function") return null;
    const rec = sync.getRecord(id);
    return rec && isInstance(rec.instance) ? rec.instance : null;
  }

  function hostRect() {
    return host.getBoundingClientRect();
  }


  function isLocked(inst) {
    return !!(inst && typeof inst.getProperty === "function" && inst.getProperty("Locked") === true);
  }


  const pickBox = new THREE.Box3();
  const pickPoint = new THREE.Vector3();


  function pickIdAt(clientX, clientY) {
    const r = hostRect();
    if (!r.width || !r.height) return null;
    ndc.x = ((clientX - r.left) / r.width) * 2 - 1;
    ndc.y = -((clientY - r.top) / r.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const targets = [];
    for (const obj of meshes.values()) {
      if (obj && obj.visible) targets.push(obj);
    }
    if (instanced) {
      for (const m of instanced.getRaycastMeshes()) targets.push(m);
    }
    const hits = raycaster.intersectObjects(targets, true);
    let bestId = null;
    let bestDist = Infinity;
    for (const h of hits) {
      let o = h.object;
      if (instanced && o && o.userData && o.userData.__rswPool) {
        const pid = h.instanceId != null ? instanced.idFromHit(o, h.instanceId) : null;
        if (pid == null) continue;
        if (isLocked(instById(pid))) continue;
        bestId = pid;
        bestDist = h.distance;
        break;
      }
      while (o && (o.userData == null || o.userData.rswId == null)) o = o.parent;
      if (o && o.userData && o.userData.rswId != null) {
        const id = o.userData.rswId;
        if (isLocked(instById(id))) continue;                                          
        bestId = id;
        bestDist = h.distance;
        break;
      }
    }


    for (const [mid, obj] of meshes) {
      if (!obj || !obj.visible || !obj.userData || !obj.userData.isMeshPart) continue;
      if (mid === bestId) continue;
      pickBox.setFromObject(obj);
      expandBoxWithSkeleton(obj, pickBox);
      if (pickBox.isEmpty()) continue;
      if (!raycaster.ray.intersectBox(pickBox, pickPoint)) continue;
      const dist = pickPoint.distanceTo(raycaster.ray.origin);
      if (dist >= bestDist) continue;
      if (isLocked(instById(mid))) continue;
      bestId = mid;
      bestDist = dist;
    }


    if (bestId == null && instanced && typeof instanced.pickByRay === "function") {
      const cand = instanced.pickByRay(raycaster.ray);
      if (cand && cand.id != null && !isLocked(instById(cand.id))) {
        bestId = cand.id;
        bestDist = cand.distance;
      }
    }
    return bestId;
  }

  function applyClick(id, additive, toggleMode) {
    if (id == null) {


      if (!additive && !toggleMode && tools.get() === "select") selection.clear();
      return;
    }
    const inst = instById(id);
    if (!inst) return;


    if (!additive && !toggleMode && paintPick(inst)) return;
    if (toggleMode) {
      selection.toggle(inst);                                
    } else if (additive) {
      const cur = selection.get();                                          
      if (!cur.includes(inst)) selection.set([...cur, inst]);
    } else {
      selection.selectSingle(inst);
    }
  }

  function ensureBoxEl() {
    if (boxEl) return boxEl;
    boxEl = host.ownerDocument.createElement("div");
    boxEl.className = "rsw-boxselect";
    host.appendChild(boxEl);
    host.classList.add("is-boxselecting");
    return boxEl;
  }

  function drawBox(x0, y0, x1, y1) {
    const r = hostRect();
    const left = Math.min(x0, x1) - r.left;
    const top = Math.min(y0, y1) - r.top;
    const w = Math.abs(x1 - x0);
    const h = Math.abs(y1 - y0);
    const b = ensureBoxEl();
    b.style.left = `${left}px`;
    b.style.top = `${top}px`;
    b.style.width = `${w}px`;
    b.style.height = `${h}px`;
  }

  function clearBox() {
    boxing = false;
    host.classList.remove("is-boxselecting");
    if (boxEl && boxEl.parentNode) boxEl.parentNode.removeChild(boxEl);
    boxEl = null;
  }


  function finalizeBox(x0, y0, x1, y1, additive) {
    const r = hostRect();
    const minX = Math.min(x0, x1);
    const maxX = Math.max(x0, x1);
    const minY = Math.min(y0, y1);
    const maxY = Math.max(y0, y1);
    camera.updateMatrixWorld();
    const picked = [];
    for (const [id, obj] of meshes) {
      if (!obj || !obj.visible) continue;
      obj.getWorldPosition(tmp);
      tmp.project(camera);
      if (tmp.z < -1 || tmp.z > 1) continue;                                   
      const sx = r.left + (tmp.x * 0.5 + 0.5) * r.width;
      const sy = r.top + (-tmp.y * 0.5 + 0.5) * r.height;
      if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) {
        const inst = instById(id);
        if (inst && !isLocked(inst)) picked.push(inst);
      }
    }
    if (instanced) {
      instanced.forEachCenter((id, x, y, z) => {
        tmp.set(x, y, z).project(camera);
        if (tmp.z < -1 || tmp.z > 1) return;
        const sx = r.left + (tmp.x * 0.5 + 0.5) * r.width;
        const sy = r.top + (-tmp.y * 0.5 + 0.5) * r.height;
        if (sx >= minX && sx <= maxX && sy >= minY && sy <= maxY) {
          const inst = instById(id);
          if (inst && !isLocked(inst)) picked.push(inst);
        }
      });
    }
    if (additive) {
      const cur = selection.get();
      const merged = cur.slice();
      for (const i of picked) if (!merged.includes(i)) merged.push(i);
      selection.set(merged);
    } else {
      selection.set(picked);
    }
  }

  function onPointerDown(e) {
    if (e.button !== 0) return;                         
    if (gizmoBusy()) return;                                    
    const hitId = pickIdAt(e.clientX, e.clientY);
    down = {
      x: e.clientX,
      y: e.clientY,
      pointerId: e.pointerId,
      hitId,
      moved: false,
      ctrl: e.ctrlKey || e.metaKey,
      shift: e.shiftKey,
    };
  }

  function onPointerMove(e) {
    if (!down) return;
    if (!down.moved) {
      const dx = e.clientX - down.x;
      const dy = e.clientY - down.y;
      if (Math.hypot(dx, dy) < DRAG_THRESHOLD) return;
      down.moved = true;

      if (down.hitId == null && tools.get() === "select" && !gizmoBusy()) {
        boxing = true;
        try {
          host.setPointerCapture(e.pointerId);
        } catch (_) {

        }
      }
    }
    if (boxing) {
      drawBox(down.x, down.y, e.clientX, e.clientY);
      e.preventDefault();
    }
  }

  function onPointerUp(e) {
    if (!down) return;
    const state = down;
    down = null;
    if (boxing) {


      finalizeBox(state.x, state.y, e.clientX, e.clientY, state.ctrl || state.shift);
      clearBox();
      try {
        host.releasePointerCapture(e.pointerId);
      } catch (_) {

      }
      render();
      return;
    }
    if (gizmoBusy()) return;                                               
    applyClick(state.hitId, state.shift, state.ctrl);
    render();
  }

  function onPointerCancel() {
    down = null;
    if (boxing) clearBox();
  }

  host.addEventListener("pointerdown", onPointerDown);
  host.addEventListener("pointermove", onPointerMove);
  host.addEventListener("pointerup", onPointerUp);
  host.addEventListener("pointercancel", onPointerCancel);

  function dispose() {
    host.removeEventListener("pointerdown", onPointerDown);
    host.removeEventListener("pointermove", onPointerMove);
    host.removeEventListener("pointerup", onPointerUp);
    host.removeEventListener("pointercancel", onPointerCancel);
    clearBox();
  }

  return { dispose };
}
