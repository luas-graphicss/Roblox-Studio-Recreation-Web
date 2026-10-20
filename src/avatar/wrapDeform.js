export const MAX_CAGE_VERTICES = 20000;


const LATTICE_N = 3;
const BASE_THICKNESS = 0.08;                                                      
const LAYER_LIFT = 0.03;                                                            
const MIN_THICKNESS = 0.01;
const MAX_THICKNESS = 2;


const IMPORT_INFLATE = 1.15;


export const CLOTHING_ROLES = Object.freeze({
  TShirt: Object.freeze(["torsoUpper", "torsoLower"]),
  Shirt: Object.freeze(["torsoUpper", "torsoLower", "armUpperLeft", "armUpperRight"]),
  Jacket: Object.freeze([
    "torsoUpper", "torsoLower", "armUpperLeft", "armUpperRight", "armLowerLeft", "armLowerRight",
  ]),
  Sweater: Object.freeze([
    "torsoUpper", "torsoLower", "armUpperLeft", "armUpperRight", "armLowerLeft", "armLowerRight",
  ]),
  Pants: Object.freeze(["hip", "legUpperLeft", "legUpperRight", "legLowerLeft", "legLowerRight"]),
  Shorts: Object.freeze(["hip", "legUpperLeft", "legUpperRight"]),
  DressSkirt: Object.freeze(["hip", "legUpperLeft", "legUpperRight"]),
  LeftShoe: Object.freeze(["footLeft"]),
  RightShoe: Object.freeze(["footRight"]),
});


const ROLE_TO_R15 = Object.freeze({
  torsoUpper: ["UpperTorso"],
  torsoLower: ["LowerTorso"],
  hip: ["LowerTorso"],
  armUpperLeft: ["LeftUpperArm"],
  armUpperRight: ["RightUpperArm"],
  armLowerLeft: ["LeftLowerArm"],
  armLowerRight: ["RightLowerArm"],
  legUpperLeft: ["LeftUpperLeg"],
  legUpperRight: ["RightUpperLeg"],
  legLowerLeft: ["LeftLowerLeg"],
  legLowerRight: ["RightLowerLeg"],
  footLeft: ["LeftFoot"],
  footRight: ["RightFoot"],
});

function live(inst) {
  return !!(
    inst &&
    inst.__isInstance === true &&
    !(typeof inst.isDestroyed === "function" && inst.isDestroyed())
  );
}

function isPartLike(inst) {
  return (
    live(inst) &&
    typeof inst.hasProperty === "function" &&
    inst.hasProperty("Position") &&
    inst.hasProperty("Size")
  );
}

function vec(inst, prop) {
  let v = null;
  try {
    v = inst.getProperty(prop);
  } catch (_) {
    v = null;
  }
  v = v || {};
  return { x: Number(v.x) || 0, y: Number(v.y) || 0, z: Number(v.z) || 0 };
}


function clamp(value, lo, hi, fb) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fb;
  return Math.min(hi, Math.max(lo, n));
}

function rotYv(v, yawDeg) {
  const a = ((Number(yawDeg) || 0) * Math.PI) / 180;
  if (a === 0) return { x: v.x, y: v.y, z: v.z };
  const c = Math.cos(a);
  const s = Math.sin(a);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
}


export function sanitizeCageMesh(mesh) {
  if (!mesh || typeof mesh !== "object") return { ok: false, reason: "mesh ausente" };
  const positions = mesh.positions;
  if (!Array.isArray(positions) || positions.length === 0) {
    return { ok: false, reason: "positions vazio" };
  }
  if (positions.length % 3 !== 0) {
    return { ok: false, reason: "positions nao e multiplo de 3" };
  }
  const vertexCount = positions.length / 3;
  if (vertexCount > MAX_CAGE_VERTICES) {
    return { ok: false, reason: `cage com ${vertexCount} vertices (max ${MAX_CAGE_VERTICES})` };
  }
  for (let i = 0; i < positions.length; i++) {
    if (!Number.isFinite(positions[i])) {
      return { ok: false, reason: "positions com valor nao finito" };
    }
  }
  if (mesh.indices != null) {
    if (!Array.isArray(mesh.indices) || mesh.indices.length % 3 !== 0) {
      return { ok: false, reason: "indices invalidos (multiplo de 3)" };
    }
    for (const ix of mesh.indices) {
      if (!Number.isInteger(ix) || ix < 0 || ix >= vertexCount) {
        return { ok: false, reason: "indice de triangulo fora do intervalo" };
      }
    }
  }
  return { ok: true, vertexCount };
}





