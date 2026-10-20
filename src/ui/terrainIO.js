import { commands } from "../core/commands.js";
import { project, setStatus } from "../core/project.js";
import { logger } from "../core/logger.js";
import { terrainStore } from "../terrain/terrainStore.js";
import { TERRAIN_MATERIALS } from "../terrain/materials.js";
import {
  encodeTerrainFile,
  decodeTerrainFile,
  TERRAIN_FILE_EXT,
  MAX_TERRAIN_FILE_BYTES,
} from "../terrain/terrainFile.js";
import { openConfirm, openInfo } from "./modal.js";

const SOURCE = "Studio";

function fmtThousands(n) {
  return String(Math.max(0, Math.round(Number(n) || 0))).replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

function safeFileName(name) {
  const s = String(name == null ? "" : name)
    .replace(/[<>:"/\\|?*\u0000-\u001F]/g, "")
    .trim()
    .slice(0, 100);
  return s || "place";
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

function downloadText(filename, text) {
  const blob = new Blob([text], { type: "application/json" });
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


function snapshotColors() {
  const out = [];
  if (typeof terrainStore.getImportedMaterialColor !== "function") return out;
  for (let i = 0; i < TERRAIN_MATERIALS.length; i++) {
    const rgb = terrainStore.getImportedMaterialColor(i);
    if (rgb != null) out.push({ name: TERRAIN_MATERIALS[i].name, rgb });
  }
  return out;
}


export function exportTerrainToFile() {
  try {
    const data = terrainStore.getData();
    const file = encodeTerrainFile(data, snapshotColors());
    if (!file) {
      openInfo({ title: "Export Terrain", message: "Não há terreno para exportar." });
      return false;
    }
    const name = safeFileName(project.getName()) + "-terrain" + TERRAIN_FILE_EXT;
    downloadText(name, JSON.stringify(file));
    const c = file.counts || {};
    setStatus(`Exported ${name}`);
    logger.info(
      `Export terreno: ${name} — ${fmtThousands(c.chunks)} chunk(s), ${fmtThousands(c.voxels)} voxel(s).`,
      { source: SOURCE },
    );
    return true;
  } catch (e) {
    showError("Falha ao exportar terreno", (e && e.message) || "Erro desconhecido.");
    return false;
  }
}


function applyImport(dec, fileName) {
  const data = terrainStore.getData();
  const before = data.exportAll();
  const beforeColors = snapshotColors();
  const after = dec.snapshot;

  const hasColors = Array.isArray(dec.materialColors);
  const afterColors = hasColors ? dec.materialColors : null;
  const setColors = (colors) => {
    if (hasColors && typeof terrainStore.setImportedMaterialColors === "function") {
      terrainStore.setImportedMaterialColors(colors);
    }
  };
  const ok = commands.execute({
    name: "Import Terrain",
    do() {
      data.importAll(after);
      setColors(afterColors);
      terrainStore.notifyChanged();
      return true;
    },
    undo() {
      data.importAll(before);
      setColors(beforeColors);
      terrainStore.notifyChanged();
      return true;
    },
  });
  if (!ok) {
    showError("Falha ao importar terreno", "Não foi possível aplicar o terreno.");
    return false;
  }
  const st = dec.stats || {};
  let msg = `Import terreno: ${fileName} — ${fmtThousands(st.chunks)} chunk(s), ${fmtThousands(st.voxels)} voxel(s)`;
  if (st.remapped > 0) msg += `; ${fmtThousands(st.remapped)} voxel(s) remapeado(s) por nome`;
  if (st.unknown > 0) msg += `; ${fmtThousands(st.unknown)} voxel(s) de material desconhecido -> Grass`;
  msg += ". Reversível com Undo.";
  logger.info(msg, { source: SOURCE });
  setStatus(`Imported terrain (${fmtThousands(st.voxels)} voxel(s))`);
  return true;
}


export function importTerrainFromFile() {
  pickLocalFile(TERRAIN_FILE_EXT + ",.json,application/json", (fileObj) => {
    if (Number(fileObj.size) > MAX_TERRAIN_FILE_BYTES) {
      showError("Falha ao importar terreno", "O arquivo excede o limite de 50MB.");
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => showError("Falha ao importar terreno", "Falha ao ler o arquivo.");
    reader.onload = () => {
      let obj;
      try {
        obj = JSON.parse(String(reader.result || ""));
      } catch (_) {
        showError("Falha ao importar terreno", "O arquivo não é um JSON válido.");
        return;
      }
      const warnings = [];
      const dec = decodeTerrainFile(obj, warnings);
      logWarnings("Import terreno", warnings);
      if (!dec.ok) {
        showError("Falha ao importar terreno", dec.error + (warnings.length ? " Detalhes no Output." : ""));
        return;
      }
      const st = dec.stats || {};
      const notes = [];
      if (st.remapped > 0) notes.push(`${fmtThousands(st.remapped)} voxel(s) serão remapeados pela paleta por nome`);
      if (st.unknown > 0) notes.push(`${fmtThousands(st.unknown)} voxel(s) de material desconhecido virarão Grass`);
      const replaceNote = terrainStore.getData().isEmpty()
        ? ""
        : " O terreno ATUAL será SUBSTITUÍDO (reversível com Undo).";
      openConfirm({
        title: "Import Terrain",
        message:
          `O arquivo contém ${fmtThousands(st.chunks)} chunk(s) e ${fmtThousands(st.voxels)} voxel(s) de terreno.` +
          (notes.length ? ` ${notes.join("; ")}.` : "") +
          replaceNote +
          " Continuar?",
        buttons: [
          { label: "Import", value: true, kind: "primary" },
          { label: "Cancel", value: false, kind: "ghost" },
        ],
        closeOnBackdrop: false,
      }).then((choice) => {
        if (!choice) {
          setStatus("Import cancelled");
          return;
        }
        applyImport(dec, fileObj.name || "terreno");
      });
    };
    reader.readAsText(fileObj);
  });
  return true;
}
