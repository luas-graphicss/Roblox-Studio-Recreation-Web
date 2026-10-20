import { tryDecompressCsgBody } from "./rbxCsgDecompress.js";

export const SOLID_LIMITS = {
  maxBlobBytes: 4 * 1024 * 1024,
  maxVertices: 300000,
  maxTriangles: 200000,
  maxHulls: 512,
  maxHullVertices: 4096,
};

function warn(warnings, msg) {
  try {
    if (Array.isArray(warnings)) warnings.push(String(msg));
  } catch (_) {                   }
}


function asBytes(input) {
  try {
    if (input instanceof Uint8Array) return input;
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input) && input.buffer instanceof ArrayBuffer) {
      return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
    }
    if (Array.isArray(input) && input.length <= SOLID_LIMITS.maxBlobBytes) {
      const u8 = new Uint8Array(input.length);
      for (let i = 0; i < input.length; i++) {
        const v = input[i];
        u8[i] = typeof v === "number" && Number.isFinite(v) ? v & 0xff : 0;
      }
      return u8;
    }
  } catch (_) {                     }
  return null;
}


function ascii(u8, off, len) {
  if (off < 0 || len < 0 || off + len > u8.byteLength) return null;
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCharCode(u8[off + i]);
  return s;
}


function openBlob(input, warnings, label) {
  const u8 = asBytes(input);
  if (!u8) {
    warn(warnings, label + ": entrada inválida — esperado Uint8Array (blob binário).");
    return null;
  }
  if (u8.byteLength === 0) {
    warn(warnings, label + ": blob vazio.");
    return null;
  }
  if (u8.byteLength > SOLID_LIMITS.maxBlobBytes) {
    warn(warnings, label + ": blob com " + u8.byteLength + " bytes excede o limite de " + SOLID_LIMITS.maxBlobBytes + " bytes — ignorado.");
    return null;
  }
  return u8;
}


export const CSG_MESHDATA_TOLERANCE = {
  bboxRel: 0.25,
  cogSlackRel: 0.15,
  volumeSlack: 0.05,
  minExtent: 1e-6,

  maxAbsCoord: 1e6,                                                            
  normalUnitTol: 0.15,                                                         
  colorAlphaMinRatio: 0.9,                                               
};


export function meshBboxCompatibleWithPhysics(bbox, phys) {
  try {
    if (!bbox || !bbox.min || !bbox.max) return { ok: false, reason: "bbox ausente" };
    if (!phys || typeof phys !== "object") return { ok: true, reason: null };
    const dx = bbox.max.x - bbox.min.x;
    const dy = bbox.max.y - bbox.min.y;
    const dz = bbox.max.z - bbox.min.z;
    const diag = Math.sqrt(dx * dx + dy * dy + dz * dz);
    const hulls = Array.isArray(phys.hulls) && phys.hulls.length > 0 ? phys.hulls : null;
    if (hulls) {
      let minX = Infinity, minY = Infinity, minZ = Infinity;
      let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
      let any = false;
      for (const hull of hulls) {
        const verts = hull && Array.isArray(hull.vertices) ? hull.vertices : null;
        if (!verts) continue;
        for (const v of verts) {
          if (!v || !Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) continue;
          any = true;
          if (v.x < minX) minX = v.x;
          if (v.x > maxX) maxX = v.x;
          if (v.y < minY) minY = v.y;
          if (v.y > maxY) maxY = v.y;
          if (v.z < minZ) minZ = v.z;
          if (v.z > maxZ) maxZ = v.z;
        }
      }
      if (any) {
        const hdx = maxX - minX, hdy = maxY - minY, hdz = maxZ - minZ;
        const hdiag = Math.sqrt(hdx * hdx + hdy * hdy + hdz * hdz);
        const tol = CSG_MESHDATA_TOLERANCE.bboxRel * Math.max(1, diag, hdiag);
        if (
          Math.abs(bbox.min.x - minX) > tol || Math.abs(bbox.max.x - maxX) > tol ||
          Math.abs(bbox.min.y - minY) > tol || Math.abs(bbox.max.y - maxY) > tol ||
          Math.abs(bbox.min.z - minZ) > tol || Math.abs(bbox.max.z - maxZ) > tol
        ) {
          return { ok: false, reason: "bbox da malha incompatível com a bbox dos hulls do PhysicsData" };
        }
      }
    }
    const cog = phys.cog;
    if (cog && Number.isFinite(cog.x) && Number.isFinite(cog.y) && Number.isFinite(cog.z)) {
      const slack = CSG_MESHDATA_TOLERANCE.cogSlackRel * Math.max(1, diag);
      if (
        cog.x < bbox.min.x - slack || cog.x > bbox.max.x + slack ||
        cog.y < bbox.min.y - slack || cog.y > bbox.max.y + slack ||
        cog.z < bbox.min.z - slack || cog.z > bbox.max.z + slack
      ) {
        return { ok: false, reason: "cog do PhysicsData fora da bbox da malha" };
      }
    }
    const volume = phys.volume;
    if (Number.isFinite(volume) && volume > 0) {
      const boxVolume = dx * dy * dz;
      if (volume > boxVolume * (1 + CSG_MESHDATA_TOLERANCE.volumeSlack)) {
        return { ok: false, reason: "volume do PhysicsData excede o volume da bbox da malha" };
      }
    }
    return { ok: true, reason: null };
  } catch (_) {
    return { ok: false, reason: "erro interno na comparação com o PhysicsData" };
  }
}


function tryCsgmdlLayoutAt(dv, size, start, phys) {
  const rejected = (reason) => ({ ok: false, reason });
  if (start + 8 > size) return rejected("blob menor que o cabeçalho candidato");
  const vertexCount = dv.getUint32(start, true);
  const triCount = dv.getUint32(start + 4, true);
  if (vertexCount < 4) return rejected("vertexCount " + vertexCount + " abaixo do mínimo (4)");
  if (vertexCount > SOLID_LIMITS.maxVertices) return rejected("vertexCount " + vertexCount + " acima de SOLID_LIMITS.maxVertices");
  if (triCount < 2) return rejected("triCount " + triCount + " abaixo do mínimo (2)");
  if (triCount > SOLID_LIMITS.maxTriangles) return rejected("triCount " + triCount + " acima de SOLID_LIMITS.maxTriangles");
  const expected = start + 8 + vertexCount * 12 + triCount * 12;
  if (expected !== size) {
    const delta = size - expected;
    return rejected(
      delta > 0
        ? "blob não consumido inteiro (" + delta + " byte(s) sobrando)"
        : "contagens maiores que o blob (faltam " + (-delta) + " byte(s))",
    );
  }
  const verts = new Array(vertexCount * 3);
  let off = start + 8;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const unique = new Set();
  for (let i = 0; i < vertexCount; i++) {
    const x = dv.getFloat32(off, true);
    const y = dv.getFloat32(off + 4, true);
    const z = dv.getFloat32(off + 8, true);
    off += 12;
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return rejected("coordenada não-finita no vértice #" + i);
    }
    if (Math.abs(x) > CSG_MESHDATA_TOLERANCE.maxAbsCoord || Math.abs(y) > CSG_MESHDATA_TOLERANCE.maxAbsCoord || Math.abs(z) > CSG_MESHDATA_TOLERANCE.maxAbsCoord) {
      return rejected("coordenada além de maxAbsCoord no vértice #" + i);
    }
    verts[i * 3] = x;
    verts[i * 3 + 1] = y;
    verts[i * 3 + 2] = z;
    if (unique.size < 4) unique.add(x + "," + y + "," + z);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  if (unique.size < 4) return rejected("menos de 4 vértices únicos (malha degenerada)");
  if (
    !(maxX - minX >= CSG_MESHDATA_TOLERANCE.minExtent) ||
    !(maxY - minY >= CSG_MESHDATA_TOLERANCE.minExtent) ||
    !(maxZ - minZ >= CSG_MESHDATA_TOLERANCE.minExtent)
  ) {
    return rejected("bbox degenerada (extensão abaixo de minExtent)");
  }
  const bbox = { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } };
  const compat = meshBboxCompatibleWithPhysics(bbox, phys || null);
  if (!compat.ok) return rejected(compat.reason);
  const positions = new Array(triCount * 9);
  let p = 0;
  for (let t = 0; t < triCount; t++) {
    const a = dv.getUint32(off, true);
    const b = dv.getUint32(off + 4, true);
    const c = dv.getUint32(off + 8, true);
    off += 12;
    if (a >= vertexCount || b >= vertexCount || c >= vertexCount) {
      return rejected("índice de triângulo fora do range no triângulo #" + t);
    }
    positions[p++] = verts[a * 3];
    positions[p++] = verts[a * 3 + 1];
    positions[p++] = verts[a * 3 + 2];
    positions[p++] = verts[b * 3];
    positions[p++] = verts[b * 3 + 1];
    positions[p++] = verts[b * 3 + 2];
    positions[p++] = verts[c * 3];
    positions[p++] = verts[c * 3 + 1];
    positions[p++] = verts[c * 3 + 2];
  }
  return { ok: true, reason: null, positions, vertexCount, triCount, bbox };
}


export const CSG_MESHDATA_LAYOUTS = Object.freeze({
  version: "csg-meshdata-2",
  families: Object.freeze(["packed", "planar", "interleaved"]),
  headerSkips: Object.freeze([0, 4, 8, 12, 16]),
  planarPlans: Object.freeze(["n+uv", "n+uv+rgba8", "n", "n+uv+tan16", "pos"]),
  interleavedStrides: Object.freeze([24, 28, 32, 36, 40, 44, 48, 56, 64, 16, 20]),
  maxFullValidations: 8,
});


const PLANAR_PLANS = Object.freeze([
  Object.freeze({ name: "n+uv", extra: 20, normals: true, uv: true, rgba: false, tan16: false }),
  Object.freeze({ name: "n+uv+rgba8", extra: 24, normals: true, uv: true, rgba: true, tan16: false }),
  Object.freeze({ name: "n", extra: 12, normals: true, uv: false, rgba: false, tan16: false }),
  Object.freeze({ name: "n+uv+tan16", extra: 36, normals: true, uv: true, rgba: false, tan16: true }),
  Object.freeze({ name: "pos", extra: 0, normals: false, uv: false, rgba: false, tan16: false }),
]);


function hasPhysEvidence(phys) {
  if (!phys || typeof phys !== "object") return false;
  if (Array.isArray(phys.hulls) && phys.hulls.length > 0) return true;
  if (phys.cog && Number.isFinite(phys.cog.x) && Number.isFinite(phys.cog.y) && Number.isFinite(phys.cog.z)) return true;
  return Number.isFinite(phys.volume) && phys.volume > 0;
}


function sampledUnitVectors(dv, firstOff, count, stride) {
  const tol = CSG_MESHDATA_TOLERANCE.normalUnitTol;
  const step = Math.max(1, Math.floor(count / Math.min(64, count)));
  for (let i = 0; i < count; i += step) {
    const off = firstOff + i * stride;
    const x = dv.getFloat32(off, true);
    const y = dv.getFloat32(off + 4, true);
    const z = dv.getFloat32(off + 8, true);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return false;
    const len = Math.sqrt(x * x + y * y + z * z);
    if (!(Math.abs(len - 1) <= tol)) return false;
  }
  return true;
}


