import { MAX_SKIN_BONES, sanitizeJoints } from "./skinRegistry.js";
import { createInstance, makeVector3 } from "../datamodel/index.js";

export function buildSimulatedSkinnedMesh(opts = {}) {
  const radius = Number(opts.radius) > 0 ? Number(opts.radius) : 0.35;
  const height = Number(opts.height) > 0 ? Number(opts.height) : 2;
  const radial = 10;
  const rings = 8;
  let boneCount = Math.floor(Number(opts.bones) || 3);
  if (!(boneCount >= 2)) boneCount = 3;
  if (boneCount > 5) boneCount = 5;

  const joints = [];
  const step = height / (boneCount - 1);
  for (let i = 0; i < boneCount; i += 1) {
    let name = "Root";
    if (i === boneCount - 1) name = "Tip";
    else if (i > 0) name = `Spine${i}`;
    joints.push({
      name,
      parent: i - 1,
      pos: i === 0 ? { x: 0, y: -height / 2, z: 0 } : { x: 0, y: step, z: 0 },
      rot: { x: 0, y: 0, z: 0 },
    });
  }

  const positions = [];
  const normals = [];
  const uvs = [];
  const skinIndex = [];
  const skinWeight = [];
  const indices = [];

  const pushSkin = (y) => {
    const t = ((y + height / 2) / height) * (boneCount - 1);
    let i0 = Math.floor(t);
    if (i0 < 0) i0 = 0;
    if (i0 > boneCount - 2) i0 = boneCount - 2;
    const frac = Math.min(1, Math.max(0, t - i0));
    skinIndex.push(i0, i0 + 1, 0, 0);
    skinWeight.push(1 - frac, frac, 0, 0);
  };

  for (let r = 0; r <= rings; r += 1) {
    const t = r / rings;
    const y = -height / 2 + height * t;
    const bulge = 1 + 0.25 * Math.sin(t * Math.PI);


    const dRdy = (radius * 0.25 * Math.PI * Math.cos(t * Math.PI)) / height;
    const inv = 1 / Math.sqrt(1 + dRdy * dRdy);
    for (let s = 0; s <= radial; s += 1) {
      const a = (s / radial) * Math.PI * 2;
      const nx = Math.cos(a);
      const nz = Math.sin(a);
      positions.push(nx * radius * bulge, y, nz * radius * bulge);
      normals.push(nx * inv, -dRdy * inv, nz * inv);
      uvs.push(s / radial, t);
      pushSkin(y);
    }
  }
  const ringStride = radial + 1;
  for (let r = 0; r < rings; r += 1) {
    for (let s = 0; s < radial; s += 1) {
      const a = r * ringStride + s;
      const b = a + 1;
      const c = a + ringStride;
      const d = c + 1;
      indices.push(a, c, b, b, c, d);
    }
  }

  const capBottom = positions.length / 3;
  positions.push(0, -height / 2, 0);
  normals.push(0, -1, 0);
  uvs.push(0.5, 0);
  pushSkin(-height / 2);
  const capTop = positions.length / 3;
  positions.push(0, height / 2, 0);
  normals.push(0, 1, 0);
  uvs.push(0.5, 1);
  pushSkin(height / 2);


  for (let s = 0; s < radial; s += 1) {
    indices.push(capBottom, s, s + 1);
    const top = rings * ringStride;
    indices.push(capTop, top + s + 1, top + s);
  }

  const maxR = radius * 1.25;
  return {
    joints,
    positions,
    normals,
    uvs,
    indices,
    skinIndex,
    skinWeight,
    size: { x: maxR * 2, y: height, z: maxR * 2 },
    center: { x: 0, y: 0, z: 0 },
  };
}

export function hasBoneDescendant(inst) {
  if (!inst || typeof inst.getDescendants !== "function") return false;
  try {
    for (const d of inst.getDescendants()) {
      if (d && d.className === "Bone") return true;
    }
  } catch (_) {
    return false;
  }
  return false;
}


export function createBoneTree(hostInst, joints) {
  if (!hostInst || typeof hostInst.getDescendants !== "function") return [];
  if (hasBoneDescendant(hostInst)) return [];
  const clean = sanitizeJoints(joints);
  const made = [];
  for (let i = 0; i < clean.length && i < MAX_SKIN_BONES; i += 1) {
    const j = clean[i];
    let bone = null;
    try {
      bone = createInstance("Bone", { name: j.name });
      if (bone) {
        bone.setProperty("Position", makeVector3(j.pos.x, j.pos.y, j.pos.z));
        bone.setProperty("Orientation", makeVector3(j.rot.x, j.rot.y, j.rot.z));
        const parent = j.parent >= 0 && made[j.parent] ? made[j.parent] : hostInst;
        bone.setParent(parent);
      }
    } catch (_) {
      bone = null;
    }
    made.push(bone);
  }
  return made.filter(Boolean);
}
