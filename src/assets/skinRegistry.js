import { sanitizeQuat, isIdentityQuat, BONE_QUAT_EPS } from "../animation/boneCFrame.js";


import { buildMeshCollision, normalizeSoup } from "../physics/collisionGeometry.js";

export const MAX_SKIN_BONES = 256;
export const MAX_INFLUENCES = 4;
export const TRANSFORM_LIMIT = 1e6;

const registry = new Map();

function num(v) {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}

export function clampFinite(v, limit = TRANSFORM_LIMIT) {
  const n = Number(v);
  if (!Number.isFinite(n)) return 0;
  if (n > limit) return limit;
  if (n < -limit) return -limit;
  return n;
}

export function isFiniteVec(v) {
  return Boolean(
    v &&
      typeof v === "object" &&
      Number.isFinite(Number(v.x)) &&
      Number.isFinite(Number(v.y)) &&
      Number.isFinite(Number(v.z)),
  );
}


export function sanitizeBoneTransform(v) {
  const src = v && typeof v === "object" ? v : {};
  const q = sanitizeQuat(src);
  return {
    x: clampFinite(src.x),
    y: clampFinite(src.y),
    z: clampFinite(src.z),
    qx: q.qx,
    qy: q.qy,
    qz: q.qz,
    qw: q.qw,
  };
}


export function boneTransformQuat(v) {
  return sanitizeQuat(v);
}


export function hasBoneRotation(v, eps = BONE_QUAT_EPS) {
  return !isIdentityQuat(boneTransformQuat(v), eps);
}

function sanitizeVec(v) {
  const src = v && typeof v === "object" ? v : {};
  return { x: num(src.x), y: num(src.y), z: num(src.z) };
}


function sanitizeSize(v) {
  const src = sanitizeVec(v);
  return {
    x: Math.max(1e-3, Math.abs(src.x)),
    y: Math.max(1e-3, Math.abs(src.y)),
    z: Math.max(1e-3, Math.abs(src.z)),
  };
}


export function normalizeSkinWeights(weights) {
  const src = Array.from(weights || [], num);
  const out = new Array(src.length).fill(0);
  for (let base = 0; base + 3 < src.length; base += 4) {
    let sum = 0;
    for (let k = 0; k < 4; k += 1) {
      const w = src[base + k];
      out[base + k] = w > 0 ? w : 0;
      sum += out[base + k];
    }
    if (sum <= 1e-6) {
      out[base] = 1;
      out[base + 1] = 0;
      out[base + 2] = 0;
      out[base + 3] = 0;
    } else if (Math.abs(sum - 1) > 1e-6) {
      for (let k = 0; k < 4; k += 1) out[base + k] /= sum;
    }
  }
  return out;
}


export function sanitizeJoints(joints) {
  const src = Array.isArray(joints) ? joints.slice(0, MAX_SKIN_BONES) : [];
  const out = [];
  for (let i = 0; i < src.length; i += 1) {
    const j = src[i] || {};
    let parent = Math.floor(num(j.parent));
    if (!(parent >= 0 && parent < i)) parent = -1;
    const name = typeof j.name === "string" && j.name.trim() ? j.name.trim() : `Bone${i}`;
    out.push({ name, parent, pos: sanitizeVec(j.pos), rot: sanitizeVec(j.rot) });
  }
  return out;
}


function computeSmoothNormals(positions, indices) {
  const out = new Array(positions.length).fill(0);
  for (let i = 0; i + 2 < indices.length; i += 3) {
    const a = indices[i] * 3;
    const b = indices[i + 1] * 3;
    const c = indices[i + 2] * 3;
    const ux = positions[b] - positions[a];
    const uy = positions[b + 1] - positions[a + 1];
    const uz = positions[b + 2] - positions[a + 2];
    const vx = positions[c] - positions[a];
    const vy = positions[c + 1] - positions[a + 1];
    const vz = positions[c + 2] - positions[a + 2];
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    out[a] += nx; out[a + 1] += ny; out[a + 2] += nz;
    out[b] += nx; out[b + 1] += ny; out[b + 2] += nz;
    out[c] += nx; out[c + 1] += ny; out[c + 2] += nz;
  }
  for (let i = 0; i < out.length; i += 3) {
    const len = Math.sqrt(out[i] * out[i] + out[i + 1] * out[i + 1] + out[i + 2] * out[i + 2]);
    if (len > 1e-12) {
      out[i] /= len;
      out[i + 1] /= len;
      out[i + 2] /= len;
    } else {

      out[i] = 0;
      out[i + 1] = 1;
      out[i + 2] = 0;
    }
  }
  return out;
}

function computeBounds(positions) {
  if (!positions.length) {
    return { size: { x: 1, y: 1, z: 1 }, center: { x: 0, y: 0, z: 0 } };
  }
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;
  for (let i = 0; i + 2 < positions.length; i += 3) {
    const x = positions[i];
    const y = positions[i + 1];
    const z = positions[i + 2];
    if (x < minX) minX = x;
    if (y < minY) minY = y;
    if (z < minZ) minZ = z;
    if (x > maxX) maxX = x;
    if (y > maxY) maxY = y;
    if (z > maxZ) maxZ = z;
  }
  return {
    size: {
      x: Math.max(1e-3, maxX - minX),
      y: Math.max(1e-3, maxY - minY),
      z: Math.max(1e-3, maxZ - minZ),
    },
    center: { x: (minX + maxX) / 2, y: (minY + maxY) / 2, z: (minZ + maxZ) / 2 },
  };
}