function sampledTangents(dv, firstOff, count, stride) {
  const tol = CSG_MESHDATA_TOLERANCE.normalUnitTol;
  const step = Math.max(1, Math.floor(count / Math.min(64, count)));
  for (let i = 0; i < count; i += step) {
    const off = firstOff + i * stride;
    const x = dv.getFloat32(off, true);
    const y = dv.getFloat32(off + 4, true);
    const z = dv.getFloat32(off + 8, true);
    const w = dv.getFloat32(off + 12, true);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z) || !Number.isFinite(w)) return false;
    const len = Math.sqrt(x * x + y * y + z * z);
    if (!(Math.abs(len - 1) <= tol)) return false;
    if (!(Math.abs(Math.abs(w) - 1) <= 0.01)) return false;
  }
  return true;
}


function sampledFinite(dv, firstOff, count, stride, comps) {
  const step = Math.max(1, Math.floor(count / Math.min(64, count)));
  for (let i = 0; i < count; i += step) {
    for (let c = 0; c < comps; c++) {
      if (!Number.isFinite(dv.getFloat32(firstOff + i * stride + c * 4, true))) return false;
    }
  }
  return true;
}


function plausibleRgbaBlock(u8, off, count) {
  const step = Math.max(1, Math.floor(count / Math.min(64, count)));
  let seen = 0;
  let opaque = 0;
  for (let i = 0; i < count; i += step) {
    seen += 1;
    if (u8[off + i * 4 + 3] === 0xff) opaque += 1;
  }
  return seen > 0 && opaque / seen >= CSG_MESHDATA_TOLERANCE.colorAlphaMinRatio;
}


function readPositionsStrict(dv, firstOff, vc, stride) {
  const verts = new Array(vc * 3);
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const unique = new Set();
  const maxAbs = CSG_MESHDATA_TOLERANCE.maxAbsCoord;
  for (let i = 0; i < vc; i++) {
    const off = firstOff + i * stride;
    const x = dv.getFloat32(off, true);
    const y = dv.getFloat32(off + 4, true);
    const z = dv.getFloat32(off + 8, true);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return { ok: false, reason: "coordenada não-finita no vértice #" + i };
    }
    if (Math.abs(x) > maxAbs || Math.abs(y) > maxAbs || Math.abs(z) > maxAbs) {
      return { ok: false, reason: "coordenada além de maxAbsCoord no vértice #" + i };
    }
    verts[i * 3] = x;
    verts[i * 3 + 1] = y;
    verts[i * 3 + 2] = z;
    if (unique.size < 4) unique.add(x + "," + y + "," + z);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  if (unique.size < 4) return { ok: false, reason: "menos de 4 vértices únicos (malha degenerada)" };
  if (
    !(maxX - minX >= CSG_MESHDATA_TOLERANCE.minExtent) ||
    !(maxY - minY >= CSG_MESHDATA_TOLERANCE.minExtent) ||
    !(maxZ - minZ >= CSG_MESHDATA_TOLERANCE.minExtent)
  ) {
    return { ok: false, reason: "bbox degenerada (extensão abaixo de minExtent)" };
  }
  return {
    ok: true,
    verts,
    bbox: { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } },
  };
}


function buildSoupFromIndices(dv, idxOff, triCount, verts, vc, u8, colorsOff) {
  const positions = new Array(triCount * 9);
  const colors = colorsOff != null ? new Array(triCount * 9) : null;
  let p = 0;
  for (let t = 0; t < triCount; t++) {
    const base = idxOff + t * 12;
    const a = dv.getUint32(base, true);
    const b = dv.getUint32(base + 4, true);
    const c = dv.getUint32(base + 8, true);
    if (a >= vc || b >= vc || c >= vc) {
      return { ok: false, reason: "índice de triângulo fora do range no triângulo #" + t };
    }
    for (let k = 0; k < 3; k++) {
      const v = k === 0 ? a : k === 1 ? b : c;
      positions[p] = verts[v * 3];
      positions[p + 1] = verts[v * 3 + 1];
      positions[p + 2] = verts[v * 3 + 2];
      if (colors) {
        const co = colorsOff + v * 4;
        colors[p] = u8[co] / 255;
        colors[p + 1] = u8[co + 1] / 255;
        colors[p + 2] = u8[co + 2] / 255;
      }
      p += 3;
    }
  }
  return { ok: true, positions, colors };
}


function tryPlanarAt(dv, u8, size, start, plan, phys, budget) {
  const rejected = (reason) => ({ ok: false, reason });
  if (start + 8 > size) return rejected("blob menor que o cabeçalho candidato");
  const vc = dv.getUint32(start, true);
  if (vc < 4) return rejected("vertexCount " + vc + " abaixo do mínimo (4)");
  if (vc > SOLID_LIMITS.maxVertices) return rejected("vertexCount " + vc + " acima de SOLID_LIMITS.maxVertices");
  if (!plan.normals && !hasPhysEvidence(phys)) {
    return rejected("variante sem normais exige PhysicsData para cross-check");
  }
  const posOff = start + 4;
  let cursor = posOff + vc * 12;
  const normalsOff = plan.normals ? cursor : null;
  if (plan.normals) cursor += vc * 12;
  const uvOff = plan.uv ? cursor : null;
  if (plan.uv) cursor += vc * 8;
  const rgbaOff = plan.rgba ? cursor : null;
  if (plan.rgba) cursor += vc * 4;
  const tanOff = plan.tan16 ? cursor : null;
  if (plan.tan16) cursor += vc * 16;
  const countOff = cursor;
  if (countOff + 4 > size) return rejected("contagens maiores que o blob (blocos por-vértice não cabem)");
  const n = dv.getUint32(countOff, true);
  const idxOff = countOff + 4;
  for (const mode of ["indexCount", "triCount"]) {
    let triCount;
    if (mode === "indexCount") {
      if (n % 3 !== 0) continue;
      triCount = n / 3;
    } else {
      triCount = n;
    }
    if (triCount < 2 || triCount > SOLID_LIMITS.maxTriangles) continue;
    const end = idxOff + triCount * 12;
    if (end > size) continue;
    const remainder = size - end;
    let trailingRgbaOff = null;
    if (remainder !== 0) {
      if (remainder === vc * 4 && rgbaOff == null) trailingRgbaOff = end;
      else continue;                                                            
    }
    if (budget.left <= 0) return rejected("orçamento de validações de layout esgotado");
    budget.left -= 1;
    const pos = readPositionsStrict(dv, posOff, vc, 12);
    if (!pos.ok) return rejected(pos.reason);
    if (normalsOff != null && !sampledUnitVectors(dv, normalsOff, vc, 12)) {
      return rejected("bloco de normais reprovado na amostragem unitária");
    }
    if (uvOff != null && !sampledFinite(dv, uvOff, vc, 8, 2)) {
      return rejected("bloco de UVs com float não-finito");
    }
    if (tanOff != null && !sampledTangents(dv, tanOff, vc, 16)) {
      return rejected("bloco de tangentes reprovado na amostragem (w != ±1)");
    }
    let colorsOff = rgbaOff;
    if (colorsOff != null && !plausibleRgbaBlock(u8, colorsOff, vc)) {
      return rejected("bloco RGBA8 por vértice implausível (alfa)");
    }
    if (trailingRgbaOff != null) {
      if (!hasPhysEvidence(phys)) return rejected("bloco RGBA8 no fim exige PhysicsData para cross-check");
      if (!plausibleRgbaBlock(u8, trailingRgbaOff, vc)) return rejected("bloco RGBA8 no fim implausível (alfa)");
      colorsOff = trailingRgbaOff;
    }
    const compat = meshBboxCompatibleWithPhysics(pos.bbox, phys || null);
    if (!compat.ok) return rejected(compat.reason);
    const soup = buildSoupFromIndices(dv, idxOff, triCount, pos.verts, vc, u8, colorsOff);
    if (!soup.ok) return rejected(soup.reason);
    return {
      ok: true,
      reason: null,
      positions: soup.positions,
      colors: soup.colors,
      vertexCount: vc,
      triCount,
      bbox: pos.bbox,
      layout: "planar:" + plan.name + (mode === "triCount" ? "/tc" : "/ic") + "@" + start,
    };
  }
  return rejected("nenhuma contagem de índices fecha o tamanho do blob");
}


function tryInterleavedAt(dv, u8, size, start, stride, phys, budget) {
  const rejected = (reason) => ({ ok: false, reason });
  if (start + 8 > size) return rejected("blob menor que o cabeçalho candidato");
  const vc = dv.getUint32(start, true);
  if (vc < 4) return rejected("vertexCount " + vc + " abaixo do mínimo (4)");
  if (vc > SOLID_LIMITS.maxVertices) return rejected("vertexCount " + vc + " acima de SOLID_LIMITS.maxVertices");
  const hasNormal = stride >= 24;
  if (!hasNormal && !hasPhysEvidence(phys)) {
    return rejected("stride sem normal exige PhysicsData para cross-check");
  }
  const posOff = start + 4;
  const countOff = posOff + vc * stride;
  if (countOff + 4 > size) return rejected("contagens maiores que o blob (registros não cabem)");
  const n = dv.getUint32(countOff, true);
  const idxOff = countOff + 4;
  for (const mode of ["indexCount", "triCount"]) {
    let triCount;
    if (mode === "indexCount") {
      if (n % 3 !== 0) continue;
      triCount = n / 3;
    } else {
      triCount = n;
    }
    if (triCount < 2 || triCount > SOLID_LIMITS.maxTriangles) continue;
    const end = idxOff + triCount * 12;
    if (end > size) continue;
    const remainder = size - end;
    let trailingRgbaOff = null;
    if (remainder !== 0) {
      if (remainder === vc * 4) trailingRgbaOff = end;
      else continue;
    }
    if (budget.left <= 0) return rejected("orçamento de validações de layout esgotado");
    budget.left -= 1;
    const pos = readPositionsStrict(dv, posOff, vc, stride);
    if (!pos.ok) return rejected(pos.reason);
    if (hasNormal && !sampledUnitVectors(dv, posOff + 12, vc, stride)) {
      return rejected("normal interleaved reprovada na amostragem unitária");
    }
    let colorsOff = null;
    if (trailingRgbaOff != null) {
      if (!hasPhysEvidence(phys)) return rejected("bloco RGBA8 no fim exige PhysicsData para cross-check");
      if (!plausibleRgbaBlock(u8, trailingRgbaOff, vc)) return rejected("bloco RGBA8 no fim implausível (alfa)");
      colorsOff = trailingRgbaOff;
    }
    const compat = meshBboxCompatibleWithPhysics(pos.bbox, phys || null);
    if (!compat.ok) return rejected(compat.reason);
    const soup = buildSoupFromIndices(dv, idxOff, triCount, pos.verts, vc, u8, colorsOff);
    if (!soup.ok) return rejected(soup.reason);
    return {
      ok: true,
      reason: null,
      positions: soup.positions,
      colors: soup.colors,
      vertexCount: vc,
      triCount,
      bbox: pos.bbox,
      layout: "interleaved:s" + stride + (mode === "triCount" ? "/tc" : "/ic") + "@" + start,
    };
  }
  return rejected("nenhuma contagem de índices fecha o tamanho do blob");
}


