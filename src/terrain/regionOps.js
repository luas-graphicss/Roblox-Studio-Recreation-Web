import { commands } from "../core/commands.js";
import { terrainStore } from "./terrainStore.js";
import { materialName } from "./materials.js";
import { applyFillRegion, applyReplaceRegion, regionStats } from "./regionCore.js";


function runRegionCommand(name, box, mutate) {
  const data = terrainStore.getData();
  const before = data.snapshotRegion(box.x0, box.y0, box.z0, box.x1, box.y1, box.z1);
  const changed = mutate(data);
  if (!changed) return 0;
  const after = data.snapshotRegion(box.x0, box.y0, box.z0, box.x1, box.y1, box.z1);


  commands.execute({
    name,
    do() { data.restoreRegion(after); terrainStore.notifyChanged(); return true; },
    undo() { data.restoreRegion(before); terrainStore.notifyChanged(); return true; },
  });
  return changed;
}


export function fillSelectedRegion(materialIndex) {
  const box = terrainStore.getRegionSelection();
  if (!box) return { ok: false, reason: "no-selection" };
  const mat = materialIndex == null ? terrainStore.getMaterial() : materialIndex | 0;
  const changed = runRegionCommand("Terrain Fill Region", box, (data) => applyFillRegion(data, box, mat));
  if (!changed) {
    return { ok: false, reason: "no-change", message: "A regiao ja esta preenchida com " + materialName(mat) + "." };
  }
  return { ok: true, changed, message: "Fill Region: " + changed + " voxel(s) preenchidos com " + materialName(mat) + "." };
}


export function replaceInSelectedRegion(fromMat, toMat) {
  const box = terrainStore.getRegionSelection();
  if (!box) return { ok: false, reason: "no-selection" };
  const from = fromMat | 0, to = toMat | 0;
  if (from === to) {
    return { ok: false, reason: "no-change", message: "Os materiais de origem e destino sao iguais." };
  }
  const changed = runRegionCommand("Terrain Replace Material", box, (data) => applyReplaceRegion(data, box, from, to));
  if (!changed) {
    return { ok: false, reason: "no-change", message: "Nenhum voxel de " + materialName(from) + " na regiao selecionada." };
  }
  return { ok: true, changed, message: "Replace: " + changed + " voxel(s) de " + materialName(from) + " para " + materialName(to) + "." };
}


export function selectedRegionStats() {
  const box = terrainStore.getRegionSelection();
  if (!box) return null;
  const stats = regionStats(terrainStore.getData(), box);
  stats.box = box;
  return stats;
}
