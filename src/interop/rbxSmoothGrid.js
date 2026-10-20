export const SMOOTH_GRID_LIMITS = {
  maxBytes: 64 * 1024 * 1024,                  
  maxChunkSizeLog2: 7,
  maxInternalChunks: 65536,
  maxVoxels: 40000000,
};


export const SMOOTH_GRID_MATERIALS = Object.freeze([
  "Air", "Water", "Grass", "Slate", "Concrete", "Brick", "Sand", "WoodPlanks",
  "Rock", "Glacier", "Snow", "Sandstone", "Mud", "Basalt", "Ground", "CrackedLava",
  "Asphalt", "Cobblestone", "Ice", "LeafyGrass", "Salt", "Limestone", "Pavement",
]);


export const SMOOTH_GRID_TOLERANT_VERSION = "smoothgrid-tolerant-1";

const INTERNAL_VOLUME = 16 * 16 * 16;
const ENGINE_MAX_LOG2 = 8;
const MAX_PLAUSIBLE_COORD = 100000;
const MATERIAL_COLORS_BYTES = 69;
const MATERIAL_COLORS_RESERVED = 6;


const TOLERANT_MAX_LOG2 = 12;
const TOLERANT_CANDIDATE_LOG2S = Object.freeze([5, 6, 4, 7, 8, 3]);
const TOLERANT_MAX_DISCARDS = 64;
const TOLERANT_RESYNC_TRIES = 4096;
const TOLERANT_RESYNC_BYTES = 65536;
const TOLERANT_PROBE_BYTES = 1 << 20;
const TOLERANT_MAX_RUN_ENTRIES = 1 << 20;                               
const TOLERANT_MAX_FILE_CHUNKS = 1 << 17;
const TOLERANT_AIR_SCAN_BYTES = 4 * 1024 * 1024;

const decoderRegistry = new Map();

function warnPush(warnings, msg) {
  if (Array.isArray(warnings)) warnings.push(msg);
}

function makeStats() {
  return {
    rbxChunks: 0, internalChunks: 0, voxels: 0, runs: 0, unknownMaterials: 0, truncatedAt: -1,


    occCells: 0, chunksWritten: 0, chunksDiscarded: 0,
  };
}

function emptyResult(layout, version, log2) {
  return {
    ok: false,
    partial: false,
    layout: layout === "legacyRsw" ? "legacyRsw" : "roblox",
    version: Number.isFinite(version) ? version | 0 : 0,
    chunkSizeLog2: Number.isFinite(log2) ? log2 | 0 : 0,
    chunks: [],
    stats: makeStats(),
  };
}

function toUint8(input) {
  if (input instanceof Uint8Array) return input;
  if (typeof ArrayBuffer !== "undefined") {
    if (input instanceof ArrayBuffer) return new Uint8Array(input);
    if (ArrayBuffer.isView(input)) return new Uint8Array(input.buffer, input.byteOffset, input.byteLength);
  }
  if (Array.isArray(input)) return Uint8Array.from(input, (v) => (Number.isFinite(v) ? v & 0xff : 0));
  return null;
}

function normalizeOpts(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const layout = o.layout === "roblox" || o.layout === "legacyRsw" ? o.layout : "auto";
  let map = null;
  if (o.materialMap && typeof o.materialMap.length === "number" && o.materialMap.length > 0) {
    map = o.materialMap;
  }
  let fallback = -1;
  if (typeof o.fallbackMaterial === "number" && Number.isFinite(o.fallbackMaterial) &&
      o.fallbackMaterial >= 0 && o.fallbackMaterial <= 255) {
    fallback = o.fallbackMaterial | 0;
  }
  return { layout, map, fallback };
}






