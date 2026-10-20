import { store } from "../core/state.js";
import { getPathfindingDebugSnapshot, hasActivePaths } from "../runtime/pathfinding.js";

const STATUS_COLOR = {
  Success: 0x47d16c,
  ClosestNoPath: 0xe6c84a,
  ClosestOutOfRange: 0xe6c84a,
  FailStartNotEmpty: 0xe05050,
  FailFinishNotEmpty: 0xe05050,
  NoPath: 0xe05050,
};
const ACTION_COLOR = { Walk: 0x3a86ff, Jump: 0xff9f1c, Custom: 0x9b5de5 };

export function initPathfindingRenderer({ THREE, scene, requestRender, getWorkspace }) {
  const group = new THREE.Group();
  group.name = "PathfindingDebug";
  group.visible = false;
  group.renderOrder = 999;
  scene.add(group);


  const dynGroup = new THREE.Group();
  dynGroup.name = "PathfindingDynamicObstacles";
  dynGroup.visible = false;
  dynGroup.renderOrder = 999;
  scene.add(dynGroup);


  const sphereGeo = new THREE.SphereGeometry(0.55, 10, 8);


  const dynBoxGeo = new THREE.BoxGeometry(1, 1, 1);
  const pulseGeo = new THREE.RingGeometry(0.8, 1, 24);
  const dynPool = [];                                                     
  const pulsePool = [];                                                        
  const activePulses = [];                                               
  const repathSeen = new Map();                                               
  let lastDynSig = "";
  const DYN_MAX_BOXES = 256;                                           
  const PULSE_MAX = 12;                              
  const PULSE_MS = 650;                                           

  const transient = [];

  const matCache = new Map();

  function lineMat(color, dashed) {
    const key = (dashed ? "ld" : "ls") + color;
    let m = matCache.get(key);
    if (!m) {
      m = dashed
        ? new THREE.LineDashedMaterial({ color, dashSize: 1.4, gapSize: 0.9, transparent: true, opacity: 0.9, depthTest: false })
        : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.95, depthTest: false });
      matCache.set(key, m);
    }
    return m;
  }
  function sphereMat(color) {
    const key = "s" + color;
    let m = matCache.get(key);
    if (!m) { m = new THREE.MeshBasicMaterial({ color, depthTest: false }); matCache.set(key, m); }
    return m;
  }
  function boxMat(color) {
    const key = "b" + color;
    let m = matCache.get(key);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.18, depthTest: false, side: THREE.DoubleSide });
      matCache.set(key, m);
    }
    return m;
  }


  function dynBoxMat(color, opacity) {
    const key = "d" + color + ":" + opacity;
    let m = matCache.get(key);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthTest: false, side: THREE.DoubleSide });
      matCache.set(key, m);
    }
    return m;
  }

  function clearGroup() {
    for (const g of transient) { if (g && typeof g.dispose === "function") g.dispose(); }
    transient.length = 0;
    while (group.children.length) group.remove(group.children[group.children.length - 1]);
  }

  function num(v) { return typeof v === "number" && isFinite(v) ? v : 0; }
  function readVec(inst, prop) {
    if (!inst || typeof inst.getProperty !== "function") return null;
    const p = inst.getProperty(prop);
    if (!p || typeof p !== "object") return null;
    return { x: num(p.x), y: num(p.y), z: num(p.z) };
  }
  function attachmentWorld(att) {
    if (!att || typeof att.getProperty !== "function") return null;
    const local = readVec(att, "Position") || { x: 0, y: 0, z: 0 };
    const parent = typeof att.getParent === "function" ? att.getParent() : null;
    const base = parent ? readVec(parent, "Position") : null;
    if (!base) return local;
    return { x: base.x + local.x, y: base.y + local.y, z: base.z + local.z };
  }


  function collectGeometry() {
    const out = { modifiers: [], links: [] };
    const ws = typeof getWorkspace === "function" ? getWorkspace() : null;
    if (!ws || typeof ws.getDescendants !== "function") return out;
    for (const inst of ws.getDescendants()) {
      if (!inst || !inst.className) continue;
      if (inst.className === "PathfindingModifier") {
        const parent = typeof inst.getParent === "function" ? inst.getParent() : null;
        const pos = parent ? readVec(parent, "Position") : null;
        const size = parent ? readVec(parent, "Size") : null;
        if (pos && size) {
          out.modifiers.push({
            pos, size,
            passThrough: inst.getProperty("PassThrough") !== false,
          });
        }
      } else if (inst.className === "PathfindingLink") {
        const a0 = attachmentWorld(inst.getProperty("Attachment0"));
        const a1 = attachmentWorld(inst.getProperty("Attachment1"));
        if (a0 && a1) out.links.push({ a0, a1 });
      }
    }
    return out;
  }

  function q(n) { return Math.round(n * 100) / 100; }
  function signature(snapshot, geom) {
    const parts = [];
    for (const p of snapshot.paths) {
      const wps = p.waypoints.map((w) => `${q(w.x)},${q(w.y)},${q(w.z)},${w.action || "Walk"}`).join(";");
      parts.push(`${p.status}|${(p.blocked || []).join(",")}|${wps}`);
    }
    for (const m of geom.modifiers) parts.push(`M${q(m.pos.x)},${q(m.pos.y)},${q(m.pos.z)},${q(m.size.x)},${q(m.size.y)},${q(m.size.z)},${m.passThrough ? 1 : 0}`);
    for (const l of geom.links) parts.push(`L${q(l.a0.x)},${q(l.a0.y)},${q(l.a0.z)}-${q(l.a1.x)},${q(l.a1.y)},${q(l.a1.z)}`);
    return parts.join("\n");
  }

  function addLine(points, mat, dashed) {
    if (points.length < 2) return;
    const geo = new THREE.BufferGeometry().setFromPoints(points);
    transient.push(geo);
    const line = new THREE.Line(geo, mat);
    if (dashed && typeof line.computeLineDistances === "function") line.computeLineDistances();
    line.renderOrder = 999;
    group.add(line);
  }

  function rebuild(snapshot, geom) {
    clearGroup();

    for (const m of geom.modifiers) {
      const geo = new THREE.BoxGeometry(Math.max(0.1, m.size.x), Math.max(0.1, m.size.y), Math.max(0.1, m.size.z));
      transient.push(geo);
      const color = m.passThrough ? 0x47d16c : 0x1b1b1b;
      const mesh = new THREE.Mesh(geo, boxMat(color));
      mesh.position.set(m.pos.x, m.pos.y, m.pos.z);
      mesh.renderOrder = 998;
      group.add(mesh);
    }

    for (const l of geom.links) {
      addLine(
        [new THREE.Vector3(l.a0.x, l.a0.y, l.a0.z), new THREE.Vector3(l.a1.x, l.a1.y, l.a1.z)],
        lineMat(0x9b5de5, true),
        true
      );
    }

    for (const p of snapshot.paths) {
      const status = p.status || "NoPath";
      const lineColor = STATUS_COLOR[status] != null ? STATUS_COLOR[status] : 0xe05050;
      const pts = p.waypoints.map((w) => new THREE.Vector3(num(w.x), num(w.y), num(w.z)));
      addLine(pts, lineMat(lineColor, false), false);
      const blocked = new Set(p.blocked || []);
      for (let i = 0; i < p.waypoints.length; i++) {
        const w = p.waypoints[i];
        const aColor = blocked.has(i) ? 0xe05050 : (ACTION_COLOR[w.action] != null ? ACTION_COLOR[w.action] : ACTION_COLOR.Walk);
        const mesh = new THREE.Mesh(sphereGeo, sphereMat(aColor));
        mesh.position.set(num(w.x), num(w.y), num(w.z));
        mesh.renderOrder = 1000;
        group.add(mesh);
      }
    }
  }









  function dynObstacleBox(o) {
    if (!o || typeof o !== "object") return null;
    const fin = (v) => typeof v === "number" && isFinite(v);
    let cx, cy, cz, sx, sy, sz;
    if (fin(o.minX) && fin(o.maxX) && fin(o.minY) && fin(o.maxY) && fin(o.minZ) && fin(o.maxZ)) {
      cx = (o.minX + o.maxX) / 2; cy = (o.minY + o.maxY) / 2; cz = (o.minZ + o.maxZ) / 2;
      sx = o.maxX - o.minX; sy = o.maxY - o.minY; sz = o.maxZ - o.minZ;
    } else {
      const pos = (o.pos && typeof o.pos === "object" && o.pos) || (o.position && typeof o.position === "object" && o.position) || null;
      if (!pos) return null;
      const size = (o.size && typeof o.size === "object" && o.size) || null;
      cx = num(pos.x); cy = num(pos.y); cz = num(pos.z);
      sx = size ? Math.abs(num(size.x)) : 4;
      sy = size ? Math.abs(num(size.y)) : 4;
      sz = size ? Math.abs(num(size.z)) : 4;
    }
    if (!fin(cx) || !fin(cy) || !fin(cz) || !fin(sx) || !fin(sy) || !fin(sz)) return null;
    return {
      cx, cy, cz,
      sx: Math.max(0.1, sx), sy: Math.max(0.1, sy), sz: Math.max(0.1, sz),
      moving: !!(o.moving || o.isMoving),
    };
  }

  function pathRepathCount(p) {
    if (!p || typeof p !== "object") return null;
    const v = typeof p.repaths === "number" ? p.repaths : p.repathCount;
    return typeof v === "number" && isFinite(v) && v >= 0 ? v : null;
  }

  function spawnPulse(x, y, z) {
    if (activePulses.length >= PULSE_MAX) return;
    let entry = null;
    for (const e of pulsePool) { if (!e.inUse) { entry = e; break; } }
    if (!entry) {
      const mat = new THREE.MeshBasicMaterial({ color: 0xffd21f, transparent: true, opacity: 0.9, depthTest: false, side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(pulseGeo, mat);
      mesh.rotation.x = -Math.PI / 2;
      mesh.renderOrder = 1001;
      dynGroup.add(mesh);
      entry = { mesh, mat, inUse: false, start: 0 };
      pulsePool.push(entry);
    }
    entry.inUse = true;
    entry.start = Date.now();
    entry.mesh.position.set(num(x), num(y) + 0.15, num(z));
    entry.mesh.scale.set(1, 1, 1);
    entry.mat.opacity = 0.9;
    entry.mesh.visible = true;
    activePulses.push(entry);
  }

  function updatePulses() {
    const nowMs = Date.now();
    for (let i = activePulses.length - 1; i >= 0; i--) {
      const p = activePulses[i];
      const t = (nowMs - p.start) / PULSE_MS;
      if (t >= 1) {
        p.inUse = false;
        p.mesh.visible = false;
        activePulses.splice(i, 1);
        continue;
      }
      const s = 1 + t * 5;
      p.mesh.scale.set(s, s, s);
      p.mat.opacity = 0.9 * (1 - t);
    }
    return activePulses.length > 0;
  }

  function clearPulses() {
    for (const p of activePulses) { p.inUse = false; p.mesh.visible = false; }
    activePulses.length = 0;
  }


  function detectRepaths(snapshot) {
    const paths = Array.isArray(snapshot.paths) ? snapshot.paths : [];
    const seenKeys = new Set();
    let sawPerPath = false;
    for (let i = 0; i < paths.length; i++) {
      const p = paths[i];
      const count = pathRepathCount(p);
      if (count == null) continue;
      sawPerPath = true;
      const key = p.id != null ? "id:" + p.id : "ix:" + i;
      seenKeys.add(key);
      const prev = repathSeen.get(key);
      if (typeof prev === "number" && count > prev) {
        const w = Array.isArray(p.waypoints) && p.waypoints.length ? p.waypoints[0] : null;
        if (w) spawnPulse(w.x, w.y, w.z);
      }
      repathSeen.set(key, count);
    }

    if (!sawPerPath && typeof snapshot.repaths === "number" && isFinite(snapshot.repaths)) {
      seenKeys.add("__total__");
      const prev = repathSeen.get("__total__");
      if (typeof prev === "number" && snapshot.repaths > prev) {
        for (const p of paths) {
          const w = p && Array.isArray(p.waypoints) && p.waypoints.length ? p.waypoints[0] : null;
          if (w) spawnPulse(w.x, w.y, w.z);
        }
      }
      repathSeen.set("__total__", snapshot.repaths);
    }

    for (const k of [...repathSeen.keys()]) {
      if (!seenKeys.has(k)) repathSeen.delete(k);
    }
  }

  function dynSignature(boxes) {
    const parts = [];
    for (const b of boxes) parts.push(q(b.cx) + "," + q(b.cy) + "," + q(b.cz) + "," + q(b.sx) + "," + q(b.sy) + "," + q(b.sz) + "," + (b.moving ? 1 : 0));
    return parts.join(";");
  }


  function updateDynamicLayer(snapshot) {
    const dynRaw = snapshot && Array.isArray(snapshot.dynamic) ? snapshot.dynamic : null;
    const boxes = [];
    if (dynRaw) {
      for (let i = 0; i < dynRaw.length && boxes.length < DYN_MAX_BOXES; i++) {
        const b = dynObstacleBox(dynRaw[i]);
        if (b) boxes.push(b);
      }
      detectRepaths(snapshot);
    } else {
      if (repathSeen.size) repathSeen.clear();
      if (activePulses.length) clearPulses();
    }

    const sig = boxes.length ? dynSignature(boxes) : "";
    if (sig !== lastDynSig) {
      lastDynSig = sig;
      for (let i = 0; i < boxes.length; i++) {
        let mesh = dynPool[i];
        if (!mesh) {
          mesh = new THREE.Mesh(dynBoxGeo, dynBoxMat(0xe6c84a, 0.2));
          mesh.renderOrder = 998;
          dynPool.push(mesh);
          dynGroup.add(mesh);
        }
        const b = boxes[i];

        mesh.material = b.moving ? dynBoxMat(0xffd21f, 0.42) : dynBoxMat(0xe6c84a, 0.2);
        mesh.position.set(b.cx, b.cy, b.cz);
        mesh.scale.set(b.sx, b.sy, b.sz);
        mesh.visible = true;
      }
      for (let i = boxes.length; i < dynPool.length; i++) dynPool[i].visible = false;
      requestRender && requestRender();
    }

    const pulsing = updatePulses();
    const visible = boxes.length > 0 || pulsing;
    if (dynGroup.visible !== visible) {
      dynGroup.visible = visible;
      requestRender && requestRender();
    }
    if (pulsing) requestRender && requestRender();
  }

  let lastSig = "";

  function update() {
    const showPaths = !!store.getViewOption("showPathfinding");
    const showDyn = !!store.getViewOption("showDynamicObstacles");
    const snapshot = showPaths || showDyn ? getPathfindingDebugSnapshot() : null;


    updateDynamicLayer(showDyn ? snapshot : null);

    if (!showPaths) {
      if (group.visible) { group.visible = false; clearGroup(); lastSig = ""; requestRender && requestRender(); }
      return;
    }
    const active = hasActivePaths() || (snapshot.paths && snapshot.paths.length > 0);
    const geom = collectGeometry();
    const hasGeom = geom.modifiers.length > 0 || geom.links.length > 0;
    if (!active && !hasGeom) {
      if (group.visible) { group.visible = false; clearGroup(); lastSig = ""; requestRender && requestRender(); }
      return;
    }
    const sig = signature(snapshot, geom);
    if (sig !== lastSig || !group.visible) {
      lastSig = sig;
      rebuild(snapshot, geom);
      group.visible = true;
      requestRender && requestRender();
    }
  }

  function dispose() {
    clearGroup();
    clearPulses();
    for (const m of matCache.values()) { if (m && typeof m.dispose === "function") m.dispose(); }
    matCache.clear();
    for (const p of pulsePool) { if (p.mat && typeof p.mat.dispose === "function") p.mat.dispose(); }
    pulsePool.length = 0;
    dynPool.length = 0;
    if (typeof sphereGeo.dispose === "function") sphereGeo.dispose();
    if (typeof dynBoxGeo.dispose === "function") dynBoxGeo.dispose();
    if (typeof pulseGeo.dispose === "function") pulseGeo.dispose();
    scene.remove(group);
    scene.remove(dynGroup);
  }

  return { update, dispose };
}