const importedCages = new Map();

export function registerImportedCage(cageMeshId, mesh) {
  const id = String(cageMeshId || "").trim();
  if (!id) return { ok: false, reason: "cageMeshId vazio" };
  const san = sanitizeCageMesh(mesh);
  if (!san.ok) return san;
  importedCages.set(id, {
    positions: mesh.positions.slice(),
    indices: Array.isArray(mesh.indices) ? mesh.indices.slice() : null,
    vertexCount: san.vertexCount,
  });
  return { ok: true, vertexCount: san.vertexCount };
}

export function importedCageFor(cageMeshId) {
  return importedCages.get(String(cageMeshId || "").trim()) || null;
}

export function clearImportedCages() {
  importedCages.clear();
}


export function classifyBodyParts(char) {
  if (!live(char) || typeof char.getChildren !== "function") return null;
  const parts = [];
  for (const c of char.getChildren()) {
    if (!isPartLike(c)) continue;
    const tr = c.hasProperty("Transparency") ? Number(c.getProperty("Transparency")) || 0 : 0;
    if (tr >= 1) continue;                                              
    const p = vec(c, "Position");
    const s = vec(c, "Size");
    if (!(s.x > 1e-4 && s.y > 1e-4 && s.z > 1e-4)) continue;
    const yaw = c.hasProperty("Rotation") ? vec(c, "Rotation").y : 0;
    parts.push({ part: c, pos: p, size: s, yaw, clip: null });
  }
  if (parts.length === 0) return null;

  let minY = Infinity;
  let maxY = -Infinity;
  let cx = 0;
  for (const e of parts) {
    minY = Math.min(minY, e.pos.y - e.size.y / 2);
    maxY = Math.max(maxY, e.pos.y + e.size.y / 2);
    cx += e.pos.x;
  }
  cx /= parts.length;
  const H = Math.max(1e-4, maxY - minY);

  const roles = {
    head: [],
    torsoUpper: [],
    torsoLower: [],
    hip: [],
    armUpperLeft: [],
    armLowerLeft: [],
    handLeft: [],
    armUpperRight: [],
    armLowerRight: [],
    handRight: [],
    legUpperLeft: [],
    legLowerLeft: [],
    footLeft: [],
    legUpperRight: [],
    legLowerRight: [],
    footRight: [],
  };


  let head = null;
  for (const e of parts) {
    const ny = (e.pos.y - minY) / H;
    if (ny < 0.72) continue;
    if (Math.abs(e.pos.x - cx) > 0.3 * e.size.x + 0.3) continue;
    if (!head || e.pos.y > head.pos.y) head = e;
  }
  if (head) roles.head.push(head);


  const torso = [];
  let limbs = [];
  for (const e of parts) {
    if (e === head) continue;
    if (Math.abs(e.pos.x - cx) < 0.25 * e.size.x) torso.push(e);
    else limbs.push(e);
  }
  if (torso.length === 0 && limbs.length > 0) {

    let big = limbs[0];
    for (const e of limbs) {
      if (e.size.x * e.size.y * e.size.z > big.size.x * big.size.y * big.size.z) big = e;
    }
    torso.push(big);
    limbs = limbs.filter((e) => e !== big);
  }

  let tMin = Infinity;
  let tMax = -Infinity;
  for (const t of torso) {
    tMin = Math.min(tMin, t.pos.y - t.size.y / 2);
    tMax = Math.max(tMax, t.pos.y + t.size.y / 2);
  }
  const colH = Math.max(1e-4, tMax - tMin);
  const tMid = (tMin + tMax) / 2;



  for (const t of torso) {
    const top = t.pos.y + t.size.y / 2;
    const bot = t.pos.y - t.size.y / 2;
    const spanAbove = Math.max(0, top - tMid);
    const spanBelow = Math.max(0, tMid - bot);
    if (spanAbove > 0.25 * colH && spanBelow > 0.25 * colH) {
      roles.torsoUpper.push({ ...t, clip: [0.45, 1] });
      roles.torsoLower.push({ ...t, clip: [0, 0.5] });
      roles.hip.push({ ...t, clip: [0, 0.35] });
    } else if (t.pos.y >= tMid) {
      roles.torsoUpper.push({ ...t, clip: null });
    } else {
      roles.torsoLower.push({ ...t, clip: null });
      roles.hip.push({ ...t, clip: [0, 0.6] });
    }
  }


  const sides = { Left: [], Right: [] };
  for (const e of limbs) sides[e.pos.x < cx ? "Left" : "Right"].push(e);
  for (const sideName of ["Left", "Right"]) {
    const arr = sides[sideName];
    if (arr.length === 0) continue;
    arr.sort((a, b) => a.pos.x - b.pos.x || a.pos.y - b.pos.y);
    const chains = [];
    let cur = [arr[0]];
    for (let i = 1; i < arr.length; i++) {
      const prev = arr[i - 1];
      const e = arr[i];
      const gap = Math.abs(e.pos.x - prev.pos.x);
      if (gap > 0.5 * Math.max(e.size.x, prev.size.x) + 0.1) {
        chains.push(cur);
        cur = [e];
      } else {
        cur.push(e);
      }
    }
    chains.push(cur);
    for (const chain of chains) {
      let cMinY = Infinity;
      let cTop = -Infinity;
      for (const e of chain) {
        cMinY = Math.min(cMinY, e.pos.y - e.size.y / 2);
        cTop = Math.max(cTop, e.pos.y + e.size.y / 2);
      }
      const bottomNy = (cMinY - minY) / H;
      const isLeg = bottomNy <= 0.18 || cTop < tMid;
      const upperRole = (isLeg ? "legUpper" : "armUpper") + sideName;
      const lowerRole = (isLeg ? "legLower" : "armLower") + sideName;
      const extRole = (isLeg ? "foot" : "hand") + sideName;
      chain.sort((a, b) => b.pos.y - a.pos.y);
      if (chain.length >= 3) {
        roles[upperRole].push({ ...chain[0], clip: null });
        for (let i = 1; i < chain.length - 1; i++) {
          roles[lowerRole].push({ ...chain[i], clip: null });
        }
        roles[extRole].push({ ...chain[chain.length - 1], clip: null });
      } else if (chain.length === 2) {
        roles[upperRole].push({ ...chain[0], clip: null });
        roles[lowerRole].push({ ...chain[1], clip: null });
        roles[extRole].push({ ...chain[1], clip: [0, 0.35] });
      } else {

        roles[upperRole].push({ ...chain[0], clip: [0.5, 1] });
        roles[lowerRole].push({ ...chain[0], clip: [0.15, 0.55] });
        roles[extRole].push({ ...chain[0], clip: [0, 0.3] });
      }
    }
  }

  return { parts, roles, head, bounds: { minY, maxY, cx, height: H } };
}


