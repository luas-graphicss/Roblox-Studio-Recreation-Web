import {
  serializeInstances,
  deserializeInstances,
  hashString,
  FORMAT_MODEL,
  FORMAT_VERSION,
  EDITOR_VERSION,
} from "../persistence/serializer.js";
import { packageStore, MAX_PACKAGES } from "./packageStore.js";
import { createInstance, Events } from "../datamodel/index.js";
import { store } from "../core/state.js";
import { commands } from "../core/commands.js";
import { bus } from "../core/eventBus.js";
import { logger } from "../core/logger.js";
import { createResourceId } from "../core/resourceId.js";           

const SERVICE_DENY = new Set([
  "DataModel", "Workspace", "Players", "Lighting", "ReplicatedStorage",
  "ServerStorage", "ServerScriptService", "StarterGui", "StarterPack",
  "StarterPlayer", "SoundService", "Teams", "Chat", "TextChatService",
  "Terrain", "CollectionService", "TweenService", "RunService",
]);

let seq = 0;


const convertBusy = new Set();           
const publishBusy = new Set();           

export function newPackageId() {
  seq += 1;
  return createResourceId("pkg_" + seq.toString(36) + "_");
}

export function sanitizePackageName(v) {
  const s = String(v == null ? "" : v).replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  return (s || "Package").slice(0, 60);
}

export function sanitizeDescription(v) {
  const s = String(v == null ? "" : v).replace(/<[^>]*>/g, "").trim();
  return s.slice(0, 500);
}

function isInst(x) {
  return !!(x && typeof x.isDestroyed === "function" && !x.isDestroyed());
}

export function linkOf(inst) {
  if (!isInst(inst) || typeof inst.getChildren !== "function") return null;
  return inst.getChildren().find((c) => c.className === "PackageLink" && !c.isDestroyed()) || null;
}

export function isPackageCopy(inst) {
  return !!linkOf(inst);
}

export function findPackageRootFor(inst) {
  let cur = inst;
  while (isInst(cur)) {
    if (linkOf(cur)) return cur;
    cur = typeof cur.getParent === "function" ? cur.getParent() : null;
  }
  return null;
}


function allPackageRootsFor(inst) {
  const out = [];
  let cur = inst;
  while (isInst(cur)) {
    if (linkOf(cur)) out.push(cur);
    cur = typeof cur.getParent === "function" ? cur.getParent() : null;
  }
  return out;
}

export function setLinkValue(link, name, value) {
  if (!isInst(link) || !link._props) return false;
  const entry = link._props.get(name);
  if (!entry) return false;
  if (entry.value === value) return false;
  const old = entry.value;
  entry.value = value;
  link._emitProp(name, value, old);
  return true;
}

export function snapshotText(root) {


  const res = serializeInstances([root], {
    skip: (i) => i.className === "PackageLink" && i.getParent() === root,
  });
  const fileObj = {
    format: FORMAT_MODEL,
    formatVersion: FORMAT_VERSION,
    editorVersion: EDITOR_VERSION,
    name: root.name || "Package",
    tree: res.nodes,
    counts: { instances: res.count },
  };
  return { text: JSON.stringify(fileObj), warnings: res.warnings, count: res.count };
}

export function contentHashOf(root) {
  const snap = snapshotText(root);
  return String(hashString(snap.text)) + ":" + snap.text.length;
}

function dataModel() {
  return store.getDataModel ? store.getDataModel() : null;
}

export function allLinks() {
  const dm = dataModel();
  if (!dm) return [];
  const out = [];


  const stack = [dm];
  while (stack.length) {
    const inst = stack.pop();
    if (!isInst(inst)) continue;
    if (inst.className === "PackageLink") {
      out.push(inst);
      continue;
    }
    const kids = inst.getChildren();
    for (let i = kids.length - 1; i >= 0; i--) stack.push(kids[i]);
  }
  return out;
}

export function copiesOf(packageId) {
  const id = String(packageId || "");
  if (!id) return [];
  const out = [];
  const seen = new Set();
  for (const link of allLinks()) {
    if (String(link.getProperty("PackageId")) !== id) continue;
    const parent = link.getParent();
    if (!isInst(parent) || seen.has(parent.id)) continue;


    if (linkOf(parent) !== link) continue;
    seen.add(parent.id);
    out.push(parent);
  }
  return out;
}