function decodeBody(b, layout, log2, warn, map, fallback, version) {
  const size = 1 << log2;
  const sizeSq = size * size;
  const volume = size * size * size;
  const stats = makeStats();
  const chunkMap = new Map();
  let cacheKey = null;
  let cacheChunk = null;
  let partial = false;
  let writing = true;
  let budgetReason = null;
  let writtenChunks = 0;
  let unknownCells = 0;
  let anyIdImplausible = false;
  let firstChunkFailed = false;
  let offset = 2;
  let lastX = 0;
  let lastY = 0;
  let lastZ = 0;
  const end = b.length;

  const truncate = (at, msg) => {
    if (stats.truncatedAt < 0) stats.truncatedAt = at;
    partial = true;
    if (stats.rbxChunks === 0) firstChunkFailed = true;
    if (msg) warn(msg);
  };

  const getChunk = (icx, icy, icz) => {
    const key = icx + "|" + icy + "|" + icz;
    if (key === cacheKey) return cacheChunk;
    let ch = chunkMap.get(key);
    if (!ch) {
      if (chunkMap.size >= SMOOTH_GRID_LIMITS.maxInternalChunks) return null;
      ch = { cx: icx, cy: icy, cz: icz, mat: new Uint8Array(INTERNAL_VOLUME), occ: new Uint8Array(INTERNAL_VOLUME) };
      chunkMap.set(key, ch);
    }
    cacheKey = key;
    cacheChunk = ch;
    return ch;
  };

  outer:
  while (offset < end) {
    if (end - offset < 12) {
      truncate(offset, `SmoothGrid truncado no id de chunk (offset ${offset}); mantendo o que já foi lido.`);
      break;
    }
    let cx;
    let cy;
    let cz;
    if (layout === "roblox") {
      const o = offset;
      const dx = ((b[o] << 24) | (b[o + 3] << 16) | (b[o + 6] << 8) | b[o + 9]) | 0;
      const dy = ((b[o + 1] << 24) | (b[o + 4] << 16) | (b[o + 7] << 8) | b[o + 10]) | 0;
      const dz = ((b[o + 2] << 24) | (b[o + 5] << 16) | (b[o + 8] << 8) | b[o + 11]) | 0;
      lastX = (lastX + dx) | 0;
      lastY = (lastY + dy) | 0;
      lastZ = (lastZ + dz) | 0;
      cx = lastX;
      cy = lastY;
      cz = lastZ;
    } else {
      const o = offset;
      cx = (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) | 0;
      cy = (b[o + 4] | (b[o + 5] << 8) | (b[o + 6] << 16) | (b[o + 7] << 24)) | 0;
      cz = (b[o + 8] | (b[o + 9] << 8) | (b[o + 10] << 16) | (b[o + 11] << 24)) | 0;
    }
    if (Math.abs(cx) > MAX_PLAUSIBLE_COORD || Math.abs(cy) > MAX_PLAUSIBLE_COORD || Math.abs(cz) > MAX_PLAUSIBLE_COORD) {
      anyIdImplausible = true;
      truncate(offset, `SmoothGrid: coordenada de chunk implausível (${cx}, ${cy}, ${cz}) no offset ${offset}; leitura interrompida.`);
      break;
    }
    offset += 12;
    const baseX = cx * size;
    const baseY = cy * size;
    const baseZ = cz * size;
    let cursor = 0;
    let corruptStop = false;
    while (cursor < volume) {
      if (offset >= end) {
        truncate(offset, `SmoothGrid truncado no meio do chunk (${cx}, ${cy}, ${cz}); mantendo o que já foi lido.`);
        break outer;
      }
      const meta = b[offset++];
      const m = meta & 0x3f;
      let occ = 255;
      if (meta & 0x40) {
        if (offset >= end) {
          truncate(offset, "SmoothGrid truncado (byte de occupancy faltando); mantendo o que já foi lido.");
          break outer;
        }
        occ = b[offset++];
        if (layout === "legacyRsw") occ = occ >= 255 ? 255 : occ + 1;
      }
      let count = 1;
      if (meta & 0x80) {
        if (offset >= end) {
          truncate(offset, "SmoothGrid truncado (contador de run faltando); mantendo o que já foi lido.");
          break outer;
        }
        count = b[offset++] + 1;
      }
      stats.runs += 1;
      if (cursor + count > volume) {
        count = volume - cursor;
        corruptStop = true;
        truncate(offset - 1, `SmoothGrid: run excede o volume do chunk (${cx}, ${cy}, ${cz}); chunk fechado e leitura interrompida.`);
      }
      if (m !== 0 && occ !== 0 && count > 0) {
        stats.occCells += count;
        let mapped;
        if (m >= SMOOTH_GRID_MATERIALS.length) {
          unknownCells += count;
          mapped = fallback;
        } else if (map) {
          const v = map[m];
          if (v === -1) {
            unknownCells += count;
            mapped = -1;                                           
          } else if (v == null || !Number.isFinite(v) || v < 0 || v > 255) {
            unknownCells += count;
            mapped = fallback;
          } else {
            mapped = v | 0;
          }
        } else {
          mapped = m;              
        }
        if (mapped >= 0) {
          for (let k = 0; k < count; k++) {
            if (!writing) break;
            if (stats.voxels >= SMOOTH_GRID_LIMITS.maxVoxels) {
              writing = false;
              if (!budgetReason) budgetReason = "maxVoxels";
              break;
            }
            const i = cursor + k;
            const lx = i % size;
            const t = (i / size) | 0;
            let ly;
            let lz;
            if (layout === "roblox") {
              lz = t % size;
              ly = (i / sizeSq) | 0;
            } else {
              ly = t % size;
              lz = (i / sizeSq) | 0;
            }
            const gx = baseX + lx;
            const gy = baseY + ly;
            const gz = baseZ + lz;
            const ch = getChunk(gx >> 4, gy >> 4, gz >> 4);
            if (!ch) {
              writing = false;
              if (!budgetReason) budgetReason = "maxInternalChunks";
              break;
            }
            const idx = (gx & 15) | ((gy & 15) << 4) | ((gz & 15) << 8);
            if (ch.occ[idx] === 0) stats.voxels += 1;
            ch.mat[idx] = mapped;
            ch.occ[idx] = occ;
          }
        }
      }
      cursor += count;
    }
    if (cursor >= volume) {
      stats.rbxChunks += 1;
      if (writing) writtenChunks += 1;
      if (corruptStop) break;
    }
  }

  if (budgetReason) {
    partial = true;
    warn(`SmoothGrid: terreno importado parcialmente (${writtenChunks} de ${stats.rbxChunks} chunks; orçamento ${budgetReason} atingido).`);
  }
  if (unknownCells > 0) {
    stats.unknownMaterials = unknownCells;
    warn(fallback >= 0
      ? `SmoothGrid: ${unknownCells} célula(s) com material desconhecido convertida(s) para o material reserva ${fallback} (aviso agregado).`
      : `SmoothGrid: ${unknownCells} célula(s) com material desconhecido/descartado ignorada(s) (aviso agregado).`);
  }
  const chunks = [];
  for (const ch of chunkMap.values()) chunks.push(ch);
  stats.internalChunks = chunks.length;
  stats.chunksWritten = writtenChunks;
  const result = {
    ok: stats.voxels > 0,
    partial,
    layout,
    version: Number.isFinite(version) ? version | 0 : 0,
    chunkSizeLog2: log2,
    chunks,
    stats,
  };
  return { result, rejectForAuto: anyIdImplausible || firstChunkFailed };
}











