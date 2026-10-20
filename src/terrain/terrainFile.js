import { TerrainData } from "./terrainData.js";
import {
  TERRAIN_MATERIALS, MATERIAL_COUNT, VOXEL_SIZE,
  hasMaterialName, materialIndexByName,
} from "./materials.js";
import { encodeTerrain, decodeTerrainInto } from "../persistence/serializer.js";

export const TERRAIN_FILE_FORMAT = "rsw-terrain";
export const TERRAIN_FILE_VERSION = 1;
export const TERRAIN_FILE_EXT = ".rswterrain";

export const MAX_TERRAIN_FILE_BYTES = 50 * 1024 * 1024;

export const MAX_TERRAIN_FILE_CHUNKS = 65536;

function warnPush(warnings, msg) {
  if (Array.isArray(warnings)) warnings.push(msg);
}


export function encodeTerrainFile(data, colors) {
  if (!data || typeof data.isEmpty !== "function" || data.isEmpty()) return null;
  const terrain = encodeTerrain(data);
  if (!terrain || !Array.isArray(terrain.chunks) || terrain.chunks.length === 0) return null;
  let voxels = 0;
  for (const e of data.getChunkEntries()) voxels += e.count | 0;
  const file = {
    format: TERRAIN_FILE_FORMAT,
    formatVersion: TERRAIN_FILE_VERSION,
    savedAt: new Date().toISOString(),
    voxelSize: VOXEL_SIZE,
    chunkSize: terrain.chunkSize,
    materials: TERRAIN_MATERIALS.map((m) => m.name),
    counts: { chunks: terrain.chunks.length, voxels },
    terrain,
  };
  if (Array.isArray(colors) && colors.length) file.materialColors = colors;
  return file;
}



function buildMaterialMap(names, warnings) {
  const map = new Uint8Array(256);
  const unknown = new Uint8Array(256);
  let identity = true;
  const hasNames = Array.isArray(names) && names.length > 0;
  const n = hasNames ? Math.min(names.length, 256) : 0;
  if (!hasNames) {
    warnPush(warnings, "Arquivo sem lista de materiais; índices usados como estão na paleta atual.");
  }
  for (let i = 0; i < 256; i++) {
    let to;
    if (i < n) {
      const nm = names[i];
      if (typeof nm === "string" && hasMaterialName(nm)) {
        to = materialIndexByName(nm);
      } else {
        to = 0;
        unknown[i] = 1;
      }
    } else if (i < MATERIAL_COUNT) {
      to = i;                                                     
    } else {
      to = 0;                        
      unknown[i] = 1;
    }
    map[i] = to & 0xff;
    if (map[i] !== i) identity = false;
  }
  return { map, unknown, identity };
}


export function decodeTerrainFile(obj, warnings) {
  try {
    if (!obj || typeof obj !== "object" || Array.isArray(obj)) {
      return { ok: false, error: "O arquivo não é um terreno válido." };
    }
    if (obj.format !== TERRAIN_FILE_FORMAT) {
      return { ok: false, error: `Formato desconhecido (esperado "${TERRAIN_FILE_FORMAT}").` };
    }
    const ver = Number(obj.formatVersion) || 0;
    if (ver > TERRAIN_FILE_VERSION) {
      warnPush(warnings, `Arquivo de versão mais nova (v${ver}); lendo como v${TERRAIN_FILE_VERSION} — partes podem ser ignoradas.`);
    }
    if (obj.voxelSize != null && Number(obj.voxelSize) !== VOXEL_SIZE) {
      warnPush(warnings, `voxelSize ${obj.voxelSize} difere do editor (${VOXEL_SIZE}); posições mantidas em voxels.`);
    }
    const terrain = obj.terrain;
    if (!terrain || typeof terrain !== "object" || !Array.isArray(terrain.chunks) || terrain.chunks.length === 0) {
      return { ok: false, error: "O arquivo não contém chunks de terreno." };
    }
    let capped = terrain;
    if (terrain.chunks.length > MAX_TERRAIN_FILE_CHUNKS) {
      warnPush(warnings, `Arquivo com ${terrain.chunks.length} chunks; aplicando os primeiros ${MAX_TERRAIN_FILE_CHUNKS} (orçamento).`);
      capped = { v: terrain.v, chunkSize: terrain.chunkSize, chunks: terrain.chunks.slice(0, MAX_TERRAIN_FILE_CHUNKS) };
    }

    const tmp = new TerrainData();
    decodeTerrainInto(tmp, capped, warnings);
    if (tmp.isEmpty()) {
      return { ok: false, error: "Nenhum voxel válido no arquivo." };
    }

    const { map, unknown, identity } = buildMaterialMap(obj.materials, warnings);
    let chunks = 0, voxels = 0, remapped = 0, unknownVox = 0;
    for (const entry of tmp.getChunkEntries()) {
      chunks += 1;
      voxels += entry.count | 0;
      if (identity) continue;
      const mat = entry.mat, occ = entry.occ;
      for (let i = 0; i < mat.length; i++) {
        if (occ[i] === 0) continue;
        const from = mat[i];
        const to = map[from];
        if (to !== from) {
          mat[i] = to;
          remapped += 1;
        }
        if (unknown[from]) unknownVox += 1;
      }
    }
    if (remapped > 0) warnPush(warnings, `${remapped} voxel(s) remapeado(s) pela paleta por nome.`);
    if (unknownVox > 0) warnPush(warnings, `${unknownVox} voxel(s) com material desconhecido convertido(s) para Grass.`);


    let colors = null;
    if (Array.isArray(obj.materialColors)) {
      colors = [];
      for (const e of obj.materialColors) {
        if (e && typeof e.name === "string" && hasMaterialName(e.name) && e.rgb != null) {
          colors.push({ name: e.name, rgb: e.rgb });
        }
      }
    }
    return {
      ok: true,
      snapshot: tmp.exportAll(),
      stats: { chunks, voxels, remapped, unknown: unknownVox },
      materialColors: colors,
    };
  } catch (e) {
    return { ok: false, error: (e && e.message) || "Erro desconhecido ao decodificar o terreno." };
  }
}
