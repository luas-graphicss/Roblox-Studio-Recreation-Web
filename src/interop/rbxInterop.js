import { store } from "../core/state.js";
import { selection } from "../core/selection.js";
import { commands } from "../core/commands.js";
import { project, setStatus } from "../core/project.js";
import { logger } from "../core/logger.js";
import { getService } from "../datamodel/index.js";
import { terrainStore } from "../terrain/terrainStore.js";
import { openConfirm, openInfo } from "../ui/modal.js";
import { buildPlaceXml, buildModelXml } from "./rbxlxWriter.js";
import { parseRbxXml, decodeServiceProps, collectServiceOpaqueProps } from "./rbxlxReader.js";





import { collectCloudCsgPending, sharedCsgCloudResolver, getCsgCloudProxies, createCsgCloudRetryQueue } from "./rbxCsgCloud.js";
import { bus } from "../core/eventBus.js";


import { attachOpaqueProp, snapshotOpaqueProps, restoreOpaqueProps, RBX_UNKNOWN_LIMITS, unknownChunkToBytes } from "./rbxUnknown.js";
import { RBX_LIMITS, ilAbsentServiceDefaults } from "./rbxTypeMaps.js";
import { isRbxBinary, decodeRbxBinary, encodeRbxBinary } from "./rbxBinary.js";
import { xmlToRbxModel } from "./rbxXmlScan.js";
import { encodeTerrainBlobs, decodeSmoothGridBase64, base64ToBytes } from "./rbxBlobs.js";


import { decodeMaterialColors, formatTerrainImportSummary, SMOOTH_GRID_LIMITS } from "./rbxSmoothGrid.js";
import { TERRAIN_MATERIALS } from "../terrain/materials.js";


import { settings, SETTINGS_DEFAULTS, TERRAIN_IMPORT_MAX_VOXELS_RANGE } from "../config/settings.js";

const SOURCE = "Studio";


const placeFileChunksByDm = new WeakMap();


export function getPlaceFileChunksForSave(dm) {
  const kept = dm ? placeFileChunksByDm.get(dm) : null;
  if (!kept || !kept.length) return null;
  const out = [];
  for (const rec of kept) {
    if (rec && typeof rec.name === "string" && typeof rec.b64 === "string") out.push([rec.name, rec.b64]);
  }
  return out.length ? out : null;
}


export function restorePlaceFileChunks(dm, rawPairs) {
  const warnings = [];
  if (!dm) return warnings;
  if (!Array.isArray(rawPairs) || !rawPairs.length) {
    placeFileChunksByDm.delete(dm);
    return warnings;
  }
  const recs = [];
  for (const pair of rawPairs) {
    if (recs.length >= RBX_UNKNOWN_LIMITS.maxFileChunks) {
      warnings.push("Chunks de interop acima do teto por arquivo ignorados.");
      break;
    }
    const name = Array.isArray(pair) && typeof pair[0] === "string" ? pair[0] : null;
    const b64 = Array.isArray(pair) && typeof pair[1] === "string" ? pair[1] : null;
    const rec = name != null && b64 != null ? { name, b64 } : null;
    if (rec && unknownChunkToBytes(rec)) recs.push(rec);
    else warnings.push("Chunk de interop inválido ignorado ao abrir o projeto.");
  }
  if (recs.length) placeFileChunksByDm.set(dm, recs);
  else placeFileChunksByDm.delete(dm);
  return warnings;
}

function safeFileName(name) {
  const s = String(name == null ? "" : name)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .trim()
    .slice(0, 100);
  return s || "place";
}

function downloadBlob(filename, data, mime) {
  const blob = new Blob([data], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    if (a.parentNode) a.parentNode.removeChild(a);
  }, 0);
}

function downloadText(filename, text) {
  downloadBlob(filename, text, "application/xml");
}

function pickLocalFile(accept, onPick) {
  const input = document.createElement("input");
  input.type = "file";
  if (accept) input.accept = accept;
  input.style.position = "fixed";
  input.style.left = "-9999px";
  document.body.appendChild(input);
  const cleanup = () => {
    if (input.parentNode) input.parentNode.removeChild(input);
  };
  input.addEventListener("change", () => {
    const file = input.files && input.files[0];
    cleanup();
    if (file) onPick(file);
  });


  input.addEventListener("cancel", cleanup);
  input.click();
}