function tolerantParseChunk(b, start, size, layout, prevX, prevY, prevZ, byteBudget) {
  const end = b.length;
  if (end - start < 12) return { ok: false, reason: "cabeçalho de chunk incompleto", next: end };
  const o = start;
  let cx;
  let cy;
  let cz;
  if (layout === "roblox") {
    const dx = ((b[o] << 24) | (b[o + 3] << 16) | (b[o + 6] << 8) | b[o + 9]) | 0;
    const dy = ((b[o + 1] << 24) | (b[o + 4] << 16) | (b[o + 7] << 8) | b[o + 10]) | 0;
    const dz = ((b[o + 2] << 24) | (b[o + 5] << 16) | (b[o + 8] << 8) | b[o + 11]) | 0;
    cx = (prevX + dx) | 0;
    cy = (prevY + dy) | 0;
    cz = (prevZ + dz) | 0;
  } else {
    cx = (b[o] | (b[o + 1] << 8) | (b[o + 2] << 16) | (b[o + 3] << 24)) | 0;
    cy = (b[o + 4] | (b[o + 5] << 8) | (b[o + 6] << 16) | (b[o + 7] << 24)) | 0;
    cz = (b[o + 8] | (b[o + 9] << 8) | (b[o + 10] << 16) | (b[o + 11] << 24)) | 0;
  }
  if (Math.abs(cx) > MAX_PLAUSIBLE_COORD || Math.abs(cy) > MAX_PLAUSIBLE_COORD || Math.abs(cz) > MAX_PLAUSIBLE_COORD) {
    return { ok: false, reason: "coordenada de chunk implausível", next: start + 12 };
  }
  const volume = size * size * size;
  const limit = byteBudget > 0 ? Math.min(end, start + 12 + byteBudget) : end;
  let offset = start + 12;
  let cursor = 0;
  const runs = [];
  let occCells = 0;
  while (cursor < volume) {
    if (offset >= limit) {
      return {
        ok: false,
        reason: offset >= end ? "chunk não fecha o volume declarado" : "chunk grande demais para a sondagem",
        next: end,
      };
    }
    const meta = b[offset++];
    const m = meta & 0x3f;
    let occ = 255;
    if (meta & 0x40) {
      if (offset >= limit) return { ok: false, reason: "byte de occupancy faltando", next: end };
      occ = b[offset++];
      if (layout === "legacyRsw") occ = occ >= 255 ? 255 : occ + 1;
    }
    let count = 1;
    if (meta & 0x80) {
      if (offset >= limit) return { ok: false, reason: "contador de run faltando", next: end };
      count = b[offset++] + 1;
    }
    if (cursor + count > volume) {
      return { ok: false, reason: "run excede o volume do chunk", next: offset };
    }
    if (m !== 0 && occ !== 0) {
      if (runs.length >= TOLERANT_MAX_RUN_ENTRIES) {
        return { ok: false, reason: "chunk com runs demais", next: offset };
      }
      runs.push(cursor, count, m, occ);
      occCells += count;
    }
    cursor += count;
  }
  return { ok: true, next: offset, cx, cy, cz, runs, occCells };
}