function tryDecodeCsgmdlStrict(u8, version, phys) {
  try {
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const size = u8.byteLength;
    const bases = [];
    if (size >= 10 && dv.getUint32(6, true) === version) bases.push(10);
    bases.push(7);
    let reason = null;

    for (const start of bases) {
      const r = tryCsgmdlLayoutAt(dv, size, start, phys);
      if (r.ok) return { ...r, colors: null, layout: "packed@" + start };
      if (reason === null) reason = r.reason;
    }

    const budget = { left: CSG_MESHDATA_LAYOUTS.maxFullValidations };
    for (const base of bases) {
      for (const skip of CSG_MESHDATA_LAYOUTS.headerSkips) {
        const start = base + skip;
        for (const plan of PLANAR_PLANS) {
          const r = tryPlanarAt(dv, u8, size, start, plan, phys, budget);
          if (r.ok) return r;
        }
      }
    }
    for (const base of bases) {
      for (const skip of CSG_MESHDATA_LAYOUTS.headerSkips) {
        const start = base + skip;
        for (const stride of CSG_MESHDATA_LAYOUTS.interleavedStrides) {
          const r = tryInterleavedAt(dv, u8, size, start, stride, phys, budget);
          if (r.ok) return r;
        }
      }
    }
    return { ok: false, reason: reason || "blob menor que o cabeçalho candidato" };
  } catch (_) {
    return { ok: false, reason: "erro interno ao validar o layout candidato" };
  }
}


export const CSG_MESHDATA_SCAN = Object.freeze({
  version: "csg-meshdata-3",
  tier: "scan",
  strides: Object.freeze([12, 16, 20, 24, 28, 32, 36, 40, 44, 48, 56, 64]),
  denseStartWindow: 1024,
  coarseStartStep: 16,
  maxStartProbes: 8192,
  maxDeepCandidates: 12,
  indexProbeWindow: 256,
  maxIndexEvaluations: 24,
  indexOffsetsAfterHit: 8,
  minTriangles: 4,
  bboxPadRel: 0.2,
  minVertexCoverage: 0.5,
  maxDegenerateRatio: 0.25,
  minAxisCoverageRel: 0.5,
  volumeRelTol: 0.3,
});


function hullsBBoxOf(phys) {
  if (!phys || !Array.isArray(phys.hulls) || phys.hulls.length === 0) return null;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  let any = false;
  for (const hull of phys.hulls) {
    const verts = hull && Array.isArray(hull.vertices) ? hull.vertices : null;
    if (!verts) continue;
    for (const v of verts) {
      if (!v || !Number.isFinite(v.x) || !Number.isFinite(v.y) || !Number.isFinite(v.z)) continue;
      any = true;
      if (v.x < minX) minX = v.x;
      if (v.x > maxX) maxX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.y > maxY) maxY = v.y;
      if (v.z < minZ) minZ = v.z;
      if (v.z > maxZ) maxZ = v.z;
    }
  }
  if (!any) return null;
  const dx = maxX - minX, dy = maxY - minY, dz = maxZ - minZ;
  return {
    min: { x: minX, y: minY, z: minZ },
    max: { x: maxX, y: maxY, z: maxZ },
    diag: Math.sqrt(dx * dx + dy * dy + dz * dz),
  };
}


function signedSoupVolume(positions) {
  let v = 0;
  for (let i = 0; i + 8 < positions.length; i += 9) {
    const ax = positions[i], ay = positions[i + 1], az = positions[i + 2];
    const bx = positions[i + 3], by = positions[i + 4], bz = positions[i + 5];
    const cx = positions[i + 6], cy = positions[i + 7], cz = positions[i + 8];
    v += (ax * (by * cz - bz * cy) + ay * (bz * cx - bx * cz) + az * (bx * cy - by * cx)) / 6;
  }
  return v;
}


function bboxAxisExtent(bbox) {
  return {
    x: bbox.max.x - bbox.min.x,
    y: bbox.max.y - bbox.min.y,
    z: bbox.max.z - bbox.min.z,
  };
}


function scanRunAxisExtent(dv, start, stride, vertexCount) {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < vertexCount; i++) {
    const off = start + i * stride;
    const x = dv.getFloat32(off, true);
    const y = dv.getFloat32(off + 4, true);
    const z = dv.getFloat32(off + 8, true);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  return { x: maxX - minX, y: maxY - minY, z: maxZ - minZ };
}


function runCoversHullAxes(extent, hullsBBox) {
  const S = CSG_MESHDATA_SCAN;
  return (
    extent.x >= S.minAxisCoverageRel * (hullsBBox.max.x - hullsBBox.min.x) &&
    extent.y >= S.minAxisCoverageRel * (hullsBBox.max.y - hullsBBox.min.y) &&
    extent.z >= S.minAxisCoverageRel * (hullsBBox.max.z - hullsBBox.min.z)
  );
}


function insertScanCandidate(list, cand, cap) {
  for (const e of list) {
    if (
      e.stride === cand.stride &&
      cand.start >= e.start &&
      cand.start < e.start + e.vc * e.stride &&
      (cand.start - e.start) % e.stride === 0
    ) {
      return;
    }
  }
  list.push(cand);
  list.sort((a, b) => b.vc - a.vc || a.start - b.start || a.stride - b.stride);
  if (list.length > cap) list.length = cap;
}


function readScanIndexRun(dv, size, off, width, vc) {
  const maxVals = SOLID_LIMITS.maxTriangles * 3;
  let n = 0;
  while (n < maxVals && off + (n + 1) * width <= size) {
    const v = width === 4 ? dv.getUint32(off + n * width, true) : dv.getUint16(off + n * width, true);
    if (v >= vc) break;
    n += 1;
  }
  return Math.floor(n / 3);
}


function evaluateScanTriangles(readIndex, triCount, verts, vc) {
  const S = CSG_MESHDATA_SCAN;
  const used = new Set();
  let degenerate = 0;
  let area = 0;
  for (let t = 0; t < triCount; t++) {
    const a = readIndex(t * 3);
    const b = readIndex(t * 3 + 1);
    const c = readIndex(t * 3 + 2);
    used.add(a);
    used.add(b);
    used.add(c);
    if (a === b || b === c || a === c) {
      degenerate += 1;
      continue;
    }
    const ax = verts[a * 3], ay = verts[a * 3 + 1], az = verts[a * 3 + 2];
    const bx = verts[b * 3], by = verts[b * 3 + 1], bz = verts[b * 3 + 2];
    const cx = verts[c * 3], cy = verts[c * 3 + 1], cz = verts[c * 3 + 2];
    const ux = bx - ax, uy = by - ay, uz = bz - az;
    const vx = cx - ax, vy = cy - ay, vz = cz - az;
    const nx = uy * vz - uz * vy;
    const ny = uz * vx - ux * vz;
    const nz = ux * vy - uy * vx;
    const triArea = 0.5 * Math.sqrt(nx * nx + ny * ny + nz * nz);
    if (!(triArea > 1e-9)) degenerate += 1;
    else area += triArea;
  }
  if (degenerate / triCount > S.maxDegenerateRatio) return { ok: false, coverage: 0 };
  if (!(area > 0)) return { ok: false, coverage: 0 };
  const coverage = used.size / vc;
  if (coverage < S.minVertexCoverage) return { ok: false, coverage };
  return { ok: true, coverage };
}


function deepValidateScanCandidate(dv, size, cand, phys, hb) {
  const S = CSG_MESHDATA_SCAN;
  const rejected = (reason) => ({ ok: false, reason });
  const tableStart = cand.start;
  const stride = cand.stride;
  const vc = Math.min(cand.vc, SOLID_LIMITS.maxVertices);
  if (vc < 4) return rejected("menos de 4 vértices no run");
  const pos = readPositionsStrict(dv, tableStart, vc, stride);
  if (!pos.ok) return rejected(pos.reason);

  if (!runCoversHullAxes(bboxAxisExtent(pos.bbox), hb)) {
    return rejected("extensão por eixo insuficiente vs bbox dos hulls");
  }

  const compat = meshBboxCompatibleWithPhysics(pos.bbox, phys);
  if (!compat.ok) return rejected(compat.reason);


  const minIdxBytes = S.minTriangles * 3 * 2;
  const tableEnd = tableStart + (vc - 1) * stride + 12;
  const windows = [
    [tableEnd, Math.min(size - minIdxBytes, tableEnd + stride + S.indexProbeWindow)],
    [7, Math.min(tableStart - minIdxBytes, 7 + S.indexProbeWindow)],
  ];
  let best = null;
  let evals = 0;
  for (const w of windows) {
    let offsetsAfterHit = 0;
    for (let idxStart = w[0]; idxStart <= w[1]; idxStart++) {
      if (best) {
        offsetsAfterHit += 1;
        if (offsetsAfterHit > S.indexOffsetsAfterHit) break;
      }
      for (const width of [4, 2]) {
        const triCount = readScanIndexRun(dv, size, idxStart, width, vc);
        if (triCount < S.minTriangles) continue;
        if (evals >= S.maxIndexEvaluations) break;
        evals += 1;
        const readIndex = (k) =>
          width === 4 ? dv.getUint32(idxStart + k * 4, true) : dv.getUint16(idxStart + k * 2, true);
        const ev = evaluateScanTriangles(readIndex, triCount, pos.verts, vc);
        if (!ev.ok) continue;
        if (!best || ev.coverage > best.coverage || (ev.coverage === best.coverage && triCount > best.triCount)) {
          best = { idxStart, width, triCount, coverage: ev.coverage };
        }
      }
      if (evals >= S.maxIndexEvaluations) break;
    }
    if (best) break;                                                   
  }

  let positions = null;
  let colors = null;
  let triCount = 0;
  let coverage = 0;
  let layout = null;
  if (best) {
    triCount = best.triCount;
    coverage = best.coverage;
    positions = new Array(triCount * 9);
    let p = 0;
    for (let k = 0; k < triCount * 3; k++) {
      const idx = best.width === 4 ? dv.getUint32(best.idxStart + k * 4, true) : dv.getUint16(best.idxStart + k * 2, true);
      positions[p++] = pos.verts[idx * 3];
      positions[p++] = pos.verts[idx * 3 + 1];
      positions[p++] = pos.verts[idx * 3 + 2];
    }


    const rgbaOff = best.idxStart + triCount * 3 * best.width;
    if (rgbaOff + vc * 4 <= size) {
      const u8v = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
      if (plausibleRgbaBlock(u8v, rgbaOff, vc)) {
        colors = new Array(triCount * 9);
        let cp = 0;
        for (let k = 0; k < triCount * 3; k++) {
          const idx = best.width === 4 ? dv.getUint32(best.idxStart + k * 4, true) : dv.getUint16(best.idxStart + k * 2, true);
          const co = rgbaOff + idx * 4;
          colors[cp++] = u8v[co] / 255;
          colors[cp++] = u8v[co + 1] / 255;
          colors[cp++] = u8v[co + 2] / 255;
        }
      }
    }
    layout = "scan:i" + (best.width === 4 ? "32" : "16") + "@" + best.idxStart + "/s" + stride + "@" + tableStart + (colors ? "+rgba" : "");
  } else {

    if (vc < 12 || vc % 3 !== 0) {
      return rejected("sem tabela de índices e o run não forma sopa (vc % 3 != 0 ou vc < 12)");
    }
    triCount = vc / 3;
    if (triCount > SOLID_LIMITS.maxTriangles) return rejected("triCount acima de SOLID_LIMITS.maxTriangles");
    const readIndex = (k) => k;                                         
    const ev = evaluateScanTriangles(readIndex, triCount, pos.verts, vc);
    if (!ev.ok) return rejected("sopa direta reprovada (degenerados/área/cobertura)");
    coverage = ev.coverage;
    positions = new Array(vc * 3);
    for (let i = 0; i < vc * 3; i++) positions[i] = pos.verts[i];
    layout = "scan:soup/s" + stride + "@" + tableStart;
  }


  const pv = phys && Number.isFinite(phys.volume) && phys.volume > 0 ? phys.volume : null;
  if (pv != null) {
    const soupVol = Math.abs(signedSoupVolume(positions));
    const relDiff = Math.abs(soupVol - pv) / Math.max(pv, soupVol, 1e-9);
    if (relDiff > S.volumeRelTol) {
      return rejected(
        "volume da malha da varredura (" + soupVol.toFixed(3) + ") incompatível com o volume do PhysicsData (" + pv.toFixed(3) + ")",
      );
    }
  }

  return {
    ok: true,
    positions,
    colors,
    vertexCount: vc,
    triCount,
    bbox: pos.bbox,
    coverage,
    layout,
    tieStart: tableStart,
    tieStride: stride,
  };
}



