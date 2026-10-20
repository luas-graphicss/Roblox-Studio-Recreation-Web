import { bus } from "../core/eventBus.js";
import { logger } from "../core/logger.js";
import * as projectStore from "../persistence/projectStore.js";
import { hashString } from "../persistence/serializer.js";
import { diffPlaceObjects } from "./treeDiff.js";
import { NotificationService } from "../services/notifications.js";            

export const COMMENT_MAX = 500;
export const MAX_VERSIONS = projectStore.MAX_VERSIONS_PER_PROJECT;

let _pendingComment = "";
let _authorProvider = () => "Owner";
let _projectKeyProvider = () => "session:local";
const _lastHashByKey = new Map();

export function sanitizeComment(raw) {
  let s = String(raw == null ? "" : raw);
  s = s.replace(/<[^>]*>/g, " ");
  s = s.replace(/[<>]/g, " ");
  s = s.replace(/\s+/g, " ").trim();
  return s.slice(0, COMMENT_MAX);
}

export function setPendingComment(comment) {
  _pendingComment = sanitizeComment(comment);
}

export function peekPendingComment() {
  return _pendingComment;
}

export function setAuthorProvider(fn) {
  if (typeof fn === "function") _authorProvider = fn;
}

export function setProjectKeyProvider(fn) {
  if (typeof fn === "function") _projectKeyProvider = fn;
}

export function currentProjectKey() {
  try {
    return String(_projectKeyProvider() || "session:local");
  } catch (_) {
    return "session:local";
  }
}

export async function recordVersion(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  if (typeof o.text !== "string" || !o.text) return null;
  if (!projectStore.storageAvailable()) return null;
  const projectKey = String(o.projectKey || currentProjectKey());
  const comment = sanitizeComment(o.comment != null ? o.comment : _pendingComment);
  if (o.comment == null) _pendingComment = "";
  let author = String(o.author || "");
  if (!author) {
    try {
      author = String(_authorProvider() || "Owner");
    } catch (_) {
      author = "Owner";
    }
  }
  const hash = hashString(o.text) + ":" + o.text.length;
  if (!o.force && _lastHashByKey.get(projectKey) === hash && !comment) {
    return null;
  }
  try {
    const meta = await projectStore.putVersion({
      projectKey,
      text: o.text,
      thumbnail: o.thumbnail || null,
      author: author.slice(0, 80),
      comment,
    });
    _lastHashByKey.set(projectKey, hash);
    bus.emit("versions:changed", { projectKey, num: meta.num });
    return meta;
  } catch (e) {
    logger.warn("Version History: falha ao gravar vers\u00e3o: " + (e && e.message));
    return null;
  }
}

export async function listVersions(projectKey) {
  return projectStore.safeListVersions(projectKey || currentProjectKey());
}

export async function getVersionText(id) {
  try {
    return await projectStore.getVersionText(id);
  } catch (e) {
    logger.warn("Version History: falha ao carregar vers\u00e3o: " + (e && e.message));
    return null;
  }
}

export async function deleteVersion(id) {
  try {
    await projectStore.deleteVersion(id);



    _lastHashByKey.clear();
    bus.emit("versions:changed", { deleted: String(id) });
    return true;
  } catch (e) {
    logger.warn("Version History: falha ao apagar vers\u00e3o: " + (e && e.message));
    return false;
  }
}

export async function restoreVersion(meta) {
  if (!meta || !meta.id) return false;
  const text = await getVersionText(meta.id);
  if (typeof text !== "string" || !text) {
    logger.warn("Version History: vers\u00e3o sem conte\u00fado para restaurar.");


    NotificationService.notify("error", "Restore da v" + (meta.num || "?") + " falhou: o conte\u00fado da vers\u00e3o n\u00e3o p\u00f4de ser carregado.");
    return false;
  }
  const p = await import("../persistence/persistence.js");
  try {
    const built = await p.buildPlaceTextAsync("Preparando backup\u2026");
    await recordVersion({
      text: built.text,
      thumbnail: built.thumbnail,
      comment: "Backup autom\u00e1tico antes de restaurar v" + (meta.num || "?"),
      force: true,
    });
  } catch (e) {
    logger.warn("Version History: backup pr\u00e9-restore falhou: " + (e && e.message));
  }
  const ok = await p.restoreFromText(text, "v" + (meta.num || "?"));
  if (ok) {
    bus.emit("versions:restored", { id: meta.id, num: meta.num });
    NotificationService.notify("success", "Version v" + (meta.num || "?") + " restored");            
    logger.info("Vers\u00e3o v" + meta.num + " restaurada.", { source: "Studio" });
  } else {


    NotificationService.notify("error", "Restore da v" + (meta.num || "?") + " falhou \u2014 o arquivo da vers\u00e3o n\u00e3o p\u00f4de ser aplicado (veja o Output).");
  }
  return ok;
}

export async function compareVersions(metaA, metaB) {


  if (!metaA || !metaA.id || !metaB || !metaB.id) return null;
  const older = (metaA.num || 0) <= (metaB.num || 0) ? metaA : metaB;
  const newer = older === metaA ? metaB : metaA;
  const aText = await getVersionText(older.id);
  const bText = await getVersionText(newer.id);
  if (typeof aText !== "string" || typeof bText !== "string") return null;
  let aObj;
  let bObj;
  try {
    aObj = JSON.parse(aText);
    bObj = JSON.parse(bText);
  } catch (_) {
    return null;
  }
  return { a: older, b: newer, aObj, bObj, diff: diffPlaceObjects(aObj, bObj) };
}

export function downloadVersion(meta, text, projectName) {
  if (!meta || typeof text !== "string") return false;
  if (typeof document === "undefined") return false;
  const base = String(projectName || "place").replace(/[\\/:*?"<>|]/g, "_").trim() || "place";
  const blob = new Blob([text], { type: "application/json" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = base + "-v" + (meta.num || 0) + ".rswp";
  document.body.appendChild(a);
  a.click();
  setTimeout(() => {
    URL.revokeObjectURL(url);
    if (a.parentNode) a.parentNode.removeChild(a);
  }, 1500);                                                                              
  return true;
}