export function registerSkin(meshId, data) {
  if (!meshId || !data || typeof data !== "object") return null;
  const joints = sanitizeJoints(data.joints);
  const boneCount = joints.length;
  if (!boneCount) return null;
  const positions = Array.from(data.positions || [], num);
  const vertexCount = Math.floor(positions.length / 3);
  if (!vertexCount) return null;
  positions.length = vertexCount * 3;

  let normals = Array.from(data.normals || [], num);
  let uvs = Array.from(data.uvs || [], num);


  if (uvs.length !== vertexCount * 2) {
    const fixedUvs = new Array(vertexCount * 2).fill(0);
    const keepUvs = Math.min(uvs.length, fixedUvs.length);
    for (let i = 0; i < keepUvs; i += 1) fixedUvs[i] = uvs[i];
    uvs = fixedUvs;
  }


  const rawTri = Array.from(data.indices || [], (v) => {
    const n = Number(v);


    return Number.isFinite(n) ? Math.floor(n) : -1;
  });
  const indices = [];
  const lastTri = Math.floor(rawTri.length / 3) * 3;
  for (let t = 0; t < lastTri; t += 3) {
    const a = rawTri[t];
    const b = rawTri[t + 1];
    const c = rawTri[t + 2];
    if (a >= 0 && a < vertexCount && b >= 0 && b < vertexCount && c >= 0 && c < vertexCount) {
      indices.push(a, b, c);
    }
  }


  if (normals.length !== positions.length) {
    const prevLen = Math.min(normals.length, positions.length);
    normals.length = positions.length;
    for (let i = prevLen; i < positions.length; i += 1) normals[i] = 0;
  }
  {
    let computed = null;
    for (let i = 0; i < normals.length; i += 3) {
      if (normals[i] === 0 && normals[i + 1] === 0 && normals[i + 2] === 0) {
        if (!computed) computed = computeSmoothNormals(positions, indices);
        normals[i] = computed[i];
        normals[i + 1] = computed[i + 1];
        normals[i + 2] = computed[i + 2];
      }
    }
  }

  const skinIndex = new Array(vertexCount * 4).fill(0);
  const rawIdx = Array.from(data.skinIndex || [], num);
  for (let i = 0; i < skinIndex.length; i += 1) {
    const v = Math.floor(rawIdx[i] || 0);
    skinIndex[i] = v >= 0 && v < boneCount ? v : 0;
  }
  const rawW = Array.from(data.skinWeight || [], num);
  rawW.length = vertexCount * 4;
  for (let i = 0; i < rawW.length; i += 1) if (!Number.isFinite(rawW[i])) rawW[i] = 0;
  const skinWeight = normalizeSkinWeights(rawW);

  const bounds = computeBounds(positions);
  const skin = {
    meshId: String(meshId),
    joints,
    boneCount,
    vertexCount,
    positions,
    normals,
    uvs,
    indices,
    skinIndex,
    skinWeight,
    size: data.size && isFiniteVec(data.size) ? sanitizeSize(data.size) : bounds.size,
    center: data.center && isFiniteVec(data.center) ? sanitizeVec(data.center) : bounds.center,
    triangles: Math.floor(indices.length / 3),
  };
  registry.set(skin.meshId, skin);
  return skin;
}


export function buildSkinCollision(skin) {
  if (!skin || typeof skin !== "object") return null;
  if (skin.__collision !== undefined) return skin.__collision;
  let collision = null;
  try {
    const pos = skin.positions || [];
    const idx = Array.isArray(skin.indices) && skin.indices.length >= 3 ? skin.indices : null;
    const soup = [];
    if (idx) {
      const last = Math.floor(idx.length / 3) * 3;
      for (let t = 0; t < last; t += 1) {
        const base = idx[t] * 3;
        soup.push(pos[base], pos[base + 1], pos[base + 2]);
      }
    } else {
      const last = Math.floor(pos.length / 9) * 9;
      for (let i = 0; i < last; i += 1) soup.push(pos[i]);
    }
    if (soup.length >= 9) {
      const size = skin.size || { x: 1, y: 1, z: 1 };
      const maxDim = Math.max(size.x, size.y, size.z, 1e-3);
      const center = skin.center || { x: 0, y: 0, z: 0 };
      const norm = normalizeSoup(soup, center, maxDim);
      collision = norm ? buildMeshCollision(norm) : null;
    }
  } catch (_) {
    collision = null;                                                     
  }
  skin.__collision = collision;
  return collision;
}

export function getSkin(meshId) {
  if (!meshId) return null;
  return registry.get(String(meshId)) || null;
}

export function hasSkin(meshId) {
  return Boolean(getSkin(meshId));
}

export function unregisterSkin(meshId) {
  if (meshId) registry.delete(String(meshId));
}

export function clearSkins() {
  registry.clear();
}