function tryCsgmdlScanSalvage(u8, phys) {
  try {
    const S = CSG_MESHDATA_SCAN;
    const rejected = (reason) => ({ ok: false, reason });
    const hb = hullsBBoxOf(phys);
    if (!hb) return rejected("sem hulls finitos do PhysicsData para servir de evidência física");
    const size = u8.byteLength;
    if (size < 7 + 4 * 12) return rejected("blob menor que o mínimo da varredura (4 vértices f32)");
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const pad = Math.max(1, S.bboxPadRel * Math.max(1, hb.diag));
    const loX = hb.min.x - pad, hiX = hb.max.x + pad;
    const loY = hb.min.y - pad, hiY = hb.max.y + pad;
    const loZ = hb.min.z - pad, hiZ = hb.max.z + pad;
    const maxAbs = CSG_MESHDATA_TOLERANCE.maxAbsCoord;
    const posOk = (off) => {
      const x = dv.getFloat32(off, true);
      if (!Number.isFinite(x) || x < loX || x > hiX || Math.abs(x) > maxAbs) return false;
      const y = dv.getFloat32(off + 4, true);
      if (!Number.isFinite(y) || y < loY || y > hiY || Math.abs(y) > maxAbs) return false;
      const z = dv.getFloat32(off + 8, true);
      if (!Number.isFinite(z) || z < loZ || z > hiZ || Math.abs(z) > maxAbs) return false;
      return true;
    };


    const candidates = [];
    let probes = 0;
    let startOff = 7;
    while (startOff + 3 * 12 + 12 <= size && probes < S.maxStartProbes) {
      probes += 1;
      for (const stride of S.strides) {
        if (startOff + 3 * stride + 12 > size) break;                              
        if (
          !posOk(startOff) ||
          !posOk(startOff + stride) ||
          !posOk(startOff + 2 * stride) ||
          !posOk(startOff + 3 * stride)
        ) {
          continue;
        }
        let vc = 4;
        while (vc < SOLID_LIMITS.maxVertices && startOff + vc * stride + 12 <= size && posOk(startOff + vc * stride)) {
          vc += 1;
        }




        if (!runCoversHullAxes(scanRunAxisExtent(dv, startOff, stride, vc), hb)) continue;
        insertScanCandidate(candidates, { start: startOff, stride, vc }, S.maxDeepCandidates);
      }
      startOff += startOff - 7 < S.denseStartWindow ? 1 : S.coarseStartStep;
    }
    if (candidates.length === 0) {
      return rejected("nenhuma tabela de vértices compatível com a bbox dos hulls encontrada");
    }


    const accepted = [];
    let firstReason = null;
    for (const cand of candidates) {
      const r = deepValidateScanCandidate(dv, size, cand, phys, hb);
      if (r.ok) accepted.push(r);
      else if (firstReason === null) firstReason = r.reason;
    }
    if (accepted.length === 0) {
      return rejected(firstReason || "nenhum candidato da varredura passou em todas as invariantes");
    }
    accepted.sort(
      (a, b) => b.coverage - a.coverage || b.triCount - a.triCount || a.tieStart - b.tieStart || a.tieStride - b.tieStride,
    );
    return accepted[0];
  } catch (_) {
    return { ok: false, reason: "erro interno na varredura por evidência física" };
  }
}


function acceptScanResult(result, scan) {
  result.ok = true;
  result.positions = scan.positions;

  result.colors = Array.isArray(scan.colors) && scan.colors.length > 0 ? scan.colors : null;
  result.vertexCount = scan.vertexCount;
  result.triCount = scan.triCount;
  result.bbox = scan.bbox;
  result.layout = scan.layout;
  result.salvaged = true;
}


export const CSG_MESHDATA_SELF = Object.freeze({
  version: "csg-meshdata-5",
  tier: "scan-self",
  minVertexCoverage: 0.9,
  maxStartProbes: 4096,
  maxDeepCandidates: 8,
  denseStartWindow: 512,
  coarseStartStep: 16,
});


function canonicalSoupIds(positions) {
  const triCount = Math.floor(positions.length / 9);
  const map = new Map();
  const ids = new Int32Array(triCount * 3);
  let next = 0;
  for (let k = 0; k < triCount * 3; k++) {
    const p = k * 3;
    const key = positions[p] + "," + positions[p + 1] + "," + positions[p + 2];
    let id = map.get(key);
    if (id === undefined) {
      id = next;
      next += 1;
      map.set(key, id);
    }
    ids[k] = id;
  }
  return { ids, uniqueCount: next };
}


function watertightSoupProof(positions) {
  const triCount = Math.floor(positions.length / 9);
  if (triCount < CSG_MESHDATA_SCAN.minTriangles) {
    return { ok: false, reason: "menos triângulos que o mínimo da varredura" };
  }
  const { ids, uniqueCount } = canonicalSoupIds(positions);
  if (uniqueCount < 4) return { ok: false, reason: "menos de 4 posições únicas na sopa" };
  const K = SOLID_LIMITS.maxVertices + 1;
  const edges = new Map();
  for (let t = 0; t < triCount; t++) {
    const a = ids[t * 3];
    const b = ids[t * 3 + 1];
    const c = ids[t * 3 + 2];
    if (a === b || b === c || c === a) {
      return { ok: false, reason: "triângulo degenerado na prova de estanqueidade" };
    }
    const e0 = a * K + b;
    const e1 = b * K + c;
    const e2 = c * K + a;
    if (edges.has(e0) || edges.has(e1) || edges.has(e2)) {
      return { ok: false, reason: "aresta dirigida duplicada (superfície sobreposta/não-orientável)" };
    }
    edges.set(e0, 1);
    edges.set(e1, 1);
    edges.set(e2, 1);
  }
  for (const key of edges.keys()) {
    const a = Math.floor(key / K);
    const b = key % K;
    if (!edges.has(b * K + a)) {
      return { ok: false, reason: "aresta de borda sem par oposto (superfície aberta)" };
    }
  }
  const vol = Math.abs(signedSoupVolume(positions));
  if (!(vol > 0)) return { ok: false, reason: "volume fechado nulo na prova de estanqueidade" };
  return { ok: true, reason: null, volume: vol };
}


function deepValidateSelfCandidate(dv, size, cand, phys) {
  const S = CSG_MESHDATA_SCAN;
  const rejected = (reason) => ({ ok: false, reason });
  const tableStart = cand.start;
  const stride = cand.stride;
  const vc = Math.min(cand.vc, SOLID_LIMITS.maxVertices);
  if (vc < 4) return rejected("menos de 4 vértices no run");
  const pos = readPositionsStrict(dv, tableStart, vc, stride);
  if (!pos.ok) return rejected(pos.reason);


  const minIdxBytes = S.minTriangles * 3 * 2;
  const tableEnd = tableStart + (vc - 1) * stride + 12;
  const windows = [
    [tableEnd, Math.min(size - minIdxBytes, tableEnd + stride + S.indexProbeWindow)],
    [7, Math.min(tableStart - minIdxBytes, 7 + S.indexProbeWindow)],
  ];
  let best = null;
  let evals = 0;
  for (const w of windows) {
    let offsetsAfterHit = 0;
    for (let idxStart = w[0]; idxStart <= w[1]; idxStart++) {
      if (best) {
        offsetsAfterHit += 1;
        if (offsetsAfterHit > S.indexOffsetsAfterHit) break;
      }
      for (const width of [4, 2]) {
        const triCount = readScanIndexRun(dv, size, idxStart, width, vc);
        if (triCount < S.minTriangles) continue;
        if (evals >= S.maxIndexEvaluations) break;
        evals += 1;
        const readIndex = (k) =>
          width === 4 ? dv.getUint32(idxStart + k * 4, true) : dv.getUint16(idxStart + k * 2, true);
        const ev = evaluateScanTriangles(readIndex, triCount, pos.verts, vc);
        if (!ev.ok || ev.coverage < CSG_MESHDATA_SELF.minVertexCoverage) continue;
        if (!best || ev.coverage > best.coverage || (ev.coverage === best.coverage && triCount > best.triCount)) {
          best = { idxStart, width, triCount, coverage: ev.coverage };
        }
      }
      if (evals >= S.maxIndexEvaluations) break;
    }
    if (best) break;                                                   
  }

  let positions = null;
  let colors = null;
  let triCount = 0;
  let coverage = 0;
  let layout = null;
  if (best) {
    triCount = best.triCount;
    coverage = best.coverage;
    positions = new Array(triCount * 9);
    let p = 0;
    for (let k = 0; k < triCount * 3; k++) {
      const idx = best.width === 4 ? dv.getUint32(best.idxStart + k * 4, true) : dv.getUint16(best.idxStart + k * 2, true);
      positions[p++] = pos.verts[idx * 3];
      positions[p++] = pos.verts[idx * 3 + 1];
      positions[p++] = pos.verts[idx * 3 + 2];
    }


    const rgbaOff = best.idxStart + triCount * 3 * best.width;
    if (rgbaOff + vc * 4 <= size) {
      const u8v = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
      if (plausibleRgbaBlock(u8v, rgbaOff, vc)) {
        colors = new Array(triCount * 9);
        let cp = 0;
        for (let k = 0; k < triCount * 3; k++) {
          const idx = best.width === 4 ? dv.getUint32(best.idxStart + k * 4, true) : dv.getUint16(best.idxStart + k * 2, true);
          const co = rgbaOff + idx * 4;
          colors[cp++] = u8v[co] / 255;
          colors[cp++] = u8v[co + 1] / 255;
          colors[cp++] = u8v[co + 2] / 255;
        }
      }
    }
    layout = "scan-self:i" + (best.width === 4 ? "32" : "16") + "@" + best.idxStart + "/s" + stride + "@" + tableStart + (colors ? "+rgba" : "");
  } else {

    if (vc < 12 || vc % 3 !== 0) {
      return rejected("sem tabela de índices e o run não forma sopa (vc % 3 != 0 ou vc < 12)");
    }
    triCount = vc / 3;
    if (triCount > SOLID_LIMITS.maxTriangles) return rejected("triCount acima de SOLID_LIMITS.maxTriangles");
    const ev = evaluateScanTriangles((k) => k, triCount, pos.verts, vc);
    if (!ev.ok) return rejected("sopa direta reprovada (degenerados/área/cobertura)");
    coverage = ev.coverage;
    positions = new Array(vc * 3);
    for (let i = 0; i < vc * 3; i++) positions[i] = pos.verts[i];
    layout = "scan-self:soup/s" + stride + "@" + tableStart;
  }


  const proof = watertightSoupProof(positions);
  if (!proof.ok) return rejected(proof.reason);


  const compat = meshBboxCompatibleWithPhysics(pos.bbox, phys);
  if (!compat.ok) return rejected(compat.reason);
  const pv = phys && Number.isFinite(phys.volume) && phys.volume > 0 ? phys.volume : null;
  if (pv != null) {
    const relDiff = Math.abs(proof.volume - pv) / Math.max(pv, proof.volume, 1e-9);
    if (relDiff > S.volumeRelTol) {
      return rejected(
        "volume fechado da sopa (" + proof.volume.toFixed(3) + ") incompatível com o volume do PhysicsData (" + pv.toFixed(3) + ")",
      );
    }
  }

  return {
    ok: true,
    positions,
    colors,
    vertexCount: vc,
    triCount,
    bbox: pos.bbox,
    coverage,
    layout,
    tieStart: tableStart,
    tieStride: stride,
  };
}


