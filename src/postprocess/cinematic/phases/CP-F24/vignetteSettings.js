import { requireFiniteNumber } from "../../contracts/frameContract.js";
import { VIGNETTE_SETTINGS_KEY } from "./vignetteContract.js";

export const VIGNETTE_DEFAULTS = Object.freeze({ enabled: true, intensity: 0, aspectRatio: null });

export function isVignetteInherited(value) {
  return value === undefined || value === null || value === "AUTO";
}

export function resolveVignetteSettings(authored, inheritedIntensity = 0) {
  if (isVignetteInherited(authored)) authored = {};
  if (typeof authored !== "object" || Array.isArray(authored)) throw new TypeError("CP-F24 settings must be an object or AUTO");
  if (![Object.prototype, null].includes(Object.getPrototypeOf(authored))) throw new TypeError("CP-F24 settings require a plain object");
  for (const key of Object.keys(authored)) {
    if (!Object.hasOwn(VIGNETTE_DEFAULTS, key)) throw new TypeError(`Unknown CP-F24 setting: ${key}`);
  }
  requireFiniteNumber(inheritedIntensity, "CP-F24 inherited intensity", 0, 1);
  const enabled = isVignetteInherited(authored.enabled) ? true : authored.enabled;
  if (typeof enabled !== "boolean") throw new TypeError("CP-F24 enabled must be boolean or AUTO");
  const intensity = isVignetteInherited(authored.intensity) ? inheritedIntensity : authored.intensity;
  requireFiniteNumber(intensity, "CP-F24 intensity", 0, 1);
  const aspectRatio = isVignetteInherited(authored.aspectRatio) ? null : authored.aspectRatio;
  if (aspectRatio !== null) requireFiniteNumber(aspectRatio, "CP-F24 aspectRatio", 1 / 32, 32);
  return Object.freeze({ enabled, intensity, aspectRatio });
}

export function createVignetteSettingsReader() {
  let previousStore;
  let previousRevision;
  let previousAuthor;
  let previousInherited;
  let resolved;
  return (store, inheritedIntensity = 0) => {
    const author = store?.get?.(VIGNETTE_SETTINGS_KEY);
    const revision = store?.revision?.();
    if (resolved && store === previousStore && revision === previousRevision && author === previousAuthor && inheritedIntensity === previousInherited) return resolved;
    const next = resolveVignetteSettings(author, inheritedIntensity);
    previousStore = store;
    previousRevision = revision;
    previousAuthor = author;
    previousInherited = inheritedIntensity;
    resolved = next;
    return next;
  };
}
