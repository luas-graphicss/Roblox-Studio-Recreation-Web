import {
  SOLID_LIMITS,
  CSG_MESHDATA_TOLERANCE,
  decodeCsgMeshData,
  decodeCsgPhysicsData,
  meshBboxCompatibleWithPhysics,
} from "./rbxSolidMesh.js";

export const CSG_MESHDATA_VERSION = "csg-meshdata-1";
export { CSG_MESHDATA_TOLERANCE };

function pushWarn(warnings, msg) {
  try {
    if (Array.isArray(warnings)) warnings.push(msg);
  } catch (_) {                   }
}

function isFiniteVec(v) {
  return !!v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
}


export function bboxOfTriangleSoup(positions) {
  try {
    if (!Array.isArray(positions) || positions.length < 9 || positions.length % 3 !== 0) return null;
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    for (let i = 0; i < positions.length; i += 3) {
      const x = positions[i];
      const y = positions[i + 1];
      const z = positions[i + 2];
      if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
      if (z < minZ) minZ = z;
      if (z > maxZ) maxZ = z;
    }
    return { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
  } catch (_) {
    return null;
  }
}


function hullProblem(hull) {
  if (!hull || typeof hull !== "object") return "inválido (não é objeto)";
  const verts = hull.vertices;
  const faces = hull.faces;
  if (!Array.isArray(verts) || verts.length < 4) return "com menos de 4 vértices";
  if (verts.length > SOLID_LIMITS.maxHullVertices) return "com vértices acima de SOLID_LIMITS.maxHullVertices";
  if (!Array.isArray(faces) || faces.length < 1) return "sem faces";
  const seen = new Set();
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const v of verts) {
    if (!isFiniteVec(v)) return "com vértice não-finito";
    if (seen.size < 4) seen.add(v.x + "," + v.y + "," + v.z);
    if (v.x < minX) minX = v.x;
    if (v.x > maxX) maxX = v.x;
    if (v.y < minY) minY = v.y;
    if (v.y > maxY) maxY = v.y;
    if (v.z < minZ) minZ = v.z;
    if (v.z > maxZ) maxZ = v.z;
  }
  if (seen.size < 4) return "com menos de 4 vértices únicos (degenerado)";
  if (!(maxX - minX > 0) && !(maxY - minY > 0) && !(maxZ - minZ > 0)) return "com extensão ~zero (degenerado)";
  for (const f of faces) {
    if (!Array.isArray(f) || f.length !== 3) return "com face não-triangular";
    const a = f[0], b = f[1], c = f[2];
    if (!Number.isInteger(a) || !Number.isInteger(b) || !Number.isInteger(c)) return "com índice de face não-inteiro";
    if (a < 0 || b < 0 || c < 0 || a >= verts.length || b >= verts.length || c >= verts.length) {
      return "com índice de face fora do range";
    }
  }
  return null;
}







export function buildMeshFromHulls(hulls, warnings) {
  const result = { ok: false, positions: [], normals: [], bbox: null, vertexCount: 0, triCount: 0, hullCount: 0 };
  try {
    if (!Array.isArray(hulls) || hulls.length === 0) {
      pushWarn(warnings, "Malha dos hulls: nenhum hull disponível no PhysicsData.");
      return result;
    }
    const maxHulls = SOLID_LIMITS.maxHulls;
    const maxTris = SOLID_LIMITS.maxTriangles;
    if (hulls.length > maxHulls) {
      pushWarn(warnings, "Malha dos hulls: " + hulls.length + " hulls excedem SOLID_LIMITS.maxHulls (" + maxHulls + ") — excedentes descartados.");
    }
    const positions = [];
    const normals = [];
    let minX = Infinity, minY = Infinity, minZ = Infinity;
    let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
    let tris = 0;
    let used = 0;
    let capped = false;
    for (let h = 0; h < hulls.length && h < maxHulls && !capped; h++) {
      const hull = hulls[h];
      const problem = hullProblem(hull);
      if (problem) {
        pushWarn(warnings, "Malha dos hulls: hull #" + h + " " + problem + " — hull descartado.");
        continue;
      }
      const verts = hull.vertices;
      let contributed = false;
      for (const f of hull.faces) {
        if (tris >= maxTris) {
          pushWarn(warnings, "Malha dos hulls: limite de SOLID_LIMITS.maxTriangles (" + maxTris + ") atingido — triângulos excedentes descartados.");
          capped = true;
          break;
        }
        const a = verts[f[0]];
        const b = verts[f[1]];
        const c = verts[f[2]];
        const ux = b.x - a.x, uy = b.y - a.y, uz = b.z - a.z;
        const vx = c.x - a.x, vy = c.y - a.y, vz = c.z - a.z;
        let nx = uy * vz - uz * vy;
        let ny = uz * vx - ux * vz;
        let nz = ux * vy - uy * vx;
        const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
        if (len > 1e-12) {
          nx /= len; ny /= len; nz /= len;
        } else {
          nx = 0; ny = 1; nz = 0;
        }
        positions.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
        normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz);
        if (a.x < minX) minX = a.x;
        if (a.x > maxX) maxX = a.x;
        if (a.y < minY) minY = a.y;
        if (a.y > maxY) maxY = a.y;
        if (a.z < minZ) minZ = a.z;
        if (a.z > maxZ) maxZ = a.z;
        if (b.x < minX) minX = b.x;
        if (b.x > maxX) maxX = b.x;
        if (b.y < minY) minY = b.y;
        if (b.y > maxY) maxY = b.y;
        if (b.z < minZ) minZ = b.z;
        if (b.z > maxZ) maxZ = b.z;
        if (c.x < minX) minX = c.x;
        if (c.x > maxX) maxX = c.x;
        if (c.y < minY) minY = c.y;
        if (c.y > maxY) maxY = c.y;
        if (c.z < minZ) minZ = c.z;
        if (c.z > maxZ) maxZ = c.z;
        tris += 1;
        contributed = true;
      }
      if (contributed) used += 1;
    }
    if (tris === 0) {
      pushWarn(warnings, "Malha dos hulls: nenhum hull utilizável — sem malha.");
      return result;
    }
    result.ok = true;
    result.positions = positions;
    result.normals = normals;
    result.bbox = { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
    result.vertexCount = tris * 3;
    result.triCount = tris;
    result.hullCount = used;
    return result;
  } catch (_) {
    return { ok: false, positions: [], normals: [], bbox: null, vertexCount: 0, triCount: 0, hullCount: 0 };
  }
}