function tryCsgmdlSelfSalvage(u8, phys) {
  try {
    if (hullsBBoxOf(phys)) {
      return { ok: false, reason: "hulls presentes — a varredura por evidência física é o tier competente" };
    }
    const S = CSG_MESHDATA_SCAN;
    const SELF = CSG_MESHDATA_SELF;
    const rejected = (reason) => ({ ok: false, reason });
    const size = u8.byteLength;
    if (size < 7 + 4 * 12) return rejected("blob menor que o mínimo da varredura (4 vértices f32)");
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const maxAbs = CSG_MESHDATA_TOLERANCE.maxAbsCoord;
    const posOk = (off) => {
      const x = dv.getFloat32(off, true);
      if (!Number.isFinite(x) || Math.abs(x) > maxAbs) return false;
      const y = dv.getFloat32(off + 4, true);
      if (!Number.isFinite(y) || Math.abs(y) > maxAbs) return false;
      const z = dv.getFloat32(off + 8, true);
      if (!Number.isFinite(z) || Math.abs(z) > maxAbs) return false;
      return true;
    };


    const candidates = [];
    let probes = 0;
    let startOff = 7;
    while (startOff + 3 * 12 + 12 <= size && probes < SELF.maxStartProbes) {
      probes += 1;
      for (const stride of S.strides) {
        if (startOff + 3 * stride + 12 > size) break;                              
        if (
          !posOk(startOff) ||
          !posOk(startOff + stride) ||
          !posOk(startOff + 2 * stride) ||
          !posOk(startOff + 3 * stride)
        ) {
          continue;
        }
        let vc = 4;
        while (vc < SOLID_LIMITS.maxVertices && startOff + vc * stride + 12 <= size && posOk(startOff + vc * stride)) {
          vc += 1;
        }
        insertScanCandidate(candidates, { start: startOff, stride, vc }, 256);
      }
      startOff += startOff - 7 < SELF.denseStartWindow ? 1 : SELF.coarseStartStep;
    }
    if (candidates.length === 0) {
      return rejected("nenhuma tabela de vértices plausível encontrada sem evidência física");
    }


    const accepted = [];
    let firstReason = null;
    for (const cand of candidates) {
      const r = deepValidateSelfCandidate(dv, size, cand, phys);
      if (r.ok) accepted.push(r);
      else if (firstReason === null) firstReason = r.reason;
    }
    if (accepted.length === 0) {
      return rejected(firstReason || "nenhum candidato passou na prova de estanqueidade");
    }
    accepted.sort(
      (a, b) => b.coverage - a.coverage || b.triCount - a.triCount || a.tieStart - b.tieStart || a.tieStride - b.tieStride,
    );
    return accepted[0];
  } catch (_) {
    return { ok: false, reason: "erro interno na varredura auto-evidente" };
  }
}


export const CSG_MESHDATA_OPEN = Object.freeze({
  version: "csg-meshdata-7",
  tier: "scan-open",
  minVertexCoverage: 0.9,
  minEdgePairRatio: 0.75,
  maxUniqueIdRatio: 0.75,
  maxStartProbes: 4096,
  maxDeepCandidates: 8,
  denseStartWindow: 512,
  coarseStartStep: 16,
});


function openSoupCoherenceProof(positions) {
  const triCount = Math.floor(positions.length / 9);
  if (triCount < CSG_MESHDATA_SCAN.minTriangles) {
    return { ok: false, reason: "menos triângulos que o mínimo da varredura" };
  }
  const { ids, uniqueCount } = canonicalSoupIds(positions);
  if (uniqueCount < 4) return { ok: false, reason: "menos de 4 posições únicas na sopa" };
  if (uniqueCount > CSG_MESHDATA_OPEN.maxUniqueIdRatio * triCount * 3) {
    return { ok: false, reason: "sem compartilhamento real de vértices (triângulos soltos, não é malha costurada)" };
  }
  const K = SOLID_LIMITS.maxVertices + 1;
  const edges = new Map();
  for (let t = 0; t < triCount; t++) {
    const a = ids[t * 3];
    const b = ids[t * 3 + 1];
    const c = ids[t * 3 + 2];
    if (a === b || b === c || c === a) {
      return { ok: false, reason: "triângulo degenerado na prova de coerência (lista de índices deslocada?)" };
    }
    const e0 = a * K + b;
    const e1 = b * K + c;
    const e2 = c * K + a;
    if (edges.has(e0) || edges.has(e1) || edges.has(e2)) {
      return { ok: false, reason: "aresta dirigida duplicada (superfície sobreposta/não-orientável)" };
    }
    edges.set(e0, 1);
    edges.set(e1, 1);
    edges.set(e2, 1);
  }
  let paired = 0;
  for (const key of edges.keys()) {
    const a = Math.floor(key / K);
    const b = key % K;
    if (edges.has(b * K + a)) paired += 1;
  }
  const pairRatio = paired / edges.size;
  if (!(pairRatio >= CSG_MESHDATA_OPEN.minEdgePairRatio)) {
    return {
      ok: false,
      reason:
        "pareamento de arestas insuficiente (" + pairRatio.toFixed(2) + " < " + CSG_MESHDATA_OPEN.minEdgePairRatio + ") — sopa sem interior costurado",
    };
  }
  return { ok: true, reason: null, pairRatio };
}


function deepValidateOpenCandidate(dv, size, cand, phys, hb) {
  const S = CSG_MESHDATA_SCAN;
  const rejected = (reason) => ({ ok: false, reason });
  const tableStart = cand.start;
  const stride = cand.stride;
  const vc = Math.min(cand.vc, SOLID_LIMITS.maxVertices);
  if (vc < 4) return rejected("menos de 4 vértices no run");
  const pos = readPositionsStrict(dv, tableStart, vc, stride);
  if (!pos.ok) return rejected(pos.reason);
  if (hb) {

    if (!runCoversHullAxes(bboxAxisExtent(pos.bbox), hb)) {
      return rejected("extensão por eixo insuficiente vs bbox dos hulls");
    }
  }


  const minIdxBytes = S.minTriangles * 3 * 2;
  const tableEnd = tableStart + (vc - 1) * stride + 12;
  const windows = [
    [tableEnd, Math.min(size - minIdxBytes, tableEnd + stride + S.indexProbeWindow)],
    [7, Math.min(tableStart - minIdxBytes, 7 + S.indexProbeWindow)],
  ];
  let best = null;
  let evals = 0;
  for (const w of windows) {
    let offsetsAfterHit = 0;
    for (let idxStart = w[0]; idxStart <= w[1]; idxStart++) {
      if (best) {
        offsetsAfterHit += 1;
        if (offsetsAfterHit > S.indexOffsetsAfterHit) break;
      }
      for (const width of [4, 2]) {
        const triCount = readScanIndexRun(dv, size, idxStart, width, vc);
        if (triCount < S.minTriangles) continue;
        if (evals >= S.maxIndexEvaluations) break;
        evals += 1;
        const readIndex = (k) =>
          width === 4 ? dv.getUint32(idxStart + k * 4, true) : dv.getUint16(idxStart + k * 2, true);
        const ev = evaluateScanTriangles(readIndex, triCount, pos.verts, vc);
        if (!ev.ok || ev.coverage < CSG_MESHDATA_OPEN.minVertexCoverage) continue;
        if (!best || ev.coverage > best.coverage || (ev.coverage === best.coverage && triCount > best.triCount)) {
          best = { idxStart, width, triCount, coverage: ev.coverage };
        }
      }
      if (evals >= S.maxIndexEvaluations) break;
    }
    if (best) break;                                                   
  }

  let positions = null;
  let colors = null;
  let triCount = 0;
  let coverage = 0;
  let layout = null;
  if (best) {
    triCount = best.triCount;
    coverage = best.coverage;
    positions = new Array(triCount * 9);
    let p = 0;
    for (let k = 0; k < triCount * 3; k++) {
      const idx = best.width === 4 ? dv.getUint32(best.idxStart + k * 4, true) : dv.getUint16(best.idxStart + k * 2, true);
      positions[p++] = pos.verts[idx * 3];
      positions[p++] = pos.verts[idx * 3 + 1];
      positions[p++] = pos.verts[idx * 3 + 2];
    }


    const rgbaOff = best.idxStart + triCount * 3 * best.width;
    if (rgbaOff + vc * 4 <= size) {
      const u8v = new Uint8Array(dv.buffer, dv.byteOffset, dv.byteLength);
      if (plausibleRgbaBlock(u8v, rgbaOff, vc)) {
        colors = new Array(triCount * 9);
        let cp = 0;
        for (let k = 0; k < triCount * 3; k++) {
          const idx = best.width === 4 ? dv.getUint32(best.idxStart + k * 4, true) : dv.getUint16(best.idxStart + k * 2, true);
          const co = rgbaOff + idx * 4;
          colors[cp++] = u8v[co] / 255;
          colors[cp++] = u8v[co + 1] / 255;
          colors[cp++] = u8v[co + 2] / 255;
        }
      }
    }
    layout = "scan-open:i" + (best.width === 4 ? "32" : "16") + "@" + best.idxStart + "/s" + stride + "@" + tableStart + (colors ? "+rgba" : "");
  } else {

    if (vc < 12 || vc % 3 !== 0) {
      return rejected("sem tabela de índices e o run não forma sopa (vc % 3 != 0 ou vc < 12)");
    }
    triCount = vc / 3;
    if (triCount > SOLID_LIMITS.maxTriangles) return rejected("triCount acima de SOLID_LIMITS.maxTriangles");
    const ev = evaluateScanTriangles((k) => k, triCount, pos.verts, vc);
    if (!ev.ok) return rejected("sopa direta reprovada (degenerados/área/cobertura)");
    coverage = ev.coverage;
    positions = new Array(vc * 3);
    for (let i = 0; i < vc * 3; i++) positions[i] = pos.verts[i];
    layout = "scan-open:soup/s" + stride + "@" + tableStart;
  }


  const proof = openSoupCoherenceProof(positions);
  if (!proof.ok) return rejected(proof.reason);



  const compat = meshBboxCompatibleWithPhysics(pos.bbox, phys);
  if (!compat.ok) return rejected(compat.reason);

  return {
    ok: true,
    positions,
    colors,
    vertexCount: vc,
    triCount,
    bbox: pos.bbox,
    coverage,
    pairRatio: proof.pairRatio,
    layout,
    tieStart: tableStart,
    tieStride: stride,
  };
}


