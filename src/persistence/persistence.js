import { bus } from "../core/eventBus.js";

import { deepCloneJsonValue } from "../core/deepCloneJsonValue.js";
import { logger } from "../core/logger.js";
import { store } from "../core/state.js";
import { commands } from "../core/commands.js";
import { selection } from "../core/selection.js";
import { settings } from "../config/settings.js";
import { readJSON, writeJSON, remove } from "../utils/storage.js";
import { project, setStatus } from "../core/project.js";
import { createResourceId } from "../core/resourceId.js";           
import { engine } from "../runtime/engine.js";
import { getService, collection } from "../datamodel/index.js";
import { sanitizeName, valuesEqual, PropTypes } from "../datamodel/types.js";
import { serializationCache } from "./serialCache.js";
import { terrainStore } from "../terrain/terrainStore.js";
import { assetStore, SECTIONS } from "../assets/assetStore.js";
import * as breakpoints from "../debugger/breakpoints.js";
import * as ser from "./serializer.js";



import {
  readOpaqueProps,
  unknownPropName,
  unknownPropFromXml,
  attachOpaqueProp,
  restoreOpaqueProps,
} from "../interop/rbxUnknown.js";


import { getPlaceFileChunksForSave, restorePlaceFileChunks } from "../interop/rbxInterop.js";
import * as DS from "../runtime/dataServices.js";                                           
import * as projectStore from "./projectStore.js";
import * as versionHistory from "../collab/versionHistory.js";
import { showProgress } from "../ui/progressOverlay.js";
import { NotificationService } from "../services/notifications.js";            

const SESSION_KEY = "session";                                 
const AUTOSAVE_TICK_MS = 20000;                                                   


let _dest = null;

let _saveMark = 0;
let _autosaveTimer = null;
let _lastAutosaveAt = 0;
let _autosaving = false;
let _saving = false;
let _sessionProjectId = null;                                                
let _inited = false;


export function formatBytes(n) {
  const num = Number(n) || 0;
  if (num < 1024) return num + " B";
  if (num < 1024 * 1024) return (num / 1024).toFixed(1) + " KB";
  return (num / (1024 * 1024)).toFixed(1) + " MB";
}