function tolerantScanConfig(b, layout, log2) {
  const size = 1 << log2;
  const chunks = [];
  const discardReasons = [];
  let discarded = 0;
  let totalOcc = 0;
  let consumed = 0;
  let prevX = 0;
  let prevY = 0;
  let prevZ = 0;
  let offset = 2;
  let resyncBytes = 0;
  const end = b.length;
  while (offset < end && chunks.length < TOLERANT_MAX_FILE_CHUNKS) {
    if (offset > TOLERANT_AIR_SCAN_BYTES && totalOcc === 0) break;                                 
    const r = tolerantParseChunk(b, offset, size, layout, prevX, prevY, prevZ, 0);
    if (r.ok) {
      chunks.push({ cx: r.cx, cy: r.cy, cz: r.cz, runs: r.runs, occCells: r.occCells });
      totalOcc += r.occCells;
      consumed += r.next - offset;
      prevX = r.cx;
      prevY = r.cy;
      prevZ = r.cz;
      offset = r.next;
      continue;
    }
    discarded += 1;
    if (discardReasons.length < TOLERANT_MAX_DISCARDS && discardReasons.indexOf(r.reason) === -1) {
      discardReasons.push(r.reason);
    }


    let found = -1;
    let tries = 0;
    for (let p = offset + 1; p < end && tries < TOLERANT_RESYNC_TRIES && resyncBytes < TOLERANT_RESYNC_BYTES; p++, tries++, resyncBytes++) {
      const probe = tolerantParseChunk(b, p, size, layout, prevX, prevY, prevZ, TOLERANT_PROBE_BYTES);
      if (probe.ok) {
        found = p;
        break;
      }
    }
    if (found < 0) break;
    offset = found;
  }
  return { chunks, discarded, discardReasons, totalOcc, consumed };
}

function tolerantCommit(pick, map, fallback, version) {
  const layout = pick.layout;
  const log2 = pick.log2;
  const cfg = pick.cfg;
  const size = 1 << log2;
  const sizeSq = size * size;
  const stats = makeStats();
  const chunkMap = new Map();
  let cacheKey = null;
  let cacheChunk = null;
  let writing = true;
  let budgetReason = null;
  let unknownCells = 0;
  let skippedChunks = 0;
  let skippedCells = 0;
  let minX = Infinity;
  let minY = Infinity;
  let minZ = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  let maxZ = -Infinity;

  const getChunk16 = (icx, icy, icz) => {
    const key = icx + "|" + icy + "|" + icz;
    if (key === cacheKey) return cacheChunk;
    let ch = chunkMap.get(key);
    if (!ch) {
      if (chunkMap.size >= SMOOTH_GRID_LIMITS.maxInternalChunks) return null;
      ch = { cx: icx, cy: icy, cz: icz, mat: new Uint8Array(INTERNAL_VOLUME), occ: new Uint8Array(INTERNAL_VOLUME) };
      chunkMap.set(key, ch);
    }
    cacheKey = key;
    cacheChunk = ch;
    return ch;
  };


  const ordered = cfg.chunks.slice().sort((a, c) => {
    const da = Math.abs(a.cx) + Math.abs(a.cy) + Math.abs(a.cz);
    const dc = Math.abs(c.cx) + Math.abs(c.cy) + Math.abs(c.cz);
    const sa = a.occCells / (1 + da);
    const sc = c.occCells / (1 + dc);
    if (sa !== sc) return sc - sa;
    if (da !== dc) return da - dc;
    return (a.cx - c.cx) || (a.cy - c.cy) || (a.cz - c.cz);
  });

  stats.rbxChunks = cfg.chunks.length;
  for (const ch of ordered) {
    stats.occCells += ch.occCells;
    if (!writing) {
      skippedChunks += 1;
      skippedCells += ch.occCells;
      continue;
    }
    const baseX = ch.cx * size;
    const baseY = ch.cy * size;
    const baseZ = ch.cz * size;
    let wroteAny = false;
    const runs = ch.runs;
    for (let ri = 0; ri < runs.length; ri += 4) {
      const at = runs[ri];
      const count = runs[ri + 1];
      const m = runs[ri + 2];
      const occ = runs[ri + 3];
      stats.runs += 1;
      let mapped;
      if (m >= SMOOTH_GRID_MATERIALS.length) {
        unknownCells += count;
        mapped = fallback;
      } else if (map) {
        const v = map[m];
        if (v === -1) {
          unknownCells += count;
          mapped = -1;
        } else if (v == null || !Number.isFinite(v) || v < 0 || v > 255) {
          unknownCells += count;
          mapped = fallback;
        } else {
          mapped = v | 0;
        }
      } else {
        mapped = m;
      }
      if (mapped < 0) continue;
      for (let k = 0; k < count; k++) {
        if (stats.voxels >= SMOOTH_GRID_LIMITS.maxVoxels) {
          writing = false;
          if (!budgetReason) budgetReason = "maxVoxels";
          break;
        }
        const i = at + k;
        const lx = i % size;
        const t = (i / size) | 0;
        let ly;
        let lz;
        if (layout === "roblox") {
          lz = t % size;
          ly = (i / sizeSq) | 0;
        } else {
          ly = t % size;
          lz = (i / sizeSq) | 0;
        }
        const gx = baseX + lx;
        const gy = baseY + ly;
        const gz = baseZ + lz;
        const c16 = getChunk16(gx >> 4, gy >> 4, gz >> 4);
        if (!c16) {
          writing = false;
          if (!budgetReason) budgetReason = "maxInternalChunks";
          break;
        }
        const idx = (gx & 15) | ((gy & 15) << 4) | ((gz & 15) << 8);
        if (c16.occ[idx] === 0) stats.voxels += 1;
        c16.mat[idx] = mapped;
        c16.occ[idx] = occ;
        wroteAny = true;
        if (gx < minX) minX = gx;
        if (gy < minY) minY = gy;
        if (gz < minZ) minZ = gz;
        if (gx > maxX) maxX = gx;
        if (gy > maxY) maxY = gy;
        if (gz > maxZ) maxZ = gz;
      }
      if (!writing) break;
    }
    if (wroteAny) {
      stats.chunksWritten += 1;
    } else if (!writing) {
      skippedChunks += 1;
      skippedCells += ch.occCells;
    }
  }

  if (unknownCells > 0) stats.unknownMaterials = unknownCells;
  stats.chunksDiscarded = cfg.discarded;
  const chunks = [];
  for (const c of chunkMap.values()) chunks.push(c);
  stats.internalChunks = chunks.length;
  return {
    ok: stats.voxels > 0,
    partial: true,
    layout,
    version: Number.isFinite(version) ? version | 0 : 0,
    chunkSizeLog2: log2,
    chunks,
    stats,
    tolerant: true,
    summary: {
      tolerantVersion: SMOOTH_GRID_TOLERANT_VERSION,
      skippedChunks,
      skippedCells,
      budgetReason,
      discardReasons: cfg.discardReasons.slice(0, 8),
      bbox: minX !== Infinity ? { min: [minX, minY, minZ], max: [maxX, maxY, maxZ] } : null,
    },
  };
}

