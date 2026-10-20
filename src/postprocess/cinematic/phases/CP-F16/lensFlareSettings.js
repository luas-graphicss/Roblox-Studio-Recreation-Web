import { MAX_GHOSTS, LENS_FLARE_OWNER } from "./lensFlareContract.js";
import { resolveBokehLayers } from "./bokehShape.js";
import { requireRecord, resolveScalar, resolveTint } from "./lensFlareValidation.js";

const white = Object.freeze([1, 1, 1]);
const defaultGhosts = Object.freeze([
  Object.freeze({ position: -1, weight: 0.4, tint: Object.freeze([1, 0.65, 0.35]) }),
  Object.freeze({ position: -0.55, weight: 0.25, tint: Object.freeze([0.35, 0.7, 1]) }),
  Object.freeze({ position: 0.35, weight: 0.2, tint: Object.freeze([0.5, 1, 0.65]) }),
  Object.freeze({ position: 1.45, weight: 0.15, tint: Object.freeze([0.75, 0.5, 1]) })
]);

export const DEFAULT_LENS_FLARE_SETTINGS = Object.freeze({
  enabled: true,
  intensity: 0.15,
  threshold: 4,
  softKnee: 0.5,
  tint: white,
  ghosts: defaultGhosts,
  haloIntensity: 0.2,
  haloRadiusPercent: 12,
  haloTint: white,
  bokehSizePercent: 2,
  dispersionPixels: 1,
  resolutionDivisor: 2,
  bokehShape: resolveBokehLayers(undefined)
});

const scalarRanges = Object.freeze({
  intensity: [0, 16], threshold: [0, 65504], softKnee: [0, 1],
  haloIntensity: [0, 16], haloRadiusPercent: [0, 50],
  bokehSizePercent: [0, 20], dispersionPixels: [0, 32], resolutionDivisor: [1, 4]
});

function resolveGhost(ghost, index) {
  requireRecord(ghost, `Ghost ${index}`, ["position", "weight", "tint"]);
  const position = resolveScalar(ghost.position, -1, "Ghost position", -4, 4);
  if (Math.abs(position) < 0.125) throw new RangeError("Ghost position magnitude must be at least 0.125; a singular central collapse is unsupported");
  return Object.freeze({ position, weight: resolveScalar(ghost.weight, 1, "Ghost weight", 0, 16), tint: resolveTint(ghost.tint, white, "Ghost tint") });
}

export function resolveLensFlareSettings(authored) {
  if (authored === undefined || authored === null || authored === "AUTO") return DEFAULT_LENS_FLARE_SETTINGS;
  requireRecord(authored, LENS_FLARE_OWNER, ["enabled", "tint", "ghosts", "haloTint", "bokehShape", "bokehLayers", ...Object.keys(scalarRanges)]);
  const result = {};
  const enabled = authored.enabled;
  result.enabled = enabled === undefined || enabled === null || enabled === "AUTO" ? true : enabled;
  if (typeof result.enabled !== "boolean") throw new TypeError("Lens flare enabled must be boolean or AUTO");
  for (const [key, [minimum, maximum]] of Object.entries(scalarRanges)) result[key] = resolveScalar(authored[key], DEFAULT_LENS_FLARE_SETTINGS[key], key, minimum, maximum);
  if (![1, 2, 4].includes(result.resolutionDivisor)) throw new RangeError("Lens flare resolutionDivisor must be 1, 2 or 4");
  result.tint = resolveTint(authored.tint, white, "Lens flare tint");
  result.haloTint = resolveTint(authored.haloTint, white, "Halo tint");
  const ghosts = authored.ghosts === undefined || authored.ghosts === null || authored.ghosts === "AUTO" ? defaultGhosts : authored.ghosts;
  if (!Array.isArray(ghosts) || ghosts.length > MAX_GHOSTS) throw new RangeError("Lens flare supports zero to eight explicit ghosts");
  result.ghosts = Object.freeze(ghosts.map(resolveGhost));
  result.bokehShape = resolveBokehLayers(authored.bokehShape, authored.bokehLayers);
  return Object.freeze(result);
}

export function isLensFlareActive(settings) {
  return settings.enabled && settings.intensity > 0 && settings.tint.some((value) => value > 0) &&
    (settings.ghosts.some((ghost) => ghost.weight > 0 && ghost.tint.some((value) => value > 0)) || settings.haloIntensity > 0 && settings.haloTint.some((value) => value > 0));
}

export function createLensFlareSettingsReader(store) {
  let previousSource = Symbol("unread");
  let previousRevision;
  let resolved;
  return () => {
    const authored = store?.get?.(LENS_FLARE_OWNER);
    const revision = store?.revision?.();
    if (authored !== previousSource || revision !== previousRevision) {
      resolved = resolveLensFlareSettings(authored);
      previousSource = authored;
      previousRevision = revision;
    }
    return resolved;
  };
}
