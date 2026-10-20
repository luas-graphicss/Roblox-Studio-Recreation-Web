import { CHUNK } from "../terrain/terrainData.js";
import { VOXEL_SIZE } from "../terrain/materials.js";
import {
  createTerrainSampler,
  syncTerrainSampler,
  densityAt,
  surfaceNormalAt,
} from "../terrain/terrainCollision.js";

const ISO = 0.5;                                             
const EMPTY_DENS = 1e-6;                                                       
const FAR_SD = VOXEL_SIZE * 4;                                              
const MAX_DEPTH = VOXEL_SIZE;                                                 
const BOUNDS_MARGIN = VOXEL_SIZE * 2;                                     


export function buildTerrainBodies(ENGINE, td) {
  const bodies = [];
  if (!ENGINE || !td || !td.chunks || td.chunks.size === 0) return bodies;


  const CS = CHUNK * VOXEL_SIZE;
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (const key of td.chunks.keys()) {
    const parts = String(key).split("|");
    const cx = Number(parts[0]), cy = Number(parts[1]), cz = Number(parts[2]);
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(cz)) continue;
    if (cx * CS < minX) minX = cx * CS;
    if (cy * CS < minY) minY = cy * CS;
    if (cz * CS < minZ) minZ = cz * CS;
    if ((cx + 1) * CS > maxX) maxX = (cx + 1) * CS;
    if ((cy + 1) * CS > maxY) maxY = (cy + 1) * CS;
    if ((cz + 1) * CS > maxZ) maxZ = (cz + 1) * CS;
  }
  if (!Number.isFinite(minX) || !Number.isFinite(maxX)) return bodies;

  const sampler = createTerrainSampler();

  const sample = (x, y, z) => {
    if (!Number.isFinite(x) || !Number.isFinite(y) || !Number.isFinite(z)) return null;
    syncTerrainSampler(sampler, td);                                  
    const dens = densityAt(sampler, td, x, y, z);
    if (dens <= EMPTY_DENS) return null;                               
    const n = surfaceNormalAt(sampler, td, x, y, z);
    if (!n) {

      if (dens < ISO) return null;
      return { sd: -MAX_DEPTH, nx: 0, ny: 1, nz: 0 };
    }
    let sd = (ISO - dens) / n.grad;
    if (sd < -MAX_DEPTH) sd = -MAX_DEPTH;
    else if (sd > FAR_SD) sd = FAR_SD;
    return { sd, nx: n.x, ny: n.y, nz: n.z };
  };

  const shape = new ENGINE.ImplicitSurface({
    sample,
    bounds: {
      min: { x: minX - BOUNDS_MARGIN, y: minY - BOUNDS_MARGIN, z: minZ - BOUNDS_MARGIN },
      max: { x: maxX + BOUNDS_MARGIN, y: maxY + BOUNDS_MARGIN, z: maxZ + BOUNDS_MARGIN },
    },
    maxDepth: MAX_DEPTH,
  });
  const body = new ENGINE.Body({ mass: 0, type: ENGINE.Body.STATIC });
  body.addShape(shape, shape.center);
  bodies.push(body);
  return bodies;
}
