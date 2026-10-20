import { requireFiniteNumber } from "../../contracts/frameContract.js";
import { CHROMATIC_SETTINGS_KEY } from "./chromaticContract.js";

export const CHROMATIC_DEFAULTS = Object.freeze({
  enabled: true,
  intensity: 0,
  startOffset: 0,
  center: Object.freeze([0.5, 0.5]),
  cropMode: "preserve",
  cropUv: null,
  edgeMode: "clamp",
});

function isInherited(value) {
  return value === undefined || value === null || value === "AUTO";
}

function requireRecord(value) {
  if (
    !value ||
    typeof value !== "object" ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value))
  )
    throw new TypeError("CP-F23 settings must be a plain object or AUTO");
  for (const key of Object.keys(value))
    if (!Object.hasOwn(CHROMATIC_DEFAULTS, key))
      throw new TypeError(`Unknown CP-F23 setting: ${key}`);
  return value;
}

export function validateChromaticCrop(value) {
  if (!Array.isArray(value) || value.length !== 4)
    throw new TypeError("CP-F23 cropUv requires [x, y, width, height]");
  value.forEach((component, index) =>
    requireFiniteNumber(component, `CP-F23 cropUv[${index}]`, index < 2 ? 0 : Number.MIN_VALUE, 1),
  );
  if (value[0] + value[2] > 1 + 1e-12 || value[1] + value[3] > 1 + 1e-12)
    throw new RangeError("CP-F23 cropUv must fit inside the captured texture");
  return Object.freeze([...value]);
}

export function resolveChromaticSettings(authored = {}, inherited = CHROMATIC_DEFAULTS) {
  const record = isInherited(authored) ? {} : requireRecord(authored);
  const value = (name) => (isInherited(record[name]) ? inherited[name] : record[name]);
  const enabled = value("enabled");
  if (typeof enabled !== "boolean") throw new TypeError("CP-F23 enabled must be boolean or AUTO");
  const intensity = requireFiniteNumber(value("intensity"), "CP-F23 intensity", 0, 5);
  const startOffset = requireFiniteNumber(value("startOffset"), "CP-F23 startOffset", 0, 1);
  const center = value("center");
  if (!Array.isArray(center) || center.length !== 2)
    throw new TypeError("CP-F23 center requires two normalized coordinates");
  center.forEach((component) => requireFiniteNumber(component, "CP-F23 center", 0, 1));
  const cropMode = value("cropMode");
  if (!["preserve", "explicit", "camera"].includes(cropMode))
    throw new TypeError("CP-F23 cropMode must be preserve, explicit or camera");
  const cropUv = value("cropUv") === null ? null : validateChromaticCrop(value("cropUv"));
  if (cropMode === "explicit" && !cropUv) throw new Error("CP-F23 explicit crop requires cropUv");
  if (cropMode !== "explicit" && cropUv)
    throw new Error("CP-F23 cropUv is only valid in explicit mode");
  const edgeMode = value("edgeMode");
  if (!["clamp", "transparent"].includes(edgeMode))
    throw new TypeError("CP-F23 edgeMode must be clamp or transparent");
  return Object.freeze({
    enabled,
    intensity,
    startOffset,
    center: Object.freeze([...center]),
    cropMode,
    cropUv,
    edgeMode,
  });
}

export function createChromaticSettingsReader(store) {
  if (typeof store?.get !== "function") throw new TypeError("CP-F23 requires a settings store");
  const cache = new Map();
  return (viewId) => {
    const revision = store.revision?.();
    const globalSettings = store.get(CHROMATIC_SETTINGS_KEY);
    const viewSettings = store.get(`${CHROMATIC_SETTINGS_KEY}.${viewId}`);
    const previous = cache.get(viewId);
    if (
      revision !== undefined &&
      previous?.revision === revision &&
      previous.globalSettings === globalSettings &&
      previous.viewSettings === viewSettings
    )
      return previous.resolved;
    const resolved = resolveChromaticSettings(
      viewSettings,
      resolveChromaticSettings(globalSettings),
    );
    cache.set(viewId, { revision, globalSettings, viewSettings, resolved });
    return resolved;
  };
}