function readFileBytes(file) {
  return new Promise((resolve, reject) => {
    if (!file) {
      reject(new Error("Arquivo ausente."));
      return;
    }
    if (Number(file.size) > RBX_LIMITS.maxFileBytes) {
      reject(new Error("O arquivo excede o limite de 50MB."));
      return;
    }
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result || new ArrayBuffer(0)));
    reader.onerror = () => reject(reader.error || new Error("Falha ao ler o arquivo."));
    reader.readAsArrayBuffer(file);
  });
}

function showError(title, message) {
  logger.warn(title + ": " + message, { source: SOURCE });
  openInfo({ title, content: message });
  setStatus(title);
}

function logWarnings(prefix, warnings) {
  for (const w of Array.isArray(warnings) ? warnings : []) {
    logger.warn(`${prefix}: ${w}`, { source: SOURCE });
  }
}

function terrainExportBlobs() {
  try {
    const data = terrainStore.getData();
    if (data.isEmpty()) return null;
    const notes = [];
    const blobs = encodeTerrainBlobs(data.getChunkEntries(), notes);
    logWarnings("Export terreno", notes);
    return blobs;
  } catch (_) {
    return null;
  }
}


export function syncTerrainImportBudget(override) {
  const range = TERRAIN_IMPORT_MAX_VOXELS_RANGE;
  const raw = override != null ? override : settings.get("terrainImportMaxVoxels");
  let v = Number(raw);
  if (!Number.isFinite(v)) v = SETTINGS_DEFAULTS.terrainImportMaxVoxels;
  v = Math.round(Math.min(range.max, Math.max(range.min, v)));
  SMOOTH_GRID_LIMITS.maxVoxels = v;
  return v;
}


function decodeTerrainChunks(terrain, warnings) {
  if (!terrain || !terrain.smoothGrid) return null;
  syncTerrainImportBudget();
  const dec = decodeSmoothGridBase64(terrain.smoothGrid, warnings);
  if (!dec || !Array.isArray(dec.chunks) || dec.chunks.length === 0) return null;
  return dec;
}


function applyTerrainChunks(chunks) {
  const data = terrainStore.getData();
  data.clear();
  let applied = null;
  if (typeof data.importChunksBulk === "function") {
    applied = data.importChunksBulk(chunks);
  } else {
    for (const ch of chunks) data.setChunkRaw(ch.cx, ch.cy, ch.cz, ch.mat, ch.occ);
  }
  terrainStore.notifyChanged();
  return applied && typeof applied === "object" ? applied : { chunks: chunks.length, voxels: 0 };
}


function decodeImportedColors(terrain) {
  if (!terrain || !terrain.materialColors) return null;
  if (typeof terrainStore.setImportedMaterialColors !== "function") return null;
  const bytes = base64ToBytes(terrain.materialColors);
  if (!bytes) return null;
  const mc = decodeMaterialColors(bytes);
  return mc && mc.ok && Array.isArray(mc.colors) && mc.colors.length ? mc.colors : null;
}


function snapshotImportedColors() {
  const out = [];
  if (typeof terrainStore.getImportedMaterialColor !== "function") return out;
  for (let i = 0; i < TERRAIN_MATERIALS.length; i++) {
    const rgb = terrainStore.getImportedMaterialColor(i);
    if (rgb != null) out.push({ name: TERRAIN_MATERIALS[i].name, rgb });
  }
  return out;
}

function liveSelectionRoots() {
  const sel = selection
    .get()
    .filter((i) => i && typeof i.isDestroyed === "function" && !i.isDestroyed());
  const set = new Set(sel);
  return sel.filter((inst) => {
    let p = inst.getParent ? inst.getParent() : null;
    while (p) {
      if (set.has(p)) return false;
      p = p.getParent ? p.getParent() : null;
    }
    return true;
  });
}

function selectRoots(roots) {
  try {
    if (typeof selection.set === "function") selection.set(roots);
    else if (typeof selection.selectSingle === "function") selection.selectSingle(roots[0]);
  } catch (_) {                                     }
}

