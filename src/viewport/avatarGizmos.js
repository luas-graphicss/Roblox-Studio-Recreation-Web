import { store } from "../core/state.js";
import {
  avatarDebugState,
  updateCharacterAccessories,
  layeredAccessories,
  findHandle,
  linkFor,
} from "../avatar/accessoryRuntime.js";

const SCAN_MS = 700;
const AXIS_LEN = 0.35;
const BOUNDS_COLOR = { r: 0.91, g: 0.64, b: 0.24 };

function live(inst) {
  return !!(
    inst &&
    inst.__isInstance === true &&
    !(typeof inst.isDestroyed === "function" && inst.isDestroyed())
  );
}

function getVec(inst, prop) {
  let v = null;
  try {
    v = inst.getProperty(prop);
  } catch (_) {
    v = null;
  }
  v = v || {};
  return { x: Number(v.x) || 0, y: Number(v.y) || 0, z: Number(v.z) || 0 };
}


export function rotEuler(p, rotDeg) {
  const k = Math.PI / 180;
  const ax = (Number(rotDeg && rotDeg.x) || 0) * k;
  const ay = (Number(rotDeg && rotDeg.y) || 0) * k;
  const az = (Number(rotDeg && rotDeg.z) || 0) * k;
  let x = p.x;
  let y = p.y;
  let z = p.z;

  let c = Math.cos(az);
  let s = Math.sin(az);
  let t = x * c - y * s;
  y = x * s + y * c;
  x = t;

  c = Math.cos(ay);
  s = Math.sin(ay);
  t = x * c + z * s;
  z = -x * s + z * c;
  x = t;

  c = Math.cos(ax);
  s = Math.sin(ax);
  t = y * c - z * s;
  z = y * s + z * c;
  y = t;
  return { x, y, z };
}

function showGizmosOn() {
  try {
    return !!store.getViewOption("showGizmos");
  } catch (_) {
    return false;
  }
}

function pushLine(buf, a, b, color) {
  buf.pos.push(a.x, a.y, a.z, b.x, b.y, b.z);
  buf.col.push(color.r, color.g, color.b, color.r, color.g, color.b);
}

function pushBox(buf, center, size, color) {
  const hx = Math.max(0.01, size.x / 2);
  const hy = Math.max(0.01, size.y / 2);
  const hz = Math.max(0.01, size.z / 2);
  const corners = [];
  for (const sx of [-1, 1])
    for (const sy of [-1, 1])
      for (const sz of [-1, 1])
        corners.push({ x: center.x + sx * hx, y: center.y + sy * hy, z: center.z + sz * hz });
  const edges = [
    [0, 1], [2, 3], [4, 5], [6, 7],
    [0, 2], [1, 3], [4, 6], [5, 7],
    [0, 4], [1, 5], [2, 6], [3, 7],
  ];
  for (const [i, j] of edges) pushLine(buf, corners[i], corners[j], color);
}


const CAGE_WIRE_MAX_VERTS = 6000;

function pushCageWireframe(buf, cage, color) {
  const pos = cage.positions;
  const idx = cage.indices;
  const seen = new Set();
  for (let i = 0; i + 2 < idx.length; i += 3) {
    const tri = [idx[i], idx[i + 1], idx[i + 2]];
    for (let e = 0; e < 3; e++) {
      const a = tri[e];
      const b = tri[(e + 1) % 3];
      const k = a < b ? a * 65536 + b : b * 65536 + a;
      if (seen.has(k)) continue;
      seen.add(k);
      pushLine(
        buf,
        { x: pos[a * 3], y: pos[a * 3 + 1], z: pos[a * 3 + 2] },
        { x: pos[b * 3], y: pos[b * 3 + 1], z: pos[b * 3 + 2] },
        color,
      );
    }
  }
}