function tolerantScan(b, warnings, mapOpts, version, declaredLog2) {
  try {
    if (!b || b.length < 15) return null;
    const candidates = [];
    if (declaredLog2 != null) {
      const d = declaredLog2 | 0;
      if (d >= 3 && d <= TOLERANT_MAX_LOG2) candidates.push(d);
    } else {
      const header = b[1] | 0;
      if (header >= 3 && header <= TOLERANT_MAX_LOG2) candidates.push(header);
      for (const l of TOLERANT_CANDIDATE_LOG2S) {
        if (candidates.indexOf(l) === -1) candidates.push(l);
      }
    }
    if (!candidates.length) return null;
    let best = null;
    for (const layoutTry of ["roblox", "legacyRsw"]) {
      for (const log2Try of candidates) {
        const cfg = tolerantScanConfig(b, layoutTry, log2Try);
        if (!cfg.chunks.length || cfg.totalOcc <= 0) continue;


        const score = cfg.consumed * 1048576 - cfg.discarded * 1024 + Math.min(cfg.totalOcc, 1023);
        if (!best || score > best.score) {
          best = { layout: layoutTry, log2: log2Try, cfg, score };
        }
      }
    }
    if (!best) return null;
    const result = tolerantCommit(best, mapOpts.map, mapOpts.fallback, version);
    if (!result || !(result.stats.voxels > 0)) return null;
    warnPush(warnings, `SmoothGrid (${SMOOTH_GRID_TOLERANT_VERSION}): varredura estrutural recuperou ${result.stats.chunksWritten} de ${result.stats.rbxChunks} chunk(s) válido(s) (layout ${best.layout}, chunk ${1 << best.log2}³)${best.cfg.discarded > 0 ? `; ${best.cfg.discarded} candidato(s) inválido(s) descartado(s)` : ""}.`);
    if (result.summary.budgetReason) {
      warnPush(warnings, `SmoothGrid (leitura tolerante): orçamento ${result.summary.budgetReason} atingido — ${result.summary.skippedChunks} chunk(s) válido(s) (${result.summary.skippedCells} célula(s)) ficaram de fora; prioridade para os chunks mais densos e próximos da origem.`);
    }
    if (result.stats.unknownMaterials > 0) {
      warnPush(warnings, mapOpts.fallback >= 0
        ? `SmoothGrid: ${result.stats.unknownMaterials} célula(s) com material desconhecido convertida(s) para o material reserva ${mapOpts.fallback} (aviso agregado).`
        : `SmoothGrid: ${result.stats.unknownMaterials} célula(s) com material desconhecido/descartado ignorada(s) (aviso agregado).`);
    }
    return result;
  } catch (_) {
    return null;
  }
}


function appendImportSummary(result, warnings) {
  try {
    if (!result || !result.ok || !result.stats) return;
    const st = result.stats;
    const sm = result.summary && typeof result.summary === "object" ? result.summary : null;
    const discarded = st.chunksDiscarded | 0;
    const skipped = sm
      ? sm.skippedChunks | 0
      : Math.max(0, (st.rbxChunks | 0) - (st.chunksWritten | 0));
    if (!(result.partial || result.tolerant || discarded > 0 || skipped > 0)) return;
    const pct = st.occCells > 0
      ? Math.max(0, Math.min(100, Math.round((st.voxels / st.occCells) * 100)))
      : 100;
    let msg = `Terreno importado: ${st.chunksWritten | 0} de ${st.rbxChunks | 0} chunk(s) do arquivo, ` +
      `${st.voxels | 0} voxel(s) (~${pct}% das células ocupadas), versão ${result.version | 0} ` +
      `(layout ${result.layout}${result.tolerant ? " tolerante" : ""})`;
    if (discarded > 0) {
      const reasons = sm && Array.isArray(sm.discardReasons) && sm.discardReasons.length
        ? ` — motivos: ${sm.discardReasons.join("; ")}`
        : "";
      msg += `; ${discarded} chunk(s) descartado(s) por corrupção${reasons}`;
    }
    if (skipped > 0) {
      msg += `; ${skipped} chunk(s) fora do orçamento`;
      if (sm && (sm.skippedCells | 0) > 0) msg += ` (${sm.skippedCells | 0} célula(s) deixadas de fora)`;
    }
    if (sm && sm.bbox && Array.isArray(sm.bbox.min) && Array.isArray(sm.bbox.max)) {
      msg += `; bbox importada [${sm.bbox.min.join(",")}]..[${sm.bbox.max.join(",")}] (voxels)`;
    }
    warnPush(warnings, msg + ".");
  } catch (_) {

  }
}