export function exportPlaceRbxlx() {
  try {
    const dm = store.getDataModel();
    const res = buildPlaceXml(dm, { terrain: terrainExportBlobs() });

    const kept = placeFileChunksByDm.get(dm);
    if (kept && kept.length) {
      res.warnings.push(`${kept.length} chunk(s) binário(s) desconhecido(s) preservado(s) do import não têm representação XML — use Export .rbxl para mantê-los.`);
    }
    downloadText(safeFileName(project.getName()) + ".rbxlx", res.xml);
    logWarnings("Export .rbxlx", res.warnings);
    logger.info(`Place exportado para Roblox (.rbxlx): ${res.count} instância(s).`, { source: SOURCE });
    setStatus(res.warnings.length
      ? `Exported .rbxlx with ${res.warnings.length} warning(s) — see Output`
      : "Exported place (.rbxlx)");
    return true;
  } catch (e) {
    showError("Falha ao exportar .rbxlx", (e && e.message) || "Erro desconhecido.");
    return false;
  }
}

export function exportSelectionRbxmx() {
  const roots = liveSelectionRoots().filter(
    (r) => r.className !== "Camera" && r.className !== "Terrain",
  );
  if (!roots.length) {
    setStatus("Nothing selected to export");
    return false;
  }
  try {
    const res = buildModelXml(roots);
    const base = safeFileName(roots.length === 1 ? roots[0].name : "selection");
    downloadText(base + ".rbxmx", res.xml);
    logWarnings("Export .rbxmx", res.warnings);
    logger.info(`Seleção exportada para Roblox (.rbxmx): ${res.count} instância(s).`, { source: SOURCE });
    setStatus(res.warnings.length
      ? `Exported .rbxmx with ${res.warnings.length} warning(s) — see Output`
      : `Exported selection (.rbxmx, ${res.count} object(s))`);
    return true;
  } catch (e) {
    showError("Falha ao exportar .rbxmx", (e && e.message) || "Erro desconhecido.");
    return false;
  }
}


function runCloudCsgHydration(pending, label) {
  return sharedCsgCloudResolver
    .hydrate(pending, {
      proxies: getCsgCloudProxies(),
      onResolved(inst) {
        bus.emit("csg:cloudSolidResolved", { instance: inst });
      },
    })
    .then((sum) => {
      if (!sum) return sum;
      if (sum.resolved > 0) {
        logger.info(
          `${label}: ${sum.resolved} união(ões) hidratada(s) com a malha real do CDN (${sum.meshOk} MeshData, ${sum.hullsOk} hulls físicos).`,
          { source: SOURCE },
        );
      }
      const net = sum.failedNet | 0;
      const bad = sum.failedDecode | 0;
      if (net + bad > 0) {
        cloudCsgRetryQueue.add(pending);
        const inS = Math.round(cloudCsgRetryQueue.nextDelayMs() / 1000);
        logger.warn(
          `${label}: ${net + bad} união(ões) ainda como caixa — ${net} falha(s) de rede/CORS e ${bad} resposta(s) da CDN sem CSG válido. Re-tentativa automática em ~${inS}s, sem precisar re-importar (proxies aceitos a qualquer momento: globalThis.ROBLOX_CSG_CDN_PROXIES).`,
          { source: SOURCE },
        );
      }
      return sum;
    });
}


const cloudCsgRetryQueue = createCsgCloudRetryQueue({
  async runHydration(insts, attempt) {
    const cap = Math.max(1, sharedCsgCloudResolver.limits.maxPerImport | 0);
    for (let i = 0; i < insts.length; i += cap) {
      await runCloudCsgHydration(
        insts.slice(i, i + cap),
        `CSG nuvem: re-tentativa automática #${attempt}`,
      );
    }
  },
});


if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
  window.addEventListener("online", () => {
    try {
      if (cloudCsgRetryQueue.size() === 0) return;
      sharedCsgCloudResolver.clearNegative();
      void cloudCsgRetryQueue.kickNow();
    } catch (_) {

    }
  });
}

function kickCloudCsgHydration(roots, label) {
  let pending = [];
  try {
    pending = collectCloudCsgPending(roots);
  } catch (_) {
    pending = [];
  }
  if (!pending.length) return;
  logger.info(
    `${label}: ${pending.length} união(ões) com geometria somente na nuvem — baixando a malha real do CDN (AssetId)...`,
    { source: SOURCE },
  );
  runCloudCsgHydration(pending, label).catch(() => {

  });
}

