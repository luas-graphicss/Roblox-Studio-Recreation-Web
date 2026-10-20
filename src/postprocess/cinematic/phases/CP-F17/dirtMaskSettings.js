import { DIRT_SETTINGS_KEY } from "./dirtMaskContract.js";

export const DEFAULT_DIRT_SETTINGS = Object.freeze({
  enabled: false,
  intensity: 1,
  tint: Object.freeze([1, 1, 1]),
  mask: null,
  fit: "cover",
  outputRect: Object.freeze([0, 0, 1, 1])
});

function boundedNumber(value, name, minimum, maximum) {
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new TypeError(`CP-F17 ${name} must be finite in [${minimum}, ${maximum}]`);
  }
  return value;
}

export function resolveDirtMaskSettings(authored) {
  if (authored === undefined || authored === null) return DEFAULT_DIRT_SETTINGS;
  if (typeof authored !== "object" || Array.isArray(authored)) throw new TypeError("CP-F17 settings must be an object or null");
  for (const key of Object.keys(authored)) {
    if (!Object.hasOwn(DEFAULT_DIRT_SETTINGS, key)) throw new TypeError(`Unknown CP-F17 setting: ${key}`);
  }
  const enabled = authored.enabled ?? DEFAULT_DIRT_SETTINGS.enabled;
  if (typeof enabled !== "boolean") throw new TypeError("CP-F17 enabled must be boolean");
  const tint = authored.tint ?? DEFAULT_DIRT_SETTINGS.tint;
  if (!Array.isArray(tint) || tint.length !== 3) throw new TypeError("CP-F17 tint requires three linear channels");
  const fit = authored.fit ?? DEFAULT_DIRT_SETTINGS.fit;
  if (!["cover", "contain", "stretch"].includes(fit)) throw new TypeError("CP-F17 fit must be cover, contain or stretch");
  const rectangle = authored.outputRect ?? DEFAULT_DIRT_SETTINGS.outputRect;
  if (!Array.isArray(rectangle) || rectangle.length !== 4) throw new TypeError("CP-F17 outputRect requires x, y, width and height");
  const outputRect = rectangle.map((value, index) => boundedNumber(value, `outputRect[${index}]`, index < 2 ? 0 : Number.MIN_VALUE, 1));
  if (outputRect[0] + outputRect[2] > 1 || outputRect[1] + outputRect[3] > 1) throw new RangeError("CP-F17 outputRect exceeds the final output");
  return Object.freeze({
    enabled,
    intensity: boundedNumber(authored.intensity ?? 1, "intensity", 0, 16),
    tint: Object.freeze(tint.map((value) => boundedNumber(value, "tint channel", 0, 16))),
    mask: authored.mask ?? null,
    fit,
    outputRect: Object.freeze(outputRect)
  });
}

export function isDirtMaskRequested(settings) {
  return settings.enabled && settings.intensity > 0 && settings.tint.some((value) => value > 0);
}

export function createDirtMaskSettingsReader(store) {
  let previousAuthored = Symbol("unread");
  let previousRevision;
  let resolved;
  return () => {
    const authored = store?.get?.(DIRT_SETTINGS_KEY);
    const revision = store?.revision?.();
    if (previousAuthored !== authored || previousRevision !== revision) {
      resolved = resolveDirtMaskSettings(authored);
      previousAuthored = authored;
      previousRevision = revision;
    }
    return resolved;
  };
}