export function decodeSmoothGridBytes(bytes, warnings, opts) {
  try {
    return decodeInner(bytes, warnings, opts);
  } catch (_) {


    try {
      let b = toUint8(bytes);
      if (b && b.length > SMOOTH_GRID_LIMITS.maxBytes) b = b.subarray(0, SMOOTH_GRID_LIMITS.maxBytes);
      const norm = normalizeOpts(opts);
      const t = b && b.length >= 15 ? tolerantScan(b, warnings, { map: norm.map, fallback: norm.fallback }, b[0], null) : null;
      if (t) {
        warnPush(warnings, "SmoothGrid: erro interno no decodificador v1; recuperação tolerante por chunk aplicada.");
        appendImportSummary(t, warnings);
        return t;
      }
    } catch (_2) {

    }
    const r = emptyResult("roblox", 0, 0);
    r.partial = true;
    warnPush(warnings, "SmoothGrid: erro interno no decodificador; terreno ignorado (reporte o arquivo).");
    return r;
  }
}

function decodeInner(bytes, warnings, opts) {
  const { layout, map, fallback } = normalizeOpts(opts);
  let b = toUint8(bytes);
  if (!b || b.length < 2) {
    warnPush(warnings, "SmoothGrid vazio ou curto demais; terreno ignorado.");
    return emptyResult(layout, 0, 0);
  }
  let capped = false;
  if (b.length > SMOOTH_GRID_LIMITS.maxBytes) {
    warnPush(warnings, `SmoothGrid com ${b.length} bytes excede o orçamento maxBytes (${SMOOTH_GRID_LIMITS.maxBytes}); decodificando só o começo.`);
    b = b.subarray(0, SMOOTH_GRID_LIMITS.maxBytes);
    capped = true;
  }
  const version = b[0];
  const log2 = b[1];

  if (version !== 1) {
    const fn = decoderRegistry.get(version | 0);
    if (typeof fn === "function") {
      let custom = null;
      let threw = false;
      try {
        custom = fn(b, warnings, opts);
      } catch (_) {
        threw = true;
      }
      if (!threw && custom && typeof custom === "object" && Array.isArray(custom.chunks) &&
          custom.stats && typeof custom.stats === "object") {
        return custom;
      }
      warnPush(warnings, `SmoothGrid: decodificador registrado para a versão ${version} ${threw ? "falhou" : "devolveu resultado inválido"}; tentando o layout v1.`);
    } else {
      warnPush(warnings, `SmoothGrid versão ${version} não suportada (reporte o arquivo).`);
    }
    if (!(log2 >= 0 && log2 <= ENGINE_MAX_LOG2)) {


      const t = tolerantScan(b, warnings, { map, fallback }, version, null);
      if (t) {
        if (capped) t.partial = true;
        appendImportSummary(t, warnings);
        return t;
      }
      warnPush(warnings, "SmoothGrid: leitura tolerante não recuperou nenhum chunk válido; terreno ignorado.");
      return emptyResult(layout, version, log2);
    }

  }

  if (log2 > SMOOTH_GRID_LIMITS.maxChunkSizeLog2) {
    warnPush(warnings, `SmoothGrid: chunkSizeLog2=${log2} não suportado (limite ${SMOOTH_GRID_LIMITS.maxChunkSizeLog2}, engine aceita até ${ENGINE_MAX_LOG2}); tentando leitura tolerante por chunk.`);


    const t = log2 <= TOLERANT_MAX_LOG2 ? tolerantScan(b, warnings, { map, fallback }, version, log2) : null;
    if (t) {
      if (capped) t.partial = true;
      warnPush(warnings, `SmoothGrid: chunks de ${1 << log2}³ do arquivo subdivididos em chunks internos de 16³ (sem perda de resolução).`);
      appendImportSummary(t, warnings);
      return t;
    }
    warnPush(warnings, "SmoothGrid: leitura tolerante não recuperou nenhum chunk válido; terreno ignorado.");
    return emptyResult(layout, version, log2);
  }



  const finish = (res) => {
    if (version !== 1) {
      if (!(res.stats && res.stats.voxels > 0)) {
        const t = tolerantScan(b, warnings, { map, fallback }, version, null);
        if (t) {
          if (capped) t.partial = true;
          appendImportSummary(t, warnings);
          return t;
        }
      }
      res.partial = true;
      res.tolerant = true;
    }
    if (capped) res.partial = true;
    appendImportSummary(res, warnings);
    return res;
  };

  if (layout !== "auto") {
    const buf = [];
    const attempt = decodeBody(b, layout, log2, (msg) => buf.push(msg), map, fallback, version);
    for (const msg of buf) warnPush(warnings, msg);
    return finish(attempt.result);
  }

  const bufR = [];
  const attemptR = decodeBody(b, "roblox", log2, (msg) => bufR.push(msg), map, fallback, version);
  if (!attemptR.rejectForAuto) {
    for (const msg of bufR) warnPush(warnings, msg);
    return finish(attemptR.result);
  }
  const bufL = [];
  const attemptL = decodeBody(b, "legacyRsw", log2, (msg) => bufL.push(msg), map, fallback, version);
  for (const msg of bufL) warnPush(warnings, msg);
  return finish(attemptL.result);
}