function insertModelRoots(roots, warnings) {
  const dm = store.getDataModel();
  const target = getService(dm, "Workspace");
  if (!target) {
    showError("Falha ao importar", "Workspace indisponível.");
    return false;
  }
  const cmd = {
    name: "Import from Roblox",
    do() {
      for (const r of roots) r.setParent(target);
      return true;
    },
    undo() {
      for (const r of roots) r.setParent(null);
      return true;
    },
  };
  if (!commands.execute(cmd)) {
    for (const r of roots) { try { r.destroy(); } catch (_) {               } }
    showError("Falha ao importar", "Não foi possível inserir os objetos.");
    return false;
  }
  selectRoots(roots);
  setStatus(`Imported ${roots.length} object(s) from Roblox model`);
  logger.info(`Import .rbxmx: ${roots.length} objeto(s) inserido(s) no Workspace.`, { source: SOURCE });
  logWarnings("Import .rbxmx", warnings);
  kickCloudCsgHydration(roots, "Import de modelo");
  return true;
}

function buildPlacePlan(parsed, dm, warnings) {
  const moves = [];
  const propOps = [];
  const opaqueOps = [];
  const discarded = [];
  for (const svc of parsed.services) {
    const target = getService(dm, svc.className);
    if (!target) {
      if (svc.children.length) {
        warnings.push(`Serviço "${svc.className}" indisponível; ${svc.children.length} objeto(s) descartado(s).`);
        discarded.push(...svc.children);
      }
      continue;
    }
    const updates = decodeServiceProps(svc.className, svc.props, warnings);
    for (const u of updates) {
      if (target.hasProperty(u.prop)) {
        propOps.push({ target, prop: u.prop, value: u.value, before: target.getProperty(u.prop) });
      }
    }


    const ilPresent = new Set(svc.props.map((p) => p.name));
    for (const d of ilAbsentServiceDefaults(svc.className, ilPresent)) {
      if (target.hasProperty(d.prop)) {
        propOps.push({ target, prop: d.prop, value: d.value, before: target.getProperty(d.prop) });
      }
    }

    for (const rec of collectServiceOpaqueProps(svc.props)) {
      opaqueOps.push({ target, rec });
    }
    for (const child of svc.children) {
      if (svc.className === "StarterPlayer" &&
          (child.className === "StarterPlayerScripts" || child.className === "StarterCharacterScripts")) {
        const container = target.findFirstChild(child.className);
        if (container) {
          for (const grand of child.getChildren().slice()) moves.push({ inst: grand, target: container });
          discarded.push(child);
          continue;
        }
      }
      moves.push({ inst: child, target });
    }
  }
  return { moves, propOps, opaqueOps, discarded };
}