export function findRegionEntries(char, type) {
  const rolesWanted = CLOTHING_ROLES[type];
  if (!rolesWanted) return [];
  const cls = classifyBodyParts(char);
  if (!cls) return [];
  const out = [];
  for (const role of rolesWanted) {
    for (const e of cls.roles[role] || []) {
      out.push({
        part: e.part,
        pos: e.pos,
        size: e.size,
        yaw: e.yaw,
        clip: e.clip ? [e.clip[0], e.clip[1]] : null,
      });
    }
  }
  return out;
}


export function wrapPartNamesFor(char) {
  const cls = classifyBodyParts(char);
  if (!cls) return [];
  const names = [];
  for (const role of Object.keys(cls.roles)) {
    if (role === "head") continue;
    for (const e of cls.roles[role]) {
      if (!names.includes(e.part.name)) names.push(e.part.name);
    }
  }
  return names;
}


export function regionPartsFor(type) {
  const roles = CLOTHING_ROLES[type];
  if (!roles) return null;
  const out = [];
  for (const role of roles) {
    for (const nm of ROLE_TO_R15[role] || []) {
      if (!out.includes(nm)) out.push(nm);
    }
  }
  return out;
}


function clipY(e) {
  const sy = e.size.y;
  const y0 = -sy / 2 + (e.clip ? e.clip[0] : 0) * sy;
  const y1 = -sy / 2 + (e.clip ? e.clip[1] : 1) * sy;
  return { y0, y1 };
}


