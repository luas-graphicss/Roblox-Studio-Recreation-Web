import * as THREE from "three";
import { bus } from "../core/eventBus.js";
import { store } from "../core/state.js";
import { Events } from "../datamodel/index.js";
import { engine } from "../runtime/engine.js";

const ADORN_CLASSES = new Set([
  "Highlight", "SelectionBox", "SelectionSphere", "Handles", "ArcHandles", "ForceField",
]);
const MAX_ADORNS = 300;
const MAX_PARTS_PER_ADORN = 100;
const OUTLINE_SCALE = 1.04;
const CSG_CLASSES = new Set(["UnionOperation", "IntersectOperation", "NegateOperation", "PartOperation"]);

function clamp(v, lo, hi, fb) {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n)) return fb;
  return n < lo ? lo : n > hi ? hi : n;
}

function clamp01(v, fb) {
  return clamp(v, 0, 1, fb);
}

function isBasePart(inst) {
  return !!(
    inst &&
    typeof inst.hasProperty === "function" &&
    inst.hasProperty("Size") &&
    inst.hasProperty("Anchored")
  );
}

function isInst(x) {
  return !!(x && typeof x.isDestroyed === "function" && !x.isDestroyed());
}

function colorOf(v, fb) {
  if (v && typeof v === "object" && Number.isFinite(v.r)) {
    return new THREE.Color(clamp01(v.r, 1), clamp01(v.g, 1), clamp01(v.b, 1));
  }
  return new THREE.Color(fb);
}

function resolveAdornee(inst) {
  const a = inst.hasProperty("Adornee") ? inst.getProperty("Adornee") : null;
  if (isInst(a)) return a;
  const parent = inst.getParent && inst.getParent();
  return isInst(parent) ? parent : null;
}

function partsOf(adornee) {
  if (!isInst(adornee)) return [];
  if (isBasePart(adornee)) return [adornee];
  const out = [];
  const visit = (i) => {
    if (out.length >= MAX_PARTS_PER_ADORN) return;
    if (isBasePart(i)) out.push(i);
    for (const c of i.getChildren()) visit(c);
  };
  visit(adornee);
  return out;
}

const FACE_NORMALS = {
  Front: new THREE.Vector3(0, 0, -1),
  Back: new THREE.Vector3(0, 0, 1),
  Top: new THREE.Vector3(0, 1, 0),
  Bottom: new THREE.Vector3(0, -1, 0),
  Left: new THREE.Vector3(-1, 0, 0),
  Right: new THREE.Vector3(1, 0, 0),
};
const ALL_FACES = Object.keys(FACE_NORMALS);
const AXIS_VECTORS = {
  X: new THREE.Vector3(1, 0, 0),
  Y: new THREE.Vector3(0, 1, 0),
  Z: new THREE.Vector3(0, 0, 1),
};