export function computeStatus(copy, meta) {
  const link = linkOf(copy);
  if (!link || !meta) return "UpToDate";
  const ver = Number(link.getProperty("VersionNumber")) || 1;
  if (ver < meta.version) return "OutOfDate";
  return contentHashOf(copy) === meta.latestHash ? "UpToDate" : "Modified";
}

export async function refreshStatus(copy) {
  try {
    const link = linkOf(copy);
    if (!link) return null;
    const meta = await packageStore.getPackage(link.getProperty("PackageId"));
    const status = computeStatus(copy, meta);
    if (setLinkValue(link, "Status", status)) {
      bus.emit("packages:statusChanged", { copy, link, status });
    }
    return status;
  } catch (err) {


    logger.warn("Falha ao atualizar status de package: " + ((err && err.message) || err));
    return null;
  }
}

export async function refreshAllStatuses() {
  const seen = new Set();
  for (const link of allLinks()) {
    const copy = link.getParent();
    if (!isInst(copy) || seen.has(copy.id)) continue;
    seen.add(copy.id);
    await refreshStatus(copy);
  }
}


function storeError(err, fallback) {
  const msg = err && err.message ? String(err.message) : "";
  return msg ? fallback + " (" + msg + ")" : fallback;
}

export async function convertToPackage(root, opts = {}) {
  let busyRootId = null;
  try {
    if (!isInst(root)) return { ok: false, error: "Selecione um objeto v\u00e1lido." };
    if (SERVICE_DENY.has(root.className)) {
      return { ok: false, error: "Servi\u00e7os n\u00e3o podem virar Package." };
    }
    if (linkOf(root)) return { ok: false, error: "Este objeto j\u00e1 \u00e9 um Package." };


    if (convertBusy.has(root.id)) {
      return { ok: false, error: "Convers\u00e3o j\u00e1 em andamento para este objeto." };
    }
    busyRootId = root.id;
    convertBusy.add(busyRootId);
    const count = await packageStore.packageCount();
    if (count >= MAX_PACKAGES) {
      return { ok: false, error: "Limite de " + MAX_PACKAGES + " packages atingido." };
    }
    const id = newPackageId();
    const name = sanitizePackageName(opts.name || root.name);
    const description = sanitizeDescription(opts.description);
    const icon = String(opts.icon || "package").slice(0, 40);
    let snap;
    try {
      snap = snapshotText(root);
    } catch (err) {
      return { ok: false, error: (err && err.message) || "Falha ao serializar." };
    }
    const latestHash = String(hashString(snap.text)) + ":" + snap.text.length;
    const now = Date.now();
    const putMeta = await packageStore.putPackage({
      id, name, description, icon, version: 1, createdAt: now, updatedAt: now, latestHash,
    });
    if (!putMeta.ok) return { ok: false, error: putMeta.error };
    let putVer;
    try {
      putVer = await packageStore.putVersion(id, 1, snap.text, { contentHash: latestHash, at: now });
    } catch (err) {


      try { await packageStore.deletePackage(id); } catch (_) {                      }
      throw err;
    }
    if (!putVer.ok) {
      await packageStore.deletePackage(id);
      return { ok: false, error: putVer.error };
    }


    if (!isInst(root) || linkOf(root)) {
      try { await packageStore.deletePackage(id); } catch (_) {                      }
      return {
        ok: false,
        error: isInst(root)
          ? "O objeto virou Package durante a convers\u00e3o."
          : "O objeto foi removido durante a convers\u00e3o.",
      };
    }
    const link = createInstance("PackageLink", { name: "PackageLink" });
    link.setProperty("PackageId", id);
    setLinkValue(link, "VersionNumber", 1);
    setLinkValue(link, "Status", "UpToDate");


    const doConvert = () => {
      link.setParent(root);
      bus.emit("packages:changed", { type: "created", packageId: id });
      return true;
    };
    const done = commands.execute({
      name: "Convert to Package",
      do: doConvert,
      undo: () => {
        link.setParent(null);
        bus.emit("packages:changed", { type: "unlinked", packageId: id });
        return true;
      },
    });
    if (!done) {
      doConvert();
    }
    logger.info("Package criado: " + name + " (v1).", { source: "Studio" });
    return { ok: true, packageId: id, link };
  } catch (err) {
    return { ok: false, error: storeError(err, "Falha no armazenamento de packages.") };
  } finally {
    if (busyRootId != null) convertBusy.delete(busyRootId);
  }
}