export function safeFileName(name) {
  let s = sanitizeName(String(name == null ? "" : name), "place");
  s = s.replace(/[\\/:*?"<>|]/g, "_").replace(/\s+/g, " ").trim();
  if (!s) s = "place";
  return s.slice(0, 120);
}

function timeNow() {
  try {
    return new Date().toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  } catch (_) {
    return "";
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
  }, 1500);                                                                                                                            
}

function showError(title, message) {
  logger.error(title + ": " + message, { source: "Studio" });
  setStatus(title);
  import("../ui/modal.js")
    .then(({ openInfo }) => openInfo({ title, content: String(message) }))
    .catch(() => {});
}

function logWarnings(prefix, warnings) {
  if (!warnings || !warnings.length) return;
  const head = warnings.slice(0, 8).join(" | ");
  const extra = warnings.length > 8 ? ` (+${warnings.length - 8})` : "";
  logger.warn(`${prefix}: ${warnings.length} aviso(s): ${head}${extra}`, { source: "Studio" });
}

function markSaved() {
  _saveMark = commands.getUndoSize();
  project.markClean();
}


function extractServiceProps(svc) {
  const out = {};
  const descs = svc
    .listProperties()
    .filter((d) => !d.readOnly && d.name !== "Name" && d.type !== PropTypes.Instance);
  descs.sort((a, b) => (a.name < b.name ? -1 : a.name > b.name ? 1 : 0));
  for (const d of descs) {
    if (valuesEqual(d.type, d.value, d.default)) continue;
    try {
      out[d.name] = deepCloneJsonValue(d.value == null ? null : d.value);
    } catch (_) {

    }
  }
  return Object.keys(out).length ? out : null;
}


function resetInstanceToDefaults(inst) {
  let descs = [];
  try {
    descs = inst
      .listProperties()
      .filter((d) => !d.readOnly && d.name !== "Name" && d.type !== PropTypes.Instance);
  } catch (_) {
    return;
  }
  for (const d of descs) {
    if (valuesEqual(d.type, d.value, d.default)) continue;
    let v = d.default;
    if (v && typeof v === "object") {
      try { v = deepCloneJsonValue(v); } catch (_) { continue; }
    }
    try { inst.setProperty(d.name, v); } catch (_) {                            }
  }
  try {
    if (typeof inst.getAttributesList === "function" && typeof inst.removeAttribute === "function") {
      for (const a of inst.getAttributesList()) inst.removeAttribute(a.name);
    }
  } catch (_) {}
  try {
    if (typeof inst.getTags === "function" && typeof inst.removeTag === "function") {
      for (const tg of inst.getTags()) inst.removeTag(tg);
    }
  } catch (_) {}
}


function captureThumbnail() {
  const payload = {};
  try { bus.emit("viewport:thumbnail", payload); } catch (_) {}
  const url = payload.dataUrl;
  if (typeof url === "string" && url.length <= ser.LIMITS.maxThumbBytes * 1.4 && ser.isValidDataUri(url)) {
    return url;
  }
  return null;
}

function captureCameraPose() {
  const payload = {};
  try { bus.emit("viewport:cameraPose", payload); } catch (_) {}
  const p = payload.position;
  const d = payload.direction;
  const fin = (v) => v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
  if (fin(p) && fin(d)) {
    return { position: { x: p.x, y: p.y, z: p.z }, direction: { x: d.x, y: d.y, z: d.z } };
  }
  return null;
}


export async function buildPlaceTextAsync(label, opts = {}) {
  const progress = opts.silent ? null : showProgress(label || "Saving…");
  try {
    const dm = store.getDataModel();
    if (!dm) throw new Error("DataModel indisponível.");


    const snap = engine.isRunning() && engine.snapshot ? engine.snapshot : null;
    const groups = [];
    for (const svc of dm.getChildren()) {
      let children;
      if (snap) {
        const entry = snap.services.find((e) => e.service === svc);


        const lockedLive = svc.getChildren().filter((k) => k && k._locked === true);
        children = lockedLive.concat(entry ? entry.childClones : []);
      } else {
        children = svc.getChildren();
      }
      groups.push({ name: svc.className, svc, children });
    }
    const flatRoots = [];
    for (const g of groups) for (const c of g.children) flatRoots.push(c);


    const skipRuntimeUnderLocked = (inst) => {
      const p = inst && inst.getParent ? inst.getParent() : null;
      if (!p || p._locked !== true) return false;
      const gp = p.getParent ? p.getParent() : null;
      return !(gp && gp.className === "DataModel");
    };
    const res = await ser.serializeInstancesAsync(
      flatRoots,
      { cache: serializationCache, skip: snap ? skipRuntimeUnderLocked : null },
      (f) => {
        if (progress) progress.update(f * 0.85);
      },
    );
    const warnings = res.warnings.slice();


    const tree = [];
    const services = {};
    let cursor = 0;
    for (const g of groups) {
      const ch = res.nodes.slice(cursor, cursor + g.children.length);
      cursor += g.children.length;
      const entry = { s: g.name, ch };



      const svcOpaque = readOpaqueProps(g.svc);
      if (svcOpaque.length) entry.u = svcOpaque.map((rec) => [unknownPropName(rec), rec.b64]);
      tree.push(entry);
      const props = extractServiceProps(g.svc);
      if (props) services[g.name] = props;
    }

    if (progress) progress.update(0.9, label);

    const assets = ser.serializeAssets(
      SECTIONS.reduce((acc, s) => acc.concat(assetStore.list(s)), []),
      warnings,
    );


    const terrain = ser.encodeTerrain(
      snap && snap.terrain && snap.terrain.data ? snap.terrain.data : terrainStore.getData(),
    );
    const bps = ser.serializeBreakpoints(breakpoints.listAll());
    const thumbnail = captureThumbnail();
    const camera = captureCameraPose();

    const fileObj = {
      format: ser.FORMAT_PLACE,
      formatVersion: ser.FORMAT_VERSION,
      editorVersion: ser.EDITOR_VERSION,
      savedAt: new Date().toISOString(),
      projectName: project.getName(),
      thumbnail,
      camera,
      gameSettings: project.getSettings(),
      services,
      tree,
      terrain,
      assets,
      breakpoints: bps,
      dataServicesConfig: DS.serializeConfig(),                                                                  


      interopChunks: getPlaceFileChunksForSave(dm),
      counts: { instances: res.count },
    };
    const text = JSON.stringify(fileObj);
    if (text.length > ser.LIMITS.maxFileBytes) {
      throw new Error("O projeto excede o limite de 200MB.");
    }
    if (progress) progress.update(1);
    logWarnings("Save", warnings);
    return { text, thumbnail, warnings, count: res.count };
  } finally {
    if (progress) progress.done();
  }
}


export function hasDestination() {
  return !!_dest;
}
export function getDestination() {
  return _dest ? { ..._dest } : null;
}


export function save() {
  if (_saving) return Promise.resolve(false);
  if (!_dest) {
    return import("../ui/dialogs/projectDialogs.js")
      .then(({ openSaveAsDialog }) => openSaveAsDialog())
      .catch((e) => {
        logger.warn("Save As indisponível: " + (e && e.message));
        return false;
      });
  }
  if (_dest.type === "idb") return saveToBrowser(_dest.name, _dest.id);
  return saveToFileDownload(_dest.fileName);
}


export async function saveToBrowser(rawName, existingId) {
  if (_saving) return false;
  _saving = true;
  const t0 = Date.now();
  try {
    setStatus("Saving…", false);
    const name = sanitizeName(String(rawName == null ? "" : rawName), "") || project.getName() || "Untitled Place";
    const built = await buildPlaceTextAsync("Saving…");
    const id = existingId || projectStore.newProjectId();
    await projectStore.putProject({ id, name, text: built.text, thumbnail: built.thumbnail });
    await versionHistory.recordVersion({
      projectKey: "idb:" + id,
      text: built.text,
      thumbnail: built.thumbnail,
    });
    _dest = { type: "idb", id, name };
    if (project.getName() !== name) project.setName(name);
    markSaved();
    writeSession();
    setStatus("Saved at " + timeNow());
    NotificationService.notify("success", "Project saved successfully");            
    logger.info(
      `Projeto salvo no navegador: "${name}" (${formatBytes(built.text.length)}, ${built.count} instâncias, ${Date.now() - t0}ms).`,
      { source: "Studio" },
    );
    return true;
  } catch (e) {
    showError("Falha ao salvar", (e && e.message) || "Erro desconhecido ao salvar.");
    return false;
  } finally {
    _saving = false;
  }
}


export async function saveToFileDownload(rawFileName) {
  if (_saving) return false;
  _saving = true;
  const t0 = Date.now();
  try {
    setStatus("Saving…", false);
    let fileName = safeFileName(rawFileName || project.getName() || "place");
    if (!fileName.toLowerCase().endsWith(ser.PLACE_EXT)) fileName += ser.PLACE_EXT;
    const built = await buildPlaceTextAsync("Saving…");
    downloadText(fileName, built.text);
    _dest = { type: "file", fileName };
    await versionHistory.recordVersion({
      projectKey: "file:" + fileName,
      text: built.text,
      thumbnail: built.thumbnail,
    });
    markSaved();
    setStatus("Saved (download) at " + timeNow());
    NotificationService.notify("success", "Project saved to file");            
    logger.info(
      `Projeto exportado: ${fileName} (${formatBytes(built.text.length)}, ${Date.now() - t0}ms).`,
      { source: "Studio" },
    );
    return true;
  } catch (e) {
    showError("Falha ao salvar", (e && e.message) || "Erro desconhecido ao salvar.");
    return false;
  } finally {
    _saving = false;
  }
}


async function loadPlaceObject(obj, opts = {}) {
  const progress = showProgress("Opening…");
  const t0 = Date.now();
  try {
    const warnings = Array.isArray(opts.warnings) ? opts.warnings.slice() : [];
    const dm = store.getDataModel();
    if (!dm) throw new Error("DataModel indisponível.");


    const groups = [];
    const flat = [];
    for (const g of Array.isArray(obj.tree) ? obj.tree : []) {
      if (!g || typeof g.s !== "string") continue;
      const ch = Array.isArray(g.ch) ? g.ch : [];
      groups.push({ s: g.s, count: ch.length, u: Array.isArray(g.u) ? g.u : null });
      for (const n of ch) flat.push(n);
    }
    const res = ser.deserializeInstances(flat, {});
    for (const w of res.warnings) warnings.push(w);
    progress.update(0.6);


    if (engine.isRunning()) {
      try { engine.stop(); } catch (_) {}
    }
    project.beginBulkLoad();
    try {
      for (const svc of dm.getChildren()) {
        for (const k of svc.getChildren().slice()) {


          if (k && k._locked === true) continue;
          try { k.destroy(); } catch (_) {                                          }
        }


        resetInstanceToDefaults(svc);
        for (const k of svc.getChildren()) {
          if (k && k._locked === true) resetInstanceToDefaults(k);
        }


        restoreOpaqueProps(svc, null);
      }
      let cursor = 0;
      for (const g of groups) {
        const roots = res.roots.slice(cursor, cursor + g.count);
        cursor += g.count;
        const svc = dm.getChildren().find((s) => s.className === g.s) || null;
        if (!svc) {
          warnings.push(`Serviço desconhecido ignorado: ${g.s}`);
          for (const r of roots) {
            if (r) { try { r.destroy(); } catch (_) {} }
          }
          continue;
        }
        const svcProps = obj.services && typeof obj.services === "object" ? obj.services[g.s] : null;
        if (svcProps && typeof svcProps === "object") {
          for (const key of Object.keys(svcProps)) {
            if (!svc.hasProperty(key)) {
              warnings.push(`Propriedade de serviço desconhecida ignorada: ${g.s}.${key}`);
              continue;
            }
            const okSet = svc.setProperty(key, svcProps[key]);
            if (okSet === false) warnings.push(`Valor de propriedade de serviço rejeitado: ${g.s}.${key}`);
          }
        }


        if (Array.isArray(g.u)) {
          for (const pair of g.u) {
            const magic = Array.isArray(pair) && typeof pair[0] === "string" ? pair[0] : null;
            const b64 = Array.isArray(pair) && typeof pair[1] === "string" ? pair[1] : "";
            const rec = magic ? unknownPropFromXml(magic, b64) : null;
            if (!rec || !attachOpaqueProp(svc, rec)) {
              warnings.push(`Carga opaca de serviço inválida ou acima do limite ignorada: ${g.s}`);
            }
          }
        }
        for (const r of roots) {
          if (!r) continue;


          const fixed =
            svc.getChildren().find(
              (k) => k !== r && k._locked === true && k.className === r.className,
            ) || null;
          if (fixed) {
            try {
              const descs = r
                .listProperties()
                .filter((d) => !d.readOnly && d.name !== "Name" && d.type !== PropTypes.Instance);


              for (const d of descs) fixed.setProperty(d.name, d.value);
              if (typeof r.getAttributesList === "function" && typeof fixed.setAttribute === "function") {
                if (typeof fixed.getAttributesList === "function" && typeof fixed.removeAttribute === "function") {
                  for (const a of fixed.getAttributesList()) fixed.removeAttribute(a.name);
                }
                for (const a of r.getAttributesList()) fixed.setAttribute(a.name, a.type, a.value);
              }
              if (typeof r.getTags === "function" && typeof fixed.addTag === "function") {
                for (const tg of r.getTags()) fixed.addTag(tg);
              }
            } catch (_) {                                                                }


            for (const kid of r.getChildren().slice()) {
              try { kid.setParent(fixed); } catch (_) {                               }
            }
            try { r.destroy(); } catch (_) {}
            continue;
          }
          r.setParent(svc);
        }
      }
      progress.update(0.8);


      ser.decodeTerrainInto(terrainStore.getData(), obj.terrain || null, warnings);
      terrainStore.notifyChanged();
      const assetRecs = ser.deserializeAssets(obj.assets, warnings);
      if (typeof assetStore.restoreLocal === "function") assetStore.restoreLocal(assetRecs);
      try {
        breakpoints.removeAll();
        for (const bp of ser.serializeBreakpoints(obj.breakpoints)) {
          breakpoints.addBreakpoint(bp.path, bp.line, bp);
        }
      } catch (e) {
        warnings.push("Breakpoints não restaurados: " + (e && e.message));
      }


      project.loadSettingsDirect(obj.gameSettings || null, obj.projectName);


      try { DS.loadConfig(obj.dataServicesConfig || null); } catch (_) {}


      for (const w of restorePlaceFileChunks(dm, Array.isArray(obj.interopChunks) ? obj.interopChunks : null)) {
        warnings.push(w);
      }
    } finally {
      project.endBulkLoad();
    }


    try { collection.rebuild(dm); } catch (_) {}


    commands.clear();
    try { selection.clear(); } catch (_) {}


    let camPose = null;
    if (obj.camera && typeof obj.camera === "object") {
      const p = obj.camera.position;
      const d = obj.camera.direction;
      const fin = (v) => v && Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z);
      if (fin(p) && fin(d) && Math.abs(d.x) + Math.abs(d.y) + Math.abs(d.z) > 1e-9) {
        camPose = {
          position: { x: p.x, y: p.y, z: p.z },
          direction: { x: d.x, y: d.y, z: d.z },
        };
      } else {
        warnings.push("Pose de câmera inválida no arquivo; câmera padrão usada.");
      }
    }
    bus.emit("camera:reset", { pose: camPose });
    _dest = opts.dest || null;


    _saveMark = opts.markDirty ? -1 : 0;
    if (opts.markDirty) project.markDirty();
    else project.markClean();
    bus.emit("project:loaded", { name: project.getName(), source: opts.sourceLabel || "" });
    writeSession();
    progress.update(1);
    setStatus('Opened "' + project.getName() + '"');
    NotificationService.notify("info", 'Project "' + project.getName() + '" loaded');            
    logger.info(
      `Projeto carregado (${res.total} instâncias, ${Date.now() - t0}ms).`,
      { source: "Studio" },
    );
    logWarnings("Open", warnings);
    return true;
  } catch (e) {
    showError("Falha ao abrir o projeto", (e && e.message) || "Erro desconhecido.");
    return false;
  } finally {
    progress.done();
  }
}


