import { commands } from "../core/commands.js";
import { selection } from "../core/selection.js";
import { store } from "../core/state.js";
import { createInstance, getService } from "../datamodel/index.js";
import { makeColor, makeVector3 } from "../datamodel/types.js";
import { CHUNK } from "./terrainData.js";
import { VOXEL_SIZE, isWaterMaterial, materialColorRGB, materialName } from "./materials.js";
import { terrainStore } from "./terrainStore.js";

export const TO_PARTS_MAX = 10000;                                        
const SOLID_MIN = 128;                                                                  


const PART_MATERIAL_OK = new Set([
  "Grass", "Sand", "Rock", "Sandstone", "Slate", "Concrete", "Brick",
  "Cobblestone", "Basalt", "CrackedLava", "Limestone", "Pavement", "Glacier",
  "Snow", "Ground", "Mud", "WoodPlanks", "Asphalt", "Ice", "Salt",
]);

function partMaterialFor(matIdx) {
  const name = materialName(matIdx);
  if (PART_MATERIAL_OK.has(name)) return name;
  if (name === "LeafyGrass") return "Grass";
  return "Plastic";
}

function live(i) {
  return i && i.__isInstance === true && typeof i.isDestroyed === "function" && !i.isDestroyed();
}

function workspaceRoot() {
  try {
    return getService(store.getDataModel(), "Workspace");
  } catch (_) {
    return null;
  }
}





export function planTerrainToParts(data) {
  const plan = { boxes: [], solid: 0, water: 0 };
  if (!data || data.isEmpty()) return plan;
  const N = CHUNK;
  const N2 = N * N;
  const VOL = N2 * N;
  for (const entry of data.getChunkEntries()) {
    const kp = entry.key.split("|");
    const cx = +kp[0], cy = +kp[1], cz = +kp[2];
    const occ = entry.occ, mat = entry.mat;

    const cell = new Int16Array(VOL);
    let any = false;
    for (let i = 0; i < VOL; i++) {
      if (occ[i] < SOLID_MIN) continue;
      if (isWaterMaterial(mat[i])) { plan.water++; continue; }
      cell[i] = mat[i] + 1;
      plan.solid++;
      any = true;
    }
    if (!any) continue;

    for (let z = 0; z < N; z++) {
      for (let y = 0; y < N; y++) {
        for (let x = 0; x < N; x++) {
          const i0 = x + N * y + N2 * z;
          const m = cell[i0];
          if (!m) continue;
          let w = 1;
          while (x + w < N && cell[i0 + w] === m) w++;
          let h = 1;
          loopY: while (y + h < N) {
            for (let k = 0; k < w; k++) {
              if (cell[x + k + N * (y + h) + N2 * z] !== m) break loopY;
            }
            h++;
          }
          let d = 1;
          loopZ: while (z + d < N) {
            for (let yy = 0; yy < h; yy++) {
              for (let k = 0; k < w; k++) {
                if (cell[x + k + N * (y + yy) + N2 * (z + d)] !== m) break loopZ;
              }
            }
            d++;
          }
          for (let zz = 0; zz < d; zz++) {
            for (let yy = 0; yy < h; yy++) {
              for (let k = 0; k < w; k++) cell[x + k + N * (y + yy) + N2 * (z + zz)] = 0;
            }
          }
          plan.boxes.push({ mat: m - 1, x0: cx * N + x, y0: cy * N + y, z0: cz * N + z, w, h, d });
          if (plan.boxes.length > TO_PARTS_MAX) return plan;                         
        }
      }
    }
  }
  return plan;
}


export function convertTerrainToParts(plan) {
  if (!plan || !Array.isArray(plan.boxes) || !plan.boxes.length) return null;
  if (plan.boxes.length > TO_PARTS_MAX) return null;
  const data = terrainStore.getData();
  if (!data || data.isEmpty()) return null;
  const ws = workspaceRoot();
  if (!live(ws)) return null;
  const model = createInstance("Model", { name: "Terrain Parts" });
  if (!model) return null;
  for (const b of plan.boxes) {
    const part = createInstance("Part", { name: materialName(b.mat), parent: model });
    if (!part) continue;
    part.setProperty("Anchored", true);
    part.setProperty("Size", makeVector3(b.w * VOXEL_SIZE, b.h * VOXEL_SIZE, b.d * VOXEL_SIZE));
    part.setProperty("Position", makeVector3(
      (b.x0 + b.w / 2) * VOXEL_SIZE,
      (b.y0 + b.h / 2) * VOXEL_SIZE,
      (b.z0 + b.d / 2) * VOXEL_SIZE,
    ));
    const rgb = materialColorRGB(b.mat);
    part.setProperty("Color", makeColor(rgb[0], rgb[1], rgb[2]));
    part.setProperty("Material", partMaterialFor(b.mat));
  }
  const before = data.exportAll();
  const empty = { chunks: [], min: null, max: null };
  const prevSel = selection.get();
  const ok = commands.execute({
    name: "Terrain to Parts",
    do() {
      if (model.isDestroyed() || !live(ws)) return false;
      model.setParent(ws);
      data.importAll(empty);
      terrainStore.notifyChanged();
      selection.set([model]);
      return true;
    },
    undo() {
      if (live(model)) model.setParent(null);
      data.importAll(before);
      terrainStore.notifyChanged();
      selection.set((prevSel || []).filter(live));
    },
  });
  return ok ? model : null;
}
