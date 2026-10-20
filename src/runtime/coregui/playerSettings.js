import { readJSON, writeJSON } from "../../utils/storage.js";

const KEY = "playerSettings";

const DEFAULTS = Object.freeze({
  volume: 7,
  cameraMode: "Classic",
  movementMode: "Default",
  shiftLockSwitch: true,
  sensitivity: 1,
  graphicsQuality: 0,
  fullscreen: false,
  perfStats: false,
});

function clampNum(v, lo, hi, def) {
  const n = Number(v);
  if (!Number.isFinite(n)) return def;
  return Math.min(hi, Math.max(lo, n));
}

function sanitize(raw) {
  const src = raw && typeof raw === "object" ? raw : {};
  return {
    volume: clampNum(src.volume, 0, 10, DEFAULTS.volume),
    cameraMode: src.cameraMode === "Follow" ? "Follow" : "Classic",
    movementMode: src.movementMode === "ClickToMove" ? "ClickToMove" : "Default",
    shiftLockSwitch: src.shiftLockSwitch !== false,
    sensitivity: clampNum(src.sensitivity, 0.2, 3, DEFAULTS.sensitivity),
    graphicsQuality: Math.round(clampNum(src.graphicsQuality, 0, 10, DEFAULTS.graphicsQuality)),
    fullscreen: src.fullscreen === true,
    perfStats: src.perfStats === true,
  };
}

let values = sanitize(readJSON(KEY));

export function getPlayerSettings() {
  return { ...values };
}

export function setPlayerSetting(key, value) {
  if (!(key in DEFAULTS)) return undefined;
  values = sanitize({ ...values, [key]: value });
  writeJSON(KEY, values);
  return values[key];
}