export async function insertCopy(packageId, parentInst) {
  try {
    const meta = await packageStore.getPackage(packageId);
    if (!meta) return { ok: false, error: "Package n\u00e3o encontrado." };
    const text = await packageStore.getVersionText(meta.id, meta.version);
    if (!text) return { ok: false, error: "Vers\u00e3o do package indispon\u00edvel." };


    const dm = dataModel();
    let target = isInst(parentInst) ? parentInst : null;
    if (!target && dm) {
      target = dm.getChildren().find((c) => c.className === "Workspace") || null;
    }
    if (!target) return { ok: false, error: "Destino indispon\u00edvel." };


    for (let cur = target; isInst(cur); cur = typeof cur.getParent === "function" ? cur.getParent() : null) {
      const curLink = linkOf(cur);
      if (curLink && String(curLink.getProperty("PackageId")) === String(meta.id)) {
        return { ok: false, error: "N\u00e3o \u00e9 poss\u00edvel inserir um package dentro de uma c\u00f3pia dele mesmo." };
      }
    }
    let res;
    try {
      res = deserializeInstances(JSON.parse(text).tree, {});
    } catch (err) {
      return { ok: false, error: (err && err.message) || "Package corrompido." };
    }
    const root = res.instances && res.instances[0];


    for (let i = 1; i < ((res.instances && res.instances.length) || 0); i++) {
      const extra = res.instances[i];
      if (extra && typeof extra.destroy === "function") {
        try { extra.destroy(); } catch (_) {                      }
      }
    }
    if (!root) return { ok: false, error: "Package vazio." };
    const link = createInstance("PackageLink", { name: "PackageLink" });
    link.setProperty("PackageId", meta.id);
    setLinkValue(link, "VersionNumber", meta.version);
    setLinkValue(link, "Status", "UpToDate");
    link.setParent(root);


    const doInsert = () => {
      root.setParent(target);
      bus.emit("packages:changed", { type: "inserted", packageId: meta.id });
      return true;
    };
    const done = commands.execute({
      name: "Insert Package",
      do: doInsert,
      undo: () => {
        root.setParent(null);
        bus.emit("packages:changed", { type: "removed", packageId: meta.id });
        return true;
      },
    });
    if (!done) doInsert();


    schedulePackageRootsIn(root);
    return { ok: true, instance: root, warnings: res.warnings };
  } catch (err) {
    return { ok: false, error: storeError(err, "Falha no armazenamento de packages.") };
  }
}


function applyParsedToCopy(copy, link, text, versionNum, status) {
  if (!isInst(copy) || !isInst(link)) return { ok: false, error: "C\u00f3pia indispon\u00edvel." };
  let res;
  try {
    res = deserializeInstances(JSON.parse(text).tree, {});
  } catch (err) {
    return { ok: false, error: (err && err.message) || "Package corrompido." };
  }
  const fresh = res.instances && res.instances[0];


  for (let i = 1; i < ((res.instances && res.instances.length) || 0); i++) {
    const extra = res.instances[i];
    if (extra && typeof extra.destroy === "function") {
      try { extra.destroy(); } catch (_) {                      }
    }
  }
  if (!fresh) return { ok: false, error: "Package vazio." };
  for (const ch of [...copy.getChildren()]) {
    if (ch !== link) ch.destroy();
  }
  for (const ch of [...fresh.getChildren()]) {
    ch.setParent(copy);
  }
  if (fresh.className === copy.className) {
    for (const d of fresh.listProperties()) {
      if (d.readOnly) continue;
      copy.setProperty(d.name, d.value);
    }


    if (typeof fresh.listDynamicProperties === "function" && typeof copy.defineDynamicProperty === "function") {
      for (const dp of fresh.listDynamicProperties()) {
        if (!copy.hasProperty(dp.name)) copy.defineDynamicProperty(dp);
      }
    }


    if (typeof copy.getAttributesList === "function" && typeof fresh.getAttributesList === "function") {
      const freshAttrs = fresh.getAttributesList();
      const keep = new Set(freshAttrs.map((a) => a.name));
      for (const a of copy.getAttributesList()) {
        if (!keep.has(a.name)) copy.removeAttribute(a.name);
      }
      for (const a of freshAttrs) {
        copy.setAttribute(a.name, a.type, a.value);
      }
    }

    if (typeof copy.getTags === "function" && typeof fresh.getTags === "function") {
      const freshTags = new Set(fresh.getTags());
      for (const t of copy.getTags()) {
        if (!freshTags.has(t)) copy.removeTag(t);
      }
      for (const t of freshTags) copy.addTag(t);
    }
  }
  fresh.destroy();
  const verChanged = setLinkValue(link, "VersionNumber", Math.max(1, Math.floor(Number(versionNum) || 1)));
  const stChanged = setLinkValue(link, "Status", String(status || "UpToDate"));


  if (verChanged || stChanged) {
    bus.emit("packages:statusChanged", {
      copy,
      link,
      status: String(link.getProperty("Status") || "UpToDate"),
    });
  }

  schedulePackageRootsIn(copy);
  return { ok: true, warnings: res.warnings };
}