function tryCsgmdlOpenSalvage(u8, phys) {
  try {
    const S = CSG_MESHDATA_SCAN;
    const OPEN = CSG_MESHDATA_OPEN;
    const rejected = (reason) => ({ ok: false, reason });
    const size = u8.byteLength;
    if (size < 7 + 4 * 12) return rejected("blob menor que o mínimo da varredura (4 vértices f32)");
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const maxAbs = CSG_MESHDATA_TOLERANCE.maxAbsCoord;
    const hb = hullsBBoxOf(phys);
    let posOk;
    if (hb) {


      const pad = Math.max(1, S.bboxPadRel * hb.diag);
      const loX = hb.min.x - pad, hiX = hb.max.x + pad;
      const loY = hb.min.y - pad, hiY = hb.max.y + pad;
      const loZ = hb.min.z - pad, hiZ = hb.max.z + pad;
      posOk = (off) => {
        const x = dv.getFloat32(off, true);
        if (!Number.isFinite(x) || Math.abs(x) > maxAbs || x < loX || x > hiX) return false;
        const y = dv.getFloat32(off + 4, true);
        if (!Number.isFinite(y) || Math.abs(y) > maxAbs || y < loY || y > hiY) return false;
        const z = dv.getFloat32(off + 8, true);
        if (!Number.isFinite(z) || Math.abs(z) > maxAbs || z < loZ || z > hiZ) return false;
        return true;
      };
    } else {
      posOk = (off) => {
        const x = dv.getFloat32(off, true);
        if (!Number.isFinite(x) || Math.abs(x) > maxAbs) return false;
        const y = dv.getFloat32(off + 4, true);
        if (!Number.isFinite(y) || Math.abs(y) > maxAbs) return false;
        const z = dv.getFloat32(off + 8, true);
        if (!Number.isFinite(z) || Math.abs(z) > maxAbs) return false;
        return true;
      };
    }


    const candidates = [];
    let probes = 0;
    let startOff = 7;
    while (startOff + 3 * 12 + 12 <= size && probes < OPEN.maxStartProbes) {
      probes += 1;
      for (const stride of S.strides) {
        if (startOff + 3 * stride + 12 > size) break;                              
        if (
          !posOk(startOff) ||
          !posOk(startOff + stride) ||
          !posOk(startOff + 2 * stride) ||
          !posOk(startOff + 3 * stride)
        ) {
          continue;
        }
        let vc = 4;
        while (vc < SOLID_LIMITS.maxVertices && startOff + vc * stride + 12 <= size && posOk(startOff + vc * stride)) {
          vc += 1;
        }
        insertScanCandidate(candidates, { start: startOff, stride, vc }, 256);
      }
      startOff += startOff - 7 < OPEN.denseStartWindow ? 1 : OPEN.coarseStartStep;
    }
    if (candidates.length === 0) {
      return rejected("nenhuma tabela de vértices plausível para a varredura aberta");
    }


    const accepted = [];
    let firstReason = null;
    for (const cand of candidates) {
      const r = deepValidateOpenCandidate(dv, size, cand, phys, hb);
      if (r.ok) accepted.push(r);
      else if (firstReason === null) firstReason = r.reason;
    }
    if (accepted.length === 0) {
      return rejected(firstReason || "nenhum candidato passou na prova de coerência da varredura aberta");
    }
    accepted.sort(
      (a, b) =>
        b.coverage - a.coverage || b.pairRatio - a.pairRatio || b.triCount - a.triCount || a.tieStart - b.tieStart || a.tieStride - b.tieStride,
    );
    return accepted[0];
  } catch (_) {
    return { ok: false, reason: "erro interno na varredura aberta" };
  }
}


export const CSG_MESHDATA_QUANT = Object.freeze({
  version: "csg-meshdata-4",
  family: "quant16",
  encodings: Object.freeze(["f16", "u16n", "i16n"]),
  strides: Object.freeze([6, 8, 12, 16, 20, 24, 32]),
  headerSkips: Object.freeze([0, 2, 4, 6, 8, 10, 12, 14, 16]),
  indexWidths: Object.freeze([4, 2]),
  minTriangles: 4,
  maxFullValidations: 8,
});


function halfToFloat(bits) {
  const sign = bits & 0x8000 ? -1 : 1;
  const exp = (bits >> 10) & 0x1f;
  const frac = bits & 0x3ff;
  if (exp === 0) return sign * frac * 5.960464477539063e-8;                           
  if (exp === 31) return NaN;
  return sign * (1024 + frac) * Math.pow(2, exp - 25);
}


function readPositionsQuant(dv, firstOff, vc, stride, enc, hb) {
  const maxAbs = CSG_MESHDATA_TOLERANCE.maxAbsCoord;
  const extX = hb.max.x - hb.min.x, extY = hb.max.y - hb.min.y, extZ = hb.max.z - hb.min.z;
  const cX = (hb.min.x + hb.max.x) / 2, cY = (hb.min.y + hb.max.y) / 2, cZ = (hb.min.z + hb.max.z) / 2;
  const verts = new Array(vc * 3);
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  const unique = new Set();
  for (let i = 0; i < vc; i++) {
    const off = firstOff + i * stride;
    let x, y, z;
    if (enc === "f16") {
      x = halfToFloat(dv.getUint16(off, true));
      y = halfToFloat(dv.getUint16(off + 2, true));
      z = halfToFloat(dv.getUint16(off + 4, true));
    } else if (enc === "u16n") {
      x = hb.min.x + (dv.getUint16(off, true) / 65535) * extX;
      y = hb.min.y + (dv.getUint16(off + 2, true) / 65535) * extY;
      z = hb.min.z + (dv.getUint16(off + 4, true) / 65535) * extZ;
    } else {
      x = cX + (dv.getInt16(off, true) / 32767) * (extX / 2);
      y = cY + (dv.getInt16(off + 2, true) / 32767) * (extY / 2);
      z = cZ + (dv.getInt16(off + 4, true) / 32767) * (extZ / 2);
    }
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return { ok: false, reason: "coordenada quantizada não-finita no vértice #" + i };
    }
    if (Math.abs(x) > maxAbs || Math.abs(y) > maxAbs || Math.abs(z) > maxAbs) {
      return { ok: false, reason: "coordenada quantizada além de maxAbsCoord no vértice #" + i };
    }
    verts[i * 3] = x;
    verts[i * 3 + 1] = y;
    verts[i * 3 + 2] = z;
    if (unique.size < 4) unique.add(x + "," + y + "," + z);
    if (x < minX) minX = x;
    if (x > maxX) maxX = x;
    if (y < minY) minY = y;
    if (y > maxY) maxY = y;
    if (z < minZ) minZ = z;
    if (z > maxZ) maxZ = z;
  }
  if (unique.size < 4) return { ok: false, reason: "menos de 4 vértices únicos (malha degenerada)" };
  if (
    !(maxX - minX >= CSG_MESHDATA_TOLERANCE.minExtent) ||
    !(maxY - minY >= CSG_MESHDATA_TOLERANCE.minExtent) ||
    !(maxZ - minZ >= CSG_MESHDATA_TOLERANCE.minExtent)
  ) {
    return { ok: false, reason: "bbox degenerada (extensão abaixo de minExtent)" };
  }
  return {
    ok: true,
    verts,
    bbox: { min: { x: minX, y: minY, z: minZ }, max: { x: maxX, y: maxY, z: maxZ } },
  };
}


function tryQuant16At(dv, u8, size, start, stride, enc, phys, hb, budget) {
  const rejected = (reason) => ({ ok: false, reason });
  if (start + 8 > size) return rejected("blob menor que o cabeçalho candidato");
  const vc = dv.getUint32(start, true);
  if (vc < 4) return rejected("vertexCount " + vc + " abaixo do mínimo (4)");
  if (vc > SOLID_LIMITS.maxVertices) return rejected("vertexCount " + vc + " acima de SOLID_LIMITS.maxVertices");
  const posOff = start + 4;
  const countOff = posOff + vc * stride;
  if (countOff + 4 > size) return rejected("contagens maiores que o blob (registros não cabem)");
  const n = dv.getUint32(countOff, true);
  const idxOff = countOff + 4;
  for (const width of CSG_MESHDATA_QUANT.indexWidths) {
    for (const mode of ["indexCount", "triCount"]) {
      let triCount;
      if (mode === "indexCount") {
        if (n % 3 !== 0) continue;
        triCount = n / 3;
      } else {
        triCount = n;
      }
      if (triCount < CSG_MESHDATA_QUANT.minTriangles || triCount > SOLID_LIMITS.maxTriangles) continue;
      const end = idxOff + triCount * 3 * width;
      if (end > size) continue;
      const remainder = size - end;
      let rgbaOff = null;
      if (remainder !== 0) {
        if (remainder === vc * 4) rgbaOff = end;
        else continue;                                                            
      }
      if (budget.left <= 0) return rejected("orçamento de validações quantizadas esgotado");
      budget.left -= 1;
      const pos = readPositionsQuant(dv, posOff, vc, stride, enc, hb);
      if (!pos.ok) return rejected(pos.reason);
      const compat = meshBboxCompatibleWithPhysics(pos.bbox, phys);
      if (!compat.ok) return rejected(compat.reason);


      const readIndex = (k) => (width === 4 ? dv.getUint32(idxOff + k * 4, true) : dv.getUint16(idxOff + k * 2, true));
      for (let k = 0; k < triCount * 3; k++) {
        if (readIndex(k) >= vc) return rejected("índice de triângulo fora do range no índice #" + k);
      }
      const ev = evaluateScanTriangles(readIndex, triCount, pos.verts, vc);
      if (!ev.ok) return rejected("triângulos reprovados (cobertura/degenerados/área)");
      if (rgbaOff != null && !plausibleRgbaBlock(u8, rgbaOff, vc)) {
        return rejected("bloco RGBA8 no fim implausível (alfa)");
      }
      const positions = new Array(triCount * 9);
      const colors = rgbaOff != null ? new Array(triCount * 9) : null;
      let p = 0;
      for (let k = 0; k < triCount * 3; k++) {
        const idx = readIndex(k);
        positions[p] = pos.verts[idx * 3];
        positions[p + 1] = pos.verts[idx * 3 + 1];
        positions[p + 2] = pos.verts[idx * 3 + 2];
        if (colors) {
          const co = rgbaOff + idx * 4;
          colors[p] = u8[co] / 255;
          colors[p + 1] = u8[co + 1] / 255;
          colors[p + 2] = u8[co + 2] / 255;
        }
        p += 3;
      }


      const pv = phys.volume;
      const soupVol = Math.abs(signedSoupVolume(positions));
      const relDiff = Math.abs(soupVol - pv) / Math.max(pv, soupVol, 1e-9);
      if (relDiff > CSG_MESHDATA_SCAN.volumeRelTol) {
        return rejected(
          "volume da malha quantizada (" + soupVol.toFixed(3) + ") incompatível com o volume do PhysicsData (" + pv.toFixed(3) + ")",
        );
      }
      return {
        ok: true,
        positions,
        colors,
        vertexCount: vc,
        triCount,
        bbox: pos.bbox,
        layout:
          "quant16:" + enc + ":s" + stride + (mode === "triCount" ? "/tc" : "/ic") +
          (width === 2 ? "/i16" : "/i32") + "@" + start + (colors ? "+rgba" : ""),
      };
    }
  }
  return rejected("nenhuma contagem de índices fecha o tamanho do blob");
}



