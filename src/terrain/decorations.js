export const GRASS_CACHE_KEY = "rswGrass91";
export const MAX_GRASS_CELLS = 60000;
export const MAX_GRASS_INSTANCES = 24000;
export const GRASS_BLADES_PER_CELL = 3;
export const GRASS_INSTANCE_STRIDE = 8;                                            


export function hash01(a, b, c) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1274126177);
  h = Math.imul(h ^ (h >>> 13), 1103515245);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}


export function collectGrassCells({ getOcc, getMat, isGrass, bounds, maxCells = MAX_GRASS_CELLS }) {
  if (!bounds || typeof getOcc !== "function" || typeof getMat !== "function" || typeof isGrass !== "function") return [];
  const min = bounds.min, max = bounds.max;
  const out = [];
  for (let z = min[2]; z <= max[2]; z++) {
    for (let x = min[0]; x <= max[0]; x++) {
      for (let y = max[1]; y >= min[1]; y--) {
        const occ = getOcc(x, y, z);
        if (occ < 0.45) continue;


        if (isGrass(getMat(x, y, z)) && getOcc(x, y + 1, z) < 0.45) {
          out.push({ x, y, z, h: Math.max(0.3, Math.min(1, occ)) });
        }
        break;                                                      
      }
    }
  }
  if (out.length <= maxCells) return out;

  const step = out.length / maxCells;
  const dec = [];
  for (let i = 0; dec.length < maxCells; i += step) {
    const j = Math.floor(i);
    if (j >= out.length) break;
    dec.push(out[j]);
  }
  return dec;
}


export function buildGrassInstances(cells, opts = {}) {
  const voxel = opts.voxelSize || 4;
  const per = Math.max(1, Math.min(8, Math.floor(opts.bladesPerCell || GRASS_BLADES_PER_CELL)));
  const maxInstances = Math.max(0, Math.floor(opts.maxInstances != null ? opts.maxInstances : MAX_GRASS_INSTANCES));
  const list = Array.isArray(cells) ? cells : [];
  const totalWanted = list.length * per;
  const total = Math.min(totalWanted, maxInstances);
  const stride = GRASS_INSTANCE_STRIDE;
  const data = new Float32Array(total * stride);
  const step = totalWanted > maxInstances && total > 0 ? totalWanted / total : 1;
  let n = 0;
  let cursor = 0;
  while (n < total) {
    const j = Math.floor(cursor);
    if (j >= totalWanted) break;
    const cell = list[Math.floor(j / per)];
    const b = j % per;
    const h1 = hash01(cell.x * 3 + b, cell.y, cell.z * 5 + b);
    const h2 = hash01(cell.x * 7 + b, cell.z, cell.y * 11 + b);
    const h3 = hash01(cell.z * 13 + b, cell.x, cell.y * 17 + b);
    const o = n * stride;
    data[o] = (cell.x + 0.5 + (h1 - 0.5) * 0.9) * voxel;
    data[o + 1] = (cell.y + cell.h) * voxel - 0.25;
    data[o + 2] = (cell.z + 0.5 + (h2 - 0.5) * 0.9) * voxel;
    data[o + 3] = h3 * Math.PI * 2;
    data[o + 4] = 0.7 + h2 * 0.7;
    data[o + 5] = 1.1 + h1 * 1.2;
    data[o + 6] = 0.75 + h3 * 0.45;
    data[o + 7] = h1 * Math.PI * 2;
    n++;
    cursor += step;
  }
  return { count: n, stride, data, truncated: totalWanted > maxInstances };
}


export function buildGrassVertexPars() {
  return [
    "attribute float rswBend;",
    "uniform float uRswTime;",
    "uniform float uRswSway;",
  ].join("\n");
}

export function buildGrassVertexMain() {
  return [
    "{",
    "\tfloat rswPh = 0.0;",
    "#ifdef USE_INSTANCING",
    "\trswPh = dot((instanceMatrix * vec4(0.0, 0.0, 0.0, 1.0)).xz, vec2(0.43, 0.31));",
    "#endif",
    "\tfloat rswB = rswBend * rswBend * uRswSway;",
    "\ttransformed.x += (sin(uRswTime * 1.9 + rswPh) * 0.55 + sin(uRswTime * 3.7 + rswPh * 1.7) * 0.2) * rswB;",
    "\ttransformed.z += cos(uRswTime * 1.6 + rswPh) * 0.35 * rswB;",
    "}",
  ].join("\n");
}


export function grassSway(bend, sway, time, phase) {
  const b = bend * bend * sway;
  return {
    dx: (Math.sin(time * 1.9 + phase) * 0.55 + Math.sin(time * 3.7 + phase * 1.7) * 0.2) * b,
    dz: Math.cos(time * 1.6 + phase) * 0.35 * b,
  };
}