export function applyTextToCopy(copy, text, versionNum, opts = {}) {
  const link = linkOf(copy);
  if (!link) return { ok: false, error: "O objeto n\u00e3o \u00e9 c\u00f3pia de package." };


  const body = String(text == null ? "" : text);
  let parsed;
  try {
    parsed = JSON.parse(body);
  } catch (err) {
    return { ok: false, error: (err && err.message) || "Package corrompido." };
  }
  if (!parsed || !Array.isArray(parsed.tree) || parsed.tree.length === 0) {
    return { ok: false, error: "Package vazio." };
  }

  const prevVersion = Number(link.getProperty("VersionNumber")) || 1;
  const prevStatus = String(link.getProperty("Status") || "UpToDate");
  let prevText = null;
  try {
    prevText = snapshotText(copy).text;
  } catch (_) {
    prevText = null;                                                          
  }
  let result = { ok: false, error: "Opera\u00e7\u00e3o bloqueada (reentr\u00e2ncia)." };
  let ran = false;
  const run = () => {
    ran = true;
    result = applyParsedToCopy(copy, link, body, versionNum, "UpToDate");
    return result.ok;
  };
  if (opts.undoable === false || !prevText) {
    run();
    return result;
  }
  const done = commands.execute({
    name: String(opts.commandName || "Update Package"),
    do: run,
    undo: () => {
      applyParsedToCopy(copy, link, prevText, prevVersion, prevStatus);
      return true;
    },
  });


  if (!done && !ran) run();
  return result;
}