function importPlaceMerge(parsed, warnings, terrainDec, fileChunks) {
  const dm = store.getDataModel();
  const plan = buildPlacePlan(parsed, dm, warnings);
  const terrainChunks = terrainDec ? terrainDec.chunks : null;
  const chunkRecs = Array.isArray(fileChunks) && fileChunks.length ? fileChunks : null;
  if (!plan.moves.length && !plan.propOps.length && !plan.opaqueOps.length && !terrainChunks && !chunkRecs) {
    for (const d of plan.discarded) { try { d.destroy(); } catch (_) {               } }
    showError("Falha ao importar", "O arquivo não contém conteúdo compatível.");
    return false;
  }
  let terrainBefore = null;
  let colorsBefore = null;
  let applied = null;


  let opaqueSnaps = null;
  let chunksBefore = null;
  let chunksSnapped = false;
  const importedColors = terrainChunks ? decodeImportedColors(parsed.terrain) : null;
  const cmd = {
    name: "Import Place from Roblox",
    do() {
      for (const m of plan.moves) m.inst.setParent(m.target);
      for (const p of plan.propOps) p.target.setProperty(p.prop, p.value);
      if (plan.opaqueOps.length && !opaqueSnaps) {
        opaqueSnaps = new Map();
        for (const o of plan.opaqueOps) {
          if (!opaqueSnaps.has(o.target)) opaqueSnaps.set(o.target, snapshotOpaqueProps(o.target));
        }
      }
      for (const o of plan.opaqueOps) attachOpaqueProp(o.target, o.rec);
      if (chunkRecs) {
        if (!chunksSnapped) {
          chunksSnapped = true;
          chunksBefore = placeFileChunksByDm.has(dm) ? placeFileChunksByDm.get(dm) : null;
        }
        placeFileChunksByDm.set(dm, chunkRecs);
      }
      if (terrainChunks) {
        if (!terrainBefore) terrainBefore = terrainStore.getData().exportAll();
        applied = applyTerrainChunks(terrainChunks);
        if (importedColors) {
          if (!colorsBefore) colorsBefore = snapshotImportedColors();
          terrainStore.setImportedMaterialColors(importedColors);
        }
      }
      return true;
    },
    undo() {
      for (const m of plan.moves) m.inst.setParent(null);
      for (const p of plan.propOps) p.target.setProperty(p.prop, p.before);
      if (opaqueSnaps) {
        for (const [target, snap] of opaqueSnaps) restoreOpaqueProps(target, snap);
      }
      if (chunkRecs) {
        if (chunksBefore) placeFileChunksByDm.set(dm, chunksBefore);
        else placeFileChunksByDm.delete(dm);
      }
      if (terrainChunks && terrainBefore) {
        terrainStore.getData().importAll(terrainBefore);
        terrainStore.notifyChanged();
        if (importedColors && colorsBefore) terrainStore.setImportedMaterialColors(colorsBefore);
      }
      return true;
    },
  };
  if (!commands.execute(cmd)) {
    for (const m of plan.moves) { try { m.inst.destroy(); } catch (_) {               } }
    for (const d of plan.discarded) { try { d.destroy(); } catch (_) {               } }
    showError("Falha ao importar", "Não foi possível mesclar o conteúdo do place.");
    return false;
  }
  for (const d of plan.discarded) { try { d.destroy(); } catch (_) {               } }
  if (terrainChunks) {
    logger.info(formatTerrainImportSummary(terrainDec, applied), { source: SOURCE });
  }
  if (plan.opaqueOps.length) {
    logger.info(`Import: ${plan.opaqueOps.length} carga(s) opaca(s) de serviço preservada(s) (Parte 157).`, { source: SOURCE });
  }
  if (chunkRecs) {
    logger.info(`Import: ${chunkRecs.length} chunk(s) desconhecido(s) preservado(s) para o Export .rbxl (Parte 157).`, { source: SOURCE });
  }
  const wsRoots = plan.moves.filter((m) => m.target.className === "Workspace").map((m) => m.inst);
  if (wsRoots.length) selectRoots(wsRoots.slice(0, 50));
  setStatus(`Imported place content (${plan.moves.length} object(s), ${plan.propOps.length} propert(ies))`);
  logger.info(
    `Import .rbxlx: ${plan.moves.length} objeto(s) mesclado(s) e ${plan.propOps.length} propriedade(s) de serviço aplicada(s).`,
    { source: SOURCE },
  );
  logWarnings("Import .rbxlx", warnings);
  kickCloudCsgHydration(plan.moves.map((m) => m.inst), "Import de place");
  return true;
}

function destroyParsed(parsed) {
  for (const r of parsed.roots || []) { try { r.destroy(); } catch (_) {               } }
  for (const s of parsed.services || []) {
    for (const c of s.children || []) { try { c.destroy(); } catch (_) {               } }
  }
}

