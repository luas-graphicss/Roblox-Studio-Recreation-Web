import { bus } from "../core/eventBus.js";
import { logger } from "../core/logger.js";
import { project } from "../core/project.js";
import * as versionHistory from "../collab/versionHistory.js";
import * as cloudStore from "./cloudStore.js";

const MAX_NAME = 120;

let _activePlaceId = null;
let _wired = false;

export function wire() {
  if (_wired) return;
  _wired = true;
  bus.on("project:loaded", (p) => {
    const src = p && p.source != null ? String(p.source) : "";


    if (src === "cloud" || /^v(\d+|\?)$/.test(src)) return;
    _activePlaceId = null;
  });
}

export function setActivePlace(placeId) {
  _activePlaceId = placeId == null ? null : String(placeId);
}

export function getActivePlaceId() {
  return _activePlaceId;
}

export function sanitizeCloudName(raw, fallback) {
  let s = String(raw == null ? "" : raw);
  s = s.replace(/<[^>]*>/g, " ").replace(/[<>{}\\`$]/g, " ").replace(/\s+/g, " ").trim();


  s = cloudStore.sliceName(s, MAX_NAME);
  return s || String(fallback || "Untitled");
}

function seedMetrics() {
  return {
    visits: 500 + Math.floor(Math.random() * 60000),
    concurrents: Math.floor(Math.random() * 140),
    revenue: Math.floor(Math.random() * 1200),
  };
}





function emptyMetrics() {
  return { visits: 0, concurrents: 0, revenue: 0 };
}

export function ensureLiveMetrics(universe) {
  if (!universe) return;
  const m = universe.metrics || {};


  const clampMetric = (v) => {
    const n = Math.floor(Number(v) || 0);
    return Number.isFinite(n) && n > 0 ? n : 0;
  };
  const visits = clampMetric(m.visits);
  const concurrents = clampMetric(m.concurrents);
  const revenue = clampMetric(m.revenue);
  if (visits > 0 || concurrents > 0 || revenue > 0) {


    universe.metrics = { visits, concurrents, revenue };
  } else {
    universe.metrics = seedMetrics();
  }
}


export async function markUniverseLive(universeId, when) {
  try {
    const universe = await cloudStore.getUniverse(universeId);
    if (!universe) return null;
    ensureLiveMetrics(universe);
    universe.updatedAt = when || new Date().toISOString();
    return await cloudStore.putUniverse(universe);
  } catch (e) {


    logger.warn("Cloud: markUniverseLive falhou: " + ((e && e.message) || e), { source: "Studio" });
    return null;
  }
}

export async function createUniverse(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  const now = new Date().toISOString();
  const rec = {
    id: cloudStore.newId64(),
    name: sanitizeCloudName(o.name, "New Universe"),
    rootPlaceId: null,
    isPublic: !!o.isPublic,
    collaborators: [],
    groups: [],
    createdAt: now,
    updatedAt: now,
    metrics: emptyMetrics(),
  };
  await cloudStore.putUniverse(rec);
  logger.info("Cloud: Universe \"" + rec.name + "\" criado (id " + rec.id + ").", { source: "Studio" });
  return rec;
}

export async function createPlace(universe, name) {
  if (!universe || !universe.id) throw new Error("Universe inv\u00e1lido para criar o Place.");
  const now = new Date().toISOString();
  const rec = {
    id: cloudStore.newId64(),
    universeId: String(universe.id),
    name: sanitizeCloudName(name, "Place"),
    sourceKey: null,
    savedAt: null,
    size: 0,
    thumbnail: null,
    cloudVersion: 0,
    activeVersionId: null,
    activeVersionNum: null,
    publishedAt: null,
    textChunks: 0,
    createdAt: now,
  };
  await cloudStore.putPlace(rec);
  if (!universe.rootPlaceId) {
    universe.rootPlaceId = rec.id;
    universe.updatedAt = now;
    await cloudStore.putUniverse(universe);
  }
  return rec;
}

export async function findLink() {
  if (_activePlaceId) {
    const place = await cloudStore.getPlace(_activePlaceId);
    if (place) {
      const universe = await cloudStore.getUniverse(place.universeId);
      if (universe) return { universe, place };
    }
    _activePlaceId = null;
  }
  const key = versionHistory.currentProjectKey();
  if (!key || key.startsWith("session:")) return null;
  const places = await cloudStore.listPlaces();
  const place = places.find((p) => p.sourceKey === key);
  if (!place) return null;
  const universe = await cloudStore.getUniverse(place.universeId);
  if (!universe) return null;
  return { universe, place };
}

export async function createLink(opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  let universe = null;
  if (o.universeId) universe = await cloudStore.getUniverse(o.universeId);
  if (!universe) {
    universe = await createUniverse({ name: o.universeName || project.getName() });
  }
  const place = await createPlace(universe, o.placeName || project.getName());
  setActivePlace(place.id);
  return { universe, place };
}

export async function saveBuiltToCloud(built, opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  if (!built || typeof built.text !== "string" || !built.text) throw new Error("Conte\u00fado do projeto indispon\u00edvel.");
  if (!o.place || !o.place.id) throw new Error("Place de destino inv\u00e1lido.");


  const place = (await cloudStore.getPlace(o.place.id)) || o.place;
  const now = new Date().toISOString();
  place.textChunks = await cloudStore.writePlaceText(place.id, built.text);


  const projKey = versionHistory.currentProjectKey();
  if (projKey && !String(projKey).startsWith("session:")) {
    place.sourceKey = projKey;
  } else if (!place.sourceKey) {
    place.sourceKey = "cloudplace:" + place.id;
  }
  place.savedAt = now;


  try { place.size = new TextEncoder().encode(built.text).length; } catch (_) { place.size = built.text.length; }
  if (built.thumbnail) place.thumbnail = built.thumbnail;
  if (o.placeName) place.name = sanitizeCloudName(o.placeName, place.name);
  const meta = await versionHistory.recordVersion({
    projectKey: place.sourceKey,
    text: built.text,
    thumbnail: built.thumbnail || null,
    comment: o.comment || "Save to Cloud",
    force: !!o.publish,
  });
  if (o.publish) {
    place.cloudVersion = (Number(place.cloudVersion) || 0) + 1;
    place.publishedAt = now;
    if (meta) {
      place.activeVersionId = meta.id;
      place.activeVersionNum = meta.num;
    } else {
      logger.warn('Cloud: publish de "' + place.name + '" sem registro de vers\u00e3o (armazenamento de vers\u00f5es indispon\u00edvel) \u2014 Active Version anterior mantida.', { source: "Studio" });
    }
  }
  await cloudStore.putPlace(place);


  const uniId = o.universe && o.universe.id ? String(o.universe.id) : String(place.universeId);
  let universe = await cloudStore.getUniverse(uniId);
  if (!universe && o.universe && o.universe.id) universe = o.universe;
  if (universe) {
    universe.updatedAt = now;
    if (o.makePublic != null) universe.isPublic = !!o.makePublic;


    if (o.publish) ensureLiveMetrics(universe);
    await cloudStore.putUniverse(universe);
  }
  setActivePlace(place.id);
  bus.emit("cloud:placeSaved", { placeId: place.id, published: !!o.publish });
  return { universe, place, versionMeta: meta };
}

export async function publishBuiltPlace(built, opts) {
  const o = opts && typeof opts === "object" ? opts : {};
  let link = await findLink();
  if (!link) {
    link = await createLink({ universeName: o.name || project.getName(), placeName: o.name || project.getName() });
  }
  const res = await saveBuiltToCloud(built, {
    universe: link.universe,
    place: link.place,
    placeName: o.name || null,
    comment: "Publish to Roblox",
    publish: true,
    makePublic: o.makePublic == null ? null : !!o.makePublic,
  });
  logger.info(
    "Cloud: \"" + res.place.name + "\" publicado \u2014 vers\u00e3o ativa v" + (res.place.activeVersionNum || "?") + " (cloud v" + res.place.cloudVersion + ").",
    { source: "Studio" },
  );
  return res;
}

export async function setActiveVersion(placeId, versionMeta) {
  const place = await cloudStore.getPlace(placeId);
  if (!place || !versionMeta || !versionMeta.id) return null;
  place.activeVersionId = versionMeta.id;
  place.activeVersionNum = versionMeta.num || null;
  await cloudStore.putPlace(place);
  bus.emit("cloud:placeSaved", { placeId: place.id, activeVersion: versionMeta.num });
  return place;
}

wire();