function minkowskiNormal(l, hx, y0, y1, hz, cutLo, cutHi) {
  const eps = 1e-3;
  let nx = 0;
  let ny = 0;
  let nz = 0;
  if (l.x >= hx - eps) nx = 1;
  else if (l.x <= -hx + eps) nx = -1;


  if (!cutHi && l.y >= y1 - eps) ny = 1;
  else if (!cutLo && l.y <= y0 + eps) ny = -1;
  if (l.z >= hz - eps) nz = 1;
  else if (l.z <= -hz + eps) nz = -1;
  const len = Math.hypot(nx, ny, nz);
  if (len < eps) return { x: 0, y: 1, z: 0 };
  return { x: nx / len, y: ny / len, z: nz / len };
}

function emitPartLattice(e, thickness, bind, out) {
  const hx = e.size.x / 2;
  const hz = e.size.z / 2;
  const { y0, y1 } = clipY(e);
  const faces = [
    { fix: "x", s: 1 },
    { fix: "x", s: -1 },
    { fix: "y", s: 1 },
    { fix: "y", s: -1 },
    { fix: "z", s: 1 },
    { fix: "z", s: -1 },
  ];
  for (const f of faces) {
    const base = out.positions.length / 3;
    for (let i = 0; i <= LATTICE_N; i++) {
      for (let j = 0; j <= LATTICE_N; j++) {
        const u = i / LATTICE_N;
        const v = j / LATTICE_N;
        let l;
        if (f.fix === "x") {
          l = { x: f.s * hx, y: y0 + u * (y1 - y0), z: -hz + v * 2 * hz };
        } else if (f.fix === "y") {
          l = { x: -hx + u * 2 * hx, y: f.s > 0 ? y1 : y0, z: -hz + v * 2 * hz };
        } else {
          l = { x: -hx + u * 2 * hx, y: y0 + v * (y1 - y0), z: f.s * hz };
        }
        const n = minkowskiNormal(l, hx, y0, y1, hz, !!(e.clip && e.clip[0] > 0), !!(e.clip && e.clip[1] < 1));
        const lw = rotYv(l, e.yaw);
        const nw = rotYv(n, e.yaw);
        const ix = e.pos.x + lw.x;
        const iy = e.pos.y + lw.y;
        const iz = e.pos.z + lw.z;
        out.inner.push(ix, iy, iz);
        out.normals.push(nw.x, nw.y, nw.z);
        out.positions.push(
          ix + nw.x * thickness + bind.x,
          iy + nw.y * thickness + bind.y,
          iz + nw.z * thickness + bind.z,
        );
      }
    }
    for (let i = 0; i < LATTICE_N; i++) {
      for (let j = 0; j < LATTICE_N; j++) {
        const a = base + i * (LATTICE_N + 1) + j;
        const b = a + 1;
        const c = a + (LATTICE_N + 1);
        const d = c + 1;
        out.indices.push(a, b, d, a, d, c);
      }
    }
  }
}

function buildProceduralCage(entries, bind) {
  const out = { positions: [], inner: [], normals: [], indices: [] };
  for (const e of entries) {
    emitPartLattice(e, e.thickness, bind, out);
    if (out.positions.length / 3 > MAX_CAGE_VERTICES) return null;      
  }
  return {
    source: "procedural",
    vertexCount: out.positions.length / 3,
    positions: out.positions,
    inner: out.inner,
    normals: out.normals,
    indices: out.indices,
  };
}


