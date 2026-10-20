import { bus } from "../core/eventBus.js";
import { store } from "../core/state.js";
import { streaming } from "../runtime/streaming.js";

const MAX_CHUNK_BOXES = 400;
const MAX_LOD_MARKS = 600;
const REBUILD_MS = 250;                                                        

export function initStreamingRenderer({ THREE, scene, requestRender, getInstanced }) {
  const group = new THREE.Group();
  group.name = "__rswStreamingDebug";
  group.visible = false;
  scene.add(group);

  const mats = new Map();
  function mat(color, opacity) {
    const key = color + ":" + opacity;
    let m = mats.get(key);
    if (!m) {
      m = new THREE.MeshBasicMaterial({
        color,
        wireframe: true,
        transparent: opacity < 1,
        opacity,
        depthWrite: false,
      });
      mats.set(key, m);
    }
    return m;
  }
  const sphereGeo = new THREE.SphereGeometry(1, 20, 14);
  const smallSphereGeo = new THREE.SphereGeometry(1, 8, 6);
  const boxGeo = new THREE.BoxGeometry(1, 1, 1);
  const LOD_COLORS = { Near: 0x37c871, Mid: 0xffc53d, Far: 0xff8c42 };

  let visDirty = true;
  let dirty = true;
  let lastSig = "";
  let lastRebuild = 0;
  let lastVisApply = 0;

  const offChanged = bus.on("streaming:changed", () => {
    visDirty = true;
    dirty = true;
    requestRender();
  });

  function view(key) {
    try { return store.getViewOption(key); } catch (_) { return false; }
  }


  function applyVisibility() {
    const hidden = streaming.getHiddenIdsForActive();
    let changed = false;
    scene.traverse((n) => {
      const id = n.userData ? n.userData.rswId : null;
      if (id == null) return;
      if (hidden && hidden.has(id)) {
        if (!n.userData.__rswStreamHidden) {
          n.userData.__rswStreamHidden = true;
          n.userData.__rswStreamPrevVisible = n.visible;
          n.visible = false;
          changed = true;
        } else if (n.visible) {


          n.userData.__rswStreamPrevVisible = true;
          n.visible = false;
          changed = true;
        }
      } else if (n.userData.__rswStreamHidden) {
        n.visible = n.userData.__rswStreamPrevVisible !== false;
        delete n.userData.__rswStreamHidden;
        delete n.userData.__rswStreamPrevVisible;
        changed = true;
      }
    });
    const instancedParts = typeof getInstanced === "function" ? getInstanced() : null;
    if (instancedParts && typeof instancedParts.applyHidden === "function") {
      if (instancedParts.applyHidden(hidden || null)) changed = true;
    }
    return changed;
  }

  function clearGroup() {
    for (let i = group.children.length - 1; i >= 0; i--) group.remove(group.children[i]);
  }

  function rebuild() {
    clearGroup();
    const showBounds = !!view("showStreamingBounds");
    const showChunks = !!view("showStreamedChunks");
    const showFocus = !!view("showReplicationFocus");
    const showLod = !!view("showLODLevels");
    if (!(showBounds || showChunks || showFocus || showLod)) { group.visible = false; return; }
    const snap = streaming.getDebugSnapshot();
    if (!snap.enabled) { group.visible = false; return; }
    group.visible = true;
    const client = snap.clients.find((c) => c.id === snap.activeClientId) || snap.clients[0];
    if (!client) return;
    const foci = [client.focus, ...client.extraFoci].filter(Boolean);

    if (showBounds) {
      for (const f of foci) {
        const inner = new THREE.Mesh(sphereGeo, mat(0x3b9eff, 0.5));
        inner.scale.setScalar(Math.max(1, snap.minRadius));
        inner.position.set(f.x, f.y, f.z);
        group.add(inner);
        const outer = new THREE.Mesh(sphereGeo, mat(0x9b6dff, 0.25));
        outer.scale.setScalar(Math.max(1, snap.targetRadius));
        outer.position.set(f.x, f.y, f.z);
        group.add(outer);
      }
    }
    if (showFocus && client.focus) {
      const marker = new THREE.Mesh(boxGeo, mat(0xff5c5c, 1));
      marker.scale.set(2, 2, 2);
      marker.position.set(client.focus.x, client.focus.y + 4, client.focus.z);
      group.add(marker);
    }
    if (showChunks) {
      const chunks = streaming.getChunkDebugForActive() || [];
      let drawn = 0;
      for (const ch of chunks) {
        if (drawn++ >= MAX_CHUNK_BOXES) break;
        const box = new THREE.Mesh(boxGeo, mat(ch.loaded ? 0x37c871 : 0xff5c5c, ch.loaded ? 0.3 : 0.5));
        box.scale.setScalar(ch.size * 0.98);
        box.position.set(ch.pos.x, ch.pos.y, ch.pos.z);
        group.add(box);
      }
    }
    if (showLod) {
      const marks = [];
      scene.traverse((n) => {
        if (marks.length >= MAX_LOD_MARKS) return;
        const id = n.userData ? n.userData.rswId : null;
        if (id == null) return;
        const tier = streaming.getLodTierForActive(id);
        if (!tier || !LOD_COLORS[tier]) return;
        const p = new THREE.Vector3();
        n.getWorldPosition(p);
        marks.push({ p, tier });
      });
      for (const mk of marks) {
        const m = new THREE.Mesh(smallSphereGeo, mat(LOD_COLORS[mk.tier], 0.9));
        m.scale.setScalar(0.8);
        m.position.copy(mk.p);
        m.position.y += 2;
        group.add(m);
      }
    }
  }

  function update() {


    const nowVis = Date.now();
    if (visDirty || (streaming.isStreamingActive() && nowVis - lastVisApply >= REBUILD_MS)) {
      visDirty = false;
      lastVisApply = nowVis;
      if (applyVisibility()) requestRender();
    }
    const sig = [
      view("showStreamingBounds") ? 1 : 0,
      view("showStreamedChunks") ? 1 : 0,
      view("showReplicationFocus") ? 1 : 0,
      view("showLODLevels") ? 1 : 0,
    ].join("|");
    const now = Date.now();
    const followFocus = group.visible && now - lastRebuild >= REBUILD_MS;
    if (sig !== lastSig || dirty || followFocus) {
      lastSig = sig;
      dirty = false;
      lastRebuild = now;
      rebuild();
    }
  }

  function dispose() {
    if (typeof offChanged === "function") offChanged();
    clearGroup();
    scene.remove(group);
    for (const m of mats.values()) m.dispose();
    mats.clear();
    sphereGeo.dispose();
    smallSphereGeo.dispose();
    boxGeo.dispose();
  }

  return { update, dispose };
}
