import { store } from "../core/state.js";
import { getSpatialQueryDebugSnapshot, setSpatialDebugEnabled } from "./spatialQueryDebug.js";

const RAY_HIT = 0x47d16c;
const RAY_MISS = 0xe05050;
const SHAPE_COLOR = 0x3a86ff;
const OVERLAP_COLOR = 0xffb703;
const HIT_COLOR = 0xff2e88;

export function initSpatialQueryRenderer({ THREE, scene, requestRender }) {
  const group = new THREE.Group();
  group.name = "SpatialQueryDebug";
  group.visible = false;
  group.renderOrder = 999;
  scene.add(group);

  const hitGeo = new THREE.SphereGeometry(0.35, 8, 6);
  const transient = [];
  const matCache = new Map();

  function lineMat(color) {
    const k = "l" + color;
    let m = matCache.get(k);
    if (!m) {
      m = new THREE.LineBasicMaterial({ color, depthTest: false });
      matCache.set(k, m);
    }
    return m;
  }
  function solidMat(color) {
    const k = "s" + color;
    let m = matCache.get(k);
    if (!m) {
      m = new THREE.MeshBasicMaterial({ color, depthTest: false });
      matCache.set(k, m);
    }
    return m;
  }

  function clearGroup() {
    for (const g of transient) {
      if (g && typeof g.dispose === "function") g.dispose();
    }
    transient.length = 0;
    while (group.children.length) group.remove(group.children[group.children.length - 1]);
  }

  function addLine(a, b, color) {
    const geo = new THREE.BufferGeometry().setFromPoints([
      new THREE.Vector3(a.x, a.y, a.z),
      new THREE.Vector3(b.x, b.y, b.z),
    ]);
    transient.push(geo);
    const line = new THREE.Line(geo, lineMat(color));
    line.renderOrder = 999;
    group.add(line);
  }
  function addPoint(p, color) {
    const mesh = new THREE.Mesh(hitGeo, solidMat(color));
    mesh.position.set(p.x, p.y, p.z);
    mesh.renderOrder = 1000;
    group.add(mesh);
  }
  function addWireBox(center, size, color) {
    const geo = new THREE.BoxGeometry(
      Math.max(0.05, Math.abs(size.x)),
      Math.max(0.05, Math.abs(size.y)),
      Math.max(0.05, Math.abs(size.z))
    );
    const edges = new THREE.EdgesGeometry(geo);
    transient.push(geo);
    transient.push(edges);
    const seg = new THREE.LineSegments(edges, lineMat(color));
    seg.position.set(center.x, center.y, center.z);
    seg.renderOrder = 999;
    group.add(seg);
  }
  function addWireSphere(center, radius, color) {
    const geo = new THREE.SphereGeometry(Math.max(0.05, Math.abs(radius)), 12, 8);
    const edges = new THREE.EdgesGeometry(geo);
    transient.push(geo);
    transient.push(edges);
    const seg = new THREE.LineSegments(edges, lineMat(color));
    seg.position.set(center.x, center.y, center.z);
    seg.renderOrder = 999;
    group.add(seg);
  }

  let lastSig = "";

  function update() {
    const showRay = !!store.getViewOption("showRaycastDebug");
    const showOverlap = !!store.getViewOption("showOverlapDebug");
    const showShape = !!store.getViewOption("showShapecastDebug");
    const showHits = !!store.getViewOption("showQueryHits");
    const anyOn = showRay || showOverlap || showShape || showHits;
    setSpatialDebugEnabled(anyOn);
    if (!anyOn) {
      if (group.visible) {
        group.visible = false;
        clearGroup();
        lastSig = "";
        requestRender && requestRender();
      }
      return;
    }
    const snap = getSpatialQueryDebugSnapshot();
    const flags = (showRay ? 1 : 0) + "" + (showOverlap ? 1 : 0) + (showShape ? 1 : 0) + (showHits ? 1 : 0);
    const sig = snap.length + ":" + (snap.length ? snap[snap.length - 1].t : 0) + ":" + flags;
    if (sig === lastSig && group.visible) return;
    lastSig = sig;
    clearGroup();
    for (const e of snap) {
      if (e.type === "cast") {
        const isRay = e.kind === "ray";
        const wantLine = isRay ? showRay : showShape;
        let end = null;
        if (e.hit && e.hit.position) end = e.hit.position;
        else if (e.origin && e.direction)
          end = {
            x: e.origin.x + e.direction.x,
            y: e.origin.y + e.direction.y,
            z: e.origin.z + e.direction.z,
          };
        if (wantLine && e.origin && end) addLine(e.origin, end, e.hit ? RAY_HIT : RAY_MISS);
        if (showShape && !isRay && e.origin) {
          if (e.size) addWireBox(e.origin, e.size, SHAPE_COLOR);
          else if (e.radius) addWireSphere(e.origin, e.radius, SHAPE_COLOR);
        }
        if (showHits && e.hit && e.hit.position) addPoint(e.hit.position, HIT_COLOR);
      } else if (e.type === "overlap") {
        if (showOverlap && e.center) {
          if (e.size) addWireBox(e.center, e.size, OVERLAP_COLOR);
          else if (e.radius) addWireSphere(e.center, e.radius, OVERLAP_COLOR);
        }
        if (showHits && e.hits) {
          for (const h of e.hits) addPoint(h, HIT_COLOR);
        }
      }
    }
    group.visible = group.children.length > 0;
    requestRender && requestRender();
  }

  function dispose() {
    clearGroup();
    for (const m of matCache.values()) {
      if (m && typeof m.dispose === "function") m.dispose();
    }
    matCache.clear();
    if (typeof hitGeo.dispose === "function") hitGeo.dispose();
    scene.remove(group);
  }

  return { update, dispose };
}