function projectToClippedBox(w, e) {
  const local = rotYv({ x: w.x - e.pos.x, y: w.y - e.pos.y, z: w.z - e.pos.z }, -e.yaw);
  const hx = e.size.x / 2;
  const hz = e.size.z / 2;
  const { y0, y1 } = clipY(e);

  const cutLo = !!(e.clip && e.clip[0] > 0);
  const cutHi = !!(e.clip && e.clip[1] < 1);
  const cxv = Math.max(-hx, Math.min(hx, local.x));
  const cyv = Math.max(y0, Math.min(y1, local.y));
  const czv = Math.max(-hz, Math.min(hz, local.z));
  const q = { x: cxv, y: cyv, z: czv };
  let dist = 0;
  const inside = cxv === local.x && cyv === local.y && czv === local.z;
  if (inside) {

    const dxp = hx - local.x;
    const dxn = local.x + hx;
    const dyp = cutHi ? Infinity : y1 - local.y;
    const dyn = cutLo ? Infinity : local.y - y0;
    const dzp = hz - local.z;
    const dzn = local.z + hz;
    const m = Math.min(dxp, dxn, dyp, dyn, dzp, dzn);
    if (m === dxp) q.x = hx;
    else if (m === dxn) q.x = -hx;
    else if (m === dyp) q.y = y1;
    else if (m === dyn) q.y = y0;
    else if (m === dzp) q.z = hz;
    else q.z = -hz;
  } else {
    dist = Math.hypot(local.x - cxv, local.y - cyv, local.z - czv);
  }
  const n = minkowskiNormal(q, hx, y0, y1, hz, cutLo, cutHi);
  const qw = rotYv(q, e.yaw);
  const nw = rotYv(n, e.yaw);
  return {
    q: { x: e.pos.x + qw.x, y: e.pos.y + qw.y, z: e.pos.z + qw.z },
    n: nw,
    dist,
  };
}

function regionInnerBounds(entries) {
  const min = { x: Infinity, y: Infinity, z: Infinity };
  const max = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (const e of entries) {
    const hx = e.size.x / 2;
    const hz = e.size.z / 2;
    const { y0, y1 } = clipY(e);
    for (const sx of [-1, 1]) {
      for (const sz of [-1, 1]) {
        for (const yy of [y0, y1]) {
          const w = rotYv({ x: sx * hx, y: yy, z: sz * hz }, e.yaw);
          const px = e.pos.x + w.x;
          const py = e.pos.y + w.y;
          const pz = e.pos.z + w.z;
          if (px < min.x) min.x = px;
          if (px > max.x) max.x = px;
          if (py < min.y) min.y = py;
          if (py > max.y) max.y = py;
          if (pz < min.z) min.z = pz;
          if (pz > max.z) max.z = pz;
        }
      }
    }
  }
  return { min, max };
}

