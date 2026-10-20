export const MAX_EXPLODED_VERTICES = 900000;                                  


export function dominantMaterialAt(getOcc, getMat, isWater, vx, vy, vz) {
  const cx = Math.floor(vx), cy = Math.floor(vy), cz = Math.floor(vz);
  let best = -1;
  let bestW = 0;
  const weights = new Map();
  for (let dz = -1; dz <= 0; dz++) {
    for (let dy = -1; dy <= 0; dy++) {
      for (let dx = -1; dx <= 0; dx++) {
        const o = getOcc(cx + dx, cy + dy, cz + dz);
        if (!(o > 0)) continue;
        const m = getMat(cx + dx, cy + dy, cz + dz) | 0;
        if (isWater && isWater(m)) continue;
        const w = (weights.get(m) || 0) + o;
        weights.set(m, w);
        if (w > bestW || (w === bestW && best !== -1 && m < best)) {
          bestW = w;
          best = m;
        }
      }
    }
  }
  return best >= 0 ? best : 0;
}


export function explodeTrianglesWithMaterials(input, opts) {
  const { positions, normals, colors, indices, materials } = input || {};
  const o = opts || {};
  const maxVertices = Math.max(3, Math.min(o.maxVertices || MAX_EXPLODED_VERTICES, MAX_EXPLODED_VERTICES));
  const maxMaterial = Math.max(0, Math.min(o.maxMaterial != null ? o.maxMaterial : 31, 255));
  if (!positions || !normals || !colors || !indices || !materials) {
    throw new Error("explodeTriangles: entradas ausentes");
  }
  if (positions.length % 3 !== 0 || normals.length !== positions.length || colors.length !== positions.length) {
    throw new Error("explodeTriangles: atributos inconsistentes");
  }
  const vertexCountIn = positions.length / 3;
  if (materials.length !== vertexCountIn) {
    throw new Error("explodeTriangles: materiais != vértices");
  }
  const triCountIn = Math.floor(indices.length / 3);
  const triCount = Math.min(triCountIn, Math.floor(maxVertices / 3));
  if (triCount <= 0) return null;
  const outN = triCount * 3;
  const outPos = new Float32Array(outN * 3);
  const outNrm = new Float32Array(outN * 3);
  const outCol = new Float32Array(outN * 3);
  const outMat = new Float32Array(outN * 3);
  const outWgt = new Float32Array(outN * 3);
  const clampMat = (m) => {
    const v = m | 0;
    return v < 0 ? 0 : v > maxMaterial ? maxMaterial : v;
  };
  for (let t = 0; t < triCount; t++) {
    const ia = indices[t * 3] | 0;
    const ib = indices[t * 3 + 1] | 0;
    const ic = indices[t * 3 + 2] | 0;
    if (ia >= vertexCountIn || ib >= vertexCountIn || ic >= vertexCountIn || ia < 0 || ib < 0 || ic < 0) {
      throw new Error("explodeTriangles: índice fora do intervalo");
    }
    const mA = clampMat(materials[ia]);
    const mB = clampMat(materials[ib]);
    const mC = clampMat(materials[ic]);
    const corners = [ia, ib, ic];
    for (let k = 0; k < 3; k++) {
      const src = corners[k] * 3;
      const dst = (t * 3 + k) * 3;
      outPos[dst] = positions[src];
      outPos[dst + 1] = positions[src + 1];
      outPos[dst + 2] = positions[src + 2];
      outNrm[dst] = normals[src];
      outNrm[dst + 1] = normals[src + 1];
      outNrm[dst + 2] = normals[src + 2];
      outCol[dst] = colors[src];
      outCol[dst + 1] = colors[src + 1];
      outCol[dst + 2] = colors[src + 2];
      outMat[dst] = mA;
      outMat[dst + 1] = mB;
      outMat[dst + 2] = mC;
      outWgt[dst] = k === 0 ? 1 : 0;
      outWgt[dst + 1] = k === 1 ? 1 : 0;
      outWgt[dst + 2] = k === 2 ? 1 : 0;
    }
  }
  return {
    positions: outPos,
    normals: outNrm,
    colors: outCol,
    mats: outMat,
    weights: outWgt,
    vertexCount: outN,
    truncated: triCount < triCountIn,
  };
}
