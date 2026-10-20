export const BLOOM_OWNER = "CP-F14";
export const BLOOM_PROFILE = "diagnostic-standard-v1";
export const MAX_BLOOM_BANDS = 6;

const defaultBands = Object.freeze(Array.from({ length: MAX_BLOOM_BANDS }, () => Object.freeze({
  weight: 1,
  scale: 1,
  tint: Object.freeze([1, 1, 1])
})));

export const DEFAULT_BLOOM_SETTINGS = Object.freeze({
  enabled: true,
  intensity: 0.125,
  threshold: 1,
  softKnee: 0.5,
  bands: defaultBands
});

function finiteNumber(value, fallback, name, minimum, maximum) {
  if (value === undefined || value === null) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value < minimum || value > maximum) {
    throw new TypeError(`${BLOOM_OWNER}.${name} must be finite in [${minimum}, ${maximum}]`);
  }
  return value;
}

function validateKeys(value, allowed, label) {
  for (const key of Object.keys(value)) {
    if (!allowed.includes(key)) throw new TypeError(`${label}: unknown property ${key}`);
  }
}

function resolveBand(band, index) {
  const fallback = defaultBands[index];
  if (band === undefined || band === null) return fallback;
  if (typeof band !== "object" || Array.isArray(band)) throw new TypeError(`Band ${index} must be an object`);
  validateKeys(band, ["weight", "scale", "tint"], `Band ${index}`);
  const tint = band.tint ?? fallback.tint;
  if (!Array.isArray(tint) || tint.length !== 3) throw new TypeError(`Band ${index} tint requires three channels`);
  return Object.freeze({
    weight: finiteNumber(band.weight, fallback.weight, `bands.${index}.weight`, 0, 16),
    scale: finiteNumber(band.scale, fallback.scale, `bands.${index}.scale`, 0, 4),
    tint: Object.freeze(tint.map((channel, component) => finiteNumber(channel, 1, `bands.${index}.tint.${component}`, 0, 4)))
  });
}

export function resolveBloomSettings(authored) {
  if (authored === undefined || authored === null) return DEFAULT_BLOOM_SETTINGS;
  if (typeof authored !== "object" || Array.isArray(authored)) throw new TypeError(`${BLOOM_OWNER} settings must be an object`);
  validateKeys(authored, ["enabled", "intensity", "threshold", "softKnee", "bands"], BLOOM_OWNER);
  const enabled = authored.enabled ?? DEFAULT_BLOOM_SETTINGS.enabled;
  if (typeof enabled !== "boolean") throw new TypeError(`${BLOOM_OWNER}.enabled must be boolean or null`);
  const threshold = finiteNumber(authored.threshold, DEFAULT_BLOOM_SETTINGS.threshold, "threshold", -1, 65504);
  if (threshold < 0 && threshold !== -1) throw new RangeError("Bloom threshold must be -1 or nonnegative");
  const bands = authored.bands ?? defaultBands;
  if (!Array.isArray(bands) || bands.length < 1 || bands.length > MAX_BLOOM_BANDS) throw new TypeError("Bloom requires one to six bands");
  return Object.freeze({
    enabled,
    intensity: finiteNumber(authored.intensity, DEFAULT_BLOOM_SETTINGS.intensity, "intensity", 0, 16),
    threshold,
    softKnee: finiteNumber(authored.softKnee, DEFAULT_BLOOM_SETTINGS.softKnee, "softKnee", 0, 1),
    bands: Object.freeze(bands.map(resolveBand))
  });
}

export function isBloomActive(settings) {
  return settings.enabled && settings.intensity > 0 && settings.bands.some((band) => band.weight > 0 && band.tint.some((channel) => channel > 0));
}

export function createBloomSettingsReader(store) {
  let cachedSource = Symbol("unread");
  let cachedRevision;
  let cachedSettings;
  return () => {
    const source = store?.get?.(BLOOM_OWNER);
    const revision = store?.revision?.();
    if (source !== cachedSource || revision !== cachedRevision) {
      cachedSettings = resolveBloomSettings(source);
      cachedSource = source;
      cachedRevision = revision;
    }
    return cachedSettings;
  };
}