function deformImportedCage(imp, entries, bind) {
  const pos = imp.positions;
  const vc = imp.vertexCount;
  if (!Array.isArray(pos) || vc <= 0 || vc > MAX_CAGE_VERTICES) return null;
  let iMin = { x: Infinity, y: Infinity, z: Infinity };
  let iMax = { x: -Infinity, y: -Infinity, z: -Infinity };
  for (let i = 0; i < vc; i++) {
    const x = pos[i * 3];
    const y = pos[i * 3 + 1];
    const z = pos[i * 3 + 2];
    if (x < iMin.x) iMin.x = x;
    if (x > iMax.x) iMax.x = x;
    if (y < iMin.y) iMin.y = y;
    if (y > iMax.y) iMax.y = y;
    if (z < iMin.z) iMin.z = z;
    if (z > iMax.z) iMax.z = z;
  }
  const rb = regionInnerBounds(entries);

  const target = { min: {}, max: {} };
  for (const k of ["x", "y", "z"]) {
    const c = (rb.min[k] + rb.max[k]) / 2;
    const h = ((rb.max[k] - rb.min[k]) / 2) * IMPORT_INFLATE;
    target.min[k] = c - h;
    target.max[k] = c + h;
  }
  const out = {
    positions: [],
    inner: [],
    normals: [],
    indices: imp.indices ? imp.indices.slice() : null,
  };
  for (let i = 0; i < vc; i++) {
    const v = { x: pos[i * 3], y: pos[i * 3 + 1], z: pos[i * 3 + 2] };
    const w = {};
    for (const k of ["x", "y", "z"]) {
      const ext = iMax[k] - iMin[k];
      if (ext < 1e-6) w[k] = (target.min[k] + target.max[k]) / 2;
      else w[k] = target.min[k] + ((v[k] - iMin[k]) / ext) * (target.max[k] - target.min[k]);
    }
    let best = null;
    let bestE = null;
    for (const e of entries) {
      const r = projectToClippedBox(w, e);
      if (!best || r.dist < best.dist) {
        best = r;
        bestE = e;
      }
    }
    const maxHalf = Math.max(bestE.size.x, bestE.size.y, bestE.size.z) / 2;
    const dn = Math.min(1, Math.max(0, best.dist) / Math.max(0.25, maxHalf));
    const t = bestE.thickness * (1 + 0.75 * dn);
    out.inner.push(best.q.x, best.q.y, best.q.z);
    out.normals.push(best.n.x, best.n.y, best.n.z);
    out.positions.push(
      best.q.x + best.n.x * t + bind.x,
      best.q.y + best.n.y * t + bind.y,
      best.q.z + best.n.z * t + bind.z,
    );
  }
  return {
    source: "imported",
    vertexCount: vc,
    positions: out.positions,
    inner: out.inner,
    normals: out.normals,
    indices: out.indices,
  };
}


function partStiffness(part) {
  try {
    const wt = part.getChildren().find((c) => live(c) && c.className === "WrapTarget");
    if (wt && typeof wt.hasProperty === "function" && wt.hasProperty("Stiffness")) {
      return clamp(wt.getProperty("Stiffness"), 0, 1, 0.5);
    }
  } catch (_) {

  }
  return 0.5;                                                                 
}


function layerRankFor(char, wrapLayer, order) {
  let rank = 0;
  try {
    for (const acc of char.getChildren()) {
      if (!live(acc)) continue;
      if (acc.className !== "Accessory" && acc.className !== "Accoutrement") continue;
      const handle = acc.getChildren().find((c) => isPartLike(c) && c.name === "Handle");
      if (!handle) continue;
      const wl = handle.getChildren().find((c) => live(c) && c.className === "WrapLayer");
      if (!wl || wl === wrapLayer) continue;
      if (wl.getProperty("Enabled") === false) continue;
      const o2 = Math.round(clamp(wl.getProperty("Order"), -100, 100, 1));
      if (o2 < order) rank += 1;
    }
  } catch (_) {

  }
  return rank;
}

function placementKey(entries, puffiness, order, rank, bind, cageId, source, importedVc) {
  const bits = [
    cageId,
    source,
    String(importedVc),
    puffiness.toFixed(3),
    String(order),
    String(rank),
    bind.x.toFixed(2),
    bind.y.toFixed(2),
    bind.z.toFixed(2),
  ];
  for (const e of entries) {
    bits.push(
      e.part.name,
      e.pos.x.toFixed(2),
      e.pos.y.toFixed(2),
      e.pos.z.toFixed(2),
      e.size.x.toFixed(2),
      e.size.y.toFixed(2),
      e.size.z.toFixed(2),
      e.yaw.toFixed(1),
      e.clip ? e.clip[0].toFixed(2) + ":" + e.clip[1].toFixed(2) : "full",
      e.stiffness.toFixed(3),
    );
  }
  return bits.join("|");
}