class ByteSink {
  constructor() {
    this.buf = new Uint8Array(1024);
    this.len = 0;
  }
  u8(v) {
    if (this.len + 1 > this.buf.length) {
      const nb = new Uint8Array(this.buf.length * 2);
      nb.set(this.buf.subarray(0, this.len));
      this.buf = nb;
    }
    this.buf[this.len++] = v & 0xff;
  }
  take() {
    return this.buf.slice(0, this.len);
  }
}


export function encodeSmoothGridBytes(chunkEntries, opts) {
  try {
    return encodeInner(chunkEntries, opts);
  } catch (_) {
    return null;
  }
}

function encodeInner(chunkEntries, opts) {
  if (!Array.isArray(chunkEntries) || chunkEntries.length === 0) return null;
  const o = opts && typeof opts === "object" ? opts : {};
  let log2 = typeof o.chunkSizeLog2 === "number" && Number.isFinite(o.chunkSizeLog2) ? o.chunkSizeLog2 | 0 : 5;
  if (log2 < 3 || log2 > SMOOTH_GRID_LIMITS.maxChunkSizeLog2) log2 = 5;
  const toRbx = o.internalToRbx && typeof o.internalToRbx.length === "number" ? o.internalToRbx : null;
  const size = 1 << log2;

  const internal = new Map();
  for (const e of chunkEntries) {
    if (!e || typeof e.key !== "string") continue;
    const parts = e.key.split("|");
    if (parts.length !== 3) continue;
    const cx = parseInt(parts[0], 10);
    const cy = parseInt(parts[1], 10);
    const cz = parseInt(parts[2], 10);
    if (!Number.isFinite(cx) || !Number.isFinite(cy) || !Number.isFinite(cz)) continue;
    if (Math.abs(cx) > MAX_PLAUSIBLE_COORD || Math.abs(cy) > MAX_PLAUSIBLE_COORD || Math.abs(cz) > MAX_PLAUSIBLE_COORD) continue;
    if (!(e.mat instanceof Uint8Array) || !(e.occ instanceof Uint8Array)) continue;
    if (e.mat.length !== INTERNAL_VOLUME || e.occ.length !== INTERNAL_VOLUME) continue;
    internal.set(cx + "|" + cy + "|" + cz, { cx, cy, cz, mat: e.mat, occ: e.occ });
  }
  if (!internal.size) return null;

  const fileChunks = new Map();
  for (const c of internal.values()) {
    const x0 = Math.floor((c.cx * 16) / size);
    const x1 = Math.floor((c.cx * 16 + 15) / size);
    const y0 = Math.floor((c.cy * 16) / size);
    const y1 = Math.floor((c.cy * 16 + 15) / size);
    const z0 = Math.floor((c.cz * 16) / size);
    const z1 = Math.floor((c.cz * 16 + 15) / size);
    for (let fx = x0; fx <= x1; fx++) {
      for (let fy = y0; fy <= y1; fy++) {
        for (let fz = z0; fz <= z1; fz++) {
          fileChunks.set(fx + "|" + fy + "|" + fz, [fx, fy, fz]);
        }
      }
    }
  }
  const order = [...fileChunks.values()].sort((p, q) => p[0] - q[0] || p[1] - q[1] || p[2] - q[2]);

  const sink = new ByteSink();
  sink.u8(1);
  sink.u8(log2);
  let lastX = 0;
  let lastY = 0;
  let lastZ = 0;
  let cacheKey = null;
  let cacheChunk = null;
  const getInternal = (ix, iy, iz) => {
    const key = ix + "|" + iy + "|" + iz;
    if (key === cacheKey) return cacheChunk;
    const ch = internal.get(key) || null;
    cacheKey = key;
    cacheChunk = ch;
    return ch;
  };

  for (const [fx, fy, fz] of order) {
    const dx = (fx - lastX) | 0;
    const dy = (fy - lastY) | 0;
    const dz = (fz - lastZ) | 0;
    for (let i = 3; i >= 0; i--) {
      sink.u8((dx >>> (i * 8)) & 0xff);
      sink.u8((dy >>> (i * 8)) & 0xff);
      sink.u8((dz >>> (i * 8)) & 0xff);
    }
    lastX = fx;
    lastY = fy;
    lastZ = fz;

    let runMat = -1;
    let runOcc = -1;
    let runLen = 0;
    const flush = () => {
      if (!runLen) return;
      const hasOcc = runMat !== 0 && runOcc !== 255;
      const hasCount = runLen > 1;
      sink.u8((runMat & 0x3f) | (hasOcc ? 0x40 : 0) | (hasCount ? 0x80 : 0));
      if (hasOcc) sink.u8(runOcc);
      if (hasCount) sink.u8(runLen - 1);
      runLen = 0;
    };
    for (let y = 0; y < size; y++) {
      for (let z = 0; z < size; z++) {
        for (let x = 0; x < size; x++) {
          const gx = fx * size + x;
          const gy = fy * size + y;
          const gz = fz * size + z;
          const ch = getInternal(gx >> 4, gy >> 4, gz >> 4);
          let m = 0;
          let occEff = 255;                                                             
          if (ch) {
            const idx = (gx & 15) | ((gy & 15) << 4) | ((gz & 15) << 8);
            const oc = ch.occ[idx];
            if (oc) {
              let v = toRbx ? toRbx[ch.mat[idx]] : ch.mat[idx];
              if (!Number.isFinite(v)) v = 2;
              v = v | 0;
              if (v > 63) v = 2;
              if (v > 0) {
                m = v;
                occEff = oc;
              }
            }
          }
          if (runLen > 0 && m === runMat && occEff === runOcc && runLen < 256) {
            runLen += 1;
          } else {
            flush();
            runMat = m;
            runOcc = occEff;
            runLen = 1;
          }
        }
      }
    }
    flush();
  }
  const out = sink.take();
  return out.length > SMOOTH_GRID_LIMITS.maxBytes ? null : out;
}