export async function publishFromCopy(copy) {
  let busyLinkId = null;
  try {
    const link = linkOf(copy);
    if (!link) return { ok: false, error: "O objeto n\u00e3o \u00e9 c\u00f3pia de package." };


    if (publishBusy.has(link.id)) {
      return { ok: false, error: "Publica\u00e7\u00e3o j\u00e1 em andamento." };
    }
    busyLinkId = link.id;
    publishBusy.add(busyLinkId);
    const meta = await packageStore.getPackage(link.getProperty("PackageId"));
    if (!meta) return { ok: false, error: "Package n\u00e3o encontrado." };




    if (!isInst(copy) || linkOf(copy) !== link) {
      return { ok: false, error: "A c\u00f3pia foi removida ou desvinculada durante a publica\u00e7\u00e3o." };
    }




    const ver = Number(link.getProperty("VersionNumber")) || 1;
    if (ver < meta.version) {
      return {
        ok: false,
        error: "A c\u00f3pia est\u00e1 na v" + ver + " e o package na v" + meta.version + ". Use Update Package antes de publicar.",
      };
    }


    {
      const scan = [];
      for (const ch of copy.getChildren()) {
        if (ch.className === "PackageLink") continue;
        scan.push(ch);
      }
      while (scan.length) {
        const cur = scan.pop();
        if (!isInst(cur)) continue;
        if (cur.className === "PackageLink" && String(cur.getProperty("PackageId")) === String(meta.id)) {
          return { ok: false, error: "O package cont\u00e9m uma c\u00f3pia dele mesmo aninhada; remova-a antes de publicar." };
        }
        for (const ch of cur.getChildren()) scan.push(ch);
      }
    }
    let snap;
    try {
      snap = snapshotText(copy);
    } catch (err) {
      return { ok: false, error: (err && err.message) || "Falha ao serializar." };
    }
    const latestHash = String(hashString(snap.text)) + ":" + snap.text.length;


    if (latestHash === meta.latestHash) {
      setLinkValue(link, "VersionNumber", meta.version);
      setLinkValue(link, "Status", "UpToDate");
      return { ok: false, error: "Nenhuma modifica\u00e7\u00e3o para publicar (conte\u00fado id\u00eantico \u00e0 v" + meta.version + ")." };
    }
    const newVersion = meta.version + 1;
    const now = Date.now();
    const putVer = await packageStore.putVersion(meta.id, newVersion, snap.text, { contentHash: latestHash, at: now });
    if (!putVer.ok) return { ok: false, error: putVer.error };
    const putMeta = await packageStore.putPackage({ ...meta, version: newVersion, updatedAt: now, latestHash });
    if (!putMeta.ok) {


      try { await packageStore.deleteVersion(meta.id, newVersion); } catch (_) {                      }
      return { ok: false, error: putMeta.error };
    }
    setLinkValue(link, "VersionNumber", newVersion);
    setLinkValue(link, "Status", "UpToDate");
    let updated = 0;
    for (const other of copiesOf(meta.id)) {
      if (other === copy) continue;
      const otherLink = linkOf(other);
      if (!otherLink) continue;
      if (otherLink.getProperty("AutoUpdate") === true) {


        const r = applyTextToCopy(other, snap.text, newVersion, { undoable: false });
        if (r.ok) updated += 1;
      } else {
        if (setLinkValue(otherLink, "Status", "OutOfDate")) {
          bus.emit("packages:statusChanged", { copy: other, link: otherLink, status: "OutOfDate" });
        }
      }
    }
    bus.emit("packages:changed", { type: "published", packageId: meta.id, version: newVersion });
    logger.info("Package " + meta.name + " publicado (v" + newVersion + "); " + updated + " c\u00f3pia(s) auto-atualizada(s).", { source: "Studio" });
    return { ok: true, version: newVersion, autoUpdated: updated };
  } catch (err) {
    return { ok: false, error: storeError(err, "Falha no armazenamento de packages.") };
  } finally {
    if (busyLinkId != null) publishBusy.delete(busyLinkId);
  }
}

export async function updateCopy(copy) {
  try {
    const link = linkOf(copy);
    if (!link) return { ok: false, error: "O objeto n\u00e3o \u00e9 c\u00f3pia de package." };
    const meta = await packageStore.getPackage(link.getProperty("PackageId"));
    if (!meta) return { ok: false, error: "Package n\u00e3o encontrado." };
    const text = await packageStore.getVersionText(meta.id, meta.version);
    if (!text) return { ok: false, error: "Vers\u00e3o do package indispon\u00edvel." };
    const r = applyTextToCopy(copy, text, meta.version, { commandName: "Update Package" });
    if (r.ok) bus.emit("packages:changed", { type: "updated", packageId: meta.id });
    return r;
  } catch (err) {
    return { ok: false, error: storeError(err, "Falha no armazenamento de packages.") };
  }
}