function pieceBounds(e, bind) {
  const hx = e.size.x / 2 + e.thickness;
  const hz = e.size.z / 2 + e.thickness;
  const { y0, y1 } = clipY(e);
  const yy0 = y0 - e.thickness;
  const yy1 = y1 + e.thickness;
  let minX = Infinity;
  let minYv = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxYv = -Infinity;
  let maxZ = -Infinity;
  for (const sx of [-1, 1]) {
    for (const sz of [-1, 1]) {
      for (const yy of [yy0, yy1]) {
        const w = rotYv({ x: sx * hx, y: yy, z: sz * hz }, e.yaw);
        if (w.x < minX) minX = w.x;
        if (w.x > maxX) maxX = w.x;
        if (w.y < minYv) minYv = w.y;
        if (w.y > maxYv) maxYv = w.y;
        if (w.z < minZ) minZ = w.z;
        if (w.z > maxZ) maxZ = w.z;
      }
    }
  }
  return {
    part: e.part.name,
    clip: e.clip ? [e.clip[0], e.clip[1]] : null,
    yaw: e.yaw,
    thickness: e.thickness,
    center: {
      x: e.pos.x + (minX + maxX) / 2 + bind.x,
      y: e.pos.y + (minYv + maxYv) / 2 + bind.y,
      z: e.pos.z + (minZ + maxZ) / 2 + bind.z,
    },
    size: { x: maxX - minX, y: maxYv - minYv, z: maxZ - minZ },
  };
}

function buildWrapPlacementInner(char, wrapLayer, type, prevCache) {
  if (!live(char) || !live(wrapLayer)) return null;
  const cageId = String(wrapLayer.getProperty("CageMeshId") || "").trim();
  if (!cageId) return null;
  const entries = findRegionEntries(char, type);
  if (entries.length === 0) return null;

  const puffiness = clamp(wrapLayer.getProperty("Puffiness"), 0, 10, 1);
  const order = Math.round(clamp(wrapLayer.getProperty("Order"), -100, 100, 1));
  const bind = vec(wrapLayer, "BindOffset");
  const rank = layerRankFor(char, wrapLayer, order);

  let stiffSum = 0;
  for (const e of entries) {
    e.stiffness = partStiffness(e.part);
    e.thickness = clamp(
      BASE_THICKNESS * puffiness * (1.25 - 0.5 * e.stiffness) + LAYER_LIFT * rank,
      MIN_THICKNESS,
      MAX_THICKNESS,
      MIN_THICKNESS,
    );
    stiffSum += e.stiffness;
  }
  const stiffness = stiffSum / entries.length;

  const imp = importedCageFor(cageId);
  const key = placementKey(
    entries,
    puffiness,
    order,
    rank,
    bind,
    cageId,
    imp ? "imported" : "procedural",
    imp ? imp.vertexCount : 0,
  );
  if (prevCache && prevCache.key === key) return prevCache;      

  const cage = imp ? deformImportedCage(imp, entries, bind) : buildProceduralCage(entries, bind);
  if (!cage || cage.vertexCount === 0) return null;


  const P = cage.positions;
  let minX = Infinity;
  let minYv = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxYv = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i < P.length; i += 3) {
    if (P[i] < minX) minX = P[i];
    if (P[i] > maxX) maxX = P[i];
    if (P[i + 1] < minYv) minYv = P[i + 1];
    if (P[i + 1] > maxYv) maxYv = P[i + 1];
    if (P[i + 2] < minZ) minZ = P[i + 2];
    if (P[i + 2] > maxZ) maxZ = P[i + 2];
  }
  const center = { x: (minX + maxX) / 2, y: (minYv + maxYv) / 2, z: (minZ + maxZ) / 2 };
  const size = {
    x: Math.max(0.05, maxX - minX),
    y: Math.max(0.05, maxYv - minYv),
    z: Math.max(0.05, maxZ - minZ),
  };

  const parts = [];
  for (const e of entries) {
    if (!parts.includes(e.part.name)) parts.push(e.part.name);
  }
  const pad = entries.reduce((s, e) => s + e.thickness, 0) / entries.length;
  const pieces = entries.map((e) => pieceBounds(e, bind));

  return { key, center, size, order, puffiness, stiffness, pad, rank, parts, pieces, cage };
}


export function buildWrapPlacement(char, wrapLayer, type, prevCache) {
  try {
    return buildWrapPlacementInner(char, wrapLayer, type, prevCache);
  } catch (_) {
    return null;
  }
}
