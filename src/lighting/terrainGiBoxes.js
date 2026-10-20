export const TERRAIN_GI_MAX_BOXES = 4096;
const MAX_DIM = 4096;                               
const SOLID_MIN = 0.25;                                                      

function fin(v, d) {
  return Number.isFinite(v) ? v : d;
}

export function collectTerrainGiBoxes({
  bounds,
  getOcc,
  getMat,
  isWater,
  colorOf,
  voxelSize,
  maxBoxes,
} = {}) {
  if (!bounds || !bounds.min || !bounds.max) return [];
  if (typeof getOcc !== "function") return [];
  const vs = fin(voxelSize, 0);
  if (!(vs > 0) || vs > 64) return [];
  const cap = Math.max(1, Math.min(fin(maxBoxes, TERRAIN_GI_MAX_BOXES), TERRAIN_GI_MAX_BOXES));
  const x0 = Math.floor(fin(bounds.min[0], NaN));
  const y0 = Math.floor(fin(bounds.min[1], NaN));
  const z0 = Math.floor(fin(bounds.min[2], NaN));
  const x1 = Math.floor(fin(bounds.max[0], NaN));
  const y1 = Math.floor(fin(bounds.max[1], NaN));
  const z1 = Math.floor(fin(bounds.max[2], NaN));
  if (![x0, y0, z0, x1, y1, z1].every(Number.isFinite)) return [];
  const nx = x1 - x0 + 1;
  const ny = y1 - y0 + 1;
  const nz = z1 - z0 + 1;
  if (nx <= 0 || ny <= 0 || nz <= 0) return [];
  if (nx > MAX_DIM || ny > MAX_DIM || nz > MAX_DIM) return [];


  const colBudget = Math.max(1, Math.floor(cap / 2));
  const step = Math.max(1, Math.ceil(Math.sqrt((nx * nz) / colBudget)));
  const stride = Math.max(1, Math.floor(step / 2));                           
  const boxes = [];
  for (let zc = z0; zc <= z1 && boxes.length < cap; zc += step) {
    for (let xc = x0; xc <= x1 && boxes.length < cap; xc += step) {
      const wx = Math.min(step, x1 - xc + 1);
      const wz = Math.min(step, z1 - zc + 1);
      let spanStart = -1;
      let r = 0;
      let g = 0;
      let b = 0;
      let n = 0;
      for (let yc = y0; yc <= y1 + step; yc += step) {
        let solid = false;
        if (yc <= y1) {
          let total = 0;
          let hit = 0;
          for (let dz = 0; dz < wz; dz += stride) {
            for (let dx = 0; dx < wx; dx += stride) {
              for (let dy = 0; dy < step && yc + dy <= y1; dy += stride) {
                total++;
                const X = xc + dx;
                const Y = yc + dy;
                const Z = zc + dz;
                const occ = getOcc(X, Y, Z);
                if (!(occ >= 0.5)) continue;
                const mat = getMat ? getMat(X, Y, Z) : 0;
                if (isWater && isWater(mat)) continue;
                hit++;
                const col = colorOf ? colorOf(mat) : null;
                if (Array.isArray(col)) {
                  r += fin(col[0], 0.5);
                  g += fin(col[1], 0.5);
                  b += fin(col[2], 0.5);
                  n++;
                } else if (col && typeof col.r === "number") {
                  r += fin(col.r, 0.5);
                  g += fin(col.g, 0.5);
                  b += fin(col.b, 0.5);
                  n++;
                }
              }
            }
          }
          solid = total > 0 && hit / total >= SOLID_MIN;
        }
        if (solid && spanStart < 0) spanStart = yc;


        if (!solid && spanStart < 0 && n > 0) {
          r = 0;
          g = 0;
          b = 0;
          n = 0;
        }
        if (!solid && spanStart >= 0) {
          const yEnd = Math.min(yc, y1 + 1);                            
          boxes.push({
            c: [(xc + wx / 2) * vs, ((spanStart + yEnd) / 2) * vs, (zc + wz / 2) * vs],
            h: [(wx / 2) * vs, ((yEnd - spanStart) / 2) * vs, (wz / 2) * vs],
            color: n > 0 ? [r / n, g / n, b / n] : [0.45, 0.55, 0.35],
          });
          spanStart = -1;
          r = 0;
          g = 0;
          b = 0;
          n = 0;
          if (boxes.length >= cap) break;
        }
      }
    }
  }
  return boxes;
}