export async function updateAllCopies(packageId) {
  try {
    const meta = await packageStore.getPackage(packageId);
    if (!meta) return { ok: false, error: "Package n\u00e3o encontrado." };
    const text = await packageStore.getVersionText(meta.id, meta.version);
    if (!text) return { ok: false, error: "Vers\u00e3o do package indispon\u00edvel." };


    const targets = [];
    for (const copy of copiesOf(meta.id)) {
      const link = linkOf(copy);
      if (!link) continue;
      const ver = Number(link.getProperty("VersionNumber")) || 1;
      if (ver < meta.version) targets.push(copy);
    }
    if (!targets.length) return { ok: true, updated: 0 };

    const prevs = targets.map((copy) => {
      const link = linkOf(copy);
      let prevText = null;
      try {
        prevText = snapshotText(copy).text;
      } catch (_) {
        prevText = null;
      }
      return {
        copy,
        prevText,
        prevVersion: link ? Number(link.getProperty("VersionNumber")) || 1 : 1,
        prevStatus: link ? String(link.getProperty("Status") || "UpToDate") : "UpToDate",
      };
    });
    let updated = 0;
    const applyAll = () => {
      updated = 0;
      for (const p of prevs) {
        const link = linkOf(p.copy);


        if (!isInst(p.copy) || !link) continue;
        const r = applyParsedToCopy(p.copy, link, text, meta.version, "UpToDate");
        if (r.ok) updated += 1;
      }
      return true;
    };
    const done = commands.execute({
      name: "Update All Copies",
      do: applyAll,
      undo: () => {
        for (let i = prevs.length - 1; i >= 0; i--) {
          const p = prevs[i];
          const link = linkOf(p.copy);
          if (!p.prevText || !isInst(p.copy) || !link) continue;
          applyParsedToCopy(p.copy, link, p.prevText, p.prevVersion, p.prevStatus);
        }
        return true;
      },
    });
    if (!done) applyAll();
    if (updated) bus.emit("packages:changed", { type: "updated", packageId: meta.id });
    return { ok: true, updated };
  } catch (err) {
    return { ok: false, error: storeError(err, "Falha no armazenamento de packages.") };
  }
}

export async function revertCopy(copy) {
  try {
    const link = linkOf(copy);
    if (!link) return { ok: false, error: "O objeto n\u00e3o \u00e9 c\u00f3pia de package." };
    const id = link.getProperty("PackageId");
    const ver = Number(link.getProperty("VersionNumber")) || 1;
    const text = await packageStore.getVersionText(id, ver);
    if (!text) return { ok: false, error: "Vers\u00e3o do package indispon\u00edvel." };
    const r = applyTextToCopy(copy, text, ver, { commandName: "Undo Changes to Package" });
    if (r.ok) bus.emit("packages:changed", { type: "reverted", packageId: String(id) });
    return r;
  } catch (err) {
    return { ok: false, error: storeError(err, "Falha no armazenamento de packages.") };
  }
}

export function unlinkCopy(copy) {
  const link = linkOf(copy);
  if (!link) return { ok: false, error: "O objeto n\u00e3o \u00e9 c\u00f3pia de package." };


  const doUnlink = () => {
    link.setParent(null);
    bus.emit("packages:changed", { type: "unlinked" });
    return true;
  };
  const done = commands.execute({
    name: "Unlink Package",
    do: doUnlink,
    undo: () => {
      link.setParent(copy);
      bus.emit("packages:changed", { type: "relinked" });
      return true;
    },
  });
  if (!done) doUnlink();
  return { ok: true };
}

export async function renamePackage(packageId, newName) {
  try {
    const meta = await packageStore.getPackage(packageId);
    if (!meta) return { ok: false, error: "Package n\u00e3o encontrado." };
    const r = await packageStore.putPackage({ ...meta, name: sanitizePackageName(newName), updatedAt: Date.now() });
    if (r.ok) bus.emit("packages:changed", { type: "renamed", packageId: meta.id });
    return r;
  } catch (err) {
    return { ok: false, error: storeError(err, "Falha no armazenamento de packages.") };
  }
}

export async function deletePackageEverywhere(packageId) {
  try {
    const meta = await packageStore.getPackage(packageId);
    if (!meta) return { ok: false, error: "Package n\u00e3o encontrado." };


    for (const link of allLinks()) {
      if (String(link.getProperty("PackageId")) !== String(meta.id)) continue;
      try { link.destroy(); } catch (_) {                      }
    }
    await packageStore.deletePackage(meta.id);
    bus.emit("packages:changed", { type: "deleted", packageId: meta.id });
    logger.info("Package removido: " + meta.name + " (c\u00f3pias desvinculadas).", { source: "Studio" });
    return { ok: true };
  } catch (err) {
    return { ok: false, error: storeError(err, "Falha no armazenamento de packages.") };
  }
}