function tryDecodeCsgmdlQuant(u8, version, phys) {
  try {
    if (!phys || !Array.isArray(phys.hulls) || phys.hulls.length === 0) {
      return { ok: false, reason: "sem hulls do PhysicsData (evidência exigida pela família quantizada)" };
    }
    if (!(Number.isFinite(phys.volume) && phys.volume > 0)) {
      return { ok: false, reason: "sem volume finito do PhysicsData (prova F1 exigida pela família quantizada)" };
    }
    const hb = hullsBBoxOf(phys);
    if (!hb) return { ok: false, reason: "hulls do PhysicsData sem vértices finitos" };
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const size = u8.byteLength;
    const bases = [];
    if (size >= 10 && dv.getUint32(6, true) === version) bases.push(10);
    bases.push(7);
    const budget = { left: CSG_MESHDATA_QUANT.maxFullValidations };
    let reason = null;
    for (const base of bases) {
      for (const skip of CSG_MESHDATA_QUANT.headerSkips) {
        const start = base + skip;
        for (const stride of CSG_MESHDATA_QUANT.strides) {
          for (const enc of CSG_MESHDATA_QUANT.encodings) {
            const r = tryQuant16At(dv, u8, size, start, stride, enc, phys, hb, budget);
            if (r.ok) return r;
            if (reason === null) reason = r.reason;
          }
        }
      }
    }
    return { ok: false, reason: reason || "nenhum candidato quantizado plausível" };
  } catch (_) {
    return { ok: false, reason: "erro interno na família quantizada" };
  }
}


function acceptQuantResult(result, q) {
  result.ok = true;
  result.positions = q.positions;
  result.colors = Array.isArray(q.colors) && q.colors.length > 0 ? q.colors : null;
  result.vertexCount = q.vertexCount;
  result.triCount = q.triCount;
  result.bbox = q.bbox;
  result.layout = q.layout;
  result.salvaged = true;
}


function findCompressedBody(u8) {
  const lim = Math.min(u8.byteLength - 3, 64);
  for (let off = 6; off < lim; off++) {
    const a = u8[off], b = u8[off + 1], c = u8[off + 2], d = u8[off + 3];
    if (a === 0x28 && b === 0xb5 && c === 0x2f && d === 0xfd) return { off, kind: "zstd" };
    if (a === 0x04 && b === 0x22 && c === 0x4d && d === 0x18) return { off, kind: "LZ4 frame" };
    if (a === 0x1f && b === 0x8b) return { off, kind: "gzip" };
    if (a === 0x78 && (b === 0x01 || b === 0x9c || b === 0xda) && off <= 12) return { off, kind: "zlib/deflate" };
  }
  return null;
}


function wholeBlobCompressionKind(u8) {
  if (u8.byteLength < 4) return null;
  const a = u8[0], b = u8[1], c = u8[2], d = u8[3];
  if (a === 0x28 && b === 0xb5 && c === 0x2f && d === 0xfd) return "zstd";
  if (a === 0x04 && b === 0x22 && c === 0x4d && d === 0x18) return "LZ4 frame";
  if (a === 0x1f && b === 0x8b) return "gzip";
  if (a === 0x78 && (b === 0x01 || b === 0x9c || b === 0xda)) return "zlib/deflate";
  return null;
}


function runCsgmdlTiers(u8, version, phys) {
  const reasons = { strict: null, quant: null, scan: null, self: null, open: null };
  if (version === 2 || version === 4 || version === 5) {


    const strict = tryDecodeCsgmdlStrict(u8, version, phys);
    if (strict.ok) return { ok: true, tier: "strict", data: strict, reasonStrict: null };
    reasons.strict = strict.reason;
  }
  const quant = tryDecodeCsgmdlQuant(u8, version, phys);
  if (quant.ok) return { ok: true, tier: "quant", data: quant, reasonStrict: reasons.strict };
  reasons.quant = quant.reason;
  const scan = tryCsgmdlScanSalvage(u8, phys);
  if (scan.ok) return { ok: true, tier: "scan", data: scan, reasonStrict: reasons.strict };
  reasons.scan = scan.reason;
  const self = tryCsgmdlSelfSalvage(u8, phys);
  if (self.ok) return { ok: true, tier: "self", data: self, reasonStrict: reasons.strict };
  reasons.self = self.reason;


  const open = tryCsgmdlOpenSalvage(u8, phys);
  if (open.ok) return { ok: true, tier: "open", data: open, reasonStrict: reasons.strict };
  reasons.open = open.reason;
  return { ok: false, reasons };
}


function acceptTierIntoResult(result, run, version, warnings, via) {
  const viaNote = via ? " (corpo " + via + " descomprimido localmente, contrato csg-meshdata-6)" : "";
  const d = run.data;
  if (run.tier === "strict") {
    result.ok = true;
    result.positions = d.positions;
    result.colors = Array.isArray(d.colors) && d.colors.length > 0 ? d.colors : null;
    result.vertexCount = d.vertexCount;
    result.triCount = d.triCount;
    result.bbox = d.bbox;
    result.layout = d.layout || null;
    warn(warnings, "MeshData CSGMDL v" + version + " aceito pela aceitação estrita" + viaNote + " (" + d.vertexCount + " vértices, " + d.triCount + " triângulos; layout " + (d.layout || "packed") + ") — malha real do arquivo em uso.");
    return;
  }
  if (run.tier === "quant") acceptQuantResult(result, d);
  else acceptScanResult(result, d);
  const tierName =
    run.tier === "quant"
      ? "família quantizada (contrato csg-meshdata-4)"
      : run.tier === "scan"
        ? "varredura por evidência física (contrato csg-meshdata-3)"
        : run.tier === "self"
          ? "varredura auto-evidente com prova de estanqueidade (contrato csg-meshdata-5)"
          : "varredura aberta best-effort sem prova de estanqueidade (contrato csg-meshdata-7)";
  const prefix =
    version === 2 || version === 4 || version === 5
      ? "MeshData CSGMDL v" + version + " fora das famílias estritas (motivo: " + run.reasonStrict + ")"
      : "MeshData CSGMDL v" + version + " desconhecido";
  warn(warnings, prefix + viaNote + " — malha de render RECUPERADA pela " + tierName + ": " + d.vertexCount + " vértices, " + d.triCount + " triângulos; layout " + d.layout + " — malha real do arquivo em uso.");
}


export function decodeCsgMeshData(bytes, warnings, phys) {
  return decodeCsgMeshDataInner(bytes, warnings, phys, 0);
}


function decodeCsgMeshDataInner(bytes, warnings, phys, depth) {
  const result = { ok: false, format: null, positions: [], colors: null, vertexCount: 0, triCount: 0, bbox: null, layout: null };
  try {
    const u8 = openBlob(bytes, warnings, "MeshData");
    if (!u8) return result;
    if (ascii(u8, 0, 4) === "CSGK") {
      result.format = "CSGK";
      warn(warnings, 'MeshData: formato legado "CSGK" — a geometria vive na nuvem (AssetId) e não no arquivo; sem malha local.');
      return result;
    }
    if (ascii(u8, 0, 6) !== "CSGMDL") {


      const kind = depth === 0 ? wholeBlobCompressionKind(u8) : null;
      if (kind) {
        const inner = tryDecompressCsgBody(u8, kind, SOLID_LIMITS.maxBlobBytes);
        if (inner && inner.byteLength >= 7 && (ascii(inner, 0, 6) === "CSGMDL" || ascii(inner, 0, 4) === "CSGK")) {
          warn(warnings, "MeshData: blob inteiro comprimido (" + kind + ") — descomprimido localmente (contrato csg-meshdata-6).");
          return decodeCsgMeshDataInner(inner, warnings, phys, depth + 1);
        }
        if (inner === null) {
          warn(warnings, "MeshData: blob inteiro com magic " + kind + " detectado, mas a descompressão local falhou (bytes inválidos/truncados); blob ignorado.");
          return result;
        }
      }
      warn(warnings, 'MeshData: magic desconhecido — não é "CSGMDL" nem "CSGK"; blob ignorado.');
      return result;
    }
    if (u8.byteLength < 7) {
      warn(warnings, "MeshData: blob truncado antes da versão do CSGMDL.");
      return result;
    }

    let version = u8[6];
    if (version >= 0x30 && version <= 0x39) version -= 0x30;
    result.format = "CSGMDL" + version;

    const run = runCsgmdlTiers(u8, version, phys);
    if (run.ok) {
      acceptTierIntoResult(result, run, version, warnings, null);
      return result;
    }


    const comp = findCompressedBody(u8);
    let compNote = "";
    if (comp && depth === 0) {
      const body = tryDecompressCsgBody(u8.subarray(comp.off), comp.kind, SOLID_LIMITS.maxBlobBytes);
      if (body && body.byteLength >= 4 && comp.off + body.byteLength <= SOLID_LIMITS.maxBlobBytes) {
        const synth = new Uint8Array(comp.off + body.byteLength);
        synth.set(u8.subarray(0, comp.off), 0);
        synth.set(body, comp.off);
        const run2 = runCsgmdlTiers(synth, version, phys);
        if (run2.ok) {
          acceptTierIntoResult(result, run2, version, warnings, comp.kind);
          return result;
        }
        compNote = " Corpo com magic de compressão " + comp.kind + " descomprimido localmente (contrato csg-meshdata-6), mas nenhum tier aceitou o conteúdo aberto.";
      } else {
        compNote = " Corpo com magic de compressão " + comp.kind + " detectado, mas a descompressão local falhou (bytes inválidos/truncados).";
      }
    } else if (comp) {
      compNote = " Corpo com magic de compressão " + comp.kind + " detectado (rodada de descompressão local já usada).";
    }

    if (version === 2 || version === 4 || version === 5) {
      warn(warnings, "MeshData CSGMDL v" + version + " ainda não suportado (layout candidato rejeitado: " + run.reasons.strict + "; família quantizada: " + run.reasons.quant + "; varredura por evidência física: " + run.reasons.scan + "; varredura auto-evidente: " + run.reasons.self + "; varredura aberta: " + run.reasons.open + ") — a união é reconstruída pelos hulls do PhysicsData quando presentes." + compNote);
    } else {
      warn(warnings, "MeshData CSGMDL v" + version + " desconhecido (família quantizada: " + run.reasons.quant + "; varredura por evidência física: " + run.reasons.scan + "; varredura auto-evidente: " + run.reasons.self + "; varredura aberta: " + run.reasons.open + ") — a união é reconstruída pelos hulls do PhysicsData quando presentes." + compNote);
    }
    return result;
  } catch (_) {
    result.ok = false;
    warn(warnings, "MeshData: erro interno inesperado ao decodificar — blob ignorado.");
    return result;
  }
}