export function decodeMaterialColors(bytes) {
  try {
    const b = toUint8(bytes);
    if (!b || b.length !== MATERIAL_COLORS_BYTES) return { ok: false, colors: [] };
    const colors = [];
    let pos = MATERIAL_COLORS_RESERVED;
    for (let i = 2; i < SMOOTH_GRID_MATERIALS.length; i++) {
      colors.push({ name: SMOOTH_GRID_MATERIALS[i], rgb: [b[pos], b[pos + 1], b[pos + 2]] });
      pos += 3;
    }
    return { ok: true, colors };
  } catch (_) {
    return { ok: false, colors: [] };
  }
}


function fmtMilhar(n) {
  return String(Math.max(0, Math.round(Number(n) || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function fmtVoxelsCurto(n) {
  const v = Math.max(0, Math.round(Number(n) || 0));
  return v >= 1000000 ? (v / 1000000).toFixed(1).replace(".", ",") + "M" : fmtMilhar(v);
}


export function formatTerrainImportSummary(dec, applied) {
  try {
    const d = dec && typeof dec === "object" ? dec : {};
    const stats = d.stats && typeof d.stats === "object" ? d.stats : {};
    const ap = applied && typeof applied === "object" ? applied : null;
    const internal = ap && ap.chunks > 0
      ? ap.chunks | 0
      : (Array.isArray(d.chunks) && d.chunks.length ? d.chunks.length : stats.internalChunks | 0);
    const voxels = ap && ap.voxels > 0 ? ap.voxels : stats.voxels || 0;
    const fileChunks = stats.rbxChunks | 0;
    const written = stats.chunksWritten | 0;
    const sizeTxt = Number.isFinite(d.chunkSizeLog2) && d.chunkSizeLog2 >= 0 && d.chunkSizeLog2 <= ENGINE_MAX_LOG2
      ? `${1 << (d.chunkSizeLog2 | 0)}³`
      : "?³";
    let head;
    if (fileChunks > 0) {
      const fileTxt = written > 0 && written < fileChunks
        ? `${fmtMilhar(written)} de ${fmtMilhar(fileChunks)} chunk(s) do arquivo (${sizeTxt})`
        : `${fmtMilhar(fileChunks)} chunk(s) do arquivo (${sizeTxt})`;
      head = `${fileTxt} → ${fmtMilhar(internal)} chunk(s) internos 16³`;
    } else {


      head = `${fmtMilhar(internal)} chunk(s) internos 16³`;
    }
    let msg = `Import: terreno com ${head}, ${fmtVoxelsCurto(voxels)} voxels` +
      ` (layout ${d.layout || "?"}${d.tolerant ? " tolerante" : ""}, v${d.version | 0})`;
    if ((stats.unknownMaterials | 0) > 0) {
      msg += `; ${fmtMilhar(stats.unknownMaterials)} material(is) desconhecido(s) convertido(s)`;
    }
    if (d.partial) msg += "; import PARCIAL (arquivo truncado ou orçamento atingido)";
    return msg;
  } catch (_) {
    return "Import: terreno importado (resumo indisponível).";
  }
}


export function registerSmoothGridDecoder(version, fn) {
  if (typeof version !== "number" || !Number.isFinite(version) || typeof fn !== "function") return false;
  decoderRegistry.set(version | 0, fn);
  return true;
}