export async function openFromBrowser(id) {
  try {
    const rec = await projectStore.getProject(id);
    if (!rec || typeof rec.text !== "string") {
      showError("Falha ao abrir", "Projeto não encontrado no armazenamento do navegador.");
      return false;
    }
    let obj;
    try {
      obj = JSON.parse(rec.text);
    } catch (_) {
      showError("Falha ao abrir", "O projeto salvo está corrompido (JSON inválido). O projeto atual não foi alterado.");
      return false;
    }
    const v = ser.validateFileObject(obj, ser.FORMAT_PLACE);
    if (!v.ok) {
      showError("Falha ao abrir", v.error + " O projeto atual não foi alterado.");
      return false;
    }
    return loadPlaceObject(obj, {
      dest: { type: "idb", id: rec.id, name: rec.name },
      warnings: v.warnings,
      sourceLabel: "browser",
    });
  } catch (e) {
    showError("Falha ao abrir", (e && e.message) || "Erro desconhecido.");
    return false;
  }
}


export async function openFromFileText(text, sourceName) {
  const raw = String(text == null ? "" : text);
  if (raw.length > ser.LIMITS.maxFileBytes) {
    showError("Falha ao abrir", "O arquivo excede o limite de 200MB.");
    return false;
  }
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (_) {
    showError("Falha ao abrir", `"${sanitizeName(String(sourceName || "arquivo"))}" não é um arquivo de place válido (JSON inválido). O projeto atual não foi alterado.`);
    return false;
  }
  const v = ser.validateFileObject(obj, ser.FORMAT_PLACE);
  if (!v.ok) {
    showError("Falha ao abrir", v.error + " O projeto atual não foi alterado.");
    return false;
  }
  let fileName = safeFileName(sourceName || obj.projectName || "place");
  if (!fileName.toLowerCase().endsWith(ser.PLACE_EXT)) fileName += ser.PLACE_EXT;
  return loadPlaceObject(obj, {
    dest: { type: "file", fileName },
    warnings: v.warnings,
    sourceLabel: "file",
  });
}