export async function restorePackageVersion(packageId, num) {
  try {
    const meta = await packageStore.getPackage(packageId);
    if (!meta) return { ok: false, error: "Package n\u00e3o encontrado." };
    const text = await packageStore.getVersionText(meta.id, num);
    if (!text) return { ok: false, error: "Vers\u00e3o n\u00e3o encontrada." };
    const newVersion = meta.version + 1;
    const latestHash = String(hashString(text)) + ":" + text.length;


    if (latestHash === meta.latestHash) {
      return { ok: false, error: "Essa vers\u00e3o \u00e9 id\u00eantica \u00e0 atual (v" + meta.version + ") — nada a restaurar." };
    }
    const now = Date.now();
    const putVer = await packageStore.putVersion(meta.id, newVersion, text, { contentHash: latestHash, at: now });
    if (!putVer.ok) return { ok: false, error: putVer.error };
    const putMeta = await packageStore.putPackage({ ...meta, version: newVersion, updatedAt: now, latestHash });


    if (!putMeta.ok) {
      try { await packageStore.deleteVersion(meta.id, newVersion); } catch (_) {                      }
      return { ok: false, error: putMeta.error };
    }
    for (const copy of copiesOf(meta.id)) {
      const link = linkOf(copy);
      if (!link) continue;
      if (link.getProperty("AutoUpdate") === true) {
        applyTextToCopy(copy, text, newVersion, { undoable: false });
      } else {


        if (setLinkValue(link, "Status", "OutOfDate")) {
          bus.emit("packages:statusChanged", { copy, link, status: "OutOfDate" });
        }
      }
    }
    bus.emit("packages:changed", { type: "restored", packageId: meta.id, version: newVersion });
    return { ok: true, version: newVersion };
  } catch (err) {
    return { ok: false, error: storeError(err, "Falha no armazenamento de packages.") };
  }
}

const pendingStatus = new Set();
let statusTimer = null;

function scheduleStatusRefresh(copy) {
  if (!isInst(copy)) return;
  pendingStatus.add(copy);
  if (statusTimer || typeof setTimeout !== "function") return;
  statusTimer = setTimeout(async () => {
    statusTimer = null;
    const batch = [...pendingStatus];
    pendingStatus.clear();
    for (const c of batch) {
      if (isInst(c)) await refreshStatus(c);
    }
  }, 600);
}


function schedulePackageRootsIn(inst) {
  if (!isInst(inst)) return;
  const stack = [inst];
  while (stack.length) {
    const cur = stack.pop();
    if (!isInst(cur) || cur.className === "PackageLink") continue;
    if (linkOf(cur)) scheduleStatusRefresh(cur);
    for (const ch of cur.getChildren()) stack.push(ch);
  }
}

let initialized = false;
let initOffs = [];

export function init() {
  if (initialized) return;
  initialized = true;
  initOffs.push(bus.on(Events.PropertyChanged, (p) => {
    if (!p || !p.instance) return;
    let start = p.instance;
    if (start.className === "PackageLink") {


      if (p.property === "Status" || p.property === "VersionNumber") return;
      const owner = start.getParent();
      if (!isInst(owner)) return;
      if (p.property === "PackageId") {


        start = owner;
      } else {


        start = typeof owner.getParent === "function" ? owner.getParent() : null;
      }
      if (!start) return;
    }
    for (const root of allPackageRootsFor(start)) scheduleStatusRefresh(root);
  }));
  initOffs.push(bus.on(Events.ChildAdded, (p) => {
    if (!p) return;
    if (p.parent) {
      for (const root of allPackageRootsFor(p.parent)) scheduleStatusRefresh(root);
    }


    const added = p.child || p.instance;
    if (added) schedulePackageRootsIn(added);
  }));
  initOffs.push(bus.on(Events.ChildRemoved, (p) => {
    if (!p || !p.parent) return;
    for (const root of allPackageRootsFor(p.parent)) scheduleStatusRefresh(root);
  }));


  const onCustomDataChanged = (p) => {
    if (!p || !p.instance) return;
    for (const root of allPackageRootsFor(p.instance)) scheduleStatusRefresh(root);
  };
  initOffs.push(bus.on(Events.AttributeChanged, onCustomDataChanged));
  initOffs.push(bus.on(Events.TagAdded, onCustomDataChanged));
  initOffs.push(bus.on(Events.TagRemoved, onCustomDataChanged));
}

export function disposeForTests() {
  initialized = false;


  for (const off of initOffs) {
    try {
      if (typeof off === "function") off();
    } catch (_) {                      }
  }
  initOffs = [];
  pendingStatus.clear();
  if (statusTimer && typeof clearTimeout === "function") clearTimeout(statusTimer);
  statusTimer = null;
}