export function initAdornRenderer({ scene, camera, renderer, requestRender, meshFor }) {
  const group = new THREE.Group();
  group.name = "AdornGroup";
  scene.add(group);

  const controllers = new Map();
  const subs = [];
  let structureDirty = true;
  let disposed = false;
  let clock = 0;

  function meshesForPart(part) {
    const root = meshFor ? meshFor(part.id) : null;
    if (!root) return [];
    const out = [];
    root.traverse((o) => {
      if (o.isMesh && o.geometry) out.push(o);
    });
    return out;
  }

  function worldBoxOf(parts) {
    const box = new THREE.Box3();
    let any = false;
    for (const part of parts) {
      for (const m of meshesForPart(part)) {
        m.updateWorldMatrix(true, false);
        const b = new THREE.Box3().setFromObject(m);
        if (!b.isEmpty()) {
          box.union(b);
          any = true;
        }
      }
    }
    return any ? box : null;
  }

  function disposeObject(o) {
    o.traverse((c) => {
      if (c.geometry) c.geometry.dispose();
      if (c.material) {
        if (Array.isArray(c.material)) c.material.forEach((mm) => mm.dispose());
        else c.material.dispose();
      }
    });
  }


  function makeHighlight(inst) {
    const g = new THREE.Group();
    group.add(g);
    let pairs = [];
    const fillMat = new THREE.MeshBasicMaterial({
      transparent: true, depthWrite: false,
      polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1,
    });
    const outlineMat = new THREE.MeshBasicMaterial({ transparent: true, side: THREE.BackSide, depthWrite: false });
    const scaleM = new THREE.Matrix4().makeScale(OUTLINE_SCALE, OUTLINE_SCALE, OUTLINE_SCALE);

    function rebuild() {
      for (const p of pairs) {
        g.remove(p.fill);
        g.remove(p.outline);
      }
      pairs = [];
      const adornee = resolveAdornee(inst);
      for (const part of partsOf(adornee)) {
        for (const src of meshesForPart(part)) {
          const fill = new THREE.Mesh(src.geometry, fillMat);
          const outline = new THREE.Mesh(src.geometry, outlineMat);
          fill.matrixAutoUpdate = false;
          outline.matrixAutoUpdate = false;
          g.add(outline);
          g.add(fill);
          pairs.push({ src, fill, outline });
        }
      }
    }

    function update() {
      const enabled = inst.getProperty("Enabled") === true;
      const adornee = resolveAdornee(inst);
      g.visible = enabled && !!adornee;
      if (!g.visible) return;
      let stale = false;
      for (const p of pairs) {
        if (!p.src.parent || p.fill.geometry !== p.src.geometry) {
          stale = true;
          break;
        }
      }
      if (stale || (pairs.length === 0 && partsOf(adornee).length > 0)) rebuild();
      const occluded = inst.getProperty("DepthMode") === "Occluded";
      fillMat.color = colorOf(inst.getProperty("FillColor"), 0xffffff);
      fillMat.opacity = 1 - clamp01(inst.getProperty("FillTransparency"), 0.5);
      fillMat.depthTest = occluded;
      outlineMat.color = colorOf(inst.getProperty("OutlineColor"), 0xffffff);
      outlineMat.opacity = 1 - clamp01(inst.getProperty("OutlineTransparency"), 0);
      outlineMat.depthTest = occluded;
      const order = occluded ? 0 : 950;
      for (const p of pairs) {
        if (!p.src.parent) continue;
        p.src.updateWorldMatrix(true, false);
        p.fill.matrix.copy(p.src.matrixWorld);
        p.outline.matrix.copy(p.src.matrixWorld).multiply(scaleM);
        p.fill.renderOrder = order + 1;
        p.outline.renderOrder = order;
      }
    }

    return {
      rebuild,
      update,
      dispose: () => {
        group.remove(g);
        fillMat.dispose();
        outlineMat.dispose();
      },
    };
  }


  function makeSelectionBox(inst) {
    const g = new THREE.Group();
    group.add(g);
    const lineMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    const faceMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide });
    const edges = [];
    const unit = new THREE.BoxGeometry(1, 1, 1);
    for (let i = 0; i < 12; i++) {
      const e = new THREE.Mesh(unit, lineMat);
      g.add(e);
      edges.push(e);
    }
    const faceMesh = new THREE.Mesh(unit, faceMat);
    g.add(faceMesh);

    function layout(dims, t) {
      const hw = dims.x / 2, hh = dims.y / 2, hd = dims.z / 2;
      let k = 0;
      for (const sy of [-1, 1]) {
        for (const sz of [-1, 1]) {
          edges[k].scale.set(dims.x + t, t, t);
          edges[k].position.set(0, sy * hh, sz * hd);
          k++;
        }
      }
      for (const sx of [-1, 1]) {
        for (const sz of [-1, 1]) {
          edges[k].scale.set(t, dims.y + t, t);
          edges[k].position.set(sx * hw, 0, sz * hd);
          k++;
        }
      }
      for (const sx of [-1, 1]) {
        for (const sy of [-1, 1]) {
          edges[k].scale.set(t, t, dims.z + t);
          edges[k].position.set(sx * hw, sy * hh, 0);
          k++;
        }
      }
      faceMesh.scale.set(Math.max(dims.x, 0.01), Math.max(dims.y, 0.01), Math.max(dims.z, 0.01));
    }

    function update() {
      const adornee = resolveAdornee(inst);
      const visible = inst.getProperty("Visible") === true && !!adornee;
      g.visible = visible;
      if (!visible) return;
      const t = clamp(inst.getProperty("LineThickness"), 0.01, 1, 0.15);
      const alpha = 1 - clamp01(inst.getProperty("Transparency"), 0);
      lineMat.color = colorOf(inst.getProperty("Color3"), 0x10b0ff);
      lineMat.opacity = alpha;
      faceMat.color = colorOf(inst.getProperty("SurfaceColor3"), 0x10b0ff);
      faceMat.opacity = (1 - clamp01(inst.getProperty("SurfaceTransparency"), 1)) * alpha;
      faceMesh.visible = faceMat.opacity > 0.001;
      const parts = partsOf(adornee);
      if (parts.length === 1) {
        const meshes = meshesForPart(parts[0]);
        if (!meshes.length) {
          g.visible = false;
          return;
        }
        meshes[0].updateWorldMatrix(true, false);
        const pos = new THREE.Vector3();
        const quat = new THREE.Quaternion();
        const scl = new THREE.Vector3();
        meshes[0].matrixWorld.decompose(pos, quat, scl);
        if (CSG_CLASSES.has(parts[0].className)) {
          const geo = meshes[0].geometry;
          if (!geo.boundingBox) geo.computeBoundingBox();
          const bb = geo.boundingBox;
          const dims = bb.getSize(new THREE.Vector3());
          dims.set(
            Math.max(dims.x * Math.abs(scl.x), 0.05),
            Math.max(dims.y * Math.abs(scl.y), 0.05),
            Math.max(dims.z * Math.abs(scl.z), 0.05),
          );
          const center = bb.getCenter(new THREE.Vector3()).applyMatrix4(meshes[0].matrixWorld);
          g.position.copy(center);
          g.quaternion.copy(quat);
          layout(dims, t);
        } else {
          const sz = parts[0].getProperty("Size") || { x: 1, y: 1, z: 1 };
          g.position.copy(pos);
          g.quaternion.copy(quat);
          layout(new THREE.Vector3(Math.abs(sz.x), Math.abs(sz.y), Math.abs(sz.z)), t);
        }
      } else {
        const box = worldBoxOf(parts);
        if (!box) {
          g.visible = false;
          return;
        }
        const dims = box.getSize(new THREE.Vector3());
        g.position.copy(box.getCenter(new THREE.Vector3()));
        g.quaternion.identity();
        layout(dims, t);
      }
    }

    return {
      rebuild: () => {},
      update,
      dispose: () => {
        group.remove(g);
        unit.dispose();
        lineMat.dispose();
        faceMat.dispose();
      },
    };
  }

  function makeSelectionSphere(inst) {
    const g = new THREE.Group();
    group.add(g);
    const wireMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, wireframe: true });
    const fillMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
    const geo = new THREE.SphereGeometry(1, 20, 14);
    const wire = new THREE.Mesh(geo, wireMat);
    const fill = new THREE.Mesh(geo, fillMat);
    g.add(fill);
    g.add(wire);

    function update() {
      const adornee = resolveAdornee(inst);
      const visible = inst.getProperty("Visible") === true && !!adornee;
      g.visible = visible;
      if (!visible) return;
      const alpha = 1 - clamp01(inst.getProperty("Transparency"), 0);
      wireMat.color = colorOf(inst.getProperty("Color3"), 0x10b0ff);
      wireMat.opacity = alpha;
      fillMat.color = colorOf(inst.getProperty("SurfaceColor3"), 0x10b0ff);
      fillMat.opacity = (1 - clamp01(inst.getProperty("SurfaceTransparency"), 1)) * alpha;
      fill.visible = fillMat.opacity > 0.001;
      const box = worldBoxOf(partsOf(adornee));
      if (!box) {
        g.visible = false;
        return;
      }
      const sphere = box.getBoundingSphere(new THREE.Sphere());
      g.position.copy(sphere.center);
      const r = Math.max(sphere.radius, 0.25);
      g.scale.set(r, r, r);
    }

    return {
      rebuild: () => {},
      update,
      dispose: () => {
        group.remove(g);
        geo.dispose();
        wireMat.dispose();
        fillMat.dispose();
      },
    };
  }


  function makeHandles(inst) {
    const g = new THREE.Group();
    group.add(g);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.95, depthTest: false });
    const knobs = new Map();
    const sphereGeo = new THREE.SphereGeometry(0.4, 14, 10);
    const coneGeo = new THREE.ConeGeometry(0.32, 0.9, 12);
    for (const face of ALL_FACES) {
      const knob = new THREE.Mesh(sphereGeo, mat);
      knob.renderOrder = 980;
      knob.userData.adornFace = face;
      knob.userData.adornInstId = inst.id;
      g.add(knob);
      knobs.set(face, knob);
    }

    function update() {
      const adornee = resolveAdornee(inst);
      const visible = inst.getProperty("Visible") === true && isBasePart(adornee);
      g.visible = visible;
      if (!visible) return;
      mat.color = colorOf(inst.getProperty("Color3"), 0x10b0ff);
      const style = String(inst.getProperty("Style") || "Resize");
      const facesSel = String(inst.getProperty("Faces") || "All");
      const meshes = meshesForPart(adornee);
      if (!meshes.length) {
        g.visible = false;
        return;
      }
      meshes[0].updateWorldMatrix(true, false);
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scl = new THREE.Vector3();
      meshes[0].matrixWorld.decompose(pos, quat, scl);
      g.position.copy(pos);
      g.quaternion.copy(quat);
      const sz = adornee.getProperty("Size") || { x: 1, y: 1, z: 1 };
      const half = new THREE.Vector3(Math.abs(sz.x) / 2, Math.abs(sz.y) / 2, Math.abs(sz.z) / 2);
      for (const [face, knob] of knobs) {
        const n = FACE_NORMALS[face];
        const show = facesSel === "All" || facesSel === face;
        knob.visible = show;
        if (!show) continue;
        const ext = Math.abs(n.x) * half.x + Math.abs(n.y) * half.y + Math.abs(n.z) * half.z;
        knob.geometry = style === "Move" ? coneGeo : sphereGeo;
        knob.position.copy(n).multiplyScalar(ext + 1.1);
        if (style === "Move") {
          knob.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), n);
        } else {
          knob.quaternion.identity();
        }
      }
    }

    return {
      rebuild: () => {},
      update,
      dispose: () => {
        group.remove(g);
        sphereGeo.dispose();
        coneGeo.dispose();
        mat.dispose();
      },
      pickables: () => (g.visible ? [...knobs.values()].filter((k) => k.visible) : []),
      inst,
      kind: "Handles",
    };
  }

  function makeArcHandles(inst) {
    const g = new THREE.Group();
    group.add(g);
    const mat = new THREE.MeshBasicMaterial({ transparent: true, opacity: 0.9, depthTest: false });
    const rings = new Map();
    const torusGeo = new THREE.TorusGeometry(1, 0.05, 10, 48);
    for (const axis of Object.keys(AXIS_VECTORS)) {
      const ring = new THREE.Mesh(torusGeo, mat);
      ring.renderOrder = 978;
      ring.userData.adornAxis = axis;
      ring.userData.adornInstId = inst.id;
      if (axis === "X") ring.rotation.y = Math.PI / 2;
      if (axis === "Y") ring.rotation.x = Math.PI / 2;
      g.add(ring);
      rings.set(axis, ring);
    }

    function update() {
      const adornee = resolveAdornee(inst);
      const visible = inst.getProperty("Visible") === true && isBasePart(adornee);
      g.visible = visible;
      if (!visible) return;
      mat.color = colorOf(inst.getProperty("Color3"), 0x10b0ff);
      const axesSel = String(inst.getProperty("Axes") || "All");
      const meshes = meshesForPart(adornee);
      if (!meshes.length) {
        g.visible = false;
        return;
      }
      meshes[0].updateWorldMatrix(true, false);
      const pos = new THREE.Vector3();
      const quat = new THREE.Quaternion();
      const scl = new THREE.Vector3();
      meshes[0].matrixWorld.decompose(pos, quat, scl);
      g.position.copy(pos);
      g.quaternion.copy(quat);
      const sz = adornee.getProperty("Size") || { x: 1, y: 1, z: 1 };
      const r = Math.max(Math.abs(sz.x), Math.abs(sz.y), Math.abs(sz.z)) / 2 + 1.4;
      g.scale.set(r, r, r);
      for (const [axis, ring] of rings) {
        ring.visible = axesSel === "All" || axesSel === axis;
      }
    }

    return {
      rebuild: () => {},
      update,
      dispose: () => {
        group.remove(g);
        torusGeo.dispose();
        mat.dispose();
      },
      pickables: () => (g.visible ? [...rings.values()].filter((k) => k.visible) : []),
      inst,
      kind: "ArcHandles",
    };
  }


  function makeForceField(inst) {
    const g = new THREE.Group();
    group.add(g);
    const sphereMat = new THREE.MeshBasicMaterial({
      color: 0x3fa9ff, transparent: true, opacity: 0.22,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const shellMat = new THREE.MeshBasicMaterial({
      color: 0x9fdcff, transparent: true, opacity: 0.3, wireframe: true,
      blending: THREE.AdditiveBlending, depthWrite: false,
    });
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(1, 24, 16), sphereMat);
    const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1.03, 1), shellMat);
    g.add(sphere);
    g.add(shell);

    function update() {
      const parent = inst.getParent && inst.getParent();
      const visible = inst.getProperty("Visible") === true && isInst(parent);
      g.visible = visible;
      if (!visible) return;
      const box = worldBoxOf(partsOf(parent));
      if (!box) {
        g.visible = false;
        return;
      }
      const s = box.getBoundingSphere(new THREE.Sphere());
      g.position.copy(s.center);
      const r = Math.max(s.radius * 1.15, 2.5);
      g.scale.set(r, r, r);
      let fade = 1;
      const expires = Number(inst._expiresAt) || 0;
      if (expires > 0) {
        const left = (expires - Date.now()) / 1000;
        if (left <= 0) fade = 0;
        else if (left < 0.5) fade = left / 0.5;
      }
      const pulse = 0.8 + 0.2 * Math.sin(clock * 3.2);
      sphereMat.opacity = 0.22 * pulse * fade;
      shellMat.opacity = 0.3 * (0.7 + 0.3 * Math.sin(clock * 2.1 + 1.3)) * fade;
      shell.rotation.y = clock * 0.5;
      shell.rotation.x = clock * 0.23;
      if (requestRender) requestRender();
    }

    return {
      rebuild: () => {},
      update,
      dispose: () => {
        group.remove(g);
        sphere.geometry.dispose();
        shell.geometry.dispose();
        sphereMat.dispose();
        shellMat.dispose();
      },
    };
  }

  const FACTORY = {
    Highlight: makeHighlight,
    SelectionBox: makeSelectionBox,
    SelectionSphere: makeSelectionSphere,
    Handles: makeHandles,
    ArcHandles: makeArcHandles,
    ForceField: makeForceField,
  };

  function collectAdorns() {
    const dm = store.getDataModel();
    const out = [];
    if (!dm) return out;
    const visit = (i) => {
      if (out.length >= MAX_ADORNS) return;
      if (ADORN_CLASSES.has(i.className) && !i.isDestroyed()) out.push(i);
      for (const c of i.getChildren()) visit(c);
    };
    visit(dm);
    return out;
  }

  function syncStructure() {
    structureDirty = false;
    const found = collectAdorns();
    const alive = new Set();
    for (const inst of found) {
      alive.add(inst.id);
      let ctl = controllers.get(inst.id);
      if (!ctl) {
        ctl = FACTORY[inst.className](inst);
        controllers.set(inst.id, ctl);
      }
      ctl.rebuild();
    }
    for (const [id, ctl] of [...controllers]) {
      if (!alive.has(id)) {
        ctl.dispose();
        controllers.delete(id);
      }
    }
  }


  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  let activeDrag = null;

  function pickHandles(e) {
    const dom = renderer && renderer.domElement;
    if (!dom) return null;
    const rect = dom.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const targets = [];
    for (const ctl of controllers.values()) {
      if (typeof ctl.pickables !== "function") continue;
      if (ctl.inst && ctl.inst.__pluginInputDisabled === true) continue;
      for (const p of ctl.pickables()) targets.push(p);
    }
    if (!targets.length) return null;
    const hits = raycaster.intersectObjects(targets, false);
    if (!hits.length) return null;
    const obj = hits[0].object;
    const ctl = [...controllers.values()].find(
      (c) => c.inst && c.inst.id === obj.userData.adornInstId,
    );
    return ctl ? { ctl, obj, point: hits[0].point } : null;
  }

  function fire(inst, type, args) {
    bus.emit("gameplay:event", { instance: inst, type, args: args || [] });
  }

  function angleAround(axisWorld, center, point) {
    const v = point.clone().sub(center);
    const ref = Math.abs(axisWorld.y) < 0.9 ? new THREE.Vector3(0, 1, 0) : new THREE.Vector3(1, 0, 0);
    const u = ref.clone().cross(axisWorld).normalize();
    const w = axisWorld.clone().cross(u).normalize();
    return Math.atan2(v.dot(w), v.dot(u));
  }

  function onPointerDown(e) {
    if (e.button !== 0 || disposed) return;
    const hit = pickHandles(e);
    if (!hit) return;
    const inst = hit.ctl.inst;
    if (hit.ctl.kind === "Handles") {
      const face = hit.obj.userData.adornFace;
      const g = hit.obj.parent;
      const nWorld = FACE_NORMALS[face].clone().applyQuaternion(g.quaternion).normalize();
      activeDrag = { ctl: hit.ctl, kind: "Handles", face, origin: hit.point.clone(), normal: nWorld };

      fire(inst, "MouseButton1Down", [face]);
    } else {
      const axis = hit.obj.userData.adornAxis;
      const g = hit.obj.parent;
      const axisWorld = AXIS_VECTORS[axis].clone().applyQuaternion(g.quaternion).normalize();
      const start = angleAround(axisWorld, g.position.clone(), hit.point);
      activeDrag = {
        ctl: hit.ctl, kind: "ArcHandles", axis, axisWorld,
        center: g.position.clone(), startAngle: start, lastAngle: start,
      };

      fire(inst, "MouseButton1Down", [axis]);
    }
    e.preventDefault();
    e.stopPropagation();
  }

  function onPointerMove(e) {
    if (!activeDrag || disposed) return;
    const dom = renderer && renderer.domElement;
    if (!dom) return;
    const rect = dom.getBoundingClientRect();
    ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
    raycaster.setFromCamera(ndc, camera);
    const inst = activeDrag.ctl.inst;
    if (!isInst(inst)) {
      activeDrag = null;
      return;
    }
    if (activeDrag.kind === "Handles") {
      const ray = raycaster.ray;
      const lineDir = activeDrag.normal;
      const w0 = ray.origin.clone().sub(activeDrag.origin);
      const a = ray.direction.dot(ray.direction);
      const b = ray.direction.dot(lineDir);
      const c = lineDir.dot(lineDir);
      const d = ray.direction.dot(w0);
      const ee = lineDir.dot(w0);
      const denom = a * c - b * b;
      const t = Math.abs(denom) > 1e-6 ? (a * ee - b * d) / denom : 0;
      fire(inst, "MouseDrag", [activeDrag.face, t]);
    } else {
      const plane = new THREE.Plane().setFromNormalAndCoplanarPoint(activeDrag.axisWorld, activeDrag.center);
      const hitPt = new THREE.Vector3();
      if (raycaster.ray.intersectPlane(plane, hitPt)) {
        const ang = angleAround(activeDrag.axisWorld, activeDrag.center, hitPt);
        const rel = ang - activeDrag.startAngle;
        const delta = ang - activeDrag.lastAngle;
        activeDrag.lastAngle = ang;
        fire(inst, "MouseDrag", [activeDrag.axis, rel, delta]);
      }
    }
    if (requestRender) requestRender();
  }

  function onPointerUp() {
    if (!activeDrag || disposed) return;
    const inst = activeDrag.ctl.inst;

    const arg = activeDrag.kind === "Handles" ? activeDrag.face : activeDrag.axis;
    activeDrag = null;
    if (isInst(inst)) fire(inst, "MouseButton1Up", [arg]);
  }

  const dom = renderer && renderer.domElement;
  if (dom && typeof dom.addEventListener === "function") {
    dom.addEventListener("pointerdown", onPointerDown);
    if (typeof window !== "undefined") {
      window.addEventListener("pointermove", onPointerMove);
      window.addEventListener("pointerup", onPointerUp);
    }
  }

  const markDirty = (p) => {
    const inst = p && (p.instance || p.child);
    if (inst && (ADORN_CLASSES.has(inst.className) || p.property === "Adornee")) {
      structureDirty = true;
      if (requestRender) requestRender();
      return;
    }
    if (p && p.property && (p.property === "Enabled" || p.property === "Visible")) {
      if (requestRender) requestRender();
    }
  };
  subs.push(bus.on(Events.ChildAdded, markDirty));
  subs.push(bus.on(Events.ChildRemoved, markDirty));
  subs.push(bus.on(Events.Destroying, markDirty));
  subs.push(bus.on(Events.PropertyChanged, markDirty));
  subs.push(bus.on("project:loaded", () => {
    structureDirty = true;
    if (requestRender) requestRender();
  }));

  function update(dt) {
    if (disposed) return;
    clock += Number.isFinite(dt) ? dt : 1 / 60;
    if (structureDirty) syncStructure();
    for (const ctl of controllers.values()) ctl.update();
  }

  function dispose() {
    if (disposed) return;
    disposed = true;
    for (const off of subs) {
      if (typeof off === "function") off();
    }
    if (dom && typeof dom.removeEventListener === "function") {
      dom.removeEventListener("pointerdown", onPointerDown);
      if (typeof window !== "undefined") {
        window.removeEventListener("pointermove", onPointerMove);
        window.removeEventListener("pointerup", onPointerUp);
      }
    }
    for (const ctl of controllers.values()) ctl.dispose();
    controllers.clear();
    scene.remove(group);
    disposeObject(group);
  }

  return { update, dispose, __engineRef: engine };
}