export async function openFromCloudText(text, sourceName) {
  const raw = String(text == null ? "" : text);
  if (raw.length > ser.LIMITS.maxFileBytes) {
    showError("Falha ao abrir", "O arquivo excede o limite de 200MB.");
    return false;
  }
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (_) {
    showError("Falha ao abrir", `"${sanitizeName(String(sourceName || "place"))}" está corrompido na nuvem (JSON inválido). O projeto atual não foi alterado.`);
    return false;
  }
  const v = ser.validateFileObject(obj, ser.FORMAT_PLACE);
  if (!v.ok) {
    showError("Falha ao abrir", v.error + " O projeto atual não foi alterado.");
    return false;
  }
  return loadPlaceObject(obj, {
    dest: null,
    warnings: v.warnings,
    sourceLabel: "cloud",
  });
}


export async function restoreFromText(text, label) {
  const raw = String(text == null ? "" : text);


  if (raw.length > ser.LIMITS.maxFileBytes) {
    showError("Falha ao restaurar", "A versão excede o limite de 200MB.");
    return false;
  }
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (_) {
    showError("Falha ao restaurar", "A versão está corrompida (JSON inválido). O projeto atual não foi alterado.");
    return false;
  }
  const v = ser.validateFileObject(obj, ser.FORMAT_PLACE);
  if (!v.ok) {
    showError("Falha ao restaurar", v.error + " O projeto atual não foi alterado.");
    return false;
  }
  return loadPlaceObject(obj, {
    dest: _dest ? { ..._dest } : null,
    warnings: v.warnings,
    sourceLabel: String(label || "version"),
    markDirty: true,
  });
}