export function decodeCsgSolidPair(meshBytes, physBytes, warnings) {
  const out = {
    ok: false,
    used: null,
    format: null,
    positions: [],
    colors: null,
    normals: null,
    bbox: null,
    vertexCount: 0,
    triCount: 0,
    hulls: [],
    volume: null,
    cog: null,
    boxOnly: false,
  };
  try {
    let phys = null;
    if (physBytes != null) {
      const p = decodeCsgPhysicsData(physBytes, warnings);
      if (p && p.ok) {
        phys = p;
        out.hulls = Array.isArray(p.hulls) ? p.hulls : [];
        out.volume = Number.isFinite(p.volume) ? p.volume : null;
        out.cog = p.cog || null;

        out.boxOnly = !Array.isArray(p.hulls) || p.hulls.length === 0;
      }
    }
    if (meshBytes != null) {
      const hint = phys
        ? { volume: phys.volume, cog: phys.cog, hulls: Array.isArray(phys.hulls) && phys.hulls.length > 0 ? phys.hulls : null }
        : null;
      const m = decodeCsgMeshData(meshBytes, warnings, hint);
      if (m && m.ok && Array.isArray(m.positions) && m.positions.length >= 9) {
        out.ok = true;
        out.used = "meshData";
        out.format = m.format;
        out.positions = m.positions;
        out.colors = Array.isArray(m.colors) && m.colors.length > 0 ? m.colors : null;
        out.bbox = m.bbox || bboxOfTriangleSoup(m.positions);
        out.vertexCount = m.vertexCount;
        out.triCount = m.triCount;
        return out;
      }
    }
    if (phys && Array.isArray(phys.hulls) && phys.hulls.length > 0) {
      const built = buildMeshFromHulls(phys.hulls, warnings);
      if (built.ok) {
        out.ok = true;
        out.used = "hulls";
        out.format = phys.format || null;
        out.positions = built.positions;
        out.normals = built.normals;
        out.bbox = built.bbox;
        out.vertexCount = built.vertexCount;
        out.triCount = built.triCount;
        pushWarn(warnings, "União importada reconstruída pelos hulls do PhysicsData (" + built.hullCount + " hull(s), " + built.triCount + " triângulo(s)).");
        return out;
      }
    }
    return out;
  } catch (_) {
    return out;
  }
}


export function refineImportedSolid(record, importedSolid) {
  try {
    if (!record || typeof record !== "object") return null;
    const positions = Array.isArray(record.positions) ? record.positions : null;
    if (!positions || positions.length < 9 || positions.length % 9 !== 0) return null;
    const hulls =
      importedSolid && Array.isArray(importedSolid.hulls) && importedSolid.hulls.length > 0
        ? importedSolid.hulls
        : null;
    const rebuildFromHulls = () => {
      if (!hulls) return null;
      const built = buildMeshFromHulls(hulls, null);
      if (!built.ok) return null;
      return {
        ...record,
        source: "hulls",
        positions: built.positions,
        colors: null,
        triCount: built.triCount,
        bbox: built.bbox,
        meshDataDowngraded: record.source === "meshData",
      };
    };
    const bbox = bboxOfTriangleSoup(positions);
    if (!bbox) {


      return rebuildFromHulls();
    }
    if (record.source === "meshData" && hulls) {
      const compat = meshBboxCompatibleWithPhysics(bbox, { hulls });
      if (!compat.ok) return rebuildFromHulls();
    }
    return { ...record, bbox };
  } catch (_) {
    return null;
  }
}