function handleParsed(parsed, fileChunks) {
  if (parsed.kind === "model") {


    if (Array.isArray(fileChunks) && fileChunks.length) {
      parsed.warnings.push(`${fileChunks.length} chunk(s) desconhecido(s) de arquivo de modelo descartado(s) — a preservação de chunks vale para import de place.`);
    }
    insertModelRoots(parsed.roots, parsed.warnings);
    return;
  }


  const terrainDec = decodeTerrainChunks(parsed.terrain, parsed.warnings);
  let terrainNote = "";
  if (terrainDec) {
    terrainNote = " O terreno do arquivo SUBSTITUIRÁ o terreno atual (reversível com Undo).";
    if (terrainDec.partial) {


      const st = terrainDec.stats || {};
      const sm = terrainDec.summary || {};
      const totalChunks = st.rbxChunks | 0;
      const kept = st.chunksWritten != null ? st.chunksWritten | 0 : totalChunks;
      const descartados = st.chunksDiscarded | 0;
      const foraOrcamento = (sm.skippedChunks | 0) || Math.max(0, totalChunks - kept);
      const pct = st.occCells > 0
        ? Math.max(0, Math.min(100, Math.round(((st.voxels | 0) / st.occCells) * 100)))
        : 100;
      terrainNote += ` ATENÇÃO: import PARCIAL do terreno — ${kept} de ${totalChunks || kept} chunk(s) do arquivo, ${st.voxels | 0} voxel(s) (~${pct}% das células)` +
        (descartados > 0 ? `, ${descartados} chunk(s) descartado(s) por corrupção` : "") +
        (foraOrcamento > 0 ? `, ${foraOrcamento} chunk(s) fora do orçamento` : "") +
        (terrainDec.tolerant ? ", leitura tolerante (Parte 153)" : "") +
        " — detalhes no Output.";
    }
  } else if (parsed.terrain && parsed.terrain.smoothGrid) {
    terrainNote = " O terreno do arquivo não pôde ser decodificado (nem pela leitura tolerante por chunk da Parte 153) e será IGNORADO (detalhes no Output).";
  }
  const total = parsed.services.reduce((acc, s) => acc + s.children.length, 0);
  openConfirm({
    title: "Import Place",
    message:
      `O arquivo contém um place completo (${total} objeto(s)). ` +
      "O conteúdo será MESCLADO ao place atual (Workspace, Lighting, scripts etc.)." +
      terrainNote +
      " Continuar?",
    buttons: [
      { label: "Merge", value: "merge", kind: "primary" },
      { label: "Cancel", value: "cancel", kind: "ghost" },
    ],
    closeOnBackdrop: false,
  }).then((choice) => {
    if (choice !== "merge") {
      destroyParsed(parsed);
      setStatus("Import cancelled");
      return;
    }
    importPlaceMerge(parsed, parsed.warnings, terrainDec, fileChunks);
  });
}

export function importRobloxFile() {
  pickLocalFile(".rbxlx,.rbxmx,.rbxl,.rbxm", (file) => {
    readFileBytes(file)
      .then((bytes) => {
        let text;
        let fileChunks = null;
        if (isRbxBinary(bytes)) {
          const dec = decodeRbxBinary(bytes);
          logWarnings("Import binário", dec.warnings);
          if (!dec.ok) {
            showError("Falha ao importar", dec.error);
            return;
          }
          logger.info(`Import binário (.rbxl/.rbxm): ${dec.count} instância(s) decodificada(s).`, { source: SOURCE });
          text = dec.xml;

          fileChunks = Array.isArray(dec.fileChunks) && dec.fileChunks.length ? dec.fileChunks : null;
        } else {
          text = new TextDecoder("utf-8").decode(bytes);
        }
        const parsed = parseRbxXml(text);
        if (!parsed.ok) {
          logWarnings("Import Roblox", parsed.warnings);
          showError("Falha ao importar", parsed.error);
          return;
        }
        handleParsed(parsed, fileChunks);
      })
      .catch((e) => {
        showError("Falha ao importar", (e && e.message) || "Erro desconhecido.");
      });
  });
}

function exportBinary(buildXml, filename, label, encodeOpts) {
  try {
    const res = buildXml();
    const model = xmlToRbxModel(res.xml);
    const bytes = encodeRbxBinary(model, encodeOpts);
    downloadBlob(filename, bytes, "application/octet-stream");
    logWarnings(label, res.warnings);
    logger.info(`${label}: ${res.count} instância(s), ${bytes.length} bytes.`, { source: SOURCE });
    setStatus(res.warnings.length
      ? `Exported ${filename} with ${res.warnings.length} warning(s) — see Output`
      : `Exported ${filename}`);
    return true;
  } catch (e) {
    showError(`Falha no ${label}`, (e && e.message) || "Erro desconhecido.");
    return false;
  }
}

export function exportPlaceRbxl() {
  const dm = store.getDataModel();

  const fileChunks = placeFileChunksByDm.get(dm) || null;
  return exportBinary(
    () => buildPlaceXml(dm, { terrain: terrainExportBlobs() }),
    safeFileName(project.getName()) + ".rbxl",
    "Export .rbxl",
    fileChunks ? { fileChunks } : undefined,
  );
}

export function exportSelectionRbxm() {
  const roots = liveSelectionRoots().filter(
    (r) => r.className !== "Camera" && r.className !== "Terrain",
  );
  if (!roots.length) {
    setStatus("Nothing selected to export");
    return false;
  }
  const base = safeFileName(roots.length === 1 ? roots[0].name : "selection");
  return exportBinary(() => buildModelXml(roots), base + ".rbxm", "Export .rbxm");
}