export function initAvatarGizmos({ THREE, scene, requestRender }) {
  const group = new THREE.Group();
  group.name = "__rswAvatarGizmos";
  group.renderOrder = 998;
  scene.add(group);

  const mat = new THREE.LineBasicMaterial({
    vertexColors: true,
    transparent: true,
    opacity: 0.9,
    depthTest: false,
  });
  const lines = new THREE.LineSegments(new THREE.BufferGeometry(), mat);
  lines.frustumCulled = false;
  lines.visible = false;
  group.add(lines);

  let scanAt = 0;
  let chars = [];
  let disposed = false;
  let hadContent = false;

  function rescan() {
    chars = [];
    let ws = null;
    try {
      ws = store.getDataModel().findFirstChild("Workspace");
    } catch (_) {
      ws = null;
    }
    if (!live(ws)) return;
    for (const inst of ws.getDescendants()) {
      if (!live(inst) || inst.className !== "Model") continue;
      const hum = inst.getChildren().find((c) => live(c) && c.className === "Humanoid");
      if (hum) chars.push(inst);
    }
  }

  function collect(buf) {
    const wantAtt = avatarDebugState.showAttachments || showGizmosOn();
    const wantCages = avatarDebugState.showCages;
    const wantBounds = avatarDebugState.showClothingBounds;
    if (!wantAtt && !wantCages && !wantBounds) return;
    for (const char of chars) {
      if (!live(char)) continue;
      for (const part of char.getChildren()) {
        if (!live(part) || typeof part.hasProperty !== "function") continue;
        if (!part.hasProperty("Position")) continue;
        const pos = getVec(part, "Position");
        const rot = part.hasProperty("Rotation") ? getVec(part, "Rotation") : { x: 0, y: 0, z: 0 };
        for (const child of part.getChildren()) {
          if (!live(child)) continue;
          if (wantAtt && child.className === "Attachment") {
            const lp = rotEuler(getVec(child, "Position"), rot);
            const o = { x: pos.x + lp.x, y: pos.y + lp.y, z: pos.z + lp.z };
            pushLine(buf, o, { x: o.x + AXIS_LEN, y: o.y, z: o.z }, { r: 0.9, g: 0.25, b: 0.25 });
            pushLine(buf, o, { x: o.x, y: o.y + AXIS_LEN, z: o.z }, { r: 0.25, g: 0.85, b: 0.35 });
            pushLine(buf, o, { x: o.x, y: o.y, z: o.z + AXIS_LEN }, { r: 0.3, g: 0.45, b: 0.95 });
          }
          if (wantCages && child.className === "WrapTarget") {
            const size = getVec(part, "Size");
            const c = child.getProperty("Color") || {};
            const color = {
              r: Number(c.r) || 0.2,
              g: Number(c.g) || 0.8,
              b: Number(c.b) || 0.4,
            };
            pushBox(buf, pos, { x: size.x + 0.1, y: size.y + 0.1, z: size.z + 0.1 }, color);
          }
        }
      }
      if (wantBounds) {
        for (const acc of layeredAccessories(char)) {
          const handle = findHandle(acc);
          if (!live(handle)) continue;


          const link = linkFor(acc);
          const cage = link && link.wrapCache && link.wrapCache.cage;
          if (
            cage &&
            Array.isArray(cage.positions) &&
            Array.isArray(cage.indices) &&
            cage.positions.length <= CAGE_WIRE_MAX_VERTS * 3
          ) {
            pushCageWireframe(buf, cage, BOUNDS_COLOR);
          } else {
            pushBox(buf, getVec(handle, "Position"), getVec(handle, "Size"), BOUNDS_COLOR);
          }
        }
      }
    }
  }

  function update() {
    if (disposed) return;
    const now = Date.now();
    if (now - scanAt > SCAN_MS) {
      scanAt = now;
      rescan();
    }
    for (const char of chars) {
      if (live(char)) updateCharacterAccessories(char);
    }
    const buf = { pos: [], col: [] };
    collect(buf);
    if (buf.pos.length === 0) {
      if (hadContent) {
        lines.visible = false;
        hadContent = false;
        requestRender();
      }
      return;
    }
    lines.geometry.dispose();
    lines.geometry = new THREE.BufferGeometry();
    lines.geometry.setAttribute("position", new THREE.Float32BufferAttribute(buf.pos, 3));
    lines.geometry.setAttribute("color", new THREE.Float32BufferAttribute(buf.col, 3));
    lines.visible = true;
    hadContent = true;
    requestRender();
  }

  function dispose() {
    disposed = true;
    lines.geometry.dispose();
    mat.dispose();
    scene.remove(group);
  }

  return { update, dispose };
}