export function newPlace() {


  try {
    const dm0 = store.getDataModel();
    if (dm0) {
      for (const svc of dm0.getChildren()) {
        resetInstanceToDefaults(svc);
        for (const k of svc.getChildren()) {
          if (k && k._locked === true) resetInstanceToDefaults(k);
        }
      }
    }
  } catch (_) {}
  project.newPlace();                                                        


  try {
    const dm = store.getDataModel();
    if (dm) {
      for (const svc of dm.getChildren()) restoreOpaqueProps(svc, null);
      restorePlaceFileChunks(dm, null);
    }
  } catch (_) {}
  try {
    terrainStore.getData().clear();
    terrainStore.notifyChanged();
  } catch (_) {}
  try { breakpoints.removeAll(); } catch (_) {}
  _dest = null;
  _saveMark = 0;
  _sessionProjectId = null;
  bus.emit("camera:reset", { pose: null });
  bus.emit("project:loaded", { name: project.getName(), source: "new" });
  writeSession();
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


export async function exportSelectionToFile() {
  const roots = liveSelectionRoots();
  if (!roots.length) {
    setStatus("Nothing selected to export");
    return false;
  }
  try {
    const res = await ser.serializeInstancesAsync(roots, { cache: serializationCache });
    logWarnings("Export Selection", res.warnings);                               
    const fileObj = {
      format: ser.FORMAT_MODEL,
      formatVersion: ser.FORMAT_VERSION,
      editorVersion: ser.EDITOR_VERSION,
      savedAt: new Date().toISOString(),
      name: roots[0].name || "Model",
      tree: res.nodes,
      counts: { instances: res.count },
    };
    const fileName = safeFileName(roots.length === 1 ? roots[0].name : "selection") + ser.MODEL_EXT;
    downloadText(fileName, JSON.stringify(fileObj));
    setStatus("Exported selection (" + res.count + " object(s))");
    logger.info(`Seleção exportada: ${fileName} (${res.count} instâncias).`, { source: "Studio" });
    if (res.warnings.length) {
      setStatus("Exported with " + res.warnings.length + " warning(s) — see Output");
    }
    return true;
  } catch (e) {
    showError("Falha ao exportar", (e && e.message) || "Erro desconhecido.");
    return false;
  }
}


export function insertModelFromText(text, targetInst) {
  const raw = String(text == null ? "" : text);


  if (raw.length > ser.LIMITS.maxFileBytes) {
    showError("Falha ao inserir", "O arquivo excede o limite de 200MB.");
    return false;
  }
  let obj;
  try {
    obj = JSON.parse(raw);
  } catch (_) {
    showError("Falha ao inserir", "O arquivo não é um modelo válido (JSON inválido).");
    return false;
  }
  const v = ser.validateFileObject(obj, ser.FORMAT_MODEL);
  if (!v.ok) {
    showError("Falha ao inserir", v.error);
    return false;
  }
  let res;
  try {
    res = ser.deserializeInstances(obj.tree, {});
  } catch (e) {
    showError("Falha ao inserir", (e && e.message) || "Erro desconhecido.");
    return false;
  }
  const warnings = v.warnings.concat(res.warnings);
  const roots = res.instances;
  if (!roots.length) {
    showError("Falha ao inserir", "O arquivo não contém objetos válidos.");
    return false;
  }
  const dm = store.getDataModel();
  const target =
    targetInst && typeof targetInst.isDestroyed === "function" && !targetInst.isDestroyed()
      ? targetInst
      : getService(dm, "Workspace");
  if (!target) {
    showError("Falha ao inserir", "Destino indisponível.");
    return false;
  }


  const pose = captureCameraPose();
  if (pose) {
    const focus = {
      x: pose.position.x + pose.direction.x * 40,
      y: pose.position.y + pose.direction.y * 40,
      z: pose.position.z + pose.direction.z * 40,
    };
    const parts = [];
    for (const r of roots) {
      if (r.hasProperty && r.hasProperty("Position")) parts.push(r);
      for (const d of r.getDescendants()) {
        if (d.hasProperty && d.hasProperty("Position")) parts.push(d);
      }
    }
    if (parts.length) {
      let cx = 0, cy = 0, cz = 0;
      for (const p of parts) {
        const pos = p.getProperty("Position") || { x: 0, y: 0, z: 0 };
        cx += pos.x; cy += pos.y; cz += pos.z;
      }
      cx /= parts.length; cy /= parts.length; cz /= parts.length;
      const dx = focus.x - cx, dy = focus.y - cy, dz = focus.z - cz;
      for (const p of parts) {
        const pos = p.getProperty("Position") || { x: 0, y: 0, z: 0 };
        p.setProperty("Position", { x: pos.x + dx, y: pos.y + dy, z: pos.z + dz });
      }
    }
  }

  const cmd = {
    name: "Insert from File",
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
    showError("Falha ao inserir", "Não foi possível inserir os objetos.");
    return false;
  }
  try {
    if (typeof selection.set === "function") selection.set(roots);
    else if (typeof selection.selectSingle === "function") selection.selectSingle(roots[0]);
  } catch (_) {}
  setStatus("Inserted " + roots.length + " object(s) from file");
  logger.info(`Insert from File: ${roots.length} objeto(s) inserido(s) em ${target.name}.`, { source: "Studio" });
  logWarnings("Insert from File", warnings);
  return true;
}


function currentAutosaveProjectId() {
  if (_dest && _dest.type === "idb") return _dest.id;
  if (!_sessionProjectId) {
    _sessionProjectId = createResourceId("unsaved_");
  }
  return _sessionProjectId;
}

async function autosaveTick() {
  if (_autosaving || _saving) return;
  try {
    if (settings.get("autosave") === false) return;
    if (engine.isRunning()) return;                            
    if (!project.isDirty()) return;                         
    let intervalMin = Number(settings.get("autosaveIntervalMin"));
    if (!Number.isFinite(intervalMin)) intervalMin = 5;
    intervalMin = Math.min(60, Math.max(1, intervalMin));
    if (Date.now() - _lastAutosaveAt < intervalMin * 60000) return;
    if (!projectStore.storageAvailable()) return;
    _autosaving = true;
    const projectId = currentAutosaveProjectId();
    const built = await buildPlaceTextAsync("", { silent: true });                           
    const id = "as_" + projectId + "_" + Date.now().toString(36);
    await projectStore.putAutosave({ id, projectId, name: project.getName(), text: built.text });
    _lastAutosaveAt = Date.now();
    setStatus("Auto-saved " + timeNow());
    NotificationService.notify("success", "Auto-saved " + timeNow(), { silent: true });            
    logger.info(`Auto-save concluído (${formatBytes(built.text.length)}).`, { source: "Studio" });
  } catch (e) {


    _lastAutosaveAt = Date.now();
    logger.warn("Auto-save falhou: " + (e && e.message), { source: "Studio" });
    NotificationService.notify("warning", "Auto-Save failed, check storage space", {
      actionLabel: "Open Settings",
      actionCallback: () => import("../ui/dialogs/studioSettings.js").then((m) => m.openStudioSettings()),
      duration: 0,
    });            
  } finally {
    _autosaving = false;
  }
}

export async function listRecoveryAutosaves() {
  try {
    return await projectStore.listAutosaves();
  } catch (e) {
    logger.warn("Auto-Recovery: falha ao listar autosaves: " + (e && e.message));
    return [];
  }
}


export async function recoverAutosave(id) {
  try {
    const rec = await projectStore.getAutosave(id);
    if (!rec || typeof rec.text !== "string") {
      showError("Falha ao recuperar", "Autosave não encontrado.");
      return false;
    }
    let obj;
    try {
      obj = JSON.parse(rec.text);
    } catch (_) {
      showError("Falha ao recuperar", "O autosave está corrompido (JSON inválido). O projeto atual não foi alterado.");
      return false;
    }
    const v = ser.validateFileObject(obj, ser.FORMAT_PLACE);
    if (!v.ok) {
      showError("Falha ao recuperar", v.error + " O projeto atual não foi alterado.");
      return false;
    }
    const ok = await loadPlaceObject(obj, { dest: null, warnings: v.warnings, markDirty: true, sourceLabel: "autosave" });
    if (ok) setStatus("Recovered autosave — remember to Save");
    return ok;
  } catch (e) {
    showError("Falha ao recuperar", (e && e.message) || "Erro desconhecido.");
    return false;
  }
}

export async function deleteAutosave(id) {
  try {
    await projectStore.deleteAutosave(id);
    return true;
  } catch (e) {
    logger.warn("Falha ao deletar autosave: " + (e && e.message));
    return false;
  }
}


function writeSession() {
  try {
    writeJSON(SESSION_KEY, {
      active: true,
      startedAt: new Date().toISOString(),
      projectId: _dest && _dest.type === "idb" ? _dest.id : null,
      name: project.getName(),
    });
  } catch (_) {}
}

function clearSession() {
  try { remove(SESSION_KEY); } catch (_) {}
}

export function init() {
  if (_inited) return;
  _inited = true;


  const prev = readJSON(SESSION_KEY);
  writeSession();


  if (typeof globalThis.addEventListener === "function") {
    globalThis.addEventListener("pagehide", clearSession);
    globalThis.addEventListener("beforeunload", (e) => {
      if (!project.isDirty()) return;
      e.preventDefault();
      e.returnValue = "";                                   
    });
  }


  let lastUndoSize = commands.getUndoSize();
  bus.on("history:changed", (p) => {
    if (!p) return;
    if (typeof p.undo === "number") lastUndoSize = p.undo;
    if (engine.isRunning()) return;
    if (typeof p.undo === "number" && _saveMark >= 0 && p.undo === _saveMark && project.isDirty()) {
      project.markClean();
    }
  });


  bus.on("command:executed", () => {
    const size = commands.getUndoSize();
    if (_saveMark >= 0) {
      if (size <= _saveMark) {
        _saveMark = -1;                                              
      } else if (size === lastUndoSize) {
        _saveMark -= 1;                                              
        if (_saveMark < 0) _saveMark = -1;
      }
    }
    lastUndoSize = size;
  });

  versionHistory.setProjectKeyProvider(() => {
    if (_dest && _dest.type === "idb") return "idb:" + _dest.id;
    if (_dest && _dest.type === "file") return "file:" + _dest.fileName;
    return "session:" + currentAutosaveProjectId();
  });


  _autosaveTimer = setInterval(autosaveTick, AUTOSAVE_TICK_MS);


  if (prev && prev.active) {
    listRecoveryAutosaves().then((list) => {
      if (!list.length) return;
      import("../ui/dialogs/projectDialogs.js")
        .then(({ openRecoverDialog }) => openRecoverDialog(list, { fromCrash: true }))
        .catch(() => {});
    });
  }

  logger.info("Persistência inicializada (Parte 37).", { source: "Studio" });
}

export function disposeTimers() {
  if (_autosaveTimer) {
    clearInterval(_autosaveTimer);
    _autosaveTimer = null;
  }
}


export const persistence = {
  init,
  save,
  saveToBrowser,
  saveToFileDownload,
  openFromBrowser,
  openFromFileText,
  openFromCloudText,
  newPlace,
  exportSelectionToFile,
  insertModelFromText,
  buildPlaceTextAsync,
  restoreFromText,
  hasDestination,
  getDestination,
  listRecoveryAutosaves,
  recoverAutosave,
  deleteAutosave,
  formatBytes,
  safeFileName,
};
