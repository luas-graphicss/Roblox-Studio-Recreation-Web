import { bus } from "../core/eventBus.js";
import { store } from "../core/state.js";
import { logger } from "../core/logger.js";
import { TEMPLATES, applyTemplate } from "./templates.js";


export const TEMPLATE_PHOTOS_ENABLED = false;

const CHANGED_EVENT = "startpage:templatePhoto";


const FRAMES_PARTS   = 10;
const FRAMES_TERRAIN = 20;


const CAMERA_POSE = {
  "baseplate":         { eye: [  0, 60, 100], target: [  0,  0,  0] },
  "classic-baseplate": { eye: [  0, 50,  80], target: [  0,  0,  0] },
  "flat-terrain":      { eye: [  5, 45,  70], target: [  0,  0,  0] },
  "village":           { eye: [ 15, 60,  95], target: [  0,  5,  0] },

  "obby":              { eye: [160, 70, 100], target: [160, 12,  0] },

  "racing":            { eye: [ 30, 90, 140], target: [  0,  0,  0] },
};


const memPhotos = {};
let running = false;


export function getTemplatePhoto(id) {
  const url = memPhotos[id];
  return typeof url === "string" && url.startsWith("data:image/") ? url : null;
}


export function onTemplatePhotosChanged(fn) {
  return bus.on(CHANGED_EVENT, fn);
}

function nextFrame() {
  return new Promise((resolve) => {
    if (typeof globalThis.requestAnimationFrame === "function") {
      globalThis.requestAnimationFrame(() => resolve());
    } else {
      setTimeout(resolve, 16);
    }
  });
}

async function waitFrames(count) {
  for (let i = 0; i < count; i++) await nextFrame();
}

function defaultIsIdle() {
  try { return store.get("appMode") === "START_PAGE"; } catch (_) { return false; }
}


function setCameraPose(templateId) {
  const pose = CAMERA_POSE[templateId];
  if (!pose) {

    bus.emit("camera:frameSelection");
    return;
  }
  const [ex, ey, ez] = pose.eye;
  const [tx, ty, tz] = pose.target;
  const dx = tx - ex;
  const dy = ty - ey;
  const dz = tz - ez;
  const len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;

  bus.emit("camera:reset", {
    position:  { x: ex, y: ey, z: ez },
    direction: { x: dx / len, y: dy / len, z: dz / len },
  });
}


const PHOTO_WIDTH = 640;
const PHOTO_HEIGHT = 360;
const PHOTO_QUALITY = 0.9;
const PHOTO_MAX_BYTES = 256 * 1024;

function captureFrame() {
  const payload = {
    width: PHOTO_WIDTH,
    height: PHOTO_HEIGHT,
    quality: PHOTO_QUALITY,
    maxBytes: PHOTO_MAX_BYTES,
  };
  bus.emit("viewport:thumbnail", payload);
  const url = payload.dataUrl;
  return typeof url === "string" && url.startsWith("data:image/") && url.length > 256
    ? url
    : null;
}


export async function ensureTemplatePhotos(deps) {

  if (!TEMPLATE_PHOTOS_ENABLED) return;
  const newPlaceSilently = deps && deps.newPlaceSilently;
  const isIdle = (deps && deps.isIdle) || defaultIsIdle;
  if (running || typeof newPlaceSilently !== "function") return;
  if (!isIdle()) return;

  running = true;
  let captured = 0;
  let attempted = 0;
  let dirtied = false;
  try {
    for (const t of TEMPLATES) {
      if (!isIdle()) break;

      if (getTemplatePhoto(t.id)) continue;
      attempted += 1;


      newPlaceSilently();
      dirtied = true;
      let built = false;
      try { built = applyTemplate(store.getDataModel(), t.id); } catch (_) { built = false; }
      if (!built) continue;


      await waitFrames(t.id === "flat-terrain" ? FRAMES_TERRAIN : FRAMES_PARTS);
      if (!isIdle()) break;


      setCameraPose(t.id);

      await waitFrames(2);
      if (!isIdle()) break;

      const url = captureFrame();
      if (url) {
        memPhotos[t.id] = url;
        captured += 1;
        bus.emit(CHANGED_EVENT, { id: t.id });
      }
    }
  } catch (e) {
    logger.warn("Template photos: sessão interrompida: " + ((e && e.message) || e), { source: "Studio" });
  } finally {

    if (dirtied && isIdle()) {
      try { newPlaceSilently(); } catch (_) {}
    }
    running = false;
    if (captured > 0) {
      logger.info("Template photos: " + captured + " foto(s) capturada(s) pela engine.", { source: "Studio" });
    } else if (attempted > 0) {
      logger.warn("Template photos: nenhuma foto capturada (WebGL indisponível?).", { source: "Studio" });
    }
  }
}