function readHull(dv, off, size, hullIndex, warnings) {
  const discard = (motivo, nextOff) => {
    warn(warnings, "PhysicsData CSGPHS6: hull #" + hullIndex + " " + motivo + " — hull descartado.");
    return { hull: null, nextOff, fatal: false };
  };
  const fatal = (motivo) => {
    warn(warnings, "PhysicsData CSGPHS6: hull #" + hullIndex + " " + motivo + " — leitura dos hulls interrompida.");
    return { hull: null, nextOff: size, fatal: true };
  };


  if (off + 4 > size) return fatal("truncado no tamanho do bloco reservado 1");
  const r1 = dv.getUint32(off, true);
  off += 4;
  if (r1 !== 16) return fatal("com tamanho do bloco reservado 1 inválido (" + r1 + ", esperado 16)");
  if (off + 16 > size) return fatal("truncado dentro do bloco reservado 1");
  off += 16;


  if (off + 4 > size) return fatal("truncado no tamanho do bloco reservado 2");
  const r2 = dv.getUint32(off, true);
  off += 4;
  if (r2 !== 16) return fatal("com tamanho do bloco reservado 2 inválido (" + r2 + ", esperado 16)");
  if (off + 16 > size) return fatal("truncado dentro do bloco reservado 2");
  off += 16;

  if (off + 4 > size) return fatal("truncado em verts_size");
  const vertsSize = dv.getUint32(off, true);
  off += 4;
  if (off + 4 > size) return fatal("truncado em vert_width");
  const vertWidth = dv.getUint32(off, true);
  off += 4;
  if (vertWidth !== 4) return fatal("com vert_width " + vertWidth + " (esperado 4)");


  const vertsBytes = vertsSize * 4;
  if (off + vertsBytes > size) {
    return fatal("com verts_size " + vertsSize + " maior que o restante do buffer (contador mentiroso ou blob truncado); nada alocado");
  }
  const vertsOff = off;
  off += vertsBytes;

  if (off + 4 > size) return fatal("truncado em faces_size");
  const facesSize = dv.getUint32(off, true);
  off += 4;
  const facesBytes = facesSize * 4;
  if (off + facesBytes > size) {
    return fatal("com faces_size " + facesSize + " maior que o restante do buffer (contador mentiroso ou blob truncado); nada alocado");
  }
  const facesOff = off;
  off += facesBytes;


  if (vertsSize % 3 !== 0) return discard("com verts_size " + vertsSize + " não múltiplo de 3", off);
  const vertexCount = vertsSize / 3;
  if (vertexCount > SOLID_LIMITS.maxHullVertices) {
    return discard("com " + vertexCount + " vértices (limite " + SOLID_LIMITS.maxHullVertices + " por hull); geometria não alocada", off);
  }
  if (vertexCount < 4) return discard("com só " + vertexCount + " vértice(s) (mínimo 4)", off);
  if (facesSize % 3 !== 0) return discard("com faces_size " + facesSize + " não múltiplo de 3", off);
  const triCount = facesSize / 3;
  if (triCount < 1) return discard("sem faces", off);
  if (triCount > SOLID_LIMITS.maxTriangles) {
    return discard("com " + triCount + " triângulos (limite " + SOLID_LIMITS.maxTriangles + "); geometria não alocada", off);
  }


  const vertices = new Array(vertexCount);
  const unique = new Set();
  for (let i = 0; i < vertexCount; i++) {
    const x = dv.getFloat32(vertsOff + i * 12, true);
    const y = dv.getFloat32(vertsOff + i * 12 + 4, true);
    const z = dv.getFloat32(vertsOff + i * 12 + 8, true);
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) {
      return discard("com vértice não-finito (vértice " + i + ")", off);
    }
    vertices[i] = { x, y, z };
    unique.add(x + "|" + y + "|" + z);
  }
  if (unique.size < 4) {
    return discard("degenerado (só " + unique.size + " posição(ões) única(s) — vértices repetidos)", off);
  }
  const faces = new Array(triCount);
  for (let t = 0; t < triCount; t++) {
    const a = dv.getUint32(facesOff + t * 12, true);
    const b = dv.getUint32(facesOff + t * 12 + 4, true);
    const c = dv.getUint32(facesOff + t * 12 + 8, true);
    if (a >= vertexCount || b >= vertexCount || c >= vertexCount) {
      return discard("com índice de face fora do range (triângulo " + t + ")", off);
    }
    faces[t] = [a, b, c];
  }
  return { hull: { vertices, faces }, nextOff: off, fatal: false };
}


function readStrictHullStream(dv, size, startOff) {
  const hulls = [];
  const scratch = [];
  let off = startOff;
  while (off < size) {
    if (hulls.length >= SOLID_LIMITS.maxHulls) return null;                    
    const step = readHull(dv, off, size, hulls.length + 1, scratch);
    if (step.fatal || !step.hull) return null;
    if (step.nextOff <= off) return null;                                
    off = step.nextOff;
    hulls.push(step.hull);
  }
  if (off !== size || hulls.length === 0) return null;
  return { hulls };
}


function salvageUnknownCsgphsType(dv, u8, type, result) {
  const size = u8.byteLength;
  const tried = new Set();
  const attempt = (startOff) => {
    if (startOff < 10 || startOff + 52 > size || tried.has(startOff)) return null;
    tried.add(startOff);
    return readStrictHullStream(dv, size, startOff);
  };

  let layout = null;
  let stream = attempt(50);
  if (stream) {
    layout = "com cabeçalho, fluxo no byte 50";
    const volume = dv.getFloat32(10, true);
    const cx = dv.getFloat32(14, true);
    const cy = dv.getFloat32(18, true);
    const cz = dv.getFloat32(22, true);
    if (Number.isFinite(volume)) result.volume = volume;
    if (Number.isFinite(cx) && Number.isFinite(cy) && Number.isFinite(cz)) {
      result.cog = { x: cx, y: cy, z: cz };
    }
  }
  if (!stream) {
    stream = attempt(10);
    if (stream) layout = "sem cabeçalho, fluxo no byte 10";
  }
  if (!stream) {
    let deepTries = 0;
    const last = Math.min(size - 52, 10 + 128);
    for (let off = 11; off <= last && !stream; off++) {
      if (tried.has(off) || dv.getUint32(off, true) !== 16) continue;
      deepTries += 1;
      if (deepTries > 24) break;
      stream = attempt(off);
      if (stream) layout = "cabeçalho desconhecido de " + (off - 10) + " byte(s), fluxo no byte " + off;
    }
  }
  if (!stream) return null;

  result.ok = true;
  result.format = "CSGPHS" + type;
  result.kind = "hulls";
  result.hulls = stream.hulls;
  result.salvaged = true;
  return { layout };
}


export function decodeCsgPhysicsData(bytes, warnings) {
  const result = { ok: false, format: null, kind: null, hulls: [], volume: null, cog: null };
  try {
    const u8 = openBlob(bytes, warnings, "PhysicsData");
    if (!u8) return result;
    if (ascii(u8, 0, 4) === "CSGK") {
      result.format = "CSGK";
      warn(warnings, 'PhysicsData: formato legado "CSGK" — a geometria vive na nuvem (AssetId) e não no arquivo; sem hulls locais.');
      return result;
    }
    if (ascii(u8, 0, 6) !== "CSGPHS") {
      warn(warnings, 'PhysicsData: magic desconhecido — não é "CSGPHS" nem "CSGK"; blob ignorado.');
      return result;
    }
    if (u8.byteLength < 10) {
      warn(warnings, 'PhysicsData: blob truncado antes do campo "type".');
      return result;
    }
    const dv = new DataView(u8.buffer, u8.byteOffset, u8.byteLength);
    const type = dv.getUint32(6, true);

    if (type === 0) {
      result.format = "CSGPHS0";
      if (ascii(u8, 10, 5) !== "BLOCK") {
        warn(warnings, 'PhysicsData CSGPHS0: os 5 chars "BLOCK" não conferem (blob truncado ou corrompido).');
        return result;
      }
      result.ok = true;
      result.kind = "box";                                                      
      return result;
    }

    if (type !== 6) {


      const salvaged = salvageUnknownCsgphsType(dv, u8, type, result);
      if (salvaged) {
        warn(warnings, "PhysicsData: CSGPHS type " + type + " não documentado — " + result.hulls.length + " hull(s) locais recuperados por leitura especulativa estrita (" + salvaged.layout + ").");
        return result;
      }
      warn(warnings, "PhysicsData: CSGPHS type " + type + " não suportado (recuperação estrita tentada sem sucesso) — a geometria desta união vive na nuvem (AssetId) ou em formato novo; sem hulls locais.");
      return result;
    }

    result.format = "CSGPHS6";
    result.kind = "hulls";
    if (u8.byteLength < 50) {
      warn(warnings, "PhysicsData CSGPHS6: cabeçalho truncado (volume/cog/inércia incompletos).");
      return result;
    }
    const volume = dv.getFloat32(10, true);
    const cx = dv.getFloat32(14, true);
    const cy = dv.getFloat32(18, true);
    const cz = dv.getFloat32(22, true);

    if (Number.isFinite(volume)) {
      result.volume = volume;
    } else {
      warn(warnings, "PhysicsData CSGPHS6: volume não-finito no arquivo — descartado (null).");
    }
    if (Number.isFinite(cx) && Number.isFinite(cy) && Number.isFinite(cz)) {
      result.cog = { x: cx, y: cy, z: cz };
    } else {
      warn(warnings, "PhysicsData CSGPHS6: centro de gravidade não-finito no arquivo — descartado (null).");
    }

    let off = 50;
    const size = u8.byteLength;
    let hullIndex = 0;
    while (off < size) {
      if (result.hulls.length >= SOLID_LIMITS.maxHulls) {
        warn(warnings, "PhysicsData CSGPHS6: limite de " + SOLID_LIMITS.maxHulls + " hulls atingido — o restante do blob foi ignorado.");
        break;
      }
      hullIndex += 1;
      const step = readHull(dv, off, size, hullIndex, warnings);
      if (step.fatal) break;
      off = step.nextOff;                                                
      if (step.hull) result.hulls.push(step.hull);
    }

    if (result.hulls.length === 0) {
      warn(warnings, "PhysicsData CSGPHS6: nenhum hull válido decodificado.");
      return result;                                             
    }
    result.ok = true;
    return result;
  } catch (_) {
    result.ok = false;
    warn(warnings, "PhysicsData: erro interno inesperado ao decodificar — blob ignorado.");
    return result;
  }
}


export function hullsToTriangleSoup(hulls) {
  const out = [];
  try {
    if (!Array.isArray(hulls)) return out;
    const maxFloats = SOLID_LIMITS.maxTriangles * 9;
    const isVec = (v) =>
      !!v &&
      typeof v.x === "number" && Number.isFinite(v.x) &&
      typeof v.y === "number" && Number.isFinite(v.y) &&
      typeof v.z === "number" && Number.isFinite(v.z);
    for (let hi = 0; hi < hulls.length && hi < SOLID_LIMITS.maxHulls; hi++) {
      const hull = hulls[hi];
      if (!hull || !Array.isArray(hull.vertices) || !Array.isArray(hull.faces)) continue;
      const verts = hull.vertices;
      const faces = hull.faces;
      for (let fi = 0; fi < faces.length; fi++) {
        if (out.length + 9 > maxFloats) return out;                     
        const f = faces[fi];
        if (!Array.isArray(f) || f.length < 3) continue;
        const a = verts[f[0]];
        const b = verts[f[1]];
        const c = verts[f[2]];
        if (!isVec(a) || !isVec(b) || !isVec(c)) continue;
        out.push(a.x, a.y, a.z, b.x, b.y, b.z, c.x, c.y, c.z);
      }
    }
  } catch (_) {                                       }
  return out;
}
